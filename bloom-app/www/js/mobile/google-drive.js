// ─── Mobile Google Drive service ──────────────────────────────────
//
// Thin REST wrapper that lets the Files view + home "Recent Files"
// card show real data. With the `drive.file` scope we requested at
// sign-in, listFiles can only see files the app itself has touched
// (notes + study-sync files, plus anything the user explicitly
// opens via a Drive picker). Listing the user's ENTIRE Drive would
// need `drive.readonly` — a restricted scope requiring Google
// verification, out of scope for now. We document this in the UI
// (empty-state copy) where relevant.

(() => {
  const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';

  function _api() { return window._bloomGoogleApi; }
  function _escapeQ(s) { return String(s).replace(/'/g, "\\'"); }
  function _browser() { return window.Capacitor?.Plugins?.Browser; }

  function _isValidId(id) {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{5,}$/.test(id);
  }

  // ── list ─────────────────────────────────────────────────────────
  async function listFiles(folderId = 'root', pageSize = 100) {
    if (folderId !== 'root' && !_isValidId(folderId)) return [];
    const params = new URLSearchParams({
      q: `'${_escapeQ(folderId)}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,modifiedTime,size,iconLink,webViewLink,thumbnailLink,parents)',
      orderBy: 'folder,modifiedTime desc',
      pageSize: String(Math.min(Math.max(pageSize | 0, 1), 1000)),
    });
    try {
      const res = await _api().authedFetch(`${DRIVE_BASE}/files?${params}`);
      return (res.files || []).map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        isFolder: f.mimeType === FOLDER_MIME,
        modifiedTime: f.modifiedTime,
        size: f.size ? Number(f.size) : 0,
        iconLink: f.iconLink,
        webViewLink: f.webViewLink,
        thumbnailLink: f.thumbnailLink,
        parents: f.parents || [],
      }));
    } catch (err) {
      console.warn('[drive] listFiles failed:', err?.message || err);
      return [];
    }
  }

  async function searchFiles(query, pageSize = 50) {
    const q = String(query || '').trim();
    if (!q) return [];
    const params = new URLSearchParams({
      // Simple fullText search; quoting prevents syntax errors on apostrophes.
      q: `fullText contains '${_escapeQ(q)}' and trashed=false`,
      fields: 'files(id,name,mimeType,modifiedTime,iconLink,webViewLink)',
      pageSize: String(Math.min(Math.max(pageSize | 0, 1), 200)),
    });
    try {
      const res = await _api().authedFetch(`${DRIVE_BASE}/files?${params}`);
      return (res.files || []).map(f => ({
        id: f.id, name: f.name, mimeType: f.mimeType,
        isFolder: f.mimeType === FOLDER_MIME,
        modifiedTime: f.modifiedTime,
        iconLink: f.iconLink, webViewLink: f.webViewLink,
      }));
    } catch { return []; }
  }

  // ── folder / upload / delete ────────────────────────────────────
  async function createFolder(parentId = 'root', name = 'New Folder') {
    if (parentId !== 'root' && !_isValidId(parentId)) throw new Error('Invalid parent id');
    const body = {
      name: String(name || 'New Folder').slice(0, 255),
      mimeType: FOLDER_MIME,
      parents: [parentId],
    };
    const res = await _api().authedFetch(`${DRIVE_BASE}/files?fields=id,name,mimeType`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { id: res.id, name: res.name, mimeType: res.mimeType, isFolder: true };
  }

  async function deleteFile(fileId) {
    if (!_isValidId(fileId)) throw new Error('Invalid file id');
    await _api().authedFetch(
      `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}`,
      { method: 'PATCH', body: JSON.stringify({ trashed: true }) }
    );
    return { success: true };
  }

  // ── preview / open ──────────────────────────────────────────────
  // Returns a data-URI suitable for <img>/<video>/<iframe>. Only used
  // for small files. The bridge enforces a size cap — we set it here
  // as well so a misconfigured caller can't blow the WebView memory.
  const MAX_PREVIEW = 25 * 1024 * 1024; // 25 MB
  async function getFileAsDataUri(fileId, mimeType) {
    if (!_isValidId(fileId)) return null;
    try {
      const auth = window._bloomGoogle;
      const token = await auth?.getAccessToken();
      if (!token) return null;
      // Google Docs/Sheets/Slides → need export endpoint, not alt=media.
      // Plain Drive files use alt=media for raw bytes.
      const isGoogleNative = typeof mimeType === 'string'
        && mimeType.startsWith('application/vnd.google-apps');
      const url = isGoogleNative
        ? `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(mimeType.includes('document') ? 'application/pdf' : 'application/pdf')}`
        : `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}?alt=media`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.size > MAX_PREVIEW) return null;
      const dataUri = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
      // Desktop returns { dataUri, size, mimeType } — match it so the
      // files view's destructuring (`const { dataUri } = await …`)
      // continues to work without special-casing mobile.
      return { dataUri, size: blob.size, mimeType: blob.type || mimeType };
    } catch (err) {
      console.warn('[drive] getFileAsDataUri failed:', err?.message || err);
      return null;
    }
  }

  // Opens the Drive file in the system browser (Chrome Custom Tab).
  // Native open with the Drive app would need a FileProvider URI —
  // bigger Phase-4 surface; web view covers every file type today.
  async function openFile(fileIdOrLink, webViewLink) {
    const url = webViewLink || (_isValidId(fileIdOrLink)
      ? `https://drive.google.com/file/d/${encodeURIComponent(fileIdOrLink)}/view`
      : String(fileIdOrLink || ''));
    if (!url) return { success: false, error: 'No link' };
    try {
      if (_browser()) {
        await _browser().open({ url });
        return { success: true };
      }
      window.open(url, '_blank');
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err?.message || err) };
    }
  }

  window._bloomDrive = {
    listFiles, searchFiles, createFolder, deleteFile,
    getFileAsDataUri, openFile,
  };
})();
