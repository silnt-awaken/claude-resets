// Applies the saved theme before first paint. Default is light when no preference is stored.
(function () {
  var KEY = 'claude-resets-theme';
  var theme = 'light';
  try {
    var saved = window.localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') theme = saved;
  } catch (e) {
    /* storage unavailable: stay light */
  }
  var root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
  window.__claudeResetsTheme = {
    key: KEY,
    get: function () {
      return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    },
    set: function (next) {
      var value = next === 'dark' ? 'dark' : 'light';
      root.setAttribute('data-theme', value);
      root.style.colorScheme = value;
      try {
        window.localStorage.setItem(KEY, value);
      } catch (e) {
        /* ignore */
      }
      var metas = document.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', value === 'dark' ? '#17130f' : '#fff4dd');
    },
  };
})();
