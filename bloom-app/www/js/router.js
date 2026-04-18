// ─── View Router ───
const Router = (() => {
  let currentView = null;
  let currentViewModule = null;
  let pendingDeepLink = null; // {type, id, ...payload}
  const container = () => document.getElementById('view-container');

  /**
   * Set a deep-link payload for the next view to consume on its init().
   * The view should call Router.consumeDeepLink('expectedType') early in init().
   * Cleared automatically after consumption or after the next navigation that ignores it.
   */
  function setDeepLink(payload) {
    pendingDeepLink = payload;
  }

  /** Read & clear the pending deep link if it matches `expectedType`. Returns null otherwise. */
  function consumeDeepLink(expectedType) {
    if (!pendingDeepLink) return null;
    if (expectedType && pendingDeepLink.type !== expectedType) return null;
    const payload = pendingDeepLink;
    pendingDeepLink = null;
    return payload;
  }

  const viewModules = {
    home: () => HomeView,
    calendar: () => CalendarView,
    chat: () => ChatView,
    notes: () => NotesView,
    files: () => FilesView,
    // users is no longer in the sidebar but stays routable via the header
    // avatar (top-right) — see Header.init() btn-avatar handler.
    users: () => UsersView,
    study: () => StudyView,
    stats: () => StatsView,
    settings: () => SettingsView
  };

  // Animation timings — keep in sync with #view-container CSS transitions in index.html
  const FADE_OUT_MS = 160;
  const FADE_IN_MS = 200;
  let navInProgress = false;

  async function navigate(viewName, opts = {}) {
    // Pass { force: true } to re-init the current view (useful after
    // global state changes like Google sign-in where the view needs
    // to re-fetch). Normal nav skips same-view calls.
    if (viewName === currentView && !opts.force) return;
    if (navInProgress) return; // ignore rapid clicks while a transition is in-flight
    navInProgress = true;

    const el = container();

    try {
      // ── Phase 1: fade out the OLD view (skip on first nav, when there's nothing to fade) ──
      if (currentView && el) {
        el.classList.add('view-leaving');
        await _wait(FADE_OUT_MS);
      }

      // ── Phase 2: destroy old, load new module ──
      if (currentViewModule && typeof currentViewModule.destroy === 'function') {
        currentViewModule.destroy();
      }

      const getModule = viewModules[viewName];
      if (!getModule) {
        console.error(`Unknown view: ${viewName}`);
        el?.classList.remove('view-leaving');
        return;
      }
      const module = getModule();
      if (!module) {
        console.error(`View module not loaded: ${viewName}`);
        el?.classList.remove('view-leaving');
        return;
      }

      // Render HTML for the new view (still invisible — view-leaving still applied)
      if (el && typeof module.render === 'function') {
        el.innerHTML = module.render();
        // Reset scroll position so each view starts at top
        el.scrollTop = 0;
      }

      // Update nav active state immediately so the sidebar pill moves with the fade-out
      document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewName);
      });

      // Apply translations to new content (does NOT re-touch the header H1 anymore)
      I18n.setLang(I18n.getLang());

      // ── Phase 3: fade the new content in.
      // Drop the leaving class — the CSS opacity transition takes us 0 → 1.
      // (No transform/will-change here — those would break backdrop-filter on .glass-card descendants.)
      if (el) {
        el.classList.remove('view-leaving');
      }

      const previousView = currentView;
      currentView = viewName;
      currentViewModule = module;

      // Notify listeners (header animation, analytics) — fires while view is fading in
      document.dispatchEvent(new CustomEvent('view-changed', {
        detail: { view: viewName, previousView }
      }));

      // ── Phase 4: init in parallel with the fade-in (so heavy init doesn't block the animation) ──
      if (typeof module.init === 'function') {
        // Don't await here — let init run while user sees the fade-in. If init is slow,
        // skeleton content from render() stays visible.
        const initPromise = Promise.resolve(module.init()).catch(err => {
          console.error(`init() for view '${viewName}' failed:`, err);
        });
        // Wait for fade to finish + a tiny buffer so we know transition is done
        await _wait(FADE_IN_MS);
        // Then await init so any callers know the view is fully ready
        await initPromise;
      } else {
        await _wait(FADE_IN_MS);
      }

      // Drop any unconsumed deep link so it doesn't fire on a future unrelated nav
      pendingDeepLink = null;
    } finally {
      navInProgress = false;
    }
  }

  function _wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function getCurrentView() {
    return currentView;
  }

  return { navigate, getCurrentView, setDeepLink, consumeDeepLink };
})();
