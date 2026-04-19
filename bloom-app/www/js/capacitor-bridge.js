// ─── Capacitor ↔ electronAPI bridge ─────────────────────────────────
//
// The renderer was built against Electron's `window.electronAPI` surface
// (see src/main/preload.js in the original project). In the Android APK
// there is no Electron, no IPC, no Node — but the renderer's views don't
// know that. Instead of rewriting every view, we stub `electronAPI` here
// so existing code continues to load without crashing, then gradually
// replace stubs with real Capacitor plugins as features land.
//
// Phase-1 posture: UI renders, interactive flows that require a backend
// show a friendly "not yet configured on mobile" toast and resolve with
// empty arrays / nulls / no-op listeners. Nothing throws. Nothing hangs.
//
// Plan for later phases:
//   - google-auth   → Capacitor Google Sign-In plugin + native OAuth
//   - secure-store  → Capacitor Preferences + Android Keystore (via a
//                     small native plugin we'll write)
//   - fs (notes/study/conversations) → Capacitor Filesystem API
//   - HTTP streaming → Capacitor Http plugin (SSE via chunked fetch)
//   - Notifications → @capacitor/local-notifications
//   - openExternal → @capacitor/browser

(() => {
  const noop = () => {};
  const asyncNull = async () => null;
  const asyncArr = async () => [];
  const asyncFalse = async () => false;
  const asyncOk = async () => ({ success: true });

  // ── Event bus for stream-* listeners ──────────────────────────────
  // Desktop uses IPC (`ipcRenderer.on('claude:stream-delta', cb)`).
  // We emulate the same callback contract here so the renderer's
  // chat/panel/sheet listeners keep working unchanged.
  const _listeners = Object.create(null);
  function _on(channel, cb) {
    if (typeof cb !== 'function') return noop;
    (_listeners[channel] ||= new Set()).add(cb);
    return () => _listeners[channel]?.delete(cb);
  }
  function _emit(channel, payload) {
    _listeners[channel]?.forEach(cb => {
      try { cb(payload); } catch (err) { console.error(`[bridge] listener for ${channel} threw:`, err); }
    });
  }

  // Legacy stub for listeners we haven't wired up yet — keeps the
  // "remove-listener" contract intact so callers can still call the
  // returned cleanup function safely.
  const listenerRet = () => noop;

  // In-flight AI stream abort handle. Only one stream at a time on
  // mobile (matching desktop).
  let _aiAbortCtrl = null;

  // Conversations persist to Capacitor Preferences under a single
  // `ai.conversations` key (array of convo objects). In-memory Map is
  // the hot path; every mutation writes the whole array back through
  // the bridge's debounced _persistStoreKey so survives app restart.
  // Matches desktop's "conversations live across sessions" behavior.
  const _conversations = new Map();
  const CONVO_STORE_KEY = 'ai.conversations';
  const CONVO_CAP = 100; // keep the last 100 — matches desktop policy

  function _persistConvos() {
    // Sort newest-first, cap, then serialize. `store.set` applies the
    // key allowlist + Preferences write.
    const list = Array.from(_conversations.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, CONVO_CAP);
    _persistStoreKey(CONVO_STORE_KEY, list);
  }

  function _appendConvo(id, role, content) {
    if (!id) return;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map(b => b?.text || '').filter(Boolean).join('\n')
        : String(content || '');
    if (!text) return;
    const c = _conversations.get(id) || { id, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    c.messages.push({ role, content: text, at: Date.now() });
    c.updatedAt = Date.now();
    if (!c.title && role === 'user') c.title = text.slice(0, 60);
    _conversations.set(id, c);
    _persistConvos();
    // Fire a lightweight event so the home "Recent Conversations" card
    // (and anything else interested) can re-render without having to
    // poll listConversations. Wrapped in try/catch because some very
    // old Android WebViews throw on constructing CustomEvent.
    try {
      window.dispatchEvent(new CustomEvent('bloom:conversations-changed', {
        detail: { id, role, messageCount: c.messages.length },
      }));
    } catch {}
  }

  // Track which platform is serving up the bridge, so app code can
  // conditionally short-circuit flows that we KNOW are unimplemented
  // (e.g. avoid even showing the "Sign in with Google" button in
  // settings instead of letting it fail).
  const PLATFORM = 'capacitor';

  // In-memory store shim used by every `electronAPI.store.*` call.
  // Persisted across reloads via Capacitor Preferences when available;
  // falls back to localStorage so local dev in a desktop browser still
  // persists. Never throws — the store is the renderer's main
  // persistence path, so failures there cascade everywhere.
  const _memory = new Map();
  const _keyAllowRe = /^[A-Za-z0-9._-]+$/;

  async function _loadStoreFromDisk() {
    try {
      if (window.Capacitor?.Plugins?.Preferences) {
        const { keys } = await window.Capacitor.Plugins.Preferences.keys();
        for (const k of keys || []) {
          const { value } = await window.Capacitor.Plugins.Preferences.get({ key: k });
          if (value != null) {
            try { _memory.set(k, JSON.parse(value)); } catch { _memory.set(k, value); }
          }
        }
        return;
      }
    } catch (err) { console.warn('[bridge] Preferences load failed:', err); }
    // localStorage fallback for desktop-browser preview
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith('bloom.')) continue;
        const raw = localStorage.getItem(k);
        try { _memory.set(k.slice(6), JSON.parse(raw)); } catch { _memory.set(k.slice(6), raw); }
      }
    } catch {}
  }

  async function _persistStoreKey(key, value) {
    try {
      if (window.Capacitor?.Plugins?.Preferences) {
        if (value === undefined) {
          await window.Capacitor.Plugins.Preferences.remove({ key });
        } else {
          await window.Capacitor.Plugins.Preferences.set({
            key, value: JSON.stringify(value),
          });
        }
        return;
      }
    } catch {}
    try {
      const sk = 'bloom.' + key;
      if (value === undefined) localStorage.removeItem(sk);
      else localStorage.setItem(sk, JSON.stringify(value));
    } catch {}
  }

  // Kick off store load before any views render. Views await
  // store.get() inline, so this promise is surfaced on `window._storeReady`
  // for app.js to await too.
  let _storeHydrated = false;
  window._storeReady = _loadStoreFromDisk().then(() => {
    // Once the in-memory store is hydrated, pull conversations back
    // into the _conversations Map so listConversations / getConversation
    // return them without a reload. The stored shape is an array —
    // rehydrate by id.
    try {
      const saved = _memory.get(CONVO_STORE_KEY);
      if (Array.isArray(saved)) {
        for (const c of saved) {
          if (c && c.id) _conversations.set(c.id, c);
        }
      }
    } catch {}
    _storeHydrated = true;
  });

  // ── Toast helper for "not yet implemented" ─────────────────────────
  function _notImpl(action) {
    if (window.Toast?.show) {
      window.Toast.show(`${action} — coming to mobile soon.`, 'info', 3500);
    } else {
      console.info(`[bridge] Not yet implemented on mobile: ${action}`);
    }
    return Promise.resolve(null);
  }

  // ── The electronAPI facade ─────────────────────────────────────────
  // Mirrors the preload.js shape so every `window.electronAPI.foo.bar()`
  // call in the renderer resolves without throwing. When a feature
  // actually gets wired up, swap its method here for a real Capacitor
  // plugin call; views don't need to change.
  const api = {
    // ── Key/value store ──
    store: {
      // Validate on every verb, not just set. A malformed key shouldn't
      // silently "work" on get/delete when set would have rejected it.
      get: async (key) => {
        if (!_keyAllowRe.test(String(key || ''))) return null;
        // Auto-await disk hydration if it hasn't completed yet. Without
        // this, callers that fire on app boot (app.js theme load,
        // header avatar restore, etc) saw an empty Map and had to be
        // individually patched to await _storeReady. Centralizing the
        // wait here means new callers don't need to know about the
        // race. After hydration this is a single bool check, no awaits.
        if (!_storeHydrated) {
          try { await window._storeReady; } catch {}
        }
        return _memory.get(key) ?? null;
      },
      set: async (key, value) => {
        if (!_keyAllowRe.test(String(key || ''))) throw new Error('Invalid key');
        _memory.set(key, value);
        _persistStoreKey(key, value);
        return true;
      },
      delete: async (key) => {
        if (!_keyAllowRe.test(String(key || ''))) return false;
        _memory.delete(key);
        _persistStoreKey(key, undefined);
        return true;
      },
      // Desktop exposes getSecure/setSecure backed by Electron safeStorage.
      // Capacitor Preferences already encrypts-at-rest on Android via the
      // platform keystore, so on mobile getSecure == get, setSecure == set.
      // Keep both so settings.js's save path doesn't throw a TypeError
      // and silently drop the OAuth client secret.
      getSecure: async (key) => {
        if (!_keyAllowRe.test(String(key || ''))) return null;
        return _memory.get(key) ?? null;
      },
      setSecure: async (key, value) => {
        if (!_keyAllowRe.test(String(key || ''))) throw new Error('Invalid key');
        _memory.set(key, value);
        _persistStoreKey(key, value);
        return true;
      },
    },

    // ── App / system ──
    app: {
      openExternal: async (url) => {
        try {
          if (window.Capacitor?.Plugins?.Browser) {
            await window.Capacitor.Plugins.Browser.open({ url });
            return;
          }
        } catch {}
        window.open(url, '_blank'); // browser-preview fallback
      },
      getVersion: async () => '1.0.0-mobile',
      getPlatform: async () => PLATFORM,
      quit: noop,
      minimize: noop,
      maximize: noop,
      close: noop,
    },

    // ── AI providers (Phase 2: real streaming for all 3) ──
    // The heavy lifting lives in js/mobile/ai-providers.js (loaded
    // before this bridge). This section just wires the renderer's
    // expected `electronAPI.ai.*` surface to that module + our
    // in-memory conversation store.
    ai: {
      streamChat: async (messages, conversationId /*, browserWindow */) => {
        const AI = window._bloomAI;
        if (!AI) return { success: false, error: 'AI module not loaded' };
        // Abort any in-flight stream — same semantics as desktop.
        if (_aiAbortCtrl) try { _aiAbortCtrl.abort(); } catch { /* ignore */ }
        _aiAbortCtrl = new AbortController();
        const signal = _aiAbortCtrl.signal;
        const emit = _emit;
        try {
          const provider = await AI.getActive();
          _appendConvo(conversationId, 'user', messages[messages.length - 1]?.content);
          const streamer =
            provider === 'claude' ? AI.streamClaude :
            provider === 'gemini' ? AI.streamGemini :
            provider === 'openrouter' ? AI.streamOpenRouter : null;
          if (!streamer) throw new Error(`Unknown AI provider: ${provider}`);
          // We capture the assistant text via a side-listener so we
          // can save it when the stream completes.
          let assistantText = '';
          const offDelta = _on('claude:stream-delta', (d) => {
            if (d?.conversationId === conversationId) assistantText += d.text || '';
          });
          const offDone = _on('claude:stream-done', (d) => {
            if (d?.conversationId === conversationId && assistantText) {
              _appendConvo(conversationId, 'assistant', assistantText);
            }
            offDelta(); offDone();
          });
          await streamer({ messages, conversationId, signal, emit });
          return { success: true };
        } catch (err) {
          if (err?.name === 'AbortError') return { success: false, error: 'Aborted' };
          console.error('[bridge] streamChat failed:', err);
          emit('claude:stream-error', { error: String(err?.message || err), conversationId });
          return { success: false, error: String(err?.message || err) };
        }
      },
      stopStream: async () => {
        if (_aiAbortCtrl) try { _aiAbortCtrl.abort(); } catch { /* ignore */ }
        _aiAbortCtrl = null;
        return { success: true };
      },
      // Generate a time-aware greeting via the active provider.
      // Returns { title, subtitle, bloom } or null if no key is set /
      // the request fails — home.js caches null as 'failed' and keeps
      // the fallback strings for the session.
      generateGreeting: async () => window._bloomAI?.generateGreeting() ?? null,
      listConversations: async () =>
        Array.from(_conversations.values())
          .sort((a, b) => b.updatedAt - a.updatedAt)
          // The desktop shape includes messageCount; home.js renders it
          // directly. Ensure the mobile bridge returns the same field so
          // the "Recent Conversations" card doesn't always show 0.
          .map(c => ({ ...c, messageCount: Array.isArray(c.messages) ? c.messages.length : 0 })),
      getConversation: async (id) => _conversations.get(id) || null,
      deleteConversation: async (id) => {
        _conversations.delete(id);
        _persistConvos();
        try { window.dispatchEvent(new CustomEvent('bloom:conversations-changed', { detail: { id, role: 'deleted' } })); } catch {}
        return { success: true };
      },
      getProvider: async () => window._bloomAI?.getActive() ?? 'claude',
      setProvider: async (p) => window._bloomAI?.setActive(p) ?? { success: false },
      getProviderStatus: async () => window._bloomAI?.getProviderStatus() ?? {
        active: 'claude',
        providers: {
          claude: { hasKey: false, label: 'Claude Haiku 4.5', description: 'Anthropic · paid' },
          gemini: { hasKey: false, label: 'Gemini 2.5 Flash', description: 'Google · free' },
          openrouter: { hasKey: false, label: 'Qwen 3 (OpenRouter)', description: 'Qwen · free' },
        },
      },
      hasAnyProvider: async () => window._bloomAI?.hasAny() ?? false,
      onStreamDelta: (cb) => _on('claude:stream-delta', cb),
      onStreamDone: (cb) => _on('claude:stream-done', cb),
      onStreamError: (cb) => _on('claude:stream-error', cb),
      onToolUse: (cb) => _on('claude:tool-use', cb),
    },
    claude: {
      setApiKey: async (key) => window._bloomAI?.setKey('claude', key) ?? { success: false },
      validateKey: async () => window._bloomAI?.validateKey('claude') ?? { valid: false, error: 'AI module not loaded' },
      getApiKeyStatus: async () => ({ hasKey: await (window._bloomAI?.hasKey('claude') ?? false) }),
      getApiKeyPreview: async () => window._bloomAI?.getKeyPreview('claude') ?? '',
      streamChat: (...args) => api.ai.streamChat(...args),
      stopStream: () => api.ai.stopStream(),
      generateGreeting: async () => window._bloomAI?.generateGreeting() ?? null,
      listConversations: () => api.ai.listConversations(),
      getConversation: (id) => api.ai.getConversation(id),
      deleteConversation: (id) => api.ai.deleteConversation(id),
    },
    gemini: {
      setApiKey: async (key) => window._bloomAI?.setKey('gemini', key) ?? { success: false },
      validateKey: async () => window._bloomAI?.validateKey('gemini') ?? { valid: false, error: 'AI module not loaded' },
      getApiKeyStatus: async () => ({ hasKey: await (window._bloomAI?.hasKey('gemini') ?? false) }),
      getApiKeyPreview: async () => window._bloomAI?.getKeyPreview('gemini') ?? '',
    },
    openrouter: {
      setApiKey: async (key) => window._bloomAI?.setKey('openrouter', key) ?? { success: false },
      validateKey: async () => window._bloomAI?.validateKey('openrouter') ?? { valid: false, error: 'AI module not loaded' },
      getApiKeyStatus: async () => ({ hasKey: await (window._bloomAI?.hasKey('openrouter') ?? false) }),
      getApiKeyPreview: async () => window._bloomAI?.getKeyPreview('openrouter') ?? '',
      getModel: async () => window._bloomAI?.getOpenRouterModel() ?? 'qwen/qwen3-coder:free',
      setModel: async (m) => window._bloomAI?.setOpenRouterModel(m) ?? { success: false },
    },

    // ── Google (Phase 3 — scaffold only; awaiting OAuth client ID) ──
    // signIn fires the real plugin — throws a helpful error if the
    // user hasn't set up capacitor.config.json yet. See
    // js/mobile/google-auth.js + HANDOFF.md for the full setup flow.
    // Calendar/Drive/Notes are still stubs until Phase 3 completes.
    google: {
      getStatus: () => window._bloomGoogle?.getStatus() ?? { authenticated: false },
      signIn: async () => {
        try {
          return await window._bloomGoogle?.signIn();
        } catch (err) {
          if (window.Toast?.show) window.Toast.show(String(err?.message || err), 'error', 5000);
          throw err;
        }
      },
      signOut: () => window._bloomGoogle?.signOut() ?? { success: true },
      // Desktop preload exposes login/logout/getProfile — alias to keep
      // settings.js view code identical across platforms.
      login: async () => {
        try {
          const res = await window._bloomGoogle?.signIn();
          return res?.success ? res : { success: false, error: 'Sign-in returned no result' };
        } catch (err) {
          return { success: false, error: String(err?.message || err) };
        }
      },
      logout: () => window._bloomGoogle?.signOut() ?? { success: true },
      getProfile: async () => {
        const status = await (window._bloomGoogle?.getStatus() ?? { authenticated: false });
        return status.authenticated
          ? { name: status.name, email: status.email, picture: status.picture }
          : null;
      },
      listCalendars: () => window._bloomCalendar?.listCalendars() ?? [],
      listEvents: (calendarId, timeMin, timeMax) =>
        window._bloomCalendar?.listEvents(calendarId, timeMin, timeMax) ?? [],
      createEvent: (calendarId, event) =>
        window._bloomCalendar?.createEvent(calendarId, event) ?? _notImpl('Calendar create')(),
      updateEvent: (calendarId, eventId, updates) =>
        window._bloomCalendar?.updateEvent(calendarId, eventId, updates) ?? _notImpl('Calendar update')(),
      deleteEvent: (calendarId, eventId) =>
        window._bloomCalendar?.deleteEvent(calendarId, eventId) ?? _notImpl('Calendar delete')(),
      getUpcomingEvents: (days) => window._bloomCalendar?.getUpcomingEvents(days) ?? [],
      onAuthExpired: listenerRet,
      // calendar.js subscribes via google.onCalendarChanged (not the
      // calendar.* namespace). Provide the alias so AI-tool-driven
      // event mutations can live-repaint the grid. Backed by the same
      // window event google.* flows dispatch.
      onCalendarChanged: (fn) => {
        const handler = () => { try { fn(); } catch {} };
        window.addEventListener('bloom:calendar-changed', handler);
        return () => window.removeEventListener('bloom:calendar-changed', handler);
      },
    },
    calendar: {
      onCalendarChanged: (fn) => {
        const handler = () => { try { fn(); } catch {} };
        window.addEventListener('bloom:calendar-changed', handler);
        return () => window.removeEventListener('bloom:calendar-changed', handler);
      },
    },
    drive: {
      listFiles: (folderId, pageSize) =>
        window._bloomDrive?.listFiles(folderId, pageSize) ?? [],
      searchFiles: (q, pageSize) =>
        window._bloomDrive?.searchFiles(q, pageSize) ?? [],
      getFileAsDataUri: (id, mime) =>
        window._bloomDrive?.getFileAsDataUri(id, mime) ?? null,
      // Files view calls both `getDataUri` and `getFileAsDataUri`
      // depending on code path — alias to keep it consistent.
      getDataUri: (id, mime) =>
        window._bloomDrive?.getFileAsDataUri(id, mime) ?? null,
      openFile: (idOrUrl, webViewLink) =>
        window._bloomDrive?.openFile(idOrUrl, webViewLink) ?? _notImpl('Open Drive file')(),
      open: (idOrUrl, webViewLink) =>
        window._bloomDrive?.openFile(idOrUrl, webViewLink) ?? _notImpl('Open Drive file')(),
      createFolder: (parentId, name) =>
        window._bloomDrive?.createFolder(parentId, name) ?? _notImpl('Drive folder creation')(),
      // Desktop passes a filesystem path; mobile passes a File/Blob
      // (from <input type="file">). The view handles both: if it's
      // a string it's a path, otherwise a File we uploaded directly.
      uploadFile: (parentId, fileOrPath) => {
        if (fileOrPath && typeof fileOrPath === 'object' && typeof fileOrPath.arrayBuffer === 'function') {
          return window._bloomDrive?.uploadFile(parentId, fileOrPath) ?? _notImpl('Drive upload')();
        }
        return _notImpl('Drive upload (path-based — mobile expects File)')();
      },
      deleteFile: (fileId) =>
        window._bloomDrive?.deleteFile(fileId) ?? { success: true },
    },
    notes: {
      list: (parentFolderId) => window._bloomNotes?.listNotes(parentFolderId) ?? [],
      get: (fileId) => window._bloomNotes?.getNote(fileId) ?? null,
      create: (title, content, parentFolderId, parentNoteId) =>
        window._bloomNotes?.createNote(title, content, parentFolderId, parentNoteId)
          ?? _notImpl('Note creation')(),
      update: (fileId, title, content) =>
        window._bloomNotes?.updateNote(fileId, title, content) ?? { success: false },
      delete: (fileId, opts) => window._bloomNotes?.deleteNote(fileId, opts) ?? { success: true },
      createFolder: (name, parentFolderId) =>
        window._bloomNotes?.createNotesFolder(name, parentFolderId)
          ?? _notImpl('Notes folder creation')(),
      deleteFolder: (folderId) =>
        window._bloomNotes?.deleteNotesFolder(folderId) ?? { success: true },
      getRootId: () => window._bloomNotes?.getNotesRootId() ?? null,
      getRecent: (count) => window._bloomNotes?.getRecentNoteTitles(count) ?? [],
      onChanged: listenerRet,
    },

    // ── Study ── (Phase 4: Capacitor Filesystem-backed)
    // Implementations live in js/mobile/study-store.js. Desktop-browser
    // preview (where Filesystem plugin is absent) gracefully falls
    // back to empty arrays via the store's internal no-op paths.
    study: {
      listDecks: () => window._bloomStudy?.listDecks() ?? [],
      getDeck: (id) => window._bloomStudy?.getDeck(id) ?? null,
      createDeck: (args) => window._bloomStudy?.createDeck(args) ?? null,
      updateDeck: (id, patch) => window._bloomStudy?.updateDeck(id, patch) ?? { success: false },
      deleteDeck: (id) => window._bloomStudy?.deleteDeck(id) ?? { success: false },
      addCard: (deckId, card) => window._bloomStudy?.addCard(deckId, card) ?? null,
      updateCard: (deckId, cardId, patch) => window._bloomStudy?.updateCard(deckId, cardId, patch) ?? { success: false },
      deleteCard: (deckId, cardId) => window._bloomStudy?.deleteCard(deckId, cardId) ?? { success: false },
      recordReview: (deckId, cardId, grade) => window._bloomStudy?.recordReview(deckId, cardId, grade) ?? { success: false },
      getDueCards: (deckId) => window._bloomStudy?.getDueCards(deckId) ?? [],
      logSession: (entry) => window._bloomStudy?.logSession(entry) ?? { success: false },
      getStats: () => window._bloomStudy?.getStats() ?? {
        today: { focusMin: 0, cardsReviewed: 0, cyclesCompleted: 0, date: new Date().toLocaleDateString('sv-SE') },
        week: Array.from({ length: 7 }, (_, i) => {
          const d = new Date(); d.setDate(d.getDate() - (6 - i));
          return { date: d.toLocaleDateString('sv-SE'), focusMin: 0, cardsReviewed: 0 };
        }),
        streak: 0, total: { focusMin: 0, cardsReviewed: 0 }, goal: { dailyMin: 30 },
      },
      getPrefs: () => window._bloomStudy?.getPrefs() ?? {
        focus: 25, shortBreak: 5, longBreak: 15, longBreakEvery: 4,
        dailyGoalMin: 30, newCardsPerDay: 500, soundEnabled: true,
        today: { date: new Date().toLocaleDateString('sv-SE'), focusMin: 0, cyclesCompleted: 0, cardsReviewed: 0 },
      },
      setPrefs: (patch) => window._bloomStudy?.setPrefs(patch) ?? { success: false },
      // Drive sync: wired to study-sync.js on mobile. Manual sync
      // kicks off an immediate pull + flush.
      syncNow: async () => {
        try { await window._bloomStudySync?.syncNow(); return { success: true }; }
        catch (err) { return { success: false, error: String(err?.message || err) }; }
      },
      getSyncStatus: async () => {
        const cached = window._bloomStudySync?.getStatus?.();
        if (cached) return cached;
        const authed = (await window._bloomGoogle?.getStatus())?.authenticated;
        return authed
          ? { state: 'idle', authed: true, pendingCount: 0 }
          : { state: 'disabled', authed: false, pendingCount: 0, message: 'Sign in to Google to sync' };
      },
      onDecksChanged: (fn) => {
        const handler = () => { try { fn(); } catch {} };
        window.addEventListener('bloom:decks-changed', handler);
        return () => window.removeEventListener('bloom:decks-changed', handler);
      },
      // Fired by study-sync after pulling new sessions.json or prefs.json
      // from Drive. Study hub uses this to re-read getStats() and redraw
      // the streak, focus-min, cards-reviewed, goal bar, and weekly chart
      // without waiting for the user to navigate away and back.
      onStatsChanged: (fn) => {
        const handler = () => { try { fn(); } catch {} };
        window.addEventListener('bloom:stats-changed', handler);
        return () => window.removeEventListener('bloom:stats-changed', handler);
      },
      onPomodoroStart: listenerRet,
      // Stream sync-status updates as study-sync dispatches them, so
      // the Study view's chip stays in lockstep with the real state
      // (syncing / idle / error / disabled) instead of the stale
      // "disabled" default.
      onSyncStatus: (fn) => {
        const handler = (e) => { try { fn(e?.detail); } catch {} };
        window.addEventListener('bloom:study-sync-status', handler);
        return () => window.removeEventListener('bloom:study-sync-status', handler);
      },
    },

    // ── File browser (local FS — N/A on Android, stub) ──
    files: {
      list: asyncArr,
      read: asyncNull,
      getHome: async () => '/',
    },

    // ── Analytics ──
    analytics: {
      track: noop,
    },

    // ── Recent items ──
    recent: {
      list: (opts) => window._bloomRecent?.list(opts) ?? [],
      add: (entry) => window._bloomRecent?.add(entry) ?? { success: false },
      track: (entry, extra) => window._bloomRecent?.track(entry, extra) ?? { success: false },
      forget: (id, kind) => window._bloomRecent?.forget(id, kind) ?? { success: false },
      clear: () => window._bloomRecent?.clear() ?? { success: true },
    },

    // ── Theme ──
    // Custom backgrounds: file picker → canvas downsize → data URI in
    // Preferences. Implementation lives in js/mobile/theme-store.js;
    // bridge just forwards. theme-engine sees the data: URI in `path`
    // and renders it directly (no `file://` prefix).
    theme: {
      pickImage: () => window._bloomTheme?.pickImage() ?? null,
      listCustom: () => window._bloomTheme?.listCustom() ?? [],
      deleteCustom: (id) => window._bloomTheme?.deleteCustom(id) ?? { success: true },
      // Mobile: preset images live inside the bundled web assets.
      // Renderer does `file://${path}` wrapping; strip that and return the
      // relative asset URL so it resolves against the Capacitor webview origin.
      getPresetPath: async (file) => `/assets/images/backgrounds/${file}`,
    },
  };

  // Expose to renderer under the same global it expects.
  window.electronAPI = api;
  window._bloomMobile = true; // feature flag views can read for "am I on mobile?"
})();
