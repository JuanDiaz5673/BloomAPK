// ─── Sidebar Component ───
const Sidebar = (() => {
  function init() {
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.dataset.view;
        if (view) Router.navigate(view);
      });
    });

    // Ambient Bloom chat panel lives inside the sidebar — init it here
    // so it's ready before the user clicks around.
    if (typeof BloomPanel !== 'undefined') BloomPanel.init();
  }

  return { init };
})();
