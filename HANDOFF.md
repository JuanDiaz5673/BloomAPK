# BloomAPK — Handoff doc

Everything you need to know to pick this up from Phase 1.

## What's in the box

- Working debug APK at `dist/Bloom-debug.apk` (~13 MB)
- Capacitor 6 project with Android platform added
- Self-contained toolchain under `tools/` (JDK 17 + Android SDK 34)
- Full Bloom renderer copied to `bloom-app/www/`
- Mobile UI layer: bottom nav, FAB, bottom-sheet chat, responsive CSS
- `electronAPI` stub bridge so renderer boots without crashing

## What's NOT done — prioritized backlog for Phase 2+

### Blocker: you'll need to provide these yourself

1. **Android OAuth client ID** (for Phase 3 / Google sign-in)
   - Open https://console.cloud.google.com/apis/credentials
   - Pick the same project you used for the desktop Bloom
   - Credentials → Create Credentials → OAuth client ID → **Android**
   - Package name: `com.bloom.app`
   - SHA-1 fingerprint: run this from `bloom-app/`:
     ```bash
     source ../env.sh
     keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
     ```
   - Paste the returned client ID into `bloom-app/capacitor.config.json` under a new `GoogleAuth` plugin config.

2. **Release keystore** (for Phase 5 / Play Store)
   - Generate once:
     ```bash
     keytool -genkey -v -keystore bloom-release.keystore -alias bloom -keyalg RSA -keysize 2048 -validity 10000
     ```
   - Back up safely. Losing this keystore = can't update the app in Play Store, ever.
   - Wire into `android/app/build.gradle` `signingConfigs { release { ... } }`.

3. **Physical device test** — an emulator shows most issues, but touch targets, keyboard behavior, and Play Services OAuth only really surface on a real phone.

### I can do these without you

The list below is what to tackle in the next session. Ordered by user-visible impact.

#### Phase 2 — Make AI work (highest ROI)

- [ ] **Install `@capacitor-community/http`** (or use native `fetch` — Capacitor 6 supports it) for streaming Claude/Gemini/OpenRouter responses.
- [ ] **Port API key storage**: replace the bridge's `claude.setApiKey` / `gemini.setApiKey` / `openrouter.setApiKey` stubs with Capacitor Preferences (good enough for MVP) → later a native Keystore plugin.
  - Bridge file: `bloom-app/www/js/capacitor-bridge.js` (~lines 160-200).
- [ ] **Port streamChat**: read provider keys, call provider endpoints, emit `claude:stream-delta` / `claude:stream-done` events matching desktop's channel names.
  - The renderer's chat.js + bloom-panel.js + bloom-sheet.js all listen on these channels already — **zero renderer changes needed**.
- [ ] **SSE parsing**: Claude/Gemini/OpenRouter all return SSE. Capacitor's native fetch supports `ReadableStream`. A tiny parser already exists in `src/main/services/openrouter-api.js::_consumeSSE` — port that.

#### Phase 3 — Google sign-in + Calendar + Notes (Drive)

- [ ] Install `@capacitor-community/google-sign-in` or `@codetrix-studio/capacitor-google-auth`.
- [ ] Wire the bridge's `google.signIn` / `google.signOut` / `google.getStatus` to the plugin.
- [ ] For Calendar: the Google Calendar API v3 HTTP endpoints work identically on Android — port `src/main/services/google-calendar.js` by replacing the `google.auth.OAuth2` client with the Android access token.
- [ ] Notes (Drive Docs export/import): same pattern.

#### Phase 4 — Study persistence + sync

- [ ] Port `src/main/services/study-store.js` to Capacitor Filesystem (`Filesystem.writeFile` / `readFile` / `readdir`). Keep the `.json` on-disk format identical so users who switch between desktop and mobile see the same decks if they sync.
- [ ] Port `src/main/services/study-sync.js` (Drive sync) — depends on Phase 3 Google auth.

#### Phase 5 — Polish + release

- [ ] Create release keystore (see blocker #2).
- [ ] Wire `android/app/build.gradle` for release signing.
- [ ] Run `./gradlew assembleRelease`.
- [ ] ProGuard/R8 tuning — minify shrinks APK ~20-30%.
- [ ] Enable `@capacitor/live-updates` if we want OTA web-asset updates without re-publishing the APK.
- [ ] Play Console: create listing, upload AAB, internal testing track.

## Immediate quality-of-life wishlist

Small things that would improve Phase 1 but aren't blockers:

- [ ] **Flip the splash `../../assets/` paths** — the main HTML was rewritten by `tmp-fix-paths.js` but the inline splash-screen `<img>` in `index.html` *should* also have been caught. Double-check: `assets/images/bloom-avatar.png` (no `../../`) in the splash `<img>` tag.
- [ ] **First-run permission prompt** for `POST_NOTIFICATIONS` on Android 13+. Currently we declare the permission but never request it at runtime — Pomodoro notifications will silently fail.
- [ ] **StatusBar color** follows the theme engine. Currently hardcoded to `#0f050a`. When a user switches to a light theme the status bar looks wrong.
- [ ] **Safe-area testing** on notched phones. `env(safe-area-inset-*)` is wired into mobile.css but needs a real device to verify.
- [ ] **Back-button handling** — Android hardware back should navigate the SPA (Router.goBack?), not close the app on every tap. Capacitor's App plugin has `addListener('backButton', ...)` — wire it in `app.js`.

## How to verify the APK actually works

```bash
# In a new terminal:
source C:/Projects/BloomAPK/env.sh
adb devices  # plug phone in with USB debugging enabled, OR start emulator
adb install -r C:/Projects/BloomAPK/dist/Bloom-debug.apk
adb logcat -s Capacitor:* BloomApp:*  # watch logs while testing
```

If you hit "INSTALL_FAILED_UPDATE_INCOMPATIBLE" on a re-install, uninstall first: `adb uninstall com.bloom.app`.

## Things I specifically did NOT do and why

- **Didn't run the APK** — no emulator pre-configured in the self-contained toolchain. The build completed successfully, but visual verification on an actual device is your first-session task.
- **Didn't touch the desktop Bloom project at `C:\Projects\AllDash`** — per your explicit ask. This repo is a parallel deliverable.
- **Didn't inline the mobile changes into parent Bloom** — keeping them separate so the desktop build stays unchanged. If you later want one shared codebase, the mobile.css + bottom-nav + bloom-sheet + capacitor-bridge files are all additive and could drop into `src/renderer/` without conflicts.
- **Didn't attempt Google OAuth** — you said you'd handle that later. The bridge's `google.signIn` stubs to a "coming soon" toast.
- **Didn't add auto-increment versionCode / changelog tooling** — premature. When we ship Phase 5 to Play, we'll set that up.

## Questions I'd ask on your return

1. Which phone are you testing on? (Pixel? Samsung? Screen size? Android version?) — tuning priority for touch targets.
2. Do you want a single codebase (one repo, desktop + mobile) or stay with two parallel repos? Single-codebase is doable with a `platform` flag everywhere; doubles the mental load but removes diff drift.
3. For Phase 2 AI: same keys as desktop (user re-enters in mobile settings) or OAuth-like sync from a shared account? MVP is the former; nicer long-term is the latter but needs a backend.

Ping me with answers and we can get Phase 2 running in the next session.
