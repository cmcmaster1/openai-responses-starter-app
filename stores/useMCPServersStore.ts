import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface MCPServer {
  name: string;
  tools: Array<{ name: string; description?: string }>;
}

interface MCPServersState {
  servers: MCPServer[];
  loading: boolean;
  error: string | null;
  loadedAt: number | null;
  setServers: (servers: MCPServer[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const useMCPServersStore = create<MCPServersState>()(
  persist(
    (set) => ({
      servers: [],
      loading: false,
      error: null,
      loadedAt: null,
      setServers: (servers) =>
        set({
          servers,
          loadedAt: Date.now(),
        }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      reset: () =>
        set({
          servers: [],
          loading: false,
          error: null,
          loadedAt: null,
        }),
    }),
    {
      name: "mcp-servers-store",
    }
  )
);

export default useMCPServersStore;
