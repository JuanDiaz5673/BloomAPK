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
  const listenerRet = () => noop; // remove-listener fn

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
  window._storeReady = _loadStoreFromDisk();

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
      get: async (key) => _memory.get(key) ?? null,
      set: async (key, value) => {
        if (!_keyAllowRe.test(key)) throw new Error('Invalid key');
        _memory.set(key, value);
        _persistStoreKey(key, value);
        return true;
      },
      delete: async (key) => {
        _memory.delete(key);
        _persistStoreKey(key, undefined);
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

    // ── AI providers (all return "configure key" or empty) ──
    ai: {
      streamChat: () => _notImpl('AI chat'),
      stopStream: asyncOk,
      generateGreeting: async () => null, // app.js falls back to canned greeting
      listConversations: asyncArr,
      getConversation: asyncNull,
      deleteConversation: asyncOk,
      getProvider: async () => 'claude',
      setProvider: asyncOk,
      getProviderStatus: async () => ({
        claude: { hasKey: false },
        gemini: { hasKey: false },
        openrouter: { hasKey: false },
      }),
      hasAnyProvider: asyncFalse,
      onStreamDelta: listenerRet,
      onStreamDone: listenerRet,
      onStreamError: listenerRet,
      onToolUse: listenerRet,
    },
    claude: {
      setApiKey: () => _notImpl('Claude key setup'),
      validateKey: asyncFalse,
      getApiKeyStatus: async () => ({ hasKey: false }),
      getApiKeyPreview: async () => '',
      streamChat: () => _notImpl('AI chat'),
      stopStream: asyncOk,
      generateGreeting: async () => null,
      listConversations: asyncArr,
      getConversation: asyncNull,
      deleteConversation: asyncOk,
    },
    gemini: {
      setApiKey: () => _notImpl('Gemini key setup'),
      validateKey: asyncFalse,
      getApiKeyStatus: async () => ({ hasKey: false }),
      getApiKeyPreview: async () => '',
    },
    openrouter: {
      setApiKey: () => _notImpl('OpenRouter key setup'),
      validateKey: asyncFalse,
      getApiKeyStatus: async () => ({ hasKey: false }),
      getApiKeyPreview: async () => '',
      getModel: async () => 'qwen/qwen3-coder:free',
      setModel: asyncOk,
    },

    // ── Google (auth, calendar, drive, notes) ──
    google: {
      getStatus: async () => ({ authenticated: false }),
      signIn: () => _notImpl('Google sign-in'),
      signOut: asyncOk,
      listCalendars: asyncArr,
      listEvents: asyncArr,
      createEvent: () => _notImpl('Calendar event creation'),
      updateEvent: () => _notImpl('Calendar update'),
      deleteEvent: () => _notImpl('Calendar delete'),
      onAuthExpired: listenerRet,
    },
    calendar: {
      onCalendarChanged: listenerRet,
    },
    drive: {
      listFiles: asyncArr,
      searchFiles: asyncArr,
      getFileAsDataUri: asyncNull,
      openFile: () => _notImpl('Open Drive file'),
      createFolder: () => _notImpl('Drive folder creation'),
      uploadFile: () => _notImpl('Drive upload'),
      deleteFile: asyncOk,
    },
    notes: {
      list: asyncArr,
      create: () => _notImpl('Note creation'),
      get: asyncNull,
      update: asyncOk,
      delete: asyncOk,
      createFolder: () => _notImpl('Notes folder creation'),
      deleteFolder: asyncOk,
      onChanged: listenerRet,
    },

    // ── Study ──
    study: {
      listDecks: asyncArr,
      getDeck: asyncNull,
      createDeck: async ({ name } = {}) => _notImpl('Deck creation'),
      updateDeck: asyncOk,
      deleteDeck: asyncOk,
      addCard: () => _notImpl('Add card'),
      updateCard: asyncOk,
      deleteCard: asyncOk,
      recordReview: asyncOk,
      getDueCards: asyncArr,
      logSession: asyncOk,
      getStats: async () => ({
        today: { focusMin: 0, cardsReviewed: 0, cyclesCompleted: 0, date: new Date().toLocaleDateString('sv-SE') },
        week: Array.from({ length: 7 }, (_, i) => {
          const d = new Date(); d.setDate(d.getDate() - (6 - i));
          return { date: d.toLocaleDateString('sv-SE'), focusMin: 0, cardsReviewed: 0 };
        }),
        streak: 0,
        total: { focusMin: 0, cardsReviewed: 0 },
        goal: { dailyMin: 30 },
      }),
      getPrefs: async () => ({
        focus: 25, shortBreak: 5, longBreak: 15, longBreakEvery: 4,
        dailyGoalMin: 30, newCardsPerDay: 500, soundEnabled: true,
        today: { date: new Date().toLocaleDateString('sv-SE'), focusMin: 0, cyclesCompleted: 0, cardsReviewed: 0 },
      }),
      setPrefs: asyncOk,
      syncNow: asyncOk,
      getSyncStatus: async () => ({ state: 'disabled', authed: false, pendingCount: 0, message: 'Sync comes with Google sign-in' }),
      onDecksChanged: listenerRet,
      onPomodoroStart: listenerRet,
      onSyncStatus: listenerRet,
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
      list: asyncArr,
      add: asyncOk,
      clear: asyncOk,
    },

    // ── Theme ──
    theme: {
      pickImage: () => _notImpl('Custom background picker'),
      listCustom: asyncArr,
      deleteCustom: asyncOk,
    },
  };

  // Expose to renderer under the same global it expects.
  window.electronAPI = api;
  window._bloomMobile = true; // feature flag views can read for "am I on mobile?"
})();
