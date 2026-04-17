// ─── Header Component ───
const Header = (() => {
  // Section names shown in the header H1 when on each view (overrides greeting)
  const VIEW_TITLES = {
    home: null, // null = use dynamic greeting
    calendar: 'Calendar',
    chat: 'Bloom Chat',
    notes: 'Notes',
    files: 'Files',
    users: 'Profile',
    study: 'Study',
    stats: 'Stats',
    settings: 'Settings'
  };

  // Track document-level listeners so re-init (e.g. after sign-out) can
  // detach the previous Ctrl+K and view-changed handlers. Without this,
  // each Header.init() call piles on a duplicate listener and Ctrl+K
  // would fire SearchModal.open() N times per press.
  let _ctrlKHandler = null;
  let _viewChangedHandler = null;

  function init() {
    // Initial render — greeting (uses cached name if available)
    updateForView('home');

    // Avatar → Users tab
    document.getElementById('btn-avatar')?.addEventListener('click', () => {
      Router.navigate('users');
    });

    // Search → opens search modal (Ctrl+K shortcut also works)
    document.getElementById('btn-search')?.addEventListener('click', () => {
      if (typeof SearchModal !== 'undefined') SearchModal.open();
    });
    // Detach any previous Ctrl+K handler before attaching a new one — handles
    // the rare double-init case (e.g. sign out → sign in flow).
    if (_ctrlKHandler) document.removeEventListener('keydown', _ctrlKHandler);
    _ctrlKHandler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (typeof SearchModal !== 'undefined') SearchModal.open();
      }
    };
    document.addEventListener('keydown', _ctrlKHandler);

    // Notifications → opens popover
    document.getElementById('btn-notifications')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof Notifications !== 'undefined') Notifications.toggle(e.currentTarget);
    });

    // Header content swaps with view: greeting on home, section name elsewhere
    if (_viewChangedHandler) document.removeEventListener('view-changed', _viewChangedHandler);
    _viewChangedHandler = (e) => updateForView(e.detail.view);
    document.addEventListener('view-changed', _viewChangedHandler);
  }

  /** Tear down document-level listeners (called on sign-out / hot reload). */
  function destroy() {
    if (_ctrlKHandler) { document.removeEventListener('keydown', _ctrlKHandler); _ctrlKHandler = null; }
    if (_viewChangedHandler) { document.removeEventListener('view-changed', _viewChangedHandler); _viewChangedHandler = null; }
  }

  function _timeBasedGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return I18n.getLang() === 'es' ? 'Buenos d\u00edas' : 'Good morning';
    if (hour < 18) return I18n.getLang() === 'es' ? 'Buenas tardes' : 'Good afternoon';
    return I18n.getLang() === 'es' ? 'Buenas noches' : 'Good evening';
  }

  async function _resolveGreeting() {
    const greeting = _timeBasedGreeting();
    let firstName = null;
    try {
      if (window.electronAPI) {
        firstName = await window.electronAPI.store.get('user.firstName');
      }
    } catch {}
    return firstName ? `${greeting}, ${firstName}` : greeting;
  }

  /**
   * Set the header H1+subtitle based on current view with a visible cross-fade
   * (opacity + slight upward motion). Uses ~250ms each direction so the
   * transition reads as intentional, not a snap.
   */
  const FADE_MS = 250;
  const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

  async function updateForView(viewName) {
    const h1 = document.getElementById('header-title');
    const sub = document.getElementById('header-subtitle');
    if (!h1) return;

    const sectionName = VIEW_TITLES[viewName];
    const newTitle = sectionName || await _resolveGreeting();
    const showSubtitle = !sectionName;

    // Skip animation if text isn't actually changing (e.g. async greeting refresh while still on home)
    const subVisible = sub ? sub.style.display !== 'none' : false;
    if (h1.textContent === newTitle && subVisible === showSubtitle) return;

    const transitionStr = `opacity ${FADE_MS}ms ${EASE}, transform ${FADE_MS}ms ${EASE}`;
    h1.style.transition = transitionStr;
    if (sub) sub.style.transition = transitionStr;

    // Fade OUT (down + invisible)
    h1.style.opacity = '0';
    h1.style.transform = 'translateY(6px)';
    if (sub) {
      sub.style.opacity = '0';
      sub.style.transform = 'translateY(6px)';
    }

    setTimeout(() => {
      // Swap content while invisible
      h1.textContent = newTitle;
      if (sub) sub.style.display = showSubtitle ? '' : 'none';
      // Reset to start position (above), then animate down into place
      h1.style.transition = 'none';
      h1.style.transform = 'translateY(-6px)';
      if (sub) {
        sub.style.transition = 'none';
        sub.style.transform = 'translateY(-6px)';
      }
      // Force reflow before re-enabling transition
      void h1.offsetWidth;
      h1.style.transition = transitionStr;
      h1.style.opacity = '1';
      h1.style.transform = 'translateY(0)';
      if (sub && showSubtitle) {
        sub.style.transition = transitionStr;
        sub.style.opacity = '1';
        sub.style.transform = 'translateY(0)';
      }
    }, FADE_MS);
  }

  /** Public re-render — called after Google profile loads to refresh the greeting. */
  async function updateGreeting() {
    // Only update if we're currently displaying the greeting (i.e. on home view, no section title)
    const currentView = typeof Router !== 'undefined' ? Router.getCurrentView() : 'home';
    const isGreetingView = currentView === 'home' || currentView == null;
    if (isGreetingView) {
      const h1 = document.getElementById('header-title');
      if (h1) h1.textContent = await _resolveGreeting();
    }
  }

  async function updateWithProfile() {
    if (!window.electronAPI) return;
    try {
      const profile = await window.electronAPI.google.getProfile();
      if (profile && profile.name) {
        const firstName = profile.name.split(' ')[0];

        // Cache for next launch so greeting shows immediately
        try {
          await window.electronAPI.store.set('user.firstName', firstName);
          await window.electronAPI.store.set('user.fullName', profile.name);
          if (profile.picture) await window.electronAPI.store.set('user.avatarUrl', profile.picture);
        } catch {}

        const h1 = document.querySelector('.header-left h1');
        if (h1) h1.textContent = `${_timeBasedGreeting()}, ${firstName}`;

        // Update avatar via DOM construction (NOT innerHTML interpolation)
        // — Google profile names + URLs are external content. A display name
        // containing `"><script>` previously broke out of the alt attribute
        // and ran arbitrary JS in the renderer with full electronAPI access.
        const avatar = document.getElementById('btn-avatar');
        if (avatar) {
          while (avatar.firstChild) avatar.removeChild(avatar.firstChild);
          if (profile.picture) {
            const img = document.createElement('img');
            // Only allow https profile URLs — Google always returns these
            // (lh3.googleusercontent.com); anything else is suspect.
            if (/^https:\/\//i.test(profile.picture)) {
              img.src = profile.picture;
            }
            img.alt = firstName;
            avatar.appendChild(img);
          } else {
            avatar.textContent = firstName.charAt(0).toUpperCase();
          }
        }
      }
    } catch (err) {
      // Not connected, use defaults
    }
  }

  /** Restore cached avatar from previous session before Google profile re-fetches. */
  async function restoreCachedAvatar() {
    if (!window.electronAPI) return;
    try {
      const avatarUrl = await window.electronAPI.store.get('user.avatarUrl');
      const firstName = await window.electronAPI.store.get('user.firstName');
      const avatar = document.getElementById('btn-avatar');
      if (!avatar) return;
      while (avatar.firstChild) avatar.removeChild(avatar.firstChild);
      if (avatarUrl) {
        // DOM construction (not innerHTML) — same XSS reason as updateWithProfile.
        // Cached value comes from the store; if any other code path persists a
        // poisoned URL, we still don't reflect it as raw HTML.
        const img = document.createElement('img');
        if (/^https:\/\//i.test(avatarUrl)) img.src = avatarUrl;
        img.alt = '';
        avatar.appendChild(img);
      } else if (firstName) {
        avatar.textContent = firstName.charAt(0).toUpperCase();
      } else {
        // No cached profile — neutral placeholder icon. The SVG is a static
        // string we control, so innerHTML is safe here.
        avatar.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
      }
    } catch {}
  }

  return { init, destroy, updateGreeting, updateWithProfile, restoreCachedAvatar };
})();
