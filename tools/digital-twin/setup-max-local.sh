#!/bin/bash
set -euo pipefail
twin_root="${TWIN_HOME:-$HOME/.local/share/smart-control-twin}"
plugin_path="$twin_root/vendor/io_scene_max"
plugin_pin=37db107126f956f7219152671443080360565691
if [ ! -d "$plugin_path" ]; then
  mkdir -p "$twin_root/vendor"
  git clone https://github.com/nrgsille76/io_scene_max.git "$plugin_path"
  git -C "$plugin_path" checkout --detach "$plugin_pin"
fi
if [ "$(git -C "$plugin_path" rev-parse HEAD)" != "$plugin_pin" ] || [ -n "$(git -C "$plugin_path" status --porcelain --untracked-files=no)" ]; then
  echo 'Importer differs from audited pin; preserving it and stopping.' >&2
  exit 1
fi
"$twin_root/runtime/py311/bin/python" -m pip install -r "$(dirname "$0")/requirements.txt"
echo "Local MAX parser ready: $plugin_pin"
