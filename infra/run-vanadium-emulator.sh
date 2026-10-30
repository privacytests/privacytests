#!/bin/bash
# Install Vanadium in the running emulator and run the privacy tests.
# Invoked from GitHub Actions (see .github/workflows/vanadium-emulator.yml).

set -euo pipefail

RESULT_FILE="${RESULT_FILE:-android-vanadium-1}"
APK_PATH="${RUNNER_TEMP:-/tmp}/vanadium.apk"

capture_failure() {
  adb exec-out screencap -p >../failure.png || true
}
trap capture_failure ERR

bash ../infra/ensure-appium.sh
node fetch-vanadium-apk --out="$APK_PATH"
adb install "$APK_PATH"
node test --android --browser=vanadium --out="../${RESULT_FILE}.json"
