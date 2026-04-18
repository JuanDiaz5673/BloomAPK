// ─── Mobile Google auth (Phase 3 — scaffold) ──────────────────────
//
// Thin wrapper around @codetrix-studio/capacitor-google-auth. The
// plugin needs a `clientId` configured in capacitor.config.json
// (and an Android OAuth client ID set up in the Google Cloud Console)
// before sign-in will actually work.
//
// Setup steps the user must complete:
//   1. Go to https://console.cloud.google.com/apis/credentials
//   2. Create an OAuth client ID → Android
//      - Package: com.bloom.app
//      - SHA-1 from `keytool -list -v -keystore ~/.android/debug.keystore
//                    -alias androiddebugkey -storepass android -keypass android`
//   3. Paste the returned client ID into capacitor.config.json:
//        "plugins": { "GoogleAuth": { "clientId": "...", "scopes": [...] } }
//   4. Re-sync + rebuild.
//
// Until that happens, signIn() throws a helpful error and getStatus()
// reports unauthenticated — same contract the bridge's placeholder
// uses, so views keep working without a crash.

(() => {
  const CALENDAR_SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ];
  const DRIVE_SCOPES = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.readonly',
  ];
  const PROFILE_SCOPES = [
    'profile', 'email',
  ];
  const SCOPES = [...PROFILE_SCOPES, ...CALENDAR_SCOPES, ...DRIVE_SCOPES];

  const TOKEN_KEY = 'google.accessToken';
  const PROFILE_KEY = 'google.profile';

  function _plugin() {
    return window.Capacitor?.Plugins?.GoogleAuth;
  }

  async function _store() { return window.electronAPI?.store; }

  async function isConfigured() {
    // Best-effort: the plugin throws on signIn if clientId is missing.
    // We also check capacitor.config.json at sync-time but that file
    // isn't readable from the webview, so we defer the check to the
    // first signIn attempt.
    return !!_plugin();
  }

  async function getStatus() {
    try {
      const store = await _store();
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
    } catch { /* ignore */ }
    return { authenticated: false };
  }

  async function signIn() {
    const plugin = _plugin();
    if (!plugin) {
      throw new Error(
        'Google Sign-In plugin not available. Configure it in capacitor.config.json first.'
      );
    }
    try {
      const result = await plugin.signIn();
      const store = await _store();
      await store?.set(TOKEN_KEY, result.authentication?.accessToken);
      await store?.set(PROFILE_KEY, {
        email: result.email,
        name: result.name,
        givenName: result.givenName,
        imageUrl: result.imageUrl,
        id: result.id,
      });
      return { success: true, profile: result };
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (msg.toLowerCase().includes('clientid')) {
        throw new Error(
          'Google OAuth client ID not configured. See HANDOFF.md "Phase 3 setup".'
        );
      }
      throw err;
    }
  }

  async function signOut() {
    const plugin = _plugin();
    try { await plugin?.signOut(); } catch { /* ignore */ }
    const store = await _store();
    await store?.delete(TOKEN_KEY);
    await store?.delete(PROFILE_KEY);
    return { success: true };
  }

  async function getAccessToken() {
    const store = await _store();
    return store?.get(TOKEN_KEY);
  }

  // Refresh: @codetrix-studio/capacitor-google-auth has a refresh method.
  async function refreshToken() {
    const plugin = _plugin();
    if (!plugin?.refresh) return null;
    try {
      const res = await plugin.refresh();
      if (res?.accessToken) {
        const store = await _store();
        await store?.set(TOKEN_KEY, res.accessToken);
        return res.accessToken;
      }
    } catch { /* expired or revoked */ }
    return null;
  }

  window._bloomGoogle = {
    SCOPES, CALENDAR_SCOPES, DRIVE_SCOPES, PROFILE_SCOPES,
    isConfigured, getStatus, signIn, signOut, getAccessToken, refreshToken,
  };
})();
