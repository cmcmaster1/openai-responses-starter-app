#!/bin/bash
# Start script for responses.js server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESPONSES_JS_DIR="$SCRIPT_DIR/responses.js"
ROOT_ENV_FILE="$SCRIPT_DIR/.env.local"

# Load root .env.local so responses.js inherits the same configuration
if [ -f "$ROOT_ENV_FILE" ]; then
    echo "ℹ️  Loading environment from .env.local"
    set -a
    # shellcheck disable=SC1090
    source "$ROOT_ENV_FILE"
    set +a
else
    echo "⚠️  .env.local not found. Using default responses.js configuration."
fi

if [ ! -d "$RESPONSES_JS_DIR" ]; then
    echo "❌ responses.js not found. Running setup first..."
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

# Kill any process already bound to that port
if command -v lsof >/dev/null 2>&1; then
    EXISTING_PIDS="$(lsof -ti tcp:${RESPONSES_PORT} || true)"
    if [ -n "$EXISTING_PIDS" ]; then
        echo "⚠️  Port ${RESPONSES_PORT} already in use. Stopping existing process..."
        echo "$EXISTING_PIDS" | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
else
    echo "ℹ️  lsof not available; skipping automatic port cleanup."
fi

# Determine which package manager to use
if command -v pnpm &> /dev/null; then
    CMD="pnpm"
elif [ -f "node_modules/.bin/pnpm" ]; then
    CMD="node_modules/.bin/pnpm"
elif command -v npm &> /dev/null; then
    CMD="npm"
else
    echo "❌ No package manager found. Please install dependencies first."
    exit 1
fi

echo "🚀 Starting responses.js server..."
echo "📍 Server will be available at: http://localhost:${RESPONSES_PORT}"
echo "📡 Proxying to: ${RESPONSES_OPENAI_BASE_URL}"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

export PORT="${RESPONSES_PORT}"
$CMD dev
