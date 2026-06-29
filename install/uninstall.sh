#!/usr/bin/env bash
# install/uninstall.sh — remove the LaunchAgent and the app directory. ON-MAC.
#
# Note: this does not touch the Supstance "Ecclesia" calendar. To remove the
# mirrored events and heartbeat everywhere, delete that calendar in Outlook —
# nothing was ever provisioned on the Ecclesia side, so there is nothing to revoke.

set -euo pipefail

APP_DIR="$HOME/EcclesiaSync"
LABEL="com.supstance.eccl-calsync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/$LABEL" || true
  echo "booted out $LABEL"
fi

if [ -f "$PLIST" ]; then
  rm -f "$PLIST"
  echo "removed $PLIST"
fi

if [ -d "$APP_DIR" ]; then
  rm -rf "$APP_DIR"
  echo "removed $APP_DIR"
fi

echo "uninstalled. (Delete the Supstance \"Ecclesia\" calendar to clear mirrored events.)"
