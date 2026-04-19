// ─── Header Pomodoro mini-pill (mobile) ──────────────────────────────
//
// Persistent MM:SS indicator wedged into the header between the title
// and the right-side action icons. Keeps the user aware of a running
// focus / break session even while they're reading Notes, flipping
// flashcards, or editing Calendar events.
//
// Visibility rules:
//   - Hidden while timer is idle (no session active).
//   - Hidden on the home view (per user's design ask — home stays
//     clean, but the timer is still running in the background and
//     the pill reappears the moment the user navigates anywhere else).
//   - Otherwise visible. Running state shows a softly pulsing dot;
//     paused shows a static dot with a "paused" glyph hint.
//
// Interactions:
//   - Tap → navigates to Study → Pomodoro subview so the user can
//     see the full ring / pause / reset.
//
// State comes from window._bloomPomodoro (pomodoro-service.js). The
// pill never mutates timer state — it just listens to events.

(() => {
  let _el = null;
  let _timeEl = null;
  let _dotEl = null;
  let _inserted = false;

  function _mount() {
    if (_inserted) return;
    const headerLeft = document.querySelector('.header-left');
    const headerRight = document.querySelector('.header-right');
    if (!headerLeft || !headerRight || !headerLeft.parentNode) return;
    _el = document.createElement('button');
    _el.className = 'pomo-pill';
    _el.type = 'button';
    _el.setAttribute('aria-label', 'Pomodoro timer — tap to open');
    _el.innerHTML = `
      <span class="pomo-pill-dot" aria-hidden="true"></span>
      <span class="pomo-pill-time" id="pomo-pill-time">--:--</span>
    `;
    _el.addEventListener('click', () => {
      // Jump to Study → Pomodoro. The Study view reads its target
      // subview from sessionStorage on mount (see study.js init).
      try { sessionStorage.setItem('study.pendingSubView', 'pomodoro'); } catch {}
      if (typeof Router !== 'undefined') Router.navigate('study');
    });
    // Insert BETWEEN .header-left and .header-right so the flex
    // layout places it in the middle of the top bar.
    headerLeft.parentNode.insertBefore(_el, headerRight);
    _timeEl = _el.querySelector('#pomo-pill-time');
    _dotEl = _el.querySelector('.pomo-pill-dot');
    _inserted = true;
  }

  function _fmt(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function _updateFromState(state) {
    if (!_el) return;
    const service = window._bloomPomodoro;
    const currentView = typeof Router !== 'undefined' ? Router.getCurrentView() : null;
    const active = service?.isActive?.() ?? (state && state.status !== 'idle');
    const onHome = currentView === 'home' || currentView === null;
    const shouldShow = active && !onHome;
    _el.classList.toggle('is-visible', !!shouldShow);
    if (!shouldShow) return;
    // Paint content.
    const snap = state || service?.getState?.() || {};
    if (_timeEl) _timeEl.textContent = _fmt(snap.remainingMs ?? 0);
    // Mode-color + running-animation classes.
    _el.classList.toggle('is-focus', snap.mode === 'focus');
    _el.classList.toggle('is-break', snap.mode === 'shortBreak' || snap.mode === 'longBreak');
    _el.classList.toggle('is-paused', snap.status === 'paused');
    _el.classList.toggle('is-running', snap.status === 'running');
  }

  function _updateFromTick(tick) {
    if (!_el || !_el.classList.contains('is-visible')) return;
    if (_timeEl) _timeEl.textContent = _fmt(tick?.remainingMs ?? 0);
  }

  // Mount once DOM is ready (the header markup is in index.html, so
  // it's there by this script's execution, but we defer by a microtask
  // to be safe if this file is moved around later).
  function _init() {
    _mount();
    // Paint whatever state the service is currently in.
    _updateFromState(window._bloomPomodoro?.getState?.());
    window.addEventListener('bloom:pomodoro-state', (e) => _updateFromState(e.detail));
    window.addEventListener('bloom:pomodoro-tick', (e) => _updateFromTick(e.detail));
    // View changes flip the home-vs-elsewhere gate. Also re-paint
    // state because the service may have transitioned while we were
    // on home (e.g. focus → break while looking at the dashboard).
    document.addEventListener('view-changed', () => {
      _updateFromState(window._bloomPomodoro?.getState?.());
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init, { once: true });
  } else {
    _init();
  }
})();
