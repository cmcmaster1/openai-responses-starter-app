# responses.js Systemd Service

This directory contains files to run responses.js as a systemd service, ensuring it stays running and automatically restarts on failure.

## Files

- `responses-js.service` - Systemd service unit file
- `start-responses-js-service.sh` - Wrapper script that systemd executes
- `install-responses-js-service.sh` - Installation script
- `uninstall-responses-js-service.sh` - Uninstallation script

## Installation

### Option 1: User Service (Recommended for single-user systems)

Run the installation script as a regular user:

```bash
./install-responses-js-service.sh
```

This will:
- Install the service in `~/.config/systemd/user/`
- Enable the service to start on login
- The service will run as your user account

### Option 2: System Service (For multi-user or server deployments)

Run the installation script with sudo:

```bash
sudo ./install-responses-js-service.sh
```

This will:
- Install the service in `/etc/systemd/system/`
- Enable the service to start on boot
- The service will run as the user who ran the script (or root if run directly as root)

## Usage

### Start the service

**User service:**
```bash
systemctl --user start responses-js
```

**System service:**
```bash
sudo systemctl start responses-js
```

### Stop the service

**User service:**
```bash
systemctl --user stop responses-js
```

**System service:**
```bash
sudo systemctl stop responses-js
```

### Check status

**User service:**
```bash
systemctl --user status responses-js
```

**System service:**
```bash
sudo systemctl status responses-js
```

### View logs

**User service:**
```bash
journalctl --user -u responses-js -f
```

**System service:**
```bash
sudo journalctl -u responses-js -f
```

### Enable/Disable auto-start

**User service:**
```bash
# Enable (start on login)
systemctl --user enable responses-js

# Disable
systemctl --user disable responses-js
```

**System service:**
```bash
# Enable (start on boot)
sudo systemctl enable responses-js

# Disable
sudo systemctl disable responses-js
```

## Configuration

The service automatically loads configuration from `.env.local` in the project root. Make sure this file contains:

```bash
VLLM_BASE_URL=https://huge-bertha.hydra-theropod.ts.net:8443/v1
VLLM_API_KEY=EzjMVojsaYryCWAc
PORT=3000  # Optional, defaults to 3000
```

After changing `.env.local`, restart the service:

```bash
# User service
systemctl --user restart responses-js

# System service
sudo systemctl restart responses-js
```

## Troubleshooting

### Service fails to start

1. Check the logs:
   ```bash
   journalctl --user -u responses-js -n 50  # User service
   sudo journalctl -u responses-js -n 50    # System service
   ```

2. Verify the wrapper script is executable:
   ```bash
   ls -l start-responses-js-service.sh
   ```

3. Test the wrapper script manually:
   ```bash
   ./start-responses-js-service.sh
   ```

### Port already in use

The service will fail if port 3000 (or your configured PORT) is already in use. Check what's using it:

```bash
sudo lsof -i :3000
```

### Service keeps restarting

If the service keeps restarting, check the logs for errors. Common issues:
- Missing dependencies (pnpm/npm not found)
- Invalid configuration in `.env.local`
- Network connectivity issues to vLLM backend

## Uninstallation

Run the uninstall script:

```bash
./uninstall-responses-js-service.sh
```

Or manually:

**User service:**
```bash
systemctl --user stop responses-js
systemctl --user disable responses-js
rm ~/.config/systemd/user/responses-js.service
systemctl --user daemon-reload
```

**System service:**
```bash
sudo systemctl stop responses-js
sudo systemctl disable responses-js
sudo rm /etc/systemd/system/responses-js.service
sudo systemctl daemon-reload
```

