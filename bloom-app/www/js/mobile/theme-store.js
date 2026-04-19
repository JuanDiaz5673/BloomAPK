// ─── Mobile theme store — custom background images on Android ───────
//
// Desktop's `theme.pickImage()` opens a native file dialog, copies the
// chosen file to userData/custom-themes/, and returns { id, path, name }
// where `path` is the absolute disk path. The renderer then sets
// `background-image: url("file://${path}")`.
//
// Mobile equivalent:
//   • Use a hidden <input type="file" accept="image/*"> to trigger the
//     OS picker (works on Android via Capacitor's WebView; opens the
//     gallery / Photos / Files picker depending on what the user has).
//   • Downsize the picked image via canvas (max 1920x1920) to keep
//     Preferences storage reasonable — phone photos are routinely
//     12 MP / 4 MB, and as a base64 data URI that's ~5.4 MB, which
//     would blow up the SharedPreferences blob.
//   • Store the resulting JPEG data URI in Preferences under
//     `theme.customs` as an array of { id, name, dataUri, addedAt }.
//   • Return { id, path: dataUri, name } so the renderer can apply it
//     the same way it applies a desktop file path. The renderer's
//     `applyCustomImage` is patched to detect data: URIs and skip
//     the `file://` prefix.
//
// Caveat: data URIs in Preferences can't be shared across devices.
// If you upload "sunset.jpg" on Phone A you won't see it on Phone B.
// That matches desktop's "files live in userData", just at the device
// level instead of the install level.

(() => {
  const STORE_KEY = 'theme.customs';
  const MAX_DIM = 1920;       // px — downsize so neither side exceeds this
  const JPEG_QUALITY = 0.88;  // sweet spot — visually lossless, ~50% smaller than PNG
  const MAX_ENTRIES = 16;     // hard cap so the store can't grow forever
  // Preferences are limited to ~512 KB per key on Capacitor (Android
  // SharedPreferences XML). 4 MB of base64 across 16 entries is the
  // soft target; we also enforce a per-entry size cap below.
  const MAX_BYTES_PER_ENTRY = 700_000;

  async function _get() {
    try {
      const raw = await window.electronAPI?.store?.get(STORE_KEY);
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  }
  async function _set(list) {
    try { await window.electronAPI?.store?.set(STORE_KEY, list); } catch {}
  }

  /**
   * Open the OS image picker. Resolves with a File on selection, null
   * on cancel. We rebuild the input each call so the same file can be
   * picked twice in a row (browsers debounce identical change events).
   */
  function _pickFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      // iOS doesn't fire `cancel` event in older WebViews; use a focus
      // listener as a soft-cancel detector. Android Capacitor WebView
      // fires `cancel` reliably so this is belt-and-braces.
      let resolved = false;
      const cleanup = () => {
        if (input.parentNode) input.parentNode.removeChild(input);
      };
      input.addEventListener('change', () => {
        resolved = true;
        const f = input.files?.[0] || null;
        cleanup();
        resolve(f);
      });
      input.addEventListener('cancel', () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(null);
      });
      // Fallback: if the user dismisses the picker without firing a
      // change event AND no cancel event arrives, the focus comes back
      // to the window. Wait one tick after focus for change to win.
      const onFocus = () => {
        window.removeEventListener('focus', onFocus);
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve(null);
          }
        }, 600);
      };
      window.addEventListener('focus', onFocus);
      document.body.appendChild(input);
      input.click();
    });
  }

  /**
   * Downsize a File to a JPEG data URI no larger than MAX_DIM on either
   * side. A typical 12 MP phone photo ends up around 250-450 KB. Drops
   * EXIF (orientation included) — the canvas pipeline strips metadata
   * which is actually a privacy win, but means a sideways photo will
   * stay sideways. createImageBitmap respects EXIF orientation in
   * Chromium / Android WebView, so we use it where available.
   */
  async function _resizeToDataUri(file) {
    let bitmap = null;
    try {
      // imageOrientation: 'from-image' applies EXIF rotation so portrait
      // shots from Pixel cameras don't land sideways.
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fallback path for engines without createImageBitmap (older WebView).
      bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
    }
    const w0 = bitmap.width, h0 = bitmap.height;
    const scale = Math.min(1, MAX_DIM / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) try { bitmap.close(); } catch {}
    // Always JPEG — PNGs from screenshots / illustrations would be
    // 5-10x larger and rarely benefit from lossless on a background.
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  }

  /**
   * Pick → resize → persist → return the new entry in the same shape
   * desktop's pickImage does ({id, path, name}) so the renderer's
   * applyCustomImage can use it without branching.
   */
  async function pickImage() {
    const file = await _pickFile();
    if (!file) return null;
    let dataUri;
    try {
      dataUri = await _resizeToDataUri(file);
    } catch (err) {
      console.warn('[theme-store] resize failed:', err);
      try { window.Toast?.show?.('Could not read image — try a different one', 'error'); } catch {}
      return null;
    }
    if (!dataUri) return null;
    if (dataUri.length > MAX_BYTES_PER_ENTRY) {
      // Re-encode at lower quality to fit the cap. If still too big,
      // give up and warn — Preferences would silently truncate large
      // values, which would break the next read.
      try {
        const bitmap = await createImageBitmap(file);
        const halfDim = Math.round(MAX_DIM * 0.7);
        const scale = Math.min(1, halfDim / Math.max(bitmap.width, bitmap.height));
        const w = Math.round(bitmap.width * scale);
        const h = Math.round(bitmap.height * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(bitmap, 0, 0, w, h);
        if (bitmap.close) try { bitmap.close(); } catch {}
        dataUri = c.toDataURL('image/jpeg', 0.78);
      } catch {}
      if (dataUri.length > MAX_BYTES_PER_ENTRY) {
        try { window.Toast?.show?.('Image too large after compression — try a smaller photo', 'error'); } catch {}
        return null;
      }
    }

    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const name = (file.name || 'Custom').replace(/\.[^.]+$/, '').slice(0, 40) || 'Custom';
    const entry = { id, name, dataUri, addedAt: Date.now() };

    let list = await _get();
    list.unshift(entry);
    if (list.length > MAX_ENTRIES) list = list.slice(0, MAX_ENTRIES);
    await _set(list);

    // Mirror the desktop return shape — `path` here is a data URI.
    // theme-engine's applyCustomImage detects the data: scheme and
    // skips its `file://` prefix.
    return { id, path: dataUri, name };
  }

  async function listCustom() {
    const list = await _get();
    // Renderer expects { id, path, name } — mirror that, mapping
    // dataUri → path. Sorted newest first.
    return list
      .map(e => ({ id: e.id, path: e.dataUri, name: e.name }))
      .filter(e => typeof e.path === 'string' && e.path.startsWith('data:image/'));
  }

  async function deleteCustom(id) {
    if (!id) return { success: false };
    const list = await _get();
    const next = list.filter(e => e.id !== id);
    await _set(next);
    return { success: true };
  }

  window._bloomTheme = { pickImage, listCustom, deleteCustom };
})();
