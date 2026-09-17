// "Try it" buttons on the API docs page. Requests only go to this origin.
(function () {
  'use strict';
  var panels = document.querySelectorAll('[data-role="try"]');
  Array.prototype.forEach.call(panels, function (panel) {
    var input = panel.querySelector('[data-role="try-path"]');
    var run = panel.querySelector('[data-role="try-run"]');
    var status = panel.querySelector('[data-role="try-status"]');
    var result = panel.nextElementSibling;
    if (!input || !run || !result) return;
    run.addEventListener('click', function () {
      var path = String(input.value || '').trim();
      if (path.indexOf('/api/') !== 0) {
        status.textContent = 'Only /api/... paths on this site can be tried here.';
        return;
      }
      status.textContent = 'Loading…';
      var started = Date.now();
      fetch(path, { headers: { accept: 'application/json' } })
        .then(function (r) {
          return r.text().then(function (text) {
            var pretty = text;
            try {
              pretty = JSON.stringify(JSON.parse(text), null, 2);
            } catch (e) {
              /* leave as-is */
            }
            status.textContent = 'HTTP ' + r.status + ' · ' + (Date.now() - started) + ' ms · ETag ' + (r.headers.get('etag') || '—');
            result.textContent = pretty;
            result.hidden = false;
          });
        })
        .catch(function (err) {
          status.textContent = 'Request failed: ' + (err && err.message ? err.message : err);
        });
    });
  });
})();
