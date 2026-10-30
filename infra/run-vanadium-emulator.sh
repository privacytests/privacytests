#!/bin/bash
# Install Vanadium in the running emulator and run the privacy tests.
# Invoked from GitHub Actions (see .github/workflows/vanadium-emulator.yml).

set -euo pipefail

APK_DIR="${RUNNER_TEMP:-/tmp}/vanadium"

capture_failure() {
  adb exec-out screencap -p >../failure.png || true
}
trap capture_failure ERR

bash ../infra/ensure-appium.sh
node fetch-vanadium-apk --out-dir="$APK_DIR"
adb install "$APK_DIR/app.vanadium.config.apk"
adb install "$APK_DIR/app.vanadium.browser.apk"
adb shell pm list packages app.vanadium

ANDROID_VERSION="$(adb shell getprop ro.build.version.release | tr -d '\r')"
CONFIG_VERSION="$(adb shell dumpsys package app.vanadium.config | grep -m1 versionName | cut -d= -f2 | tr -d '\r')"
ENVIRONMENT_DETAILS="Tested in an x86_64 emulator with stock Android ${ANDROID_VERSION} and the Vanadium config app ${CONFIG_VERSION}. This is not GrapheneOS and not a real phone, so results may differ from real Vanadium."

node test --android --browser=vanadium --out="../${RESULT_FILE}.json" \
  --environment=emulator --environment-details="$ENVIRONMENT_DETAILS"
