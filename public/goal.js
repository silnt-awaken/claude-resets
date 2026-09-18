// Wallet connection (header button on every page) and the contribution sheet for the community goal.
// PerkPond-style: Contribute → amount → review (contribution, network fee, total) → wallet approval → submitted → confirmed.
// Works with any EIP-1193 wallet (MetaMask, Rabby, Coinbase Wallet, Brave…). Nothing here holds keys.
(function () {
  'use strict';
  var body = document.body;
  var cfg = {
    pool: body.getAttribute('data-goal-pool') || '',
    usdg: body.getAttribute('data-goal-usdg') || '',
    chainId: parseInt(body.getAttribute('data-goal-chain-id') || '4663', 10),
    rpc: body.getAttribute('data-goal-rpc') || '',
    explorer: body.getAttribute('data-goal-explorer') || '',
    min: parseFloat(body.getAttribute('data-goal-min') || '1'),
    locale: body.getAttribute('data-locale') || 'en',
  };
  // Copy buttons (launch bar CA) work on every page, even before a round is open.
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var label = btn.textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(btn.getAttribute('data-copy')) : Promise.reject()).then(function () {
        btn.textContent = btn.getAttribute('data-label-copied') || 'Copied';
        setTimeout(function () {
          btn.textContent = label;
        }, 1600);
      }, function () {});
    });
  });
  if (!cfg.pool) return;
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
  var STORE = 'claude-resets-wallet';
  var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // ---------- chain helpers ----------
  function hex(n) {
    return '0x' + n.toString(16);
  }
  function pad(addr) {
    return addr.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  }
  function short(a) {
    return a.slice(0, 6) + '…' + a.slice(-4);
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
  function ensureChain(eth, onSwitching) {
    return eth.request({ method: 'eth_chainId' }).then(function (id) {
      if (parseInt(id, 16) === cfg.chainId) return;
      if (onSwitching) onSwitching();
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

  // ---------- wallet state shared by the header button and the sheet ----------
  var wallet = { account: null, listeners: [] };
  function setAccount(a) {
    wallet.account = a ? a.toLowerCase() : null;
    try {
      if (a) window.localStorage.setItem(STORE, '1');
      else window.localStorage.removeItem(STORE);
    } catch (e) {
      /* ignore */
    }
    wallet.listeners.forEach(function (fn) {
      fn(wallet.account);
    });
  }
  function connect(interactive) {
    var eth = provider();
    if (!eth) return Promise.reject(Object.assign(new Error('no wallet'), { code: 'no_wallet' }));
    return eth.request({ method: interactive ? 'eth_requestAccounts' : 'eth_accounts' }).then(function (accounts) {
      if (!accounts || !accounts[0]) {
        if (interactive) throw Object.assign(new Error('no account'), { code: 'no_account' });
        return null;
      }
      setAccount(accounts[0]);
      return wallet.account;
    });
  }
  var remembered = false;
  try {
    remembered = window.localStorage.getItem(STORE) === '1';
  } catch (e) {
    /* ignore */
  }
  // Wallets sometimes inject after our script runs (or after a "which extension?" prompt), so retry quietly.
  function restore() {
    if (!remembered || wallet.account) return;
    var eth = provider();
    if (!eth) return;
    if (eth.on && !eth.__crBound) {
      eth.__crBound = true;
      eth.on('accountsChanged', function (accounts) {
        setAccount(accounts && accounts[0] ? accounts[0] : null);
      });
    }
    connect(false).catch(function () {});
  }
  restore();
  window.addEventListener('ethereum#initialized', restore, { once: true });
  setTimeout(restore, 1000);
  setTimeout(restore, 3000);

  // ---------- no-wallet options dialog ----------
  var optionsDialog = document.getElementById('wallet-options');
  function showOptions() {
    if (!optionsDialog || typeof optionsDialog.showModal !== 'function') return;
    var deep = optionsDialog.querySelector('[data-role="open-in-app"]');
    if (deep) {
      deep.href = 'https://metamask.app.link/dapp/' + location.host + location.pathname;
      deep.hidden = !isMobile;
    }
    optionsDialog.showModal();
  }
  if (optionsDialog) {
    optionsDialog.querySelectorAll('[data-role="sheet-close"]').forEach(function (b) {
      b.addEventListener('click', function () {
        optionsDialog.close();
      });
    });
    optionsDialog.querySelectorAll('[data-role="copy-pool"]').forEach(function (btn) {
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
  }

  // ---------- header button ----------
  var headerBtn = document.querySelector('[data-role="wallet-connect"]');
  if (headerBtn) {
    var label = headerBtn.querySelector('[data-role="wallet-label"]');
    var render = function (account) {
      if (account) {
        label.textContent = short(account);
        headerBtn.setAttribute('aria-pressed', 'true');
        headerBtn.setAttribute('title', t('walletConnected', 'Wallet connected') + ' · ' + account);
      } else {
        label.textContent = t('walletConnect', 'Connect wallet');
        headerBtn.setAttribute('aria-pressed', 'false');
        headerBtn.setAttribute('title', t('walletConnect', 'Connect wallet'));
      }
    };
    wallet.listeners.push(render);
    render(wallet.account);
    headerBtn.addEventListener('click', function () {
      if (wallet.account) {
        if (window.confirm(t('walletDisconnect', 'Disconnect') + ' ' + short(wallet.account) + '?')) setAccount(null);
        return;
      }
      if (!provider()) return showOptions();
      headerBtn.disabled = true;
      connect(true)
        .then(function () {
          return ensureChain(provider());
        })
        .catch(function () {})
        .then(function () {
          headerBtn.disabled = false;
        });
    });
  }

  // ---------- contribution sheet ----------
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
  var opener = null;
  var amount = 5;
  var busy = false;

  function say(text) {
    status.textContent = text || '';
  }
  function payLabel() {
    var pay = t('pay', 'Contribute {amount}').replace('{amount}', usd.format(amount));
    return wallet.account ? pay : t('connect', 'Connect wallet') + ' · ' + pay;
  }
  function setAmount(n) {
    amount = Math.max(0, Math.round(n * 100) / 100);
    for (var i = 0; i < presets.length; i++) presets[i].setAttribute('aria-pressed', parseFloat(presets[i].getAttribute('data-amount')) === amount ? 'true' : 'false');
    rowContribution.textContent = usd.format(amount) + ' · ' + amount.toFixed(2) + ' USDG';
    rowFee.textContent = '—';
    rowTotal.textContent = usd.format(amount);
    payBtn.textContent = payLabel();
    payBtn.disabled = !(amount >= cfg.min) || busy;
    if (amount > 0 && amount < cfg.min) say(t('minAmount', 'Minimum is $1.'));
    else if (!busy) say('');
  }
  wallet.listeners.push(function () {
    payBtn.textContent = payLabel();
  });
  card.querySelectorAll('[data-role="goal-open"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      opener = btn;
      receipt.hidden = true;
      setAmount(amount);
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
      amountInput.value = '';
      setAmount(parseFloat(ev.currentTarget.getAttribute('data-amount')));
    });
  }
  amountInput.addEventListener('input', function () {
    var v = parseFloat(String(amountInput.value).replace(',', '.'));
    setAmount(isFinite(v) ? v : 0);
  });

  function estimateFee(from, units) {
    return Promise.all([
      rpc('eth_gasPrice'),
      rpc('eth_estimateGas', [{ from: from, to: cfg.usdg, data: transferData(cfg.pool, units) }]).catch(function () {
        return '0xea60';
      }),
    ])
      .then(function (r) {
        var eth = Number(BigInt(r[0]) * BigInt(r[1])) / 1e18;
        rowFee.textContent = '≈ ' + eth.toFixed(6) + ' ETH';
        rowTotal.textContent = usd.format(amount) + ' + ' + eth.toFixed(6) + ' ETH';
      })
      .catch(function () {});
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
      sheet.close();
      return showOptions();
    }
    busy = true;
    payBtn.disabled = true;
    receipt.hidden = true;
    var units = BigInt(Math.round(amount * 1e6));
    var from = null;
    say(t('connect', 'Connect wallet'));
    connect(true)
      .then(function (account) {
        from = account;
        return ensureChain(eth, function () {
          say(t('switching', 'Switching your wallet to Robinhood Chain…'));
        });
      })
      .then(function () {
        return rpc('eth_call', [{ to: cfg.usdg, data: '0x70a08231' + pad(from) }, 'latest']);
      })
      .then(function (bal) {
        if (BigInt(bal) < units) throw Object.assign(new Error('insufficient'), { code: 'insufficient' });
        return estimateFee(from, units);
      })
      .then(function () {
        say(t('awaiting', 'Awaiting wallet approval'));
        return eth.request({ method: 'eth_sendTransaction', params: [{ from: from, to: cfg.usdg, data: transferData(cfg.pool, units), value: '0x0' }] });
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
        if (code === 4001 || code === 'ACTION_REJECTED' || code === 'no_account') say(t('rejected', 'Payment was not submitted.'));
        else if (code === 'insufficient') say(t('insufficient', 'Not enough USDG in this wallet on Robinhood Chain.'));
        else say((err && err.message) || t('failed', 'The transaction failed.'));
      })
      .then(function () {
        busy = false;
        payBtn.disabled = amount < cfg.min;
      });
  });
  setAmount(amount);
})();
