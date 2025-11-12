"use client";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { Check } from "lucide-react";

interface MCPServer {
  name: string;
  tools: Array<{ name: string; description?: string }>;
}

interface MCPServerToggleProps {
  enabledServers: string[];
  onToggle: (serverName: string) => void;
}

export default function MCPServerToggle({ enabledServers, onToggle }: MCPServerToggleProps) {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const lastSnapshotRef = useRef<string>("");

  const loadServers = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/mcp/servers");
      if (!response.ok) throw new Error("Failed to load servers");
      const data = await response.json();
      const loadedServers = data.servers || [];
      const serialized = JSON.stringify(loadedServers);
      if (serialized !== lastSnapshotRef.current) {
        lastSnapshotRef.current = serialized;
        setServers(loadedServers);
      }
      
      // If no servers found and we haven't retried too many times, retry after a delay
      if (loadedServers.length === 0 && retryCount < 3) {
        setTimeout(() => {
          setRetryCount(prev => prev + 1);
        }, 2000);
      }
    } catch (e) {
      console.error("Failed to load MCP servers:", e);
      // Retry on error
      if (retryCount < 3) {
        setTimeout(() => {
          setRetryCount(prev => prev + 1);
        }, 2000);
      }
    } finally {
      setLoading(false);
    }
  }, [retryCount]);

  useEffect(() => {
    loadServers();
  }, [loadServers]);
  
  useEffect(() => {
    const pollDuration =
      Number(process.env.NEXT_PUBLIC_MCP_SERVERS_POLL_DURATION_MS ?? "30000");
    const pollInterval =
      Number(process.env.NEXT_PUBLIC_MCP_SERVERS_POLL_INTERVAL_MS ?? "5000");
    if (pollDuration <= 0 || pollInterval <= 0) {
      return;
    }

    const start = Date.now();
    const intervalId = setInterval(() => {
      if (Date.now() - start >= pollDuration) {
        clearInterval(intervalId);
        return;
      }
      loadServers();
    }, pollInterval);

    return () => clearInterval(intervalId);
  }, [loadServers]);
  
  // Retry when retryCount changes
  useEffect(() => {
    if (retryCount > 0 && retryCount < 3) {
      const timer = setTimeout(() => {
        loadServers();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [retryCount, loadServers]);

  // Don't show anything if loading and no servers yet (first load)
  if (loading && servers.length === 0 && retryCount === 0) {
    return null;
  }

  // Show loading state if we're retrying
  if (loading && servers.length === 0) {
    return (
      <div className="flex items-center gap-2 px-2 pb-2 text-xs text-gray-500">
        <span>Loading MCP servers...</span>
      </div>
    );
  }

  // Don't show anything if no servers after retries
  if (servers.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 px-2 pb-2">
      {servers.map((server) => {
        const isEnabled = enabledServers.includes(server.name);
        return (
          <button
            key={server.name}
            onClick={() => onToggle(server.name)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              isEnabled
                ? "bg-blue-100 text-blue-700 border border-blue-300"
                : "bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200"
            }`}
            title={`${server.tools.length} tool${server.tools.length !== 1 ? "s" : ""} available`}
          >
            {isEnabled && <Check className="h-3 w-3" />}
            <span>{server.name}</span>
            {server.tools.length > 0 && (
              <span className="text-[10px] opacity-70">({server.tools.length})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
