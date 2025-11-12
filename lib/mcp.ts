// lib/mcp.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { resolve } from 'path';

export type MCPServerConfig =
  | { name: string; transport: 'stdio'; command: string; args?: string[] }
  | { name: string; transport: 'http'; url: string };

type MCPTool = { name: string; description?: string; inputSchema?: any };

export class MCPManager {
  private clients = new Map<string, Client>();

  async connect(cfg: MCPServerConfig) {
    if (this.clients.has(cfg.name)) return; // idempotent
    const client = new Client({ name: `mcp-client-${cfg.name}`, version: '1.0.0' });
    const transport = cfg.transport === 'stdio'
      ? new StdioClientTransport({ 
          // Resolve relative paths (starting with .) to absolute paths relative to project root
          // Absolute paths (starting with /) and commands in PATH are used as-is
          command: cfg.command.startsWith('.') 
            ? resolve(process.cwd(), cfg.command)
            : cfg.command,
          args: cfg.args || [] 
        })
      : new StreamableHTTPClientTransport(new URL(cfg.url));
    await client.connect(transport);
    this.clients.set(cfg.name, client);
  }

  async disconnect(name: string) {
    const client = this.clients.get(name);
    if (client) {
      await client.close();
      this.clients.delete(name);
    }
  }

  async listAllTools(): Promise<{ server: string; tool: MCPTool }[]> {
    const out: { server: string; tool: MCPTool }[] = [];
    const listTimeoutMs = Number(process.env.MCP_LIST_TOOLS_TIMEOUT_MS ?? '8000');
    const listRetries = Math.max(
      1,
      Number(process.env.MCP_LIST_TOOLS_RETRIES ?? '2')
    );
    const retryDelayMs = Number(process.env.MCP_LIST_TOOLS_RETRY_DELAY_MS ?? '500');
    const clients = Array.from(this.clients.entries());

    await Promise.all(
      clients.map(async ([server, client]) => {
        for (let attempt = 1; attempt <= listRetries; attempt++) {
          try {
            const resp = await runWithTimeout(client.listTools(), listTimeoutMs);
            if (!resp) {
              throw new Error(
                `[MCP] listTools timed out for server ${server} after ${listTimeoutMs}ms`
              );
            }
            for (const tool of resp.tools) out.push({ server, tool });
            if (attempt > 1) {
              console.warn(
                `[MCP] listTools recovered for server ${server} on attempt ${attempt}`
              );
            }
            return;
          } catch (e) {
            if (attempt === listRetries) {
              console.error(`Error listing tools from MCP server ${server}:`, e);
            } else {
              console.warn(
                `[MCP] listTools attempt ${attempt} failed for ${server}, retrying...`,
                e instanceof Error ? e.message : e
              );
              await sleep(retryDelayMs * attempt);
            }
          }
        }
      })
    );

    return out;
  }

  async call(server: string, tool: string, args: any) {
    const client = this.clients.get(server);
    if (!client) throw new Error(`MCP server not connected: ${server}`);
    const result = await client.callTool({ name: tool, arguments: args });
    return result.content;
  }

  isConnected(name: string): boolean {
    return this.clients.has(name);
  }

  listConnected(): string[] {
    return Array.from(this.clients.keys());
  }
}

export const sanitize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
export const toOpenAITool = (server: string, t: MCPTool) => {
  const toolName = `mcp__${sanitize(server)}__${sanitize(t.name)}`;
  const schema = t.inputSchema || { type: 'object', properties: {} };

  return {
    type: 'function',
    function: {
      name: toolName,
      description: t.description || `MCP tool from ${server}`,
      parameters: {
        type: 'object',
        ...schema,
        required: schema.required || [],
        additionalProperties: false,
      },
    },
  };
};

const runWithTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | null> => {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
