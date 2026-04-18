// ─── Mobile study sync ────────────────────────────────────────────
//
// Syncs the local study-store (deck JSONs + sessions.json under
// Capacitor Filesystem) to a "Bloom Study" folder on the user's
// Google Drive. Same shape as the desktop study-sync so a deck
// created on the desktop app shows up here and vice versa.
//
// Strategy (simpler than desktop):
//   - Pull on sign-in and on study view mount.
//   - Push each deck debounced (4s) after local mutation.
//   - Sessions pushed the same way.
//   - Last-modified-wins conflict resolution (remote modifiedTime
//     vs. local push marker in sync-state).
//   - Sync state persisted under study store key `sync.state`.
//
// Skipped vs. desktop:
//   - Tombstones / cross-device delete propagation. Deleting a
//     deck on mobile only removes the local file; the Drive copy
//     stays (will be re-pulled on next sync). Documented tradeoff.

(() => {
  const FOLDER_NAME = 'Bloom Study';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const JSON_MIME = 'application/json';
  const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
  const KIND_DECK = 'deck';
  const KIND_SESSIONS = 'sessions';

  const PUSH_DEBOUNCE_MS = 4000;
  const PULL_INTERVAL_MS = 5 * 60 * 1000;

  function _api() { return window._bloomGoogleApi; }
  function _store() { return window._bloomStudy; }
  function _auth() { return window._bloomGoogle; }
  function _prefsStore() { return window.electronAPI?.store; }

  function _escapeQ(s) { return String(s).replace(/'/g, "\\'"); }

  // Persisted sync state (via Capacitor Preferences, alongside app prefs).
  // Keeping it in the shared store instead of the study-store's
  // Filesystem dir keeps the sync layer optional — a user without
  // Google can run without this file ever being created.
  const STATE_KEY = 'study.syncState';
  async function _loadState() {
    try {
      const raw = await _prefsStore()?.get(STATE_KEY);
      return raw && typeof raw === 'object' ? raw : { decks: {}, sessions: null };
    } catch { return { decks: {}, sessions: null }; }
  }
  let _state = null;
  let _statePromise = null;
  async function _ensureState() {
    if (_state) return _state;
    if (_statePromise) return _statePromise;
    _statePromise = _loadState().then(s => { _state = s; return s; });
    return _statePromise;
  }
  let _saveTimer = null;
  function _saveStateSoon() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => { _prefsStore()?.set(STATE_KEY, _state); }, 300);
  }

  // ── Folder discovery ────────────────────────────────────────────
  let _folderId = null;
  let _folderPromise = null;
  async function _ensureFolder() {
    if (_folderId) return _folderId;
    if (_folderPromise) return _folderPromise;
    _folderPromise = (async () => {
      const params = new URLSearchParams({
        q: `name='${_escapeQ(FOLDER_NAME)}' and mimeType='${FOLDER_MIME}' and 'me' in owners and trashed=false`,
        fields: 'files(id,name)', spaces: 'drive',
      });
      const found = await _api().authedFetch(`${DRIVE_BASE}/files?${params}`);
      if (found.files && found.files.length) {
        _folderId = found.files[0].id;
        return _folderId;
      }
      const created = await _api().authedFetch(`${DRIVE_BASE}/files?fields=id`, {
        method: 'POST',
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
      });
      _folderId = created.id;
      return _folderId;
    })().finally(() => { _folderPromise = null; });
    return _folderPromise;
  }

  // ── Multipart upload (same shape as google-notes.js) ─────────────
  async function _uploadJSON({ url, method = 'POST', metadata, body }) {
    const boundary = 'bloom-' + Math.random().toString(36).slice(2);
    const text =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) + `\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${JSON_MIME}\r\n\r\n` +
      body + `\r\n` +
      `--${boundary}--`;
    return _api().authedFetch(url, {
      method,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: text,
    });
  }

  // ── Push ─────────────────────────────────────────────────────────
  async function _pushDeck(deckId) {
    const deck = await _store().getDeck(deckId);
    if (!deck) return;
    const folderId = await _ensureFolder();
    const state = await _ensureState();
    const existing = state.decks[deckId]?.driveFileId || null;
    const appProperties = { bloomStudyKind: KIND_DECK, deckId };
    const metadata = existing
      ? { appProperties }
      : { name: `deck_${deckId}.json`, mimeType: JSON_MIME, parents: [folderId], appProperties };
    const url = existing
      ? `${UPLOAD_BASE}/files/${encodeURIComponent(existing)}?uploadType=multipart&fields=id,modifiedTime`
      : `${UPLOAD_BASE}/files?uploadType=multipart&fields=id,modifiedTime`;
    const result = await _uploadJSON({
      url, method: existing ? 'PATCH' : 'POST',
      metadata, body: JSON.stringify(deck, null, 2),
    });
    state.decks[deckId] = {
      driveFileId: result.id,
      lastPushedAt: Date.now(),
      lastSeenRemoteModified: result.modifiedTime,
    };
    _saveStateSoon();
  }

  async function _pushSessions() {
    const sessions = await _store().readSessionsRaw();
    const folderId = await _ensureFolder();
    const state = await _ensureState();
    const existing = state.sessions?.driveFileId || null;
    const appProperties = { bloomStudyKind: KIND_SESSIONS };
    const metadata = existing
      ? { appProperties }
      : { name: 'sessions.json', mimeType: JSON_MIME, parents: [folderId], appProperties };
    const url = existing
      ? `${UPLOAD_BASE}/files/${encodeURIComponent(existing)}?uploadType=multipart&fields=id,modifiedTime`
      : `${UPLOAD_BASE}/files?uploadType=multipart&fields=id,modifiedTime`;
    const result = await _uploadJSON({
      url, method: existing ? 'PATCH' : 'POST',
      metadata, body: JSON.stringify(sessions, null, 2),
    });
    state.sessions = {
      driveFileId: result.id,
      lastPushedAt: Date.now(),
      lastSeenRemoteModified: result.modifiedTime,
    };
    _saveStateSoon();
  }

  // ── Pull ─────────────────────────────────────────────────────────
  async function _pullAll() {
    const folderId = await _ensureFolder();
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name,modifiedTime,appProperties)',
      pageSize: '200',
    });
    const res = await _api().authedFetch(`${DRIVE_BASE}/files?${params}`);
    const files = res.files || [];
    for (const f of files) {
      const kind = f.appProperties?.bloomStudyKind;
      try {
        if (kind === KIND_DECK) await _maybePullDeck(f);
        else if (kind === KIND_SESSIONS) await _maybePullSessions(f);
      } catch (err) {
        console.warn('[study-sync] pull failed for', f.name, err);
      }
    }
  }

  async function _maybePullDeck(file) {
    const deckId = file.appProperties?.deckId;
    if (!deckId) return;
    const state = await _ensureState();
    const localState = state.decks[deckId];
    if (localState && localState.lastSeenRemoteModified === file.modifiedTime) return;
    if (_dirtyDecks.has(deckId)) return; // Pending local push — don't clobber.
    const localPushedAt = localState?.lastPushedAt || 0;
    const remoteMs = Date.parse(file.modifiedTime || '') || 0;
    if (remoteMs <= localPushedAt && localState) {
      state.decks[deckId] = {
        ...localState,
        driveFileId: file.id,
        lastSeenRemoteModified: file.modifiedTime,
      };
      _saveStateSoon();
      return;
    }
    const content = await _api().authedFetch(
      `${DRIVE_BASE}/files/${encodeURIComponent(file.id)}?alt=media`
    );
    let deck;
    try { deck = typeof content === 'string' ? JSON.parse(content) : content; }
    catch { return; }
    if (!deck || deck.id !== deckId) return;
    await _store().writeDeckRaw(deck, { silent: true });
    state.decks[deckId] = {
      driveFileId: file.id,
      lastPushedAt: Date.now(),
      lastSeenRemoteModified: file.modifiedTime,
    };
    _saveStateSoon();
    try { window.dispatchEvent(new CustomEvent('bloom:decks-changed')); } catch {}
  }

  async function _maybePullSessions(file) {
    const state = await _ensureState();
    const localState = state.sessions;
    if (localState && localState.lastSeenRemoteModified === file.modifiedTime) return;
    if (_dirtySessions) return;
    const localPushedAt = localState?.lastPushedAt || 0;
    const remoteMs = Date.parse(file.modifiedTime || '') || 0;
    if (remoteMs <= localPushedAt && localState) {
      state.sessions = { ...localState, driveFileId: file.id, lastSeenRemoteModified: file.modifiedTime };
      _saveStateSoon();
      return;
    }
    const content = await _api().authedFetch(
      `${DRIVE_BASE}/files/${encodeURIComponent(file.id)}?alt=media`
    );
    let list;
    try { list = typeof content === 'string' ? JSON.parse(content) : content; }
    catch { return; }
    if (!Array.isArray(list)) return;
    await _store().writeSessionsRaw(list, { silent: true });
    state.sessions = {
      driveFileId: file.id,
      lastPushedAt: Date.now(),
      lastSeenRemoteModified: file.modifiedTime,
    };
    _saveStateSoon();
  }

  // ── Dirty queue + debounced flush ────────────────────────────────
  const _dirtyDecks = new Set();
  let _dirtySessions = false;
  let _pushTimer = null;

  function _markDirty(event) {
    if (event?.type === 'deck' && event.deckId) _dirtyDecks.add(event.deckId);
    else if (event?.type === 'sessions') _dirtySessions = true;
    else if (event?.type === 'deck-deleted') {
      // V1: leave the Drive copy; just clear local dirty (no push needed).
      _dirtyDecks.delete(event.deckId);
      return;
    }
    _scheduleFlush();
  }
  function _scheduleFlush() {
    clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => { _pushTimer = null; flushNow(); }, PUSH_DEBOUNCE_MS);
  }

  let _syncInFlight = false;
  async function flushNow() {
    if (_syncInFlight) return;
    if (!_auth() || !(await _auth().getStatus()).authenticated) return;
    _syncInFlight = true;
    try {
      const deckIds = Array.from(_dirtyDecks);
      _dirtyDecks.clear();
      for (const id of deckIds) {
        try { await _pushDeck(id); } catch (e) { _dirtyDecks.add(id); throw e; }
      }
      if (_dirtySessions) {
        _dirtySessions = false;
        try { await _pushSessions(); } catch (e) { _dirtySessions = true; throw e; }
      }
    } catch (err) {
      console.warn('[study-sync] flush failed:', err?.message || err);
    } finally {
      _syncInFlight = false;
    }
  }

  // ── Full sync (pull + flush) ─────────────────────────────────────
  let _fullInFlight = false;
  async function syncNow() {
    if (_fullInFlight) return;
    const auth = _auth();
    if (!auth || !(await auth.getStatus()).authenticated) return;
    _fullInFlight = true;
    try {
      await _pullAll();
      await flushNow();
    } catch (err) {
      console.warn('[study-sync] syncNow failed:', err?.message || err);
    } finally {
      _fullInFlight = false;
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────
  function start() {
    if (!_store() || typeof _store().onMutate !== 'function') {
      // study-store isn't loaded yet; retry shortly.
      setTimeout(start, 200);
      return;
    }
    _store().onMutate(_markDirty);
    // Initial sync (if already authed). Safe no-op otherwise.
    syncNow();
    // Periodic pull so remote changes show up eventually even if the
    // user doesn't touch a deck locally.
    setInterval(syncNow, PULL_INTERVAL_MS);
    // Re-sync on sign-in event (from google-auth.js).
    window.addEventListener('bloom:google-connected', () => syncNow());
  }

  window._bloomStudySync = { syncNow, flushNow };
  start();
})();
