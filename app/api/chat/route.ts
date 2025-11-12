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
      const mcpTools = enabledServersSet
        ? allMcpTools.filter(({ server }) => enabledServersSet.has(server))
        : allMcpTools;

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

      send(controller, "reasoning", {
        content: `MCP servers ready: ${Array.from(
          new Set(mcpTools.map((t) => t.server))
        ).join(", ") || "none"}`,
        item_id: `mcp_ready_${Date.now()}`,
      });

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

    const allMcpTools = await listToolsWithWait(enabledServersSet);

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
              // Use Responses API (Harmony-compliant)
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
                // Use non-streaming Responses API (step-streaming approach)
                // responses.js will handle the translation to Chat Completions
                // Note: tools format may need adjustment for Responses API
                const responseParams: any = {
                  model: MODEL,
                  input: responsesInput,
                  max_output_tokens: 128000,
                  stream: false,
                  temperature: 1.0,
                };
                
                // Add tools if available (Responses API format)
                if (toolsParam && toolsParam.length > 0) {
                  responseParams.tools = toolsParam;
                }
                
                // Add tool_choice if specified
                if (toolChoiceParam) {
                  responseParams.tool_choice = toolChoiceParam;
                }
                
                const response = await client.responses.create(responseParams);

                // Process Responses API output format
                const outputItems = response.output ?? [];
                if (verboseLogs) {
                  try {
                    console.log(
                      `[#${turn + 1}] Responses output raw:`,
                      JSON.stringify(outputItems, null, 2)
                    );
                  } catch {
                    console.log(`[#${turn + 1}] Responses output raw:`, outputItems);
                  }
                }
                let assistantText = "";
                const toolCalls: any[] = [];

                for (const item of outputItems) {
                  const itemType = item?.type;
                  if (itemType === "message" || itemType === "output_text") {
                    const msg: any = item;
                    const textPieces: string[] = [];
                    if (typeof msg.output_text === "string") textPieces.push(msg.output_text);
                    if (typeof msg.text === "string") textPieces.push(msg.text);
                    if (Array.isArray(msg.content)) {
                      for (const c of msg.content) {
                        if (typeof c?.text === "string") textPieces.push(c.text);
                        else if (typeof c?.output_text === "string") textPieces.push(c.output_text);
                      }
                    }
                    const text = textPieces.join("");

                    if (text) {
                      assistantText += text;
                      const chunkSize = 80;
                      for (let i = 0; i < text.length; i += chunkSize) {
                        await new Promise((r) => setTimeout(r, 8));
                        send(controller, "message", {
                          role: "assistant",
                          delta: text.slice(i, i + chunkSize),
                        });
                      }
                    }

                    const reasoningSource =
                      msg.reasoning_content ||
                      msg.reasoning ||
                      (Array.isArray(msg.content)
                        ? msg.content.find((c: any) => c?.type === "reasoning")
                        : null);
                    const reasoningText =
                      typeof reasoningSource === "string"
                        ? reasoningSource
                        : Array.isArray(reasoningSource)
                          ? reasoningSource.map((c: any) => c?.text || "").join("")
                          : typeof reasoningSource?.text === "string"
                            ? reasoningSource.text
                            : "";
                    if (reasoningText) {
                      const reasoningId = `reasoning_${turn + 1}_${Math.random().toString(36).slice(2, 8)}`;
                      send(controller, "reasoning", {
                        content: reasoningText,
                        item_id: reasoningId,
                      });
                    }
                  } else if (itemType === "reasoning") {
                    const reasoningText = Array.isArray((item as any).content)
                      ? (item as any).content.map((c: any) => c?.text || "").join("")
                      : typeof (item as any).text === "string"
                        ? (item as any).text
                        : "";
                    if (reasoningText) {
                      const reasoningId = `reasoning_${turn + 1}_${Math.random().toString(36).slice(2, 8)}`;
                      send(controller, "reasoning", {
                        content: reasoningText,
                        item_id: reasoningId,
                      });
                    }
                  } else if (itemType === "function_call" || itemType === "tool_call") {
                    toolCalls.push(item);
                  }
                }

                // Add assistant message to context
                if (assistantText) {
                  ctx.push({
                    role: "assistant",
                    type: "message",
                    content: [{ type: "input_text", text: assistantText }],
                  });
                }

                // Process tool calls
                if (!toolCalls.length) {
                  debugLog(`[#${turn + 1}] No tool calls, stopping agent loop`);
                  break;
                }

                for (const toolCall of toolCalls) {
                  if (!toolCall.name) {
                    warnLog(`[#${turn + 1}] Skipping tool call without name: ${toolCall.id}`);
                    continue;
                  }

                  let args: any = {};
                  try {
                    args = JSON.parse(toolCall.arguments_json || toolCall.arguments || "{}");
                  } catch (e) {
                    warnLog(`[#${turn + 1}] Failed to parse tool call arguments:`, toolCall.arguments);
                  }

                  const routingInfo =
                    toolNameMap.get(toolCall.name) || toolNameMap.get(sanitize(toolCall.name));
                  if (!routingInfo) {
                    warnLog(`[#${turn + 1}] Unknown tool requested: ${toolCall.name}`);
                    continue;
                  }

                  const toolName = routingInfo.displayName;
                  const callId = toolCall.id || `call_${Math.random().toString(36).slice(2)}`;

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

                  // Truncate very large tool results
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
