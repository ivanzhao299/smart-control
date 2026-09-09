#!/bin/bash
set -euo pipefail
# Dedicated user-local runtime. Does not change /Applications or production services.
ROOT="${TWIN_HOME:-$HOME/.local/share/smart-control-twin}"
HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION=4.5.9
SHA=e3a3d7aac381fb4e4d05197f99cd8899484d7e8bc4497c134066e6733f372238
DOWNLOAD_BASE="${TWIN_BLENDER_MIRROR:-https://download.blender.org/release}"
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo 'Requires Apple Silicon macOS'; exit 1; }
mkdir -p "$ROOT/runtime" "$ROOT/downloads" "$ROOT/jobs"
APP="$ROOT/runtime/Blender-$VERSION.app"
if [[ ! -x "$APP/Contents/MacOS/Blender" ]]; then
  DMG="$ROOT/downloads/blender-$VERSION-macos-arm64.dmg"
  if [[ ! -f "$DMG" ]]; then
    curl --fail --location --retry 3 --connect-timeout 20 --max-time 900 \
      "$DOWNLOAD_BASE/Blender4.5/blender-$VERSION-macos-arm64.dmg" -o "$DMG.partial"
    mv "$DMG.partial" "$DMG"
  fi
  ACTUAL="$(shasum -a 256 "$DMG" | awk '{print $1}')"
  [[ "$ACTUAL" == "$SHA" ]] || { echo "Blender checksum mismatch; replace $DMG"; exit 1; }
  MOUNT="$(mktemp -d /tmp/smart-control-blender.XXXXXX)"
  hdiutil attach "$DMG" -readonly -nobrowse -mountpoint "$MOUNT"
  trap 'hdiutil detach "$MOUNT" >/dev/null 2>&1 || true' EXIT
  ditto "$MOUNT/Blender.app" "$APP"
  hdiutil detach "$MOUNT"
  trap - EXIT
fi
if [[ ! -x "$ROOT/runtime/py311/bin/python" ]]; then
  "$APP/Contents/Resources/4.5/python/bin/python3.11" -m venv "$ROOT/runtime/py311"
fi
"$ROOT/runtime/py311/bin/python" -m pip install --disable-pip-version-check -r "$HERE/requirements.txt"
(cd "$HERE" && npm ci --no-audit --no-fund)
"$APP/Contents/MacOS/Blender" --background --factory-startup --version
echo "Runtime ready: $ROOT"
