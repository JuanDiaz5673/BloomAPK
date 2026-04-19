# CLAUDE.md — BloomAPK

Guidance for Claude Code when working on the Android port of Bloom.

## Where we are

Capacitor 6 port of the desktop Bloom app (Electron → Android APK). We are **past Phase 1 (UI-only scaffold)** and **through most of Phase 3 + Phase 4**. The app currently has working Google sign-in, Calendar, Notes, Drive, Flashcard sync, AI chat, and a mobile-first responsive UI.

- **Parent desktop project**: `C:\Projects\AllDash` — source of truth for renderer views + services
- **This repo**: `C:\Projects\BloomAPK` — public at https://github.com/JuanDiaz5673/BloomAPK
- **Active release**: `v0.3.0-phase3` (prerelease, debug APK attached to each commit via `gh release upload … --clobber`)
- **Default branch**: `master`

If you're a fresh Claude picking this up: read the whole doc (it's short) then `git log --oneline -15` to see what was just touched. The “Gotchas we hit” section below is where the hard-won knowledge lives.

## Build commands

Self-contained toolchain under `tools/` — no system JDK / Android SDK required.

```bash
# Source env vars every new shell. Sets JAVA_HOME to bundled JDK 17
# + ANDROID_HOME to bundled SDK 34, prepended to PATH.
source env.sh

# After editing anything under bloom-app/www/, re-sync before building:
cd bloom-app && npx cap sync android

# Build debug APK:
cd android && ./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk

# Copy + install (uses bundled adb, not the one on PATH):
cp app/build/outputs/apk/debug/app-debug.apk ../../dist/Bloom-debug.apk
cd ../.. && ./tools/android-sdk/platform-tools/adb.exe install -r dist/Bloom-debug.apk
```

System `adb` isn't always on PATH on Git Bash — use the bundled one at `./tools/android-sdk/platform-tools/adb.exe`. `source env.sh` *should* put it on PATH but a subshell in `cd …` can lose it; the explicit path always works.

### Reinstall troubleshooting

`INSTALL_FAILED_UPDATE_INCOMPATIBLE` → debug keystore mismatch. Fix: `adb uninstall com.bloom.app`, retry. This happens if you build on a different machine or if Gradle regenerates the debug keystore.

## Architecture

### Bridge pattern — `www/js/capacitor-bridge.js`

This is the most important file. The renderer was written against Electron's `window.electronAPI` (~50 methods). The bridge exposes the same object on Android, shimming each call into a Capacitor plugin, a mobile-only service module, or a stub.

**Rule when porting a backend feature**: write a mobile-only module in `www/js/mobile/<feature>.js` that exports `window._bloomX = {…}`, then point the matching `electronAPI.x.*` bridge method at it. **Zero view code changes** — views keep calling `window.electronAPI.foo.bar()`.

Think of the bridge as the "Android half" of the IPC contract that the Electron preload is the "desktop half" of.

### Current wiring status per namespace

| Namespace | Backing | Status |
|---|---|---|
| `electronAPI.store.*` | Capacitor Preferences (in-memory cache hydrated async via `window._storeReady`) | ✅ get/set/delete + secure-variants. Key allowlist regex validates every verb. |
| `electronAPI.app.*` | Capacitor App + Browser plugins | ✅ openExternal, quit, lifecycle |
| `electronAPI.ai.*` | `www/js/mobile/ai-providers.js` | ✅ streamChat for Claude/Gemini/OpenRouter. Stores conversations in an in-memory Map, persists in Preferences. Emits `claude:stream-delta/done/error`. Dispatches `bloom:conversations-changed` on every `_appendConvo`. |
| `electronAPI.claude.*` | Shares AI conversation store | ✅ listConversations / getConversation / deleteConversation. Emits `messageCount` alongside the raw convo object. |
| `electronAPI.google.*` | `www/js/mobile/google-auth.js` + `google-calendar.js` | ✅ full surface. PKCE browser OAuth (see OAuth section below). Calendar list/get/create/update/delete/getUpcoming. signIn dispatches `bloom:google-connected`, signOut dispatches `bloom:google-disconnected`. onCalendarChanged aliased under both `google.*` and `calendar.*` namespaces. |
| `electronAPI.notes.*` | `www/js/mobile/google-notes.js` | ✅ list/get/create/update/delete + createFolder/deleteFolder/getRootId/getRecent. Supports TipTap JSON envelope format (matches desktop). `deleteNote(id, {cascadeChildren})` walks the sub-page tree. |
| `electronAPI.drive.*` | `www/js/mobile/google-drive.js` | ✅ listFiles/searchFiles/createFolder/deleteFile/getDataUri/openFile/uploadFile. Upload uses a hidden `<input type="file" multiple>` + multipart POST to `upload.googleapis.com` with a 100 MB cap. Aliased: `getDataUri`/`getFileAsDataUri` + `open`/`openFile`. |
| `electronAPI.study.*` | `www/js/mobile/study-store.js` (Capacitor Filesystem) + `study-sync.js` (Drive pull/push) | ✅ CRUD + sync. Debounced 4s push per mutation; pull on sign-in, mount, and every 5 min. Status broadcast via `bloom:study-sync-status`. Mutation hook (`onMutate`) for anything that wants to react. |
| `electronAPI.theme.*` | Bridge serves `/assets/images/backgrounds/<file>` URLs | ✅ presets render; theme-engine applies palette via `ThemeEngine.applyPreset(key)` (note: key, NOT filename — this was a bug). |
| `electronAPI.recent.*` | Stubs (asyncOk) | 🟡 track/forget/add/clear no-op. Files view calls them; no UX impact beyond the Home "Recent Files" tile being empty-until-you-browse. |
| `electronAPI.files.*` | N/A on Android | 🟡 local FS stubs return empty. Drive is the "file system" on mobile — see `drive.*`. |
| `electronAPI.analytics.*` | Console log | 🟡 placeholder. |

**Event bus** (always dispatched on `window`, all CustomEvent-based):

- `bloom:google-connected` — tokens persisted, profile fetched. Listened by: home, header, study-sync, notes listeners.
- `bloom:google-disconnected` — tokens cleared. Listened by: home, header, study-sync.
- `bloom:conversations-changed` — chat message appended. Listened by: home "Recent Conversations" card.
- `bloom:decks-changed` — study-sync pulled a deck. Listened by: study view, home "Recent Flashcards" card.
- `bloom:study-sync-status` — { state, lastSyncAt, pendingCount, authed } transitions. Bridge routes study.onSyncStatus to this.
- `bloom:calendar-changed` — reserved for AI-tool event mutations. Listened by: calendar view.

### Mobile UI + responsive design

Three breakpoint tiers + `clamp()` fluid type for major headings. All inside `www/styles/mobile.css`:

1. **≤ 768px** — baseline mobile. Bottom-nav, glass-card full-width, single-column grids.
2. **≤ 400px** — iPhone SE / Pixel 4a tier. Tighter setup-wizard padding, 2-col theme grid, calendar title ellipsifies, notes toolbar buttons ≥ 40×40, Bloom-sheet grab-handle hit zone 4 → 32px.
3. **≤ 360px** — budget Android / Galaxy mini. Reduced glass-blur (GPU), narrower nav labels, stat pills smaller, settings input-groups stack vertically.
4. **@media (max-height: 600px) and (orientation: landscape)** — split-screen + phone landscape. Hero icons hide, mascot min-height drops.

Verify changes across sizes with `adb shell wm size <W>x<H>` + `wm density <dpi>` and `wm size reset` afterward. See 0061663 for the audit + plan writeup.

### Mobile-only views / components

- **Bottom nav** (`www/js/components/bottom-nav.js`) — 4 tabs (Home / Study / Calendar / Notes) + centered raised Bloom FAB. Self-gates above 768px.
- **Bloom bottom-sheet** (`www/js/components/bloom-sheet.js`) — replaces desktop sidebar ambient panel. Drag-to-expand (55vh default → 92vh). In-memory `_history` keyed to `window._activeConversationId` — rebinds on convo change. Error path pops the user turn to keep Claude's strict alternation.
- **Setup wizard** (`www/js/components/setup-wizard.js`) — Google → AI key → theme. Skips entirely if `google.getStatus()` is already authenticated (marks `hasCompletedSetup=true` on the spot). Theme `data-preset` must be the `PRESETS` **key** (`flowers`), not the filename.
- **Pomo-pill** (`www/js/components/pomo-pill.js`) — see "New features (mobile-only)" below.

## New features (mobile-only, not in desktop Bloom)

These are features added to BloomAPK that have no equivalent in `C:\Projects\AllDash`. When syncing renderer code from desktop, DO NOT overwrite these files.

### Persistent Pomodoro timer + header pill

**Why it exists**: On mobile the user often starts a focus session and then navigates to Notes / Flashcards / Calendar to actually do the work. On desktop the timer lives in a side panel that's always visible; on a phone there's no room for that. The pill + service combo lets the user run a Pomodoro session from anywhere without losing the timer when they swap views.

**Files**:
- **`www/js/mobile/pomodoro-service.js`** — singleton timer state + state-machine. Lives on `window._bloomPomodoro`. Survives view destroy; RAF ticker only runs while status is `'running'`. Emits three CustomEvents on `window`:
  - `bloom:pomodoro-state` — full snapshot `{mode, status, remainingMs, durationMs, cycleInSequence, prefs}` on start/pause/reset/mode-transition.
  - `bloom:pomodoro-tick` — `{remainingMs, durationMs, mode}` ~4x/sec while running.
  - `bloom:pomodoro-complete` — `{completedMode, nextMode}` when an interval ends.
  - Service also handles the chime + OS Notification + `logSession` itself so those fire regardless of which view is mounted.
  - API: `start(mode?)`, `pause()`, `reset()`, `setMode(mode)` (idle only), `getState()`, `isActive()`.
  - Prefs hydrate from `study.getPrefs()` at module load + on `bloom:stats-changed` event (so Drive-synced daily-goal changes propagate).

- **`www/js/components/pomo-pill.js`** — the header mini-timer pill. DOM-injects a `<button class="pomo-pill">` between `.header-left` and `.header-right`. Shows MM:SS + a mode-colored pulsing dot (pink for focus, warm for break). Hidden when timer is idle OR when on home view (per UX rule). Tap → sets `sessionStorage['study.pendingSubView'] = 'pomodoro'` and navigates to Study; Study view picks this up on init and opens the Pomodoro subview directly.

- **CSS**: `www/styles/header.css` has the desktop/tablet pill styles; `www/styles/mobile.css` (inside the `:360` block) tightens sizing for Galaxy-mini phones.

**Study view is now a thin consumer**:
- All `_timerMode / _timerStatus / _timerEndTs / _cycleInSequence` etc. state is GONE from `www/js/views/study.js`. The view reads everything from `_svc().getState()` and subscribes to `bloom:pomodoro-state` / `bloom:pomodoro-tick` / `bloom:pomodoro-complete` for re-render triggers.
- `destroy()` intentionally does **not** stop the ticker — that's the whole point of the service.

**Gotcha to remember**: if you ever need to change the tick cadence or the mode-transition rules, do it in `pomodoro-service.js`. Don't re-introduce local timer state in views.

## Gotchas we hit and the fixes

These ate real time. Future Claudes: read before you debug.

### OAuth Desktop client + reverse-client-id URI scheme

The user's existing OAuth client is a **Desktop** type (not Web — the page header in Cloud Console literally says "Client ID for Desktop"). Desktop clients use a Google-defined custom URI scheme of the form:

```
com.googleusercontent.apps.<reversed-client-id>:/oauth/callback
```

This scheme is registered in `AndroidManifest.xml` as an intent-filter on `MainActivity`. The intent-filter's `android:scheme` must match the reversed client ID exactly. Current value: `com.googleusercontent.apps.527904723284-b79etfju8a8mfdv50rft7gvqiniu373v`.

- `com.bloom.app://` or any other custom scheme → Google returns `Error 400: invalid_request` because Web clients don't allow custom schemes and Desktop clients only allow this specific format.
- PKCE alone isn't enough — Google requires the client_secret for Desktop token exchange. Per Google's installed-app docs, the secret is **not** a security boundary for native apps (PKCE is) and is safe to embed. It's hardcoded in `google-auth.js` as `DEFAULT_CLIENT_SECRET`. Users can still override via Settings → Advanced.
- Full scope `https://www.googleapis.com/auth/drive` (not `drive.file`) — matches desktop and lets the Files view list arbitrary user folders. It's a restricted scope; the user must be on the consent screen's test-user list.
- The secret triggered GitHub secret-scanning push protection. Bypass URL was approved once; future rotation would require re-approval.

### Capacitor Filesystem enum values are UPPERCASE

**Bug**: `directory: 'Data'` → `Directory.valueOf("Data")` fails silently on Android → null File → `File.exists()` / `File.mkdirs()` → NPE on the CapacitorPlugins HandlerThread → **hard app crash** (JS try/catch can't catch native thread exceptions).

**Fix**: always pass the enum VALUE (`'DATA'`, `'DOCUMENTS'`, `'CACHE'`, `'EXTERNAL'`), not the TypeScript key. This single bug was the root cause of BOTH the Study tab crash AND flashcards not syncing (the sync pull's first step is mkdir).

### Cold-start race: `window._storeReady`

The bridge hydrates Capacitor Preferences into `_memory` (in-memory Map) asynchronously. If any consumer reads the store BEFORE that hydration completes, they see an empty map and decide "unauthed" / "no profile". Exposed promise: `window._storeReady`. Always `await` it before auth-gated reads on cold start.

Currently awaited by: `study-sync.start()`, `header.updateWithProfile()`, `header.restoreCachedAvatar()`.

If you add another cold-start reader, await it or you'll get intermittent "profile picture missing" / "not authenticated" bugs.

### Play Services / Credential Manager — avoid

We tried two native-sign-in plugins and both failed on the emulator's older Play Services:

- `@codetrix-studio/capacitor-google-auth` — returns code 10 (DEVELOPER_ERROR) for any OAuth client created after mid-2024. Abandoned.
- `@capgo/capacitor-social-login` — uses Credential Manager (GetSignInWithGoogleOption). Returns `NoCredentialException` on emulators with Play Services <24.x. Abandoned.

The current approach (Chrome Custom Tab + PKCE) works on any Android version with no Play Services dependency. Don't re-add either plugin unless you have a strong reason.

### View-mount race after Google sign-in

The `bloom:google-connected` event fires reliably, but the home view was sometimes mounted before the event OR its DOM-mutation path conflicted with the wizard's re-render. Fix: `Router.navigate(viewName, { force: true })` re-runs the teardown/render/init cycle on the current view. Called from setup-wizard after sign-in AND in wizard `close()`. Belt-and-suspenders with the event bus.

### AndroidManifest security

- `android:allowBackup="false"` + `@xml/data_extraction_rules` blocks every auto-backup pipeline. OAuth refresh tokens never land in adb backups or the 2GB cloud-backup bucket. Don't flip it back.
- Custom URI intent-filter on MainActivity MUST have `android:exported="true"` (Android 12+). MainActivity already does — new activities added for OAuth handoff need the same.

### Web-only tags that fail on Android

`<webview>` is Electron-specific. Use `<iframe>` for Drive file preview (Google Docs/Sheets/Slides, PDFs). Sandbox attributes: `allow-same-origin allow-scripts allow-popups allow-forms`.

### bloom-sheet `streamChat` signature

Bridge expects `(messages: Array<{role,content}>, conversationId)`. Passing a single `{message, conversationId}` object → provider adapters' `.filter(...)` calls blow up with "messages.filter is not a function". Current bloom-sheet keeps a canonical `_history` array in memory, rebinds on convoId change, and pops the last user turn on error to preserve Claude's strict alternation.

### Android back-button stack

Handlers that return `false` mean "I didn't handle this — fall through." Previously we popped unconditionally, silently dropping those handlers. Current impl in `native-integration.js` peeks + splices only on handled-or-thrown.

## Capacitor 6 — why not 7

Capacitor 7 requires Node 22+. User is on Node 18. v7 hard-fails at CLI startup. If Node is ever upgraded: `npm upgrade @capacitor/*` + `npx cap sync` handles migration.

## Asset paths

Electron renderer was at `src/renderer/index.html` with `assets/` two levels up. In Capacitor both are under `www/` — `../../assets/` was rewritten to `assets/`. When copying new files from the desktop repo, re-apply: `../../assets/` → `assets/`.

## Plugin quick-reference (installed)

- `@capacitor/core` / `@capacitor/android` — base
- `@capacitor/app` — lifecycle + backButton
- `@capacitor/browser` — OAuth Custom Tab + openExternal
- `@capacitor/filesystem` — study-store local cache
- `@capacitor/haptics` — grade taps / card flip feedback
- `@capacitor/keyboard` — virtual keyboard + resize
- `@capacitor/local-notifications` — Pomodoro alerts
- `@capacitor/preferences` — backs `electronAPI.store.*`
- `@capacitor/status-bar` — color + style

Intentionally **not** installed (after trying):
- `@codetrix-studio/capacitor-google-auth` — Play Services plugin, doesn't work
- `@capgo/capacitor-social-login` — Credential Manager, doesn't work on older Play Services

Not yet installed but may want:
- `@capacitor/live-updates` — OTA web-asset updates (Phase 5)

## Things to watch out for

- **Toolchain paths must use forward slashes on Windows.** `android/gradle.properties` `org.gradle.java.home=C:/Projects/BloomAPK/tools/jdk-17.0.18+8`. Backslashes break Gradle silently.
- **`POST_NOTIFICATIONS` on Android 13+** — declared in manifest but needs runtime request before the first `LocalNotifications.schedule`. If Pomodoro alerts silently fail, that's why.
- **StatusBar color vs theme** — hardcoded `#0f050a` in `capacitor.config.json`. When user picks a light theme it looks wrong. Theme-engine should call `StatusBar.setBackgroundColor` on palette change.
- **OAuth scope changes require re-sign-in.** We upgraded `drive.file` → `drive` in commit `b558748`; tokens from before that commit only have `drive.file` and will 403 on arbitrary-folder listing.
- **`git push` may trip secret scanning** on the OAuth client ID/secret in `google-auth.js`. Bypass URLs in the rejection message; follow them once — they're per-commit.
- **Never commit `tools/`, `*.keystore`, `local.properties`.** `.gitignore` covers them.

## Phase 1 deferred items — status today

| Item | Current status |
|---|---|
| Google OAuth client ID | ✅ Desktop client; reverse-id scheme in manifest. Works. |
| Release keystore | ❌ Still deferred. `./gradlew assembleRelease` will fail until generated. |
| Physical device smoke test | 🟡 emulator-verified extensively; no physical-device test yet. |
| AI provider wiring | ✅ Claude, Gemini, OpenRouter. Keys in Preferences (Android-keystore-encrypted). |

## When to edit here vs the desktop repo

| Change kind | Edit in desktop (AllDash) | Edit in mobile (BloomAPK) |
|---|---|---|
| Renderer view / component shared between platforms | ✅ edit in `src/renderer/`, copy to `bloom-app/www/` | ❌ don't drift |
| Electron main-process service | ✅ edit in `src/main/services/` | update the matching bridge stub + mobile service module |
| Mobile-only layout (bottom nav, sheet, safe area, responsive breakpoints) | ❌ leave desktop alone | ✅ edit `www/styles/mobile.css` or the mobile component |
| Theme CSS vars | ✅ edit desktop `variables.css`, copy | shared file |
| Android manifest / plugin config / mobile services | ❌ N/A | ✅ |

**Sync workflow** (manual until automated):
```bash
cp -r "C:/Projects/AllDash/src/renderer/"* "C:/Projects/BloomAPK/bloom-app/www/"
cp -r "C:/Projects/AllDash/assets" "C:/Projects/BloomAPK/bloom-app/www/assets"
# Re-fix asset paths if any new view files came across
# Then:
cd C:/Projects/BloomAPK/bloom-app && npx cap sync android
```

## Release workflow

Every meaningful change gets built, installed on the emulator, and uploaded to the active GitHub release:

```bash
source env.sh
cd bloom-app && npx cap sync android
cd android && ./gradlew assembleDebug
cd ../.. && cp bloom-app/android/app/build/outputs/apk/debug/app-debug.apk dist/Bloom-debug.apk

# Install on running emulator:
./tools/android-sdk/platform-tools/adb.exe install -r dist/Bloom-debug.apk

# Ship:
git add -A && git commit -m "…" && git push origin master
gh release upload v0.3.0-phase3 dist/Bloom-debug.apk --clobber
```

New major phase? Create a new release: `gh release create v0.X.Y-phaseN dist/Bloom-debug.apk --title "…" --prerelease --notes "…"`. Keep `--prerelease` until we have a release-signed AAB for Play Store.

## Resuming in a new session

Checklist for a fresh Claude to get oriented:

1. **Read this doc end-to-end.** (Cheap — it's not long.)
2. `git log --oneline -10` — see the last few commits and their shapes.
3. `git status` — anything uncommitted?
4. `./tools/android-sdk/platform-tools/adb.exe devices` — is the emulator running?
5. If the user is reporting a bug: reproduce on the emulator first. Tail logcat with `adb logcat -d | grep -iE "FATAL|Capacitor/Console|error"`. The bugs are often one of the gotchas above.
6. Before shipping: build + install, then commit → push → `gh release upload … --clobber`. Keep the release fresh so the user can sideload without rebuilding.
7. The user prefers **direct fixes over long investigations**. When you have the root cause, apply it and report back concisely.
