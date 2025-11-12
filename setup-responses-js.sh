#!/bin/bash
# Setup script for responses.js integration

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESPONSES_JS_DIR="$SCRIPT_DIR/responses.js"

echo "🚀 Setting up responses.js..."

# Check if responses.js directory already exists
if [ -d "$RESPONSES_JS_DIR" ]; then
    echo "📁 responses.js directory already exists. Updating..."
    cd "$RESPONSES_JS_DIR"
    git pull || echo "⚠️  Could not update, continuing..."
else
    echo "📥 Cloning responses.js repository..."
    cd "$SCRIPT_DIR"
    git clone https://github.com/huggingface/responses.js.git
    cd "$RESPONSES_JS_DIR"
fi

# Check if pnpm is installed, try npm if not available
if command -v pnpm &> /dev/null; then
    echo "✅ Using pnpm"
    INSTALL_CMD="pnpm"
elif command -v npm &> /dev/null; then
    echo "⚠️  pnpm not found, using npm instead"
    INSTALL_CMD="npm"
    # Try to install pnpm locally if possible
    if npm install pnpm --save-dev 2>/dev/null; then
        INSTALL_CMD="npx pnpm"
        echo "✅ Using local pnpm via npx"
    fi
else
    echo "❌ Neither pnpm nor npm found. Please install Node.js first."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies with $INSTALL_CMD..."
$INSTALL_CMD install

# Create .env file for responses.js
echo "⚙️  Configuring responses.js..."

# Read vLLM config from env.example or use defaults
VLLM_BASE_URL="${VLLM_BASE_URL:-https://huge-bertha.hydra-theropod.ts.net:8443/v1}"
VLLM_API_KEY="${VLLM_API_KEY:-EzjMVojsaYryCWAc}"

cat > "$RESPONSES_JS_DIR/.env" << EOF
# responses.js configuration
# This file configures responses.js to proxy to your vLLM backend

# Your vLLM API key
API_KEY=$VLLM_API_KEY

# Your vLLM endpoint (Chat Completions API)
OPENAI_BASE_URL=$VLLM_BASE_URL

# Port for responses.js server (default: 3000)
PORT=3000
EOF

echo "✅ responses.js setup complete!"
echo ""
echo "📝 Configuration saved to: $RESPONSES_JS_DIR/.env"
echo ""
echo "🚀 To start responses.js, run:"
echo "   cd $RESPONSES_JS_DIR"
echo "   pnpm dev"
echo ""
echo "📋 Or use the provided start script:"
echo "   ./start-responses-js.sh"

