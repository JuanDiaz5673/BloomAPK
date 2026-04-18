# CLAUDE.md — BloomAPK

Guidance for Claude Code when working on the Android port of Bloom.

## What this repo is

A Capacitor 6 scaffold that ships the Bloom renderer (originally built for Electron / Windows) as an Android APK. **Phase 1 scope**: UI renders, backend services are stubbed. Phase 2-5 add real implementations piece by piece.

- **Parent desktop project**: `C:\Projects\AllDash` (GitHub: https://github.com/JuanDiaz5673/Bloom)
- **This repo**: `C:\Projects\BloomAPK` (GitHub: https://github.com/JuanDiaz5673/BloomAPK — public)
- **Phase roadmap**: see `HANDOFF.md`

## Build commands

All builds use the self-contained toolchain under `tools/` — no system JDK / Android SDK required.

```bash
# Source env vars every new shell. Sets JAVA_HOME to bundled JDK 17
# + ANDROID_HOME to bundled SDK 34, prepended to PATH.
source env.sh

# After editing anything under bloom-app/www/, re-sync before building:
cd bloom-app
npx cap sync android

# Build debug APK:
cd android
./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk

# Copy to dist/ for distribution:
cp app/build/outputs/apk/debug/app-debug.apk ../../dist/Bloom-debug.apk
```

**Re-installing on a connected device**:
```bash
source env.sh
adb install -r dist/Bloom-debug.apk
# If you hit INSTALL_FAILED_UPDATE_INCOMPATIBLE, uninstall first:
adb uninstall com.bloom.app
```

## Architecture

### The bridge pattern — `www/js/capacitor-bridge.js`

This is the critical file. The Bloom renderer was written against Electron's `window.electronAPI` (~50 IPC methods from `src/main/preload.js` in the parent repo). Rewriting every view for Android would take weeks.

Instead, `capacitor-bridge.js` stubs the **entire** `electronAPI` surface with async no-ops, so the renderer boots cleanly:

- `listDecks()` → `[]`
- `generateGreeting()` → `null` (renderer has a canned-fallback greeting)
- `streamChat()` → shows a friendly "coming soon" toast
- `getStats()` → zero-filled stats struct with today's date
- `store.get(key)` → Capacitor Preferences lookup, with localStorage fallback for desktop-browser preview

**Rule for porting a backend feature to mobile**: replace that one bridge method with a real Capacitor plugin call. **Zero view code changes** — views keep calling `window.electronAPI.foo.bar()` and don't need to know the implementation changed.

Think of the bridge as the "Android half" of the IPC contract that the Electron preload is the "desktop half" of.

### Mobile UI — `www/styles/mobile.css` + `www/js/components/bottom-nav.js` + `www/js/components/bloom-sheet.js`

All mobile adaptations flip at a SINGLE breakpoint: `@media (max-width: 768px)`. Desktop layout is untouched above 768px — useful for landscape tablets.

Mobile-specific patterns:
- **Bottom nav**: 4 tabs (Home / Study / Calendar / Notes) + centered raised Bloom FAB that opens the ambient chat bottom-sheet. Settings moves to the header avatar tap; Files becomes a card inside Home; Chat becomes the FAB (demoting it to a tab would contradict Bloom's "ambient, not a destination" DNA).
- **Bloom bottom-sheet** (`bloom-sheet.js`): replaces the desktop sidebar ambient panel. Drag-to-expand (55vh default → 92vh expanded), tap overlay or close button to dismiss. Reuses the existing AI stream event listeners (`claude:stream-delta` etc.) so when Phase 2 wires up real AI, this sheet streams responses automatically.
- **Glass blur reduced**: `--glass-blur: 16px` on mobile (down from desktop 24px); at ≤400px it drops further to 14px. Mobile GPUs are weaker and there's less overlap to "peer through" on a phone.
- **Bottom-nav self-gates**: `BottomNav.init()` + `BloomSheet` no-op above 768px, so they're safe to load unconditionally.

### Theme engine preserved

All colors in `mobile.css` go through `--accent-*-rgb` CSS vars. Theme switching applies to the bottom nav, FAB, and sheet automatically — same engine as desktop (`theme-engine.js`).

### Toolchain self-containment

`tools/` has a complete JDK 17 (Adoptium Temurin) + Android SDK 34 + platform-tools. Not checked into git (see `.gitignore`). Gradle picks these up via:

- `android/gradle.properties`: `org.gradle.java.home=C:/Projects/BloomAPK/tools/jdk-17.0.18+8`
- `android/local.properties`: `sdk.dir=C:/Projects/BloomAPK/tools/android-sdk`

**Always forward slashes in these paths on Windows.** Backslashes get interpreted as escape sequences and Gradle dies with "The filename, directory name, or volume label syntax is incorrect."

If someone clones this repo fresh, they'll need to re-download the toolchain:
```bash
mkdir -p tools
cd tools
# JDK 17:
curl -L -o jdk17.zip "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"
unzip -q jdk17.zip && rm jdk17.zip
# Android command-line tools:
curl -L -o cmdline-tools.zip "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
mkdir -p android-sdk/cmdline-tools
unzip -q cmdline-tools.zip -d android-sdk/cmdline-tools
mv android-sdk/cmdline-tools/cmdline-tools android-sdk/cmdline-tools/latest
rm cmdline-tools.zip
# Accept licenses + install platforms/build-tools:
source ../env.sh
yes | sdkmanager.bat --licenses
sdkmanager.bat "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

Consider scripting this into `tools/setup.sh` next session.

## Capacitor 6 — why not 7

Capacitor 7 requires Node 22+. The user is on Node 18 (v18.15.0 specifically). Don't upgrade Capacitor without first confirming the Node environment — v7 hard-fails at CLI startup with `[fatal] The Capacitor CLI requires NodeJS >=22.0.0`.

If Node is ever upgraded, `npm upgrade @capacitor/*` + `npx cap sync` handles the migration.

## Asset paths

The Electron renderer lived at `src/renderer/index.html` with `assets/` two levels up. In Capacitor, both are inside `www/`, so `../../assets/` was rewritten to `assets/` by a one-time script at project setup.

**When copying new files from the desktop repo**: remember that `../../assets/` paths need fixing. Use this regex: `../../assets/` → `assets/`.

## Plugin quick-reference (Capacitor 6)

Installed:
- `@capacitor/core` — base runtime
- `@capacitor/android` — Android platform
- `@capacitor/app` — lifecycle events (backButton!)
- `@capacitor/browser` — `openExternal` replacement
- `@capacitor/filesystem` — for Phase 4 study-store port
- `@capacitor/haptics` — grade taps / card flip feedback
- `@capacitor/keyboard` — virtual keyboard handling (already in capacitor.config.json)
- `@capacitor/preferences` — key-value store, currently backs `electronAPI.store.*`
- `@capacitor/status-bar` — status bar color + style

NOT yet installed but needed for later phases:
- `@capacitor-community/http` OR native fetch — streaming AI responses (Phase 2)
- `@capacitor-community/google-sign-in` OR `@codetrix-studio/capacitor-google-auth` — Google OAuth (Phase 3)
- `@capacitor/local-notifications` — Pomodoro alerts (Phase 2 / 4)
- `@capacitor/live-updates` — OTA web-asset updates (Phase 5 nice-to-have)

## Things to watch out for

### Android back button
Currently unhandled → every tap closes the app. Should hook `App.addListener('backButton', ...)` to navigate the SPA instead. Probably: close overlays first, then `Router.goBack()`, then exit if at root Home. Add in `www/js/app.js`.

### `POST_NOTIFICATIONS` runtime prompt
Declared in `AndroidManifest.xml` but never requested at runtime — on Android 13+ this means Pomodoro notifications silently fail. When wiring up notifications (Phase 2/4), request the permission first: `LocalNotifications.requestPermissions()`.

### StatusBar color vs theme
Hardcoded to `#0f050a` in `capacitor.config.json`. When a user switches to a light theme, the status bar looks wrong. Theme engine should emit `StatusBar.setBackgroundColor({ color })` whenever the palette changes.

### `INSTALL_FAILED_UPDATE_INCOMPATIBLE`
Happens when re-installing a debug build over an older debug build from a different keystore (e.g. if someone else built on their machine). Fix: `adb uninstall com.bloom.app` then retry.

### `android:exported` and deep links
When Phase 3 adds Google OAuth, the redirect intent-filter MUST have `android:exported="true"` (Android 12+ requirement). The MainActivity already has it; any new Activity for OAuth handoff will need the same.

### Never commit `tools/`, `*.keystore`, `local.properties`
The `.gitignore` already covers these. Don't remove those lines.

## What Phase 1 explicitly does NOT try to do

These were deferred because they need things only the user can provide:

- **Google OAuth client ID** — needs the user's Google Cloud Console. Documented in `HANDOFF.md` with exact keytool command to get the SHA-1.
- **Release keystore** — user generates, backs up. `./gradlew assembleRelease` will fail until this exists.
- **Physical device smoke test** — build succeeded but no one has yet verified the APK launches on a real phone.
- **AI provider wiring** — keys can't be stored securely without a native Keystore plugin. Bridge stubs return "coming soon".

## When to edit here vs the desktop repo

| Change kind | Edit in desktop (`AllDash`) | Edit in mobile (`BloomAPK`) |
|---|---|---|
| Renderer view / component shared between platforms | ✅ edit in `src/renderer/` then re-copy to `bloom-app/www/` (manual until we have a sync script) | ❌ don't drift |
| Electron main-process service | ✅ edit in `src/main/services/` | bridge stub may need update in `capacitor-bridge.js` |
| Mobile-only layout (bottom nav, sheet, safe area) | ❌ leave desktop alone | ✅ edit `www/styles/mobile.css` or `www/js/components/bottom-nav.js` / `bloom-sheet.js` |
| Theme / CSS vars | ✅ edit in desktop `variables.css` then copy | shared file, keep in sync |
| Android manifest / plugin config | ❌ N/A | ✅ `android/app/src/main/AndroidManifest.xml` + `capacitor.config.json` |

**Sync workflow (until automated)**: when you change `src/renderer/*` in the desktop repo, re-run:
```bash
cp -r "C:/Projects/AllDash/src/renderer/"* "C:/Projects/BloomAPK/bloom-app/www/"
cp -r "C:/Projects/AllDash/assets" "C:/Projects/BloomAPK/bloom-app/www/assets"
# Re-fix asset paths (view files may have them):
cd "C:/Projects/BloomAPK/bloom-app"
node -e "/* rewrite ../../assets/ to assets/ in www/**/*.{html,css,js} */"
# Then:
npx cap sync android
```

Consider a `tools/sync-from-desktop.sh` script next session.

## GitHub release workflow

```bash
# Build fresh:
source env.sh
cd bloom-app && npx cap sync android
cd android && ./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk ../../dist/Bloom-debug.apk

# Create release (adjust version):
cd ../..
gh release create v0.X.Y-phaseN dist/Bloom-debug.apk \
  --title "v0.X.Y — Phase N: <what landed>" \
  --prerelease \
  --notes "..."
```

Pre-release flag stays on until Phase 5 (release-signed APK suitable for Play Store internal testing).
