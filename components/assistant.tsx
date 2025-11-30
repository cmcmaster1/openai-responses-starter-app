"use client";
import React from "react";
import Chat from "./chat";
import useConversationStore from "@/stores/useConversationStore";
import { Item, UploadedContextFile, processMessages } from "@/lib/assistant";
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

  const formatBytes = (bytes: number) => {
    if (!bytes || Number.isNaN(bytes)) return "";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(
      units.length - 1,
      Math.floor(Math.log(bytes) / Math.log(1024))
    );
    const value = bytes / 1024 ** i;
    return `${value.toFixed(value >= 10 ? 0 : 1)}${units[i]}`;
  };

  const handleSendMessage = async (
    message: string,
    enabledMcpServers?: string[] | null,
    attachments?: UploadedContextFile[]
  ) => {
    const trimmed = message.trim();
    const safeAttachments = attachments ?? [];
    if (!trimmed && safeAttachments.length === 0) return;

    const userItem: Item = {
      type: "message",
      role: "user",
      content: [
        ...(trimmed
          ? [
              {
                type: "input_text" as const,
                text: trimmed,
              },
            ]
          : []),
        ...safeAttachments.map((file) => {
          const header = [
            `Attachment: ${file.name}`,
            file.mimeType ? `(${file.mimeType})` : null,
            formatBytes(file.size),
            file.truncated ? "truncated for length" : null,
          ]
            .filter(Boolean)
            .join(" ");

          return {
            type: "input_text" as const,
            text: `${header}\n\n${file.text}`,
            metadata: {
              kind: "attachment",
              filename: file.name,
              mime_type: file.mimeType,
              size: file.size,
              truncated: file.truncated,
            },
          };
        }),
      ],
    };
    const userMessage: any = {
      role: "user",
      content: userItem.content,
    };

    const existingUserMessages = chatMessages.filter(
      (item) => item.type === "message" && item.role === "user"
    );
    if (existingUserMessages.length === 0 && trimmed) {
      generateSessionTitle(trimmed);
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
