# BloomAPK

Android port of [Bloom](https://github.com/juandiaz5673/Bloom) — a personal productivity dashboard originally built as a Windows Electron app. This repo is Phase 1: a sideloadable APK that renders the full Bloom UI on Android while backend services (Google auth, AI providers, Drive, etc.) are stubbed for later phases.

## Status

| Phase | What works | Status |
|---|---|---|
| **1** | UI renders, navigation, theming, settings shell, mobile-adapted layout (bottom nav + Bloom bottom-sheet) | ✅ this repo |
| **2** | Secure storage + AI providers (Claude / Gemini / OpenRouter) via Capacitor HTTP plugin | planned |
| **3** | Google OAuth + Calendar + Drive + Notes | planned |
| **4** | Study-store persistence (Capacitor Filesystem) + Drive sync | planned |
| **5** | Signed release APK + Play Store internal testing track | planned |

See [`HANDOFF.md`](./HANDOFF.md) for the exact cutline of what's stubbed vs implemented.

## Install (sideload)

1. Grab the APK from `dist/Bloom-debug.apk` (or build your own — see below).
2. On your Android device: Settings → Security → **Install unknown apps** → allow for your file manager / browser.
3. Transfer `Bloom-debug.apk` to the device and tap to install.
4. First launch: the app will show the Bloom UI. Settings flows will say "coming soon to mobile" where backend isn't wired up yet — expected.

Debug APKs are self-signed with the default Android debug key, so Play Protect may warn on install. That's normal for sideloaded dev builds.

## Build locally

### First-time setup

The project bundles its own JDK 17 + Android SDK under `tools/` so you don't need a system install. Just Node 18+.

```bash
# From the repo root:
source env.sh                  # points JAVA_HOME + ANDROID_HOME at bundled tools
cd bloom-app
npm install
npx cap sync android           # copies www/ into android/app/src/main/assets/public
```

### Build APK

```bash
cd bloom-app/android
./gradlew assembleDebug
# Output: bloom-app/android/app/build/outputs/apk/debug/app-debug.apk
```

### Re-run after UI changes

```bash
cd bloom-app
npx cap sync android
cd android && ./gradlew assembleDebug
```

No need to nuke `node_modules` or re-add the Android platform between edits — `cap sync` is idempotent.

## Project layout

```
BloomAPK/
├── bloom-app/                 Capacitor project root
│   ├── www/                   Web assets (copied from Bloom's src/renderer/)
│   │   ├── index.html
│   │   ├── js/
│   │   │   ├── capacitor-bridge.js    ← stubs window.electronAPI for Android
│   │   │   ├── components/
│   │   │   │   ├── bottom-nav.js      ← mobile 4-tab + FAB nav
│   │   │   │   └── bloom-sheet.js     ← mobile bottom-sheet chat
│   │   │   └── views/ components/ ... (unchanged from Bloom)
│   │   ├── styles/
│   │   │   └── mobile.css             ← @media (max-width: 768px) overrides
│   │   └── assets/            Fonts, icons, images, backgrounds (unchanged)
│   ├── android/               Native Android project — edit manifest here
│   ├── resources/             Icon source used by @capacitor/assets
│   └── capacitor.config.json  Capacitor + plugin config
├── tools/                     Self-contained JDK 17 + Android SDK (gitignored)
├── dist/                      Built APKs (gitignored — only sample APK committed)
├── env.sh                     Source this before building
└── HANDOFF.md                 Cutline + next-session tasks
```

## Architecture notes

### The bridge pattern

The Bloom renderer was built against Electron's `window.electronAPI` — ~50 IPC methods talking to the Node main process. Rewriting every view for Capacitor would take weeks.

Instead, `www/js/capacitor-bridge.js` stubs the *entire* `electronAPI` surface with async no-ops: `listDecks` returns `[]`, `generateGreeting` returns `null` (the renderer already has a fallback greeting), `streamChat` shows a friendly "coming soon" toast, etc. The UI boots cleanly and flows that need a backend fail gracefully.

Porting a feature to mobile is then a matter of replacing that one bridge method with a real Capacitor plugin call — **no view code changes required**.

### Mobile UI adaptations

- **Below 768px**: desktop sidebar hidden, bottom nav + Bloom FAB appear, cards stack vertically, glass blur drops from 24→16px for mobile GPU budget.
- **Above 768px**: original desktop layout untouched. Useful for tablets in landscape.
- **Bloom FAB + bottom-sheet**: replaces the desktop ambient chat sidebar. Tap FAB → sheet rises from the bottom. Drag handle up for full-screen, tap backdrop to dismiss.
- Theme engine works unchanged — mobile.css uses the same `--accent-*-rgb` CSS vars, so theme switching applies to the bottom nav + FAB + sheet automatically.

### Toolchain self-containment

`tools/` has a complete JDK 17 (Adoptium Temurin) + Android SDK 34 + platform-tools. No system-wide installs required. Gradle picks these up via `org.gradle.java.home` in `gradle.properties` and `sdk.dir` in `local.properties`.

## Known limitations (Phase 1)

- **No AI responses** — Claude/Gemini/OpenRouter keys can't be stored securely on Android without a native Keystore plugin (phase 2).
- **No Google account sign-in** — requires a new Android OAuth client ID in Google Cloud Console (phase 3).
- **No persistence of notes/decks/conversations** — needs Capacitor Filesystem port (phase 4).
- **In-app Drive file preview** — not planned for mobile. Will open in external browser via Capacitor Browser plugin (phase 3).
- **Debug-signed only** — Play Protect warning on install. Release signing lives in phase 5.

See `HANDOFF.md` for the full backlog.

## License

MIT — same as parent Bloom project.
