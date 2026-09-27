(function () {
  const root = document.documentElement;
  const storageKey = 'learnora-theme';
  const saved = localStorage.getItem(storageKey);
  const initial = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', initial);

  function updateButtons(theme) {
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const dark = theme === 'dark';
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      const icon = button.querySelector('.theme-icon');
      const label = button.querySelector('.theme-label');
      if (icon) icon.textContent = dark ? '☀' : '☾';
      if (label) label.textContent = dark ? 'Light' : 'Dark';
    });
  }
  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    localStorage.setItem(storageKey, theme);
    updateButtons(theme);
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-toggle]');
    if (!button) return;
    setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
  updateButtons(initial);
})();
