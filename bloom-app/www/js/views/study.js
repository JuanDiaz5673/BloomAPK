// ─── Study View ───
// Pomodoro + flashcards (SM-2 spaced repetition) + session stats.
// Persistence lives in main's study-store.js; this view only holds
// transient timer state + UI. All mutations flow through electronAPI.study.
const StudyView = (() => {
  // ── Module-scoped state ────────────────────────────────────────────
  let _prefs = null;
  let _decks = [];
  let _stats = null;
  let _destroyed = false;

  // Timer
  const MODE_FOCUS = 'focus';
  const MODE_SHORT_BREAK = 'shortBreak';
  const MODE_LONG_BREAK = 'longBreak';
  let _timerMode = MODE_FOCUS;           // which kind of interval we're in
  let _timerStatus = 'idle';              // 'idle' | 'running' | 'paused'
  let _timerEndTs = 0;                    // ms epoch — when the current interval ends (null when paused)
  let _timerPauseRemaining = 0;           // ms remaining at the moment of pause
  let _timerDurationMs = 0;               // total ms for the current interval (for ring math)
  let _timerSessionStart = 0;             // when the CURRENT focus interval started (for session log)
  let _tickerId = null;
  let _cycleInSequence = 0;               // 0..longBreakEvery-1 — resets after long break
  let _audioCtx = null;

  // Study mode (flashcard review)
  let _study = null; // { deckId, deckName, queue, idx, flipped, startedAt, reviewed }
  let _escListener = null;
  // Unsubscribe handles for main-process broadcasts (AI tool mutations).
  let _unsubDecksChanged = null;
  let _unsubPomodoroStart = null;
  let _unsubSyncStatus = null;
  // Cached sync status — re-rendered into the chip on every sub-view nav
  // so the user always sees the latest state without an IPC round-trip.
  let _syncStatus = { state: 'idle', lastSyncAt: null, pendingCount: 0, authed: false };

  // Sub-view router. The Study tab is now a hub with two dedicated
  // sub-pages — Pomodoro and Flashcards — that take over the main
  // content area while preserving timer + deck state in module scope.
  // Navigating to a different SPA view (calendar, notes, etc) still
  // calls destroy() which tears everything down; sub-views only swap
  // the inner DOM via _navigate().
  const SV_HUB = 'hub';
  const SV_POMODORO = 'pomodoro';
  const SV_FLASHCARDS = 'flashcards';
  let _subView = SV_HUB;

  // SVG ring math — radius chosen so 240×240 viewBox leaves room for stroke
  const RING_R = 110;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R; // ≈ 691.15

  // ── Render (outer shell — sub-view content is swapped via _navigate) ─
  function render() {
    return `<div class="study-view" id="study-root"></div>`;
  }

  // ── Hub sub-view (default landing) ───────────────────────────────────
  // Top: stats card (focus minutes, cards reviewed, streak, 7-day chart).
  // Middle: recent decks (3 most recent, with quick-study buttons).
  // Bottom: two big entry tiles for Pomodoro + Flashcards.
  function _renderHub() {
    return `
      <div class="glass-card study-today" style="animation:fadeSlideUp 0.5s ease 0.05s both;">
        <div class="study-card-head">
          <h3 class="study-card-title">Today</h3>
          <div class="study-streak" id="study-streak" title="Current study streak">🔥 0</div>
        </div>
        <div class="study-today-stats">
          <div class="study-stat">
            <div class="study-stat-value" id="study-today-min">0</div>
            <div class="study-stat-label">focus min</div>
          </div>
          <div class="study-stat">
            <div class="study-stat-value" id="study-today-reviews">0</div>
            <div class="study-stat-label">cards reviewed</div>
          </div>
          <div class="study-stat">
            <div class="study-stat-value" id="study-today-cycles">0</div>
            <div class="study-stat-label">pomodoros</div>
          </div>
        </div>
        <div class="study-goal" id="study-goal">
          <div class="study-goal-bar"><div class="study-goal-bar-fill" id="study-goal-fill"></div></div>
          <div class="study-goal-text" id="study-goal-text">Daily goal: 30 min</div>
        </div>
        <div class="study-chart" id="study-chart" aria-label="Last 7 days of focus time">
          ${_renderChartSkeleton()}
        </div>
      </div>

      <div class="glass-card study-recent-decks" style="animation:fadeSlideUp 0.5s ease 0.12s both;">
        <div class="study-card-head">
          <h3 class="study-card-title">Recent decks</h3>
          <button class="study-link-btn" id="study-view-all-decks">
            View all
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="study-deck-list study-deck-list-compact" id="study-recent-deck-list">
          <div class="study-deck-skeleton">Loading…</div>
        </div>
      </div>

      <!-- Big entry tiles: each opens its own dedicated sub-page.
           These are <div role="button"> rather than real <button> elements
           because Chromium's UA-rendered button shadow tree breaks
           backdrop-filter inheritance. Keyboard handling (Enter/Space)
           wired in _bindHub.

           CRITICAL: animation:fadeSlideUp must live on the tiles
           themselves, NOT on .study-tiles. fadeSlideUp animates
           transform, and any transform on an ancestor of a .glass-card
           severs backdrop-filter on the descendants. See CLAUDE.md
           "Glass-Morphism UI" → CRITICAL list. -->
      <div class="study-tiles">
        <div class="glass-card study-tile" data-target="pomodoro" role="button" tabindex="0" aria-label="Open Pomodoro timer" style="animation:fadeSlideUp 0.5s ease 0.2s both;">
          <div class="study-tile-icon study-tile-icon-pomo">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 1h6"/><path d="M12 1v3"/></svg>
          </div>
          <div class="study-tile-body">
            <div class="study-tile-title">Pomodoro timer</div>
            <div class="study-tile-desc">Focus sessions, breaks, and a daily goal — Bloom can start one for you too.</div>
            <div class="study-tile-meta" id="study-tile-pomo-meta">25 min focus · 5 min break</div>
          </div>
          <div class="study-tile-arrow">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>

        <div class="glass-card study-tile" data-target="flashcards" role="button" tabindex="0" aria-label="Open flashcard decks" style="animation:fadeSlideUp 0.5s ease 0.24s both;">
          <div class="study-tile-icon study-tile-icon-cards">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="14" rx="2"/><path d="M6 2h14a2 2 0 0 1 2 2v14"/></svg>
          </div>
          <div class="study-tile-body">
            <div class="study-tile-title">Flashcards</div>
            <div class="study-tile-desc">Build decks, run spaced-repetition reviews, or ask Bloom to generate cards from a note.</div>
            <div class="study-tile-meta" id="study-tile-cards-meta">No decks yet</div>
          </div>
          <div class="study-tile-arrow">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
      </div>`;
  }

  // ── Pomodoro sub-view (dedicated page) ───────────────────────────────
  // Same timer layout as before but as a full-page experience with a
  // back button. Module-scoped timer state survives sub-view switches,
  // so opening / closing this view doesn't reset a running timer.
  function _renderPomodoroPage() {
    return `
      ${_renderBackBar('Pomodoro timer')}
      <div class="glass-card study-pomodoro" style="animation:fadeSlideUp 0.4s ease 0.05s both;">
        <div class="study-pomo-ring-wrap">
          <svg class="study-pomo-ring" viewBox="0 0 240 240" width="240" height="240" aria-hidden="true">
            <defs>
              <linearGradient id="studyRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="var(--accent-pink)"/>
                <stop offset="100%" stop-color="var(--accent-rose)"/>
              </linearGradient>
            </defs>
            <circle class="study-pomo-ring-bg" cx="120" cy="120" r="${RING_R}"></circle>
            <circle class="study-pomo-ring-fg" cx="120" cy="120" r="${RING_R}"
                    stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(2)}"
                    stroke-dashoffset="0"></circle>
          </svg>
          <div class="study-pomo-center">
            <div class="study-pomo-time" id="study-pomo-time">25:00</div>
            <div class="study-pomo-label" id="study-pomo-label">Focus session</div>
          </div>
        </div>
        <div class="study-pomo-controls">
          <button class="study-btn study-btn-primary" id="study-pomo-start">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
            <span id="study-pomo-start-label">Start</span>
          </button>
          <button class="study-btn" id="study-pomo-reset" title="Reset" aria-label="Reset timer">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <button class="study-btn" id="study-pomo-settings" title="Settings" aria-label="Pomodoro settings">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>
        <div class="study-pomo-meta" id="study-pomo-meta">Cycle 0 · ready when you are</div>
      </div>

      <!-- Today's progress callout — repeats the key numbers so the user
           doesn't have to bounce back to the hub mid-session. -->
      <div class="glass-card study-today study-today-compact" style="animation:fadeSlideUp 0.4s ease 0.12s both;">
        <div class="study-card-head">
          <h3 class="study-card-title">Today's progress</h3>
          <div class="study-streak" id="study-streak" title="Current study streak">🔥 0</div>
        </div>
        <div class="study-today-stats">
          <div class="study-stat">
            <div class="study-stat-value" id="study-today-min">0</div>
            <div class="study-stat-label">focus min</div>
          </div>
          <div class="study-stat">
            <div class="study-stat-value" id="study-today-cycles">0</div>
            <div class="study-stat-label">pomodoros</div>
          </div>
        </div>
        <div class="study-goal" id="study-goal">
          <div class="study-goal-bar"><div class="study-goal-bar-fill" id="study-goal-fill"></div></div>
          <div class="study-goal-text" id="study-goal-text">Daily goal: 30 min</div>
        </div>
      </div>`;
  }

  // ── Flashcards sub-view (dedicated page) ─────────────────────────────
  function _renderFlashcardsPage() {
    return `
      ${_renderBackBar('Flashcards', `
        <button class="study-sync-chip" id="study-sync-chip" title="Sync now" aria-label="Sync now">
          <svg class="study-sync-chip-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span class="study-sync-chip-label" id="study-sync-chip-label">Checking sync…</span>
        </button>
        <button class="study-btn study-btn-primary study-btn-sm" id="study-new-deck">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New deck
        </button>`)}
      <div class="glass-card study-decks study-decks-full" style="animation:fadeSlideUp 0.4s ease 0.05s both;">
        <div class="study-deck-list" id="study-deck-list">
          <div class="study-deck-skeleton">Loading decks…</div>
        </div>
        <div class="study-hint">
          Tip: ask Bloom to <em>"make flashcards from my [note] notes"</em> and a new deck will show up here.
        </div>
      </div>`;
  }

  // Shared back-bar for sub-views. Right slot is for a contextual action
  // (e.g. "+ New deck" on Flashcards). Pass empty string for none.
  function _renderBackBar(title, rightSlot = '') {
    return `
      <div class="study-backbar">
        <button class="study-back-btn" id="study-back-btn" aria-label="Back to Study hub">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          <span>Study</span>
        </button>
        <div class="study-backbar-title">${_escapeHtml(title)}</div>
        <div class="study-backbar-right">${rightSlot}</div>
      </div>`;
  }

  function _renderChartSkeleton() {
    // Placeholder bars; real data fills them in _renderChart().
    return Array.from({ length: 7 }).map(() =>
      `<div class="study-chart-col"><div class="study-chart-bar" style="height:0%"></div><div class="study-chart-label"></div></div>`
    ).join('');
  }

  // ── Init / destroy ─────────────────────────────────────────────────
  async function init() {
    _destroyed = false;
    // Fresh entry — reset timer state. Module-scope vars persist across
    // SPA view changes (StudyView is a singleton), so without this a
    // dangling 'paused' status from a previous session would re-render.
    _timerStatus = 'idle';
    _timerSessionStart = 0;
    _cycleInSequence = 0;
    _subView = SV_HUB;

    // Fire off all three fetches in parallel — they're independent and
    // none depend on the others' results.
    try {
      const [prefs, decks, stats] = await Promise.all([
        window.electronAPI.study.getPrefs(),
        window.electronAPI.study.listDecks(),
        window.electronAPI.study.getStats(),
      ]);
      if (_destroyed) return;
      _prefs = prefs;
      _decks = decks || [];
      _stats = stats;
    } catch (err) {
      console.error('Study init failed:', err);
      if (window.Toast) Toast.show('Failed to load study data', 'error');
      return;
    }

    _resetTimerToMode(MODE_FOCUS);

    // Live updates from AI tools. These listeners survive sub-view
    // changes — they only get torn down on full view destroy().
    // Bloom creating a deck or firing start_pomodoro should reflect
    // in the Study tab whether we're on hub, pomodoro, or flashcards.
    _unsubDecksChanged = window.electronAPI.study.onDecksChanged(() => {
      _refreshDecks().catch(() => {});
    });

    // Sync status — subscribe FIRST then fetch the current snapshot, so
    // we never miss an in-flight 'syncing' → 'idle' transition. The
    // chip re-renders whenever status changes.
    _unsubSyncStatus = window.electronAPI.study.onSyncStatus((payload) => {
      _syncStatus = payload;
      _renderSyncChip(payload);
      // A successful pull may have brought new decks down — refresh if
      // we're currently looking at the deck list or hub.
      if (payload?.state === 'idle' && (_subView === SV_FLASHCARDS || _subView === SV_HUB)) {
        _refreshDecks().catch(() => {});
      }
    });
    window.electronAPI.study.getSyncStatus().then(s => {
      _syncStatus = s;
      _renderSyncChip(s);
    }).catch(() => {});
    _unsubPomodoroStart = window.electronAPI.study.onPomodoroStart((payload) => {
      if (_timerStatus === 'running') return; // don't interrupt an active session
      if (payload?.durationMin) {
        _timerDurationMs = Math.max(1, payload.durationMin) * 60 * 1000;
        _timerPauseRemaining = _timerDurationMs;
      }
      _timerMode = MODE_FOCUS;
      // Surface the timer page so the user can see what's happening,
      // then start ticking.
      _navigate(SV_POMODORO);
      _onStartPause();
      if (window.Toast) Toast.show('Focus session started 🌸', 'success');
    });

    // Deep link from app.js's persistent listener — Bloom called
    // start_pomodoro while the user was on a different SPA view.
    const pomoLink = typeof Router !== 'undefined'
      ? Router.consumeDeepLink('pomodoro') : null;
    if (pomoLink) {
      _navigate(SV_POMODORO);
      if (pomoLink.durationMin) {
        _timerDurationMs = Math.max(1, pomoLink.durationMin) * 60 * 1000;
        _timerPauseRemaining = _timerDurationMs;
      }
      _timerMode = MODE_FOCUS;
      setTimeout(() => { if (!_destroyed && _timerStatus !== 'running') _onStartPause(); }, 50);
      if (window.Toast) Toast.show('Focus session started 🌸', 'success');
    } else {
      _navigate(SV_HUB);
    }
  }

  // ── Sub-view router ───────────────────────────────────────────────────
  // Swaps the inner DOM and re-binds handlers. Module-scoped state
  // (timer + decks + stats) is preserved, so a running pomodoro keeps
  // ticking when the user briefly checks the flashcards page.
  function _navigate(target) {
    if (_destroyed) return;
    if (![SV_HUB, SV_POMODORO, SV_FLASHCARDS].includes(target)) return;
    _subView = target;
    const root = document.getElementById('study-root');
    if (!root) return;

    if (target === SV_HUB) {
      root.innerHTML = _renderHub();
      _bindHub();
      _renderStats();
      _renderRecentDecks();
      _updateHubTileMeta();
    } else if (target === SV_POMODORO) {
      root.innerHTML = _renderPomodoroPage();
      _bindBackBar();
      _bindPomodoro();
      _renderTimer();
      _renderStats();
    } else if (target === SV_FLASHCARDS) {
      root.innerHTML = _renderFlashcardsPage();
      _bindBackBar();
      document.getElementById('study-new-deck')?.addEventListener('click', () => _openDeckEditor(null));
      document.getElementById('study-deck-list')?.addEventListener('click', _onDeckListClick);
      document.getElementById('study-sync-chip')?.addEventListener('click', _onSyncChipClick);
      _renderDeckList();
      _renderSyncChip(_syncStatus); // initial paint from cached status
    }
  }

  // ── Sub-view binders ──────────────────────────────────────────────────
  function _bindBackBar() {
    document.getElementById('study-back-btn')?.addEventListener('click', () => _navigate(SV_HUB));
  }

  function _bindHub() {
    document.querySelectorAll('.study-tile').forEach(tile => {
      const go = () => {
        const target = tile.dataset.target;
        if (target === 'pomodoro') _navigate(SV_POMODORO);
        else if (target === 'flashcards') _navigate(SV_FLASHCARDS);
      };
      tile.addEventListener('click', go);
      // role="button" divs need explicit keyboard activation — Enter and
      // Space should "click" them. Without this they'd be focusable
      // (tabindex=0) but not actuatable from the keyboard. Space is
      // preventDefault'd to stop the page from scrolling.
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); go(); }
        else if (e.key === ' ') { e.preventDefault(); go(); }
      });
    });
    document.getElementById('study-view-all-decks')?.addEventListener('click', () => _navigate(SV_FLASHCARDS));
    const recentList = document.getElementById('study-recent-deck-list');
    recentList?.addEventListener('click', _onRecentDeckListClick);
    recentList?.addEventListener('keydown', _onRecentDeckListKeydown);
  }

  function _bindPomodoro() {
    document.getElementById('study-pomo-start')?.addEventListener('click', _onStartPause);
    document.getElementById('study-pomo-reset')?.addEventListener('click', _onReset);
    document.getElementById('study-pomo-settings')?.addEventListener('click', _openPomoSettings);
  }

  function destroy() {
    _destroyed = true;
    _stopTicker();
    _closeStudyMode(false);
    if (_escListener) {
      document.removeEventListener('keydown', _escListener);
      _escListener = null;
    }
    if (_unsubDecksChanged) { try { _unsubDecksChanged(); } catch {} _unsubDecksChanged = null; }
    if (_unsubPomodoroStart) { try { _unsubPomodoroStart(); } catch {} _unsubPomodoroStart = null; }
    if (_unsubSyncStatus) { try { _unsubSyncStatus(); } catch {} _unsubSyncStatus = null; }
  }

  // ── Timer ──────────────────────────────────────────────────────────
  function _modeLabel(mode) {
    if (mode === MODE_FOCUS) return 'Focus session';
    if (mode === MODE_SHORT_BREAK) return 'Short break';
    return 'Long break';
  }

  function _modeDurationMs(mode) {
    const minutes = mode === MODE_FOCUS ? _prefs.focus
      : mode === MODE_SHORT_BREAK ? _prefs.shortBreak
      : _prefs.longBreak;
    return Math.max(1, minutes) * 60 * 1000;
  }

  function _resetTimerToMode(mode) {
    _timerMode = mode;
    _timerStatus = 'idle';
    _timerDurationMs = _modeDurationMs(mode);
    _timerPauseRemaining = _timerDurationMs;
    _timerEndTs = 0;
  }

  function _onStartPause() {
    if (_timerStatus === 'running') {
      // Pause: freeze remaining time
      _timerPauseRemaining = Math.max(0, _timerEndTs - Date.now());
      _timerStatus = 'paused';
      _stopTicker();
      _renderTimer();
    } else {
      // Start or resume
      _timerStatus = 'running';
      _timerEndTs = Date.now() + _timerPauseRemaining;
      if (_timerMode === MODE_FOCUS && !_timerSessionStart) {
        _timerSessionStart = Date.now();
      }
      _startTicker();
      _renderTimer();
    }
  }

  function _onReset() {
    _stopTicker();
    _timerSessionStart = 0;
    _resetTimerToMode(_timerMode);
    _renderTimer();
  }

  // rAF-driven ticker with a 250ms throttle gate. Previously a raw
  // setInterval(250) kept running even when the window was hidden or
  // the Study view was navigated away — 4 DOM reads/writes per second
  // on a backdrop-filtered card, forever. rAF pauses automatically
  // when the tab is hidden; `visibilityState` check covers the
  // minimized-window case too. Internal throttle keeps the SVG ring
  // update to ~4/s (same feel as before) rather than 60/s.
  let _tickerRafId = null;
  let _lastTickMs = 0;
  function _startTicker() {
    _stopTicker();
    _lastTickMs = 0;
    const loop = () => {
      if (_destroyed || _tickerRafId == null) return;
      // Pause the loop while hidden — rAF already throttles aggressively
      // in background tabs, but this also avoids the wasted function
      // calls + remaining-time reads entirely.
      if (document.visibilityState === 'hidden') {
        _tickerRafId = requestAnimationFrame(loop);
        return;
      }
      const now = performance.now();
      if (now - _lastTickMs >= 250) {
        _lastTickMs = now;
        _tick();
      }
      _tickerRafId = requestAnimationFrame(loop);
    };
    _tickerRafId = requestAnimationFrame(loop);
  }

  function _stopTicker() {
    if (_tickerRafId != null) {
      cancelAnimationFrame(_tickerRafId);
      _tickerRafId = null;
    }
    if (_tickerId) {
      clearInterval(_tickerId);
      _tickerId = null;
    }
  }

  function _tick() {
    if (_destroyed) { _stopTicker(); return; }
    if (_timerStatus !== 'running') return;
    const remaining = _timerEndTs - Date.now();
    if (remaining <= 0) {
      _onIntervalComplete();
      return;
    }
    _renderTimer();
  }

  async function _onIntervalComplete() {
    _stopTicker();
    const completedMode = _timerMode;

    // Log the pomodoro session if this was a focus interval
    if (completedMode === MODE_FOCUS && _timerSessionStart) {
      try {
        await window.electronAPI.study.logSession({
          type: 'pomodoro',
          startedAt: _timerSessionStart,
          durationMs: _timerDurationMs,
        });
      } catch (err) {
        console.warn('Failed to log pomodoro session:', err);
      }
      _timerSessionStart = 0;
      _cycleInSequence++;
    }

    // Transition to next mode
    let nextMode;
    let toastMsg;
    if (completedMode === MODE_FOCUS) {
      nextMode = (_cycleInSequence % (_prefs.longBreakEvery || 4) === 0)
        ? MODE_LONG_BREAK : MODE_SHORT_BREAK;
      toastMsg = nextMode === MODE_LONG_BREAK
        ? 'Nice! Long break earned ☕'
        : 'Focus done — quick break ☕';
    } else {
      nextMode = MODE_FOCUS;
      toastMsg = 'Break\'s up — ready to focus';
    }

    _chime();
    _fireNotification(completedMode === MODE_FOCUS ? 'Focus session complete' : 'Break\'s over',
      nextMode === MODE_FOCUS ? 'Time to focus — let\'s go!' : toastMsg);
    if (window.Toast) Toast.show(toastMsg, 'success');

    _resetTimerToMode(nextMode);
    _renderTimer();
    _refreshStats();
  }

  function _renderTimer() {
    const timeEl = document.getElementById('study-pomo-time');
    const labelEl = document.getElementById('study-pomo-label');
    const startBtn = document.getElementById('study-pomo-start');
    const startLabel = document.getElementById('study-pomo-start-label');
    const meta = document.getElementById('study-pomo-meta');
    const ringFg = document.querySelector('.study-pomo-ring-fg');
    if (!timeEl || !labelEl) return;

    // Compute remaining ms
    let remaining;
    if (_timerStatus === 'running') remaining = Math.max(0, _timerEndTs - Date.now());
    else remaining = _timerPauseRemaining;

    timeEl.textContent = _fmtTime(remaining);
    labelEl.textContent = _modeLabel(_timerMode);

    // Ring progress 0→1 (fills clockwise as time elapses)
    const progress = 1 - (remaining / _timerDurationMs);
    if (ringFg) {
      const dash = RING_CIRCUMFERENCE * (1 - progress);
      ringFg.style.strokeDashoffset = dash.toFixed(2);
    }

    // Mode-specific ring color — swap stroke when on a break
    const card = document.querySelector('.study-pomodoro');
    if (card) {
      card.classList.toggle('is-break', _timerMode !== MODE_FOCUS);
      card.classList.toggle('is-running', _timerStatus === 'running');
    }

    // Start/Pause button
    if (startBtn && startLabel) {
      if (_timerStatus === 'running') {
        startLabel.textContent = 'Pause';
        const svg = startBtn.querySelector('svg');
        if (svg) svg.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
      } else {
        startLabel.textContent = _timerStatus === 'paused' ? 'Resume' : 'Start';
        const svg = startBtn.querySelector('svg');
        if (svg) svg.innerHTML = '<polygon points="6 4 20 12 6 20 6 4"/>';
      }
    }

    if (meta) {
      const n = _prefs?.longBreakEvery || 4;
      const within = (_cycleInSequence % n) + 1;
      meta.textContent = _timerStatus === 'idle'
        ? `Cycle ${within} of ${n} · ready when you are`
        : `Cycle ${within} of ${n} · ${_timerStatus === 'paused' ? 'paused' : 'running'}`;
    }
  }

  function _fmtTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ── Chime (Web Audio — no asset file needed) ───────────────────────
  function _chime() {
    if (!_prefs?.soundEnabled) return;
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = _audioCtx;
      const now = ctx.currentTime;
      // Two soft sine tones — a pleasant "ding" rather than a beep.
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
    } catch (err) {
      // AudioContext can fail on some headless environments; silently ignore.
    }
  }

  function _fireNotification(title, body) {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'granted') {
        new Notification(title, { body, silent: true }); // silent — we play our own chime
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(p => {
          if (p === 'granted') new Notification(title, { body, silent: true });
        });
      }
    } catch { /* no-op */ }
  }

  // ── Deck list ──────────────────────────────────────────────────────
  function _renderDeckList() {
    const host = document.getElementById('study-deck-list');
    if (!host) return;
    host.innerHTML = '';
    if (!_decks.length) {
      host.innerHTML = `
        <div class="study-deck-empty">
          <p>No decks yet.</p>
          <p class="study-deck-empty-sub">Create one manually or ask Bloom to generate flashcards from a note.</p>
        </div>`;
      return;
    }
    for (const d of _decks) {
      const row = document.createElement('div');
      row.className = 'study-deck-row';
      row.dataset.deckId = d.id;
      const safeName = document.createTextNode(d.name);
      const nameEl = document.createElement('div');
      nameEl.className = 'study-deck-name';
      nameEl.appendChild(safeName);
      const countsEl = document.createElement('div');
      countsEl.className = 'study-deck-counts';
      const hasDue = (d.dueCount + d.newCount) > 0;
      countsEl.innerHTML = hasDue
        ? `<span class="study-deck-due">${d.dueCount + d.newCount} due</span> <span class="study-deck-total">· ${d.cardCount} cards</span>`
        : `<span class="study-deck-total">${d.cardCount} cards · all caught up ✨</span>`;
      const actions = document.createElement('div');
      actions.className = 'study-deck-actions';
      actions.innerHTML = `
        <button class="study-icon-btn" data-action="study" title="Study deck" aria-label="Study this deck">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <button class="study-icon-btn" data-action="edit" title="Edit deck" aria-label="Edit deck">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        </button>
        <button class="study-icon-btn study-icon-btn-danger" data-action="delete" title="Delete deck" aria-label="Delete deck">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>`;
      row.appendChild(nameEl);
      row.appendChild(countsEl);
      row.appendChild(actions);
      host.appendChild(row);
    }
  }

  async function _onDeckListClick(e) {
    const btn = e.target.closest('.study-icon-btn');
    const row = e.target.closest('.study-deck-row');
    if (!row) return;
    const deckId = row.dataset.deckId;
    if (!deckId) return;

    if (btn) {
      const action = btn.dataset.action;
      if (action === 'study') _openStudyMode(deckId);
      else if (action === 'edit') _openDeckEditor(deckId);
      else if (action === 'delete') _deleteDeck(deckId);
      return;
    }
    // Row click (not on a button) → open study mode as default action
    _openStudyMode(deckId);
  }

  async function _deleteDeck(deckId) {
    const deck = _decks.find(d => d.id === deckId);
    if (!deck) return;
    const ok = await (window.Confirm
      ? Confirm.show(`Delete "${deck.name}"? This removes all ${deck.cardCount} cards.`, 'Delete deck')
      : Promise.resolve(confirm(`Delete "${deck.name}"?`)));
    if (!ok) return;
    try {
      await window.electronAPI.study.deleteDeck(deckId);
      await _refreshDecks();
      if (window.Toast) Toast.show('Deck deleted', 'success');
    } catch (err) {
      if (window.Toast) Toast.show('Failed to delete deck', 'error');
    }
  }

  async function _refreshDecks() {
    _decks = await window.electronAPI.study.listDecks();
    // Re-render whichever surface is currently visible.
    if (_subView === SV_FLASHCARDS) _renderDeckList();
    if (_subView === SV_HUB) {
      _renderRecentDecks();
      _updateHubTileMeta();
    }
  }

  // ── Hub: Recent decks (top 3 most recent) ─────────────────────────
  function _renderRecentDecks() {
    const host = document.getElementById('study-recent-deck-list');
    if (!host) return;
    host.innerHTML = '';
    const recent = (_decks || []).slice(0, 3);
    if (!recent.length) {
      host.innerHTML = `
        <div class="study-deck-empty study-deck-empty-compact">
          <p class="study-deck-empty-sub">No decks yet — open the Flashcards tab below to make your first one.</p>
        </div>`;
      return;
    }
    for (const d of recent) {
      // Proper semantic link row — role=button + tabindex so keyboard
      // users can Tab to a deck and press Enter/Space to study it.
      // aria-label bakes the deck name + due count into a single
      // announcement for screen readers rather than making them parse
      // the separate count span.
      const row = document.createElement('div');
      row.className = 'study-deck-row';
      row.dataset.deckId = d.id;
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      const due = d.dueCount + d.newCount;
      const aria = due > 0
        ? `Study ${d.name} — ${due} card${due === 1 ? '' : 's'} due of ${d.cardCount}`
        : `Study ${d.name} — ${d.cardCount} card${d.cardCount === 1 ? '' : 's'}, all caught up`;
      row.setAttribute('aria-label', aria);

      const nameEl = document.createElement('div');
      nameEl.className = 'study-deck-name';
      nameEl.textContent = d.name;
      const countsEl = document.createElement('div');
      countsEl.className = 'study-deck-counts';
      countsEl.setAttribute('aria-hidden', 'true'); // aria-label on row covers this
      countsEl.innerHTML = due > 0
        ? `<span class="study-deck-due">${due} due</span> <span class="study-deck-total">· ${d.cardCount} cards</span>`
        : `<span class="study-deck-total">${d.cardCount} cards · all caught up ✨</span>`;
      const actions = document.createElement('div');
      actions.className = 'study-deck-actions';
      // The play chevron is now just a visual affordance — the whole
      // row is clickable, so the button inside it would be a redundant
      // double-activation target. Keep the chevron for visual clarity
      // but mark it aria-hidden + tabindex=-1 so it doesn't steal focus
      // or announce twice.
      actions.innerHTML = `
        <span class="study-icon-btn" data-action="study" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </span>`;
      row.appendChild(nameEl);
      row.appendChild(countsEl);
      row.appendChild(actions);
      host.appendChild(row);
    }
  }

  // Hub's "Recent decks" list acts as a hard link into studying that
  // deck — click anywhere on a row, or focus it and press Enter/Space,
  // and study mode opens directly. Previously clicking the row
  // navigated to the Flashcards management page and forced a second
  // click on the play button; this surface is optimized for "I know
  // exactly which deck I want to review right now."
  function _onRecentDeckListClick(e) {
    const row = e.target.closest('.study-deck-row');
    if (!row) return;
    const deckId = row.dataset.deckId;
    if (!deckId) return;
    _openStudyMode(deckId);
  }

  // Keyboard activation — matches button semantics (role=button).
  function _onRecentDeckListKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest?.('.study-deck-row');
    if (!row) return;
    e.preventDefault(); // Space would scroll the page otherwise
    const deckId = row.dataset.deckId;
    if (!deckId) return;
    _openStudyMode(deckId);
  }

  // Update the bottom-tile meta strings on the hub (e.g. "3 decks · 17 due")
  function _updateHubTileMeta() {
    const pomoEl = document.getElementById('study-tile-pomo-meta');
    if (pomoEl && _prefs) {
      pomoEl.textContent = `${_prefs.focus} min focus · ${_prefs.shortBreak} min break`;
    }
    const cardsEl = document.getElementById('study-tile-cards-meta');
    if (cardsEl) {
      const deckCount = (_decks || []).length;
      const dueTotal = (_decks || []).reduce((s, d) => s + d.dueCount + d.newCount, 0);
      if (deckCount === 0) cardsEl.textContent = 'No decks yet';
      else if (dueTotal === 0) cardsEl.textContent = `${deckCount} deck${deckCount === 1 ? '' : 's'} · all caught up`;
      else cardsEl.textContent = `${deckCount} deck${deckCount === 1 ? '' : 's'} · ${dueTotal} card${dueTotal === 1 ? '' : 's'} due`;
    }
  }

  // ── Sync chip (Flashcards page top-right) ─────────────────────────
  // Renders the "Synced 2 min ago" / "Syncing…" / "Sign in to sync"
  // status pill, plus a click handler that triggers an immediate sync
  // (no-op if disabled / already in flight).
  function _renderSyncChip(status) {
    const chip = document.getElementById('study-sync-chip');
    const label = document.getElementById('study-sync-chip-label');
    if (!chip || !label) return; // not on flashcards sub-view right now
    const s = status || _syncStatus;

    chip.classList.remove('is-syncing', 'is-error', 'is-disabled', 'is-idle');
    chip.removeAttribute('disabled');

    if (!s.authed) {
      chip.classList.add('is-disabled');
      chip.setAttribute('disabled', 'true');
      label.textContent = 'Sign in to sync';
      chip.title = 'Sign in to Google in Settings to sync decks across devices';
      return;
    }
    if (s.state === 'syncing') {
      chip.classList.add('is-syncing');
      label.textContent = s.message || 'Syncing…';
      chip.title = 'Sync in progress';
      return;
    }
    if (s.state === 'error') {
      chip.classList.add('is-error');
      label.textContent = s.message || 'Sync failed';
      chip.title = 'Click to retry';
      return;
    }
    if (s.state === 'disabled') {
      chip.classList.add('is-disabled');
      label.textContent = s.message || 'Sync disabled';
      return;
    }
    // idle / success
    chip.classList.add('is-idle');
    if (s.pendingCount > 0) {
      label.textContent = `${s.pendingCount} pending`;
      chip.title = 'Click to sync now';
    } else if (s.lastSyncAt) {
      label.textContent = `Synced ${_formatRelative(s.lastSyncAt)}`;
      chip.title = `Last synced ${new Date(s.lastSyncAt).toLocaleString()}`;
    } else {
      label.textContent = 'Sync now';
      chip.title = 'Click to sync now';
    }
  }

  function _formatRelative(ts) {
    const diffSec = Math.max(0, (Date.now() - ts) / 1000);
    if (diffSec < 30) return 'just now';
    if (diffSec < 90) return '1 min ago';
    if (diffSec < 3600) return `${Math.round(diffSec / 60)} min ago`;
    if (diffSec < 7200) return '1 hr ago';
    if (diffSec < 86400) return `${Math.round(diffSec / 3600)} hr ago`;
    return `${Math.round(diffSec / 86400)} day${diffSec >= 172800 ? 's' : ''} ago`;
  }

  function _onSyncChipClick() {
    if (!_syncStatus?.authed) return;
    if (_syncStatus.state === 'syncing') return;
    window.electronAPI.study.syncNow().catch(() => {});
  }

  // ── Stats card ─────────────────────────────────────────────────────
  function _renderStats() {
    if (!_stats) return;
    const { today, week, streak, goal } = _stats;
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
    setText('study-today-min', today.focusMin || 0);
    setText('study-today-reviews', today.cardsReviewed || 0);
    setText('study-today-cycles', today.cyclesCompleted || 0);
    const streakEl = document.getElementById('study-streak');
    if (streakEl) streakEl.textContent = `🔥 ${streak || 0}`;

    // Goal bar
    const goalMin = goal?.dailyMin || 30;
    const pct = Math.min(100, ((today.focusMin || 0) / goalMin) * 100);
    const fill = document.getElementById('study-goal-fill');
    const goalText = document.getElementById('study-goal-text');
    if (fill) fill.style.width = `${pct.toFixed(1)}%`;
    if (goalText) {
      goalText.textContent = pct >= 100
        ? `Daily goal: ${goalMin} min ✓`
        : `Daily goal: ${goalMin} min · ${goalMin - (today.focusMin || 0)} to go`;
    }

    // 7-day chart
    const chart = document.getElementById('study-chart');
    if (chart) {
      const maxMin = Math.max(1, ...week.map(w => w.focusMin));
      const cols = Array.from(chart.querySelectorAll('.study-chart-col'));
      week.forEach((w, i) => {
        const col = cols[i];
        if (!col) return;
        const bar = col.querySelector('.study-chart-bar');
        const label = col.querySelector('.study-chart-label');
        const pct = maxMin > 0 ? (w.focusMin / maxMin) * 100 : 0;
        if (bar) {
          bar.style.height = `${Math.max(4, pct).toFixed(1)}%`;
          // Dim past days with zero activity, highlight today
          bar.classList.toggle('is-empty', w.focusMin === 0);
          bar.classList.toggle('is-today', i === week.length - 1);
          bar.title = `${w.focusMin} min · ${w.cardsReviewed} cards`;
        }
        if (label) {
          // Last letter of weekday — M T W T F S S
          const d = new Date(w.date + 'T00:00:00');
          label.textContent = d.toLocaleDateString(undefined, { weekday: 'narrow' });
        }
      });
    }
  }

  async function _refreshStats() {
    try {
      _stats = await window.electronAPI.study.getStats();
      _renderStats();
    } catch (err) { /* quiet */ }
  }

  // ── Deck editor modal (manual deck CRUD) ───────────────────────────
  async function _openDeckEditor(deckId) {
    const isNew = !deckId;
    let deck = null;
    if (!isNew) {
      deck = await window.electronAPI.study.getDeck(deckId);
      if (!deck) { if (window.Toast) Toast.show('Deck not found', 'error'); return; }
    }

    const overlay = document.createElement('div');
    overlay.className = 'study-modal-overlay';
    overlay.innerHTML = `
      <div class="glass-card study-modal" role="dialog" aria-label="${isNew ? 'New deck' : 'Edit deck'}">
        <div class="study-modal-head">
          <h3>${isNew ? 'New deck' : 'Edit deck'}</h3>
          <button class="study-icon-btn" data-action="close" aria-label="Close"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="study-modal-body">
          <label class="study-field">
            <span>Deck name</span>
            <input type="text" id="study-deck-name" maxlength="120" placeholder="e.g. Biology — Cell Division"/>
          </label>
          <div class="study-cards-head">
            <h4>Cards</h4>
            <button class="study-btn study-btn-sm" id="study-add-card">+ Add card</button>
          </div>
          <div class="study-cards-list" id="study-cards-list"></div>
        </div>
        <div class="study-modal-foot">
          <button class="study-btn" data-action="close">Cancel</button>
          <button class="study-btn study-btn-primary" data-action="save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const nameInput = overlay.querySelector('#study-deck-name');
    const cardsList = overlay.querySelector('#study-cards-list');
    nameInput.value = deck?.name || '';

    const drafts = deck?.cards?.map(c => ({ id: c.id, front: c.front, back: c.back })) || [];

    function renderCards() {
      cardsList.innerHTML = '';
      if (!drafts.length) {
        cardsList.innerHTML = `<div class="study-deck-empty" style="padding:16px 0;"><p class="study-deck-empty-sub">No cards yet. Click "+ Add card" to begin.</p></div>`;
        return;
      }
      drafts.forEach((c, idx) => {
        const row = document.createElement('div');
        row.className = 'study-card-row';
        row.innerHTML = `
          <div class="study-card-inputs">
            <textarea class="study-card-front" rows="2" placeholder="Front"></textarea>
            <textarea class="study-card-back" rows="2" placeholder="Back"></textarea>
          </div>
          <button class="study-icon-btn study-icon-btn-danger" data-action="remove-card" aria-label="Remove card">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>`;
        const frontEl = row.querySelector('.study-card-front');
        const backEl = row.querySelector('.study-card-back');
        frontEl.value = c.front;
        backEl.value = c.back;
        frontEl.addEventListener('input', () => { drafts[idx].front = frontEl.value; });
        backEl.addEventListener('input', () => { drafts[idx].back = backEl.value; });
        row.querySelector('[data-action="remove-card"]').addEventListener('click', () => {
          drafts.splice(idx, 1);
          renderCards();
        });
        cardsList.appendChild(row);
      });
    }
    renderCards();

    overlay.querySelector('#study-add-card').addEventListener('click', () => {
      drafts.push({ front: '', back: '' });
      renderCards();
      // Focus the new card's front
      const lastFront = cardsList.querySelectorAll('.study-card-front');
      lastFront[lastFront.length - 1]?.focus();
    });

    function close() { overlay.remove(); }
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'close') close();
      else if (action === 'save') save();
    });

    async function save() {
      const name = nameInput.value.trim();
      if (!name) { if (window.Toast) Toast.show('Name is required', 'error'); return; }
      try {
        if (isNew) {
          const validCards = drafts.filter(c => c.front.trim() || c.back.trim());
          await window.electronAPI.study.createDeck({ name, cards: validCards });
        } else {
          await window.electronAPI.study.updateDeck(deckId, { name });
          // Diff cards: update existing, add new, delete removed
          const originalIds = new Set((deck.cards || []).map(c => c.id));
          const keepIds = new Set(drafts.filter(d => d.id).map(d => d.id));
          // Delete removed
          for (const origId of originalIds) {
            if (!keepIds.has(origId)) {
              await window.electronAPI.study.deleteCard(deckId, origId);
            }
          }
          // Update existing, add new
          for (const d of drafts) {
            const hasContent = (d.front || '').trim() || (d.back || '').trim();
            if (!hasContent) continue;
            if (d.id) {
              await window.electronAPI.study.updateCard(deckId, d.id, { front: d.front, back: d.back });
            } else {
              await window.electronAPI.study.addCard(deckId, { front: d.front, back: d.back });
            }
          }
        }
        close();
        await _refreshDecks();
        if (window.Toast) Toast.show(isNew ? 'Deck created' : 'Deck saved', 'success');
      } catch (err) {
        console.error('Save deck failed:', err);
        if (window.Toast) Toast.show('Failed to save deck', 'error');
      }
    }

    // Esc to close
    const escHandler = (e) => {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    nameInput.focus();
  }

  // ── Pomodoro settings modal ────────────────────────────────────────
  function _openPomoSettings() {
    const overlay = document.createElement('div');
    overlay.className = 'study-modal-overlay';
    overlay.innerHTML = `
      <div class="glass-card study-modal study-modal-sm" role="dialog" aria-label="Pomodoro settings">
        <div class="study-modal-head">
          <h3>Pomodoro settings</h3>
          <button class="study-icon-btn" data-action="close" aria-label="Close"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="study-modal-body">
          <label class="study-field"><span>Focus length (min)</span>
            <input type="number" id="pref-focus" min="1" max="120" value="${_prefs.focus}"/></label>
          <label class="study-field"><span>Short break (min)</span>
            <input type="number" id="pref-short" min="1" max="60" value="${_prefs.shortBreak}"/></label>
          <label class="study-field"><span>Long break (min)</span>
            <input type="number" id="pref-long" min="1" max="60" value="${_prefs.longBreak}"/></label>
          <label class="study-field"><span>Long break every N cycles</span>
            <input type="number" id="pref-every" min="2" max="10" value="${_prefs.longBreakEvery}"/></label>
          <label class="study-field"><span>Daily focus goal (min)</span>
            <input type="number" id="pref-goal" min="5" max="300" value="${_prefs.dailyGoalMin}"/></label>
          <label class="study-field"><span>New cards per day (SRS pacing)</span>
            <input type="number" id="pref-newcards" min="1" max="2000" value="${_prefs.newCardsPerDay}"/></label>
          <label class="study-field study-field-row">
            <input type="checkbox" id="pref-sound" ${_prefs.soundEnabled ? 'checked' : ''}/>
            <span>Play chime on cycle complete</span>
          </label>
        </div>
        <div class="study-modal-foot">
          <button class="study-btn" data-action="close">Cancel</button>
          <button class="study-btn study-btn-primary" data-action="save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    overlay.addEventListener('click', async (e) => {
      if (e.target === overlay) { close(); return; }
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'close') close();
      else if (action === 'save') {
        const patch = {
          focus: parseInt(overlay.querySelector('#pref-focus').value, 10),
          shortBreak: parseInt(overlay.querySelector('#pref-short').value, 10),
          longBreak: parseInt(overlay.querySelector('#pref-long').value, 10),
          longBreakEvery: parseInt(overlay.querySelector('#pref-every').value, 10),
          dailyGoalMin: parseInt(overlay.querySelector('#pref-goal').value, 10),
          newCardsPerDay: parseInt(overlay.querySelector('#pref-newcards').value, 10),
          soundEnabled: overlay.querySelector('#pref-sound').checked,
        };
        try {
          _prefs = await window.electronAPI.study.setPrefs(patch);
          // Reset timer to new duration if idle (don't disrupt a running session)
          if (_timerStatus === 'idle') _resetTimerToMode(_timerMode);
          _renderTimer();
          _renderStats();
          // If we're on the hub the tile meta strings reference _prefs
          if (_subView === SV_HUB) _updateHubTileMeta();
          close();
          if (window.Toast) Toast.show('Settings saved', 'success');
        } catch (err) {
          if (window.Toast) Toast.show('Failed to save settings', 'error');
        }
      }
    });
    const escHandler = (e) => {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
  }

  // ── Study mode (flashcard review overlay) ──────────────────────────
  // Quizlet-style flashcard runner. Module-level _study object holds the
  // session state:
  //   { deckId, deckName, queue, idx, flipped, startedAt, reviewed,
  //     gradedIds: Set<cardId>, complete: bool }
  //
  // gradedIds tracks which cards were graded *this session* so going Back
  // and re-grading doesn't double-count the cards-reviewed counter. The
  // SM-2 state on disk gets the latest grade either way (last-write-wins).

  async function _openStudyMode(deckId, { studyAll = false } = {}) {
    try {
      const deck = await window.electronAPI.study.getDeck(deckId);
      if (!deck) { if (window.Toast) Toast.show('Deck not found', 'error'); return; }
      // Fetch BOTH: the normal (cap-respecting) queue and the full
      // uncapped queue. Comparing lengths tells us whether the daily
      // new-card cap is limiting the user, which drives the "Showing
      // N of M" hint + end-of-session "Study N more" button.
      const [cappedQueue, fullQueue] = await Promise.all([
        window.electronAPI.study.getDueCards(deckId),
        window.electronAPI.study.getDueCards(deckId, { ignoreLimit: true }),
      ]);
      if (!cappedQueue || !fullQueue) { if (window.Toast) Toast.show('Deck not found', 'error'); return; }
      const queue = studyAll ? fullQueue : cappedQueue;
      if (!queue.length) {
        if (window.Toast) Toast.show('No cards due — all caught up ✨', 'success');
        return;
      }
      _study = {
        deckId,
        deckName: deck.name,
        queue,
        idx: 0,
        flipped: false,
        startedAt: Date.now(),
        reviewed: 0,
        gradedIds: new Set(),
        complete: false,
        // Track capping state so the overlay UI can surface it.
        // `totalAvailable` = cards the user could study if they bypass
        // the cap; `isCapped` = we're currently hiding some.
        totalAvailable: fullQueue.length,
        isCapped: !studyAll && fullQueue.length > cappedQueue.length,
      };
      _renderStudyOverlay();
    } catch (err) {
      console.error('Open study mode failed:', err);
      if (window.Toast) Toast.show('Failed to open deck', 'error');
    }
  }

  function _renderStudyOverlay() {
    if (!_study) return;
    let overlay = document.querySelector('.study-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'study-overlay';
      document.body.appendChild(overlay);
      if (!_escListener) {
        _escListener = (e) => { if (e.key === 'Escape') _closeStudyMode(true); };
        document.addEventListener('keydown', _escListener);
      }
    }

    // End-of-session screen takes priority — once we hit the end of the
    // queue we render a summary instead of trying to read off the queue.
    if (_study.complete) {
      _renderStudyEndScreen(overlay);
      return;
    }

    const card = _study.queue[_study.idx];
    if (!card) { _closeStudyMode(true); return; }

    const total = _study.queue.length;
    const progressPct = ((_study.idx) / total) * 100;
    const isStarred = !!card.starred;
    const alreadyGraded = _study.gradedIds.has(card.id);

    overlay.innerHTML = `
      <div class="study-overlay-bar">
        <div class="study-overlay-meta">
          <div class="study-overlay-title">${_escapeHtml(_study.deckName)}</div>
          <div class="study-overlay-progress">${_study.idx + 1} / ${total}${_study.isCapped ? ` <span class="study-capped-pill" title="Daily new-card cap (adjust in Settings → Pomodoro). Click to study all ${_study.totalAvailable}.">of ${_study.totalAvailable}</span>` : ''}</div>
        </div>
        <div class="study-overlay-actions">
          ${_study.isCapped ? `<button class="study-icon-btn study-study-all-btn" id="study-study-all-btn" title="Study all ${_study.totalAvailable} cards (bypass daily cap)" aria-label="Study all cards">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="14" height="12" rx="2"/><path d="M7 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2"/></svg>
          </button>` : ''}
          <button class="study-icon-btn" id="study-shuffle-btn" title="Shuffle remaining cards" aria-label="Shuffle">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
          </button>
          <button class="study-icon-btn" id="study-restart-btn" title="Restart session" aria-label="Restart">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <button class="study-icon-btn" id="study-overlay-close" title="Exit (Esc)" aria-label="Exit">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <div class="study-progress-track" aria-hidden="true">
        <div class="study-progress-fill" style="width:${progressPct.toFixed(2)}%"></div>
      </div>

      <div class="study-flashcard-stage">
        <button class="study-nav-btn study-nav-prev" id="study-prev-btn"
                ${_study.idx === 0 ? 'disabled' : ''}
                title="Previous card (←)" aria-label="Previous card">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>

        <div class="study-flashcard-wrap">
          <div class="study-flashcard ${_study.flipped ? 'is-flipped' : ''}" id="study-flashcard" tabindex="0"
               role="button" aria-pressed="${_study.flipped}" aria-label="Flashcard — click or press space to flip">
            <div class="study-flashcard-inner">
              <div class="study-flashcard-face study-flashcard-front">
                <div class="study-flashcard-topbar">
                  <div class="study-flashcard-kind">Question</div>
                  <button class="study-star-btn ${isStarred ? 'is-starred' : ''}" data-action="star" title="${isStarred ? 'Unstar' : 'Star'} (S)" aria-label="${isStarred ? 'Unstar card' : 'Star card'}" aria-pressed="${isStarred}">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="${isStarred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  </button>
                </div>
                <div class="study-flashcard-content">${_escapeHtml(card.front) || '<em style="opacity:0.5">Empty front</em>'}</div>
                <div class="study-flashcard-hint">Click or press space to flip</div>
              </div>
              <div class="study-flashcard-face study-flashcard-back">
                <div class="study-flashcard-topbar">
                  <div class="study-flashcard-kind">Answer</div>
                  <button class="study-star-btn ${isStarred ? 'is-starred' : ''}" data-action="star" title="${isStarred ? 'Unstar' : 'Star'} (S)" aria-label="${isStarred ? 'Unstar card' : 'Star card'}" aria-pressed="${isStarred}">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="${isStarred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  </button>
                </div>
                <div class="study-flashcard-content">${_escapeHtml(card.back) || '<em style="opacity:0.5">Empty back</em>'}</div>
              </div>
            </div>
          </div>
        </div>

        <button class="study-nav-btn study-nav-next" id="study-next-btn"
                title="Next card (→)" aria-label="Next card">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      <div class="study-grade-bar ${_study.flipped ? '' : 'is-hidden'}">
        ${alreadyGraded ? '<div class="study-grade-note">Already graded this session — re-grading will replace your earlier answer.</div>' : ''}
        <div class="study-grade-buttons">
          <button class="study-grade-btn study-grade-again" data-grade="1">
            <span class="study-grade-label">Again</span>
            <span class="study-grade-hint">1</span>
          </button>
          <button class="study-grade-btn study-grade-hard" data-grade="2">
            <span class="study-grade-label">Hard</span>
            <span class="study-grade-hint">2</span>
          </button>
          <button class="study-grade-btn study-grade-good" data-grade="3">
            <span class="study-grade-label">Good</span>
            <span class="study-grade-hint">3</span>
          </button>
          <button class="study-grade-btn study-grade-easy" data-grade="4">
            <span class="study-grade-label">Easy</span>
            <span class="study-grade-hint">4</span>
          </button>
        </div>
      </div>`;

    // Wire handlers (everything is replaced on each render, so we don't
    // need to detach old listeners — they're gone with the old DOM).
    overlay.querySelector('#study-overlay-close').addEventListener('click', () => _closeStudyMode(true));
    overlay.querySelector('#study-flashcard').addEventListener('click', _flipCard);
    overlay.querySelector('#study-prev-btn').addEventListener('click', _prevCard);
    overlay.querySelector('#study-next-btn').addEventListener('click', _nextCard);
    overlay.querySelector('#study-shuffle-btn').addEventListener('click', _shuffleQueue);
    overlay.querySelector('#study-restart-btn').addEventListener('click', _restartSession);
    // Conditional — only exists when the queue is capped by daily limit.
    overlay.querySelector('#study-study-all-btn')?.addEventListener('click', _studyAllCards);
    overlay.querySelectorAll('.study-grade-btn').forEach(btn => {
      btn.addEventListener('click', () => _gradeCard(parseInt(btn.dataset.grade, 10)));
    });
    overlay.querySelectorAll('.study-star-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // don't trigger flip via the parent .study-flashcard click
        _toggleStarCurrent();
      });
    });

    overlay.tabIndex = -1;
    overlay.focus();

    // Single delegated keyboard handler — full Quizlet-style shortcut set.
    if (overlay._keyHandler) overlay.removeEventListener('keydown', overlay._keyHandler);
    overlay._keyHandler = (e) => {
      // Skip when an input/textarea has focus (none in this overlay
      // currently, but defensive against future additions).
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        _flipCard();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        _prevCard();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        _nextCard();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        _toggleStarCurrent();
      } else if (_study?.flipped && ['1','2','3','4'].includes(e.key)) {
        _gradeCard(parseInt(e.key, 10));
      }
    };
    overlay.addEventListener('keydown', overlay._keyHandler);
  }

  // ── End-of-session summary ───────────────────────────────────────────
  function _renderStudyEndScreen(overlay) {
    const reviewed = _study.reviewed;
    const total = _study.queue.length;
    const starredCount = _study.queue.filter(c => c.starred).length;
    const minutes = Math.max(1, Math.round((Date.now() - _study.startedAt) / 60000));
    // If the user studied under a daily cap, there may still be more
    // new cards available. Offer a "Study N more" button to cram past
    // the cap without leaving the flow.
    const moreAvailable = _study.isCapped
      ? Math.max(0, (_study.totalAvailable || 0) - total)
      : 0;

    overlay.innerHTML = `
      <div class="study-overlay-bar">
        <div class="study-overlay-meta">
          <div class="study-overlay-title">${_escapeHtml(_study.deckName)}</div>
          <div class="study-overlay-progress">Session complete</div>
        </div>
        <div class="study-overlay-actions">
          <button class="study-icon-btn" id="study-overlay-close" title="Exit (Esc)" aria-label="Exit">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="study-end-screen">
        <div class="study-end-medal">🎉</div>
        <h2 class="study-end-title">Session complete</h2>
        <p class="study-end-sub">You reviewed <strong>${reviewed}</strong> card${reviewed === 1 ? '' : 's'} in <strong>${minutes}</strong> min${minutes === 1 ? '' : 's'}${starredCount > 0 ? ` — and starred ${starredCount}` : ''}.</p>
        <div class="study-end-actions">
          ${moreAvailable > 0 ? `
          <button class="study-btn study-btn-primary" id="study-end-more">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/><polyline points="2 18 8 12 2 6"/></svg>
            Study ${moreAvailable} more
          </button>` : `
          <button class="study-btn study-btn-primary" id="study-end-again">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Study deck again
          </button>`}
          ${starredCount > 0 ? `
          <button class="study-btn" id="study-end-starred">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            Study ${starredCount} starred
          </button>` : ''}
          <button class="study-btn" id="study-end-exit">Done</button>
        </div>
      </div>`;

    overlay.querySelector('#study-overlay-close').addEventListener('click', () => _closeStudyMode(false));
    overlay.querySelector('#study-end-exit').addEventListener('click', () => _closeStudyMode(false));
    overlay.querySelector('#study-end-again')?.addEventListener('click', _restartSession);
    overlay.querySelector('#study-end-more')?.addEventListener('click', _studyAllCards);
    overlay.querySelector('#study-end-starred')?.addEventListener('click', _studyStarredOnly);
  }

  // ── Card actions ──────────────────────────────────────────────────────
  // Flipping is the ONE state change in this overlay that we don't do via
  // a full re-render. The flip is a 600ms CSS transition on
  // .study-flashcard-inner's transform (rotateY 0 → 180), and that
  // transition only plays if we toggle the `is-flipped` class on a DOM
  // element that ALREADY EXISTS in the page. A full innerHTML rebuild
  // would create a fresh element with `is-flipped` already set, and the
  // transition would have nothing to interpolate from — so the card
  // would just appear already flipped (no animation). Toggle in place.
  function _flipCard() {
    if (!_study || _study.complete) return;
    _study.flipped = !_study.flipped;
    const cardEl = document.getElementById('study-flashcard');
    const gradeBar = document.querySelector('.study-overlay .study-grade-bar');
    if (cardEl) {
      cardEl.classList.toggle('is-flipped', _study.flipped);
      cardEl.setAttribute('aria-pressed', String(_study.flipped));
    }
    if (gradeBar) {
      gradeBar.classList.toggle('is-hidden', !_study.flipped);
    }
    // If we somehow got called before the card was rendered (race on
    // overlay init), fall back to a full render so we don't desync.
    if (!cardEl) _renderStudyOverlay();
  }

  function _prevCard() {
    if (!_study || _study.complete) return;
    if (_study.idx === 0) return;
    _study.idx--;
    _study.flipped = false;
    _renderStudyOverlay();
  }

  function _nextCard() {
    if (!_study || _study.complete) return;
    if (_study.idx >= _study.queue.length - 1) {
      // Past the last card — show end screen.
      _study.complete = true;
      _renderStudyOverlay();
      _logSessionIfNeeded();
      return;
    }
    _study.idx++;
    _study.flipped = false;
    _renderStudyOverlay();
  }

  async function _gradeCard(grade) {
    if (!_study || !_study.flipped || _study.complete) return;
    const card = _study.queue[_study.idx];
    if (!card) return;
    try {
      await window.electronAPI.study.recordReview(_study.deckId, card.id, grade);
      // Only count the FIRST grade for this card per session — re-grading
      // replaces the SM-2 state but doesn't inflate the cards-reviewed counter.
      if (!_study.gradedIds.has(card.id)) {
        _study.reviewed++;
        _study.gradedIds.add(card.id);
      }
    } catch (err) {
      console.warn('record-review failed:', err);
    }
    // Auto-advance to next card on grade (Quizlet-style flow). If we're
    // on the last card, _nextCard will switch to the end screen.
    _nextCard();
  }

  // ── Star ─────────────────────────────────────────────────────────────
  // Same in-place pattern as _flipCard — if the user stars mid-flip, a
  // full re-render would tear down .study-flashcard-inner and abort the
  // 600ms rotateY animation. Toggle the visual state on existing nodes
  // (both faces have a star button) and persist optimistically.
  async function _toggleStarCurrent() {
    if (!_study || _study.complete) return;
    const card = _study.queue[_study.idx];
    if (!card) return;
    const next = !card.starred;
    card.starred = next;

    // Update both face's star buttons (front + back share state).
    document.querySelectorAll('.study-overlay .study-star-btn').forEach(btn => {
      btn.classList.toggle('is-starred', next);
      btn.setAttribute('aria-pressed', String(next));
      btn.setAttribute('aria-label', next ? 'Unstar card' : 'Star card');
      btn.setAttribute('title', `${next ? 'Unstar' : 'Star'} (S)`);
      const svg = btn.querySelector('svg');
      if (svg) svg.setAttribute('fill', next ? 'currentColor' : 'none');
    });

    try {
      await window.electronAPI.study.updateCard(_study.deckId, card.id, { starred: next });
    } catch (err) {
      console.warn('toggle star failed:', err);
    }
  }

  // ── Shuffle / Restart ────────────────────────────────────────────────
  async function _shuffleQueue() {
    if (!_study || _study.complete) return;
    if (_study.queue.length < 2) return;
    // Fisher-Yates on the REMAINING cards (idx..end). Cards already
    // shown stay in place so the user keeps their position-in-history.
    const startFrom = _study.idx;
    const arr = _study.queue.slice(startFrom);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    _study.queue = [..._study.queue.slice(0, startFrom), ...arr];
    _study.flipped = false;
    _renderStudyOverlay();
    if (window.Toast) Toast.show('Shuffled remaining cards 🔀', 'success');
  }

  function _restartSession() {
    if (!_study) return;
    _study.idx = 0;
    _study.flipped = false;
    _study.complete = false;
    // Reset session counters for a clean slate (the SM-2 state on disk
    // already reflects whatever happened in the previous pass).
    _study.gradedIds = new Set();
    _study.reviewed = 0;
    _study.startedAt = Date.now();
    _renderStudyOverlay();
  }

  // Bypass the daily new-card cap. Re-fetch the full queue from the
   // store with ignoreLimit=true and swap it in. Keeps star-state and
   // any prior grading in the session (gradedIds carries forward).
  async function _studyAllCards() {
    if (!_study) return;
    try {
      const full = await window.electronAPI.study.getDueCards(_study.deckId, { ignoreLimit: true });
      if (!full || !full.length) return;
      _study.queue = full;
      _study.idx = 0;
      _study.flipped = false;
      _study.complete = false;
      _study.totalAvailable = full.length;
      _study.isCapped = false;
      _renderStudyOverlay();
      if (window.Toast) Toast.show(`Studying all ${full.length} cards — cap bypassed`, 'success');
    } catch (err) {
      if (window.Toast) Toast.show('Failed to load all cards', 'error');
    }
  }

  async function _studyStarredOnly() {
    if (!_study) return;
    const starred = _study.queue.filter(c => c.starred);
    if (!starred.length) return;
    _study.queue = starred;
    _study.idx = 0;
    _study.flipped = false;
    _study.complete = false;
    _study.gradedIds = new Set();
    _study.reviewed = 0;
    _study.startedAt = Date.now();
    _renderStudyOverlay();
    if (window.Toast) Toast.show(`Studying ${starred.length} starred card${starred.length === 1 ? '' : 's'} ⭐`, 'success');
  }

  // ── Session lifecycle ────────────────────────────────────────────────
  // Called when the user reaches the end of the queue (via grading the
  // last card or pressing Next on the last card). Logs the session +
  // refreshes hub stats; the end screen stays up so the user can choose
  // to study again. The overlay is dismissed on Done / Exit / Esc.
  async function _logSessionIfNeeded() {
    if (!_study) return;
    const reviewed = _study.reviewed;
    if (reviewed <= 0) return;
    try {
      await window.electronAPI.study.logSession({
        type: 'review',
        startedAt: _study.startedAt,
        durationMs: Date.now() - _study.startedAt,
        cardsReviewed: reviewed,
        deckId: _study.deckId,
      });
    } catch { /* quiet */ }
    await _refreshStats();
    await _refreshDecks();
  }

  function _closeStudyMode(logIfPartial) {
    if (!_study) return;
    const reviewed = _study.reviewed;
    const startedAt = _study.startedAt;
    const deckId = _study.deckId;
    const wasComplete = _study.complete;
    _study = null;
    const overlay = document.querySelector('.study-overlay');
    if (overlay) overlay.remove();
    if (_escListener) {
      document.removeEventListener('keydown', _escListener);
      _escListener = null;
    }
    // If user quit mid-session with at least one review (and we haven't
    // already logged it via _logSessionIfNeeded when hitting end-screen),
    // log it now so their stats reflect the work they actually did.
    if (logIfPartial && !wasComplete && reviewed > 0) {
      window.electronAPI.study.logSession({
        type: 'review',
        startedAt,
        durationMs: Date.now() - startedAt,
        cardsReviewed: reviewed,
        deckId,
      }).catch(() => {});
      _refreshStats().catch(() => {});
      _refreshDecks().catch(() => {});
    }
  }

  function _escapeHtml(s) {
    if (typeof s !== 'string') return '';
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br>');
  }

  return { render, init, destroy };
})();
