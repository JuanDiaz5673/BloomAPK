# Phase setup — what you still need to do

Everything the AI assistant could do autonomously has been shipped. The three things below need **you** because they involve accounts/keys/hardware only you can provision.

---

## Phase 2 — AI (DONE ✅)

- Real streaming for Claude / Gemini / OpenRouter wired in `js/mobile/ai-providers.js`.
- API keys stored via Capacitor Preferences (`store.get/set` through the bridge).
- Bridge exposes the full `electronAPI.ai / .claude / .gemini / .openrouter` surface the renderer expects.
- Provider status object now has the correct `{ active, providers: { claude, gemini, openrouter } }` shape (fixes the `settings.js:746` TypeError from the fuzz audit).
- `POST_NOTIFICATIONS` permission is requested lazily by `js/mobile/pomo-notify.js` the first time a Pomodoro schedules a notification.

**What you do**: open Settings in the app, paste your Claude / Gemini / OpenRouter API key, pick an active provider. Chat starts streaming.

---

## Phase 3 — Google sign-in + Calendar + Notes

### You do

1. Go to https://console.cloud.google.com/apis/credentials
2. Select the same project you used for the desktop Bloom.
3. Create **OAuth client ID → Android**:
   - Package name: `com.bloom.app`
   - SHA-1 fingerprint: run this from the repo root
     ```bash
     source env.sh
     keytool -list -v \
       -keystore ~/.android/debug.keystore \
       -alias androiddebugkey -storepass android -keypass android \
       | grep SHA1:
     ```
4. Paste the returned client ID into `bloom-app/capacitor.config.json`, replacing `YOUR_ANDROID_OAUTH_CLIENT_ID.apps.googleusercontent.com`.
5. Run `cd bloom-app && npx cap sync android` and rebuild.

### What's already wired

- `@codetrix-studio/capacitor-google-auth` installed.
- `js/mobile/google-auth.js` wraps the plugin, persists the access token + profile via the bridge store, throws a helpful error if client ID isn't set.
- Bridge `electronAPI.google.signIn / signOut / getStatus` route to the plugin.

### What's still a stub after you do the above

- `google.listCalendars / listEvents / createEvent / updateEvent / deleteEvent` — the HTTP endpoints work identically on Android with the access token from `google.getAccessToken()`. Port `src/main/services/google-calendar.js` from the desktop repo and call its endpoints with the bearer token. Same for `google-drive.js` (Notes storage).

---

## Phase 4 — Study persistence (DONE ✅)

- `js/mobile/study-store.js` ports the desktop study-store to Capacitor Filesystem.
- Same on-disk JSON shape (`study/decks/{deckId}.json`, `study/sessions.json`, `study/prefs.json`) so a future desktop↔mobile sync can diff directly.
- SM-2 review scheduling, per-deck write serialization, daily-counter roll, 7-day stats + streak all implemented.

**Still-stubbed follow-up**:
- `study.syncNow / getSyncStatus` — depends on Phase 3 Google auth being real. Port `src/main/services/study-sync.js` once signIn works.

---

## Phase 5 — Release signing + Play Store

### You do

1. Generate a release keystore. **Back it up safely.** Losing this file = you can never update the app on Play Store.
   ```bash
   cd C:/Projects/BloomAPK
   source env.sh
   keytool -genkey -v \
     -keystore bloom-release.keystore \
     -alias bloom -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Create `bloom-app/android/keystore.properties` (gitignored):
   ```
   storeFile=../../../bloom-release.keystore
   storePassword=<what you set>
   keyAlias=bloom
   keyPassword=<what you set>
   ```
3. Build a signed APK / AAB:
   ```bash
   cd bloom-app/android
   ./gradlew assembleRelease   # APK
   ./gradlew bundleRelease     # AAB for Play Store
   ```
4. Play Console: create listing → App → Internal testing → upload the AAB.

### What's already wired

- `bloom-app/android/app/build.gradle` reads `keystore.properties` and enables R8 + resource shrinking for the release build.
- `proguard-rules.pro` has keep rules for Capacitor + Google Sign-In + the app package so R8 doesn't strip runtime bindings.
- `.gitignore` already excludes `*.keystore` and `keystore.properties`.

---

## Cross-cutting fixes that landed

| Issue | Status |
|---|---|
| Android hardware back button → pops overlays, navigates home, then exits | ✅ `js/mobile/native-integration.js` |
| StatusBar color follows accent | ✅ same file — `MutationObserver` on `:root` |
| `POST_NOTIFICATIONS` runtime request | ✅ `js/mobile/pomo-notify.js` |
| `settings.js:746` TypeError from fuzz audit | ✅ bridge now returns the correct shape |
| LocalNotifications plugin installed | ✅ |
| GoogleAuth plugin installed | ✅ (awaiting client ID) |

---

## Outstanding work you might want me to handle later

1. **Port `google-calendar.js` + `google-drive.js`** from desktop — mechanical translation, just replace the `google.auth.OAuth2` client with the access token.
2. **Persist chat conversations to Filesystem** (currently in-memory). One-file-per-conversation under `conversations/`, mirroring the desktop layout.
3. **Port `study-sync.js`** for Drive backup of decks.
4. **Port `google-notes.js`** (Drive-Docs export/import).
5. **Live Updates** — `@capacitor/live-updates` for OTA web-asset updates without re-publishing the APK. Nice but not required.
6. **Tool-use** in Claude streaming — right now we send plain chat messages. Adding the `start_pomodoro`, `create_flashcards_from_text` etc. tools requires porting the corresponding mobile handlers first.

None of these block anything. You can ship v0.2 today with the scaffolding above + your Claude/Gemini/OpenRouter keys.
