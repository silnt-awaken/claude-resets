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
  var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  document.getElementById('planner-zone').textContent = 'Your device time zone: ' + zone + '. Enter the times shown by Claude in this zone.';
  function store() {
    try { if (remember.checked) localStorage.setItem(key, JSON.stringify({ session: session.value, weekly: weekly.value })); else localStorage.removeItem(key); } catch (_) { /* Planner still works when storage is unavailable. */ }
  }
  function render() {
    var entries = [{ label: 'Session', value: session.value }, { label: 'Weekly / model', value: weekly.value }].filter(function (x) { return x.value; });
    if (!entries.length) { result.textContent = 'Enter at least one time to calculate a wait.'; return; }
    var instants = entries.map(function (x) { return new Date(x.value).getTime(); });
    if (instants.some(function (x) { return !Number.isFinite(x); })) { result.textContent = 'Check the dates and times and try again.'; return; }
    var ready = Math.max.apply(Math, instants);
    var minutes = Math.ceil((ready - Date.now()) / 60000);
    var time = new Date(ready).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    result.textContent = minutes <= 0 ? 'The entered reset times have passed. Recheck Claude for your actual available usage.' : 'Wait ' + Math.floor(minutes / 1440) + 'd ' + Math.floor(minutes % 1440 / 60) + 'h ' + minutes % 60 + 'm — ' + time + ' (' + zone + '). ' + (entries.length === 2 ? 'This is the later of the two times you entered.' : 'Only the entered limit is included; check any other limits in Claude.');
  }
  try { var saved = JSON.parse(localStorage.getItem(key) || 'null'); if (saved && typeof saved.session === 'string' && typeof saved.weekly === 'string') { session.value = saved.session; weekly.value = saved.weekly; remember.checked = true; active = true; render(); } } catch (_) { /* No stored times. */ }
  form.addEventListener('submit', function (e) { e.preventDefault(); active = true; store(); render(); });
  form.addEventListener('input', function () { if (active) render(); store(); });
  document.getElementById('clear-planner').addEventListener('click', function () { session.value = ''; weekly.value = ''; remember.checked = false; active = false; store(); render(); });
  setInterval(function () { if (active) render(); }, 30000);
}());
