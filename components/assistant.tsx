"use client";
import React from "react";
import Chat from "./chat";
import useConversationStore from "@/stores/useConversationStore";
import { Item, processMessages } from "@/lib/assistant";
import useSessionsStore from "@/stores/useSessionsStore";

export default function Assistant() {
  const {
    chatMessages,
    conversationItems,
    addConversationItem,
    addChatMessage,
    setAssistantLoading,
  } = useConversationStore();
  const { sessions, currentSessionId, updateSession } = useSessionsStore();

  const generateSessionTitle = React.useCallback(
    async (message: string) => {
      if (!currentSessionId) return;
      const current = sessions.find((s) => s.id === currentSessionId);
      if (!current) return;
      const needsTitle = !current.title || current.title.trim() === "" || current.title === "New chat";
      if (!needsTitle) return;
      const trimmed = message.trim();
      if (!trimmed) return;
      try {
        const res = await fetch("/api/chat/title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: trimmed }),
        });
        if (!res.ok) {
          console.error("Failed to generate title", res.statusText);
          updateSession(currentSessionId, { title: trimmed.slice(0, 60) });
          return;
        }
        const data = await res.json();
        const title = typeof data.title === "string" ? data.title.trim() : "";
        if (title) {
          updateSession(currentSessionId, { title });
        } else {
          updateSession(currentSessionId, { title: trimmed.slice(0, 60) });
        }
      } catch (error) {
        console.error("Error generating session title:", error);
        updateSession(currentSessionId, { title: trimmed.slice(0, 60) });
      }
    },
    [currentSessionId, sessions, updateSession]
  );

  React.useEffect(() => {
    if (!currentSessionId) return;
    updateSession(currentSessionId, {
      chatMessages,
      conversationItems,
    });
  }, [chatMessages, conversationItems, currentSessionId, updateSession]);

  const handleSendMessage = async (message: string, enabledMcpServers?: string[] | null) => {
    if (!message.trim()) return;

    const userItem: Item = {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: message.trim() }],
    };
    const userMessage: any = {
      role: "user",
      content: message.trim(),
    };

    const existingUserMessages = chatMessages.filter(
      (item) => item.type === "message" && item.role === "user"
    );
    if (existingUserMessages.length === 0) {
      generateSessionTitle(message);
    }

    try {
      setAssistantLoading(true);
      addConversationItem(userMessage);
      addChatMessage(userItem);
      await processMessages(enabledMcpServers);
    } catch (error) {
      console.error("Error processing message:", error);
    }
  };

  const handleApprovalResponse = async (
    approve: boolean,
    id: string
  ) => {
    const approvalItem = {
      type: "mcp_approval_response",
      approve,
      approval_request_id: id,
    } as any;
    try {
      addConversationItem(approvalItem);
      await processMessages();
    } catch (error) {
      console.error("Error sending approval response:", error);
    }
  };

  return (
    <div className="h-full p-4 w-full bg-white">
      <Chat
        items={chatMessages}
        onSendMessage={handleSendMessage}
        onApprovalResponse={handleApprovalResponse}
      />
    </div>
  );
}
