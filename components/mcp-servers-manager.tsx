"use client";
import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Plus, X, Trash2, AlertCircle } from "lucide-react";

interface MCPServer {
  name: string;
  tools: Array<{ name: string; description?: string }>;
}

interface AddServerForm {
  name: string;
  transport: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
}

export default function MCPServersManager() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [formData, setFormData] = useState<AddServerForm>({
    name: "",
    transport: "http",
    url: "",
    command: "",
    args: [],
  });

  const loadServers = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/mcp/servers");
      if (!response.ok) throw new Error("Failed to load servers");
      const data = await response.json();
      setServers(data.servers || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load servers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadServers();
  }, []);

  const handleAddServer = async () => {
    if (!formData.name.trim()) {
      setError("Server name is required");
      return;
    }

    if (formData.transport === "http" && !formData.url?.trim()) {
      setError("URL is required for HTTP transport");
      return;
    }

    if (formData.transport === "stdio" && !formData.command?.trim()) {
      setError("Command is required for stdio transport");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const config: any = {
        name: formData.name.trim(),
        transport: formData.transport,
      };

      if (formData.transport === "http") {
        config.url = formData.url?.trim();
      } else {
        config.command = formData.command?.trim();
        if (formData.args && formData.args.length > 0) {
          config.args = formData.args.filter((a) => a.trim()).map((a) => a.trim());
        }
      }

      const response = await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to connect server");
      }

      // Reset form and reload servers
      setFormData({ name: "", transport: "http", url: "", command: "", args: [] });
      setIsAddDialogOpen(false);
      await loadServers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add server");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveServer = async (serverName: string) => {
    if (!confirm(`Disconnect server "${serverName}"?`)) return;

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/mcp/servers?name=${encodeURIComponent(serverName)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to disconnect server");
      }

      await loadServers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove server");
    } finally {
      setLoading(false);
    }
  };

  const addArg = () => {
    setFormData({
      ...formData,
      args: [...(formData.args || []), ""],
    });
  };

  const updateArg = (index: number, value: string) => {
    const newArgs = [...(formData.args || [])];
    newArgs[index] = value;
    setFormData({ ...formData, args: newArgs });
  };

  const removeArg = (index: number) => {
    const newArgs = formData.args?.filter((_, i) => i !== index) || [];
    setFormData({ ...formData, args: newArgs });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-zinc-600 text-sm font-medium">MCP Servers</div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setFormData({ name: "", transport: "http", url: "", command: "", args: [] });
                setError(null);
              }}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Server
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add MCP Server</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Server Name</label>
                <Input
                  placeholder="my-server"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Transport</label>
                <select
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={formData.transport}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      transport: e.target.value as "http" | "stdio",
                    })
                  }
                >
                  <option value="http">HTTP</option>
                  <option value="stdio">stdio (requires MCP_ENABLE_STDIO=true)</option>
                </select>
              </div>
              {formData.transport === "http" ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium">URL</label>
                  <Input
                    placeholder="https://example.com/mcp"
                    value={formData.url || ""}
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Command</label>
                  <Input
                    placeholder="npx"
                    value={formData.command || ""}
                    onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                  />
                  <label className="text-sm font-medium">Arguments (one per line)</label>
                  <div className="space-y-1">
                    {(formData.args || []).map((arg, idx) => (
                      <div key={idx} className="flex gap-1">
                        <Input
                          placeholder={`arg-${idx + 1}`}
                          value={arg}
                          onChange={(e) => updateArg(idx, e.target.value)}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => removeArg(idx)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={addArg}
                      className="w-full"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Argument
                    </Button>
                  </div>
                </div>
              )}
              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddServer} disabled={loading}>
                {loading ? "Connecting..." : "Connect"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error && servers.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-red-600 p-2 bg-red-50 rounded">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {loading && servers.length === 0 ? (
        <div className="text-sm text-zinc-400">Loading servers...</div>
      ) : servers.length === 0 ? (
        <div className="text-sm text-zinc-400">No MCP servers connected</div>
      ) : (
        <div className="space-y-2">
          {servers.map((server) => (
            <div
              key={server.name}
              className="border rounded p-3 bg-white space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">{server.name}</div>
                {server.name !== "exa" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveServer(server.name)}
                    disabled={loading}
                    className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
              {server.tools.length > 0 ? (
                <div className="text-xs text-zinc-500">
                  {server.tools.length} tool{server.tools.length !== 1 ? "s" : ""} available
                </div>
              ) : (
                <div className="text-xs text-zinc-400">No tools available</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

