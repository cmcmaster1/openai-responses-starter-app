"use client";
import React, { useState } from "react";
import { ChevronDown, ChevronUp, Brain } from "lucide-react";
import { ReasoningItem } from "@/lib/assistant";

interface ReasoningTraceProps {
  item: ReasoningItem;
}

const ReasoningTrace: React.FC<ReasoningTraceProps> = ({ item }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-2 my-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-zinc-600 bg-zinc-50 hover:bg-zinc-100 rounded-lg border border-zinc-200 transition-colors"
      >
        <Brain className="h-4 w-4" />
        <span>Reasoning Trace</span>
        {isExpanded ? (
          <ChevronUp className="h-3 w-3 ml-auto" />
        ) : (
          <ChevronDown className="h-3 w-3 ml-auto" />
        )}
      </button>
      {isExpanded && (
        <div className="ml-4 mr-4 md:mr-24 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs font-mono text-zinc-700 whitespace-pre-wrap max-h-96 overflow-y-auto">
          {item.content}
        </div>
      )}
    </div>
  );
};

export default ReasoningTrace;

