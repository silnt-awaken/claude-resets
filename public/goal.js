// Copy-to-clipboard for the pool address on the goal card. Everything else is server-rendered.
(function () {
  'use strict';
  var buttons = document.querySelectorAll('[data-role="copy-pool"]');
  Array.prototype.forEach.call(buttons, function (btn) {
    btn.addEventListener('click', function () {
      var value = btn.getAttribute('data-copy') || '';
      var label = btn.querySelector('[data-role="copy-label"]') || btn;
      var original = label.textContent;
      var done = function () {
        label.textContent = btn.getAttribute('data-copied') || 'Copied';
        setTimeout(function () {
          label.textContent = original;
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(done, function () {});
      else {
        var ta = document.createElement('textarea');
        ta.value = value;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          done();
        } catch (e) {
          /* ignore */
        }
        ta.remove();
      }
    });
  });
})();
