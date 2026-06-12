#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_FILE="$SCRIPT_DIR/puttyu-ui.service"

if [ ! -f "$SERVICE_FILE" ]; then
  echo "Error: puttyu-ui.service not found in $SCRIPT_DIR"
  exit 1
fi

echo "Installing puttyU UI service..."
echo "Make sure you've edited puttyu-ui.service with your username and paths first!"
echo ""

sudo cp "$SERVICE_FILE" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable puttyu-ui
sudo systemctl start puttyu-ui
sudo systemctl status puttyu-ui
