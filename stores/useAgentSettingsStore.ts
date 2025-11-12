import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_REASONING_LEVEL } from "@/config/constants";
import { DEVELOPER_PROMPTS, getPromptById } from "@/config/developer-prompts";

interface AgentSettingsState {
  developerPrompt: string;
  selectedPromptId: string | null;
  reasoningLevel: string;
  setDeveloperPrompt: (prompt: string) => void;
  setSelectedPromptId: (id: string | null) => void;
  setReasoningLevel: (level: string) => void;
}

const useAgentSettingsStore = create<AgentSettingsState>()(
  persist(
    (set) => ({
      developerPrompt: "",
      selectedPromptId: null,
      reasoningLevel: DEFAULT_REASONING_LEVEL,
      setDeveloperPrompt: (prompt) => set({ developerPrompt: prompt }),
      setSelectedPromptId: (id) => {
        const prompt = id ? getPromptById(id) : null;
        set({
          selectedPromptId: id,
          developerPrompt: prompt?.prompt || "",
        });
      },
      setReasoningLevel: (level) => set({ reasoningLevel: level }),
    }),
    {
      name: "agent-settings-store",
    }
  )
);

export default useAgentSettingsStore;
