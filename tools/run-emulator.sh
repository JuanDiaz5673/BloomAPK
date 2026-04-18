#!/usr/bin/env bash
# Boot the bloom_pixel AVD in the background and wait until it's ready.
# Run from repo root after `source env.sh`:
#   bash tools/run-emulator.sh

set -euo pipefail

if [[ -z "${ANDROID_HOME:-}" ]]; then
  echo "ERROR: ANDROID_HOME not set. Run \`source env.sh\` first." >&2
  exit 1
fi

EMULATOR="$ANDROID_HOME/emulator/emulator.exe"
ADB="$ANDROID_HOME/platform-tools/adb.exe"
AVD_NAME="bloom_pixel"

if "$ADB" devices | grep -qE "emulator-[0-9]+\s+device"; then
  echo "Emulator already running."
  exit 0
fi

if ! "$EMULATOR" -list-avds | grep -q "^$AVD_NAME$"; then
  echo "ERROR: AVD '$AVD_NAME' not found. Run tools/setup-emulator.sh first." >&2
  exit 1
fi

echo "==> Booting emulator '$AVD_NAME'..."
"$EMULATOR" -avd "$AVD_NAME" -gpu host -no-snapshot-save -no-boot-anim > /dev/null 2>&1 &

echo "==> Waiting for device..."
"$ADB" wait-for-device

echo "==> Waiting for boot complete..."
until [[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; do
  sleep 2
done

echo "Emulator ready."
