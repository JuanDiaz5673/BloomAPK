// ─── Mobile Google Notes service ──────────────────────────────────
//
// Mirrors the desktop google-drive.js notes API. Notes are stored as
// JSON files in a "Bloom Notes" folder on the user's Drive. The
// envelope shape matches the desktop format exactly so the same note
// can be opened on either platform.
//
// Skipped vs. desktop:
//   - Legacy Google Doc upgrade path (mobile is a new install)
//   - Cascade-delete of sub-pages (mobile uses simple delete; sub-page
//     orphans are repaired the next time the desktop app opens them)

(() => {
  const NOTES_FOLDER_NAME = 'Bloom Notes';
  const NOTES_FOLDER_LEGACY_NAME = 'AllDash Notes';
  const NOTE_MIME_JSON = 'application/json';
  const NOTE_FILE_SUFFIX = '.alldash-note.json';
  const NOTE_FORMAT_VERSION = 1;
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

  function _api() { return window._bloomGoogleApi; }
  function _safeFilename(t) {
    return String(t || 'Untitled Note').replace(/[\r\n\t]/g, ' ').trim() || 'Untitled Note';
  }
  function _buildName(title) { return _safeFilename(title) + NOTE_FILE_SUFFIX; }
  function _stripSuffix(n) {
    if (!n) return n;
    return n.endsWith(NOTE_FILE_SUFFIX) ? n.slice(0, -NOTE_FILE_SUFFIX.length) : n;
  }
  function _escapeQ(s) { return String(s).replace(/'/g, "\\'"); }
  function _envelope({ title, doc = null, markdown = '', icon = null, cover = null, parentId = null, createdAt = null }) {
    const now = new Date().toISOString();
    return {
      version: NOTE_FORMAT_VERSION,
      title: _safeFilename(title),
      doc: doc ?? null,
      markdown: typeof markdown === 'string' ? markdown : '',
      icon, cover,
      parentId: parentId || null,
      createdAt: createdAt || now,
      updatedAt: now,
    };
  }

  // Multipart upload helper. Drive's "multipart" upload type expects
  // a multipart/related body with two parts: JSON metadata + file body.
  async function _uploadMultipart({ url, method = 'POST', metadata, body, bodyType = NOTE_MIME_JSON }) {
    const boundary = 'bloom-' + Math.random().toString(36).slice(2);
    const text =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) + `\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${bodyType}\r\n\r\n` +
      body + `\r\n` +
      `--${boundary}--`;
    return _api().authedFetch(url, {
      method,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: text,
    });
  }

  // ── Folder discovery ─────────────────────────────────────────────
  let _notesFolderId = null;
  let _notesFolderPromise = null;
  async function getNotesRootId() {
    if (_notesFolderId) return _notesFolderId;
    if (_notesFolderPromise) return _notesFolderPromise;
    _notesFolderPromise = (async () => {
      const q = (name) =>
        `name='${_escapeQ(name)}' and mimeType='${FOLDER_MIME}' and 'me' in owners and trashed=false`;
      const params = new URLSearchParams({ q: q(NOTES_FOLDER_NAME), fields: 'files(id,name)', spaces: 'drive' });
      let res = await _api().authedFetch(`${DRIVE_BASE}/files?${params}`);
      if (res.files && res.files.length) {
        _notesFolderId = res.files[0].id;
        return _notesFolderId;
      }
      // Fall back to legacy "AllDash Notes" name
      const legacyParams = new URLSearchParams({ q: q(NOTES_FOLDER_LEGACY_NAME), fields: 'files(id,name)', spaces: 'drive' });
      res = await _api().authedFetch(`${DRIVE_BASE}/files?${legacyParams}`);
      if (res.files && res.files.length) {
        _notesFolderId = res.files[0].id;
        return _notesFolderId;
      }
      // Create
      const created = await _api().authedFetch(`${DRIVE_BASE}/files?fields=id`, {
        method: 'POST',
        body: JSON.stringify({ name: NOTES_FOLDER_NAME, mimeType: FOLDER_MIME }),
      });
      _notesFolderId = created.id;
      return _notesFolderId;
    })().finally(() => { _notesFolderPromise = null; });
    return _notesFolderPromise;
  }

  // ── List ─────────────────────────────────────────────────────────
  async function listNotes(parentFolderId) {
    const folderId = parentFolderId || await getNotesRootId();
    const q = `'${_escapeQ(folderId)}' in parents and trashed=false and (` +
              `mimeType='${NOTE_MIME_JSON}' or mimeType='${FOLDER_MIME}')`;
    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,mimeType,modifiedTime,createdTime,appProperties)',
      orderBy: 'folder,modifiedTime desc',
      pageSize: '100',
    });
    const res = await _api().authedFetch(`${DRIVE_BASE}/files?${params}`);
    return (res.files || []).map(f => {
      const isFolder = f.mimeType === FOLDER_MIME;
      const isJson = f.mimeType === NOTE_MIME_JSON;
      return {
        id: f.id,
        title: isJson ? _stripSuffix(f.name) : f.name,
        type: isFolder ? 'folder' : 'document',
        format: isFolder ? null : 'tiptap',
        mimeType: f.mimeType,
        parentId: f.appProperties?.parentNoteId || null,
        icon: f.appProperties?.noteIcon || null,
        modifiedTime: f.modifiedTime,
        createdTime: f.createdTime,
      };
    });
  }

  // ── Get ──────────────────────────────────────────────────────────
  async function getNote(fileId) {
    const meta = await _api().authedFetch(
      `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,createdTime,parents,appProperties`
    );
    if (meta.mimeType !== NOTE_MIME_JSON) {
      throw new Error(`Not a note: ${meta.mimeType}`);
    }
    const raw = await _api().authedFetch(
      `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}?alt=media`
    );
    let envelope;
    try { envelope = typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch { envelope = _envelope({ title: _stripSuffix(meta.name) }); }
    if (!envelope || envelope.version > NOTE_FORMAT_VERSION) {
      envelope = _envelope({ title: _stripSuffix(meta.name) });
    }
    return {
      id: meta.id,
      title: _stripSuffix(meta.name),
      format: 'tiptap',
      doc: envelope.doc || null,
      markdown: typeof envelope.markdown === 'string' ? envelope.markdown : '',
      icon: envelope.icon || null,
      cover: envelope.cover || null,
      parentId: envelope.parentId || meta.appProperties?.parentNoteId || null,
      parents: meta.parents || [],
      modifiedTime: meta.modifiedTime,
      createdTime: meta.createdTime,
    };
  }

  // ── Create ───────────────────────────────────────────────────────
  async function createNote(title = 'Untitled Note', content = '', parentFolderId = null, parentNoteId = null) {
    const folderId = parentFolderId || await getNotesRootId();
    let envelope;
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      envelope = _envelope({
        title,
        doc: content.doc || null,
        markdown: content.markdown || '',
        icon: content.icon || null,
        cover: content.cover || null,
        parentId: parentNoteId || content.parentId || null,
      });
    } else {
      envelope = _envelope({ title, markdown: String(content || ''), parentId: parentNoteId });
    }
    const appProps = {};
    if (envelope.parentId) appProps.parentNoteId = envelope.parentId;
    if (envelope.icon) appProps.noteIcon = envelope.icon;
    const metadata = {
      name: _buildName(title),
      mimeType: NOTE_MIME_JSON,
      parents: [folderId],
      ...(Object.keys(appProps).length ? { appProperties: appProps } : {}),
    };
    const file = await _uploadMultipart({
      url: `${UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,modifiedTime,createdTime`,
      metadata,
      body: JSON.stringify(envelope, null, 2),
    });
    return {
      id: file.id,
      title: _stripSuffix(file.name),
      format: 'tiptap',
      parentId: envelope.parentId,
      modifiedTime: file.modifiedTime,
      createdTime: file.createdTime,
    };
  }

  // ── Update ───────────────────────────────────────────────────────
  // Per-file mutex to serialize concurrent saves (matches desktop).
  const _updateLocks = new Map();
  async function updateNote(fileId, title, content) {
    const prev = _updateLocks.get(fileId) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => _updateNoteImpl(fileId, title, content));
    _updateLocks.set(fileId, next);
    try { return await next; }
    finally { if (_updateLocks.get(fileId) === next) _updateLocks.delete(fileId); }
  }
  async function _updateNoteImpl(fileId, title, content) {
    const meta = await _api().authedFetch(
      `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,parents,createdTime,appProperties`
    );
    if (meta.mimeType !== NOTE_MIME_JSON) throw new Error(`Not a JSON note: ${meta.mimeType}`);
    const existingParentId = meta.appProperties?.parentNoteId || null;
    let envelope;
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      envelope = _envelope({
        title,
        doc: content.doc || null,
        markdown: content.markdown || '',
        icon: content.icon || null,
        cover: content.cover || null,
        parentId: Object.prototype.hasOwnProperty.call(content, 'parentId')
          ? content.parentId : existingParentId,
        createdAt: meta.createdTime,
      });
    } else {
      envelope = _envelope({
        title, markdown: String(content || ''),
        parentId: existingParentId, createdAt: meta.createdTime,
      });
    }
    const metadata = {
      ...(title ? { name: _buildName(title) } : {}),
      appProperties: {
        parentNoteId: envelope.parentId || null,
        noteIcon: envelope.icon || null,
      },
    };
    const updated = await _uploadMultipart({
      url: `${UPLOAD_BASE}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,modifiedTime`,
      method: 'PATCH',
      metadata,
      body: JSON.stringify(envelope, null, 2),
    });
    return {
      id: fileId,
      title: _safeFilename(title || envelope.title),
      format: 'tiptap',
      parentId: envelope.parentId,
      modifiedTime: updated?.modifiedTime || new Date().toISOString(),
    };
  }

  // ── Delete with optional cascade ─────────────────────────────────
  // Walks the sub-page tree via appProperties.parentNoteId = <id> and
  // trashes every descendant. Cycle-safe (visited set) and depth-
  // bounded so a corrupt appProperties graph can't loop. Matches the
  // desktop deleteNote({ cascadeChildren }) shape so the bridge
  // signature is stable across platforms.
  async function deleteNote(fileId, { cascadeChildren = true } = {}) {
    const visited = new Set([fileId]);
    const toTrash = [fileId];
    if (cascadeChildren) {
      const queue = [fileId];
      let depth = 0;
      while (queue.length && depth++ < 50) {
        const levelIds = queue.splice(0, queue.length);
        // One list call per level — filter by appProperties has this parent.
        const results = await Promise.allSettled(levelIds.map(async (pid) => {
          const params = new URLSearchParams({
            q: `trashed=false and appProperties has { key='parentNoteId' and value='${_escapeQ(pid)}' }`,
            fields: 'files(id)',
            pageSize: '200',
          });
          const res = await _api().authedFetch(`${DRIVE_BASE}/files?${params}`);
          return res.files || [];
        }));
        for (const r of results) {
          if (r.status !== 'fulfilled') continue;
          for (const f of r.value) {
            if (visited.has(f.id)) continue;
            visited.add(f.id);
            toTrash.push(f.id);
            queue.push(f.id);
          }
        }
      }
    }
    // Trash in parallel; one failure doesn't block the rest.
    const trashResults = await Promise.allSettled(toTrash.map(id =>
      _api().authedFetch(
        `${DRIVE_BASE}/files/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify({ trashed: true }) }
      )
    ));
    const trashed = trashResults.filter(r => r.status === 'fulfilled').length;
    const failed = trashResults.length - trashed;
    return { success: failed === 0, trashed, failed };
  }

  // ── Folders ──────────────────────────────────────────────────────
  async function createNotesFolder(name, parentFolderId = null) {
    const parent = parentFolderId || await getNotesRootId();
    const body = { name: _safeFilename(name), mimeType: FOLDER_MIME, parents: [parent] };
    const file = await _api().authedFetch(`${DRIVE_BASE}/files?fields=id,name`, {
      method: 'POST', body: JSON.stringify(body),
    });
    return { id: file.id, title: file.name, type: 'folder' };
  }
  async function deleteNotesFolder(folderId) {
    await _api().authedFetch(
      `${DRIVE_BASE}/files/${encodeURIComponent(folderId)}`,
      { method: 'PATCH', body: JSON.stringify({ trashed: true }) }
    );
    return { success: true };
  }

  async function getRecentNoteTitles(count = 5) {
    try { const notes = await listNotes(); return notes.slice(0, count); }
    catch { return []; }
  }

  window._bloomNotes = {
    listNotes, getNote, createNote, updateNote, deleteNote,
    createNotesFolder, deleteNotesFolder, getNotesRootId, getRecentNoteTitles,
  };
})();
