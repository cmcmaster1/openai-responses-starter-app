import useConversationStore from "@/stores/useConversationStore";
import useAgentSettingsStore from "@/stores/useAgentSettingsStore";
import { Annotation } from "@/components/annotations";

export interface ContentItem {
  type: "input_text" | "output_text" | "refusal" | "output_audio";
  annotations?: Annotation[];
  text?: string;
}

// Message items for storing conversation history matching API shape
export interface MessageItem {
  type: "message";
  role: "user" | "assistant" | "system";
  id?: string;
  content: ContentItem[];
}

// Custom items to display in chat
export interface ToolCallItem {
  type: "tool_call";
  tool_type:
    | "mcp_call";
  status: "in_progress" | "completed" | "failed" | "searching";
  id: string;
  name?: string | null;
  call_id?: string;
  arguments?: string;
  parsedArguments?: any;
  output?: string | null;
  code?: string;
  files?: {
    file_id: string;
    mime_type: string;
    container_id?: string;
    filename?: string;
  }[];
}

export interface McpListToolsItem {
  type: "mcp_list_tools";
  id: string;
  server_label: string;
  tools: { name: string; description?: string }[];
}

export interface McpApprovalRequestItem {
  type: "mcp_approval_request";
  id: string;
  server_label: string;
  name: string;
  arguments?: string;
}

export interface ReasoningItem {
  type: "reasoning";
  id?: string;
  content: string;
}

export type Item =
  | MessageItem
  | ToolCallItem
  | McpListToolsItem
  | McpApprovalRequestItem
  | ReasoningItem;

export const handleTurn = async (
  messages: any[],
  onMessage: (event: string, data: any) => void,
  enabledMcpServers?: string[] | null,
  options?: {
    developerPrompt?: string;
    reasoningLevel?: string;
  }
) => {
  try {
    // Get response from the API (defined in app/api/chat/route.ts)
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages,
        enabled_mcp_servers: enabledMcpServers,
        developer_prompt: options?.developerPrompt,
        reasoning_level: options?.reasoningLevel,
      }),
    });

    if (!response.ok) {
      console.error(`Error: ${response.status} - ${response.statusText}`);
      return;
    }

    // Reader for streaming SSE data
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let buffer = "";
    let currentEvent = "";
    let currentData = "";

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }

      // Parse SSE format: event: <event>\ndata: <json>\n\n
      // Events are separated by double newlines
      const parts = buffer.split("\n\n");
      // Keep the last incomplete part in buffer
      buffer = parts.pop() || "";

      for (const part of parts) {
        const lines = part.split("\n");
        currentEvent = "";
        currentData = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            currentData = line.slice(6);
          }
        }

        // Process complete event
        if (currentEvent || currentData) {
          if (currentEvent === "done") {
            done = true;
            break;
          }
          if (currentData.trim()) {
            try {
              const data = JSON.parse(currentData);
              onMessage(currentEvent || "message", data);
            } catch (e) {
              console.error("Failed to parse SSE data:", currentData, e);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("Error handling turn:", error);
    onMessage("error", { message: error instanceof Error ? error.message : "Unknown error" });
  }
};

export const processMessages = async (enabledMcpServers?: string[] | null) => {
  const {
    chatMessages,
    conversationItems,
    setChatMessages,
    setConversationItems,
    setAssistantLoading,
  } = useConversationStore.getState();
  const { developerPrompt, reasoningLevel } = useAgentSettingsStore.getState();

  const allConversationItems = conversationItems;

  let assistantMessageContent = "";

  await handleTurn(
    allConversationItems,
    async (event: string, data: any) => {
      switch (event) {
        case "message": {
          const { delta, role } = data;
          if (role === "assistant" && typeof delta === "string") {
            assistantMessageContent += delta;

            const lastItem = chatMessages[chatMessages.length - 1];
            if (
              !lastItem ||
              lastItem.type !== "message" ||
              lastItem.role !== "assistant"
            ) {
              chatMessages.push({
                type: "message",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: assistantMessageContent,
                  },
                ],
              } as MessageItem);
            } else {
              const contentItem = lastItem.content[0];
              if (contentItem && contentItem.type === "output_text") {
                contentItem.text = assistantMessageContent;
              }
            }

            setChatMessages([...chatMessages]);
            setAssistantLoading(false);
          }
          break;
        }

        case "tool_call": {
          const { name, args, call_id } = data;
          chatMessages.push({
            type: "tool_call",
            tool_type: "mcp_call",
            status: "in_progress",
            id: call_id || `tool_${Date.now()}`,
            name: name,
            arguments: JSON.stringify(args || {}),
            parsedArguments: args || {},
            output: null,
            call_id: call_id,
          });
          setChatMessages([...chatMessages]);

          if (call_id && name) {
            conversationItems.push({
              role: "assistant",
              content: [
                {
                  type: "function_call",
                  id: call_id,
                  call_id,
                  name,
                  arguments: JSON.stringify(args || {}),
                },
              ],
            } as any);
            setConversationItems([...conversationItems]);
          }
          break;
        }

        case "tool_result": {
          const { name, result, call_id } = data;
          const toolCallMessage = chatMessages.find(
            (m) => m.type === "tool_call" && m.call_id === call_id
          ) as ToolCallItem | undefined;

          if (toolCallMessage) {
            toolCallMessage.output = JSON.stringify(result);
            toolCallMessage.status = "completed";
            setChatMessages([...chatMessages]);
          }

          conversationItems.push({
            role: "tool",
            name: name,
            content: JSON.stringify(result),
            call_id: call_id,
          } as any);
          setConversationItems([...conversationItems]);
          break;
        }

        case "reasoning": {
          const { content, item_id } = data;
          if (content) {
            const contentStr = String(content);
            let reasoningItem =
              chatMessages.find(
                (item) => item.type === "reasoning" && item.id === item_id
              ) as ReasoningItem | undefined;
            if (!reasoningItem) {
              reasoningItem = {
                type: "reasoning",
                id: item_id,
                content: contentStr,
              };
              chatMessages.push(reasoningItem);
            } else {
              reasoningItem.content = contentStr;
            }
            setChatMessages([...chatMessages]);
          }
          break;
        }

        case "done": {
          if (assistantMessageContent) {
            const lastItem = chatMessages[chatMessages.length - 1];
            if (lastItem && lastItem.type === "message" && lastItem.role === "assistant") {
              conversationItems.push({
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: assistantMessageContent,
                  },
                ],
              } as any);
              setConversationItems([...conversationItems]);
            }
            assistantMessageContent = "";
          }
          setAssistantLoading(false);
          break;
        }

        case "error": {
          console.error("Stream error:", data?.message || data);
          setAssistantLoading(false);
          break;
        }

        default:
          break;
      }
    },
    enabledMcpServers,
    {
      developerPrompt,
      reasoningLevel,
    }
  );
};
