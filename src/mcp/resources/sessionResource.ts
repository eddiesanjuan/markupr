/**
 * Session Resources — MCP resource registration for session data.
 *
 * Registers:
 *   session://latest   — metadata for the most recent session
 *   session://{id}     — metadata for a specific session by ID
 *
 * Both return application/json content with McpSession fields.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sessionStore } from '../session/SessionStore.js';

export function registerResources(server: McpServer): void {
  // Fixed resource: session://latest
  server.resource(
    'latest-session',
    'session://latest',
    { description: 'Metadata for the most recent MCP recording session', mimeType: 'application/json' },
    async () => {
      const session = await sessionStore.getLatest();

      if (!session) {
        return {
          contents: [{
            uri: 'session://latest',
            mimeType: 'application/json',
            text: JSON.stringify({ error: 'No sessions found' }),
          }],
        };
      }

      return {
        contents: [{
          uri: 'session://latest',
          mimeType: 'application/json',
          text: JSON.stringify(session, null, 2),
        }],
      };
    }
  );

  // Template resource: session://{id}
  server.resource(
    'session-by-id',
    new ResourceTemplate('session://{id}', { list: undefined }),
    { description: 'Metadata for a specific MCP recording session', mimeType: 'application/json' },
    async (uri, variables) => {
      const id = variables.id as string;
      const session = await sessionStore.get(id);

      if (!session) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ error: `Session not found: ${id}` }),
          }],
        };
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(session, null, 2),
        }],
      };
    }
  );
}
