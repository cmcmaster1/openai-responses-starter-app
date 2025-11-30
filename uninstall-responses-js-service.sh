#!/bin/bash
# Uninstallation script for responses.js systemd service

set -e

SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
SYSTEMD_SYSTEM_DIR="/etc/systemd/system"

# Determine if this is a user or system service
if [ -f "$SYSTEMD_USER_DIR/responses-js.service" ]; then
    echo "Uninstalling user service..."
    systemctl --user stop responses-js 2>/dev/null || true
    systemctl --user disable responses-js 2>/dev/null || true
    rm -f "$SYSTEMD_USER_DIR/responses-js.service"
    systemctl --user daemon-reload
    echo "✅ User service uninstalled"
elif [ -f "$SYSTEMD_SYSTEM_DIR/responses-js.service" ]; then
    echo "Uninstalling system service..."
    if [ "$EUID" -ne 0 ]; then
        echo "❌ System service requires root privileges. Please run with sudo:"
        echo "   sudo $0"
        exit 1
    fi
    systemctl stop responses-js 2>/dev/null || true
    systemctl disable responses-js 2>/dev/null || true
    rm -f "$SYSTEMD_SYSTEM_DIR/responses-js.service"
    systemctl daemon-reload
    echo "✅ System service uninstalled"
else
    echo "❌ Service file not found. Nothing to uninstall."
    exit 1
fi

