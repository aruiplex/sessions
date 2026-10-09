#!/bin/bash
set -e

PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="$PLIST_DIR/com.sessionswitch.sync.plist"
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/sync_server.js"
NODE_PATH="$(which node || echo "/opt/homebrew/bin/node")"
DATA_DIR="$HOME/.sessionswitch"

mkdir -p "$DATA_DIR"
mkdir -p "$PLIST_DIR"

echo "Configuring SessionSwitch Sync Service..."
echo "Node: $NODE_PATH"
echo "Script: $SCRIPT_PATH"

cat << EOF > "$PLIST_FILE"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.sessionswitch.sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$SCRIPT_PATH</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$DATA_DIR/sync.log</string>
    <key>StandardErrorPath</key>
    <string>$DATA_DIR/sync.log</string>
</dict>
</plist>
EOF

# Unload existing if running
launchctl unload "$PLIST_FILE" 2>/dev/null || true
# Load new service
launchctl load -w "$PLIST_FILE"

# Wait a brief moment and verify
sleep 1
if curl -s http://127.0.0.1:49152/api/status >/dev/null; then
    echo "✅ SessionSwitch Sync Service is successfully running on http://127.0.0.1:49152"
else
    echo "⚠️ Service started, please check $DATA_DIR/sync.log"
fi
