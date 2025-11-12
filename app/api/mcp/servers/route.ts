// app/api/mcp/servers/route.ts
import { NextRequest, NextResponse } from "next/server";
import { MCPServerConfig } from "@/lib/mcp";
import { ensureMCPInitialized, getSharedMCPManager } from "@/lib/mcp-manager";

export const runtime = "nodejs";

// Explicitly export methods for Next.js route handler
export const dynamic = "force-dynamic";

// GET: List all connected MCP servers and their tools
export async function GET() {
  try {
    // Wait for initialization to complete (with timeout)
    await ensureMCPInitialized();
    const mcp = getSharedMCPManager();
    
    // Give servers a moment to fully connect
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const connected = mcp.listConnected();
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[MCP API] Connected servers: ${connected.join(', ') || 'none'}`);
    }
    
    // Try to get tools, but don't fail if servers are still connecting
    let tools: { server: string; tool: any }[] = [];
    try {
      tools = await mcp.listAllTools();
      if (process.env.NODE_ENV === 'development') {
        console.log(`[MCP API] Loaded ${tools.length} tools from ${new Set(tools.map(t => t.server)).size} servers`);
      }
    } catch (error) {
      // If tools can't be listed (e.g., servers still connecting), return empty list
      console.warn("Some MCP servers may still be connecting:", error);
    }
    
    // Group tools by server
    const servers = connected.map(server => ({
      name: server,
      tools: tools.filter(t => t.server === server).map(t => ({
        name: t.tool.name,
        description: t.tool.description
      }))
    }));
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[MCP API] Returning ${servers.length} servers to UI`);
    }
    
    return Response.json({ servers });
  } catch (error) {
    console.error("Error listing MCP servers:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST: Connect a new MCP server
export async function POST(req: NextRequest) {
  try {
    const config: MCPServerConfig = await req.json();
    
    // Validate config
    if (!config.name || !config.transport) {
      return Response.json(
        { error: "Missing required fields: name, transport" },
        { status: 400 }
      );
    }
    
    if (config.transport === 'stdio' && (!config.command)) {
      return Response.json(
        { error: "stdio transport requires 'command' field" },
        { status: 400 }
      );
    }
    
    if (config.transport === 'http' && (!config.url)) {
      return Response.json(
        { error: "http transport requires 'url' field" },
        { status: 400 }
      );
    }
    
    // Check if stdio is allowed
    if (config.transport === 'stdio' && process.env.MCP_ENABLE_STDIO !== 'true') {
      return Response.json(
        { error: "stdio transport is disabled. Set MCP_ENABLE_STDIO=true to enable." },
        { status: 403 }
      );
    }
    
    const mcp = getSharedMCPManager();
    await mcp.connect(config);
    
    return Response.json({ success: true, server: config.name });
  } catch (error) {
    console.error("Error connecting MCP server:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// DELETE: Disconnect an MCP server
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const serverName = searchParams.get("name");
    
    if (!serverName) {
      return Response.json(
        { error: "Missing 'name' parameter" },
        { status: 400 }
      );
    }
    
    // Don't allow disconnecting Exa (it's auto-connected)
    if (serverName === 'exa') {
      return Response.json(
        { error: "Cannot disconnect Exa server (auto-connected)" },
        { status: 403 }
      );
    }
    
    const mcp = getSharedMCPManager();
    await mcp.disconnect(serverName);
    
    return Response.json({ success: true });
  } catch (error) {
    console.error("Error disconnecting MCP server:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// OPTIONS: Handle CORS preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
