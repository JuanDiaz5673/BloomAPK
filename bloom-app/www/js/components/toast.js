// ─── Toast Notifications ───
const Toast = (() => {
  let toastContainer = null;

  function ensureContainer() {
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 9999;
        display: flex; flex-direction: column; gap: 8px;
        pointer-events: none;
      `;
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }

  // Cap toast text so a 50KB AI/Drive error message doesn't dominate the UI
  // (the underlying _safeError pass in the service layer should already
  // strip huge payloads, but defense in depth).
  const MAX_MESSAGE_LEN = 240;
  // Track outstanding timeouts so the renderer can clear them all at once
  // (e.g. on hot reload during dev). Without this, orphaned closures
  // accumulate when many toasts are shown in quick succession.
  const _pending = new Set();

  function show(message, type = 'info', duration = 3000) {
    const container = ensureContainer();
    const toast = document.createElement('div');

    const colors = {
      info: 'rgba(255,107,157,0.15)',
      success: 'rgba(111,219,139,0.15)',
      error: 'rgba(255,80,80,0.15)',
      warning: 'rgba(253,154,108,0.15)'
    };

    const borderColors = {
      info: 'rgba(255,107,157,0.3)',
      success: 'rgba(111,219,139,0.3)',
      error: 'rgba(255,80,80,0.3)',
      warning: 'rgba(253,154,108,0.3)'
    };

    toast.style.cssText = `
      background: ${colors[type] || colors.info};
      backdrop-filter: blur(20px);
      border: 1px solid ${borderColors[type] || borderColors.info};
      border-radius: 12px;
      padding: 10px 16px;
      font-family: 'Outfit', sans-serif;
      font-size: 12px; font-weight: 400;
      color: rgba(255,255,255,0.95);
      pointer-events: auto;
      animation: fadeSlideDown 0.3s ease both;
      max-width: 320px;
    `;
    // Coerce + cap the displayed message. textContent is XSS-safe, so the
    // only concern here is UX (giant strings).
    let safeMsg = String(message == null ? '' : message);
    if (safeMsg.length > MAX_MESSAGE_LEN) {
      safeMsg = safeMsg.slice(0, MAX_MESSAGE_LEN - 1) + '\u2026';
    }
    toast.textContent = safeMsg;

    container.appendChild(toast);

    const dismissTimer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      const removeTimer = setTimeout(() => {
        toast.remove();
        _pending.delete(removeTimer);
      }, 300);
      _pending.add(removeTimer);
      _pending.delete(dismissTimer);
    }, duration);
    _pending.add(dismissTimer);
  }

  /** Clear every pending dismiss/remove timer. Useful during hot-reload
   *  or sign-out to avoid orphaned closures firing on detached nodes. */
  function clearAll() {
    for (const t of _pending) clearTimeout(t);
    _pending.clear();
    if (toastContainer) {
      while (toastContainer.firstChild) toastContainer.removeChild(toastContainer.firstChild);
    }
  }

  return { show, clearAll };
})();
