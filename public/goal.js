// Free-entry form for the community goal. Works without JavaScript (plain POST); this just
// keeps the visitor on the page and shows the result inline.
(function () {
  'use strict';
  var forms = document.querySelectorAll('[data-role="goal-entry"]');
  Array.prototype.forEach.call(forms, function (form) {
    var input = form.querySelector('input[name="identity"]');
    var status = form.querySelector('[data-role="goal-entry-status"]');
    var button = form.querySelector('button');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!input.value.trim()) return;
      button.disabled = true;
      status.textContent = '…';
      fetch('/api/v1/goal/entries', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: input.value.trim() }) })
        .then(function (r) {
          return r.json().then(function (j) {
            return { status: r.status, body: j };
          });
        })
        .then(function (res) {
          if (res.status === 201 || res.status === 200) {
            status.textContent = (res.body.created ? '✓ ' : '') + (form.getAttribute('data-entered') || 'You are in.') + ' (' + res.body.entry + ')';
            var count = document.querySelector('[data-role="goal-entries"]');
            if (count && typeof res.body.entries === 'number') count.textContent = res.body.entries;
          } else {
            status.textContent = (res.body && res.body.detail) || 'Could not enter right now.';
          }
        })
        .catch(function () {
          status.textContent = 'Could not enter right now.';
        })
        .then(function () {
          button.disabled = false;
        });
    });
  });
})();
