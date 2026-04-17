// ─── Bottom Nav (mobile) ────────────────────────────────────────────
//
// Mobile replacement for the left sidebar. Four tabs + a center FAB
// that lifts above the bar — the FAB opens Bloom's ambient chat
// bottom sheet (see bloom-sheet.js). Settings moves to the header
// avatar tap (same pattern as Twitter/IG), Files becomes a card
// inside Home, Chat becomes the FAB — so we surface only 4 bottom
// destinations which stays under iOS HIG / Material guidance.
//
// Binds to the existing Router — tab click calls Router.navigate(view),
// and we listen for route changes to keep the active indicator in sync.
// Only mounts on phone-sized viewports (<= 768px). On desktop it does
// nothing so the existing sidebar keeps working.

const BottomNav = (() => {
  let _el = null;
  let _currentView = 'home';

  // 4 tabs + gap for the raised FAB in the middle.
  // Order matters — left, left-center, gap, right-center, right.
  const TABS = [
    { view: 'home', label: 'Home',
      svg: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
    { view: 'study', label: 'Study',
      svg: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>' },
    { view: 'calendar', label: 'Calendar',
      svg: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
    { view: 'notes', label: 'Notes',
      svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>' },
  ];

  function _shouldMount() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  function init() {
    if (!_shouldMount()) return;
    if (_el) return; // already mounted

    _el = document.createElement('nav');
    _el.className = 'bottom-nav';
    _el.setAttribute('role', 'tablist');
    _el.setAttribute('aria-label', 'Primary navigation');

    // Left two tabs
    for (let i = 0; i < 2; i++) _el.appendChild(_renderTab(TABS[i]));

    // Gap for FAB
    const gap = document.createElement('div');
    gap.className = 'bottom-nav-center-gap';
    gap.setAttribute('aria-hidden', 'true');
    _el.appendChild(gap);

    // Right two tabs
    for (let i = 2; i < 4; i++) _el.appendChild(_renderTab(TABS[i]));

    // FAB — absolutely positioned center, lifted above nav bar
    const fab = document.createElement('button');
    fab.className = 'bottom-nav-fab';
    fab.id = 'bottom-nav-fab';
    fab.setAttribute('aria-label', 'Open Bloom chat');
    fab.innerHTML = `<img src="assets/images/bloom-avatar.png" alt="">`;
    fab.addEventListener('click', () => {
      if (typeof BloomSheet !== 'undefined') BloomSheet.toggle();
    });
    _el.appendChild(fab);

    document.body.appendChild(_el);

    // Keep active state in sync with router navigations.
    // Router dispatches its own navigate events; fall back to a MutationObserver
    // on the title if the Router API doesn't support listeners.
    if (typeof Router !== 'undefined' && typeof Router.getCurrentView === 'function') {
      _currentView = Router.getCurrentView() || 'home';
      _syncActive();
    }
    // Hook: patch Router.navigate to also update our state.
    // Non-destructive — calls the original.
    _patchRouterIfNeeded();

    // Viewport flip guard — if user rotates tablet and becomes wider
    // than the mobile breakpoint, unmount so the sidebar takes over.
    window.addEventListener('resize', _onResize);
  }

  function _renderTab(tab) {
    const btn = document.createElement('button');
    btn.className = 'bottom-nav-tab';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-label', tab.label);
    btn.dataset.view = tab.view;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24">${tab.svg}</svg>
      <span class="bottom-nav-tab-label">${tab.label}</span>`;
    btn.addEventListener('click', () => {
      if (typeof Router !== 'undefined') Router.navigate(tab.view);
      _currentView = tab.view;
      _syncActive();
    });
    return btn;
  }

  function _syncActive() {
    if (!_el) return;
    _el.querySelectorAll('.bottom-nav-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.view === _currentView);
      t.setAttribute('aria-selected', String(t.dataset.view === _currentView));
    });
  }

  // Router is a module we don't own — patch navigate() to also notify
  // us of the new active view. Keeps active-tab state honest even when
  // navigation comes from deep-links, buttons inside views, etc.
  function _patchRouterIfNeeded() {
    if (typeof Router === 'undefined' || Router._bottomNavPatched) return;
    const orig = Router.navigate;
    if (typeof orig !== 'function') return;
    Router.navigate = async function (view, ...rest) {
      const result = await orig.call(Router, view, ...rest);
      _currentView = view;
      _syncActive();
      return result;
    };
    Router._bottomNavPatched = true;
  }

  function _onResize() {
    const should = _shouldMount();
    if (should && !_el) init();
    else if (!should && _el) destroy();
  }

  function destroy() {
    if (_el) { _el.remove(); _el = null; }
    window.removeEventListener('resize', _onResize);
  }

  return { init, destroy };
})();

// Auto-init once DOM is ready. App.js also calls it explicitly after
// Router + Sidebar init so we never race initialization order.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => BottomNav.init());
} else {
  BottomNav.init();
}
