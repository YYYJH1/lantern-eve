// Reads ?theme=light|dark and ?lang=en|zh from the address and puts them on <html>.
// The build script waits for window.__ready before it takes the picture: the page has loaded,
// its fonts are in, and so is everything a figure lists in window.__needs (a list of promises).
// Open a figure in a browser with the same query string to preview it.
(() => {
  const query = new URLSearchParams(window.location.search);
  const pick = (name, allowed, fallback) => (allowed.includes(query.get(name)) ? query.get(name) : fallback);
  const root = document.documentElement;
  root.dataset.theme = pick('theme', ['light', 'dark'], 'light');
  root.dataset.lang = pick('lang', ['en', 'zh'], 'en');
  root.lang = root.dataset.lang === 'zh' ? 'zh-CN' : 'en';
  window.__ready = false;
  window.addEventListener('load', () => {
    Promise.all([document.fonts.ready, ...(window.__needs ?? [])]).then(() => {
      window.__ready = true;
    });
  });
})();
