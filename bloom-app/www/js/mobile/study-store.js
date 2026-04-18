// ─── Mobile study-store (Phase 4) ─────────────────────────────────
//
// Capacitor Filesystem-backed port of the desktop `study-store.js`.
// Same on-disk JSON shape so a future desktop↔mobile sync just
// diffs files. Simpler than desktop — no IPC mutex, no electron-log,
// no crypto.randomBytes. Writes are serialized per-deck via a small
// in-memory Promise-chain queue.
//
// Files (relative to Filesystem.Directory.Data):
//   study/decks/{deckId}.json     — single deck with cards
//   study/sessions.json           — capped FIFO session log
//   study/prefs.json              — timer + today-counters
//
// All methods return plain objects (no Promises-of-undefined) so the
// bridge can forward them directly.

(() => {
  const FS = () => window.Capacitor?.Plugins?.Filesystem;
  const DIR = 'Data'; // Capacitor Filesystem.Directory.Data
  const ROOT = 'study';
  const DECKS_DIR = `${ROOT}/decks`;
  const SESSIONS_PATH = `${ROOT}/sessions.json`;
  const PREFS_PATH = `${ROOT}/prefs.json`;

  const DECK_ID_RE = /^deck_[A-Za-z0-9_-]{1,40}$/;
  const CARD_ID_RE = /^card_[A-Za-z0-9_-]{1,40}$/;
  const MAX_CARDS_PER_DECK = 2000;
  const MAX_FRONT_BACK_CHARS = 4000;
  const MAX_DECK_NAME_CHARS = 120;
  const MAX_SESSIONS = 1000;
  const DAY_MS = 86400000;
  const MIN_EASE = 1.3;
  const DEFAULT_EASE = 2.5;

  const DEFAULT_PREFS = Object.freeze({
    focus: 25, shortBreak: 5, longBreak: 15, longBreakEvery: 4,
    dailyGoalMin: 30, newCardsPerDay: 500, soundEnabled: true,
    today: { date: '', focusMin: 0, cyclesCompleted: 0, cardsReviewed: 0 },
  });

  function _todayKey(d = new Date()) {
    return d.toLocaleDateString('sv-SE'); // YYYY-MM-DD in local tz
  }

  function _shortId(prefix) {
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    const b64 = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${prefix}_${b64}`;
  }

  // ── Filesystem helpers ─────────────────────────────────────────
  async function _ensureRoot() {
    const fs = FS();
    if (!fs) return;
    try { await fs.mkdir({ path: DECKS_DIR, directory: DIR, recursive: true }); } catch { /* exists */ }
  }

  async function _readJSON(path, fallback) {
    const fs = FS();
    if (!fs) return fallback;
    try {
      const { data } = await fs.readFile({ path, directory: DIR, encoding: 'utf8' });
      return JSON.parse(data);
    } catch {
      return fallback;
    }
  }

  async function _writeJSON(path, value) {
    const fs = FS();
    if (!fs) return;
    await _ensureRoot();
    await fs.writeFile({
      path,
      directory: DIR,
      encoding: 'utf8',
      data: JSON.stringify(value, null, 2),
    });
  }

  // ── Mutation bus ────────────────────────────────────────────────
  // Lightweight subscribe/emit so study-sync can react to deck +
  // session changes without having to poll the filesystem.
  const _mutateListeners = new Set();
  function onMutate(fn) {
    if (typeof fn !== 'function') return () => {};
    _mutateListeners.add(fn);
    return () => _mutateListeners.delete(fn);
  }
  function _fireMutate(event) {
    for (const fn of _mutateListeners) {
      try { fn(event); } catch (err) { console.warn('[study] mutate listener threw:', err); }
    }
  }

  async function _listDecks() {
    const fs = FS();
    if (!fs) return [];
    try {
      const { files } = await fs.readdir({ path: DECKS_DIR, directory: DIR });
      return files
        .map(f => (typeof f === 'string' ? f : f.name))
        .filter(n => n.endsWith('.json'))
        .map(n => n.slice(0, -5));
    } catch {
      return [];
    }
  }

  // ── Per-deck write queue ──────────────────────────────────────
  const _deckQueues = new Map();
  function _withDeck(deckId, work) {
    const prev = _deckQueues.get(deckId) || Promise.resolve();
    const next = prev.catch(() => {}).then(work);
    _deckQueues.set(deckId, next);
    // Cleanup after resolve so the map doesn't grow unbounded.
    next.finally(() => {
      if (_deckQueues.get(deckId) === next) _deckQueues.delete(deckId);
    });
    return next;
  }

  // ── Preferences ───────────────────────────────────────────────
  async function getPrefs() {
    const prefs = await _readJSON(PREFS_PATH, null);
    const p = { ...DEFAULT_PREFS, ...(prefs || {}) };
    // Roll today's counter at local midnight.
    const today = _todayKey();
    if (!p.today || p.today.date !== today) {
      p.today = { date: today, focusMin: 0, cyclesCompleted: 0, cardsReviewed: 0 };
    }
    return p;
  }
  async function setPrefs(patch) {
    const p = await getPrefs();
    // Shallow merge — today counters preserved via default.
    const next = { ...p, ...(patch || {}) };
    if (patch?.today) next.today = { ...p.today, ...patch.today };
    await _writeJSON(PREFS_PATH, next);
    return { success: true };
  }

  // ── Decks ─────────────────────────────────────────────────────
  async function listDecks() {
    const ids = await _listDecks();
    const out = [];
    for (const id of ids) {
      const deck = await _readJSON(`${DECKS_DIR}/${id}.json`, null);
      if (!deck) continue;
      out.push({
        id: deck.id, name: deck.name,
        cardCount: deck.cards?.length || 0,
        dueCount: (deck.cards || []).filter(c => (c.dueAt || 0) <= Date.now()).length,
        createdAt: deck.createdAt, updatedAt: deck.updatedAt,
      });
    }
    out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return out;
  }

  async function getDeck(id) {
    if (!DECK_ID_RE.test(id)) return null;
    return _readJSON(`${DECKS_DIR}/${id}.json`, null);
  }

  async function createDeck({ name } = {}) {
    name = String(name || 'Untitled').slice(0, MAX_DECK_NAME_CHARS);
    const id = _shortId('deck');
    const now = Date.now();
    const deck = { id, name, cards: [], createdAt: now, updatedAt: now };
    await _writeJSON(`${DECKS_DIR}/${id}.json`, deck);
    _fireMutate({ type: 'deck', deckId: id });
    return deck;
  }

  async function updateDeck(id, patch) {
    if (!DECK_ID_RE.test(id)) return { success: false };
    return _withDeck(id, async () => {
      const deck = await getDeck(id);
      if (!deck) return { success: false };
      if (typeof patch?.name === 'string') deck.name = patch.name.slice(0, MAX_DECK_NAME_CHARS);
      deck.updatedAt = Date.now();
      await _writeJSON(`${DECKS_DIR}/${id}.json`, deck);
      _fireMutate({ type: 'deck', deckId: id });
      return { success: true };
    });
  }

  // Used by study-sync when pulling from Drive: writes the whole deck
  // JSON as-is (preserving remote id, cards, timestamps). Suppresses
  // the mutate event by default so we don't loop back into a push.
  async function writeDeckRaw(deck, { silent = true } = {}) {
    if (!deck || !DECK_ID_RE.test(deck.id)) return { success: false };
    await _writeJSON(`${DECKS_DIR}/${deck.id}.json`, deck);
    if (!silent) _fireMutate({ type: 'deck', deckId: deck.id });
    return { success: true };
  }

  async function readSessionsRaw() {
    return _readJSON(SESSIONS_PATH, []);
  }
  async function writeSessionsRaw(list, { silent = true } = {}) {
    if (!Array.isArray(list)) return { success: false };
    await _writeJSON(SESSIONS_PATH, list);
    if (!silent) _fireMutate({ type: 'sessions' });
    return { success: true };
  }

  async function deleteDeck(id) {
    const fs = FS();
    if (!fs || !DECK_ID_RE.test(id)) return { success: false };
    return _withDeck(id, async () => {
      try {
        await fs.deleteFile({ path: `${DECKS_DIR}/${id}.json`, directory: DIR });
      } catch { /* ignore */ }
      _fireMutate({ type: 'deck-deleted', deckId: id });
      return { success: true };
    });
  }

  async function addCard(deckId, { front, back } = {}) {
    if (!DECK_ID_RE.test(deckId)) return null;
    front = String(front || '').slice(0, MAX_FRONT_BACK_CHARS);
    back = String(back || '').slice(0, MAX_FRONT_BACK_CHARS);
    if (!front || !back) return null;
    return _withDeck(deckId, async () => {
      const deck = await getDeck(deckId);
      if (!deck) return null;
      if (deck.cards.length >= MAX_CARDS_PER_DECK) return null;
      const card = {
        id: _shortId('card'), front, back,
        ease: DEFAULT_EASE, interval: 0, dueAt: Date.now(),
        lapses: 0, reviewCount: 0, createdAt: Date.now(),
      };
      deck.cards.push(card);
      deck.updatedAt = Date.now();
      await _writeJSON(`${DECKS_DIR}/${deckId}.json`, deck);
      _fireMutate({ type: 'deck', deckId });
      return card;
    });
  }

  async function updateCard(deckId, cardId, patch) {
    if (!DECK_ID_RE.test(deckId) || !CARD_ID_RE.test(cardId)) return { success: false };
    return _withDeck(deckId, async () => {
      const deck = await getDeck(deckId);
      if (!deck) return { success: false };
      const i = deck.cards.findIndex(c => c.id === cardId);
      if (i < 0) return { success: false };
      if (typeof patch?.front === 'string') deck.cards[i].front = patch.front.slice(0, MAX_FRONT_BACK_CHARS);
      if (typeof patch?.back === 'string') deck.cards[i].back = patch.back.slice(0, MAX_FRONT_BACK_CHARS);
      deck.updatedAt = Date.now();
      await _writeJSON(`${DECKS_DIR}/${deckId}.json`, deck);
      _fireMutate({ type: 'deck', deckId });
      return { success: true };
    });
  }

  async function deleteCard(deckId, cardId) {
    if (!DECK_ID_RE.test(deckId) || !CARD_ID_RE.test(cardId)) return { success: false };
    return _withDeck(deckId, async () => {
      const deck = await getDeck(deckId);
      if (!deck) return { success: false };
      deck.cards = deck.cards.filter(c => c.id !== cardId);
      deck.updatedAt = Date.now();
      await _writeJSON(`${DECKS_DIR}/${deckId}.json`, deck);
      _fireMutate({ type: 'deck', deckId });
      return { success: true };
    });
  }

  // ── SM-2 review ────────────────────────────────────────────────
  // grade ∈ {1,2,3,4} — Again / Hard / Good / Easy
  async function recordReview(deckId, cardId, grade) {
    if (!DECK_ID_RE.test(deckId) || !CARD_ID_RE.test(cardId)) return { success: false };
    if (![1, 2, 3, 4].includes(grade)) return { success: false };
    return _withDeck(deckId, async () => {
      const deck = await getDeck(deckId);
      if (!deck) return { success: false };
      const card = deck.cards.find(c => c.id === cardId);
      if (!card) return { success: false };

      if (grade === 1) {
        card.lapses = (card.lapses || 0) + 1;
        card.interval = 0;
        card.ease = Math.max(MIN_EASE, (card.ease || DEFAULT_EASE) - 0.2);
      } else {
        const prev = card.interval || 0;
        const delta = grade === 2 ? -0.15 : grade === 4 ? +0.15 : 0;
        card.ease = Math.max(MIN_EASE, (card.ease || DEFAULT_EASE) + delta);
        card.interval = prev === 0 ? 1 : Math.round(prev * card.ease);
      }
      card.reviewCount = (card.reviewCount || 0) + 1;
      card.dueAt = Date.now() + card.interval * DAY_MS;

      deck.updatedAt = Date.now();
      await _writeJSON(`${DECKS_DIR}/${deckId}.json`, deck);
      _fireMutate({ type: 'deck', deckId });

      // Counter bump in today's prefs.
      const prefs = await getPrefs();
      prefs.today.cardsReviewed = (prefs.today.cardsReviewed || 0) + 1;
      await _writeJSON(PREFS_PATH, prefs);

      return { success: true, card };
    });
  }

  async function getDueCards(deckId) {
    const deck = await getDeck(deckId);
    if (!deck) return [];
    const now = Date.now();
    const prefs = await getPrefs();
    const newCap = prefs.newCardsPerDay || 500;
    let newCount = 0;
    return deck.cards.filter(c => {
      if ((c.dueAt || 0) > now) return false;
      if ((c.interval || 0) === 0) {
        if (newCount >= newCap) return false;
        newCount++;
      }
      return true;
    });
  }

  // ── Sessions + stats ──────────────────────────────────────────
  async function logSession(entry) {
    const now = Date.now();
    const sessions = await _readJSON(SESSIONS_PATH, []);
    const e = {
      id: _shortId('s'),
      kind: entry?.kind || 'focus', // 'focus' | 'review'
      at: now,
      durationMin: Number(entry?.durationMin) || 0,
      cardsReviewed: Number(entry?.cardsReviewed) || 0,
    };
    sessions.push(e);
    if (sessions.length > MAX_SESSIONS) sessions.splice(0, sessions.length - MAX_SESSIONS);
    await _writeJSON(SESSIONS_PATH, sessions);
    _fireMutate({ type: 'sessions' });

    // Roll up into today's prefs.
    const prefs = await getPrefs();
    if (e.kind === 'focus') {
      prefs.today.focusMin = (prefs.today.focusMin || 0) + e.durationMin;
      prefs.today.cyclesCompleted = (prefs.today.cyclesCompleted || 0) + 1;
    } else if (e.kind === 'review') {
      prefs.today.cardsReviewed = (prefs.today.cardsReviewed || 0) + e.cardsReviewed;
    }
    await _writeJSON(PREFS_PATH, prefs);
    return { success: true };
  }

  async function getStats() {
    const [prefs, sessions] = await Promise.all([
      getPrefs(),
      _readJSON(SESSIONS_PATH, []),
    ]);
    const week = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      const key = _todayKey(d);
      const day = sessions.filter(s => _todayKey(new Date(s.at)) === key);
      const focusMin = day.filter(s => s.kind === 'focus').reduce((n, s) => n + s.durationMin, 0);
      const cardsReviewed = day.filter(s => s.kind === 'review').reduce((n, s) => n + s.cardsReviewed, 0);
      week.push({ date: key, focusMin, cardsReviewed });
    }
    // Streak: count consecutive trailing days with focusMin > 0.
    let streak = 0;
    for (let i = week.length - 1; i >= 0; i--) {
      if (week[i].focusMin > 0) streak++;
      else break;
    }
    return {
      today: prefs.today,
      week, streak,
      total: {
        focusMin: sessions.filter(s => s.kind === 'focus').reduce((n, s) => n + s.durationMin, 0),
        cardsReviewed: sessions.filter(s => s.kind === 'review').reduce((n, s) => n + s.cardsReviewed, 0),
      },
      goal: { dailyMin: prefs.dailyGoalMin || 30 },
    };
  }

  window._bloomStudy = {
    listDecks, getDeck, createDeck, updateDeck, deleteDeck,
    addCard, updateCard, deleteCard,
    recordReview, getDueCards,
    logSession, getStats,
    getPrefs, setPrefs,
    // Sync-only helpers — used by study-sync.js on Drive push/pull.
    onMutate, writeDeckRaw, readSessionsRaw, writeSessionsRaw,
  };
})();
