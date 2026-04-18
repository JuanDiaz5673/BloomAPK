// ─── AllDash Application Bootstrap ───
(async function bootstrap() {
  const splash = document.getElementById('splash-screen');
  const progress = document.getElementById('splash-progress');

  function setProgress(pct) {
    if (progress) progress.style.width = pct + '%';
  }

  function updateSplashTheme(theme) {
    if (!splash || !theme?.palette) return;
    const p = theme.palette;
    // Update splash background to match theme
    if (p['--accent-pink'] && p['--accent-rose']) {
      const gradBar = splash.querySelector('#splash-progress');
      if (gradBar) gradBar.style.background = `linear-gradient(90deg, ${p['--accent-pink']}, ${p['--accent-rose']})`;
    }
    // Update splash bg color — fully opaque so nothing shows through
    if (p['--overlay-color']) {
      splash.style.background = p['--overlay-color'].replace(/[\d.]+\)$/, '1)');
    }
  }

  try {
    setProgress(10);

    // Fan out the three independent store reads (language, theme, blur)
    // in PARALLEL. Previously each awaited sequentially, gating first
    // paint behind 3 serial IPC round trips. Promise.all collapses them
    // to one. The results still need to be APPLIED in a specific order
    // (i18n before view render; splash theme before fade; blur var
    // before any glass-card paints), so we keep the apply logic
    // sequential but do the fetches in parallel.
    let savedLang = null, savedTheme = null, savedBlur = null;
    if (window.electronAPI) {
      try {
        [savedLang, savedTheme, savedBlur] = await Promise.all([
          window.electronAPI.store.get('language').catch(() => null),
          window.electronAPI.store.get('theme').catch(() => null),
          window.electronAPI.store.get('appearance.blur').catch(() => null),
        ]);
      } catch {}
    }
    if (savedLang) { try { I18n.setLang(savedLang); } catch {} }
    setProgress(25);

    try {
      if (savedTheme) updateSplashTheme(savedTheme);
      await ThemeEngine.loadSavedTheme();
    } catch {}

    // Apply saved glass-blur BEFORE any view renders so there's no
    // flash of default-blur → user-blur transition. The variable
    // drives every .glass-card, sidebar, and overlay with
    // backdrop-filter.
    try {
      if (typeof savedBlur === 'number' && savedBlur >= 0 && savedBlur <= 60) {
        document.documentElement.style.setProperty('--glass-sub-blur', `blur(${savedBlur}px) saturate(1.3)`);
        document.documentElement.style.setProperty('--glass-blur', `${savedBlur}px`);
      }
    } catch {}
    setProgress(50);

    // ── Delegated handlers for declarative attributes ──
    // Replaces inline `onclick="Router.navigate('X')"` etc. that strict CSP
    // (script-src without 'unsafe-inline') blocks. Views can opt into the
    // delegation by setting:
    //   data-nav="<view>"        → click navigates to that view
    //   data-open-external="..."  → click opens the URL via shell
    document.addEventListener('click', (e) => {
      const navEl = e.target.closest?.('[data-nav]');
      if (navEl) {
        const view = navEl.dataset.nav;
        if (view && typeof Router !== 'undefined') {
          // Don't override clicks inside the navigation target's children
          // that have their own onClick listeners — only fire if the click
          // landed on the [data-nav] element itself or a non-interactive
          // descendant.
          if (e.target.closest('button, a, input, [data-stop-nav]') &&
              !e.target.closest('[data-nav]')?.contains(e.target.closest('[data-nav]'))) {
            // (no-op — preserves existing button delegation paths)
          }
          Router.navigate(view);
        }
        return;
      }
      const extEl = e.target.closest?.('[data-open-external]');
      if (extEl) {
        const url = extEl.dataset.openExternal;
        if (url && window.electronAPI?.app?.openExternal) {
          window.electronAPI.app.openExternal(url);
        }
      }
    });

    // Initialize components
    Sidebar.init();
    Header.init();
    await Header.restoreCachedAvatar?.();
    if (typeof Notifications !== 'undefined') Notifications.init();

    // ── Android-only: hardware back button + StatusBar theme sync ──
    // See js/mobile/native-integration.js (auto-loaded via index.html)
    if (typeof NativeIntegration !== 'undefined') NativeIntegration.init();

    // ── Auto-resume the most recent Bloom conversation ──
    // Without this, every app launch starts a brand-new conversation —
    // including after an API key reset / dev reload — and the home chat,
    // sidebar Bloom panel, and main Chat view all show a blank slate even
    // though the prior chat is still on disk. We pick the most recently
    // updated one (already sorted desc by AIService.listConversations) and
    // hang it on `window._activeConversationId`. The home chat's
    // _restoreHomeChat() and BloomPanel's _loadActiveConversation() both
    // read that variable, so they pick it up automatically.
    if (window.electronAPI && !window._activeConversationId) {
      try {
        const convos = await window.electronAPI.ai.listConversations();
        if (convos && convos.length > 0) {
          window._activeConversationId = convos[0].id;
        }
      } catch {
        // No conversations on disk yet, or AI service unavailable — leave
        // _activeConversationId undefined; a fresh chat starts on first send.
      }
    }
    setProgress(70);

    // Navigate to home view
    await Router.navigate('home');
    setProgress(90);

    // Update header with Google profile if connected
    Header.updateWithProfile();
    setProgress(100);

    // Track app launch
    if (window.electronAPI) {
      window.electronAPI.analytics.track('app_launch', {});

      // Persistent listener for Bloom's `start_pomodoro` AI tool. Fires
      // whether or not the Study view is currently mounted. If the user
      // is already on Study, the view's own listener handles the start —
      // our job here is only to navigate them there when they aren't.
      // We stash the duration on a deep-link so StudyView.init() can
      // auto-start the session after mount.
      window.electronAPI.study?.onPomodoroStart?.((payload) => {
        try {
          const currentView = typeof Router !== 'undefined' ? Router.getCurrentView() : null;
          if (currentView === 'study') return; // view-local listener will handle
          if (typeof Router !== 'undefined') {
            Router.setDeepLink({ type: 'pomodoro', durationMin: payload?.durationMin || null });
            Router.navigate('study');
          }
        } catch { /* quiet */ }
      });

      // Listen for Google auth expiry — prompt user to re-sign-in
      window.electronAPI.google.onAuthExpired?.(() => {
        try {
          Toast.show('Your Google session expired — open Settings to sign in again.', 'warning', 8000);
          // Clear cached identity since session is invalid
          window.electronAPI.store.delete('user.firstName').catch(() => {});
          window.electronAPI.store.delete('user.fullName').catch(() => {});
          window.electronAPI.store.delete('user.avatarUrl').catch(() => {});
          // Update header to reflect lost identity
          Header.updateGreeting?.();
          Header.restoreCachedAvatar?.();
        } catch {}
      });
    }

    // Wait for AI greeting to load before hiding splash
    // Timeout after 5 seconds in case API is slow/down
    if (window._greetingReady) {
      await Promise.race([
        window._greetingReady,
        new Promise(r => setTimeout(r, 5000))
      ]);
    }
    setProgress(100);

    // Fade out splash screen
    await new Promise(r => setTimeout(r, 300));
    if (splash) {
      splash.style.opacity = '0';
      splash.style.visibility = 'hidden';
      setTimeout(() => splash.remove(), 500);
    }

    // First-run setup wizard — show after splash if user has never completed setup
    try {
      if (typeof SetupWizard !== 'undefined' && await SetupWizard.shouldShow()) {
        // Small delay so the splash fade finishes first for a smooth handoff
        setTimeout(() => SetupWizard.show(), 600);
      }
    } catch (err) {
      console.warn('Setup wizard failed to load:', err);
    }
  } catch (err) {
    console.error('Bootstrap error:', err);
    // Still hide splash on error so app is usable
    if (splash) {
      splash.style.opacity = '0';
      splash.style.visibility = 'hidden';
      setTimeout(() => splash.remove(), 500);
    }
  }
})();
