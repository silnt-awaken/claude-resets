// Claude Resets client enhancements. Everything important renders server-side; this file
// only adds convenience: theme toggle, live ages, local times, calendar details, archive
// expansion, the beg reaction, browser push, and the sponsorship dialog.
(function () {
  'use strict';
  var $ = function (sel, root) {
    return (root || document).querySelector(sel);
  };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };
  var body = document.body;
  var locale = body.getAttribute('data-locale') || 'en';
  var intl = { en: 'en-US', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', ja: 'ja-JP', ko: 'ko-KR' }[locale] || 'en-US';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var strings = {};
  try {
    var el = $('#client-i18n');
    if (el) strings = JSON.parse(el.textContent || '{}');
  } catch (e) {
    strings = {};
  }
  function s(path, fallback) {
    var parts = path.split('.');
    var cur = strings;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return fallback;
      cur = cur[parts[i]];
    }
    return cur == null ? fallback : cur;
  }
  function fmt(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, function (m, k) {
      return k in vars ? vars[k] : m;
    });
  }
  function log() {
    if (window.console && window.localStorage && window.localStorage.getItem('claude-resets-debug') === '1') console.log.apply(console, ['[claude-resets]'].concat(Array.prototype.slice.call(arguments)));
  }

  // ---------- theme ----------
  var themeApi = window.__claudeResetsTheme;
  $$('[data-role="theme-toggle"]').forEach(function (btn) {
    function sync() {
      var dark = themeApi ? themeApi.get() === 'dark' : document.documentElement.getAttribute('data-theme') === 'dark';
      btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
      var label = dark ? btn.getAttribute('data-label-light') : btn.getAttribute('data-label-dark');
      if (label) {
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
      }
    }
    btn.addEventListener('click', function () {
      if (!themeApi) return;
      themeApi.set(themeApi.get() === 'dark' ? 'light' : 'dark');
      sync();
    });
    sync();
  });

  // ---------- language menu ----------
  (function () {
    var toggle = $('[data-role="lang-toggle"]');
    var menu = $('#language-menu');
    if (!toggle || !menu) return;
    function setOpen(open) {
      menu.setAttribute('data-open', open ? 'true' : 'false');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        var first = menu.querySelector('a');
        if (first) first.focus();
      }
    }
    toggle.addEventListener('click', function () {
      setOpen(menu.getAttribute('data-open') !== 'true');
    });
    document.addEventListener('click', function (ev) {
      if (!menu.contains(ev.target) && ev.target !== toggle && !toggle.contains(ev.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && menu.getAttribute('data-open') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });
  })();

  // ---------- times ----------
  var rtf = window.Intl && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(intl, { numeric: 'always' }) : null;
  function relative(ms) {
    var sec = Math.max(0, Math.floor(ms / 1000));
    if (!rtf) return '';
    if (sec < 60) return rtf.format(-sec, 'second');
    var m = Math.floor(sec / 60);
    if (m < 60) return rtf.format(-m, 'minute');
    var h = Math.floor(m / 60);
    if (h < 24) return rtf.format(-h, 'hour');
    var d = Math.floor(h / 24);
    if (d < 7) return rtf.format(-d, 'day');
    if (d < 30) return rtf.format(-Math.floor(d / 7), 'week');
    if (d < 365) return rtf.format(-Math.floor(d / 30), 'month');
    return rtf.format(-Math.floor(d / 365), 'year');
  }
  function updateRelative() {
    var now = Date.now();
    $$('[data-role="relative-time"][data-datetime]').forEach(function (el) {
      var t = Date.parse(el.getAttribute('data-datetime'));
      if (!isFinite(t)) return;
      var text = relative(now - t);
      if (text && el.textContent !== text) el.textContent = text;
    });
  }
  updateRelative();
  setInterval(updateRelative, 30000);

  (function localTimes() {
    var fmtLocal;
    try {
      fmtLocal = new Intl.DateTimeFormat(intl, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    } catch (e) {
      return;
    }
    $$('[data-role="absolute-time"][data-datetime]').forEach(function (el) {
      var t = Date.parse(el.getAttribute('data-datetime'));
      if (!isFinite(t)) return;
      var utc = el.getAttribute('title') || el.textContent;
      el.setAttribute('title', utc);
      el.textContent = fmtLocal.format(new Date(t));
    });
  })();

  // ---------- archive ----------
  (function () {
    var toggle = $('[data-role="log-toggle"]');
    var extra = $('[data-role="log-extra"]');
    if (!toggle || !extra) return;
    var label = $('[data-role="log-toggle-label"]', toggle) || toggle;
    var key = 'claude-resets-archive-open';
    function setOpen(open, focus) {
      extra.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      label.textContent = open ? toggle.getAttribute('data-hide') : toggle.getAttribute('data-show');
      try {
        window.localStorage.setItem(key, open ? '1' : '0');
      } catch (e) {
        /* ignore */
      }
      if (focus && open) {
        var first = extra.querySelector('a, button');
        if (first) first.focus();
      }
    }
    toggle.addEventListener('click', function () {
      setOpen(extra.hidden, true);
    });
    var wantOpen = false;
    try {
      wantOpen = window.localStorage.getItem(key) === '1';
    } catch (e) {
      /* ignore */
    }
    if (location.hash && extra.querySelector(location.hash.replace(/[^#\w-]/g, ''))) wantOpen = true;
    if (wantOpen) setOpen(true, false);
  })();

  $$('[data-role="read-more"]').forEach(function (btn) {
    var text = btn.previousElementSibling;
    if (!text) return;
    // Progressive enhancement: the server sends the full text; clamp it now that we can expand it again.
    text.classList.add('is-clamped');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = btn.getAttribute('data-more');
    btn.hidden = false;
    btn.addEventListener('click', function () {
      var expanded = btn.getAttribute('aria-expanded') === 'true';
      text.classList.toggle('is-clamped', expanded);
      btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      btn.textContent = expanded ? btn.getAttribute('data-more') : btn.getAttribute('data-less');
    });
  });

  // ---------- calendar ----------
  (function () {
    var scroll = $('[data-role="cg-scroll"]');
    var details = $('[data-role="cg-details"]');
    var dataEl = $('[data-role="cg-data"]');
    if (scroll) scroll.scrollLeft = scroll.scrollWidth; // newest columns first
    if (!details || !dataEl) return;
    var data = {};
    try {
      data = JSON.parse(dataEl.textContent || '{}');
    } catch (e) {
      data = {};
    }
    var cells = $$('[data-role="cg-cell"]');
    var current = null;
    var dateFmt = new Intl.DateTimeFormat(intl, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
    function close() {
      details.hidden = true;
      details.innerHTML = '';
      if (current) current.setAttribute('aria-expanded', 'false');
      current = null;
    }
    function open(cell) {
      var date = cell.getAttribute('data-date');
      var list = data[date] || [];
      if (current) current.setAttribute('aria-expanded', 'false');
      current = cell;
      cell.setAttribute('aria-expanded', 'true');
      var h = document.createElement('div');
      var strong = document.createElement('strong');
      strong.textContent = fmt(s('calendar.detailsFor', 'Resets on {date}'), { date: dateFmt.format(new Date(date + 'T00:00:00Z')) });
      h.appendChild(strong);
      var ul = document.createElement('ul');
      list.forEach(function (item) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = item.url;
        a.textContent = item.title;
        li.appendChild(a);
        if (item.source) li.appendChild(document.createTextNode(' · ' + item.source));
        ul.appendChild(li);
      });
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'link-btn';
      closeBtn.textContent = s('calendar.close', 'Close');
      closeBtn.style.marginTop = '8px';
      closeBtn.addEventListener('click', function () {
        close();
        cell.focus();
      });
      details.innerHTML = '';
      details.appendChild(h);
      details.appendChild(ul);
      details.appendChild(closeBtn);
      details.hidden = false;
    }
    cells.forEach(function (cell, i) {
      cell.setAttribute('role', 'button');
      cell.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (current === cell) close();
        else open(cell);
      });
      cell.addEventListener('keydown', function (ev) {
        var next = null;
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = cells[i + 1];
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = cells[i - 1];
        if (ev.key === 'Home') next = cells[0];
        if (ev.key === 'End') next = cells[cells.length - 1];
        if (next) {
          ev.preventDefault();
          next.focus();
        }
        if (ev.key === 'Escape' && current) {
          close();
          cell.focus();
        }
      });
    });
  })();

  // ---------- filters ----------
  (function () {
    var form = $('[data-role="filters"]');
    if (!form) return;
    var apply = $('[data-role="filter-apply"]', form);
    if (apply) apply.hidden = true;
    $$('select', form).forEach(function (sel) {
      sel.addEventListener('change', function () {
        // Keep the URL clean: drop default values before submitting.
        $$('select', form).forEach(function (x) {
          x.disabled = (x.name === 'audience' && x.value === 'all') || (x.name === 'window' && x.value === 'any');
        });
        form.submit();
      });
    });
  })();

  // ---------- hints ----------
  var hint = $('[data-role="action-hint"]');
  function showHint(text) {
    if (!hint) return;
    hint.textContent = text;
    hint.hidden = !text;
  }

  var telegramUnavailable = $('[data-role="telegram-unavailable"]');
  if (telegramUnavailable)
    telegramUnavailable.addEventListener('click', function () {
      showHint(s('telegram.unavailable', 'A Telegram channel is not set up yet.'));
    });

  // ---------- beg ----------
  (function () {
    var btn = $('[data-role="beg"]');
    var countEl = $('[data-role="beg-count"]');
    var status = $('[data-role="beg-status"]');
    if (!btn || !countEl) return;
    var nf = new Intl.NumberFormat(intl);
    var current = null;
    function setCount(n) {
      if (typeof n !== 'number') return;
      current = n;
      countEl.textContent = nf.format(n);
      countEl.setAttribute('aria-label', fmt(s('beg.count', '{count} reactions'), { count: n }));
    }
    function say(text) {
      if (status) status.textContent = text;
    }
    fetch('/api/v1/reactions', { credentials: 'same-origin' })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        if (j && typeof j.count === 'number') setCount(j.count);
      })
      .catch(function () {
        /* keep the server-rendered count */
      });
    btn.addEventListener('click', function () {
      var before = current;
      btn.disabled = true;
      if (typeof before === 'number') setCount(before + 1);
      if (!reduceMotion) {
        var burst = document.createElement('span');
        burst.className = 'beg-burst';
        burst.setAttribute('aria-hidden', 'true');
        burst.textContent = '🙏';
        btn.parentNode.appendChild(burst);
        setTimeout(function () {
          burst.remove();
        }, 900);
      }
      fetch('/api/v1/reactions/beg', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then(function (r) {
          return r.json().then(function (j) {
            return { status: r.status, body: j };
          });
        })
        .then(function (res) {
          if (res.status === 200 && res.body && typeof res.body.count === 'number') {
            setCount(res.body.count);
            say(s('beg.counted', 'Counted!'));
          } else if (res.status === 429) {
            if (res.body && typeof res.body.count === 'number') setCount(res.body.count);
            else if (typeof before === 'number') setCount(before);
            say(s('beg.cooldown', 'You already begged recently.'));
            showHint(s('beg.cooldown', 'You already begged recently.'));
          } else {
            if (typeof before === 'number') setCount(before);
            say(s('beg.unavailable', 'Reactions are unavailable right now.'));
            showHint(s('beg.unavailable', 'Reactions are unavailable right now.'));
          }
        })
        .catch(function () {
          if (typeof before === 'number') setCount(before);
          say(s('beg.unavailable', 'Reactions are unavailable right now.'));
          showHint(s('beg.unavailable', 'Reactions are unavailable right now.'));
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  })();

  // ---------- browser push ----------
  (function () {
    var btn = $('[data-role="push-toggle"]');
    if (!btn) return;
    var enabled = body.getAttribute('data-push-enabled') === 'true';
    var key = body.getAttribute('data-push-key') || '';
    var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) && !window.MSStream;
    var standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    var busy = false;

    function setState(state) {
      btn.setAttribute('data-push-state', state);
      btn.setAttribute('aria-pressed', state === 'subscribed' ? 'true' : 'false');
    }
    function urlBase64ToUint8Array(base64) {
      var padding = '='.repeat((4 - (base64.length % 4)) % 4);
      var b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
      var raw = atob(b64);
      var out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    }
    function api(method, path, payload) {
      return fetch(path, { method: method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined });
    }
    function registration() {
      return navigator.serviceWorker.register('/sw.js').then(function () {
        return navigator.serviceWorker.ready;
      });
    }
    function reconcile() {
      if (!enabled || !supported) return;
      registration()
        .then(function (reg) {
          return reg.pushManager.getSubscription();
        })
        .then(function (sub) {
          if (!sub) {
            var granted = Notification.permission === 'granted';
            setState(granted ? 'granted' : 'idle');
            if (granted) btn.setAttribute('title', s('push.granted', btn.getAttribute('title')));
            return;
          }
          return api('POST', '/api/v1/push/subscriptions/check', { endpoint: sub.endpoint })
            .then(function (r) {
              return r.ok ? r.json() : { active: false };
            })
            .then(function (j) {
              if (j.active) setState('subscribed');
              else {
                // The browser still holds a subscription the server no longer knows: re-register it.
                return api('POST', '/api/v1/push/subscriptions', { subscription: sub.toJSON(), locale: locale }).then(function (r) {
                  if (r.ok) setState('subscribed');
                  else {
                    setState('revoked');
                    showHint(s('push.revoked', 'This browser’s subscription expired. Turn alerts on again to resubscribe.'));
                  }
                });
              }
            });
        })
        .catch(function (err) {
          log('push reconcile failed', err);
          setState('idle');
        });
    }
    function subscribe() {
      return registration().then(function (reg) {
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }).then(function (sub) {
          return api('POST', '/api/v1/push/subscriptions', { subscription: sub.toJSON(), locale: locale }).then(function (r) {
            if (!r.ok) throw new Error('server rejected subscription: ' + r.status);
            setState('subscribed');
            showHint(s('push.subscribed', 'Browser alerts are on.'));
          });
        });
      });
    }
    function unsubscribe() {
      return registration().then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          if (!sub) {
            setState('idle');
            return;
          }
          return api('DELETE', '/api/v1/push/subscriptions', { endpoint: sub.endpoint })
            .catch(function () {})
            .then(function () {
              return sub.unsubscribe();
            })
            .then(function () {
              setState(Notification.permission === 'granted' ? 'granted' : 'idle');
              showHint(s('push.unsubscribed', 'Browser alerts are off.'));
            });
        });
      });
    }
    btn.addEventListener('click', function () {
      if (busy) return;
      if (!enabled) return showHint(s('push.unavailable', 'Browser alerts are not available yet.'));
      if (!supported) return showHint(isIOS && !standalone ? s('push.install', '') : s('push.unsupported', 'This browser does not support push notifications.'));
      var state = btn.getAttribute('data-push-state') || 'idle';
      busy = true;
      showHint(s('push.working', 'Working…'));
      var p;
      if (state === 'subscribed') p = unsubscribe();
      else if (Notification.permission === 'denied') {
        p = Promise.resolve();
        showHint(s('push.denied', 'Notifications are blocked.'));
      } else {
        p = Notification.requestPermission().then(function (perm) {
          if (perm !== 'granted') {
            showHint(perm === 'denied' ? s('push.denied', 'Notifications are blocked.') : s('push.prompt', 'Allow notifications to get pinged.'));
            return;
          }
          return subscribe();
        });
      }
      p.catch(function (err) {
        log('push error', err);
        showHint(s('push.error', 'Could not update browser alerts.'));
      }).then(function () {
        busy = false;
      });
    });
    reconcile();
  })();

  // ---------- sponsor dialog ----------
  (function () {
    var dialog = $('#sponsor-dialog');
    if (!dialog || typeof dialog.showModal !== 'function') return;
    var opener = null;
    $$('[data-role="sponsor-open"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        opener = btn;
        dialog.showModal();
      });
    });
    $$('[data-role="sponsor-close"]', dialog).forEach(function (btn) {
      btn.addEventListener('click', function () {
        dialog.close();
      });
    });
    dialog.addEventListener('close', function () {
      if (opener) opener.focus();
    });
    dialog.addEventListener('click', function (ev) {
      if (ev.target === dialog) dialog.close();
    });
  })();
})();
