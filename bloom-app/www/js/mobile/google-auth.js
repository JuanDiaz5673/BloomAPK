// ─── Mobile Google auth (Phase 3 — browser/PKCE flow) ─────────────
//
// Why browser-based OAuth instead of Play Services / Credential
// Manager: works on any Android version regardless of Play Services
// version. Mirrors the desktop AllDash flow (same Web OAuth client,
// same scopes, same token endpoint) but uses a Chrome Custom Tab +
// custom URL scheme deep-link for the redirect instead of localhost.
//
// Flow:
//   1. Generate PKCE verifier + challenge
//   2. Open Chrome Custom Tab → Google authorize URL
//   3. User signs in, Google redirects → com.bloom.app://oauth/callback?code=…
//   4. AndroidManifest VIEW intent-filter routes back into the app
//   5. App.appUrlOpen listener catches the URL, parses the code
//   6. POST code + verifier (+ secret) to oauth2.googleapis.com/token
//   7. Persist tokens + profile via Capacitor Preferences

(() => {
  const WEB_CLIENT_ID = '527904723284-b79etfju8a8mfdv50rft7gvqiniu373v.apps.googleusercontent.com';
  // Desktop OAuth client secret. For "Desktop app" / "Installed app"
  // OAuth clients, Google's own docs note the secret is not a security
  // boundary — it's expected to be embedded in distributed binaries
  // (https://developers.google.com/identity/protocols/oauth2/native-app#step-1-configure-the-client-object).
  // PKCE provides the actual security guarantee against code interception.
  // Users may still override via Settings → Advanced.
  const DEFAULT_CLIENT_SECRET = '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';
  // Desktop OAuth clients use the Google-defined reverse-client-id scheme.
  // Single colon + slash is the documented format (NOT `://`).
  // https://developers.google.com/identity/protocols/oauth2/native-app
  const REDIRECT_SCHEME = 'com.googleusercontent.apps.527904723284-b79etfju8a8mfdv50rft7gvqiniu373v';
  const REDIRECT_URI = `${REDIRECT_SCHEME}:/oauth/callback`;
  const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  const TOKEN_URL = 'https://oauth2.googleapis.com/token';
  const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

  const CALENDAR_SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ];
  const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];
  const PROFILE_SCOPES = ['openid', 'profile', 'email'];
  const SCOPES = [...PROFILE_SCOPES, ...CALENDAR_SCOPES, ...DRIVE_SCOPES];

  const TOKEN_KEY = 'google.accessToken';
  const REFRESH_KEY = 'google.refreshToken';
  const EXPIRY_KEY = 'google.tokenExpiry';
  const PROFILE_KEY = 'google.profile';

  function _store() { return window.electronAPI?.store; }
  function _browser() { return window.Capacitor?.Plugins?.Browser; }
  function _app() { return window.Capacitor?.Plugins?.App; }

  // ── PKCE helpers ─────────────────────────────────────────────────
  function _b64url(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function _randomVerifier() {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return _b64url(arr);
  }
  async function _challenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return _b64url(new Uint8Array(hash));
  }

  // ── Stored client secret (user-provided via Settings → Advanced) ─
  async function _clientSecret() {
    const store = _store();
    if (store) {
      if (store.getSecure) {
        try { const s = await store.getSecure('google.clientSecret'); if (s) return s; } catch {}
      }
      try { const s = await store.get('google.clientSecret'); if (s) return s; } catch {}
    }
    return DEFAULT_CLIENT_SECRET;
  }
  async function _clientId() {
    const store = _store();
    try {
      const custom = await store?.get('google.clientId');
      if (custom) return custom;
    } catch {}
    return WEB_CLIENT_ID;
  }

  // ── Pending sign-in (resolved by the appUrlOpen listener) ────────
  let _pending = null;

  function _attachUrlListener() {
    const app = _app();
    if (!app || _attachUrlListener._done) return;
    _attachUrlListener._done = true;
    app.addListener('appUrlOpen', (event) => {
      const url = event?.url || '';
      if (!url.startsWith(REDIRECT_SCHEME + ':')) return;
      const params = new URLSearchParams(url.split('?')[1] || '');
      const code = params.get('code');
      const err = params.get('error');
      if (!_pending) return;
      _browser()?.close().catch(() => {});
      if (err) { _pending.reject(new Error(`OAuth error: ${err}`)); _pending = null; return; }
      if (!code) { _pending.reject(new Error('OAuth callback missing code')); _pending = null; return; }
      _pending.resolve(code);
      _pending = null;
    });
  }

  async function _exchangeCode(code, verifier) {
    const clientId = await _clientId();
    const clientSecret = await _clientSecret();
    if (!clientSecret) {
      throw new Error('Google client secret not set. Open Settings → Google Account → Advanced and paste your Web OAuth client secret.');
    }
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  async function _fetchProfile(accessToken) {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const j = await res.json();
    return {
      email: j.email,
      name: j.name,
      givenName: j.given_name,
      imageUrl: j.picture,
      id: j.sub,
    };
  }

  async function isConfigured() {
    return !!_browser() && !!_app();
  }

  async function getStatus() {
    try {
      const store = _store();
      const profile = await store?.get(PROFILE_KEY);
      const token = await store?.get(TOKEN_KEY);
      if (profile && token) {
        return {
          authenticated: true,
          email: profile.email,
          name: profile.name,
          picture: profile.imageUrl,
        };
      }
    } catch {}
    return { authenticated: false };
  }

  async function signIn() {
    if (!await isConfigured()) {
      throw new Error('Browser plugin not available.');
    }
    _attachUrlListener();
    if (_pending) {
      _pending.reject(new Error('Sign-in superseded by a new attempt.'));
      _pending = null;
    }
    const verifier = _randomVerifier();
    const challenge = await _challenge(verifier);
    const clientId = await _clientId();
    const url = `${AUTHORIZE_URL}?` + new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();

    const codePromise = new Promise((resolve, reject) => {
      _pending = { resolve, reject };
      // Safety timeout — if the user never returns from the browser
      setTimeout(() => {
        if (_pending) { _pending.reject(new Error('Sign-in timed out.')); _pending = null; }
      }, 5 * 60 * 1000);
    });

    await _browser().open({ url, presentationStyle: 'popover' });
    const code = await codePromise;

    const tokens = await _exchangeCode(code, verifier);
    const profile = (await _fetchProfile(tokens.access_token)) || { email: null, name: null };
    const store = _store();
    await store?.set(TOKEN_KEY, tokens.access_token);
    if (tokens.refresh_token) await store?.set(REFRESH_KEY, tokens.refresh_token);
    if (tokens.expires_in) {
      await store?.set(EXPIRY_KEY, Date.now() + tokens.expires_in * 1000);
    }
    await store?.set(PROFILE_KEY, profile);
    // Notify any open view (home cards, sidebar, etc.) to re-fetch.
    // Without this, home.js's listEvents/listNotes/etc. ran ONCE during
    // setup-wizard time when getStatus() was still false, so the cards
    // stayed on their "Connect Google" placeholders until a tab switch.
    try {
      window.dispatchEvent(new CustomEvent('bloom:google-connected', { detail: { profile } }));
    } catch {}
    return { success: true, profile };
  }

  async function signOut() {
    const store = _store();
    await store?.delete(TOKEN_KEY);
    await store?.delete(REFRESH_KEY);
    await store?.delete(EXPIRY_KEY);
    await store?.delete(PROFILE_KEY);
    return { success: true };
  }

  async function getAccessToken() {
    const store = _store();
    const expiry = await store?.get(EXPIRY_KEY);
    if (expiry && Date.now() > Number(expiry) - 60_000) {
      const refreshed = await refreshToken();
      if (refreshed) return refreshed;
    }
    return store?.get(TOKEN_KEY);
  }

  async function refreshToken() {
    const store = _store();
    const refresh = await store?.get(REFRESH_KEY);
    if (!refresh) return null;
    const clientId = await _clientId();
    const clientSecret = await _clientSecret();
    if (!clientSecret) return null;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refresh,
    });
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) return null;
      const j = await res.json();
      if (j.access_token) {
        await store?.set(TOKEN_KEY, j.access_token);
        if (j.expires_in) await store?.set(EXPIRY_KEY, Date.now() + j.expires_in * 1000);
        return j.access_token;
      }
    } catch {}
    return null;
  }

  // Attach the URL listener as soon as the App plugin is available.
  // (Safe to call repeatedly; guarded inside.)
  if (window.Capacitor?.Plugins?.App) {
    _attachUrlListener();
  } else {
    document.addEventListener('deviceready', _attachUrlListener);
    setTimeout(_attachUrlListener, 500);
  }

  window._bloomGoogle = {
    SCOPES, CALENDAR_SCOPES, DRIVE_SCOPES, PROFILE_SCOPES,
    isConfigured, getStatus, signIn, signOut, getAccessToken, refreshToken,
  };
})();
