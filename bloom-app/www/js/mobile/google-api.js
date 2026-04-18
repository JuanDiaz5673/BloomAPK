// ─── Mobile Google API helper ─────────────────────────────────────
//
// Wraps fetch with automatic Authorization header + token refresh on
// 401. The desktop equivalent uses google-auth-library which handles
// refresh internally; we do it manually since we hit the REST API
// directly.

(() => {
  function _g() { return window._bloomGoogle; }

  async function authedFetch(url, options = {}) {
    const auth = _g();
    if (!auth) throw new Error('Google auth not loaded');
    let token = await auth.getAccessToken();
    if (!token) throw new Error('Not authenticated with Google');

    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }

    let res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      // Try refreshing and retry once
      token = await auth.refreshToken();
      if (!token) throw new Error('Google session expired');
      headers.set('Authorization', `Bearer ${token}`);
      res = await fetch(url, { ...options, headers });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Google API ${res.status}: ${text || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    // Some endpoints (DELETE) return empty body
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  window._bloomGoogleApi = { authedFetch };
})();
