"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import ToolCall from "./tool-call";
import Message from "./message";
import Annotations from "./annotations";
import McpToolsList from "./mcp-tools-list";
import McpApproval from "./mcp-approval";
import ReasoningTrace from "./reasoning-trace";
import {
  Item,
  McpApprovalRequestItem,
  ReasoningItem,
  UploadedContextFile,
} from "@/lib/assistant";
import LoadingMessage from "./loading-message";
import useConversationStore from "@/stores/useConversationStore";
import MCPServerToggle from "./mcp-server-toggle";
import { FileText, Loader2, Paperclip, X as CloseIcon } from "lucide-react";

interface ChatProps {
  items: Item[];
  onSendMessage: (
    message: string,
    enabledMcpServers?: string[] | null,
    attachments?: UploadedContextFile[]
  ) => void;
  onApprovalResponse: (approve: boolean, id: string) => void;
}

const Chat: React.FC<ChatProps> = ({
  items,
  onSendMessage,
  onApprovalResponse,
}) => {
  const itemsEndRef = useRef<HTMLDivElement>(null);
  const [inputMessageText, setinputMessageText] = useState<string>("");
  // This state is used to provide better user experience for non-English IMEs such as Japanese
  const [isComposing, setIsComposing] = useState(false);
  const [enabledMcpServers, setEnabledMcpServers] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<UploadedContextFile[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { isAssistantLoading } = useConversationStore();

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
  
  const handleToggleServer = (serverName: string) => {
    setEnabledMcpServers((prev) => {
      if (prev.includes(serverName)) {
        return prev.filter((s) => s !== serverName);
      } else {
        return [...prev, serverName];
      }
    });
  };

  const scrollToBottom = () => {
    itemsEndRef.current?.scrollIntoView({ behavior: "instant" });
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);

    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/uploads", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "Failed to process file");
        }

        const attachment: UploadedContextFile = {
          id:
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `${Date.now()}_${Math.random().toString(16).slice(2)}`,
          name: data.filename || file.name,
          mimeType: data.mime_type || file.type || "application/octet-stream",
          size: typeof data.size === "number" ? data.size : file.size,
          text: data.text,
          truncated: !!data.truncated,
        };
        setAttachments((prev) => [...prev, attachment]);
      } catch (error: any) {
        console.error("Upload error:", error);
        setUploadError(error?.message || "Unable to read file");
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setUploading(false);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((file) => file.id !== id));
  };

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey && !isComposing) {
        event.preventDefault();
        if (uploading || (!inputMessageText.trim() && attachments.length === 0)) {
          return;
        }
        onSendMessage(
          inputMessageText,
          enabledMcpServers.length > 0 ? enabledMcpServers : null,
          attachments
        );
        setinputMessageText("");
        setAttachments([]);
      }
    },
    [
      onSendMessage,
      inputMessageText,
      isComposing,
      enabledMcpServers,
      attachments,
      uploading,
    ]
  );
  
  const handleSendClick = () => {
    if (uploading || (!inputMessageText.trim() && attachments.length === 0)) {
      return;
    }
    onSendMessage(
      inputMessageText,
      enabledMcpServers.length > 0 ? enabledMcpServers : null,
      attachments
    );
    setinputMessageText("");
    setAttachments([]);
  };

  useEffect(() => {
    scrollToBottom();
  }, [items]);

  return (
    <div className="flex justify-center items-center size-full px-4 sm:px-6 lg:px-10">
      <div className="flex grow flex-col h-full w-full max-w-[1200px] gap-2">
        <div className="h-[90vh] overflow-y-auto flex flex-col">
          <div className="mt-auto space-y-5 pt-4">
            {items.map((item, index) => (
              <React.Fragment key={index}>
                {item.type === "tool_call" ? (
                  <ToolCall toolCall={item} />
                ) : item.type === "message" ? (
                  <div className="flex flex-col gap-1">
                    <Message message={item} />
                    {item.content &&
                      item.content[0].annotations &&
                      item.content[0].annotations.length > 0 && (
                        <Annotations
                          annotations={item.content[0].annotations}
                        />
                      )}
                  </div>
                ) : item.type === "mcp_list_tools" ? (
                  <McpToolsList item={item} />
                ) : item.type === "mcp_approval_request" ? (
                  <McpApproval
                    item={item as McpApprovalRequestItem}
                    onRespond={onApprovalResponse}
                  />
                ) : item.type === "reasoning" ? (
                  <ReasoningTrace item={item as ReasoningItem} />
                ) : null}
              </React.Fragment>
            ))}
            {isAssistantLoading && <LoadingMessage />}
            <div ref={itemsEndRef} />
          </div>
        </div>
        <div className="flex-1 p-4 px-10">
          <div className="flex items-center">
            <div className="flex w-full items-center pb-4 md:pb-1">
              <div className="flex w-full flex-col gap-1.5 rounded-[20px] p-2.5 pl-1.5 transition-colors bg-white border border-stone-200 shadow-sm">
                <MCPServerToggle
                  enabledServers={enabledMcpServers}
                  onToggle={handleToggleServer}
                />
                <div className="flex items-center gap-2 px-4">
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Paperclip size={14} />
                    )}
                    {uploading ? "Processing..." : "Attach file"}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.markdown,.pdf,.csv,.json,text/plain,application/pdf"
                    multiple
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  {uploadError && (
                    <span className="text-xs text-red-600">{uploadError}</span>
                  )}
                </div>
                {attachments.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 px-4">
                    {attachments.map((file) => (
                      <div
                        key={file.id}
                        className="group flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-800"
                      >
                        <FileText size={14} className="text-zinc-500" />
                        <span className="max-w-[180px] truncate font-medium">
                          {file.name}
                        </span>
                        <span className="text-[11px] text-zinc-500">
                          {formatBytes(file.size)}
                          {file.truncated ? " · truncated" : ""}
                        </span>
                        <button
                          type="button"
                          className="text-zinc-400 transition-colors hover:text-zinc-600"
                          onClick={() => removeAttachment(file.id)}
                          aria-label={`Remove ${file.name}`}
                        >
                          <CloseIcon size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-1.5 md:gap-2 pl-4">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <textarea
                      id="prompt-textarea"
                      tabIndex={0}
                      dir="auto"
                      rows={2}
                      placeholder="Message..."
                      className="mb-2 resize-none border-0 focus:outline-none text-sm bg-transparent px-0 pb-6 pt-2"
                      value={inputMessageText}
                      onChange={(e) => setinputMessageText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onCompositionStart={() => setIsComposing(true)}
                      onCompositionEnd={() => setIsComposing(false)}
                    />
                  </div>
                  <button
                    disabled={
                      (!inputMessageText.trim() && attachments.length === 0) ||
                      uploading
                    }
                    data-testid="send-button"
                    className="flex size-8 items-end justify-center rounded-full bg-black text-white transition-colors hover:opacity-70 focus-visible:outline-none focus-visible:outline-black disabled:bg-[#D7D7D7] disabled:text-[#f4f4f4] disabled:hover:opacity-100"
                    onClick={handleSendClick}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="32"
                      height="32"
                      fill="none"
                      viewBox="0 0 32 32"
                      className="icon-2xl"
                    >
                      <path
                        fill="currentColor"
                        fillRule="evenodd"
                        d="M15.192 8.906a1.143 1.143 0 0 1 1.616 0l5.143 5.143a1.143 1.143 0 0 1-1.616 1.616l-3.192-3.192v9.813a1.143 1.143 0 0 1-2.286 0v-9.813l-3.192 3.192a1.143 1.143 0 1 1-1.616-1.616z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Chat;
