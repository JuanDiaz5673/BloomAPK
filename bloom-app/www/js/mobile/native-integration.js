// ─── Native-integration glue for Android ───────────────────────────
//
// Three things that don't belong in the renderer's view code:
//
// 1. Hardware back button
//    - Close open overlays first (modals, the Bloom sheet, search
//      modal). Each view that cares registers a handler via
//      NativeIntegration.pushBack(handler) and cleans up on destroy.
//    - Else pop the Router history.
//    - Else, if already at home, exit the app.
//
// 2. StatusBar tint
//    - Desktop's theme-engine picks 30+ CSS variables from a wallpaper.
//      We mirror `--accent-primary-rgb` into the Android status bar so
//      a light theme doesn't leave the status bar unreadable against
//      the app.
//
// 3. POST_NOTIFICATIONS runtime permission (Android 13+)
//    - Request once at startup so Pomodoro alerts actually fire.
//      If the user declines, we silently skip future schedule() calls.
//
// All three degrade gracefully when the Capacitor plugins aren't
// available (desktop-browser preview).

const NativeIntegration = (() => {
  const _backStack = []; // LIFO of handlers; last-pushed runs first

  function pushBack(handler) {
    if (typeof handler !== 'function') return () => {};
    _backStack.push(handler);
    return () => {
      const i = _backStack.lastIndexOf(handler);
      if (i >= 0) _backStack.splice(i, 1);
    };
  }

  function _handleBack({ canGoBack }) {
    // 1) Any overlay first.
    while (_backStack.length) {
      const h = _backStack.pop();
      try { if (h() !== false) return; } catch (err) { console.warn('[back] handler threw:', err); }
    }
    // 2) If the Bloom sheet is open, close it.
    if (typeof BloomSheet !== 'undefined' && document.body.classList.contains('bloom-sheet-open')) {
      try { BloomSheet.close(); return; } catch { /* ignore */ }
    }
    // 3) Router history.
    if (typeof Router !== 'undefined' && Router.getCurrentView && Router.getCurrentView() !== 'home') {
      Router.navigate('home');
      return;
    }
    // 4) At home → exit.
    if (window.Capacitor?.Plugins?.App) {
      window.Capacitor.Plugins.App.exitApp();
    }
  }

  async function _initBackButton() {
    const App = window.Capacitor?.Plugins?.App;
    if (!App?.addListener) return;
    try {
      App.addListener('backButton', _handleBack);
    } catch (err) {
      console.warn('[native] backButton wire failed:', err);
    }
  }

  async function _initStatusBar() {
    const SB = window.Capacitor?.Plugins?.StatusBar;
    if (!SB) return;

    const applyFromAccent = () => {
      // Read `--accent-primary-rgb` (format "R, G, B") from :root and
      // derive a slightly darker tint so the status bar reads as a
      // chrome surface rather than mixing with content.
      try {
        const rgb = getComputedStyle(document.documentElement)
          .getPropertyValue('--accent-primary-rgb').trim();
        if (!rgb) return;
        const [r, g, b] = rgb.split(',').map(n => parseInt(n, 10));
        if ([r, g, b].some(n => Number.isNaN(n))) return;
        // Blend toward black 25% for chrome feel.
        const dark = [r, g, b].map(n => Math.round(n * 0.25));
        const hex = '#' + dark.map(n => n.toString(16).padStart(2, '0')).join('');
        SB.setBackgroundColor({ color: hex }).catch(() => {});
        // Pick readable content style — dark chrome ⇒ light text.
        SB.setStyle({ style: 'DARK' }).catch(() => {});
      } catch { /* ignore */ }
    };

    applyFromAccent();
    // Theme engine re-applies CSS vars after every theme change.
    // We don't have a dedicated event, so observe the <html> style.
    try {
      const mo = new MutationObserver(applyFromAccent);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    } catch { /* ignore */ }
  }

  async function _initNotificationsPermission() {
    // Delegates to pomo-notify so we share a single permission path.
    try { await window._bloomPomo?.ensurePermission(); } catch { /* ignore */ }
  }

  function _isMobile() {
    return !!window.Capacitor?.isNativePlatform?.();
  }

  function init() {
    if (!_isMobile()) return;
    _initBackButton();
    _initStatusBar();
    // Intentionally NOT auto-prompting for notifications at startup —
    // we ask only when the user first interacts with Pomodoro. A
    // cold-boot permission dialog feels unwelcoming.
  }

  return { init, pushBack };
})();
