#!/bin/bash
# Wrapper script for systemd to run responses.js server
# This script is designed to be run by systemd

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESPONSES_JS_DIR="$SCRIPT_DIR/responses.js"
ROOT_ENV_FILE="$SCRIPT_DIR/.env.local"

# Load root .env.local so responses.js inherits the same configuration
if [ -f "$ROOT_ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ROOT_ENV_FILE"
    set +a
fi

# Ensure responses.js directory exists
if [ ! -d "$RESPONSES_JS_DIR" ]; then
    echo "❌ responses.js not found. Running setup first..." >&2
    "$SCRIPT_DIR/setup-responses-js.sh"
fi

cd "$RESPONSES_JS_DIR"

# Mirror key vars into responses.js/.env so other tooling (like pnpm dev) sees them
RESPONSES_API_KEY="${VLLM_API_KEY:-${API_KEY:-EzjMVojsaYryCWAc}}"
RESPONSES_OPENAI_BASE_URL="${OPENAI_BASE_URL:-${VLLM_BASE_URL:-https://huge-bertha.hydra-theropod.ts.net:8443/v1}}"
RESPONSES_PORT_VALUE="${PORT:-3000}"

cat > .env <<EOF
API_KEY=$RESPONSES_API_KEY
OPENAI_BASE_URL=$RESPONSES_OPENAI_BASE_URL
PORT=$RESPONSES_PORT_VALUE
EOF

# Load .env into environment (after ensuring it exists)
if [ -f ".env" ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

# Determine port (env var > .env > default)
RESPONSES_PORT="${PORT:-}"
if [ -z "$RESPONSES_PORT" ] && [ -f ".env" ]; then
    RESPONSES_PORT="$(grep -E '^PORT=' .env | tail -n 1 | cut -d '=' -f2)"
fi
RESPONSES_PORT="${RESPONSES_PORT:-3000}"

# Determine which package manager to use
if command -v pnpm &> /dev/null; then
    CMD="pnpm"
elif [ -f "node_modules/.bin/pnpm" ]; then
    CMD="node_modules/.bin/pnpm"
elif command -v npm &> /dev/null; then
    CMD="npm"
else
    echo "❌ No package manager found. Please install dependencies first." >&2
    exit 1
fi

# Export environment variables
export PORT="${RESPONSES_PORT}"
export API_KEY="${RESPONSES_API_KEY}"
export OPENAI_BASE_URL="${RESPONSES_OPENAI_BASE_URL}"

# For production, use 'start' command (requires build)
# For development, use 'dev' command
# Check if dist directory exists to determine which to use
if [ -d "dist" ] && [ -f "dist/index.js" ]; then
    # Production mode: use built version
    exec $CMD start
else
    # Development mode: use tsx watch
    exec $CMD dev
fi

