// ─── Notes View (TipTap) ───
// Migrated from Quill to TipTap in April 2026. The editor surface, slash
// command menu, and bubble menu are all driven by window.AllDashEditor,
// which is the pre-bundled IIFE at vendor/tiptap.bundle.js (built by
// build-scripts/tiptap-bundle/build.js).
//
// Storage is now JSON-on-Drive (format: 'tiptap') with legacy Google Docs
// auto-upgraded on first save. See google-drive.js for the envelope shape.
const NotesView = (() => {
  let editor = null;              // TipTap Editor instance
  let selectedNoteId = null;
  let selectedNoteFormat = null;  // 'tiptap' | 'legacy-html'
  let saveTimeout = null;
  let currentFolderId = null;     // null = root notes folder
  let noteBreadcrumb = [{ id: null, name: 'All Notes' }];
  // Guards the save pipeline from firing on programmatic setContent calls
  // (loading an existing note) — otherwise we'd trigger a save loop.
  let suppressSave = false;
  // Currently-loaded note's icon (emoji string) — kept in module state so
  // saveNote can include it in the envelope without an extra DOM lookup.
  let selectedNoteIcon = null;
  // Nested-page state. `_expandedNotes` tracks which parent notes have their
  // children visible in the sidebar tree. `_noteMetaCache` is a lightweight
  // {id → {title, parentId, icon}} map used for breadcrumb walks + sidebar
  // emoji rendering so we don't have to fetch each ancestor's full note
  // envelope just to render a chain.
  const _expandedNotes = new Set();
  const _noteMetaCache = new Map();

  function render() {
    return `
    <div class="notes-view">
      <div class="notes-list-panel glass-card" style="border-radius:16px;animation:fadeSlideUp 0.5s ease 0.05s both;">
        <div class="notes-list-header">
          <h3 style="font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:400;" data-i18n="nav_notes">Notes</h3>
          <div style="display:flex;gap:4px;">
            <button class="new-chat-btn" id="new-folder-btn" title="New folder">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
            </button>
            <button class="new-chat-btn" id="new-note-btn" title="New note">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
        </div>
        <div class="notes-breadcrumb" id="notes-breadcrumb"></div>
        <div class="notes-list" id="notes-list">
          <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;">Loading...</div>
        </div>
      </div>
      <div class="notes-editor-panel glass-card" style="border-radius:20px;animation:fadeSlideUp 0.5s ease 0.1s both;">
        <!-- Editor header with integrated Notion-style icon slot.
             The slot sits ABOVE the title inside this same header (no separate
             band), and collapses to zero height when no icon is set so the
             header stays compact. The "+ Add icon" button reveals on hover
             only when no icon exists — matching Notion's invisible-until-
             hover pattern. -->
        <div class="notes-editor-header" id="notes-editor-header">
          <div class="nt-header-icon-slot" id="nt-header-icon-slot">
            <button class="nt-page-icon" id="nt-page-icon" title="Change icon">
              <span class="nt-page-icon-emoji" id="nt-page-icon-emoji"></span>
            </button>
            <button class="nt-page-icon-add" id="nt-page-icon-add" title="Add icon">
              <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
              <span>Add icon</span>
            </button>
          </div>
          <div class="nt-header-main">
            <input class="notes-title-input" id="note-title" type="text" placeholder="Click here to start a new note..." style="cursor:pointer;">
            <div class="nt-header-actions">
              <span class="notes-save-status" id="save-status" style="display:none;">Saved</span>
              <button class="notes-delete-btn" id="delete-note-btn" title="Delete note" style="display:none;">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        </div>
        <div id="notes-editor-container" style="flex:1;display:flex;flex-direction:column;min-height:0;">
          <div class="notes-empty" id="notes-empty" style="cursor:pointer;">
            <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1" style="opacity:0.35;animation:float 4s ease-in-out infinite;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <div style="font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:400;color:var(--text-secondary);">Start writing</div>
            <p style="font-size:12px;max-width:240px;text-align:center;line-height:1.6;">Click anywhere to create a new note</p>
          </div>
        </div>
        <!-- Nested-pages footer status bar. Breadcrumb on the left (visible
             only when the note is a sub-page), "+ Add sub-page" action on
             the right (always visible once a note is open). Hidden entirely
             when no note is loaded so the empty state stays clean. -->
        <div class="nt-footer" id="nt-footer" style="display:none;">
          <div class="nt-footer-crumbs" id="nt-footer-crumbs"></div>
          <button class="nt-footer-add" id="nt-footer-add" title="Add a sub-page">
            <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>Sub-page</span>
          </button>
        </div>
      </div>
    </div>`;
  }

  async function init() {
    _isMounted = true;
    document.getElementById('new-note-btn')?.addEventListener('click', createNote);
    document.getElementById('new-folder-btn')?.addEventListener('click', createFolder);
    // Empty-state click → behaves identically to clicking the new-note btn.
    // Was an inline `onclick=` previously; moved to a real listener so
    // strict CSP (script-src 'self' without 'unsafe-inline') doesn't block it.
    document.getElementById('notes-empty')?.addEventListener('click', createNote);
    document.getElementById('note-title')?.addEventListener('input', () => scheduleSave());
    document.getElementById('delete-note-btn')?.addEventListener('click', deleteNote);
    document.getElementById('nt-footer-add')?.addEventListener('click', _addSubPageFromFooter);
    // Both the big emoji (change it) and the +Add icon placeholder open the picker
    const openIconPicker = (e) => {
      e.stopPropagation();
      _showEmojiPicker(e.currentTarget, (emoji) => {
        selectedNoteIcon = emoji;
        _applyPageIconUI();

        // Optimistically sync the sidebar + meta cache so the emoji appears
        // instantly in the notes list (don't wait for the debounced save to
        // flush + Drive to round-trip the appProperties update).
        if (selectedNoteId) {
          const prev = _noteMetaCache.get(selectedNoteId) || { id: selectedNoteId };
          _noteMetaCache.set(selectedNoteId, { ...prev, id: selectedNoteId, icon: emoji });
          _updateSidebarRowIcon(selectedNoteId, emoji);
          // Also refresh any pageLink cards in the current note that reference
          // OTHER notes — won't change, but if this note is referenced elsewhere
          // we can't update those (those live in different docs).
        }

        scheduleSave();
      });
    };
    document.getElementById('nt-page-icon')?.addEventListener('click', openIconPicker);
    document.getElementById('nt-page-icon-add')?.addEventListener('click', openIconPicker);

    // Click on title when no note selected → create a new note
    document.getElementById('note-title')?.addEventListener('click', async () => {
      if (!selectedNoteId) await createNote();
    });

    if (!window.electronAPI) return;
    let isAuthenticated = false;
    try {
      const status = await window.electronAPI.google.getStatus();
      isAuthenticated = status.authenticated;
    } catch {}

    if (!isAuthenticated) {
      const listEl = document.getElementById('notes-list');
      if (listEl) listEl.innerHTML = `<div style="text-align:center;padding:30px 16px;display:flex;flex-direction:column;align-items:center;gap:12px;">
        <svg viewBox="0 0 24 24" width="36" height="36" stroke="var(--accent-blush)" stroke-width="1" fill="none" style="opacity:0.4;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <div style="font-size:12px;color:var(--text-muted);font-weight:300;line-height:1.6;text-align:center;">Connect your Google account in Settings to sync notes.</div>
        <button class="btn-pink" data-nav="settings" style="padding:7px 18px;font-size:11px;">Connect</button>
      </div>`;
      return;
    }

    currentFolderId = null;
    noteBreadcrumb = [{ id: null, name: 'All Notes' }];
    await loadNotesList();

    // Deep link: open a specific note if requested (from search result, etc)
    const link = typeof Router !== 'undefined' ? Router.consumeDeepLink('note') : null;
    if (link?.id) {
      try { await loadNote(link.id); } catch (err) { console.warn('Deep-link to note failed:', err); }
    }

    // Listen for AI tool mutations → refresh sidebar + (if relevant) the open note.
    _attachNotesChangedListener();
  }

  let _notesChangedCleanup = null;
  function _attachNotesChangedListener() {
    if (_notesChangedCleanup) _notesChangedCleanup();
    if (!window.electronAPI?.notes?.onChanged) return;
    _notesChangedCleanup = window.electronAPI.notes.onChanged(async (payload) => {
      // Bail if the view has been unmounted between broadcast and dispatch.
      // Without this guard, the handler can mutate stale DOM, fire toasts on
      // unrelated screens, and call into a destroyed editor.
      if (!_isMounted) return;

      try { await loadNotesList(); } catch {}
      if (!_isMounted) return; // re-check after the await

      if (payload?.type === 'updated' && payload.id && payload.id === selectedNoteId) {
        // CRITICAL: flush any pending user save BEFORE pulling the AI's
        // version from disk, otherwise we silently overwrite in-flight
        // edits the user typed since the last debounce tick. saveNote()
        // is idempotent on no-op + clears its own status.
        if (saveTimeout) {
          clearTimeout(saveTimeout);
          saveTimeout = null;
          try { await saveNote(); } catch {}
        }
        try { await loadNote(payload.id); } catch {}
      }
      if (!_isMounted) return;
      if (payload?.type === 'deleted' && payload.id && payload.id === selectedNoteId) {
        _clearEditor();
      }
      if (payload?.type === 'created' && payload.id && !selectedNoteId) {
        try { await loadNote(payload.id); } catch {}
      }

      if (_isMounted && typeof Toast !== 'undefined' && payload?.title) {
        const verb = payload.type === 'created' ? 'created' : payload.type === 'deleted' ? 'deleted' : 'updated';
        Toast.show(`Note ${verb}: ${payload.title}`, 'info', 2500);
      }
    });
  }

  async function loadNotesList() {
    const listEl = document.getElementById('notes-list');
    if (!listEl || !window.electronAPI) return;

    updateBreadcrumb();

    try {
      const items = await window.electronAPI.notes.list(currentFolderId);

      if (items.length === 0) {
        listEl.innerHTML = `<div style="text-align:center;padding:24px 16px;color:var(--text-muted);font-size:12px;font-weight:300;line-height:1.6;">Empty. Click + to create a note or folder.</div>`;
        return;
      }

      const folders = items.filter(i => i.type === 'folder');
      const notes = items.filter(i => i.type === 'document');

      // Populate the meta cache so Phase 3's breadcrumb can walk ancestors without
      // re-fetching each one. We also pick up notes that came in via expand-folder
      // tree lookups, not just the current folder.
      notes.forEach(n => {
        // listNotes now returns `icon` from Drive appProperties, so this is
        // the authoritative source after a fresh list. If the list doesn't
        // include icon for some reason, fall back to whatever we already had.
        const prev = _noteMetaCache.get(n.id);
        _noteMetaCache.set(n.id, {
          id: n.id,
          title: n.title,
          parentId: n.parentId || null,
          icon: n.icon ?? prev?.icon ?? null,
        });
      });

      // Build the parent-children map for nested sub-pages. Only notes whose
      // parentId is IN this folder are nested — orphans (parent in a different
      // folder, or parent deleted entirely) fall through to the root list so
      // they're still reachable.
      const idSet = new Set(notes.map(n => n.id));
      const childrenMap = new Map();
      notes.forEach(n => {
        const hasLocalParent = n.parentId && idSet.has(n.parentId);
        const key = hasLocalParent ? n.parentId : '__root__';
        if (!childrenMap.has(key)) childrenMap.set(key, []);
        childrenMap.get(key).push(n);
      });
      const rootNotes = childrenMap.get('__root__') || [];

      let html = '';

      // ── Folders (unchanged pattern) ──
      html += folders.map(f => `
        <div class="note-folder-wrapper">
          <div class="note-folder-row" data-folder-id="${_escapeAttr(f.id)}" data-folder-name="${_escapeAttr(f.title)}">
            <button class="note-tree-toggle" data-tree-id="${f.id}" title="Expand folder" aria-label="Expand folder">
              <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <div class="note-folder-icon-tile">
              <svg viewBox="0 0 24 24" width="15" height="15" stroke="var(--accent-warm)" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div class="note-folder-text">
              <div class="note-folder-name">${_escapeHtml(f.title)}</div>
              <div class="note-folder-meta">Folder</div>
            </div>
            <button class="note-folder-delete" data-del-folder="${_escapeAttr(f.id)}" data-del-name="${_escapeAttr(f.title)}" title="Delete folder" aria-label="Delete folder">
              <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
          <div class="note-tree-children" id="note-tree-${f.id}" style="display:none;"></div>
        </div>
      `).join('');

      // ── Notes (flat DOM — Notion-style) ──
      // We walk the tree depth-first and emit rows as siblings, each carrying
      // its depth on a CSS variable. Indentation is then applied via
      // `padding-left: calc(... * var(--nt-depth))` inside CSS — so no nested
      // wrapper divs compound margin at deep levels. We also flag each row
      // with `isLast` when it's the last direct sibling of its parent, so the
      // CSS tree connector can truncate its vertical line at that row's elbow
      // instead of continuing through empty space.
      const rowAcc = [];
      const walk = (parentKey, depth) => {
        const kids = childrenMap.get(parentKey) || [];
        kids.forEach((note, i) => {
          const isLast = i === kids.length - 1;
          rowAcc.push(_renderNoteRow(note, childrenMap, depth, { isLast }));
          if (_expandedNotes.has(note.id)) walk(note.id, depth + 1);
        });
      };
      walk('__root__', 0);
      html += rowAcc.join('');

      listEl.innerHTML = html;

      // Folder click → navigate into (but not on toggle or delete)
      listEl.querySelectorAll('.note-folder-row').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.note-folder-delete') || e.target.closest('.note-tree-toggle')) return;
          const fId = item.dataset.folderId;
          const fName = item.dataset.folderName;
          noteBreadcrumb.push({ id: fId, name: fName });
          currentFolderId = fId;
          loadNotesList();
        });
      });

      // Tree toggle → expand/collapse folder contents inline
      listEl.querySelectorAll('.note-tree-toggle').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const folderId = btn.dataset.treeId;
          const childContainer = document.getElementById(`note-tree-${folderId}`);
          if (!childContainer) return;

          const isOpen = childContainer.style.display !== 'none';
          if (isOpen) {
            childContainer.style.display = 'none';
            btn.classList.remove('expanded');
            return;
          }

          childContainer.innerHTML = `<div style="padding:6px 12px;color:var(--text-muted);font-size:10px;">Loading...</div>`;
          childContainer.style.display = 'block';
          btn.classList.add('expanded');

          try {
            const children = await window.electronAPI.notes.list(folderId);
            if (children.length === 0) {
              childContainer.innerHTML = `<div style="padding:6px 12px;color:var(--text-muted);font-size:10px;font-weight:300;">Empty folder</div>`;
              return;
            }
            childContainer.innerHTML = children.map(c => {
              if (c.type === 'folder') {
                return `<div class="note-tree-item note-tree-folder" data-folder-id="${_escapeAttr(c.id)}" data-folder-name="${_escapeAttr(c.title)}">
                  <svg viewBox="0 0 24 24" width="13" height="13" stroke="var(--accent-warm)" stroke-width="1.8" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                  <span>${_escapeHtml(c.title)}</span>
                </div>`;
              }
              return `<div class="note-tree-item" data-note-id="${_escapeAttr(c.id)}">
                <svg viewBox="0 0 24 24" width="13" height="13" stroke="var(--accent-pink)" stroke-width="1.8" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span>${_escapeHtml(c.title)}</span>
              </div>`;
            }).join('');

            childContainer.querySelectorAll('.note-tree-item[data-note-id]').forEach(item => {
              item.addEventListener('click', () => loadNote(item.dataset.noteId));
            });
            childContainer.querySelectorAll('.note-tree-folder').forEach(item => {
              item.addEventListener('click', () => {
                noteBreadcrumb.push({ id: item.dataset.folderId, name: item.dataset.folderName });
                currentFolderId = item.dataset.folderId;
                loadNotesList();
              });
            });
          } catch {
            childContainer.innerHTML = `<div style="padding:6px 12px;color:var(--text-muted);font-size:10px;">Failed to load</div>`;
          }
        });
      });

      listEl.querySelectorAll('.note-folder-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const confirmed = await Confirm.show(`Delete folder "${btn.dataset.delName}" and all its contents?`, 'Delete Folder');
          if (!confirmed) return;
          try {
            await window.electronAPI.notes.deleteFolder(btn.dataset.delFolder);
            Toast.show('Folder deleted', 'info');
            await loadNotesList();
          } catch (err) {
            Toast.show('Failed to delete folder', 'error');
          }
        });
      });

      // Note click → load. Uses `.nt-row[data-note-id]` + legacy
      // `.note-list-item[data-note-id]` for safety (shouldn't exist anymore).
      listEl.querySelectorAll('.nt-row[data-note-id], .note-list-item[data-note-id]').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.nt-delete, .note-quick-delete')) return;
          if (e.target.closest('.nt-toggle, .note-children-toggle')) return;
          loadNote(item.dataset.noteId);
        });
      });

      // Expand/collapse a parent note's children tree
      listEl.querySelectorAll('.nt-toggle, .note-children-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.dataset.parentId;
          if (!id) return;
          if (_expandedNotes.has(id)) _expandedNotes.delete(id);
          else _expandedNotes.add(id);
          loadNotesList();
        });
      });

      // Delete a note — use cascade-aware helper when the note has children
      listEl.querySelectorAll('.note-quick-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await _deleteNoteWithCascade(btn.dataset.delNote, btn.dataset.delName, childrenMap);
        });
      });
    } catch (err) {
      listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;">Failed to load notes.</div>`;
    }
  }

  // Single flat renderer for ALL notes at ALL depths (Notion-style).
  // Every row gets the same layout: [chevron-or-spacer] [icon] [title] [delete].
  // `--nt-depth` drives left-padding via CSS — no nested wrapper divs, so the
  // sidebar can handle any nesting depth without layout breakage. The
  // `{ isLast }` flag drives the tree-connector rendering in CSS: last
  // children omit the `::after` continuation line so the elbow is clean.
  function _renderNoteRow(note, childrenMap, depth, opts = {}) {
    const children = childrenMap.get(note.id) || [];
    const hasChildren = children.length > 0;
    const isExpanded = _expandedNotes.has(note.id);
    const isActive = note.id === selectedNoteId ? 'active' : '';
    const isLast = !!opts.isLast;

    // Chevron slot is ALWAYS reserved so leaf/parent rows align at the same
    // column — an `.nt-toggle-empty` placeholder takes the same width as the
    // button when there are no children. Matches the Notion pattern.
    const chevron = hasChildren
      ? `<button class="nt-toggle ${isExpanded ? 'expanded' : ''}" data-parent-id="${_escapeAttr(note.id)}" aria-label="${isExpanded ? 'Collapse' : 'Expand'} sub-pages">
          <svg viewBox="0 0 24 24" width="9" height="9" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>`
      : `<span class="nt-toggle-empty" aria-hidden="true"></span>`;

    // Icon column: emoji if the note has one set, otherwise the default
    // document SVG. Emoji characters don't need escaping since they're not
    // HTML-sensitive; still wrap defensively.
    const cachedIcon = _noteMetaCache.get(note.id)?.icon;
    const iconHTML = cachedIcon
      ? `<span class="nt-icon nt-icon-emoji" aria-hidden="true">${_escapeHtml(cachedIcon)}</span>`
      : `<span class="nt-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>`;

    const classes = ['nt-row'];
    if (isActive) classes.push('active');
    if (isLast) classes.push('nt-last-child');

    return `
      <div class="${classes.join(' ')}" data-note-id="${_escapeAttr(note.id)}" data-depth="${depth}" style="--nt-depth:${depth}">
        ${chevron}
        ${iconHTML}
        <span class="nt-title">${_escapeHtml(note.title)}</span>
        <button class="nt-delete note-quick-delete" data-del-note="${_escapeAttr(note.id)}" data-del-name="${_escapeAttr(note.title)}" title="Delete">
          <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;
  }

  // Recursively collect all descendants of a note ID using the childrenMap.
  function _collectDescendants(noteId, childrenMap) {
    const acc = [];
    const walk = (id) => {
      const kids = childrenMap.get(id) || [];
      for (const k of kids) { acc.push(k); walk(k.id); }
    };
    walk(noteId);
    return acc;
  }

  // Delete a note, asking about cascading when sub-pages are present.
  // Notion behavior: the "Delete all" option is the default (primary button).
  //
  // Server-side cascade: notes.delete now defaults to cascading the trash
  // through every descendant via Drive's appProperties query. We let the
  // server do the work for "Delete all"; for "Keep sub-pages" we re-parent
  // first then call delete with cascadeChildren:false so only the leaf
  // gets trashed.
  async function _deleteNoteWithCascade(noteId, name, childrenMap) {
    if (!_isValidDriveId(noteId)) return;
    const descendants = _collectDescendants(noteId, childrenMap);
    let cascadeChildren = false;

    if (descendants.length > 0) {
      const choice = await _confirmCascade(name, descendants.length);
      if (choice === 'cancel') return;
      cascadeChildren = (choice === 'cascade');
    } else {
      const confirmed = await Confirm.show(`Delete "${name}"?`, 'Delete Note');
      if (!confirmed) return;
    }

    try {
      if (!cascadeChildren && descendants.length > 0) {
        // Keep sub-pages: re-parent each DIRECT child to top-level by
        // clearing parentId. Grandchildren stay linked to their immediate
        // parent. We re-parent BEFORE deletion so a partial failure leaves
        // a child in the wrong tree (visible) rather than silently orphaned
        // (hidden behind a trashed parent).
        const directKids = childrenMap.get(noteId) || [];
        const reparentFailures = [];
        for (const k of directKids) {
          try {
            await window.electronAPI.notes.update(k.id, k.title, { parentId: null });
            const meta = _noteMetaCache.get(k.id);
            if (meta) _noteMetaCache.set(k.id, { ...meta, parentId: null });
          } catch (err) {
            reparentFailures.push(k.title);
            console.warn('Failed to unnest child', k.id, err);
          }
        }
        if (reparentFailures.length > 0) {
          // Abort: deleting the parent now would orphan these children behind
          // a trashed parent (they'd disappear from the sidebar). Surface the
          // error so the user can retry rather than silently losing them.
          Toast.show(
            `Couldn't re-parent ${reparentFailures.length} sub-page(s). Delete cancelled — try again.`,
            'error',
            4000
          );
          return;
        }
      }

      // Single delete call — server cascades all descendants when cascadeChildren
      // is true (default), or trashes only the leaf when false.
      const result = await window.electronAPI.notes.delete(noteId, { cascadeChildren });
      _noteMetaCache.delete(noteId);
      _expandedNotes.delete(noteId);
      if (cascadeChildren) {
        for (const d of descendants) _noteMetaCache.delete(d.id);
      }

      if (cascadeChildren && result?.failed > 0) {
        Toast.show(
          `Deleted "${name}" + ${result.trashed - 1} of ${descendants.length} sub-pages (${result.failed} failed). Check console.`,
          'warning', 4000
        );
      } else if (cascadeChildren) {
        Toast.show(`Deleted "${name}" + ${descendants.length} sub-pages`, 'info');
      } else {
        Toast.show('Note deleted', 'info');
      }

      if (selectedNoteId === noteId || (cascadeChildren && descendants.some(d => d.id === selectedNoteId))) {
        _clearEditor();
      }
      await loadNotesList();
    } catch (err) {
      console.error(err);
      Toast.show('Failed to delete note', 'error');
    }
  }

  // Build + render the parent-breadcrumb INSIDE the footer status bar at the
  // bottom of the editor panel. No standalone header — the footer shows:
  //   [Trip › Paris › Day 3]        [+ Sub-page]
  // The crumbs area is empty when the note has no parent (it's a root note);
  // the "+ Sub-page" button is always shown when a note is loaded.
  async function _renderParentBreadcrumb(parentId) {
    const footer = document.getElementById('nt-footer');
    const crumbs = document.getElementById('nt-footer-crumbs');
    if (!footer || !crumbs) return;

    // Footer is always visible when ANY note is loaded — it carries the
    // "+ Sub-page" action. The crumbs area is just empty for root notes.
    footer.style.display = selectedNoteId ? 'flex' : 'none';

    if (!parentId) {
      crumbs.innerHTML = '';
      return;
    }

    const chain = await _resolveAncestorChain(parentId);
    if (chain.length === 0) {
      crumbs.innerHTML = '';
      return;
    }

    // chain is ordered from oldest ancestor → immediate parent. Render as
    // clickable pills joined by chevron separators. Long chains collapse
    // the middle into a "…" popover.
    const segs = _buildBreadcrumbSegments(chain);
    crumbs.innerHTML = `<span class="nt-footer-label">in</span>` + segs.join('<span class="pb-sep">›</span>');

    crumbs.querySelectorAll('.pb-seg[data-id]').forEach(el => {
      el.addEventListener('click', () => {
        clearTimeout(saveTimeout);
        Promise.resolve(selectedNoteId ? saveNote() : null).finally(() => {
          loadNote(el.dataset.id);
        });
      });
    });

    // Truncated middle — click to expand hidden segments.
    crumbs.querySelectorAll('.pb-ellipsis').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        let hidden;
        try { hidden = JSON.parse(el.dataset.hidden || '[]'); } catch { hidden = []; }
        const menu = document.createElement('div');
        menu.className = 'pb-ellipsis-menu';
        // Build menu items via DOM construction (NOT innerHTML interpolation)
        // — h.title comes from note titles which can contain arbitrary user
        // characters. textContent guarantees no HTML/JS execution.
        for (const h of hidden) {
          if (!_isValidDriveId(h.id)) continue;
          const item = document.createElement('div');
          item.className = 'pb-ellipsis-item';
          item.dataset.id = h.id;
          item.textContent = h.title || '';
          menu.appendChild(item);
        }
        el.appendChild(menu);

        // Register the open menu so destroy() can drain it if the view is
        // unmounted while the menu is up. Otherwise the document listener +
        // closure leak forever.
        const closeMenu = () => {
          menu.remove();
          document.removeEventListener('click', closeMenu);
          unregister();
        };
        const unregister = _registerOverlay({ remove: closeMenu });
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
        menu.addEventListener('click', (ev) => {
          const item = ev.target.closest('.pb-ellipsis-item');
          if (item?.dataset.id && _isValidDriveId(item.dataset.id)) {
            closeMenu();
            clearTimeout(saveTimeout);
            saveTimeout = null;
            Promise.resolve(selectedNoteId ? saveNote() : null).finally(() => loadNote(item.dataset.id));
          }
        });
      });
    });
  }

  // Create a new sub-page from the "+ Sub-page" button in the footer.
  // Works identically to the `/page` slash command but doesn't insert a
  // PageLink card in the editor — the new page is linked purely via the
  // parentId field, which is what the sidebar tree uses.
  async function _addSubPageFromFooter() {
    if (!selectedNoteId) return;
    const title = await Confirm.prompt('Give your new page a title:', 'New sub-page', 'Untitled page');
    if (title === null) return;
    const finalTitle = (title || '').trim() || 'Untitled page';
    try {
      const created = await window.electronAPI.notes.create(
        finalTitle, '', currentFolderId, selectedNoteId
      );
      // Cache + expand the new parent so the child shows immediately.
      _noteMetaCache.set(created.id, { id: created.id, title: finalTitle, parentId: selectedNoteId });
      _expandedNotes.add(selectedNoteId);
      // Also insert a PageLink card at the end of the editor doc for
      // discoverability — clicking it opens the sub-page like `/page` does.
      if (editor) {
        editor.chain().focus('end').insertContent([
          { type: 'pageLink', attrs: { noteId: created.id, title: finalTitle } },
          { type: 'paragraph' },
        ]).run();
        // Force a synchronous save of the parent doc — without this, the
        // PageLink card lives only in the unsaved buffer for up to 1s
        // (debounce window). Closing the app within that window orphans
        // the new child (it exists on Drive but the parent has no link).
        clearTimeout(saveTimeout);
        saveTimeout = null;
        try { await saveNote(); } catch (e) { console.warn('Sub-page parent save failed:', e); }
      }
      Toast.show(`Created sub-page: ${finalTitle}`, 'success', 2200);
      await loadNotesList();
    } catch (err) {
      console.error(err);
      Toast.show('Failed to create sub-page', 'error');
    }
  }

  // Walks up from `startId` building a chain of {id, title, parentId} ancestors,
  // oldest → newest. Uses the meta cache first, fetches from disk as a fallback.
  async function _resolveAncestorChain(startId) {
    const chain = [];
    let cursor = startId;
    const seen = new Set();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      let meta = _noteMetaCache.get(cursor);
      // Refetch if cache lacks icon info (cached from a list-only pass)
      if (!meta || meta.icon === undefined) {
        try {
          const note = await window.electronAPI.notes.get(cursor);
          meta = {
            id: note.id,
            title: note.title,
            parentId: note.parentId || null,
            icon: note.icon || null,
          };
          _noteMetaCache.set(cursor, meta);
        } catch {
          // Ancestor deleted or unreachable — stop the walk, mark it.
          chain.unshift({ id: cursor, title: 'Deleted page', parentId: null, deleted: true });
          break;
        }
      }
      chain.unshift(meta);
      cursor = meta.parentId;
    }
    return chain;
  }

  // Compose the breadcrumb segment HTML, truncating with "..." when there are
  // more than 3 ancestors so the bar stays on one line. The ellipsis carries
  // the hidden segments as JSON on a data attribute for popover expansion.
  function _buildBreadcrumbSegments(chain) {
    const iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    const segFor = (a) => {
      // Emoji icon if the ancestor has one, otherwise the default doc SVG.
      const iconHTML = a.icon ? `<span class="pb-emoji">${_escapeHtml(a.icon)}</span>` : iconSvg;
      if (a.deleted) return `<span class="pb-seg pb-deleted" title="This page was deleted">${iconSvg}<span>${_escapeHtml(a.title)}</span></span>`;
      return `<span class="pb-seg" data-id="${_escapeAttr(a.id)}">${iconHTML}<span>${_escapeHtml(a.title)}</span></span>`;
    };

    if (chain.length <= 3) return chain.map(segFor);

    // chain[0] is oldest root, chain[chain.length-1] is immediate parent
    const first = chain[0];
    const last = chain[chain.length - 1];
    const hidden = chain.slice(1, -1);
    // hidden is JSON-stringified into an attribute. JSON.stringify produces
    // text containing `"` which MUST be attribute-escaped — _escapeHtml is
    // not enough because it doesn't escape quotes. The ellipsis click
    // handler JSON.parse()s this back out via dataset.hidden.
    const hiddenJson = _escapeAttr(JSON.stringify(hidden.map(h => ({ id: h.id, title: h.title }))));
    return [
      segFor(first),
      `<span class="pb-ellipsis" data-hidden="${hiddenJson}" title="${hidden.length} more">…</span>`,
      segFor(last),
    ];
  }

  // Expand every ancestor of `noteId` in the sidebar tree so the currently-
  // selected note is visible. Called after loadNote for sub-pages.
  function _ensureAncestorsExpanded(parentId) {
    let cursor = parentId;
    const seen = new Set();
    let changed = false;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (!_expandedNotes.has(cursor)) {
        _expandedNotes.add(cursor);
        changed = true;
      }
      const meta = _noteMetaCache.get(cursor);
      cursor = meta?.parentId || null;
    }
    if (changed) loadNotesList();
  }

  // Update a note's icon (used when the user clicks a pageLink card's icon
  // in the editor to change a LINKED note's emoji without opening it). We
  // fetch the full envelope first so the update preserves doc + markdown +
  // parentId — otherwise passing a partial content object would wipe them.
  async function _updateNoteIcon(noteId, emoji) {
    const note = await window.electronAPI.notes.get(noteId);

    // If this also happens to be the currently-open note (unusual — pageLinks
    // normally target other notes — but guard against it), update the module
    // state so the header's emoji stays in sync with the save.
    if (noteId === selectedNoteId) selectedNoteIcon = emoji;

    await window.electronAPI.notes.update(noteId, note.title, {
      doc: note.doc,
      markdown: note.markdown,
      icon: emoji,
      parentId: note.parentId || null,
    });

    // Update the in-memory cache so subsequent renders pick up the new icon.
    const prev = _noteMetaCache.get(noteId) || { id: noteId };
    _noteMetaCache.set(noteId, {
      ...prev,
      id: noteId,
      title: note.title,
      parentId: note.parentId || null,
      icon: emoji,
    });

    // Refresh surfaces:
    //   • sidebar row for this note
    //   • the big emoji above the title if this IS the currently-open note
    //   • all pageLink cards in the currently-open editor that reference it
    _updateSidebarRowIcon(noteId, emoji);
    if (noteId === selectedNoteId) _applyPageIconUI();
    _updatePageLinkCardIcons(noteId, emoji);

    Toast.show(emoji ? `Set icon: ${emoji}` : 'Removed icon', 'success', 1600);
  }

  // Update every `.tt-page-link` card in the current editor that points at
  // `noteId`. Lets the user change an icon via one pageLink card and see ALL
  // references to that note update in place.
  function _updatePageLinkCardIcons(noteId, emoji) {
    const root = document.getElementById('tiptap-editor');
    if (!root) return;
    root.querySelectorAll(`.tt-page-link[data-note-id="${noteId}"]`).forEach(link => {
      const iconWrapper = link.querySelector('.tt-page-link-icon');
      if (!iconWrapper) return;
      const existing = iconWrapper.querySelector('.tt-page-link-emoji');
      if (emoji) {
        if (existing) existing.textContent = emoji;
        else {
          const em = document.createElement('span');
          em.className = 'tt-page-link-emoji';
          em.textContent = emoji;
          iconWrapper.appendChild(em);
        }
        iconWrapper.classList.add('has-emoji');
      } else if (existing) {
        existing.remove();
        iconWrapper.classList.remove('has-emoji');
      }
    });
  }

  // Surgically swap the icon element in a single sidebar row without
  // re-rendering the whole notes list. Keeps the expand state, scroll
  // position, and hover effects intact — way smoother than loadNotesList()
  // for a single-note icon change.
  function _updateSidebarRowIcon(noteId, icon) {
    const row = document.querySelector(`.nt-row[data-note-id="${noteId}"]`);
    if (!row) return;
    const oldIcon = row.querySelector('.nt-icon');
    if (!oldIcon) return;
    const replacement = icon
      ? `<span class="nt-icon nt-icon-emoji" aria-hidden="true">${_escapeHtml(icon)}</span>`
      : `<span class="nt-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>`;
    oldIcon.outerHTML = replacement;
  }

  // ─── Page icon (emoji) ──────────────────────────────────────────────
  // The icon slot lives inside the editor header, above the title. When an
  // icon is set, we show the emoji big (Notion-style ~56px). When unset,
  // the slot collapses to zero height — a subtle `+ Add icon` button only
  // reveals on header hover (CSS-driven) so the header stays compact.
  function _applyPageIconUI() {
    const slot = document.getElementById('nt-header-icon-slot');
    const emojiBtn = document.getElementById('nt-page-icon');
    const emojiEl = document.getElementById('nt-page-icon-emoji');
    const addBtn = document.getElementById('nt-page-icon-add');
    if (!slot || !emojiBtn || !emojiEl || !addBtn) return;

    // If no note loaded, hide everything.
    if (!selectedNoteId) {
      slot.classList.remove('has-icon', 'can-add');
      emojiBtn.style.display = 'none';
      addBtn.style.display = 'none';
      return;
    }

    if (selectedNoteIcon) {
      slot.classList.add('has-icon');
      slot.classList.remove('can-add');
      emojiBtn.style.display = 'inline-flex';
      emojiEl.textContent = selectedNoteIcon;
      addBtn.style.display = 'none';
    } else {
      slot.classList.remove('has-icon');
      // `.can-add` enables the hover-reveal for `+ Add icon` button.
      slot.classList.add('can-add');
      emojiBtn.style.display = 'none';
      addBtn.style.display = 'inline-flex';
    }
  }

  // ─── Emoji catalog (full Unicode CLDR set) ─────────────────────────
  // Data lives at `vendor/emoji-data.js` which assigns
  // `window.AllDashEmojiData` — an array of `{ name, emojis: [{c, n}] }`
  // groups (~1900 emojis, ~66KB). Loaded eagerly via the <script> tag in
  // index.html so it's available the instant the picker opens.
  //
  // We index the data once on first picker open into a flattened search
  // array so name-based search (e.g. "rocket" → 🚀) is O(n) over a small
  // pre-built list rather than rebuilding on every keystroke.
  let _emojiCatalogCache = null;
  let _emojiSearchIndex = null;
  function _getEmojiCatalog() {
    if (_emojiCatalogCache) return _emojiCatalogCache;
    const raw = window.AllDashEmojiData;
    if (!Array.isArray(raw) || raw.length === 0) {
      // Defensive fallback so the picker never throws if the data file
      // failed to load. Empty catalog → picker shows the search-input
      // fallback path (paste-an-emoji).
      _emojiCatalogCache = [];
      _emojiSearchIndex = [];
      return _emojiCatalogCache;
    }
    _emojiCatalogCache = raw;
    // Build a flat search index once: { c, n, group } per emoji. Used by
    // the search-as-you-type filter so we don't walk every group's array
    // on every keystroke.
    const flat = [];
    for (const g of raw) {
      for (const e of g.emojis) {
        flat.push({ c: e.c, n: e.n, group: g.name });
      }
    }
    _emojiSearchIndex = flat;
    return _emojiCatalogCache;
  }

  const _emojiRecentKey = 'alldash.emoji.recent';
  const _emojiRecentMax = 32;

  function _loadRecentEmojis() {
    try {
      const raw = localStorage.getItem(_emojiRecentKey);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function _saveRecentEmoji(emoji) {
    try {
      const recent = _loadRecentEmojis();
      const next = [emoji, ...recent.filter(e => e !== emoji)].slice(0, _emojiRecentMax);
      localStorage.setItem(_emojiRecentKey, JSON.stringify(next));
    } catch {}
  }

  // Shows an emoji picker popover anchored to an element. Calls onSelect
  // with the chosen emoji (or `null` to remove the current icon).
  function _showEmojiPicker(anchorEl, onSelect) {
    // Close any open picker first
    document.querySelectorAll('.nt-emoji-picker').forEach(n => n.remove());

    const picker = document.createElement('div');
    picker.className = 'nt-emoji-picker glass-card';
    picker.innerHTML = `
      <div class="nt-emoji-toolbar">
        <input class="nt-emoji-search" type="text" placeholder="Search or paste an emoji...">
        <button class="nt-emoji-random" title="Random emoji" aria-label="Random">🎲</button>
        <button class="nt-emoji-remove" title="Remove icon" aria-label="Remove">×</button>
      </div>
      <div class="nt-emoji-body"></div>
    `;
    document.body.appendChild(picker);

    // Position below+left of the anchor. Flip if it would overflow viewport.
    const rect = anchorEl.getBoundingClientRect();
    const pickerW = 360, pickerH = 360;
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + pickerW > window.innerWidth - 16) left = window.innerWidth - pickerW - 16;
    if (top + pickerH > window.innerHeight - 16) top = rect.top - pickerH - 8;
    picker.style.left = Math.max(16, left) + 'px';
    picker.style.top = Math.max(16, top) + 'px';

    const body = picker.querySelector('.nt-emoji-body');
    const search = picker.querySelector('.nt-emoji-search');

    // Build the emoji grid via DOM construction (NOT innerHTML interpolation).
    // Two render paths:
    //   • No filter → Recents (from localStorage) + every Unicode group, in
    //     order. ~1900 buttons total — modern Chromium handles this in
    //     <200ms; we use a DocumentFragment to batch the inserts.
    //   • Filter active → flat search over the indexed catalog by emoji
    //     NAME (e.g. "rocket" → 🚀, "heart" → ❤️). Results capped at
    //     MAX_SEARCH_RESULTS so a one-letter query doesn't dump every
    //     emoji that happens to contain that letter.
    const MAX_SEARCH_RESULTS = 240;
    const catalog = _getEmojiCatalog();

    const appendCell = (gridEl, emoji, titleText) => {
      const btn = document.createElement('button');
      btn.className = 'nt-emoji-cell';
      btn.dataset.emoji = emoji;
      btn.title = titleText || emoji;
      btn.textContent = emoji;
      gridEl.appendChild(btn);
    };

    const appendGroup = (frag, label, items, getMeta) => {
      if (items.length === 0) return;
      const labelEl = document.createElement('div');
      labelEl.className = 'nt-emoji-group-label';
      labelEl.textContent = label;
      frag.appendChild(labelEl);
      const grid = document.createElement('div');
      grid.className = 'nt-emoji-grid';
      for (const it of items) {
        const m = getMeta ? getMeta(it) : { c: it, n: it };
        appendCell(grid, m.c, m.n);
      }
      frag.appendChild(grid);
    };

    const renderGroups = (filter = '') => {
      const q = filter.trim().toLowerCase();
      // Wipe existing children — body is owned by us, this is safe.
      while (body.firstChild) body.removeChild(body.firstChild);

      // Build into a fragment so the browser doesn't reflow per-cell.
      const frag = document.createDocumentFragment();

      if (q) {
        // ── Search mode: flat scan of the indexed catalog by name ──
        const idx = _emojiSearchIndex || [];
        const matches = [];
        for (const e of idx) {
          if (e.n.toLowerCase().includes(q)) {
            matches.push(e);
            if (matches.length >= MAX_SEARCH_RESULTS) break;
          }
        }
        if (matches.length > 0) {
          const label = matches.length >= MAX_SEARCH_RESULTS
            ? `Results (showing first ${MAX_SEARCH_RESULTS})`
            : `Results (${matches.length})`;
          // Search index entries are {c, n, group} objects — supply the
          // meta extractor so appendGroup pulls the right fields. Without
          // this the default branch would wrap each object as `{c: obj, n: obj}`
          // and the button text would read "[object Object]".
          appendGroup(frag, label, matches, e => ({ c: e.c, n: e.n }));
        } else if (q.length <= 6 && !/[a-z0-9<>"'`&]/i.test(q)) {
          // Search didn't match any name but the input looks like an emoji
          // itself — let the user insert it directly.
          appendGroup(frag, 'Paste', [q]);
        } else {
          const empty = document.createElement('div');
          empty.className = 'nt-emoji-empty';
          empty.textContent = 'No emoji matches that. Try a different word, or paste one directly.';
          frag.appendChild(empty);
        }
      } else {
        // ── Default mode: Recent group + all categories ──
        const recents = _loadRecentEmojis();
        if (recents.length > 0) {
          appendGroup(frag, 'Recent', recents);
        }
        for (const g of catalog) {
          appendGroup(frag, g.name, g.emojis, e => ({ c: e.c, n: e.n }));
        }
        if (catalog.length === 0) {
          // Data file failed to load — graceful fallback.
          const warn = document.createElement('div');
          warn.className = 'nt-emoji-empty';
          warn.textContent = 'Emoji catalog unavailable. Paste an emoji into the search box.';
          frag.appendChild(warn);
        }
      }
      body.appendChild(frag);
    };
    renderGroups();

    // Click an emoji cell → select + close
    picker.addEventListener('click', (e) => {
      const cell = e.target.closest('.nt-emoji-cell');
      if (cell) {
        const emoji = cell.dataset.emoji;
        _saveRecentEmoji(emoji);
        onSelect(emoji);
        closePicker();
        return;
      }
      if (e.target.closest('.nt-emoji-remove')) {
        onSelect(null);
        closePicker();
        return;
      }
      if (e.target.closest('.nt-emoji-random')) {
        // Pick uniformly across the entire flat search index (~1900 items).
        // Equal weight across all categories — user is more likely to see
        // something fun / surprising than the old "pick a group then pick
        // an item" weighting which over-favored small groups.
        const idx = _emojiSearchIndex || [];
        if (idx.length === 0) { closePicker(); return; }
        const emoji = idx[Math.floor(Math.random() * idx.length)].c;
        _saveRecentEmoji(emoji);
        onSelect(emoji);
        closePicker();
        return;
      }
    });

    search.addEventListener('input', () => renderGroups(search.value));
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closePicker(); return; }
      if (e.key === 'Enter') {
        // Enter picks first visible emoji
        const first = body.querySelector('.nt-emoji-cell');
        if (first) first.click();
      }
    });
    setTimeout(() => search.focus(), 0);

    // Click outside to close
    const outside = (e) => {
      if (!picker.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) {
        closePicker();
      }
    };
    // Defer attaching so the initial click doesn't immediately trigger close
    setTimeout(() => document.addEventListener('mousedown', outside), 0);

    // Track in the overlay registry so destroy() can drain orphaned pickers.
    // Without this, opening the picker then navigating away would leak both
    // the document listener AND the closure (anchorEl, onSelect, etc).
    const unregister = _registerOverlay({ remove: closePicker });

    function closePicker() {
      document.removeEventListener('mousedown', outside);
      picker.remove();
      unregister();
    }
  }

  // Three-button cascade dialog. Resolves to 'cancel' | 'keep' | 'cascade'.
  // Simpler than bringing in a full dialog component — we build it inline and
  // destroy on choice. Styled via .nested-cascade-dialog in notes.css.
  function _confirmCascade(name, subPageCount) {
    return new Promise(resolve => {
      const backdrop = document.createElement('div');
      backdrop.className = 'nested-cascade-backdrop';
      // sanitized via _escapeHtml — name is used in text position only
      const safeCount = Number.isFinite(+subPageCount) ? +subPageCount : 0;
      const plural = safeCount === 1 ? '' : 's';
      backdrop.innerHTML = `
        <div class="nested-cascade-dialog glass-card" role="dialog" aria-modal="true">
          <h4>Delete "${_escapeHtml(name)}"?</h4>
          <p>This note has <strong>${safeCount} sub-page${plural}</strong>. You can keep the sub-pages as top-level notes, or delete everything.</p>
          <div class="nested-cascade-actions">
            <button class="nested-btn nested-btn-cancel" data-choice="cancel">Cancel</button>
            <button class="nested-btn nested-btn-keep" data-choice="keep">Keep sub-pages</button>
            <button class="nested-btn nested-btn-cascade" data-choice="cascade">Delete all</button>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);

      const close = (choice) => {
        backdrop.remove();
        document.removeEventListener('keydown', onKey);
        unregister();
        resolve(choice);
      };
      const onKey = (e) => { if (e.key === 'Escape') close('cancel'); };
      document.addEventListener('keydown', onKey);

      // Track so destroy() can drain orphaned dialogs (otherwise the keydown
      // listener + Promise resolve + closure leak permanently).
      const unregister = _registerOverlay({ remove: () => close('cancel') });

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) { close('cancel'); return; }
        const btn = e.target.closest('[data-choice]');
        if (btn) close(btn.dataset.choice);
      });

      // Default focus on the "Delete all" button — matches Notion's behavior
      // where cascading is the expected action (it's what users almost always mean).
      setTimeout(() => backdrop.querySelector('[data-choice="cascade"]')?.focus(), 0);
    });
  }

  function updateBreadcrumb() {
    const bc = document.getElementById('notes-breadcrumb');
    if (!bc) return;

    if (noteBreadcrumb.length <= 1) {
      bc.innerHTML = '';
      bc.style.display = 'none';
      return;
    }

    bc.style.display = 'flex';
    bc.innerHTML = noteBreadcrumb.map((item, i) => {
      const isLast = i === noteBreadcrumb.length - 1;
      const sep = i > 0 ? '<span style="color:var(--text-muted);font-size:10px;margin:0 4px;">\u203A</span>' : '';
      return `${sep}<span class="notes-bc-item ${isLast ? 'current' : ''}" data-bc-idx="${i}">${_escapeHtml(item.name)}</span>`;
    }).join('');

    bc.querySelectorAll('.notes-bc-item:not(.current)').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.bcIdx);
        noteBreadcrumb = noteBreadcrumb.slice(0, idx + 1);
        currentFolderId = noteBreadcrumb[idx].id;
        loadNotesList();
      });
    });
  }

  async function loadNote(noteId) {
    if (!window.electronAPI) return;
    if (!_isValidDriveId(noteId)) {
      console.warn('loadNote rejected invalid id:', noteId);
      return;
    }
    // Capture a load token at entry. If a newer loadNote() call increments
    // _loadSeq while we're awaiting, every subsequent stage of THIS call
    // bails. Without this, rapid clicks (A → B before A's notes.get
    // resolves) can paint A's content into B because the slow response
    // wins the race to setContent.
    const tok = ++_loadSeq;
    try {
      const note = await window.electronAPI.notes.get(noteId);
      if (tok !== _loadSeq || !_isMounted) return;
      selectedNoteId = noteId;
      selectedNoteFormat = note.format || 'tiptap';
      selectedNoteIcon = note.icon || null;

      // Refresh the meta cache with the authoritative envelope data — the
      // sidebar's cache might have stale title/parentId/icon if the user just edited.
      _noteMetaCache.set(noteId, {
        id: noteId,
        title: note.title,
        parentId: note.parentId || null,
        icon: note.icon || null,
      });

      _applyPageIconUI();
      // Legacy notes that had an emoji set BEFORE we added the Drive
      // appProperties mirror won't show their icon in the sidebar via
      // listNotes (because appProperties was empty). When loadNote fetches
      // the real envelope and finds an icon, sync the sidebar row directly
      // so the emoji appears immediately — subsequent saves will backfill
      // appProperties and fix future cold-start renders.
      _updateSidebarRowIcon(noteId, note.icon || null);

      const titleInput = document.getElementById('note-title');
      if (titleInput) { titleInput.value = note.title || ''; titleInput.style.cursor = 'text'; }

      const deleteBtn = document.getElementById('delete-note-btn');
      if (deleteBtn) deleteBtn.style.display = 'flex';

      const emptyEl = document.getElementById('notes-empty');
      if (emptyEl) emptyEl.remove();

      // Render the parent breadcrumb (walks up the parentId chain). Also
      // expands each ancestor in the sidebar so the nested position is visible.
      await _renderParentBreadcrumb(note.parentId);
      if (tok !== _loadSeq || !_isMounted) return;
      _ensureAncestorsExpanded(note.parentId);

      if (!editor) initTipTap();
      if (!editor) return;

      // Decide the content to set in the editor, by format:
      //   tiptap + doc     → set JSON doc directly (full fidelity)
      //   tiptap + md-only → parse markdown → JSON (AI just wrote it, no doc yet)
      //   legacy-html      → parse HTML → JSON (Google Doc import)
      //   empty            → empty paragraph placeholder
      const AD = window.AllDashEditor;
      let contentForEditor;
      if (note.format === 'tiptap' && note.doc) {
        contentForEditor = note.doc;
      } else if (note.format === 'tiptap' && typeof note.markdown === 'string' && note.markdown.length) {
        contentForEditor = AD.markdownToJSON(note.markdown);
      } else if (note.format === 'legacy-html' && note.html) {
        contentForEditor = AD.htmlToJSON(note.html);
      } else {
        contentForEditor = AD.emptyDoc();
      }
      // Final stale-load check before we mutate the editor — without this,
      // a slow Drive response could overwrite the editor with stale content
      // even though selectedNoteId has already moved on.
      if (tok !== _loadSeq || !_isMounted) return;

      suppressSave = true;
      try {
        editor.commands.setContent(contentForEditor, false);
      } finally {
        // Release the guard on the next microtask so any echo updates settle first.
        setTimeout(() => { suppressSave = false; }, 0);
      }
      editor.setEditable(true);

      updateSaveStatus('Saved');
      // Active row uses the new flat-DOM `.nt-row` selector. Keep
      // `.note-list-item` for backward compat with any stray legacy markup,
      // but prefer .nt-row going forward.
      document.querySelectorAll('.nt-row, .note-list-item').forEach(el => el.classList.remove('active'));
      document.querySelector(`.nt-row[data-note-id="${noteId}"], .note-list-item[data-note-id="${noteId}"]`)?.classList.add('active');

      if (note.format === 'legacy-html') {
        Toast.show('Legacy note — will upgrade on first save', 'info', 2200);
      }

      // After the editor renders, sanity-check all pageLinks in the new doc:
      // if a link points at a deleted note, add a `.broken` class so CSS can
      // render it in the warning state (and our click handler shows a toast
      // instead of navigating).
      _validatePageLinks();
    } catch (err) {
      console.error(err);
      Toast.show('Failed to load note', 'error');
    }
  }

  // Scans the currently-rendered editor DOM for .tt-page-link cards and
  // marks any whose noteId doesn't resolve (note was deleted from Drive).
  // Runs in the background — failing to reach Drive just leaves them neutral.
  async function _validatePageLinks() {
    const root = document.getElementById('tiptap-editor');
    if (!root) return;
    const links = Array.from(root.querySelectorAll('.tt-page-link'));
    if (links.length === 0) return;

    // Resolve every linked note in parallel (Promise.all) — the previous
    // implementation awaited each notes.get sequentially, so a doc with 50
    // pageLinks did 50 sequential round-trips during loadNote, blocking
    // the editor from becoming responsive.
    const resolutions = await Promise.all(links.map(async (link) => {
      const id = link.getAttribute('data-note-id');
      if (!id || !_isValidDriveId(id)) return { link, meta: null, broken: !id };
      let meta = _noteMetaCache.get(id);
      if (meta && meta.icon !== undefined) return { link, meta, broken: false };
      try {
        const note = await window.electronAPI.notes.get(id);
        meta = { id: note.id, title: note.title, parentId: note.parentId || null, icon: note.icon || null };
        _noteMetaCache.set(id, meta);
        return { link, meta, broken: false };
      } catch {
        return { link, meta: null, broken: true };
      }
    }));

    // Apply DOM updates synchronously after all resolutions land. ProseMirror
    // owns the editor DOM, so direct mutation is risky — but pageLink is an
    // atom node and we only touch the icon child + a class on the link. The
    // alternative (re-rendering via decorations) requires changes in the
    // bundle so we accept the trade-off for now.
    for (const { link, meta, broken } of resolutions) {
      if (broken) {
        link.classList.add('broken');
        const titleEl = link.querySelector('.tt-page-link-title');
        if (titleEl && !titleEl.textContent.includes('(deleted)')) {
          titleEl.textContent = (titleEl.textContent || 'Untitled') + ' (deleted)';
        }
        continue;
      }
      link.classList.remove('broken');

      const iconWrapper = link.querySelector('.tt-page-link-icon');
      if (!iconWrapper || !meta) continue;
      const existingEmoji = iconWrapper.querySelector('.tt-page-link-emoji');
      if (meta.icon) {
        if (existingEmoji) {
          existingEmoji.textContent = meta.icon;
        } else {
          const em = document.createElement('span');
          em.className = 'tt-page-link-emoji';
          em.textContent = meta.icon;
          iconWrapper.appendChild(em);
        }
        iconWrapper.classList.add('has-emoji');
      } else if (existingEmoji) {
        existingEmoji.remove();
        iconWrapper.classList.remove('has-emoji');
      }
    }
  }

  function initTipTap() {
    const AD = window.AllDashEditor;
    if (!AD) {
      console.error('AllDashEditor bundle not loaded');
      return;
    }

    const container = document.getElementById('notes-editor-container');
    if (!container) return;

    // Remove empty state if still there
    const emptyEl = document.getElementById('notes-empty');
    if (emptyEl) emptyEl.remove();

    // Toolbar lives ABOVE the editor root but inside the same container.
    // Built before the editor so it mounts atomically; click handlers attached
    // after the Editor is constructed so they can call editor.chain(). .
    let toolbar = document.getElementById('tt-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'tt-toolbar';
      toolbar.className = 'tt-toolbar';
      toolbar.innerHTML = _toolbarHTML();
      container.appendChild(toolbar);
    }

    // Ensure a clean mount point
    let root = document.getElementById('tiptap-editor');
    if (!root) {
      root = document.createElement('div');
      root.id = 'tiptap-editor';
      root.className = 'tiptap-editor';
      container.appendChild(root);
    }

    const SlashCommand = _buildSlashCommandExtension(AD);

    editor = new AD.Editor({
      element: root,
      extensions: [
        ...AD.defaultExtensions({ withPlaceholder: true, placeholder: 'Type / for commands or start writing...' }),
        SlashCommand,
      ],
      autofocus: false,
      editorProps: {
        attributes: { class: 'ProseMirror tt-surface' },
      },
      onUpdate: () => {
        if (suppressSave) return;
        scheduleSave();
      },
      onSelectionUpdate: () => _syncToolbarActiveState(),
      // `onTransaction` used to call _syncToolbarActiveState() too, but
      // that fires on EVERY keystroke — running ~15 editor.isActive()
      // checks + two history traversals + a querySelectorAll per char
      // was the single biggest typing-path cost. Selection-update alone
      // is enough: toolbar state (bold/italic/heading/etc.) only changes
      // when the cursor moves across a boundary, which fires
      // onSelectionUpdate anyway.
    });

    // Delegated click handler on the editor root. Handles two interactive
    // surfaces inside the editor that ProseMirror can't model with normal
    // marks/nodes:
    //   • `.tt-callout-icon`    → emoji picker for the callout's icon
    //   • `.tt-page-link-icon`  → emoji picker for the LINKED note's icon
    //   • elsewhere on `.tt-page-link` → navigate to the sub-page
    // We use `mousedown` so the editor's own focus-stealing handler doesn't
    // fire first and steal the click target.
    root.addEventListener('mousedown', (e) => {
      // ── Callout icon: open picker, update node attrs via transaction ──
      const calloutIconEl = e.target.closest?.('.tt-callout-icon');
      if (calloutIconEl) {
        e.preventDefault();
        e.stopPropagation();
        const calloutEl = calloutIconEl.closest('.tt-callout');
        if (!calloutEl || !editor) return;
        _showEmojiPicker(calloutIconEl, (emoji) => {
          try {
            const view = editor.view;
            // Resolve the DOM element back to a ProseMirror position so we
            // can target the exact callout node for the attr update.
            // posAtDOM returns a position INSIDE the node; we walk up the
            // resolved-position depth to find the callout itself.
            const pos = view.posAtDOM(calloutEl, 0);
            if (pos == null || pos < 0) return;
            const $pos = view.state.doc.resolve(pos);
            for (let depth = $pos.depth; depth >= 0; depth--) {
              const node = $pos.node(depth);
              if (node && node.type && node.type.name === 'callout') {
                const calloutPos = depth === 0 ? 0 : $pos.before(depth);
                const newAttrs = { ...node.attrs, icon: emoji || null };
                view.dispatch(view.state.tr.setNodeMarkup(calloutPos, undefined, newAttrs));
                break;
              }
            }
          } catch (err) {
            console.warn('Failed to update callout icon:', err);
            Toast.show('Couldn\u2019t update the icon', 'error');
          }
        });
        return;
      }

      const linkEl = e.target.closest?.('.tt-page-link');
      if (!linkEl) return;
      const id = linkEl.getAttribute('data-note-id');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      // Broken link → show toast and do nothing. The .broken class is applied
      // by _validatePageLinks() when the target note has been deleted.
      if (linkEl.classList.contains('broken')) {
        Toast.show('This sub-page was deleted', 'warning', 2200);
        return;
      }
      // Icon-area click → open the emoji picker for the linked note.
      const iconEl = e.target.closest?.('.tt-page-link-icon');
      if (iconEl) {
        _showEmojiPicker(iconEl, async (emoji) => {
          try {
            await _updateNoteIcon(id, emoji);
          } catch (err) {
            console.error(err);
            Toast.show('Failed to update icon', 'error');
          }
        });
        return;
      }
      // Regular card click → save current note, then navigate to the sub-page.
      clearTimeout(saveTimeout);
      Promise.resolve(selectedNoteId ? saveNote() : null).finally(() => {
        loadNote(id);
      });
    });

    _wireToolbar();
    _syncToolbarActiveState();
  }

  // ─── Top formatting toolbar ───────────────────────────────────
  // Mirrors the old Quill toolbar: block-type selector, inline marks,
  // lists, structural blocks, link/clear, undo/redo. Each button has a
  // `data-action` that maps to an editor chain method in `_toolbarActions`.
  function _toolbarHTML() {
    const iconBold   = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 0 8H6z"/><path d="M6 12h9a4 4 0 0 1 0 8H6z"/></svg>`;
    const iconItalic = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>`;
    const iconUnderline = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v8a6 6 0 0 0 12 0V4"/><line x1="4" y1="20" x2="20" y2="20"/></svg>`;
    const iconStrike = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></svg>`;
    const iconInlineCode = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
    const iconHighlight = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l-4 4v3h3l4-4"/><path d="M17.5 3.5l3 3L9 18l-3-3z"/></svg>`;
    const iconBullet = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1.2" fill="currentColor" stroke="none"/><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/></svg>`;
    const iconOrdered = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><text x="3" y="8" font-size="6" fill="currentColor" stroke="none">1</text><text x="3" y="14" font-size="6" fill="currentColor" stroke="none">2</text><text x="3" y="20" font-size="6" fill="currentColor" stroke="none">3</text></svg>`;
    const iconTask = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="6" height="6" rx="1"/><polyline points="4 7 5.5 8.5 8 6"/><line x1="12" y1="7" x2="20" y2="7"/><rect x="3" y="14" width="6" height="6" rx="1"/><line x1="12" y1="17" x2="20" y2="17"/></svg>`;
    const iconQuote = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3-2 4-5 4-9V5h5v7H7"/><path d="M14 21c3-2 4-5 4-9V5h5v7h-5"/></svg>`;
    const iconCodeBlock = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="10 10 8 12 10 14"/><polyline points="14 10 16 12 14 14"/></svg>`;
    const iconHR = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"/></svg>`;
    const iconLink = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
    const iconClear = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M16 4h4v4"/><path d="M8 4H4v4"/><path d="M4 14v6h6"/><path d="M20 14v6h-4"/></svg>`;
    const iconUndo = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`;
    const iconRedo = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/></svg>`;

    // Block-type selector — a compact text segmented control.
    const blockSegs = `
      <div class="tt-seg-group" role="group" aria-label="Block type">
        <button type="button" class="tt-seg" data-action="paragraph" title="Paragraph (Ctrl+Alt+0)"><span>P</span></button>
        <button type="button" class="tt-seg" data-action="h1" title="Heading 1 (Ctrl+Alt+1)"><span>H1</span></button>
        <button type="button" class="tt-seg" data-action="h2" title="Heading 2 (Ctrl+Alt+2)"><span>H2</span></button>
        <button type="button" class="tt-seg" data-action="h3" title="Heading 3 (Ctrl+Alt+3)"><span>H3</span></button>
      </div>`;

    return `
      ${blockSegs}
      <span class="tt-divider"></span>
      <button type="button" class="tt-btn" data-action="bold" title="Bold (Ctrl+B)" aria-label="Bold">${iconBold}</button>
      <button type="button" class="tt-btn" data-action="italic" title="Italic (Ctrl+I)" aria-label="Italic">${iconItalic}</button>
      <button type="button" class="tt-btn" data-action="underline" title="Underline (Ctrl+U)" aria-label="Underline">${iconUnderline}</button>
      <button type="button" class="tt-btn" data-action="strike" title="Strikethrough" aria-label="Strikethrough">${iconStrike}</button>
      <button type="button" class="tt-btn" data-action="inlineCode" title="Inline code" aria-label="Inline code">${iconInlineCode}</button>
      <button type="button" class="tt-btn" data-action="highlight" title="Highlight" aria-label="Highlight">${iconHighlight}</button>
      <span class="tt-divider"></span>
      <button type="button" class="tt-btn" data-action="bulletList" title="Bullet list" aria-label="Bullet list">${iconBullet}</button>
      <button type="button" class="tt-btn" data-action="orderedList" title="Numbered list" aria-label="Numbered list">${iconOrdered}</button>
      <button type="button" class="tt-btn" data-action="taskList" title="Task list" aria-label="Task list">${iconTask}</button>
      <span class="tt-divider"></span>
      <button type="button" class="tt-btn" data-action="blockquote" title="Quote" aria-label="Quote">${iconQuote}</button>
      <button type="button" class="tt-btn" data-action="codeBlock" title="Code block" aria-label="Code block">${iconCodeBlock}</button>
      <button type="button" class="tt-btn" data-action="horizontalRule" title="Divider" aria-label="Divider">${iconHR}</button>
      <span class="tt-divider"></span>
      <button type="button" class="tt-btn" data-action="link" title="Insert link (Ctrl+K)" aria-label="Insert link">${iconLink}</button>
      <button type="button" class="tt-btn" data-action="clearFormat" title="Clear formatting" aria-label="Clear formatting">${iconClear}</button>
      <span class="tt-divider"></span>
      <button type="button" class="tt-btn" data-action="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${iconUndo}</button>
      <button type="button" class="tt-btn" data-action="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${iconRedo}</button>
    `;
  }

  // Each action is a fn (editor) => void that invokes a chain and runs it.
  // Keep this as the single source of truth — if you add a button above, add
  // its action here, and the syncing function below picks it up automatically.
  const _toolbarActions = {
    paragraph:     (ed) => ed.chain().focus().setParagraph().run(),
    h1:            (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(),
    h2:            (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
    h3:            (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run(),
    bold:          (ed) => ed.chain().focus().toggleBold().run(),
    italic:        (ed) => ed.chain().focus().toggleItalic().run(),
    underline:     (ed) => ed.chain().focus().toggleUnderline().run(),
    strike:        (ed) => ed.chain().focus().toggleStrike().run(),
    inlineCode:    (ed) => ed.chain().focus().toggleCode().run(),
    highlight:     (ed) => ed.chain().focus().toggleHighlight().run(),
    bulletList:    (ed) => ed.chain().focus().toggleBulletList().run(),
    orderedList:   (ed) => ed.chain().focus().toggleOrderedList().run(),
    taskList:      (ed) => ed.chain().focus().toggleTaskList().run(),
    blockquote:    (ed) => ed.chain().focus().toggleBlockquote().run(),
    codeBlock:     (ed) => ed.chain().focus().toggleCodeBlock().run(),
    horizontalRule:(ed) => ed.chain().focus().setHorizontalRule().run(),
    link: async (ed) => {
      const prev = ed.getAttributes('link')?.href || '';
      const next = await Confirm.prompt('URL', prev ? 'Update link' : 'Insert link', 'https://…');
      if (next === null) return;
      if (next === '') { ed.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
      const href = /^https?:\/\//i.test(next) ? next : 'https://' + next;
      ed.chain().focus().extendMarkRange('link').setLink({ href }).run();
    },
    clearFormat:   (ed) => ed.chain().focus().unsetAllMarks().clearNodes().run(),
    undo:          (ed) => ed.chain().focus().undo().run(),
    redo:          (ed) => ed.chain().focus().redo().run(),
  };

  function _wireToolbar() {
    const tb = document.getElementById('tt-toolbar');
    if (!tb || !editor) return;
    tb.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep editor focus
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const fn = _toolbarActions[action];
        if (fn) fn(editor);
      });
    });
  }

  // Reflects cursor context in the toolbar: bold button gets .active when
  // the cursor is inside bold text, H2 seg is highlighted when the block is
  // a level-2 heading, etc. Called on every selection change + transaction.
  function _syncToolbarActiveState() {
    if (!editor) return;
    const tb = document.getElementById('tt-toolbar');
    if (!tb) return;

    const isHeading = (level) => editor.isActive('heading', { level });
    const map = {
      paragraph:   editor.isActive('paragraph') && !isHeading(1) && !isHeading(2) && !isHeading(3),
      h1:          isHeading(1),
      h2:          isHeading(2),
      h3:          isHeading(3),
      bold:        editor.isActive('bold'),
      italic:      editor.isActive('italic'),
      underline:   editor.isActive('underline'),
      strike:      editor.isActive('strike'),
      inlineCode:  editor.isActive('code'),
      highlight:   editor.isActive('highlight'),
      bulletList:  editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      taskList:    editor.isActive('taskList'),
      blockquote:  editor.isActive('blockquote'),
      codeBlock:   editor.isActive('codeBlock'),
      link:        editor.isActive('link'),
    };
    tb.querySelectorAll('[data-action]').forEach(btn => {
      const active = !!map[btn.dataset.action];
      btn.classList.toggle('active', active);
    });

    // Undo/redo disabled state — avoids wasted taps when the history stack is empty.
    const can = editor.can();
    const undoBtn = tb.querySelector('[data-action="undo"]');
    const redoBtn = tb.querySelector('[data-action="redo"]');
    if (undoBtn) undoBtn.toggleAttribute('disabled', !can.undo());
    if (redoBtn) redoBtn.toggleAttribute('disabled', !can.redo());
  }

  // ─── Slash command menu ──────────────────────────────────────────
  function _slashItems() {
    return [
      { title: 'Heading 1',    hint: 'Large section title',  icon: _icon('h1'),    action: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 1 }).run() },
      { title: 'Heading 2',    hint: 'Medium section title', icon: _icon('h2'),    action: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run() },
      { title: 'Heading 3',    hint: 'Small section title',  icon: _icon('h3'),    action: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 3 }).run() },
      { title: 'Bullet list',  hint: 'Simple bulleted list', icon: _icon('ul'),    action: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
      { title: 'Numbered list',hint: 'Ordered list',         icon: _icon('ol'),    action: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
      { title: 'Task list',    hint: 'Checkboxes',           icon: _icon('task'),  action: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
      { title: 'Quote',        hint: 'Blockquote',           icon: _icon('quote'), action: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
      { title: 'Code block',   hint: 'Fenced code',          icon: _icon('code'),  action: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
      { title: 'Divider',      hint: 'Horizontal rule',      icon: _icon('hr'),    action: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
      { title: 'Callout',      hint: 'Highlighted info box', icon: _icon('info'),  action: (e, r) => e.chain().focus().deleteRange(r)
          .insertContent({ type: 'callout', attrs: { variant: 'info' }, content: [{ type: 'paragraph', content: [] }] }).run() },
      { title: 'Page',         hint: 'Embed a sub-page',     icon: _icon('page'),  action: async (e, r) => {
          // Remove the `/page` text first so we don't leave a partial command.
          e.chain().focus().deleteRange(r).run();
          const title = await Confirm.prompt('Give your new page a title:', 'New sub-page', 'Untitled page');
          if (title === null) return;  // user cancelled
          const finalTitle = (title || '').trim() || 'Untitled page';
          try {
            // Create the child note bidirectionally linked to the current note:
            //   - parentFolderId   → same Drive folder as the parent (colocated)
            //   - parentNoteId     → current note's ID (establishes nesting hierarchy)
            const created = await window.electronAPI.notes.create(
              finalTitle, '', currentFolderId, selectedNoteId
            );
            // Insert a PageLink node pointing at the new sub-page. The atom is
            // followed by an empty paragraph so the user can keep typing.
            e.chain().focus().insertContent([
              { type: 'pageLink', attrs: { noteId: created.id, title: finalTitle } },
              { type: 'paragraph' },
            ]).run();
            Toast.show(`Created sub-page: ${finalTitle}`, 'success', 2200);
          } catch (err) {
            console.error(err);
            Toast.show('Failed to create sub-page', 'error');
          }
        } },
    ];
  }

  function _icon(kind) {
    const map = {
      h1:    '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M4 6v12M12 6v12M4 12h8"/><text x="15" y="18" font-size="10" fill="currentColor" stroke="none">1</text></svg>',
      h2:    '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M4 6v12M12 6v12M4 12h8"/><text x="15" y="18" font-size="10" fill="currentColor" stroke="none">2</text></svg>',
      h3:    '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M4 6v12M12 6v12M4 12h8"/><text x="15" y="18" font-size="10" fill="currentColor" stroke="none">3</text></svg>',
      ul:    '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="5" cy="6" r="1.2" fill="currentColor"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="5" cy="18" r="1.2" fill="currentColor"/><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/></svg>',
      ol:    '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><text x="3" y="9" font-size="7" fill="currentColor" stroke="none">1.</text><text x="3" y="15" font-size="7" fill="currentColor" stroke="none">2.</text><text x="3" y="21" font-size="7" fill="currentColor" stroke="none">3.</text><line x1="10" y1="7" x2="20" y2="7"/><line x1="10" y1="13" x2="20" y2="13"/><line x1="10" y1="19" x2="20" y2="19"/></svg>',
      task:  '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="4" width="6" height="6" rx="1"/><polyline points="4 7 5.5 8.5 8 6"/><line x1="12" y1="7" x2="20" y2="7"/><rect x="3" y="14" width="6" height="6" rx="1"/><line x1="12" y1="17" x2="20" y2="17"/></svg>',
      quote: '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M7 7h4v4H7zM7 11c0 3 -2 5 -3 5"/><path d="M15 7h4v4h-4zM15 11c0 3 -2 5 -3 5"/></svg>',
      code:  '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
      hr:    '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><line x1="4" y1="12" x2="20" y2="12"/></svg>',
      info:  '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.7" fill="currentColor"/></svg>',
      page:  '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    };
    return map[kind] || '';
  }

  function _buildSlashCommandExtension(AD) {
    return AD.Extension.create({
      name: 'slashCommand',
      addOptions() {
        return {
          suggestion: {
            char: '/',
            startOfLine: false,
            command: ({ editor: ed, range, props }) => {
              props.action(ed, range);
            },
          },
        };
      },
      addProseMirrorPlugins() {
        return [
          AD.Suggestion({
            editor: this.editor,
            ...this.options.suggestion,
            items: ({ query }) => {
              const q = (query || '').toLowerCase();
              return _slashItems().filter(it =>
                it.title.toLowerCase().includes(q) ||
                (it.hint || '').toLowerCase().includes(q)
              );
            },
            render: () => {
              let el, items, hovered = 0, tip, props;

              const rerender = () => {
                if (!el) return;
                el.innerHTML = items.map((it, i) => `
                  <div class="tt-slash-item${i === hovered ? ' active' : ''}" data-idx="${i}">
                    <div class="tt-slash-icon">${it.icon}</div>
                    <div class="tt-slash-text">
                      <div class="tt-slash-title">${it.title}</div>
                      <div class="tt-slash-hint">${it.hint || ''}</div>
                    </div>
                  </div>
                `).join('') || `<div class="tt-slash-empty">No results</div>`;

                el.querySelectorAll('.tt-slash-item').forEach(node => {
                  node.addEventListener('mouseenter', () => {
                    hovered = parseInt(node.dataset.idx);
                    rerender();
                  });
                  node.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    const idx = parseInt(node.dataset.idx);
                    const chosen = items[idx];
                    if (chosen) props.command({ action: chosen.action });
                  });
                });
              };

              return {
                onStart: (p) => {
                  props = p;
                  items = p.items;
                  hovered = 0;
                  el = document.createElement('div');
                  el.className = 'tt-slash-menu';
                  rerender();
                  tip = AD.tippy('body', {
                    getReferenceClientRect: p.clientRect,
                    appendTo: () => document.body,
                    content: el,
                    showOnCreate: true,
                    interactive: true,
                    trigger: 'manual',
                    placement: 'bottom-start',
                    arrow: false,
                    offset: [0, 6],
                    theme: 'alldash',
                  });
                },
                onUpdate: (p) => {
                  props = p;
                  items = p.items;
                  if (hovered >= items.length) hovered = Math.max(0, items.length - 1);
                  rerender();
                  if (tip && tip[0]) tip[0].setProps({ getReferenceClientRect: p.clientRect });
                },
                onKeyDown: (p) => {
                  if (p.event.key === 'Escape') { tip?.[0]?.hide(); return true; }
                  if (p.event.key === 'ArrowDown') { hovered = (hovered + 1) % items.length; rerender(); return true; }
                  if (p.event.key === 'ArrowUp') { hovered = (hovered - 1 + items.length) % items.length; rerender(); return true; }
                  if (p.event.key === 'Enter' || p.event.key === 'Tab') {
                    const chosen = items[hovered];
                    if (chosen) { props.command({ action: chosen.action }); return true; }
                  }
                  return false;
                },
                onExit: () => {
                  try { tip?.[0]?.destroy(); } catch {}
                  el = null;
                  tip = null;
                  items = null;
                },
              };
            },
          }),
        ];
      },
    });
  }

  // ─── Create / update / delete ───────────────────────────────────
  async function createNote() {
    if (!window.electronAPI) return;
    try {
      const status = await window.electronAPI.google.getStatus();
      if (!status.authenticated) { Toast.show('Connect Google account first', 'warning'); return; }

      // Empty envelope — renderer handles structure.
      const note = await window.electronAPI.notes.create('Untitled Note', '', currentFolderId);
      Toast.show('Note created', 'success');

      await loadNotesList();
      await loadNote(note.id);

      const titleInput = document.getElementById('note-title');
      if (titleInput) { titleInput.select(); titleInput.focus(); }
    } catch (err) {
      console.error(err);
      Toast.show('Failed to create note', 'error');
    }
  }

  async function createFolder() {
    if (!window.electronAPI) return;
    const name = await Confirm.prompt('Enter a name for the folder:', 'New Folder', 'Folder name...');
    if (!name) return;
    try {
      await window.electronAPI.notes.createFolder(name, currentFolderId);
      Toast.show(`Folder "${name}" created`, 'success');
      await loadNotesList();
    } catch (err) {
      Toast.show('Failed to create folder', 'error');
    }
  }

  async function deleteNote() {
    if (!selectedNoteId || !window.electronAPI) return;
    try {
      await window.electronAPI.notes.delete(selectedNoteId);
      Toast.show('Note deleted', 'info');
      _clearEditor();
      await loadNotesList();
    } catch (err) {
      Toast.show('Failed to delete note', 'error');
    }
  }

  function scheduleSave() {
    if (!selectedNoteId || !window.electronAPI) return;
    updateSaveStatus('Saving...');
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveNote, 1000);
  }

  async function saveNote() {
    if (!selectedNoteId || !window.electronAPI || !editor) return;
    try {
      const title = document.getElementById('note-title')?.value || 'Untitled Note';
      const doc = editor.getJSON();
      const markdown = window.AllDashEditor.jsonToMarkdown(doc);

      // Renderer always sends a full envelope (doc + markdown + icon). The
      // drive service accepts either a string (AI path) or an object (this path).
      const result = await window.electronAPI.notes.update(selectedNoteId, title, {
        doc,
        markdown,
        icon: selectedNoteIcon,
      });

      // Legacy notes get upgraded → new id. Swap selectedNoteId and refresh list.
      if (result && result.id && result.id !== selectedNoteId) {
        selectedNoteId = result.id;
        selectedNoteFormat = 'tiptap';
        await loadNotesList();
        document.querySelectorAll('.nt-row, .note-list-item').forEach(el => el.classList.remove('active'));
        document.querySelector(`.nt-row[data-note-id="${selectedNoteId}"], .note-list-item[data-note-id="${selectedNoteId}"]`)?.classList.add('active');
        // If Drive failed to trash the legacy original, surface it so the
        // user knows they need to clean up (don't silently leak duplicates).
        if (result.trashFailed) {
          Toast.show('Note saved, but Drive couldn\u2019t archive the legacy original. Check your Drive trash.', 'warning', 4000);
        }
      } else {
        // Update title in sidebar visually without re-fetching the whole list
        const activeItem = document.querySelector(`.nt-row[data-note-id="${selectedNoteId}"] .nt-title, .note-list-item[data-note-id="${selectedNoteId}"] .note-title`);
        if (activeItem) activeItem.textContent = title;
      }

      updateSaveStatus('Saved');
    } catch (err) {
      console.error(err);
      updateSaveStatus('Error');
    }
  }

  function updateSaveStatus(text) {
    const statusEl = document.getElementById('save-status');
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.style.display = 'inline-block';
      statusEl.classList.toggle('saving', text.includes('Saving'));
    }
  }

  function _clearEditor() {
    selectedNoteId = null;
    selectedNoteFormat = null;
    selectedNoteIcon = null;
    const titleInput = document.getElementById('note-title');
    if (titleInput) { titleInput.value = ''; titleInput.placeholder = 'Click here to start a new note...'; titleInput.style.cursor = 'pointer'; }
    const deleteBtn = document.getElementById('delete-note-btn');
    if (deleteBtn) deleteBtn.style.display = 'none';
    const statusEl = document.getElementById('save-status');
    if (statusEl) statusEl.style.display = 'none';
    _applyPageIconUI();
    // Hide the nested-pages footer when no note is loaded — otherwise the
    // footer would hang around showing stale breadcrumbs.
    const footer = document.getElementById('nt-footer');
    if (footer) footer.style.display = 'none';
    if (editor) {
      suppressSave = true;
      try {
        editor.commands.clearContent();
        editor.setEditable(false);
      } finally {
        setTimeout(() => { suppressSave = false; }, 0);
      }
    }
  }

  // Escape text for use as innerHTML content (text positions, NOT attributes).
  // Uses textContent → innerHTML which encodes <, >, & — safe for between-tag
  // content but NOT safe for attribute values (doesn't escape " or ').
  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  // Escape text for use inside an HTML attribute value. Critical for any
  // template literal of the form `data-foo="${user_input}"`. textContent
  // → innerHTML doesn't handle `"` or `'` so it's not enough by itself.
  // Drive folder/note titles can contain `"` so without this, a folder
  // titled `bar" onclick="alert(1)` breaks out and runs arbitrary JS.
  function _escapeAttr(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Validate a Drive note/file id before passing it through to electronAPI.
  // Defense-in-depth: if any of the renderer's data-* injection paths ever
  // get exploited, this stops the bad id from reaching IPC. Drive IDs are
  // URL-safe alphanumeric+underscore+hyphen; reject anything else.
  function _isValidDriveId(id) {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{10,}$/.test(id);
  }

  // ─── Lifecycle + overlay tracking ──────────────────────────────────
  // `_isMounted` gates async callbacks (notes:changed broadcast, deferred
  // pickers) from firing after destroy(). Without this, an in-flight Drive
  // round-trip whose response lands after the user navigated away would
  // mutate detached DOM and try to call destroyed editor methods.
  let _isMounted = false;
  // `_loadSeq` discriminates between concurrent loadNote() calls — see
  // loadNote() for usage. Increments on every entry.
  let _loadSeq = 0;
  // Open overlay registry so destroy() can drain orphaned popups (emoji
  // picker, cascade dialog, ellipsis menu). Each entry is { remove(): void }
  // — we call remove() on every entry on teardown.
  const _openOverlays = new Set();
  function _registerOverlay(handle) {
    _openOverlays.add(handle);
    return () => _openOverlays.delete(handle);
  }
  function _drainOverlays() {
    for (const h of Array.from(_openOverlays)) {
      try { h.remove(); } catch {}
      _openOverlays.delete(h);
    }
  }

  function destroy() {
    _isMounted = false;
    clearTimeout(saveTimeout);
    if (editor) {
      try { editor.destroy(); } catch {}
      editor = null;
    }
    selectedNoteId = null;
    selectedNoteFormat = null;
    currentFolderId = null;
    noteBreadcrumb = [{ id: null, name: 'All Notes' }];
    if (_notesChangedCleanup) { _notesChangedCleanup(); _notesChangedCleanup = null; }
    _drainOverlays();
  }

  return { render, init, destroy };
})();
