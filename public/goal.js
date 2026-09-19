// The contribution sheet for the community goal: amount → review → Phantom approval → submitted → confirmed.
// The server builds the USDC transfer (POST /api/v1/goal/tx), Phantom signs and sends it, and the server
// verifies the signature on chain (POST /api/v1/goal/contributions). Nothing here holds keys or talks to
// any origin but this site. Phantom only: window.phantom.solana (browser extension or the Phantom app's browser).
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

  // ---------- Phantom ----------
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
  var opener = null;
  var amount = 5;
  var busy = false;

  function say(text) {
    status.textContent = text || '';
  }
  // No Phantom: keep the sheet open and show the inline help (install, open in the app, copy the address).
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
    var pay = t('pay', 'Contribute {amount}').replace('{amount}', usd.format(amount));
    return account ? pay : t('connect', 'Connect Phantom') + ' · ' + pay;
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
  card.querySelectorAll('[data-role="goal-open"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      opener = btn;
      receipt.hidden = true;
      if (fallback) fallback.hidden = true;
      bindEvents();
      setAmount(amount);
      amountInput.value = amount.toFixed(2);
      sheet.showModal();
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

  function showReceipt(signature) {
    receipt.hidden = false;
    receipt.innerHTML = '';
    var a = document.createElement('a');
    a.href = cfg.explorer + '/tx/' + signature;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = t('receipt', 'Receipt') + ' · ' + signature.slice(0, 8) + '…' + signature.slice(-6);
    receipt.appendChild(a);
  }
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

  payBtn.addEventListener('click', function () {
    if (busy || amount < cfg.min) return;
    var p = provider();
    if (!p) {
      showFallback();
      say('');
      return;
    }
    busy = true;
    payBtn.disabled = true;
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
        return waitConfirmed(signature, 40);
      })
      .then(function (result) {
        if (!result) say(t('unknown', 'Status unknown. Check the receipt on the explorer.'));
        else if (result.status === 'confirmed') {
          say((result.counted ? t('confirmed', 'Confirmed. You are in this round.') : t('nextRound', 'Confirmed. You are in the next round.')) + ' ' + t('updatesSoon', ''));
          var n = document.querySelector('[data-role="goal-entries"]');
          if (n && typeof result.contributors === 'number') n.textContent = String(result.contributors);
        } else say(t('failed', 'The transaction failed.'));
      })
      .catch(function (err) {
        var code = err && err.code;
        log('error', code, err && err.message);
        if (code === 4001 || code === 'no_account') say(t('rejected', 'The transfer was not approved.'));
        else if (code === 'no_wallet') showFallback();
        else if (code === 'insufficient') say(t('insufficient', 'Not enough USDC in this wallet.'));
        else if (code === 'no_usdc') say(t('noUsdc', 'This wallet holds no USDC on Solana.'));
        else if (code === 'no_sol') say(t('noSol', 'This wallet needs a little SOL for the network fee.'));
        else if (code === 'round_closed' || code === 'goal_not_open') say(t('closed', 'Entries are closed right now.'));
        else if (code === 'failed') say(t('failed', 'The transaction failed.'));
        else say((err && err.message) || t('failed', 'The transaction failed.'));
      })
      .then(function () {
        busy = false;
        payBtn.disabled = amount < cfg.min;
        payBtn.textContent = payLabel();
      });
  });
  setAmount(amount);
})();
