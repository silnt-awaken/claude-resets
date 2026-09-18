// Contribution sheet for the community goal (PerkPond-style):
// Contribute → amount → review (contribution, network fee, total) → wallet approval → submitted → confirmed.
// The wallet is only asked for when the visitor presses pay. USDC transfer to the pool via EIP-1193.
(function () {
  'use strict';
  var card = document.querySelector('[data-role="goal-card"]');
  var sheet = document.getElementById('goal-sheet');
  if (!card || !sheet || typeof sheet.showModal !== 'function') return;
  var cfg = {
    pool: card.getAttribute('data-pool') || '',
    usdc: card.getAttribute('data-usdc') || '',
    chainId: parseInt(card.getAttribute('data-chain-id') || '4663', 10),
    rpc: card.getAttribute('data-rpc') || '',
    explorer: card.getAttribute('data-explorer') || '',
    min: parseFloat(card.getAttribute('data-min') || '1'),
    locale: document.body.getAttribute('data-locale') || 'en',
  };
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
  var feeUsd = null;
  var busy = false;

  function fmtUsdc(n) {
    return n.toFixed(2) + ' USDC';
  }
  function setAmount(n) {
    amount = Math.max(0, Math.round(n * 100) / 100);
    for (var i = 0; i < presets.length; i++) presets[i].setAttribute('aria-pressed', parseFloat(presets[i].getAttribute('data-amount')) === amount ? 'true' : 'false');
    rowContribution.textContent = usd.format(amount) + ' · ' + fmtUsdc(amount);
    rowFee.textContent = feeUsd == null ? '—' : '≈ ' + usd.format(feeUsd);
    rowTotal.textContent = usd.format(amount + (feeUsd || 0));
    payBtn.textContent = t('pay', 'Contribute {amount}').replace('{amount}', usd.format(amount));
    payBtn.disabled = !(amount >= cfg.min) || busy;
    if (amount > 0 && amount < cfg.min) say(t('minAmount', 'Minimum is $1.'));
  }
  function say(text) {
    status.textContent = text || '';
  }
  function open(btn) {
    opener = btn;
    receipt.hidden = true;
    fallback.hidden = true;
    say('');
    setAmount(amount);
    sheet.showModal();
    amountInput.focus();
  }
  card.querySelectorAll('[data-role="goal-open"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      open(btn);
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
      var v = parseFloat(ev.currentTarget.getAttribute('data-amount'));
      amountInput.value = '';
      setAmount(v);
    });
  }
  amountInput.addEventListener('input', function () {
    var v = parseFloat(String(amountInput.value).replace(',', '.'));
    setAmount(isFinite(v) ? v : 0);
  });
  sheet.querySelectorAll('[data-role="copy-pool"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var label = btn.textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(cfg.pool) : Promise.reject()).then(function () {
        btn.textContent = t('copied', 'Copied');
        setTimeout(function () {
          btn.textContent = label;
        }, 1600);
      }, function () {});
    });
  });

  // ---------- chain helpers ----------
  function hex(n) {
    return '0x' + n.toString(16);
  }
  function pad(addr) {
    return addr.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  }
  function transferData(to, units) {
    return '0xa9059cbb' + pad(to) + units.toString(16).padStart(64, '0');
  }
  function rpc(method, params) {
    return fetch(cfg.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params || [] }) })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (j.error) throw new Error(j.error.message);
        return j.result;
      });
  }
  function provider() {
    return window.ethereum || null;
  }
  function ensureChain(eth) {
    return eth.request({ method: 'eth_chainId' }).then(function (id) {
      if (parseInt(id, 16) === cfg.chainId) return;
      say(t('switching', 'Switching your wallet to Robinhood Chain…'));
      return eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex(cfg.chainId) }] }).catch(function (err) {
        if (err && (err.code === 4902 || /unrecognized|not added/i.test(String(err.message)))) {
          return eth.request({
            method: 'wallet_addEthereumChain',
            params: [{ chainId: hex(cfg.chainId), chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [cfg.rpc], blockExplorerUrls: [cfg.explorer] }],
          });
        }
        throw err;
      });
    });
  }
  // Fee estimate: gas for a USDC transfer × gas price, in ETH. Shown as USD only if we can price ETH; otherwise "≈ 0.0001 ETH".
  function estimateFee(from) {
    var units = BigInt(Math.round(amount * 1e6));
    return Promise.all([rpc('eth_gasPrice'), rpc('eth_estimateGas', [{ from: from, to: cfg.usdc, data: transferData(cfg.pool, units) }]).catch(function () {
      return '0xea60';
    })]).then(function (r) {
      var wei = BigInt(r[0]) * BigInt(r[1]);
      var eth = Number(wei) / 1e18;
      rowFee.textContent = '≈ ' + eth.toFixed(6) + ' ETH';
      rowTotal.textContent = usd.format(amount) + ' + ' + eth.toFixed(6) + ' ETH';
    }).catch(function () {});
  }
  function waitReceipt(hash, tries) {
    return rpc('eth_getTransactionReceipt', [hash]).then(function (rcpt) {
      if (rcpt) return rcpt;
      if (tries <= 0) return null;
      return new Promise(function (res) {
        setTimeout(res, 1500);
      }).then(function () {
        return waitReceipt(hash, tries - 1);
      });
    });
  }

  payBtn.addEventListener('click', function () {
    if (busy || amount < cfg.min) return;
    var eth = provider();
    if (!eth) {
      fallback.hidden = false;
      say(t('noWallet', 'No wallet found.'));
      return;
    }
    busy = true;
    payBtn.disabled = true;
    receipt.hidden = true;
    say(t('connect', 'Connect wallet'));
    var from = null;
    var units = BigInt(Math.round(amount * 1e6));
    eth
      .request({ method: 'eth_requestAccounts' })
      .then(function (accounts) {
        from = accounts[0];
        return ensureChain(eth);
      })
      .then(function () {
        return rpc('eth_call', [{ to: cfg.usdc, data: '0x70a08231' + pad(from) }, 'latest']);
      })
      .then(function (bal) {
        if (BigInt(bal) < units) throw Object.assign(new Error('insufficient'), { code: 'insufficient' });
        return estimateFee(from);
      })
      .then(function () {
        say(t('awaiting', 'Awaiting wallet approval'));
        return eth.request({ method: 'eth_sendTransaction', params: [{ from: from, to: cfg.usdc, data: transferData(cfg.pool, units), value: '0x0' }] });
      })
      .then(function (hash) {
        say(t('submitted', 'Submitted. Waiting for confirmation…'));
        receipt.hidden = false;
        receipt.innerHTML = '';
        var a = document.createElement('a');
        a.href = cfg.explorer + '/tx/' + hash;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = t('receipt', 'Receipt') + ' · ' + hash.slice(0, 10) + '…';
        receipt.appendChild(a);
        return waitReceipt(hash, 40);
      })
      .then(function (rcpt) {
        if (!rcpt) say(t('unknown', 'Status unknown. Check the explorer.'));
        else if (rcpt.status === '0x1') {
          say(t('confirmed', 'Confirmed. You are in this round.') + ' ' + t('updatesSoon', ''));
          var n = document.querySelector('[data-role="goal-entries"]');
          if (n) n.textContent = String((parseInt(n.textContent, 10) || 0) + 1);
        } else say(t('failed', 'The transaction failed.'));
      })
      .catch(function (err) {
        var code = err && err.code;
        if (code === 4001 || code === 'ACTION_REJECTED') say(t('rejected', 'Payment was not submitted.'));
        else if (code === 'insufficient') say(t('insufficient', 'Not enough USDC in this wallet on Robinhood Chain.'));
        else say((err && err.message) || t('failed', 'The transaction failed.'));
      })
      .then(function () {
        busy = false;
        payBtn.disabled = amount < cfg.min;
      });
  });
  setAmount(amount);
})();
