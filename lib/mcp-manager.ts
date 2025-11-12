// lib/mcp-manager.ts
// Shared singleton MCP manager instance
import { MCPManager } from "./mcp";

let mcpManager: MCPManager | null = null;
let initializationPromise: Promise<void> | null = null;
let initializationStarted = false;

const initializeManager = (manager: MCPManager) => {
  const pending: Promise<void>[] = [];
  const stdioEnabled = process.env.MCP_ENABLE_STDIO === "true";

  const exaApiKey = process.env.EXA_API_KEY;
  if (exaApiKey && stdioEnabled && !manager.isConnected("exa")) {
    pending.push(
      manager
        .connect({
          name: "exa",
          transport: "stdio",
          command: "npx",
          args: ["-y", "mcp-remote", `https://mcp.exa.ai/mcp?exaApiKey=${exaApiKey}`],
        })
        .catch((error) => {
          console.error("Failed to connect Exa MCP:", error);
        })
    );
  } else if (exaApiKey && !stdioEnabled) {
    console.warn(
      "EXA_API_KEY is set but MCP_ENABLE_STDIO is not true; skipping automatic Exa MCP connection."
    );
  }

  // Support MCP_DEFAULT_SERVERS as JSON array of server configs
  // Format: [{"name":"server","transport":"http","url":"..."}] or
  //         [{"name":"server","transport":"stdio","command":"npx","args":["..."]}]
  const defaultServersEnv = process.env.MCP_DEFAULT_SERVERS;
  if (defaultServersEnv) {
    try {
      const servers = JSON.parse(defaultServersEnv);
      if (Array.isArray(servers)) {
        for (const server of servers) {
          if (server.name && server.transport) {
            // Skip if already connected
            if (manager.isConnected(server.name)) {
              continue;
            }
            
            // Validate stdio transport is enabled
            if (server.transport === 'stdio' && !stdioEnabled) {
              console.warn(`Skipping stdio server ${server.name}: MCP_ENABLE_STDIO is not set to 'true'`);
              continue;
            }
            
            // Validate required fields
            if (server.transport === 'http' && !server.url) {
              console.warn(`Skipping server ${server.name}: http transport requires 'url'`);
              continue;
            }
            if (server.transport === 'stdio' && !server.command) {
              console.warn(`Skipping server ${server.name}: stdio transport requires 'command'`);
              continue;
            }
            
            pending.push(
              manager
                .connect(server as any)
                .catch((error) => {
                  console.error(`Failed to connect MCP server ${server.name}:`, error);
                })
            );
          } else if (server.name && server.url) {
            // Skip if already connected
            if (manager.isConnected(server.name)) {
              continue;
            }
            
            // Backward compatibility: if only name and url, assume http transport
            pending.push(
              manager
                .connect({
                  name: server.name,
                  transport: "http",
                  url: server.url,
                })
                .catch((error) => {
                  console.error(`Failed to connect MCP server ${server.name}:`, error);
                })
            );
          }
        }
      }
    } catch (error) {
      console.error("Failed to parse MCP_DEFAULT_SERVERS:", error);
    }
  }

  if (pending.length === 0) {
    return Promise.resolve();
  }

  return Promise.allSettled(pending).then(() => undefined);
};

export function getSharedMCPManager(): MCPManager {
  if (!mcpManager) {
    mcpManager = new MCPManager();
  }
  return mcpManager;
}

export async function ensureMCPInitialized(): Promise<MCPManager> {
  const manager = getSharedMCPManager();
  
  // Start initialization if not already started
  if (!initializationStarted) {
    initializationStarted = true;
    initializationPromise = initializeManager(manager);
    // Wait for initialization to complete (but don't fail on errors)
    initializationPromise.catch(() => {
      // Errors already logged during initialization
    });
  }
  
  // Wait for initialization to complete
  if (initializationPromise) {
    const waitMs = Number(process.env.MCP_INIT_WAIT_MS ?? "2000");
    const guardedInit = initializationPromise.catch(() => {
      // Errors already handled above
    });

    if (waitMs > 0) {
      await Promise.race([
        guardedInit,
        new Promise((resolve) => setTimeout(resolve, waitMs)),
      ]);
    } else {
      await guardedInit;
    }
  }
  
  return manager;
}
