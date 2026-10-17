// Optional, private browser planner. No network requests or account access.
(function () {
  'use strict';
  var form = document.getElementById('reset-planner');
  if (!form) return;
  var session = document.getElementById('session-reset');
  var weekly = document.getElementById('weekly-reset');
  var remember = document.getElementById('remember-reset');
  var result = document.getElementById('planner-result');
  var key = 'claude-resets:planner:v1';
  var active = false;
  var messages = JSON.parse(document.getElementById('planner-i18n').textContent);
  var locale = document.documentElement.lang || 'en';
  function text(key, values) { return messages[key].replace(/\{(\w+)\}/g, function (match, name) { return values && values[name] !== undefined ? values[name] : match; }); }
  var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  document.getElementById('planner-zone').textContent = text('zone', { zone: zone });
  function store() {
    try { if (remember.checked) localStorage.setItem(key, JSON.stringify({ session: session.value, weekly: weekly.value })); else localStorage.removeItem(key); } catch (_) { /* Planner still works when storage is unavailable. */ }
  }
  function render() {
    var entries = [{ label: 'Session', value: session.value }, { label: 'Weekly / model', value: weekly.value }].filter(function (x) { return x.value; });
    if (!entries.length) { result.textContent = text('empty'); return; }
    var instants = entries.map(function (x) { return new Date(x.value).getTime(); });
    if (instants.some(function (x) { return !Number.isFinite(x); })) { result.textContent = text('invalid'); return; }
    var ready = Math.max.apply(Math, instants);
    var minutes = Math.ceil((ready - Date.now()) / 60000);
    var time = new Date(ready).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
    result.textContent = minutes <= 0 ? text('passed') : text('wait', { days: Math.floor(minutes / 1440), hours: Math.floor(minutes % 1440 / 60), minutes: minutes % 60, time: time, zone: zone }) + ' ' + text(entries.length === 2 ? 'later' : 'single');
  }
  try { var saved = JSON.parse(localStorage.getItem(key) || 'null'); if (saved && typeof saved.session === 'string' && typeof saved.weekly === 'string') { session.value = saved.session; weekly.value = saved.weekly; remember.checked = true; active = true; render(); } } catch (_) { /* No stored times. */ }
  form.addEventListener('submit', function (e) { e.preventDefault(); active = true; store(); render(); });
  form.addEventListener('input', function () { if (active) render(); store(); });
  document.getElementById('clear-planner').addEventListener('click', function () { session.value = ''; weekly.value = ''; remember.checked = false; active = false; store(); render(); });
  setInterval(function () { if (active) render(); }, 30000);
}());
