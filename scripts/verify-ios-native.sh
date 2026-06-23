#!/usr/bin/env bash
# Earflow native iOS — build & unit test gate (macOS + Xcode required).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="${ROOT}/ios-app"
PROJECT="${IOS_DIR}/Earflow.xcodeproj"
SCHEME="Earflow"
DESTINATION="${IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 17}"

cd "${IOS_DIR}"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "FAIL: xcodebuild not found. Install Xcode on macOS."
  exit 1
fi

if [[ ! -d "${PROJECT}" ]]; then
  if command -v xcodegen >/dev/null 2>&1; then
    echo "==> Generating Xcode project via XcodeGen"
    xcodegen generate
  else
    echo "FAIL: ${PROJECT} missing. Install XcodeGen: brew install xcodegen"
    echo "      Then: cd ios-app && xcodegen generate"
    exit 1
  fi
fi

echo "==> xcodebuild build (${DESTINATION})"
xcodebuild \
  -project "${PROJECT}" \
  -scheme "${SCHEME}" \
  -destination "${DESTINATION}" \
  -configuration Debug \
  build \
  CODE_SIGNING_ALLOWED=NO

echo "==> xcodebuild test (${DESTINATION})"
xcodebuild \
  -project "${PROJECT}" \
  -scheme "${SCHEME}" \
  -destination "${DESTINATION}" \
  -configuration Debug \
  test \
  CODE_SIGNING_ALLOWED=NO

echo "PASS: ios-native build + tests"
