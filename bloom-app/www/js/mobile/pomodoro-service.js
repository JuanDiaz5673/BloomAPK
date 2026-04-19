// ─── Persistent Pomodoro timer service ───────────────────────────────
//
// Single source of truth for Pomodoro state. Previously all of this
// lived inside the StudyView module closure, which meant the moment
// the user navigated away from the Study tab the RAF loop kept going
// but the state died with the view's teardown. When they came back,
// they'd see `idle` and the pre-loaded duration regardless of what was
// actually happening.
//
// Now:
//   • State (mode, endTs, pauseRemaining, cycleInSequence) lives here,
//     NOT in the view. The view just subscribes + renders.
//   • Tick loop runs globally; never stops on view destroy.
//   • Mode transitions (focus → break → focus) happen here so the
//     chime + session log + OS notification fire even when the user
//     is over on Notes or Calendar.
//   • Emits three events on window:
//       bloom:pomodoro-state  — state change (start / pause / reset /
//                                transition). detail = full snapshot.
//       bloom:pomodoro-tick   — remaining time updated. detail =
//                                { remainingMs, durationMs, mode }.
//                                Fires ~4x/sec while running.
//       bloom:pomodoro-complete — an interval just ended. detail =
//                                { completedMode, nextMode }.
//
// View/component consumers (StudyView big ring, header mini pill) all
// listen to these events and never mutate service state directly —
// they call start/pause/reset.

(() => {
  const MODE_FOCUS = 'focus';
  const MODE_SHORT_BREAK = 'shortBreak';
  const MODE_LONG_BREAK = 'longBreak';
  const MODES = new Set([MODE_FOCUS, MODE_SHORT_BREAK, MODE_LONG_BREAK]);

  // Defaults used when prefs haven't loaded yet — match the study-store
  // DEFAULT_PREFS so a cold-start start() before prefs arrives still
  // gives a 25-minute focus session rather than NaN.
  const DEFAULT_PREFS = {
    focus: 25, shortBreak: 5, longBreak: 15, longBreakEvery: 4,
    soundEnabled: true,
  };

  // State (all module-scoped; no instantiation).
  let _mode = MODE_FOCUS;
  let _status = 'idle'; // 'idle' | 'running' | 'paused'
  let _endTs = 0;
  let _pauseRemaining = 0;
  let _durationMs = DEFAULT_PREFS.focus * 60 * 1000;
  let _sessionStart = 0;
  let _cycleInSequence = 0;
  let _prefs = { ...DEFAULT_PREFS };
  let _prefsLoaded = false;
  let _audioCtx = null; // lazy — only created during a user gesture

  // ── Prefs hydration ─────────────────────────────────────────────
  async function _loadPrefs() {
    if (_prefsLoaded) return _prefs;
    try {
      const p = await window.electronAPI?.study?.getPrefs?.();
      if (p) _prefs = { ...DEFAULT_PREFS, ...p };
    } catch { /* leave defaults */ }
    _prefsLoaded = true;
    // If idle, re-sync the duration to the loaded prefs. Without this,
    // the first start() might use the stale 25-min default even though
    // the user's prefs say 50.
    if (_status === 'idle') {
      _durationMs = _modeDurationMs(_mode);
      _pauseRemaining = _durationMs;
    }
    return _prefs;
  }
  // Hydrate eagerly on module load so the pill's first paint has real
  // numbers. No await at callsites — just kick it off.
  _loadPrefs();

  // Refresh prefs when the sync layer pulls new settings down or when
  // the user changes them in Settings. Keeps the timer's idea of
  // "focus = 25 min" in step with the store.
  window.addEventListener('bloom:stats-changed', () => {
    _prefsLoaded = false;
    _loadPrefs();
  });

  function _modeDurationMs(mode) {
    const minutes = mode === MODE_FOCUS ? _prefs.focus
      : mode === MODE_SHORT_BREAK ? _prefs.shortBreak
      : _prefs.longBreak;
    return Math.max(1, Number(minutes) || 25) * 60 * 1000;
  }

  // ── Event dispatch ──────────────────────────────────────────────
  function _dispatch(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch {}
  }
  function _emitState(extras) {
    _dispatch('bloom:pomodoro-state', { ...getState(), ...(extras || {}) });
  }
  function _emitTick(remainingMs) {
    _dispatch('bloom:pomodoro-tick', { remainingMs, durationMs: _durationMs, mode: _mode });
  }

  // ── Tick loop ───────────────────────────────────────────────────
  let _rafId = null;
  let _lastTick = 0;
  function _startTicker() {
    _stopTicker();
    _lastTick = 0;
    const loop = () => {
      if (_rafId == null) return;
      // Background tabs get throttled by the browser anyway, but skip
      // the work entirely when hidden — tick events cost listeners.
      if (document.visibilityState === 'hidden') {
        _rafId = requestAnimationFrame(loop);
        return;
      }
      const now = performance.now();
      if (now - _lastTick >= 250) {
        _lastTick = now;
        _tick();
      }
      _rafId = requestAnimationFrame(loop);
    };
    _rafId = requestAnimationFrame(loop);
  }
  function _stopTicker() {
    if (_rafId != null) { cancelAnimationFrame(_rafId); _rafId = null; }
  }
  function _tick() {
    if (_status !== 'running') return;
    const remaining = _endTs - Date.now();
    if (remaining <= 0) {
      _onComplete();
      return;
    }
    _emitTick(remaining);
  }

  // ── Transitions ─────────────────────────────────────────────────
  async function _onComplete() {
    _stopTicker();
    const completedMode = _mode;

    // Focus session — persist to the study-store so the weekly graph
    // + streak pick it up. logSession bumps today's counters and
    // fires a store mutate event that the sync layer pushes to Drive.
    if (completedMode === MODE_FOCUS && _sessionStart) {
      try {
        const minutes = Math.round(_durationMs / 60000);
        await window.electronAPI?.study?.logSession?.({
          kind: 'focus',
          durationMin: minutes,
        });
      } catch (err) { console.warn('[pomo-service] logSession failed:', err); }
      _sessionStart = 0;
      _cycleInSequence++;
    }

    // Pick the next mode. Long break every N focus cycles (default 4).
    let nextMode;
    if (completedMode === MODE_FOCUS) {
      const every = _prefs.longBreakEvery || 4;
      nextMode = (_cycleInSequence % every === 0) ? MODE_LONG_BREAK : MODE_SHORT_BREAK;
    } else {
      nextMode = MODE_FOCUS;
    }

    // Chime + system notification — fire regardless of which view is
    // mounted so the user hears the transition even if they're on
    // Notes or Calendar. The browser/capacitor Notification only pops
    // when permission has been granted; silently no-op otherwise.
    _chime();
    _fireNotification(
      completedMode === MODE_FOCUS ? 'Focus session complete' : 'Break\'s over',
      nextMode === MODE_FOCUS ? 'Time to focus — let\'s go!'
        : nextMode === MODE_LONG_BREAK ? 'Long break earned ☕' : 'Quick break ☕'
    );

    _resetToMode(nextMode);
    _dispatch('bloom:pomodoro-complete', { completedMode, nextMode });
    _emitState();
  }

  function _resetToMode(mode) {
    if (!MODES.has(mode)) mode = MODE_FOCUS;
    _mode = mode;
    _status = 'idle';
    _durationMs = _modeDurationMs(mode);
    _pauseRemaining = _durationMs;
    _endTs = 0;
  }

  function _chime() {
    if (!_prefs?.soundEnabled) return;
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = _audioCtx;
      const now = ctx.currentTime;
      const notes = [880, 1318.5]; // A5, E6
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const startAt = now + i * 0.09;
        const dur = 0.55;
        gain.gain.setValueAtTime(0, startAt);
        gain.gain.linearRampToValueAtTime(0.18, startAt + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + dur);
      });
    } catch { /* AudioContext may fail in headless envs */ }
  }
  function _fireNotification(title, body) {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'granted') {
        new Notification(title, { body, silent: true });
      }
    } catch { /* no-op */ }
  }

  // ── Public API ──────────────────────────────────────────────────
  function getState() {
    const remainingMs = _status === 'running'
      ? Math.max(0, _endTs - Date.now())
      : _pauseRemaining;
    return {
      mode: _mode,
      status: _status,
      remainingMs,
      durationMs: _durationMs,
      cycleInSequence: _cycleInSequence,
      prefs: { ..._prefs },
    };
  }

  // start(mode?) — starts from idle or resumes from paused. If `mode`
  // is passed and differs from current, switches mode first (only
  // allowed when not already running).
  function start(mode) {
    if (mode && MODES.has(mode) && _status !== 'running' && mode !== _mode) {
      _resetToMode(mode);
    }
    if (_status === 'running') return;
    // Lazy-create AudioContext on first start — it MUST be created
    // during a user gesture on mobile (Chrome/Android policy) or
    // subsequent sounds will be muted. start() is always called from
    // a tap, so this is the right moment.
    if (!_audioCtx && _prefs?.soundEnabled) {
      try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    }
    _status = 'running';
    // Use pauseRemaining if paused; else fresh duration.
    if (!_pauseRemaining || _pauseRemaining <= 0) _pauseRemaining = _durationMs;
    _endTs = Date.now() + _pauseRemaining;
    if (_mode === MODE_FOCUS && !_sessionStart) _sessionStart = Date.now();
    _startTicker();
    _emitState();
  }
  function pause() {
    if (_status !== 'running') return;
    _pauseRemaining = Math.max(0, _endTs - Date.now());
    _status = 'paused';
    _stopTicker();
    _emitState();
  }
  function reset() {
    _stopTicker();
    _sessionStart = 0;
    _resetToMode(_mode);
    _emitState();
  }
  // Switch mode while idle. Ignored while running — the user must
  // pause/reset first. StudyView's mode buttons call this.
  function setMode(mode) {
    if (_status === 'running' || _status === 'paused') return;
    if (!MODES.has(mode)) return;
    _resetToMode(mode);
    _emitState();
  }
  function isActive() { return _status === 'running' || _status === 'paused'; }

  window._bloomPomodoro = {
    MODES: { FOCUS: MODE_FOCUS, SHORT_BREAK: MODE_SHORT_BREAK, LONG_BREAK: MODE_LONG_BREAK },
    getState, start, pause, reset, setMode, isActive,
    // Test hooks — not meant for view code.
    _reloadPrefs: () => { _prefsLoaded = false; return _loadPrefs(); },
  };
})();
