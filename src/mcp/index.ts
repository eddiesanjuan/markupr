/**
 * markupr MCP Server — Entry Point
 *
 * Headless Node.js process communicating over stdio using JSON-RPC 2.0.
 * stdout is reserved for MCP protocol — all logging goes to stderr.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { log } from './utils/Logger.js';

// Read version from package.json at build time (injected by esbuild)
declare const __MARKUPR_VERSION__: string;
const VERSION =
  typeof __MARKUPR_VERSION__ !== 'undefined' ? __MARKUPR_VERSION__ : '0.0.0-dev';

log(`markupr MCP server v${VERSION} starting...`);

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
