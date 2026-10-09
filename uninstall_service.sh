#!/bin/bash
PLIST_FILE="$HOME/Library/LaunchAgents/com.sessionswitch.sync.plist"

if [ -f "$PLIST_FILE" ]; then
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
    rm -f "$PLIST_FILE"
    echo "✅ SessionSwitch Sync Service has been stopped and uninstalled."
else
    echo "Service plist not found."
fi
