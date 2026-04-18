// ─── Files View (Google Drive) ───
const FilesView = (() => {
  let currentFolderId = 'root';
  let breadcrumb = [{ id: 'root', name: 'My Drive' }];
  let previewOpen = false;

  function _mimeToIcon(mimeType) {
    if (mimeType === 'application/vnd.google-apps.folder') return { icon: 'folder', color: 'var(--accent-warm)', svg: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' };
    if (mimeType.includes('document') || mimeType.includes('word')) return { icon: 'doc', color: 'var(--accent-pink)', svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>' };
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return { icon: 'sheet', color: '#6fdb8b', svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="12" y1="9" x2="12" y2="21"/>' };
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return { icon: 'slide', color: '#fd9a6c', svg: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>' };
    if (mimeType.includes('pdf')) return { icon: 'pdf', color: '#ff6b6b', svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' };
    if (mimeType.includes('image') || mimeType.includes('photoshop') || mimeType.includes('x-psd')) return { icon: 'img', color: 'var(--accent-warm)', svg: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>' };
    if (mimeType.includes('video')) return { icon: 'vid', color: 'var(--accent-rose)', svg: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>' };
    if (mimeType.includes('audio')) return { icon: 'audio', color: 'var(--accent-blush)', svg: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' };
    if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('compressed')) return { icon: 'zip', color: 'var(--accent-blush)', svg: '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>' };
    if (mimeType.includes('text') || mimeType.includes('plain') || mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('xml') || mimeType.includes('css') || mimeType.includes('html')) return { icon: 'text', color: 'var(--text-secondary)', svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>' };
    return { icon: 'file', color: 'var(--accent-pink)', svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' };
  }

  function _isGoogleNative(mimeType) {
    return mimeType.startsWith('application/vnd.google-apps.');
  }

  function _formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(1) + ' GB';
  }

  function _formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function _escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function render() {
    return `
    <div class="files-view">
      <div class="glass-card" style="padding:10px 16px;animation:fadeSlideUp 0.5s ease 0.05s both;">
        <div class="files-toolbar">
          <div class="files-breadcrumb" id="files-breadcrumb">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--accent-warm)" stroke-width="1.8" fill="none" style="margin-right:6px;flex-shrink:0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span class="files-breadcrumb-item current">My Drive</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="files-action-btn" id="files-new-folder-btn" title="New Folder">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
              New Folder
            </button>
            <button class="files-action-btn" id="files-upload-btn" title="Upload File">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload
            </button>
            <div style="width:1px;height:20px;background:var(--glass-border);margin:0 4px;"></div>
            <div class="files-view-toggle">
              <button class="active" id="files-grid-btn" title="Grid view">
                <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              </button>
              <button id="files-list-btn" title="List view">
                <svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="glass-card files-content" style="flex:1;overflow-y:auto;animation:fadeSlideUp 0.6s ease 0.15s both;">
        <div class="files-grid-view" id="files-grid">
          <div style="grid-column:1/-1;text-align:center;padding:60px 40px;display:flex;flex-direction:column;align-items:center;gap:14px;">
            <svg viewBox="0 0 24 24" width="52" height="52" stroke="var(--accent-blush)" stroke-width="1" fill="none" style="opacity:0.35;animation:float 4s ease-in-out infinite;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <div style="font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--text-secondary);">Loading your files...</div>
          </div>
        </div>
      </div>

      <!-- Preview Panel -->
      <div class="file-preview-overlay" id="file-preview-overlay" style="display:none;">
        <div class="file-preview-panel glass-card">
          <div class="file-preview-header">
            <button class="file-preview-back" id="preview-back">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><polyline points="15 18 9 12 15 6"/></svg>
              Back
            </button>
            <div class="file-preview-title" id="preview-title">File Preview</div>
            <button class="btn-sm" id="preview-open-browser" title="Open in browser">
              <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Open
            </button>
          </div>
          <div class="file-preview-content" id="preview-content">
            <!-- Preview content loads here -->
          </div>
        </div>
      </div>
    </div>`;
  }

  async function init() {
    if (!window.electronAPI) return;
    let isAuthenticated = false;
    try {
      const status = await window.electronAPI.google.getStatus();
      isAuthenticated = status.authenticated;
    } catch {}

    if (!isAuthenticated) {
      const grid = document.getElementById('files-grid');
      if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 40px;display:flex;flex-direction:column;align-items:center;gap:16px;">
        <svg viewBox="0 0 24 24" width="56" height="56" stroke="var(--accent-blush)" stroke-width="1" fill="none" style="opacity:0.4;animation:float 4s ease-in-out infinite;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:400;color:var(--text-secondary);">Your files await</div>
        <p style="font-size:12px;color:var(--text-muted);font-weight:300;max-width:280px;line-height:1.6;">Connect your Google account in Settings to browse your Google Drive files.</p>
        <button class="btn-pink" data-nav="settings" style="margin-top:8px;padding:10px 24px;font-size:12px;">Connect Google Account</button>
      </div>`;
      return;
    }

    currentFolderId = 'root';
    breadcrumb = [{ id: 'root', name: 'My Drive' }];
    await loadFolder(currentFolderId);

    // Deep link: open a specific file preview if requested (from home page, search, etc)
    const link = typeof Router !== 'undefined' ? Router.consumeDeepLink('file') : null;
    if (link?.id) {
      try { openPreview(link.id, link.name || 'File', link.mime || '', link.link || ''); } catch (err) { console.warn('Deep-link to file failed:', err); }
    }

    // View toggle
    document.getElementById('files-grid-btn')?.addEventListener('click', () => {
      document.getElementById('files-grid-btn').classList.add('active');
      document.getElementById('files-list-btn').classList.remove('active');
      const grid = document.getElementById('files-grid');
      if (grid) grid.className = 'files-grid-view';
    });

    document.getElementById('files-list-btn')?.addEventListener('click', () => {
      document.getElementById('files-list-btn').classList.add('active');
      document.getElementById('files-grid-btn').classList.remove('active');
      const grid = document.getElementById('files-grid');
      if (grid) grid.className = 'files-list-view';
    });

    // Preview controls
    document.getElementById('preview-back')?.addEventListener('click', closePreview);

    // New Folder
    document.getElementById('files-new-folder-btn')?.addEventListener('click', async () => {
      const name = await Confirm.prompt('Enter a name for the new folder:', 'New Folder', 'Folder name...');
      if (!name) return;
      try {
        await window.electronAPI.drive.createFolder(currentFolderId, name.trim());
        Toast.show(`Folder "${name.trim()}" created`, 'success');
        await loadFolder(currentFolderId);
      } catch (err) {
        Toast.show('Failed to create folder', 'error');
      }
    });

    // Upload File
    document.getElementById('files-upload-btn')?.addEventListener('click', async () => {
      try {
        const uploaded = await window.electronAPI.drive.uploadFile(currentFolderId);
        if (uploaded && uploaded.length > 0) {
          Toast.show(`${uploaded.length} file${uploaded.length > 1 ? 's' : ''} uploaded`, 'success');
          await loadFolder(currentFolderId);
        }
      } catch (err) {
        Toast.show('Failed to upload', 'error');
      }
    });
  }

  async function loadFolder(folderId) {
    const grid = document.getElementById('files-grid');
    if (!grid) return;

    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);font-size:12px;">Loading...</div>`;

    try {
      const files = await window.electronAPI.drive.listFiles(folderId);
      currentFolderId = folderId;
      updateBreadcrumb();

      if (files.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 40px;display:flex;flex-direction:column;align-items:center;gap:12px;">
          <svg viewBox="0 0 24 24" width="44" height="44" stroke="var(--accent-blush)" stroke-width="1" fill="none" style="opacity:0.3;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <div style="font-size:13px;color:var(--text-muted);font-weight:300;">This folder is empty</div>
        </div>`;
        return;
      }

      grid.innerHTML = files.map(file => {
        const { icon, color, svg } = _mimeToIcon(file.mimeType);
        const sizeStr = _formatSize(file.size);
        const dateStr = _formatDate(file.modifiedTime);
        const meta = sizeStr ? `${sizeStr} · ${dateStr}` : dateStr;

        return `
        <div class="file-entry ${file.isFolder ? 'directory' : ''}"
             data-id="${_escapeHtml(file.id)}"
             data-name="${_escapeHtml(file.name)}"
             data-folder="${file.isFolder}"
             data-link="${_escapeHtml(file.webViewLink || '')}"
             data-mime="${_escapeHtml(file.mimeType)}">
          <div class="file-entry-icon ${icon}" style="background:${color}15;">
            <svg viewBox="0 0 24 24" stroke="${color}" fill="none" stroke-width="1.8">${svg}</svg>
          </div>
          <div class="file-entry-info">
            <div class="file-entry-name">${_escapeHtml(file.name)}</div>
            <div class="file-entry-meta">${meta}</div>
          </div>
          <button class="file-delete-btn" data-delete-id="${_escapeHtml(file.id)}" data-delete-name="${_escapeHtml(file.name)}" title="Delete">
            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>`;
      }).join('');

      // Attach click handlers
      grid.querySelectorAll('.file-entry').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.file-delete-btn')) return;
          const isFolder = el.dataset.folder === 'true';
          if (isFolder) {
            breadcrumb.push({ id: el.dataset.id, name: el.dataset.name });
            loadFolder(el.dataset.id);
          } else {
            openPreview(el.dataset.id, el.dataset.name, el.dataset.mime, el.dataset.link);
          }
        });
      });

      // Delete buttons
      grid.querySelectorAll('.file-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const name = btn.dataset.deleteName;
          const confirmed = await Confirm.show(`Move "${name}" to trash? This can be undone from Google Drive.`, 'Delete File');
          if (!confirmed) return;
          try {
            await window.electronAPI.drive.deleteFile(btn.dataset.deleteId);
            // Drop the deleted file from the home Recent Files tracker too,
            // otherwise the home card would surface a tombstone the user can
            // click but never actually open.
            try { window.electronAPI.recent?.forget(btn.dataset.deleteId, 'file'); } catch {}
            Toast.show(`"${name}" moved to trash`, 'info');
            await loadFolder(currentFolderId);
          } catch (err) {
            Toast.show('Failed to delete: ' + (err.message || ''), 'error');
          }
        });
      });

    } catch (err) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);font-size:12px;">Failed to load files: ${err.message || 'Unknown error'}</div>`;
    }
  }

  // Preview zoom/pan. Two distinct strategies depending on content:
  //
  //   TEXT (<pre class="zoom-target">) — zoom adjusts font-size, NOT
  //     CSS transform. Reflowable content: bigger font means bigger
  //     layout box, and the container's native overflow:auto scroll
  //     reveals everything. Normal mouse wheel / trackpad two-finger
  //     swipe scrolls the text as the user expects at any zoom level.
  //     Bonus: text stays crisp (transform:scale rasterizes glyphs;
  //     font-size resizing keeps them vector-rendered by the browser).
  //
  //   IMAGES (<img class="zoom-target">) — zoom uses transform:scale
  //     because images aren't reflowable. When zoomed in, plain wheel
  //     PANS (translates the image) rather than scrolls — same model
  //     as Figma, macOS Preview, Chrome PDF viewer. Ctrl/Cmd+wheel
  //     zooms relative to the cursor position (the pixel under the
  //     cursor stays there after zoom — standard "zoom to cursor"
  //     behavior users expect).
  //
  // Trackpad notes: two-finger pinch on Windows precision touchpads
  // and macOS is synthesized by Chromium as `wheel + ctrlKey:true`, so
  // the Ctrl branch catches pinch automatically. Two-finger swipe is a
  // plain wheel event with deltaX and/or deltaY — we respect both axes
  // for image pan and let the browser handle native scroll for text.

  function _setupZoomAndPan(container) {
    const zoomTarget = container.querySelector('.zoom-target');
    if (!zoomTarget) return;
    if (zoomTarget.tagName === 'PRE') _setupTextZoom(container, zoomTarget);
    else _setupImageZoomPan(container, zoomTarget);
  }

  function _setupTextZoom(container, pre) {
    let zoom = 1;
    const BASE_FONT_PX = 13; // matches the inline style on the pre
    const MIN = 0.5, MAX = 4;
    function apply() {
      pre.style.fontSize = `${(BASE_FONT_PX * zoom).toFixed(2)}px`;
      // Scale line-height proportionally so readability holds.
      pre.style.lineHeight = (1.7).toString();
    }
    container.addEventListener('wheel', (e) => {
      // Only intercept when the user is EXPLICITLY zooming. All other
      // wheel events (normal scroll, shift-scroll, trackpad swipe) fall
      // through to the container's native overflow:auto — that's what
      // makes zoomed text scrollable, which the transform-scale version
      // was blocking.
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      zoom = Math.max(MIN, Math.min(MAX, zoom + delta));
      apply();
    }, { passive: false });
    // Ctrl+0 resets (when container has focus — it's focusable via tab).
    container.tabIndex = -1;
    container.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        zoom = 1;
        apply();
      }
    });
    // Double-click anywhere in the container also resets.
    container.addEventListener('dblclick', () => { zoom = 1; apply(); });
  }

  function _setupImageZoomPan(container, img) {
    let zoom = 1, panX = 0, panY = 0;
    let dragging = false, dragStartX = 0, dragStartY = 0;
    const MIN = 0.25, MAX = 8;
    function apply() {
      img.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    }
    container.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        // Zoom-to-cursor: convert cursor position to image-space
        // coordinates BEFORE the zoom change, then pick panX/panY so
        // the same image pixel stays under the cursor AFTER. This is
        // what makes zoom feel non-disorienting — the thing you're
        // aiming at doesn't slide away. Math derivation:
        //   Cursor position in container coords: (cx, cy)
        //   Image pixel under cursor: ((cx - panX)/zoom, (cy - panY)/zoom)
        //   After zoom: want the same (imgX, imgY) under cursor →
        //     cx = imgX * newZoom + newPanX → newPanX = cx - imgX*newZoom
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const imgX = (cx - panX) / zoom;
        const imgY = (cy - panY) / zoom;
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        const newZoom = Math.max(MIN, Math.min(MAX, zoom + delta));
        panX = cx - imgX * newZoom;
        panY = cy - imgY * newZoom;
        zoom = newZoom;
        apply();
        return;
      }
      // Plain wheel = pan when zoomed. Two-finger trackpad swipe sends
      // both deltaX and deltaY, which produces natural 2D pan. At zoom
      // 1x the image fits by object-fit:contain, so panning would do
      // nothing visible — let the event fall through to native scroll
      // (harmless: flex-centered image in overflow:auto container).
      if (zoom > 1) {
        e.preventDefault();
        panX -= e.deltaX;
        panY -= e.deltaY;
        apply();
      }
    }, { passive: false });
    // Click-drag pan (kept for discoverability — not everyone knows wheel pans).
    container.addEventListener('mousedown', (e) => {
      if (zoom <= 1) return;
      dragging = true;
      dragStartX = e.clientX - panX;
      dragStartY = e.clientY - panY;
      container.style.cursor = 'grabbing';
      e.preventDefault();
    });
    container.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panX = e.clientX - dragStartX;
      panY = e.clientY - dragStartY;
      apply();
    });
    container.addEventListener('mouseup', () => {
      dragging = false;
      container.style.cursor = zoom > 1 ? 'grab' : 'default';
    });
    container.addEventListener('mouseleave', () => {
      dragging = false;
      container.style.cursor = 'default';
    });
    container.addEventListener('dblclick', () => {
      zoom = 1; panX = 0; panY = 0;
      apply();
      container.style.cursor = 'default';
    });
  }

  function _isPsd(mimeType, fileName) {
    return mimeType.includes('photoshop') || mimeType.includes('x-psd') || mimeType.includes('vnd.adobe.photoshop') || (fileName && fileName.toLowerCase().endsWith('.psd'));
  }

  async function openPreview(fileId, fileName, mimeType, webViewLink) {
    const overlay = document.getElementById('file-preview-overlay');
    const content = document.getElementById('preview-content');
    const title = document.getElementById('preview-title');
    const openBtn = document.getElementById('preview-open-browser');
    if (!overlay || !content) return;

    // Record the access in the home page's "Recent Files" tracker. Fire
    // and forget — a tracker failure should never block the actual preview.
    // We track here (not on the click handler) so that deep-links from
    // the home card and search results also count as accesses.
    try {
      window.electronAPI?.recent?.track({
        kind: 'file',
        id: fileId,
        name: fileName,
        mimeType,
        webViewLink,
        parentId: currentFolderId,
      });
    } catch {}

    title.textContent = fileName;
    previewOpen = true;
    overlay.style.display = 'flex';
    content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px;">Loading preview...</div>`;

    // Set up open-in-browser button
    openBtn.onclick = () => {
      if (webViewLink) window.electronAPI.drive.open(webViewLink);
    };

    try {
      if (_isGoogleNative(mimeType)) {
        // Google Docs/Sheets/Slides — embed via iframe (Electron's
        // <webview> tag doesn't exist in Android WebView; iframe works
        // on both platforms).
        const embedUrl = webViewLink ? webViewLink.replace(/\/edit.*$/, '/preview') : '';
        if (embedUrl) {
          content.innerHTML = `<iframe src="${embedUrl}" style="width:100%;height:100%;border:none;" sandbox="allow-same-origin allow-scripts allow-popups allow-forms"></iframe>`;
        } else {
          content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">Cannot preview this file</div>`;
        }
      } else if (mimeType.includes('image') || _isPsd(mimeType, fileName)) {
        // Images & PSDs — download and show with zoom
        let dataResult;
        if (_isPsd(mimeType, fileName)) {
          // PSD: Google Drive stores a preview thumbnail — try to get it
          // Fall back to downloading as-is and showing the thumbnail
          try {
            dataResult = await window.electronAPI.drive.getDataUri(fileId, 'image/png');
          } catch {
            dataResult = await window.electronAPI.drive.getDataUri(fileId, mimeType);
          }
        } else {
          dataResult = await window.electronAPI.drive.getDataUri(fileId, mimeType);
        }
        content.innerHTML = `<div class="preview-zoom-container" style="display:flex;align-items:center;justify-content:center;height:100%;overflow:auto;padding:20px;position:relative;">
          <img class="zoom-target" src="${dataResult.dataUri}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.3);transition:transform 0.15s ease;transform-origin:center center;" alt="${_escapeHtml(fileName)}">
          <div class="zoom-hint" style="position:absolute;bottom:16px;right:16px;font-size:10px;color:var(--text-muted);background:rgba(30,12,20,0.6);padding:4px 10px;border-radius:6px;">Ctrl+Scroll to zoom · Drag to pan · Double-click to reset</div>
        </div>`;
        _setupZoomAndPan(content.querySelector('.preview-zoom-container'));
      } else if (mimeType.includes('pdf')) {
        // PDFs — use <iframe> for Chromium's built-in PDF viewer
        // (Android WebView doesn't recognize Electron's <webview>).
        const { dataUri } = await window.electronAPI.drive.getDataUri(fileId, mimeType);
        content.innerHTML = `<iframe src="${dataUri}" style="width:100%;height:100%;border:none;"></iframe>`;
      } else if (mimeType.includes('text') || mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('xml') || mimeType.includes('css') || mimeType.includes('html') || mimeType.includes('plain')) {
        // Text files — download and show with zoom
        const { dataUri } = await window.electronAPI.drive.getDataUri(fileId, mimeType);
        const base64 = dataUri.split(',')[1];
        const text = atob(base64);
        // Text zoom uses font-size (see _setupTextZoom) — NOT transform.
        // That way the <pre>'s layout height grows with zoom and the
        // container's native overflow:auto scroll works at any level.
        // transition-on-font-size keeps zoom steps feeling smooth.
        content.innerHTML = `<div class="preview-zoom-container" style="height:100%;overflow:auto;">
          <pre class="zoom-target" style="padding:20px;font-family:'Outfit',monospace;font-size:13px;font-weight:300;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;line-height:1.7;transition:font-size 0.12s ease;">${_escapeHtml(text)}</pre>
        </div>`;
        _setupZoomAndPan(content.querySelector('.preview-zoom-container'));
      } else if (mimeType.includes('video')) {
        const { dataUri } = await window.electronAPI.drive.getDataUri(fileId, mimeType);
        content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:20px;">
          <video controls style="max-width:100%;max-height:100%;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.3);">
            <source src="${dataUri}" type="${mimeType}">
          </video>
        </div>`;
      } else if (mimeType.includes('audio')) {
        const { dataUri } = await window.electronAPI.drive.getDataUri(fileId, mimeType);
        content.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:20px;">
          <svg viewBox="0 0 24 24" width="80" height="80" stroke="var(--accent-blush)" stroke-width="1" fill="none" style="opacity:0.4;"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <div style="font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--text-secondary);">${_escapeHtml(fileName)}</div>
          <audio controls style="width:80%;max-width:400px;">
            <source src="${dataUri}" type="${mimeType}">
          </audio>
        </div>`;
      } else {
        content.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;">
          <svg viewBox="0 0 24 24" width="56" height="56" stroke="var(--accent-blush)" stroke-width="1" fill="none" style="opacity:0.4;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <div style="font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--text-secondary);">Preview not available</div>
          <p style="font-size:12px;color:var(--text-muted);font-weight:300;">This file type can't be previewed in the app.</p>
          <button class="btn-pink" data-open-external="${_escapeHtml(webViewLink)}" style="padding:10px 24px;font-size:12px;">Open in Browser</button>
        </div>`;
      }
    } catch (err) {
      content.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;">
        <div style="color:var(--text-muted);font-size:13px;">Failed to load preview: ${err.message || 'Unknown error'}</div>
        <button class="btn-pink" data-open-external="${_escapeHtml(webViewLink)}" style="padding:8px 20px;font-size:12px;">Open in Browser</button>
      </div>`;
    }
  }

  function closePreview() {
    const overlay = document.getElementById('file-preview-overlay');
    if (overlay) overlay.style.display = 'none';
    previewOpen = false;
  }

  function updateBreadcrumb() {
    const bc = document.getElementById('files-breadcrumb');
    if (!bc) return;

    bc.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--accent-warm)" stroke-width="1.8" fill="none" style="margin-right:6px;flex-shrink:0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>` +
      breadcrumb.map((item, i) => {
        const isLast = i === breadcrumb.length - 1;
        const sep = i > 0 ? '<span class="files-breadcrumb-sep">\u203A</span>' : '';
        return `${sep}<span class="files-breadcrumb-item ${isLast ? 'current' : ''}" data-bc-idx="${i}">${_escapeHtml(item.name)}</span>`;
      }).join('');

    bc.querySelectorAll('.files-breadcrumb-item:not(.current)').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.bcIdx);
        breadcrumb = breadcrumb.slice(0, idx + 1);
        loadFolder(breadcrumb[idx].id);
      });
    });
  }

  function destroy() {
    previewOpen = false;
  }

  return { render, init, destroy };
})();
