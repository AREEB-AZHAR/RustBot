(function() {
  try {
    var saved = localStorage.getItem('rustbot_theme');
    if (!saved) {
      saved = 'dark';
      try {
        localStorage.setItem('rustbot_theme', saved);
      } catch (e) {}
    }
    document.documentElement.setAttribute('data-theme', saved);
  } catch (e) {}
})();
