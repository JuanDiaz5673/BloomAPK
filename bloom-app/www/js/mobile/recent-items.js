// ─── Recent items tracker ────────────────────────────────────────
//
// Backs electronAPI.recent.* on mobile. Persists a rolling list of
// recently-accessed items (Drive files, notes, decks) under a single
// Preferences key — one entry per (kind, id), sorted most-recent-first,
// capped at 50.
//
// The desktop service lives in src/main/services/recent-items.js; we
// match its return shape exactly so shared view code (home.js's
// "Recent Files" card, files.js's recent-row delete, search) keeps
// working identically.

(() => {
  const KEY = 'recent.items';
  const MAX = 50;

  function _store() { return window.electronAPI?.store; }

  async function _load() {
    try {
      const v = await _store()?.get(KEY);
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }
  async function _save(list) {
    try { await _store()?.set(KEY, list); } catch {}
  }

  // Normalize an incoming track payload into the canonical stored
  // shape. Accepts both the object form the Files view uses and the
  // legacy positional form the desktop preload exposes.
  function _normalize(entry, extra) {
    if (typeof entry === 'string' || typeof entry === 'number') {
      // Positional: (id, kind, name, …)
      return {
        id: String(entry),
        kind: extra || 'file',
      };
    }
    const e = entry || {};
    return {
      kind: e.kind || 'file',
      id: String(e.id || ''),
      name: e.name || '',
      mimeType: e.mimeType || e.mime || '',
      webViewLink: e.webViewLink || e.link || '',
      parentId: e.parentId || null,
    };
  }

  async function track(entry, extra) {
    const e = _normalize(entry, extra);
    if (!e.id) return { success: false };
    const now = Date.now();
    const list = await _load();
    // Dedupe by (kind, id) — keep the newer access, bubble to front.
    const filtered = list.filter(x => !(x.kind === e.kind && x.id === e.id));
    filtered.unshift({ ...e, accessedAt: now });
    // Cap so Preferences doesn't grow unbounded.
    if (filtered.length > MAX) filtered.length = MAX;
    await _save(filtered);
    try {
      window.dispatchEvent(new CustomEvent('bloom:recent-changed', {
        detail: { kind: e.kind, id: e.id },
      }));
    } catch {}
    return { success: true };
  }

  async function forget(idOrEntry, maybeKind) {
    let kind, id;
    if (typeof idOrEntry === 'string') {
      id = idOrEntry;
      kind = maybeKind || 'file';
    } else {
      kind = idOrEntry?.kind || 'file';
      id = String(idOrEntry?.id || '');
    }
    if (!id) return { success: false };
    const list = await _load();
    const next = list.filter(x => !(x.kind === kind && x.id === id));
    if (next.length === list.length) return { success: true };
    await _save(next);
    try {
      window.dispatchEvent(new CustomEvent('bloom:recent-changed', { detail: { kind, id } }));
    } catch {}
    return { success: true };
  }

  async function list(opts = {}) {
    const kind = opts.kind || null;
    const limit = Math.max(1, Math.min(Number(opts.limit) || 20, MAX));
    const all = await _load();
    const filtered = kind ? all.filter(x => x.kind === kind) : all;
    return filtered.slice(0, limit);
  }

  async function clear() {
    await _save([]);
    try { window.dispatchEvent(new CustomEvent('bloom:recent-changed')); } catch {}
    return { success: true };
  }

  // Desktop exposes `add(entry)` as an alias for track — same semantics.
  window._bloomRecent = { track, forget, list, clear, add: track };
})();
