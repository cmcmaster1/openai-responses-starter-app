import React, { useMemo, useState } from "react";

import { ToolCallItem } from "@/lib/assistant";
import {
  BookOpenText,
  ChevronDown,
  ChevronUp,
  Clock,
  Globe,
  Zap,
  Code2,
  Download,
} from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { coy } from "react-syntax-highlighter/dist/esm/styles/prism";

interface ToolCallProps {
  toolCall: ToolCallItem;
}

const statusText = (status: ToolCallItem["status"]) => {
  switch (status) {
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "searching":
      return "Searching";
    default:
      return "In progress";
  }
};

const ToolHeaderIcon = ({ type }: { type?: ToolCallItem["tool_type"] }) => {
  switch (type) {
    case "file_search_call":
      return <BookOpenText className="h-4 w-4" />;
    case "web_search_call":
      return <Globe className="h-4 w-4" />;
    case "code_interpreter_call":
      return <Code2 className="h-4 w-4" />;
    default:
      return <Zap className="h-4 w-4" />;
  }
};

const JsonBlock = ({ value }: { value: string }) => (
  <div className="rounded-md border border-zinc-200 bg-white">
    <SyntaxHighlighter
      customStyle={{
        backgroundColor: "transparent",
        padding: "12px",
        margin: 0,
        fontSize: 12,
      }}
      language="json"
      style={coy}
    >
      {value}
    </SyntaxHighlighter>
  </div>
);

const McpCallDetails = ({ toolCall }: ToolCallProps) => {
  const argsText = useMemo(() => {
    try {
      return JSON.stringify(toolCall.parsedArguments ?? {}, null, 2);
    } catch {
      return toolCall.arguments ?? "{}";
    }
  }, [toolCall.parsedArguments, toolCall.arguments]);

  const outputText = useMemo(() => {
    if (!toolCall.output) return null;
    try {
      const parsed = JSON.parse(toolCall.output);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return toolCall.output;
    }
  }, [toolCall.output]);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 mb-1">
          Arguments
        </p>
        <JsonBlock value={argsText} />
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 mb-1">
          Result
        </p>
        {outputText ? (
          <JsonBlock value={outputText} />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-500">
            <Clock className="h-4 w-4" />
            Waiting for result...
          </div>
        )}
      </div>
    </div>
  );
};

const FileSearchDetails = ({ toolCall }: ToolCallProps) => (
  <p className="text-xs text-zinc-600">
    {toolCall.status === "completed"
      ? "File search completed. No structured data was returned."
      : "Searching available files..."}
  </p>
);

const WebSearchDetails = ({ toolCall }: ToolCallProps) => (
  <p className="text-xs text-zinc-600">
    {toolCall.status === "completed"
      ? "Web search completed. See assistant response for summarized results."
      : "Searching the web for relevant information..."}
  </p>
);

const CodeInterpreterDetails = ({ toolCall }: ToolCallProps) => (
  <div className="space-y-3 text-xs">
    {toolCall.code && (
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 mb-1">
          Executed code
        </p>
        <div className="rounded-md border border-zinc-200 bg-white">
          <SyntaxHighlighter
            customStyle={{
              backgroundColor: "transparent",
              padding: "12px",
              margin: 0,
              fontSize: 12,
            }}
            language="python"
            style={coy}
          >
            {toolCall.code}
          </SyntaxHighlighter>
        </div>
      </div>
    )}
    {!!toolCall.files?.length && (
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Generated files
        </p>
        <div className="flex flex-wrap gap-2">
          {toolCall.files.map((file) => (
            <a
              key={file.file_id}
              href={`/api/container_files/content?file_id=${file.file_id}${
                file.container_id ? `&container_id=${file.container_id}` : ""
              }${file.filename ? `&filename=${encodeURIComponent(file.filename)}` : ""}`}
              download
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] text-zinc-600"
            >
              {file.filename || file.file_id}
              <Download className="h-3 w-3" />
            </a>
          ))}
        </div>
      </div>
    )}
  </div>
);

const ToolCallDetails = ({ toolCall }: ToolCallProps) => {
  switch (toolCall.tool_type) {
    case "file_search_call":
      return <FileSearchDetails toolCall={toolCall} />;
    case "web_search_call":
      return <WebSearchDetails toolCall={toolCall} />;
    case "code_interpreter_call":
      return <CodeInterpreterDetails toolCall={toolCall} />;
    case "function_call":
    case "mcp_call":
    default:
      return <McpCallDetails toolCall={toolCall} />;
  }
};

export default function ToolCall({ toolCall }: ToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const title = toolCall.name || "Tool call";
  const subtitle = `${statusText(toolCall.status)} • ${toolCall.tool_type || "tool"}`;

  return (
    <div className="flex flex-col gap-2 my-2">
      <button
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100"
      >
        <ToolHeaderIcon type={toolCall.tool_type} />
        <div className="flex flex-col text-left">
          <span className="text-xs font-semibold text-zinc-700">{title}</span>
          <span className="text-[11px] text-zinc-500">{subtitle}</span>
        </div>
        <div className="ml-auto text-zinc-500">
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>
      {isExpanded && (
        <div className="ml-5 mr-4 md:mr-24 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-700">
          <ToolCallDetails toolCall={toolCall} />
        </div>
      )}
    </div>
  );
}
