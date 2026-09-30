#!/usr/bin/env bash
# Update an existing CouchUI install from a downloaded release zip.
#
# The slow part of re-extracting into a fresh folder isn't the download —
# it's losing node_modules and having to npm install again, which re-fetches
# ~100MB of Electron. This unpacks over the install in place, so node_modules
# survives and there's nothing to reinstall.
#
#   ./update.sh ~/Downloads/couch-ui-v0.3.0.zip
#
# Your config.json is kept by default (it holds your tiles and Spotify
# client ID). Pass --replace-config to take the new one instead.

set -euo pipefail

ZIP="${1:-}"
REPLACE_CONFIG="${2:-}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "$ZIP" ]]; then
  echo "Usage: ./update.sh <path-to-zip> [--replace-config]"
  echo
  echo "Example: ./update.sh ~/Downloads/couch-ui-v0.3.0.zip"
  exit 1
fi

if [[ ! -f "$ZIP" ]]; then
  echo "No such file: $ZIP"
  exit 1
fi

echo "Updating CouchUI in $APP_DIR"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

unzip -q "$ZIP" -d "$STAGE"

# The zip contains a single top-level couch-ui/ folder.
SRC="$STAGE/couch-ui"
if [[ ! -d "$SRC" ]]; then
  echo "Unexpected zip layout — no couch-ui/ folder inside $ZIP"
  exit 1
fi

if [[ "$REPLACE_CONFIG" != "--replace-config" && -f "$APP_DIR/config.json" ]]; then
  cp "$APP_DIR/config.json" "$STAGE/config.json.keep"
fi

# -a preserves modes, --delete removes files dropped in the new version, and
# the excludes protect the things that must not be clobbered: installed
# dependencies, the error log, and any local git checkout.
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude 'error.log' \
  --exclude '.git' \
  "$SRC/" "$APP_DIR/"

if [[ -f "$STAGE/config.json.keep" ]]; then
  cp "$STAGE/config.json.keep" "$APP_DIR/config.json"
  echo "Kept your existing config.json (use --replace-config to overwrite)."
fi

# Only reinstall when the dependency list actually changed, or nothing is
# installed yet — otherwise this is the step that made updates slow.
NEED_INSTALL=0
[[ ! -d "$APP_DIR/node_modules" ]] && NEED_INSTALL=1
if [[ -f "$APP_DIR/package.json" && -f "$APP_DIR/node_modules/.package-hash" ]]; then
  OLD_HASH="$(cat "$APP_DIR/node_modules/.package-hash")"
  NEW_HASH="$(sha1sum "$APP_DIR/package.json" | cut -d' ' -f1)"
  [[ "$OLD_HASH" != "$NEW_HASH" ]] && NEED_INSTALL=1
elif [[ -d "$APP_DIR/node_modules" ]]; then
  NEED_INSTALL=1   # no hash recorded yet, so install once to establish one
fi

if [[ "$NEED_INSTALL" == "1" ]]; then
  echo "Dependencies changed — running npm install…"
  (cd "$APP_DIR" && npm install)
  sha1sum "$APP_DIR/package.json" | cut -d' ' -f1 > "$APP_DIR/node_modules/.package-hash"
  # Electron's sandbox helper needs these each time it's reinstalled.
  if [[ -f "$APP_DIR/node_modules/electron/dist/chrome-sandbox" ]]; then
    sudo chown root:root "$APP_DIR/node_modules/electron/dist/chrome-sandbox"
    sudo chmod 4755 "$APP_DIR/node_modules/electron/dist/chrome-sandbox"
  fi
else
  echo "Dependencies unchanged — skipping npm install."
fi

echo
echo "Updated to $(node -p "require('$APP_DIR/package.json').version" 2>/dev/null || echo 'unknown version')."
echo "Start it with:  couchui       (or: cd $APP_DIR && npm start)"
