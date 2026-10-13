(() => {
  try {
    const stored = localStorage.getItem('airfryer_theme');
    const preference = ['light', 'dark'].includes(stored) ? stored : 'system';
    const theme = preference === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch { /* System fallback remains readable without storage. */ }
})();
