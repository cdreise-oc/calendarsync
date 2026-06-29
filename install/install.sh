#!/usr/bin/env bash
# install/install.sh — deploy the built JXA + config, install the LaunchAgent,
# and bootstrap it. ON-MAC: run this on the user's Mac after `build/build.sh`.
#
# Idempotent: re-running re-copies the dist, re-installs the plist, and kicks
# the agent. Config is only seeded if absent (your edits are never clobbered).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$HOME/EcclesiaSync"
LA_DIR="$HOME/Library/LaunchAgents"
LABEL="com.supstance.eccl-calsync"
PLIST_DST="$LA_DIR/$LABEL.plist"
DIST="$ROOT/dist/eccl-calsync.js"

if [ ! -f "$DIST" ]; then
  echo "error: $DIST not found. Run build/build.sh first." >&2
  exit 1
fi

mkdir -p "$APP_DIR" "$LA_DIR"

# 1. Deployable script.
cp "$DIST" "$APP_DIR/eccl-calsync.js"

# 2. Config: seed from the example only if the user has none yet.
if [ ! -f "$APP_DIR/config.json" ]; then
  cp "$ROOT/config.example.json" "$APP_DIR/config.json"
  echo "seeded $APP_DIR/config.json — edit it with titles from \`list\` before first sync."
fi

# 3. LaunchAgent plist, with __HOME__ substituted to an absolute path.
sed "s|__HOME__|$HOME|g" "$ROOT/install/$LABEL.plist" > "$PLIST_DST"

# 4. (Re)bootstrap into the GUI session.
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/$LABEL" || true
fi
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl kickstart -k "gui/$(id -u)/$LABEL" || true

cat <<EOF
installed.
  script:  $APP_DIR/eccl-calsync.js
  config:  $APP_DIR/config.json
  agent:   $PLIST_DST (hourly at minute 5, RunAtLoad)

next (ON-MAC):
  1. osascript -l JavaScript "$APP_DIR/eccl-calsync.js" list      # approve the Calendar prompt, fill config.json
  2. osascript -l JavaScript "$APP_DIR/eccl-calsync.js" once --dry-run
  3. osascript -l JavaScript "$APP_DIR/eccl-calsync.js" once
EOF
