"use client";

import React from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import useSessionsStore, { ConversationSession } from "@/stores/useSessionsStore";
import useConversationStore from "@/stores/useConversationStore";
import { Button } from "@/components/ui/button";
import MCPServersManager from "@/components/mcp-servers-manager";
import { Textarea } from "@/components/ui/textarea";
import useAgentSettingsStore from "@/stores/useAgentSettingsStore";
import { DEVELOPER_PROMPTS } from "@/config/developer-prompts";

const deepClone = <T,>(value: T): T => {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // fall back to JSON
    }
  }
  return JSON.parse(JSON.stringify(value));
};

const loadSessionIntoConversation = (
  session: ConversationSession,
  loadConversation: (messages: any[], conversationItems: any[]) => void
) => {
  // Only clone if we have data - empty arrays don't need cloning
  const messages =
    session.chatMessages.length > 0 ? deepClone(session.chatMessages) : session.chatMessages;
  const items =
    session.conversationItems.length > 0
      ? deepClone(session.conversationItems)
      : session.conversationItems;
  loadConversation(messages, items);
};

// Memoized session item to prevent unnecessary re-renders
const SessionItem = React.memo(
  ({
    session,
    isActive,
    canDelete,
    onSelect,
    onDelete,
  }: {
    session: ConversationSession;
    isActive: boolean;
    canDelete: boolean;
    onSelect: (session: ConversationSession) => void;
    onDelete: (id: string) => void;
  }) => {
    const handleClick = React.useCallback(() => {
      onSelect(session);
    }, [session, onSelect]);

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(session);
        }
      },
      [session, onSelect]
    );

    const handleDelete = React.useCallback(
      (event: React.MouseEvent) => {
        event.stopPropagation();
        onDelete(session.id);
      },
      [session.id, onDelete]
    );

    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={`w-full rounded-md px-3 py-2 text-sm transition-colors border cursor-pointer ${
          isActive
            ? "border-zinc-800 bg-white shadow-sm"
            : "border-transparent bg-transparent hover:bg-white hover:border-zinc-200"
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-zinc-800 break-words leading-snug">
              {session.title?.trim() || "New chat"}
            </div>
            <div className="text-xs text-zinc-500">{new Date(session.updatedAt).toLocaleString()}</div>
          </div>
          {canDelete && (
            <button
              type="button"
              onClick={handleDelete}
              className="shrink-0 text-zinc-400 hover:text-red-500 self-start mt-0.5"
              aria-label="Delete session"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }
);
SessionItem.displayName = "SessionItem";

const CollapsibleSection = ({
  title,
  children,
  defaultOpen = true,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  actions?: React.ReactNode;
}) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm font-semibold text-zinc-800">{title}</p>
        <div className="flex items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="rounded-full border border-transparent p-1 text-zinc-500 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
            aria-label={isOpen ? `Collapse ${title}` : `Expand ${title}`}
            aria-expanded={isOpen}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {isOpen && (
        <div className="border-t border-zinc-100 px-4 py-3 space-y-3 overflow-visible">{children}</div>
      )}
    </div>
  );
};

const REASONING_LEVEL_OPTIONS = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
] as const;

export default function SessionSidebar() {
  const { sessions, currentSessionId, createSession, selectSession, clearSession, deleteSession } =
    useSessionsStore();
  const { loadConversation } = useConversationStore();
  const {
    developerPrompt,
    selectedPromptId,
    reasoningLevel,
    setDeveloperPrompt,
    setSelectedPromptId,
    setReasoningLevel,
  } = useAgentSettingsStore();

  // Track if we've initialized to avoid re-running
  const initializedRef = React.useRef(false);
  const [sessionsHydrated, setSessionsHydrated] = React.useState(
    () => useSessionsStore.persist?.hasHydrated?.() ?? false
  );

  React.useEffect(() => {
    const unsubscribeFinish = useSessionsStore.persist?.onFinishHydration?.(() => {
      setSessionsHydrated(true);
    });
    const unsubscribeHydrate = useSessionsStore.persist?.onHydrate?.(() => {
      setSessionsHydrated(false);
    });
    return () => {
      unsubscribeFinish?.();
      unsubscribeHydrate?.();
    };
  }, []);

  React.useEffect(() => {
    if (!sessionsHydrated || initializedRef.current) return;

    if (sessions.length === 0) {
      initializedRef.current = true;
      const session = createSession();
      loadSessionIntoConversation(session, loadConversation);
      return;
    }
    const sessionToLoad =
      sessions.find((session) => session.id === currentSessionId) ?? sessions[0];
    selectSession(sessionToLoad.id);
    loadSessionIntoConversation(sessionToLoad, loadConversation);
    initializedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsHydrated, sessions, currentSessionId]);

  const handleNewSession = React.useCallback(() => {
    const session = createSession();
    loadSessionIntoConversation(session, loadConversation);
  }, [createSession, loadConversation]);

  const handleSelectSession = React.useCallback(
    (session: ConversationSession) => {
      // Skip if already selected
      if (session.id === currentSessionId) return;
      selectSession(session.id);
      loadSessionIntoConversation(session, loadConversation);
    },
    [currentSessionId, selectSession, loadConversation]
  );

  const handleClearCurrent = React.useCallback(() => {
    if (!currentSessionId) return;
    const cleared = clearSession(currentSessionId);
    if (cleared) {
      loadSessionIntoConversation(cleared, loadConversation);
    }
  }, [currentSessionId, clearSession, loadConversation]);

  const handleDelete = React.useCallback(
    (id: string) => {
      const nextSession = deleteSession(id);
      if (nextSession) {
        loadSessionIntoConversation(nextSession, loadConversation);
      } else if (sessions.length === 1) {
        const session = createSession();
        loadSessionIntoConversation(session, loadConversation);
      }
    },
    [sessions.length, deleteSession, createSession, loadConversation]
  );

  // Memoize session items at the top level (hooks must be called unconditionally)
  const sessionItems = React.useMemo(() => {
    return sessions.map((session) => {
      const isActive = session.id === currentSessionId;
      return (
        <SessionItem
          key={session.id}
          session={session}
          isActive={isActive}
          canDelete={sessions.length > 1}
          onSelect={handleSelectSession}
          onDelete={handleDelete}
        />
      );
    });
  }, [sessions, currentSessionId, handleSelectSession, handleDelete]);

  return (
    <div className="flex h-full w-full flex-col bg-zinc-50 border-r border-zinc-200">
      <div className="flex-1 overflow-y-auto space-y-4 p-4">
        <CollapsibleSection
          title="Sessions"
          actions={
            <Button size="sm" variant="outline" onClick={handleNewSession}>
              <Plus className="h-4 w-4 mr-1" />
              New chat
            </Button>
          }
        >
          {sessions.length === 0 ? (
            <div className="text-xs text-zinc-500">No conversations yet.</div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">{sessionItems}</div>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Conversation Controls">
          <Button
            variant="secondary"
            className="w-full"
            onClick={handleClearCurrent}
            disabled={!currentSessionId}
          >
            Clear conversation
          </Button>
        </CollapsibleSection>

        <CollapsibleSection title="Agent Settings">
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-600">Developer prompt template</label>
            <select
              value={selectedPromptId || ""}
              onChange={(event) => {
                const id = event.target.value || null;
                setSelectedPromptId(id);
              }}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
            >
              <option value="">Custom / None</option>
              {DEVELOPER_PROMPTS.map((prompt) => (
                <option key={prompt.id} value={prompt.id} title={prompt.description}>
                  {prompt.name}
                </option>
              ))}
            </select>
            {selectedPromptId && (
              <p className="text-xs text-zinc-500">
                {DEVELOPER_PROMPTS.find((p) => p.id === selectedPromptId)?.description}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-600">Developer prompt (editable)</label>
            <Textarea
              value={developerPrompt}
              onChange={(event) => {
                const newValue = event.target.value;
                setDeveloperPrompt(newValue);
                // If user manually edits, clear the selected prompt ID
                const currentPrompt = selectedPromptId ? DEVELOPER_PROMPTS.find((p) => p.id === selectedPromptId) : null;
                if (currentPrompt && newValue !== currentPrompt.prompt) {
                  setSelectedPromptId(null);
                }
              }}
              rows={6}
              className="text-xs"
              placeholder="Add optional developer instructions that apply after the system prompt"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-600">Reasoning level</label>
            <select
              value={reasoningLevel}
              onChange={(event) => setReasoningLevel(event.target.value.toLowerCase())}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
            >
              {REASONING_LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="MCP Servers">
          <div className="max-h-64 overflow-y-auto">
            <MCPServersManager />
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}
