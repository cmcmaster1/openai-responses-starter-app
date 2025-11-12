import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createInitialChatMessages } from "@/lib/chat-defaults";
import { Item, ToolCallItem, MessageItem, ReasoningItem } from "@/lib/assistant";

export interface ConversationSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  chatMessages: Item[];
  conversationItems: any[];
}

const MAX_PERSISTED_CHAT_MESSAGES = 80;
const MAX_PERSISTED_CONVERSATION_ITEMS = 120;
const MAX_PERSISTED_STRING_LENGTH = 4000;
const TRUNCATION_SUFFIX = "… [truncated]";

const generateId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // fall back below
    }
  }
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

const createEmptySession = (title = "New chat"): ConversationSession => ({
  id: generateId(),
  title,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  chatMessages: createInitialChatMessages(),
  conversationItems: [],
});

type SessionUpdate = {
  title?: string;
  chatMessages?: Item[];
  conversationItems?: any[];
};

interface SessionsState {
  sessions: ConversationSession[];
  currentSessionId: string | null;
  createSession: (title?: string) => ConversationSession;
  selectSession: (id: string) => ConversationSession | undefined;
  updateSession: (id: string, update: SessionUpdate) => void;
  clearSession: (id: string) => ConversationSession | undefined;
  deleteSession: (id: string) => ConversationSession | undefined;
}

const truncateString = <T extends string | null | undefined>(
  value: T,
  limit = MAX_PERSISTED_STRING_LENGTH
): T => {
  if (typeof value !== "string") return value;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}${TRUNCATION_SUFFIX}` as T;
};

const shallowClone = <T,>(value: T): T => {
  if (typeof value !== "object" || value === null) return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // fall back
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

const sanitizeMessageItem = (item: Item): Item => {
  if (item.type === "message") {
    const cloned: MessageItem = shallowClone(item);
    cloned.content = cloned.content.map((content) => {
      if (content && typeof content === "object" && typeof content.text === "string") {
        return { ...content, text: truncateString(content.text) as string };
      }
      return content;
    });
    return cloned;
  }
  if (item.type === "tool_call") {
    const cloned: ToolCallItem = shallowClone(item);
    cloned.arguments = truncateString(cloned.arguments) as string | undefined;
    cloned.output = truncateString(cloned.output) as string | null | undefined;
    cloned.parsedArguments = undefined;
    return cloned;
  }
  if (item.type === "reasoning") {
    const cloned: ReasoningItem = shallowClone(item);
    cloned.content = truncateString(cloned.content) as string;
    return cloned;
  }
  return shallowClone(item);
};

const sanitizeConversationItem = (item: any) => {
  const cloned = shallowClone(item);
  if (!cloned) return cloned;
  if (typeof cloned === "string") {
    return truncateString(cloned);
  }

  if (typeof cloned === "object") {
    if (typeof cloned.content === "string") {
      cloned.content = truncateString(cloned.content);
    } else if (Array.isArray(cloned.content)) {
      cloned.content = cloned.content.map((entry: any) => {
        if (typeof entry === "string") return truncateString(entry);
        if (entry && typeof entry === "object" && typeof entry.text === "string") {
          return { ...entry, text: truncateString(entry.text) };
        }
        return entry;
      });
    }
    if (typeof cloned.arguments === "string") {
      cloned.arguments = truncateString(cloned.arguments);
    }
    if (typeof cloned.output === "string") {
      cloned.output = truncateString(cloned.output);
    }
    if (typeof cloned.result === "string") {
      cloned.result = truncateString(cloned.result);
    }
  }

  return cloned;
};

const sanitizeSessionForStorage = (session: ConversationSession): ConversationSession => {
  return {
    ...session,
    chatMessages: session.chatMessages
      .slice(-MAX_PERSISTED_CHAT_MESSAGES)
      .map(sanitizeMessageItem),
    conversationItems: session.conversationItems
      .slice(-MAX_PERSISTED_CONVERSATION_ITEMS)
      .map(sanitizeConversationItem),
  };
};

const useSessionsStore = create<SessionsState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,
      createSession: (title) => {
        const session = createEmptySession(title);
        set((state) => ({
          sessions: [session, ...state.sessions],
          currentSessionId: session.id,
        }));
        return session;
      },
      selectSession: (id) => {
        const session = get().sessions.find((s) => s.id === id);
        if (session) {
          set({ currentSessionId: id });
        }
        return session;
      },
      updateSession: (id, update) => {
        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== id) return session;
            const next: ConversationSession = {
              ...session,
              chatMessages: update.chatMessages ?? session.chatMessages,
              conversationItems: update.conversationItems ?? session.conversationItems,
              title: update.title ?? session.title,
              updatedAt: Date.now(),
            };
            return next;
          }),
        }));
      },
      clearSession: (id) => {
        let cleared: ConversationSession | undefined;
        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== id) return session;
            cleared = {
              ...session,
              title: "New chat",
              chatMessages: createInitialChatMessages(),
              conversationItems: [],
              updatedAt: Date.now(),
            };
            return cleared!;
          }),
        }));
        return cleared;
      },
      deleteSession: (id) => {
        let nextSession: ConversationSession | undefined;
        set((state) => {
          const remaining = state.sessions.filter((session) => session.id !== id);
          if (state.currentSessionId === id) {
            nextSession = remaining[0];
          } else {
            nextSession = remaining.find((session) => session.id === state.currentSessionId);
          }
          return {
            sessions: remaining,
            currentSessionId: nextSession?.id ?? null,
          };
        });
        return nextSession;
      },
    }),
    {
      name: "sessions-store",
      partialize: (state) => ({
        currentSessionId: state.currentSessionId,
        sessions: state.sessions.map(sanitizeSessionForStorage),
      }),
    }
  )
);

export default useSessionsStore;
