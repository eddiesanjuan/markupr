#!/bin/bash
# Manual MCP Server Test — sends JSON-RPC messages over stdio
#
# Usage:
#   ./tests/manual/test-mcp-server.sh
#
# Prerequisites:
#   npm run build:mcp

set -euo pipefail

MCP_BIN="node dist/mcp/index.mjs"

echo "=== MCP Server Manual Test ==="
echo ""

# Test 1: Initialize
echo "--- Test 1: Initialize ---"
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0"}}}' | $MCP_BIN 2>/dev/null || true
echo ""

# Test 2: List tools
echo "--- Test 2: List Tools ---"
echo -e '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | $MCP_BIN 2>/dev/null || true
echo ""

echo "=== Done ==="
