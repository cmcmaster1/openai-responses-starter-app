#!/bin/bash
# Setup script for MCP server virtual environment
# This creates a venv and installs all MCP server packages to avoid reinstalling with uvx

set -e

echo "Creating MCP virtual environment..."
uv venv .venv-mcp

echo "Installing MCP server packages..."
uv pip install --python .venv-mcp/bin/python mcp-server-fetch
uv pip install --python .venv-mcp/bin/python git+https://github.com/gstiebler/pdf-mcp-server.git

echo "✅ MCP virtual environment setup complete!"
echo ""
echo "The following servers are now available:"
echo "  - .venv-mcp/bin/mcp-server-fetch"
echo "  - .venv-mcp/bin/pdf-mcp-server"
echo ""
echo "Update your .env.local MCP_DEFAULT_SERVERS to use these paths."
