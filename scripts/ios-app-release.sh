#!/usr/bin/env bash
set -euo pipefail

# Local iOS build/release entrypoint.
#
# Commands:
#   doctor       verify Xcode, XcodeGen and simulator/runtime state
#   install-runtime download the matching iOS Simulator Runtime from Apple
#   generate     regenerate the Xcode project from ios-app/project.yml
#   unsigned     build and package an unsigned IPA for Sideloadly/AltStore
#   testflight   archive, sign and upload through App Store Connect API auth
#   release      run unsigned or testflight according to IOS_DISTRIBUTION
#   dispatch     trigger the GitHub Actions workflow (does not push code)
#
# TestFlight requires APPSTORE_KEY_ID, APPSTORE_ISSUER_ID, APPSTORE_P8_PATH,
# and IOS_TEAM_ID. Secrets are read from the environment and never printed.

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
IOS_DIR="$ROOT_DIR/ios-app"
PROJECT="$IOS_DIR/SmartControl.xcodeproj"
SCHEME=${IOS_SCHEME:-SmartControl}
CONFIGURATION=${IOS_CONFIGURATION:-Release}
DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
export DEVELOPER_DIR

BUILD_DIR=${IOS_BUILD_DIR:-"$IOS_DIR/build"}
DIST_DIR=${IOS_DIST_DIR:-"$IOS_DIR/dist"}

die() { printf 'ios-app-release: %s\n' "$*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"; }

project_version() {
  awk -F'"' '/MARKETING_VERSION:/{print $2; exit}' "$IOS_DIR/project.yml"
}

project_build() {
  awk -F'"' '/CURRENT_PROJECT_VERSION:/{print $2; exit}' "$IOS_DIR/project.yml"
}

has_ios_runtime() {
  xcrun simctl list runtimes 2>/dev/null | grep -q 'iOS ' || return 1
}

doctor() {
  need_cmd xcodebuild
  need_cmd xcrun
  need_cmd xcodegen
  [ -d "$DEVELOPER_DIR" ] || die "DEVELOPER_DIR 不存在: $DEVELOPER_DIR"

  printf 'Xcode: '
  xcodebuild -version | head -n 2
  printf 'XcodeGen: '
  xcodegen version
  printf 'SDK: '
  xcodebuild -showsdks | awk '/iOS SDKs:/{seen=1; next} seen && /iOS /{print; exit}'
  printf 'Simulator runtimes:\n'
  xcrun simctl list runtimes
  if has_ios_runtime; then
    printf '%s\n' 'iOS Simulator Runtime: ready'
  else
    printf '%s\n' 'iOS Simulator Runtime: missing (physical-device/CI build remains available)'
  fi
}

install_runtime() {
  need_cmd xcodebuild
  xcodebuild -downloadPlatform iOS
}

generate() {
  (cd "$IOS_DIR" && xcodegen generate)
}

build_unsigned_app() {
  generate
  mkdir -p "$BUILD_DIR"
  xcodebuild \
    -project "$PROJECT" \
    -target "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -sdk iphoneos \
    CODE_SIGN_IDENTITY="" \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGNING_ALLOWED=NO \
    SYMROOT="$BUILD_DIR" \
    build
}

package_unsigned() {
  build_unsigned_app
  local version build payload ipa sha size
  version=$(project_version)
  build=$(project_build)
  payload=$(mktemp -d)
  mkdir -p "$DIST_DIR"
  rm -f "$DIST_DIR"/SmartControl-unsigned-*.ipa "$DIST_DIR"/SmartControl-unsigned-*.json
  cp -R "$BUILD_DIR/Release-iphoneos/SmartControl.app" "$payload/SmartControl.app"
  mkdir -p "$payload/Payload"
  mv "$payload/SmartControl.app" "$payload/Payload/SmartControl.app"
  ipa="$DIST_DIR/SmartControl-unsigned-v${version}-b${build}.ipa"
  (cd "$payload" && zip -qry "$ipa" Payload)
  sha=$(shasum -a 256 "$ipa" | awk '{print $1}')
  size=$(stat -f '%z' "$ipa")
  cat > "$DIST_DIR/SmartControl-unsigned-v${version}-b${build}.json" <<EOF
{
  "schemaVersion": 1,
  "platform": "ios",
  "versionName": "${version}",
  "buildNumber": "${build}",
  "ipa": "$(basename "$ipa")",
  "sha256": "${sha}",
  "size": ${size},
  "signed": false
}
EOF
  rm -rf "$payload"
  printf 'IPA: %s\nSHA-256: %s\n' "$ipa" "$sha"
}

testflight() {
  : "${APPSTORE_KEY_ID:?缺少 APPSTORE_KEY_ID}"
  : "${APPSTORE_ISSUER_ID:?缺少 APPSTORE_ISSUER_ID}"
  : "${APPSTORE_P8_PATH:?缺少 APPSTORE_P8_PATH}"
  : "${IOS_TEAM_ID:?缺少 IOS_TEAM_ID}"
  [ -f "$APPSTORE_P8_PATH" ] || die "找不到 APPSTORE_P8_PATH 指向的文件"

  generate
  mkdir -p "$BUILD_DIR" "$DIST_DIR"
  local archive export_dir plist build_number
  build_number=${IOS_BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}
  archive="$BUILD_DIR/SmartControl.xcarchive"
  export_dir="$BUILD_DIR/export"
  plist="$BUILD_DIR/export-options.plist"
  rm -rf "$archive" "$export_dir"

  xcodebuild archive \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination 'generic/platform=iOS' \
    -archivePath "$archive" \
    DEVELOPMENT_TEAM="$IOS_TEAM_ID" \
    CURRENT_PROJECT_VERSION="$build_number" \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO

  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>${IOS_TEAM_ID}</string>
  <key>signingStyle</key><string>automatic</string>
</dict></plist>
EOF

  xcodebuild -exportArchive \
    -archivePath "$archive" \
    -exportOptionsPlist "$plist" \
    -exportPath "$export_dir" \
    -allowProvisioningUpdates \
    -authenticationKeyPath "$APPSTORE_P8_PATH" \
    -authenticationKeyID "$APPSTORE_KEY_ID" \
    -authenticationKeyIssuerID "$APPSTORE_ISSUER_ID"
}

dispatch() {
  need_cmd gh
  local distribution=${1:-unsigned}
  case "$distribution" in
    unsigned|testflight) ;;
    *) die "dispatch 参数必须是 unsigned 或 testflight" ;;
  esac
  gh workflow run ios-build.yml --ref main -f distribution="$distribution"
  printf '已触发 GitHub Actions: distribution=%s\n' "$distribution"
}

release() {
  case "${IOS_DISTRIBUTION:-unsigned}" in
    unsigned) package_unsigned ;;
    testflight) testflight ;;
    *) die "IOS_DISTRIBUTION 必须是 unsigned 或 testflight" ;;
  esac
}

usage() {
  cat <<'EOF'
用法:
  scripts/ios-app-release.sh doctor
  scripts/ios-app-release.sh install-runtime
  scripts/ios-app-release.sh generate
  scripts/ios-app-release.sh unsigned
  scripts/ios-app-release.sh testflight
  IOS_DISTRIBUTION=unsigned scripts/ios-app-release.sh release
  IOS_DISTRIBUTION=testflight scripts/ios-app-release.sh release
  scripts/ios-app-release.sh dispatch [unsigned|testflight]

环境变量:
  DEVELOPER_DIR       默认 /Applications/Xcode.app/Contents/Developer
  APPSTORE_KEY_ID     TestFlight API Key ID
  APPSTORE_ISSUER_ID  TestFlight Issuer ID
  APPSTORE_P8_PATH    本地 .p8 路径
  IOS_TEAM_ID         Apple Developer Team ID
  IOS_BUILD_NUMBER    可选；不填时使用 UTC 时间生成唯一构建号
EOF
}

case "${1:-}" in
  doctor) doctor ;;
  install-runtime) install_runtime ;;
  generate) generate ;;
  unsigned) package_unsigned ;;
  testflight) testflight ;;
  release) release ;;
  dispatch) dispatch "${2:-unsigned}" ;;
  *) usage; exit 2 ;;
esac
