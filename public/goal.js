// The contribution sheet for the community goal: amount → review → Phantom approval → submitted → confirmed.
// The server builds the USDC transfer (POST /api/v1/goal/tx), Phantom signs it, and the server verifies the
// signature on chain (POST /api/v1/goal/contributions). Nothing here holds keys or talks to any origin but
// this site. Two ways to reach Phantom:
//   1. Injected provider (window.phantom.solana): the browser extension, or the Phantom app's own browser.
//      Phantom signs and sends in one step.
//   2. Deeplink handoff on phones (Chrome, Safari…): mobile browsers cannot host the extension and Phantom
//      does not inject into them, so the page bounces to the Phantom app for the connect and sign approvals
//      and lands back here (https://docs.phantom.com/phantom-deeplinks). Requests and replies are encrypted
//      with nacl.box (x25519), so the vendored tweetnacl is loaded only on this path. Phantom returns the
//      signed transaction without sending it; the site relays it to the network (POST /api/v1/goal/submit).
//      The handoff state (our ephemeral keypair, the amount, the session) lives in localStorage across the
//      redirects; it never contains a wallet key and expires after ten minutes.
(function () {
  'use strict';
  var body = document.body;
  var cfg = {
    wallet: body.getAttribute('data-goal-wallet') || '',
    explorer: body.getAttribute('data-goal-explorer') || 'https://solscan.io',
    min: parseFloat(body.getAttribute('data-goal-min') || '1'),
    locale: body.getAttribute('data-locale') || 'en',
  };
  if (!cfg.wallet) return;
  var strings = {};
  try {
    strings = JSON.parse((document.getElementById('goal-i18n') || {}).textContent || '{}');
  } catch (e) {
    strings = {};
  }
  var t = function (k, d) {
    return strings[k] == null ? d : strings[k];
  };
  var intl = { en: 'en-US', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', ja: 'ja-JP', ko: 'ko-KR' }[cfg.locale] || 'en-US';
  var usd = new Intl.NumberFormat(intl, { style: 'currency', currency: 'USD' });
  var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  function log() {
    if (window.console && window.localStorage && window.localStorage.getItem('claude-resets-debug') === '1') console.log.apply(console, ['[goal]'].concat(Array.prototype.slice.call(arguments)));
  }

  // ---------- Phantom (injected provider) ----------
  function provider() {
    var p = window.phantom && window.phantom.solana;
    return p && p.isPhantom ? p : null;
  }
  var account = null;
  function connect() {
    var p = provider();
    if (!p) return Promise.reject(Object.assign(new Error('no wallet'), { code: 'no_wallet' }));
    if (p.publicKey) {
      account = p.publicKey.toString();
      return Promise.resolve(account);
    }
    return p.connect().then(function (resp) {
      var key = (resp && resp.publicKey) || p.publicKey;
      if (!key) throw Object.assign(new Error('no account'), { code: 'no_account' });
      account = key.toString();
      return account;
    });
  }
  function bindEvents() {
    var p = provider();
    if (!p || !p.on || p.__crBound) return;
    p.__crBound = true;
    p.on('accountChanged', function (key) {
      account = key ? key.toString() : null;
      payBtn.textContent = payLabel();
    });
    p.on('disconnect', function () {
      account = null;
      payBtn.textContent = payLabel();
    });
  }

  // ---------- base58 (Solana alphabet; BigInt, small inputs only) ----------
  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58encode(bytes) {
    var zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
    var n = 0n;
    for (var i = zeros; i < bytes.length; i++) n = (n << 8n) | BigInt(bytes[i]);
    var out = '';
    while (n > 0n) {
      out = B58[Number(n % 58n)] + out;
      n /= 58n;
    }
    return '1'.repeat(zeros) + out;
  }
  function b58decode(text) {
    var zeros = 0;
    while (zeros < text.length && text[zeros] === '1') zeros++;
    var n = 0n;
    for (var i = zeros; i < text.length; i++) {
      var v = B58.indexOf(text[i]);
      if (v < 0) throw new Error('bad base58');
      n = n * 58n + BigInt(v);
    }
    var tail = [];
    while (n > 0n) {
      tail.unshift(Number(n & 0xffn));
      n >>= 8n;
    }
    var out = new Uint8Array(zeros + tail.length);
    out.set(tail, zeros);
    return out;
  }

  // ---------- Phantom (deeplink handoff on phones) ----------
  var HANDOFF_KEY = 'claude-resets-goal-handoff';
  var HANDOFF_TTL_MS = 10 * 60 * 1000;
  var handoffAvailable = isMobile && typeof BigInt === 'function' && !!window.localStorage;
  function readHandoff() {
    try {
      var h = JSON.parse(localStorage.getItem(HANDOFF_KEY) || 'null');
      if (h && h.at && Date.now() - h.at < HANDOFF_TTL_MS) return h;
    } catch (e) {}
    return null;
  }
  function writeHandoff(h) {
    try {
      localStorage.setItem(HANDOFF_KEY, JSON.stringify(h));
    } catch (e) {}
  }
  function clearHandoff() {
    try {
      localStorage.removeItem(HANDOFF_KEY);
    } catch (e) {}
  }
  var naclLoading = null;
  function loadNacl() {
    if (window.nacl && window.nacl.box) return Promise.resolve(window.nacl);
    if (naclLoading) return naclLoading;
    naclLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/vendor/nacl-fast.min.js';
      s.onload = function () {
        window.nacl && window.nacl.box ? resolve(window.nacl) : reject(new Error('nacl missing'));
      };
      s.onerror = function () {
        naclLoading = null;
        reject(new Error('nacl failed to load'));
      };
      document.head.appendChild(s);
    });
    return naclLoading;
  }
  function redirectLink() {
    return location.origin + location.pathname;
  }
  function phantomUrl(method, params) {
    return 'https://phantom.app/ul/v1/' + method + '?' + new URLSearchParams(params).toString();
  }
  function sharedSecret(nacl, h) {
    return nacl.box.before(b58decode(h.phantomKey), b58decode(h.secret));
  }
  function decryptReply(nacl, h, nonce, data) {
    var opened = nacl.box.open.after(b58decode(data), b58decode(nonce), sharedSecret(nacl, h));
    if (!opened) throw Object.assign(new Error('bad reply'), { code: 'handoff' });
    return JSON.parse(new TextDecoder().decode(opened));
  }
  function encryptRequest(nacl, h, payload) {
    var nonce = nacl.randomBytes(24);
    var boxed = nacl.box.after(new TextEncoder().encode(JSON.stringify(payload)), nonce, sharedSecret(nacl, h));
    return { nonce: b58encode(nonce), payload: b58encode(boxed) };
  }
  /** Step 1: leave for the Phantom app to connect. Called from the pay tap so the navigation keeps its user gesture. */
  function startHandoff() {
    return loadNacl().then(function (nacl) {
      var pair = nacl.box.keyPair();
      writeHandoff({ at: Date.now(), step: 'connect', amount: amount, secret: b58encode(pair.secretKey), pub: b58encode(pair.publicKey) });
      log('handoff: connect');
      location.href = phantomUrl('connect', { app_url: location.origin, dapp_encryption_public_key: b58encode(pair.publicKey), redirect_link: redirectLink(), cluster: 'mainnet-beta' });
    });
  }
  /** Step 2 (after the connect reply): build the transfer and leave for the Phantom app to sign it. */
  function signViaHandoff(h) {
    return loadNacl().then(function (nacl) {
      h.amount = amount; // the field may have changed since the connect handoff
      say(t('preparing', 'Preparing the transfer…'));
      return post('/api/v1/goal/tx', { from: h.wallet, amount: h.amount }).then(function (r) {
        var sol = (r.body.fee_lamports || 0) / 1e9;
        rowFee.textContent = '≈ ' + sol.toFixed(6) + ' SOL';
        rowTotal.textContent = usd.format(h.amount) + ' + ' + sol.toFixed(6) + ' SOL';
        var message = b58decode(r.body.message);
        var tx = new Uint8Array(65 + message.length); // one empty signature slot, then the message
        tx[0] = 1;
        tx.set(message, 65);
        var req = encryptRequest(nacl, h, { transaction: b58encode(tx), session: h.session });
        writeHandoff(Object.assign({}, h, { at: Date.now(), step: 'sign' }));
        log('handoff: sign', r.body.source, '→', r.body.destination);
        say(t('awaiting', 'Awaiting approval in Phantom'));
        location.href = phantomUrl('signTransaction', { dapp_encryption_public_key: h.pub, nonce: req.nonce, redirect_link: redirectLink(), payload: req.payload });
      });
    });
  }
  /** Back from Phantom: the reply is in the query string, the step in storage. Returns null when this load is not a return. */
  function handoffReturn() {
    var q = new URLSearchParams(location.search);
    var h = readHandoff();
    var isReply = q.has('errorCode') || (q.has('nonce') && q.has('data'));
    if (!isReply) return null;
    history.replaceState(null, '', location.pathname + (location.hash || ''));
    if (!h) return { step: 'expired' };
    if (q.has('errorCode')) return { step: h.step, error: { code: q.get('errorCode'), message: q.get('errorMessage') || '' }, handoff: h };
    return { step: h.step, nonce: q.get('nonce'), data: q.get('data'), phantomKey: q.get('phantom_encryption_public_key'), handoff: h };
  }

  // ---------- API ----------
  function post(path, payload) {
    return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (j) {
          if (!r.ok) throw Object.assign(new Error(j.detail || r.statusText), { code: j.code || 'http_' + r.status, status: r.status });
          return { status: r.status, body: j };
        });
    });
  }

  // ---------- sheet ----------
  var card = document.querySelector('[data-role="goal-card"]');
  var sheet = document.getElementById('goal-sheet');
  if (!card || !sheet || typeof sheet.showModal !== 'function') return;
  var $ = function (sel) {
    return sheet.querySelector(sel);
  };
  var amountInput = $('[data-role="amount"]');
  var presets = sheet.querySelectorAll('[data-role="preset"]');
  var rowContribution = $('[data-role="row-contribution"]');
  var rowFee = $('[data-role="row-fee"]');
  var rowTotal = $('[data-role="row-total"]');
  var payBtn = $('[data-role="pay"]');
  var status = $('[data-role="sheet-status"]');
  var receipt = $('[data-role="receipt"]');
  var fallback = $('[data-role="fallback"]');
  var form = $('[data-role="form"]');
  var done = $('[data-role="done"]');
  var opener = null;
  var amount = 5;
  var busy = false;
  /** A connect reply waiting for the sign tap (the pay button becomes "Approve in Phantom"). */
  var pendingSign = null;

  function say(text) {
    status.textContent = text || '';
  }
  // No Phantom and no handoff: keep the sheet open and show the inline help (install, open in the app, copy the address).
  function showFallback() {
    if (!fallback) return;
    var deep = fallback.querySelector('[data-role="open-in-app"]');
    if (deep) {
      deep.href = 'https://phantom.app/ul/browse/' + encodeURIComponent(location.href) + '?ref=' + encodeURIComponent(location.origin);
      deep.hidden = !isMobile;
    }
    // On a phone the install link is noise: Phantom is already installed, it just cannot reach into Chrome.
    var install = fallback.querySelector('[data-role="install"]');
    if (install) install.hidden = isMobile;
    fallback.hidden = false;
  }
  sheet.querySelectorAll('[data-role="copy-pool"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var label = btn.textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(cfg.wallet) : Promise.reject()).then(function () {
        btn.textContent = t('copied', 'Copied');
        setTimeout(function () {
          btn.textContent = label;
        }, 1600);
      }, function () {});
    });
  });
  function payLabel() {
    if (pendingSign) return t('approve', 'Approve in Phantom');
    return t('pay', 'Contribute {amount}').replace('{amount}', usd.format(amount));
  }
  function setAmount(n) {
    amount = Math.max(0, Math.round(n * 100) / 100);
    for (var i = 0; i < presets.length; i++) presets[i].setAttribute('aria-pressed', parseFloat(presets[i].getAttribute('data-amount')) === amount ? 'true' : 'false');
    rowContribution.textContent = usd.format(amount) + ' · ' + amount.toFixed(2) + ' USDC';
    rowFee.textContent = '—';
    rowTotal.textContent = usd.format(amount);
    payBtn.textContent = payLabel();
    payBtn.disabled = !(amount >= cfg.min) || busy;
    if (amount > 0 && amount < cfg.min) say(t('minAmount', 'Minimum is $1.'));
    else if (!busy) say('');
  }
  function openSheet() {
    receipt.hidden = true;
    if (fallback) fallback.hidden = true;
    if (done) done.hidden = true;
    if (form) form.hidden = false;
    bindEvents();
    setAmount(amount);
    amountInput.value = amount.toFixed(2);
    if (!sheet.open) sheet.showModal();
  }
  card.querySelectorAll('[data-role="goal-open"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      opener = btn;
      openSheet();
      amountInput.focus();
    });
  });
  sheet.querySelectorAll('[data-role="sheet-close"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      sheet.close();
    });
  });
  sheet.addEventListener('close', function () {
    if (opener) opener.focus();
  });
  for (var i = 0; i < presets.length; i++) {
    presets[i].addEventListener('click', function (ev) {
      var n = parseFloat(ev.currentTarget.getAttribute('data-amount'));
      amountInput.value = n.toFixed(2);
      setAmount(n);
    });
  }
  amountInput.addEventListener('input', function () {
    var v = parseFloat(String(amountInput.value).replace(',', '.'));
    setAmount(isFinite(v) ? v : 0);
  });

  function receiptLink(signature) {
    var a = document.createElement('a');
    a.href = cfg.explorer + '/tx/' + signature;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = t('receipt', 'Receipt') + ' · ' + signature.slice(0, 8) + '…' + signature.slice(-6);
    return a;
  }
  function showReceipt(signature) {
    receipt.hidden = false;
    receipt.innerHTML = '';
    receipt.appendChild(receiptLink(signature));
  }

  // ---------- the card: redraw the meter from fresh figures, and keep it fresh while the page is open ----------
  var num = new Intl.NumberFormat(intl);
  var target = parseFloat(card.getAttribute('data-target') || '0');
  function updateCard(f) {
    if (typeof f.raised_usd !== 'number') return;
    if (typeof f.target_usd === 'number') target = f.target_usd;
    var pct = target > 0 ? Math.min(100, Math.round((f.raised_usd / target) * 100)) : 0;
    var raisedEl = card.querySelector('[data-role="goal-raised"]');
    if (raisedEl) raisedEl.textContent = t('raised', '{raised} of {target} USDC raised').replace('{raised}', num.format(Math.round(f.raised_usd))).replace('{target}', num.format(target));
    var meter = card.querySelector('.goal-meter');
    if (meter) {
      meter.setAttribute('aria-valuenow', String(Math.round(f.raised_usd)));
      meter.setAttribute('aria-valuemax', String(target));
      if (raisedEl) meter.setAttribute('aria-label', raisedEl.textContent);
      var fill = meter.querySelector('.goal-meter-fill');
      if (fill) fill.style.width = pct + '%';
    }
    var n = card.querySelector('[data-role="goal-entries"]');
    if (n && typeof f.contributors === 'number') n.textContent = num.format(f.contributors);
    log('card', f.raised_usd, '/', target, 'contributors', f.contributors);
  }
  var lastStatus = card.getAttribute('data-round-status') || 'none';
  function refreshCard() {
    if (document.hidden) return;
    fetch('/api/v1/goal', { headers: { accept: 'application/json' } })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (s) {
        if (!s || !s.round) return;
        updateCard(s.round);
        // A freeze or a draw changes the whole card; let the server render it.
        if (s.round.status !== lastStatus) {
          log('round status changed', lastStatus, '→', s.round.status);
          if (!sheet.open && !busy) location.reload();
        }
      })
      .catch(function () {});
  }
  setInterval(refreshCard, 30000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshCard();
  });
  // Ask the site to verify the signature on chain; 202 means not confirmed yet.
  function waitConfirmed(signature, tries) {
    return post('/api/v1/goal/contributions', { signature: signature }).then(function (r) {
      if (r.status === 202) {
        if (tries <= 0) return null;
        return new Promise(function (res) {
          setTimeout(res, 1500);
        }).then(function () {
          return waitConfirmed(signature, tries - 1);
        });
      }
      return r.body;
    });
  }
  function reportResult(result, signature) {
    if (!result) say(t('unknown', 'Status unknown. Check the receipt on the explorer.'));
    else if (result.status === 'confirmed') {
      updateCard(result);
      var paid = typeof result.usdc === 'number' ? result.usdc : amount;
      var key = result.excluded ? 'operatorWallet' : result.counted ? 'youreIn' : 'youreInNext';
      var line = t(key, '{amount} USDC has reached the goal wallet.').replace('{amount}', paid.toFixed(2));
      if (done && form) {
        form.hidden = true;
        done.hidden = false;
        $('[data-role="done-line"]').textContent = line;
        var r = $('[data-role="done-receipt"]');
        r.innerHTML = '';
        r.appendChild(receiptLink(signature));
        var close = done.querySelector('[data-role="sheet-close"]');
        if (close) close.focus();
      } else say(line);
      log('confirmed', signature, key);
    } else say(t('failed', 'The transaction failed.'));
  }
  function reportError(err) {
    var code = err && err.code;
    log('error', code, err && err.message);
    if (code === 4001 || code === 'no_account' || code === 'rejected') say(t('rejected', 'The transfer was not approved.'));
    else if (code === 'no_wallet') showFallback();
    else if (code === 'insufficient') say(t('insufficient', 'Not enough USDC in this wallet.'));
    else if (code === 'no_usdc') say(t('noUsdc', 'This wallet holds no USDC on Solana.'));
    else if (code === 'no_sol') say(t('noSol', 'This wallet needs a little SOL for the network fee.'));
    else if (code === 'round_closed' || code === 'goal_not_open') say(t('closed', 'Entries are closed right now.'));
    else if (code === 'expired') say(t('expired', 'That took too long and the transfer expired. Please try again.'));
    else if (code === 'handoff') say(t('handoffFailed', 'Phantom did not answer as expected. Please try again.'));
    else if (code === 'failed') say(t('failed', 'The transaction failed.'));
    else say((err && err.message) || t('failed', 'The transaction failed.'));
  }
  function setBusy(on) {
    busy = on;
    payBtn.disabled = on || amount < cfg.min;
    payBtn.textContent = payLabel();
  }

  payBtn.addEventListener('click', function () {
    if (busy || amount < cfg.min) return;
    var p = provider();
    if (!p) {
      if (!handoffAvailable) {
        showFallback();
        say('');
        return;
      }
      setBusy(true);
      receipt.hidden = true;
      var leave = pendingSign ? signViaHandoff(pendingSign) : startHandoff();
      if (pendingSign) say(t('preparing', 'Preparing the transfer…'));
      else say(t('handoff', 'Opening Phantom…'));
      leave.catch(function (err) {
        // A server-side refusal (no USDC, RPC down…) leaves the connect session usable; a broken handoff does not.
        if (!pendingSign || (err && err.code === 'handoff')) {
          clearHandoff();
          pendingSign = null;
        } else writeHandoff(Object.assign({}, pendingSign, { step: 'connect' }));
        reportError(err);
        setBusy(false);
      });
      return;
    }
    setBusy(true);
    receipt.hidden = true;
    say(t('connect', 'Connect Phantom'));
    connect()
      .then(function (from) {
        payBtn.textContent = payLabel();
        say(t('preparing', 'Preparing the transfer…'));
        return post('/api/v1/goal/tx', { from: from, amount: amount });
      })
      .then(function (r) {
        var sol = (r.body.fee_lamports || 0) / 1e9;
        rowFee.textContent = '≈ ' + sol.toFixed(6) + ' SOL';
        rowTotal.textContent = usd.format(amount) + ' + ' + sol.toFixed(6) + ' SOL';
        say(t('awaiting', 'Awaiting approval in Phantom'));
        log('message built', r.body.source, '→', r.body.destination);
        return p.request({ method: 'signAndSendTransaction', params: { message: r.body.message } });
      })
      .then(function (res) {
        var signature = res && res.signature;
        if (!signature) throw new Error('no signature');
        log('submitted', signature);
        say(t('submitted', 'Submitted. Waiting for the network…'));
        showReceipt(signature);
        return waitConfirmed(signature, 40).then(function (result) {
          reportResult(result, signature);
        });
      })
      .catch(reportError)
      .then(function () {
        setBusy(false);
      });
  });
  setAmount(amount);

  // ---------- back from the Phantom app ----------
  var back = handoffReturn();
  if (!back) {
    // Connected earlier, then the page was reloaded before the approve tap: pick the session up instead of connecting again.
    var kept = readHandoff();
    if (kept && kept.step === 'connect' && kept.wallet && kept.session && handoffAvailable) {
      pendingSign = kept;
      account = kept.wallet;
      if (kept.amount >= cfg.min) amount = kept.amount;
      log('handoff: session restored', kept.wallet);
    }
  }
  if (back) {
    log('handoff: back', back.step, back.error || '');
    amount = back.handoff ? back.handoff.amount : amount;
    openSheet();
    if (back.step === 'expired') {
      say(t('expired', 'That took too long and the transfer expired. Please try again.'));
    } else if (back.error) {
      clearHandoff();
      reportError({ code: 'rejected', message: back.error.message });
    } else if (back.step === 'connect') {
      setBusy(true);
      loadNacl()
        .then(function (nacl) {
          var h = Object.assign({}, back.handoff, { phantomKey: back.phantomKey });
          var reply = decryptReply(nacl, h, back.nonce, back.data);
          if (!reply.public_key || !reply.session) throw Object.assign(new Error('bad connect reply'), { code: 'handoff' });
          pendingSign = Object.assign(h, { wallet: reply.public_key, session: reply.session, at: Date.now() });
          writeHandoff(pendingSign);
          account = reply.public_key;
          setBusy(false);
          say(t('connected', 'Connected as {wallet}. Tap to approve the transfer.').replace('{wallet}', reply.public_key.slice(0, 4) + '…' + reply.public_key.slice(-4)));
        })
        .catch(function (err) {
          clearHandoff();
          reportError(err);
          setBusy(false);
        });
    } else if (back.step === 'sign') {
      setBusy(true);
      say(t('submitted', 'Submitted. Waiting for the network…'));
      loadNacl()
        .then(function (nacl) {
          var reply = decryptReply(nacl, back.handoff, back.nonce, back.data);
          if (!reply.transaction) throw Object.assign(new Error('bad sign reply'), { code: 'handoff' });
          clearHandoff();
          return post('/api/v1/goal/submit', { transaction: reply.transaction });
        })
        .then(function (r) {
          var signature = r.body.signature;
          if (!signature) throw new Error('no signature');
          log('relayed', signature);
          showReceipt(signature);
          return waitConfirmed(signature, 40).then(function (result) {
            reportResult(result, signature);
          });
        })
        .catch(function (err) {
          clearHandoff();
          reportError(err);
        })
        .then(function () {
          setBusy(false);
        });
    }
  }
})();
