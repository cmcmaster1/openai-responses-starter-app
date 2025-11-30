// app/api/chat/route.ts
import { NextRequest } from "next/server";
import { client, MODEL } from "@/lib/openai";
import { getSystemPrompt } from "@/config/constants";
import { toOpenAITool, sanitize } from "@/lib/mcp";
import { ensureMCPInitialized, getSharedMCPManager } from "@/lib/mcp-manager";

const enc = new TextEncoder();
const send = (c: ReadableStreamDefaultController, event: string, data: any) =>
  c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
const verboseLogs = process.env.AGENT_VERBOSE_LOGS === "true";
const debugLog = (...args: any[]) => {
  if (verboseLogs) console.log(...args);
};
const warnLog = (...args: any[]) => {
  if (verboseLogs) console.warn(...args);
};
const errorLog = (...args: any[]) => {
  if (verboseLogs) console.error(...args);
};

const validMessageRoles = new Set(["user", "assistant", "system", "developer"]);
const REASONING_LINE_REGEX = /Reasoning:\s*[^\n\r]*/i;

const applyReasoningLevelToPrompt = (prompt: string, level?: string) => {
  if (!level || typeof level !== "string") return prompt;
  const normalizedLevel = level.trim();
  if (!normalizedLevel) return prompt;
  const reasoningLine = `Reasoning: ${normalizedLevel}`;
  if (REASONING_LINE_REGEX.test(prompt)) {
    return prompt.replace(REASONING_LINE_REGEX, reasoningLine);
  }
  return `${reasoningLine}\n\n${prompt}`;
};

const coerceToInputTextBlocks = (content: any) => {
  const blocks: { type: "input_text"; text: string }[] = [];
  const pushText = (value: any) => {
    if (value === undefined || value === null) return;
    const text =
      typeof value === "string"
        ? value
        : typeof value.text === "string"
          ? value.text
          : typeof value.content === "string"
            ? value.content
            : typeof value.delta === "string"
              ? value.delta
              : JSON.stringify(value);
    if (text) {
      blocks.push({ type: "input_text", text: text });
    }
  };

  if (typeof content === "string") {
    pushText(content);
  } else if (Array.isArray(content)) {
    for (const entry of content) {
      if (typeof entry === "string") {
        pushText(entry);
      } else if (entry && typeof entry === "object") {
        pushText(entry);
      }
    }
  } else if (content && typeof content === "object") {
    pushText(content);
  }

  return blocks;
};

const normalizeConversationItems = (items: any[]): any[] => {
  const normalized: any[] = [];

  for (const item of items ?? []) {
    if (!item) continue;

    if (item.type === "function_call") {
      if (!item.call_id && item.id) item.call_id = item.id;
      if (!item.id && item.call_id) item.id = item.call_id;
      if (item.name && item.arguments) {
        normalized.push({
          type: "function_call",
          id: item.id || item.call_id,
          call_id: item.call_id || item.id,
          name: item.name,
          arguments:
            typeof item.arguments === "string"
              ? item.arguments
              : JSON.stringify(item.arguments),
          status: item.status ?? null,
        });
      }
      continue;
    }

    if (item.type === "function_call_output") {
      if (item.call_id && item.output !== undefined) {
        normalized.push({
          type: "function_call_output",
          call_id: item.call_id,
          name: item.name,
          output:
            typeof item.output === "string"
              ? item.output
              : JSON.stringify(item.output),
        });
      }
      continue;
    }

    if (item.role === "tool") {
      if (item.call_id && item.content !== undefined) {
        normalized.push({
          type: "function_call_output",
          call_id: item.call_id,
          name: item.name,
          output:
            typeof item.content === "string"
              ? item.content
              : JSON.stringify(item.content),
        });
      }
      continue;
    }

    if (
      item.role === "assistant" &&
      Array.isArray(item.content) &&
      item.content.length === 1 &&
      item.content[0]?.type === "function_call"
    ) {
      const fnCall = item.content[0];
      normalized.push({
        type: "function_call",
        id: fnCall.id || fnCall.call_id,
        call_id: fnCall.call_id || fnCall.id,
        name: fnCall.name,
        arguments:
          typeof fnCall.arguments === "string"
            ? fnCall.arguments
            : fnCall.arguments_json || JSON.stringify(fnCall.arguments ?? {}),
        status: fnCall.status ?? null,
      });
      continue;
    }

    if (validMessageRoles.has(item.role)) {
      const contentBlocks = coerceToInputTextBlocks(
        item.content ?? item.text ?? item.message ?? ""
      );
      if (!contentBlocks.length) continue;
      normalized.push({
        role: item.role,
        type: "message",
        content: contentBlocks,
      });
      continue;
    }

    if (item.type === "reasoning" && item.content) {
      normalized.push({
        role: "assistant",
        type: "message",
        content: [{ type: "input_text", text: String(item.content) }],
      });
    }
  }

  return normalized;
};

const blocksToPlainText = (blocks: { type: string; text?: string }[] | undefined) => {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((entry) => (typeof entry?.text === "string" ? entry.text : ""))
    .filter(Boolean)
    .join("\n\n");
};

// Convert Harmony format to Responses API input format
// Responses API uses Harmony format directly, so we mostly just need to ensure proper structure
const harmonyToResponsesInput = (items: any[]) => {
  const input: any[] = [];

  for (const item of items) {
    if (!item) continue;

    // Messages in Harmony format (system, developer, user, assistant)
    if (item.type === "message" && validMessageRoles.has(item.role)) {
      // Responses API expects: { role, content: [{ type: "input_text", text: "..." }] }
      const content = Array.isArray(item.content) ? item.content : [];
      if (content.length > 0 || item.role === "assistant") {
        input.push({
          role: item.role,
          content: content.length > 0 ? content : [{ type: "input_text", text: "" }],
        });
      }
      continue;
    }

    // Function calls (tool calls from assistant)
    if (item.type === "function_call" && item.call_id && item.name) {
      // In Responses API, function calls are represented as assistant messages with tool calls
      // But we'll handle this differently - tool calls come back in output, not input
      // For now, we can represent it as an assistant message with empty content
      // The actual tool call will be in the output
      continue;
    }

    // Function call outputs (tool results)
    if (
      (item.type === "function_call_output" || item.role === "tool") &&
      item.call_id
    ) {
      const contentValue =
        typeof item.output === "string"
          ? item.output
          : typeof item.content === "string"
            ? item.content
            : JSON.stringify(item.output ?? item.content ?? {});

      input.push({
        type: "function_call_output",
        call_id: item.call_id,
        output: contentValue,
        name: item.name || undefined,
        status: item.status || "completed",
      });
      continue;
    }

    // Legacy format support
    if (item.role && typeof item.content === "string") {
      input.push({
        role: item.role === "developer" ? "system" : item.role,
        content: [{ type: "input_text", text: item.content }],
      });
      continue;
    }
  }

  return input;
};

// Legacy function for Chat Completions (kept for fallback)
const harmonyToChatMessages = (items: any[]) => {
  const messages: any[] = [];

  for (const item of items) {
    if (!item) continue;

    if (item.type === "message" && validMessageRoles.has(item.role)) {
      const role = item.role === "developer" ? "system" : item.role;
      const text = blocksToPlainText(item.content);
      if (!text) continue;
      messages.push({ role, content: text });
      continue;
    }

    if (item.role && typeof item.content === "string") {
      const role = item.role === "developer" ? "system" : item.role;
      messages.push({ role, content: item.content });
      continue;
    }

    if (item.type === "function_call" && item.call_id && item.name) {
      const assistantMessage = {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: item.call_id,
            type: "function",
            function: {
              name: item.name,
              arguments:
                typeof item.arguments === "string"
                  ? item.arguments
                  : JSON.stringify(item.arguments ?? {}),
            },
          },
        ],
      };
      messages.push(assistantMessage);
      continue;
    }

    if (
      (item.type === "function_call_output" || item.role === "tool") &&
      item.call_id
    ) {
      const contentValue =
        typeof item.output === "string"
          ? item.output
          : typeof item.content === "string"
            ? item.content
            : JSON.stringify(item.output ?? item.content ?? {});
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        name: item.name || undefined,
        content: contentValue,
      });
      continue;
    }
  }

  return messages;
};

const safeParseJSON = (value: string | undefined | null, debugLabel?: string) => {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch (err) {
    warnLog(`Failed to parse JSON${debugLabel ? ` for ${debugLabel}` : ""}:`, value);
    warnLog("Parse error:", err);
    return {};
  }
};

const extractReasoningText = (delta: any) => {
  const reason = delta?.reasoning_content;
  if (!reason) return "";
  if (typeof reason === "string") return reason;
  if (Array.isArray(reason)) {
    return reason
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : typeof entry?.text === "string"
            ? entry.text
            : ""
      )
      .filter(Boolean)
      .join("");
  }
  if (typeof reason === "object" && typeof reason.text === "string") {
    return reason.text;
  }
  return "";
};

type ToolRoutingInfo = {
  displayName: string;
  server: string;
  toolName: string;
};

// Local tool registry (MCP only for now)
const callTool = async (
  name: string,
  args: any,
  routing?: ToolRoutingInfo
) => {
  const mcp = getSharedMCPManager();

  if (routing) {
    try {
      debugLog(
        `[Tool Execution] Calling MCP tool: ${routing.server}.${routing.toolName} with args:`,
        args
      );
      const result = await mcp.call(routing.server, routing.toolName, args);
      return result;
    } catch (e: any) {
      errorLog(
        `[Tool Execution] MCP tool error (${routing.server}.${routing.toolName}):`,
        e
      );
      return { error: String(e?.message || e) };
    }
  }

  warnLog(`[Tool Execution] Unknown tool: ${name}. Only MCP tools are supported.`);
  return { error: `Unknown tool: ${name}. Only MCP tools are supported.` };
};

const extractDeltaText = (delta: any) => {
  if (!delta) return "";
  if (typeof delta.content === "string") return delta.content;
  if (Array.isArray(delta.content)) {
    return delta.content
      .map((piece: any) => (typeof piece?.text === "string" ? piece.text : ""))
      .filter(Boolean)
      .join("");
  }
  return "";
};

const STEP_STREAM_CHUNK_SIZE = Number(process.env.STEP_STREAM_CHUNK_SIZE || "80");
const STEP_STREAM_CHUNK_DELAY_MS = Number(process.env.STEP_STREAM_CHUNK_DELAY_MS || "8");

const streamAssistantText = async (
  controller: ReadableStreamDefaultController,
  text: string
) => {
  if (!text) return;
  const chunkSize = STEP_STREAM_CHUNK_SIZE > 0 ? STEP_STREAM_CHUNK_SIZE : 80;
  const delayMs = STEP_STREAM_CHUNK_DELAY_MS >= 0 ? STEP_STREAM_CHUNK_DELAY_MS : 8;

  for (let i = 0; i < text.length; i += chunkSize) {
    const delta = text.slice(i, i + chunkSize);
    send(controller, "message", { role: "assistant", delta });
    if (delayMs > 0 && i + chunkSize < text.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
};

const extractOutputText = (content: any): string => {
  if (!content) return "";
  const parts = Array.isArray(content) ? content : [content];
  return parts
    .map((part) => {
      if (!part) return "";
      if (typeof part === "string") return part;
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      if (typeof part.delta === "string") return part.delta;
      return "";
    })
    .filter(Boolean)
    .join("");
};

export const runtime = "nodejs";
const describeTool = (tool: any) =>
  tool?.name || tool?.function?.name || tool?.type || "unknown";

export async function POST(req: NextRequest) {
  try {
    const {
      messages,
      developer_prompt,
      reasoning_level,
      tool_choice = "auto",
      enabled_mcp_servers,
    } =
      await req.json();

    const normalizedMessages = normalizeConversationItems(
      Array.isArray(messages) ? messages : []
    );

    await ensureMCPInitialized();
    const mcp = getSharedMCPManager();
    const waitMs = Number(process.env.MCP_AGENT_SERVER_WAIT_MS ?? "7000");
    const waitIntervalMs = Number(process.env.MCP_AGENT_SERVER_WAIT_INTERVAL_MS ?? "500");
    const requiredServersLog = (servers: Set<string> | null) =>
      servers ? Array.from(servers).join(", ") : "none";
    const listToolsWithWait = async (
      requiredServers: Set<string> | null,
      onStatus?: (info: { type: "waiting" | "timeout"; missing: string[]; elapsed: number }) => void
    ): Promise<{ server: string; tool: any }[]> => {
      let elapsed = 0;
      while (true) {
        try {
          const tools = await mcp.listAllTools();
          const serverCount = new Set(tools.map((t) => t.server)).size;
          debugLog(`[MCP] Loaded ${tools.length} tools from ${serverCount} servers`);
          if (!requiredServers || requiredServers.size === 0) {
            return tools;
          }
          const missing = Array.from(requiredServers).filter(
            (server) => !tools.some((t) => t.server === server)
          );
          if (!missing.length) {
            return tools;
          }
          if (elapsed >= waitMs) {
            warnLog(
              `[MCP] Timed out waiting for servers: ${missing.join(
                ", "
              )}. Proceeding with available tools.`
            );
            onStatus?.({ type: "timeout", missing, elapsed });
            return tools;
          }
          debugLog(
            `[MCP] Waiting for servers to connect (${missing.join(
              ", "
            )})... elapsed ${elapsed}ms`
          );
          onStatus?.({ type: "waiting", missing, elapsed });
        } catch (error) {
          warnLog("MCP tools unavailable (servers may still be connecting):", error);
        }
        await new Promise((resolve) => setTimeout(resolve, waitIntervalMs));
        elapsed += waitIntervalMs;
      }
    };
    const prepareTools = async (
      controller: ReadableStreamDefaultController
    ) => {
      // If no servers are enabled, return empty tools immediately (opt-in system)
      if (!enabledServersSet || enabledServersSet.size === 0) {
        debugLog(`[MCP] No servers enabled, returning empty tools list`);
        return { allTools: [], toolNameMap: new Map(), responsesTools: null };
      }

      const allMcpTools = await listToolsWithWait(enabledServersSet, (info) => {
        if (!info.missing.length) return;
        const message =
          info.type === "timeout"
            ? `Some MCP servers never responded (${info.missing.join(
                ", "
              )}). Proceeding with available tools.`
            : `Waiting for MCP servers: ${info.missing.join(
                ", "
              )} (${info.elapsed}ms)...`;
        const itemId = `mcp_status_${info.type}_${info.missing
          .map((s) => sanitize(s))
          .join("_")}`;
        send(controller, "reasoning", {
          content: message,
          item_id: itemId,
        });
      });
      // Only include tools from enabled servers (opt-in system)
      const mcpTools = allMcpTools.filter(({ server }) => enabledServersSet.has(server));

      const toolNameMap = new Map<string, ToolRoutingInfo>();
      const allTools = mcpTools.map(({ server, tool }) => {
        const openAITool = toOpenAITool(server, tool);
        const functionName = openAITool.function?.name;
        if (functionName) {
          const routingInfo: ToolRoutingInfo = {
            displayName: functionName,
            server,
            toolName: tool.name,
          };
          toolNameMap.set(functionName, routingInfo);
          toolNameMap.set(sanitize(functionName), routingInfo);
          toolNameMap.set(sanitize(tool.name), routingInfo);
        }
        return openAITool as {
          type: "function";
          function: { name: string; description: string; parameters: any };
        };
      });

      const responsesTools = useResponsesAPI
        ? allTools.map((tool) => {
            if (tool?.type === "function" && tool.function) {
              const { name, description, parameters } = tool.function;
              return {
                type: "function",
                name,
                description,
                parameters,
              };
            }
            return tool;
          })
        : null;

      // Only send ready message if we have enabled servers
      if (mcpTools.length > 0) {
        send(controller, "reasoning", {
          content: `MCP servers ready: ${Array.from(
            new Set(mcpTools.map((t) => t.server))
          ).join(", ")}`,
          item_id: `mcp_ready_${Date.now()}`,
        });
      }

      return { allTools, toolNameMap, responsesTools };
    };

    const enabledServersSet = enabled_mcp_servers
      ? new Set(
          Array.isArray(enabled_mcp_servers)
            ? enabled_mcp_servers
            : [enabled_mcp_servers]
        )
      : null;
    debugLog(
      `[MCP] Enabled servers requested: ${requiredServersLog(enabledServersSet)}`
    );

    const baseSystemPrompt = getSystemPrompt();
    const systemPrompt = applyReasoningLevelToPrompt(
      baseSystemPrompt,
      typeof reasoning_level === "string" ? reasoning_level : undefined
    );
    const developerPrompt =
      typeof developer_prompt === "string" && developer_prompt.trim().length > 0
        ? developer_prompt.trim()
        : null;
    const ctx = [
      ...(systemPrompt
        ? [
            {
              role: "system",
              type: "message",
              content: [{ type: "input_text", text: systemPrompt }],
            },
          ]
        : []),
      ...(developerPrompt
        ? [
            {
              role: "developer",
              type: "message",
              content: [{ type: "input_text", text: developerPrompt }],
            },
          ]
        : []),
      ...normalizedMessages,
    ].filter(Boolean);

    const maxTurns = Number(process.env.AGENT_MAX_TURNS || 4);

    // Check if we should use Responses API (when responses.js is configured)
    const useResponsesAPI = !!process.env.RESPONSES_JS_URL;

    const stream = new ReadableStream({
      start(controller) {
        (async () => {
          let toolNameMap = new Map<string, ToolRoutingInfo>();
          let allTools: { type: "function"; function: { name: string; description: string; parameters: any } }[] = [];
          let responsesTools:
            | {
                type: "function";
                name: string;
                description?: string;
                parameters: any;
              }[]
            | null = null;

          try {
            const tooling = await prepareTools(controller);
            toolNameMap = tooling.toolNameMap;
            allTools = tooling.allTools;
            responsesTools = tooling.responsesTools;

            for (let turn = 0; turn < maxTurns; turn++) {
              if (!ctx.length) {
                warnLog("No conversation context available, stopping agent loop");
                break;
              }

              const toolsParam = useResponsesAPI
                ? responsesTools && responsesTools.length
                  ? responsesTools
                  : undefined
                : allTools.length
                  ? allTools
                  : undefined;
              const toolChoiceParam =
                toolsParam && tool_choice ? tool_choice : toolsParam ? "auto" : undefined;
  
              if (useResponsesAPI) {
                // Use Responses API (Harmony-compliant, non-stream) and synthesize SSE events
                debugLog(
                  `[#${turn + 1}] Calling responses.create with ${ctx.length} items (Harmony format)`
                );
  
                const responsesInput = harmonyToResponsesInput(ctx);
                if (!responsesInput.length) {
                  warnLog("No valid input for Responses API, stopping agent loop");
                  break;
                }
                if (verboseLogs) {
                  try {
                    console.log(
                      `[#${turn + 1}] Responses input:`,
                      JSON.stringify(responsesInput, null, 2)
                    );
                  } catch {
                    console.log(`[#${turn + 1}] Responses input:`, responsesInput);
                  }
                }
  
                if (toolsParam?.length) {
                  debugLog(
                    `[#${turn + 1}] Tools available (${toolsParam.length}):`,
                    toolsParam.map((tool) => describeTool(tool)).join(", ")
                  );
                }
  
                try {
                  const isNativeStream = process.env.AGENTS_TEXT_STREAMING_MODE === "native";
                  const responseParams: any = {
                    model: MODEL,
                    input: responsesInput,
                    max_output_tokens: 128000,
                    stream: isNativeStream,
                    temperature: 1.0,
                    ...(reasoning_level ? { reasoning: { effort: reasoning_level } } : {}),
                  };
  
                  if (toolsParam && toolsParam.length > 0) {
                    responseParams.tools = toolsParam;
                  }
                  if (toolChoiceParam) {
                    responseParams.tool_choice = toolChoiceParam;
                  }

                  let assistantText = "";
                  let reasoningBuffer = "";
                  const toolCalls: any[] = [];

                  if (isNativeStream) {
                    debugLog(`[#${turn + 1}] Starting native stream`);
                    const stream = await client.responses.create(responseParams);
                    const toolCallMap = new Map<string, { type: "function_call" | "mcp_call"; id: string; name: string; arguments: string; call_id?: string }>();
                    
                    for await (const event of stream as unknown as AsyncIterable<any>) {
                      if (!event) continue;
                      const type = event.type;

                      if (type === "response.output_text.delta") {
                         const delta = event.delta;
                         if (delta) {
                           assistantText += delta;
                           send(controller, "message", { role: "assistant", delta });
                         }
                      } else if (type === "response.reasoning_text.delta") {
                         const delta = event.delta;
                         if (delta) {
                           reasoningBuffer += delta;
                           // In native mode, we send accumulated reasoning (or could send delta if client supports it, but legacy sends content)
                           send(controller, "reasoning", { 
                             content: reasoningBuffer, 
                             item_id: `reasoning_${turn + 1}_native` 
                           });
                         }
                      } else if (type === "response.output_item.added") {
                         const item = event.item;
                         if (item.type === "function_call" || item.type === "mcp_call") {
                            toolCallMap.set(item.id, { 
                              type: item.type, 
                              id: item.id, 
                              name: item.name, 
                              arguments: "", 
                              call_id: item.call_id || item.id 
                            });
                         }
                      } else if (type === "response.function_call_arguments.delta" || type === "response.mcp_call.arguments_delta" || type === "response.mcp_call_arguments.delta") {
                         const itemId = event.item_id;
                         const delta = event.delta;
                         if (itemId && delta && toolCallMap.has(itemId)) {
                            const call = toolCallMap.get(itemId)!;
                            call.arguments += delta;
                         }
                      } else if (type === "response.output_item.done") {
                         const item = event.item;
                         if ((item.type === "function_call" || item.type === "mcp_call") && toolCallMap.has(item.id)) {
                            // Ensure we have the full item state
                            const call = toolCallMap.get(item.id)!;
                            if (item.arguments) call.arguments = item.arguments; // overwrite with final if available
                            
                            // For native responses.js stream, tool calls are collected here
                            // We push them to toolCalls to be executed after the stream loop
                            // Note: responses.js might execute MCP tools internally if configured, 
                            // but if we are here, we might need to handle them if they weren't auto-executed.
                            // However, responses.js events like 'response.mcp_call.completed' indicate it was executed.
                            // If we see 'response.function_call', it's likely a local tool or one responses.js didn't handle.
                            
                            // If item.type is function_call, we definitely handle it.
                            // If item.type is mcp_call, responses.js might have handled it?
                            // Let's check if responses.js emits 'response.mcp_call.completed' or 'failed'.
                            // If so, we shouldn't re-execute it.
                         }
                      } else if (type === "response.mcp_call.completed" || type === "response.mcp_call.failed") {
                          // responses.js executed this tool. We should probably NOT execute it again.
                          // But we need to let the client know about the result?
                          // The 'item' in this event doesn't contain the result.
                          // We probably need to wait for 'response.output_item.done' which might contain output?
                          // Checking responses.js source: 
                          // outputObject.output = toolResult.output; 
                          // yield { type: "response.output_item.done", item: lastOutputItem ... }
                          // So .done event item will have the output.
                      }
                    }
                    
                    // Populate toolCalls from the map
                    for (const call of toolCallMap.values()) {
                         // If it's a function_call, we need to execute it.
                         // If it's an mcp_call, check if we have the output in the item?
                         // Wait, the loop above doesn't capture the FINAL item with output.
                         // Let's just collect all function_calls for now.
                         if (call.type === "function_call") {
                            toolCalls.push({
                               type: "function_call",
                               id: call.id,
                               call_id: call.call_id,
                               name: call.name,
                               arguments: call.arguments, // Use arguments string directly
                               arguments_json: call.arguments // For consistency with other code that might check this
                            });
                         }
                    }

                  } else {
                    const response = await client.responses.create(responseParams);
                    const responseOutput = Array.isArray(response.output)
                        ? response.output
                        : [];
    
                    for (const item of responseOutput) {
                        if (!item) continue;
                        const itemType = item.type;
                        if (itemType === "message") {
                        const text = extractOutputText(item.content);
                        if (text) {
                            assistantText = assistantText
                            ? `${assistantText}\n\n${text}`
                            : text;
                        }
                        } else if (itemType === "reasoning") {
                        const reasoningText = extractOutputText(item.content);
                        if (reasoningText) {
                            reasoningBuffer = reasoningBuffer
                            ? `${reasoningBuffer}${reasoningText}`
                            : reasoningText;
                        }
                        } else if (itemType === "function_call" || itemType === "tool_call") {
                        toolCalls.push(item);
                        }
                    }
                  }

                  if (!isNativeStream && reasoningBuffer) {
                    send(controller, "reasoning", {
                      content: reasoningBuffer,
                      item_id: `reasoning_${turn + 1}_${Date.now()}`,
                    });
                  }
  
                  if (!isNativeStream && assistantText) {
                    await streamAssistantText(controller, assistantText);
                    ctx.push({
                      role: "assistant",
                      type: "message",
                      content: [{ type: "input_text", text: assistantText }],
                    });
                  }
  
                  if (!toolCalls.length) {
                    if (assistantText) {
                      debugLog(
                        `[#${turn + 1}] Assistant responded with text and no tool calls, stopping agent loop`
                      );
                      break;
                    }
                    if (reasoningBuffer && !assistantText) {
                      debugLog(
                        `[#${turn + 1}] Only reasoning returned, continuing to next turn`
                      );
                      continue;
                    }
                    debugLog(
                      `[#${turn + 1}] No tool calls or assistant text returned, stopping agent loop`
                    );
                    break;
                  }
  
                  for (const toolCall of toolCalls) {
                    if (!toolCall?.name) {
                      warnLog(`[#${turn + 1}] Skipping tool call without name: ${toolCall?.id}`);
                      continue;
                    }
  
                    let args: any = {};
                    try {
                      args = JSON.parse(
                        toolCall.arguments_json ||
                          toolCall.arguments ||
                          "{}"
                      );
                    } catch {
                      warnLog(
                        `[#${turn + 1}] Failed to parse tool call arguments:`,
                        toolCall.arguments
                      );
                    }
  
                    const routingInfo =
                      toolNameMap.get(toolCall.name) ||
                      toolNameMap.get(sanitize(toolCall.name));
                    if (!routingInfo) {
                      warnLog(`[#${turn + 1}] Unknown tool requested: ${toolCall.name}`);
                      continue;
                    }
  
                    const toolName = routingInfo.displayName;
                    const callId =
                      toolCall.call_id ||
                      toolCall.id ||
                      `call_${Math.random().toString(36).slice(2)}`;
  
                    debugLog(
                      `[#${turn + 1}] Executing tool ${toolName} (${callId}) with args`,
                      args
                    );
                    send(controller, "tool_call", { name: toolName, args, call_id: callId });
  
                    const callArgumentsJson = JSON.stringify(args ?? {});
                    ctx.push({
                      type: "function_call" as const,
                      id: callId,
                      call_id: callId,
                      name: toolName,
                      arguments: callArgumentsJson,
                      status: null,
                    });
  
                    let result: any;
                    try {
                      result = await callTool(toolName, args, routingInfo);
                      debugLog(
                        `[#${turn + 1}] Tool ${toolName} result:`,
                        JSON.stringify(result).substring(0, 200)
                      );
                    } catch (e: any) {
                      console.error(`[#${turn + 1}] Tool ${toolName} error: ${e?.message || e}`);
                      debugLog(`[#${turn + 1}] Tool ${toolName} error details:`, e);
                      result = { error: String(e?.message || e) };
                    }
  
                    send(controller, "tool_result", { name: toolName, result, call_id: callId });
  
                    let resultContent: string;
                    try {
                      if (typeof result === "string") {
                        resultContent = result;
                      } else {
                        resultContent = JSON.stringify(result);
                      }
                    } catch {
                      resultContent = String(result ?? "Tool execution failed");
                    }
  
                    const MAX_TOOL_RESULT_LENGTH = 8000;
                    if (resultContent.length > MAX_TOOL_RESULT_LENGTH) {
                      const originalLength = resultContent.length;
                      const truncated = resultContent.slice(0, MAX_TOOL_RESULT_LENGTH);
                      const truncationNote = `\n\n[Result truncated from ${originalLength} to ${MAX_TOOL_RESULT_LENGTH} characters]`;
                      resultContent = truncated + truncationNote;
                      warnLog(
                        `[#${turn + 1}] Tool ${toolName} result truncated from ${originalLength} to ${MAX_TOOL_RESULT_LENGTH} chars`
                      );
                    }
  
                    ctx.push({
                      type: "function_call_output" as const,
                      call_id: callId,
                      name: toolName,
                      output: resultContent,
                    });
                  }
                } catch (apiError: any) {
                  const summary = `[#${turn + 1}] Responses API Error: status=${apiError?.status ?? "unknown"} message=${apiError?.message ?? apiError}`;
                  console.error(summary);
                  errorLog("Full API error payload:", {
                    status: apiError?.status,
                    message: apiError?.message,
                    error: apiError?.error,
                    code: apiError?.code,
                  });
                  throw apiError;
                }
              } else {
                // Fallback to Chat Completions API (legacy)
                const chatMessages = harmonyToChatMessages(ctx);
                if (!chatMessages.length) {
                  warnLog("No conversation context available, stopping agent loop");
                  break;
                }
  
                debugLog(
                  `[#${turn + 1}] Calling chat.completions with ${chatMessages.length} messages (legacy mode)`
                );
                if (toolsParam?.length) {
                  debugLog(
                    `[#${turn + 1}] Tools available (${toolsParam.length}):`,
                    toolsParam.map((tool) => describeTool(tool)).join(", ")
                  );
                } else {
                  debugLog(`[#${turn + 1}] No tools available this turn`);
                }
  
                let assistantText = "";
                const toolCallMap = new Map<
                  string,
                  { id: string; index?: number; name: string; arguments: string }
                >();
                let reasoningBuffer = "";
                let reasoningId: string | null = null;
                let finishReason: string | null = null;
  
                try {
                  const completionParams: any = {
                    model: MODEL,
                    messages: chatMessages,
                    ...(toolsParam ? { tools: toolsParam } : {}),
                    ...(toolChoiceParam ? { tool_choice: toolChoiceParam } : {}),
                    max_tokens: 128000,
                    stream: true,
                    temperature: 1.0,
                    top_p: 1.0,
                    top_k: 100,
                    ...(reasoning_level ? { reasoning_effort: reasoning_level } : {}),
                  };
                  const completion = await client.chat.completions.create(completionParams);
  
                  for await (const part of completion as unknown as AsyncIterable<any>) {
                    const choice = part.choices?.[0];
                    if (!choice) continue;
                    
                    if (choice.finish_reason) {
                      finishReason = choice.finish_reason;
                      debugLog(`[#${turn + 1}] Stream finished with reason: ${finishReason}`);
                    }
                    
                    const delta = choice.delta ?? {};
  
                    const reasoningDelta = extractReasoningText(delta);
                    if (reasoningDelta) {
                      reasoningId =
                        reasoningId ||
                        `reasoning_${turn + 1}_${Math.random().toString(36).slice(2, 8)}`;
                      reasoningBuffer += reasoningDelta;
                      send(controller, "reasoning", {
                        content: reasoningBuffer,
                        item_id: reasoningId,
                      });
                    }
  
                    const textDelta = extractDeltaText(delta);
                    if (textDelta) {
                      assistantText += textDelta;
                      send(controller, "message", {
                        role: "assistant",
                        delta: textDelta,
                      });
                    }
  
                    if (Array.isArray(delta.tool_calls)) {
                      for (const toolDelta of delta.tool_calls) {
                        const deltaIndex =
                          typeof toolDelta.index === "number" ? toolDelta.index : undefined;
                        const deltaId = toolDelta.id || undefined;
  
                        let existingKey: string | undefined;
                        let existing: { id: string; index?: number; name: string; arguments: string } | undefined;
  
                        if (deltaId && toolCallMap.has(deltaId)) {
                          existingKey = deltaId;
                          existing = toolCallMap.get(deltaId);
                        } else if (
                          deltaIndex !== undefined &&
                          toolCallMap.has(`index_${deltaIndex}`)
                        ) {
                          existingKey = `index_${deltaIndex}`;
                          existing = toolCallMap.get(existingKey);
                        } else {
                          for (const [key, entry] of toolCallMap.entries()) {
                            if (
                              (deltaId && entry.id === deltaId) ||
                              (deltaIndex !== undefined && entry.index === deltaIndex)
                            ) {
                              existingKey = key;
                              existing = entry;
                              break;
                            }
                          }
                        }
  
                        if (!existing) {
                          const newId = deltaId || `tool_${toolCallMap.size}`;
                          const newKey = deltaId || (deltaIndex !== undefined ? `index_${deltaIndex}` : newId);
                          existing = {
                            id: newId,
                            index: deltaIndex,
                            name: "",
                            arguments: "",
                          };
                          existingKey = newKey;
                          if (existingKey) {
                            toolCallMap.set(existingKey, existing);
                          }
                        }
  
                        const updated = {
                          id: deltaId || existing.id,
                          index: deltaIndex !== undefined ? deltaIndex : existing.index,
                          name: toolDelta.function?.name || existing.name,
                          arguments:
                            existing.arguments + (toolDelta.function?.arguments || ""),
                        };
  
                        const preferredKey = updated.id || (updated.index !== undefined ? `index_${updated.index}` : existingKey);
                        if (preferredKey && existingKey && preferredKey !== existingKey) {
                          toolCallMap.delete(existingKey);
                          toolCallMap.set(preferredKey, updated);
                        } else if (existingKey) {
                          toolCallMap.set(existingKey, updated);
                        } else if (preferredKey) {
                          toolCallMap.set(preferredKey, updated);
                        }
                      }
                    }
                  }
                } catch (apiError: any) {
                  const summary = `[#${turn + 1}] API Error: status=${apiError?.status ?? "unknown"} message=${apiError?.message ?? apiError}`;
                  console.error(summary);
                  errorLog("Full API error payload:", {
                    status: apiError?.status,
                    message: apiError?.message,
                    error: apiError?.error,
                    code: apiError?.code,
                  });
                  throw apiError;
                }
  
                const toolCallSummary = Array.from(toolCallMap.values()).map((call) => ({
                  id: call.id,
                  name: call.name,
                  argsPreview: (call.arguments || "").slice(0, 120),
                }));
                debugLog(
                  `[#${turn + 1}] Stream completed. Finish reason: ${finishReason || "none"}. Assistant text length=${assistantText.length}. Tool calls reported=${toolCallSummary.length}`
                );
                if (toolCallSummary.length) {
                  debugLog(`[#${turn + 1}] Tool call summary:`, toolCallSummary);
                }
  
                if (reasoningBuffer && !assistantText) {
                  debugLog(`[#${turn + 1}] Reasoning present without text, will continue to next turn`);
                }
  
                if (assistantText) {
                  ctx.push({
                    role: "assistant",
                    type: "message",
                    content: [{ type: "input_text", text: assistantText }],
                  });
                }
  
                const completedToolCalls = Array.from(toolCallMap.values());
                
                if (finishReason === "stop" && !completedToolCalls.length) {
                  debugLog(`[#${turn + 1}] Finish reason is "stop" with no tool calls, stopping agent loop`);
                  break;
                }
                
                if (!completedToolCalls.length) {
                  if (assistantText) {
                    debugLog(`[#${turn + 1}] No tool calls and assistant text present, stopping agent loop`);
                    break;
                  }
                  if (reasoningBuffer && !assistantText) {
                    debugLog(`[#${turn + 1}] Only reasoning present, continuing to next turn`);
                    continue;
                  }
                  debugLog(`[#${turn + 1}] No tool calls, no text, no reasoning - stopping agent loop`);
                  break;
                }
  
                // Process tool calls (same as Responses API path above)
                for (const call of completedToolCalls) {
                  if (!call.name) {
                    warnLog(`[#${turn + 1}] Skipping tool call without name: ${call.id}`);
                    continue;
                  }
                  const args = safeParseJSON(call.arguments, `tool ${call.name || call.id}`);
  
                  const routingInfo =
                    toolNameMap.get(call.name) || toolNameMap.get(sanitize(call.name));
                  if (!routingInfo) {
                    warnLog(`[#${turn + 1}] Unknown tool requested: ${call.name}`);
                    continue;
                  }
  
                  const toolName = routingInfo.displayName;
                  const callId = call.id || `call_${Math.random().toString(36).slice(2)}`;
  
                  debugLog(`[#${turn + 1}] Executing tool ${toolName} (${callId}) with args`, args);
                  send(controller, "tool_call", { name: toolName, args, call_id: callId });
  
                  const callArgumentsJson = JSON.stringify(args ?? {});
                  ctx.push({
                    type: "function_call" as const,
                    id: callId,
                    call_id: callId,
                    name: toolName,
                    arguments: callArgumentsJson,
                    status: null,
                  });
  
                  let result: any;
                  try {
                    result = await callTool(toolName, args, routingInfo);
                    debugLog(
                      `[#${turn + 1}] Tool ${toolName} result:`,
                      JSON.stringify(result).substring(0, 200)
                    );
                  } catch (e: any) {
                    console.error(`[#${turn + 1}] Tool ${toolName} error: ${e?.message || e}`);
                    debugLog(`[#${turn + 1}] Tool ${toolName} error details:`, e);
                    result = { error: String(e?.message || e) };
                  }
  
                  send(controller, "tool_result", { name: toolName, result, call_id: callId });
  
                  let resultContent: string;
                  try {
                    if (typeof result === "string") {
                      resultContent = result;
                    } else {
                      resultContent = JSON.stringify(result);
                    }
                  } catch {
                    resultContent = String(result ?? "Tool execution failed");
                  }
  
                  const MAX_TOOL_RESULT_LENGTH = 8000;
                  if (resultContent.length > MAX_TOOL_RESULT_LENGTH) {
                    const originalLength = resultContent.length;
                    const truncated = resultContent.slice(0, MAX_TOOL_RESULT_LENGTH);
                    const truncationNote = `\n\n[Result truncated from ${originalLength} to ${MAX_TOOL_RESULT_LENGTH} characters]`;
                    resultContent = truncated + truncationNote;
                    warnLog(
                      `[#${turn + 1}] Tool ${toolName} result truncated from ${originalLength} to ${MAX_TOOL_RESULT_LENGTH} chars`
                    );
                  }
  
                  ctx.push({
                    type: "function_call_output" as const,
                    call_id: callId,
                    name: toolName,
                    output: resultContent,
                  });
                }
              }
            }
  
          send(controller, "done", {});
          controller.close();
        } catch (e: any) {
          console.error("Error in agent loop:", e?.message || e);
          debugLog("Error in agent loop details:", e);
          send(controller, "error", { message: String(e?.message || e) });
          controller.close();
        }
        })();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error in POST handler:", (error as any)?.message || error);
    debugLog("Error in POST handler details:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500 }
    );
  }
}
