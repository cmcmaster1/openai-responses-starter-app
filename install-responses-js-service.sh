#!/bin/bash
# Installation script for responses.js systemd service

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_FILE="$SCRIPT_DIR/responses-js.service"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
SYSTEMD_SYSTEM_DIR="/etc/systemd/system"

# Determine if we should install as user or system service
if [ "$EUID" -eq 0 ]; then
    echo "Installing as system service (running as root)..."
    INSTALL_DIR="$SYSTEMD_SYSTEM_DIR"
    SYSTEMCTL_CMD="systemctl"
    ENABLE_CMD="systemctl enable"
    START_CMD="systemctl start"
    RELOAD_CMD="systemctl daemon-reload"
    USE_SUDO=""
else
    echo "Installing as user service..."
    INSTALL_DIR="$SYSTEMD_USER_DIR"
    SYSTEMCTL_CMD="systemctl --user"
    ENABLE_CMD="systemctl --user enable"
    START_CMD="systemctl --user start"
    RELOAD_CMD="systemctl --user daemon-reload"
    USE_SUDO="sudo"
    mkdir -p "$INSTALL_DIR"
fi

# Copy service file to systemd directory
echo "Copying service file to $INSTALL_DIR..."
cp "$SERVICE_FILE" "$INSTALL_DIR/responses-js.service"

# If installing as system service, we need to set the user
if [ "$EUID" -eq 0 ]; then
    CURRENT_USER="${SUDO_USER:-$USER}"
    if [ -n "$CURRENT_USER" ] && [ "$CURRENT_USER" != "root" ]; then
        echo "Setting service to run as user: $CURRENT_USER"
        # Add User and Group directives to the service file
        sed -i "/^\[Service\]/a User=$CURRENT_USER\nGroup=$CURRENT_USER" "$INSTALL_DIR/responses-js.service"
    fi
fi

# Reload systemd
echo "Reloading systemd daemon..."
$RELOAD_CMD

# Enable service
echo "Enabling responses-js service..."
$ENABLE_CMD responses-js.service

# For user services, enable lingering so it runs without login session
if [ "$EUID" -ne 0 ]; then
    echo "Enabling user service lingering (runs without login session)..."
    loginctl enable-linger "$USER" 2>/dev/null || echo "⚠️  Could not enable lingering (may require systemd user session)"
fi

echo ""
echo "✅ Service installed successfully!"
echo ""
echo "To start the service:"
if [ "$EUID" -eq 0 ]; then
    echo "  sudo systemctl start responses-js"
else
    echo "  systemctl --user start responses-js"
fi
echo ""
echo "To check status:"
if [ "$EUID" -eq 0 ]; then
    echo "  sudo systemctl status responses-js"
else
    echo "  systemctl --user status responses-js"
fi
echo ""
echo "To view logs:"
if [ "$EUID" -eq 0 ]; then
    echo "  sudo journalctl -u responses-js -f"
else
    echo "  journalctl --user -u responses-js -f"
fi
echo ""
echo "To stop the service:"
if [ "$EUID" -eq 0 ]; then
    echo "  sudo systemctl stop responses-js"
else
    echo "  systemctl --user stop responses-js"
fi

