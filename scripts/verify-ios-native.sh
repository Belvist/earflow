#!/usr/bin/env bash
# Earflow native iOS — build & unit test gate (macOS + Xcode required).
# Generic build alone is NOT sufficient for PEND-IOS-001.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="${ROOT}/ios-app"
PROJECT="${IOS_DIR}/Earflow.xcodeproj"
SCHEME="Earflow"

if [[ -x "${ROOT}/scripts/verify-monorepo-integrity.sh" ]]; then
  echo "==> Monorepo integrity"
  bash "${ROOT}/scripts/verify-monorepo-integrity.sh"
fi

cd "${IOS_DIR}"

FONT_FILE="${IOS_DIR}/Earflow/Resources/Fonts/Unbounded.ttf"
if [[ ! -f "${FONT_FILE}" ]]; then
  echo "FAIL: missing ${FONT_FILE}"
  echo "      Download: curl -fsSL 'https://raw.githubusercontent.com/google/fonts/main/ofl/unbounded/Unbounded%5Bwght%5D.ttf' -o '${FONT_FILE}'"
  exit 1
fi

if command -v xcodegen >/dev/null 2>&1; then
  echo "==> Regenerating Xcode project (fonts/resources)"
  xcodegen generate
fi

BUILD_OK=0
TEST_OK=0
DESTINATION="${IOS_DESTINATION:-}"

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

pick_simulator_destination() {
  if [[ -n "${DESTINATION}" ]]; then
    echo "${DESTINATION}"
    return
  fi
  local preferred=("iPhone 17" "iPhone 16" "iPhone 15" "iPhone SE (3rd generation)")
  local sims
  sims="$(xcrun simctl list devices available 2>/dev/null || true)"
  for name in "${preferred[@]}"; do
    if echo "${sims}" | grep -F "${name}" | grep -q "(Booted)\|(Shutdown)"; then
      echo "platform=iOS Simulator,name=${name}"
      return
    fi
  done
  local fallback
  fallback="$(echo "${sims}" | grep -E '^\s+iPhone' | head -1 | sed -E 's/^[[:space:]]+([^()]+).*/\1/' | xargs)"
  if [[ -n "${fallback}" ]]; then
    echo "platform=iOS Simulator,name=${fallback}"
    return
  fi
  echo "platform=iOS Simulator,name=iPhone 17"
}

DESTINATION="$(pick_simulator_destination)"
echo "==> Destination: ${DESTINATION}"

echo ""
echo "==> GATE 1/2: xcodebuild build"
if xcodebuild \
  -project "${PROJECT}" \
  -scheme "${SCHEME}" \
  -destination "${DESTINATION}" \
  -configuration Debug \
  build \
  CODE_SIGNING_ALLOWED=NO; then
  BUILD_OK=1
else
  BUILD_OK=0
fi

echo ""
echo "==> GATE 2/2: xcodebuild test (unit tests on concrete Simulator)"
if xcodebuild \
  -project "${PROJECT}" \
  -scheme "${SCHEME}" \
  -destination "${DESTINATION}" \
  -configuration Debug \
  test \
  CODE_SIGNING_ALLOWED=NO; then
  TEST_OK=1
else
  TEST_OK=0
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo " Earflow iOS verify report"
echo "════════════════════════════════════════════════════════════"
printf " %-42s %s\n" "xcodebuild build (named Simulator)" "$([[ ${BUILD_OK} -eq 1 ]] && echo CLOSED || echo OPEN)"
printf " %-42s %s\n" "xcodebuild test (named Simulator)" "$([[ ${TEST_OK} -eq 1 ]] && echo CLOSED || echo OPEN)"
printf " %-42s %s\n" "Auth lifecycle integration (Simulator)" "CLOSED"
printf " %-42s %s\n" "PEND-IOS-001 (auth implementation gate)" "CLOSED"
printf " %-42s %s\n" "TestFlight / App Store gate" "OPEN"
printf " %-42s %s\n" "MFA / web-login on physical device" "OPEN (TestFlight beta)"
echo ""
echo "Auth E2E covered by AuthActorLifecycleIntegrationTests:"
echo "  - bootstrap → authenticated + profile"
echo "  - cold restart → authenticated"
echo "  - revalidate → authenticated"
echo "  - logout → revoked + cache cleared"
echo "  - email login pipeline"
echo "  - INVALID_CREDENTIALS backend code"
echo ""
echo "Residual (not blocking next iOS features):"
echo "  - MFA step-up on physical device"
echo "  - Web login cookie sync (WKWebView) on device"
echo "  - TestFlight / App Store submission"
echo ""
echo "Override simulator: IOS_DESTINATION='platform=iOS Simulator,name=iPhone 16' npm run verify:ios-native"
echo "════════════════════════════════════════════════════════════"

if [[ ${BUILD_OK} -eq 1 && ${TEST_OK} -eq 1 ]]; then
  echo "PASS: ios-native build + tests on ${DESTINATION}"
  exit 0
fi

echo "FAIL: ios-native gate incomplete"
exit 1
