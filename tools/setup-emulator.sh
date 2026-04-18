#!/usr/bin/env bash
# One-time setup: install Android emulator + a system image, then create an AVD.
# Run from repo root after `source env.sh`:
#   bash tools/setup-emulator.sh
#
# Downloads ~1.5 GB. Safe to re-run; sdkmanager/avdmanager are idempotent.

set -euo pipefail

if [[ -z "${ANDROID_HOME:-}" ]]; then
  echo "ERROR: ANDROID_HOME not set. Run \`source env.sh\` first." >&2
  exit 1
fi

SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager.bat"
AVDMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager.bat"
SYSTEM_IMAGE="system-images;android-34;google_apis;x86_64"
AVD_NAME="bloom_pixel"
DEVICE_PROFILE="pixel_6"

echo "==> Accepting licenses..."
yes | "$SDKMANAGER" --licenses > /dev/null || true

echo "==> Installing emulator + system image (this can take a few minutes, ~1.5 GB)..."
"$SDKMANAGER" "emulator" "platform-tools" "$SYSTEM_IMAGE"

echo "==> Creating AVD '$AVD_NAME' (Pixel 6, Android 34)..."
if "$AVDMANAGER" list avd | grep -q "Name: $AVD_NAME"; then
  echo "    AVD already exists, skipping."
else
  echo "no" | "$AVDMANAGER" create avd \
    --name "$AVD_NAME" \
    --package "$SYSTEM_IMAGE" \
    --device "$DEVICE_PROFILE" \
    --force
fi

AVD_CONFIG="$HOME/.android/avd/$AVD_NAME.avd/config.ini"
if [[ -f "$AVD_CONFIG" ]]; then
  echo "==> Tuning AVD config (hw.keyboard=yes)..."
  if ! grep -q "^hw.keyboard=yes" "$AVD_CONFIG"; then
    echo "hw.keyboard=yes" >> "$AVD_CONFIG"
  fi
fi

echo ""
echo "Done. Start the emulator with:  bash tools/run-emulator.sh"
echo "Or build + install + launch in one shot:  cd bloom-app && npm run android:dev"
