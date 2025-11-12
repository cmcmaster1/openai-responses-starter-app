"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";

const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

interface MarkdownRendererProps {
  content: string | null | undefined;
}

const renderCodeBlock = (
  code: string,
  className?: string,
  isInline?: boolean
) => {
  const languageFromClass = (className || "").replace(/language-/, "").trim();
  const text = code.replace(/\n$/, "");

  const looksInline = !isInline && !languageFromClass && !text.includes("\n");

  if (isInline || looksInline) {
    return (
      <code className="inline rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85rem] text-zinc-900">
        {text}
      </code>
    );
  }

  let highlighted = text;
  let detectedLanguage = languageFromClass || "plaintext";

  const highlight = () => {
    if (languageFromClass) {
      try {
        const result = hljs.highlight(text, { language: languageFromClass });
        return { highlighted: result.value, language: result.language || languageFromClass };
      } catch {
        // fall through to auto-detect
      }
    }
    const result = hljs.highlightAuto(text);
    return { highlighted: result.value, language: result.language || "plaintext" };
  };

  const highlightResult = highlight();
  highlighted = highlightResult.highlighted;
  detectedLanguage = highlightResult.language;

  const isMultiline = text.includes("\n");
  const isCompact = !isMultiline && text.length <= 80;

  const baseClass =
    "code-block relative my-1.5 w-full overflow-hidden rounded-md border border-zinc-200 bg-white text-sm";
  const preClass =
    "max-h-[420px] w-full overflow-auto whitespace-pre-wrap break-words px-2 py-1 text-[0.93rem] leading-snug text-zinc-900";

  return (
    <div className={cn(baseClass, !isCompact && "ring-1 ring-zinc-100")}>
      {!isCompact && (
        <span className="absolute right-2 top-1 text-xs uppercase tracking-wide text-zinc-500">
          {detectedLanguage}
        </span>
      )}
      <pre className={preClass}>
        <code
          className={cn(`hljs language-${detectedLanguage}`, "block")}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  if (!content) {
    return null;
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ inline, className, children }) {
          const value = String(children);
          return renderCodeBlock(value, className, inline);
        },
        table({ children }) {
          return (
            <div className="my-4 overflow-x-auto rounded-lg border border-zinc-200">
              <table className="w-full border-collapse text-sm text-left text-zinc-800">
                {children}
              </table>
            </div>
          );
        },
        thead({ children }) {
          return (
            <thead className="bg-zinc-100 text-zinc-700">
              {children}
            </thead>
          );
        },
        th({ children }) {
          return (
            <th className="border-b border-r border-zinc-200 px-3 py-2 font-semibold last:border-r-0">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="border-b border-r border-zinc-200 px-3 py-2 align-top last:border-r-0">
              {children}
            </td>
          );
        },
        tr({ children }) {
          return <tr className="odd:bg-white even:bg-zinc-50">{children}</tr>;
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline transition-colors hover:text-blue-800"
            >
              {children}
            </a>
          );
        },
        blockquote({ children }) {
          return (
            <blockquote className="my-4 border-l-4 border-blue-300 bg-blue-50/80 px-4 py-2 text-sm text-blue-900">
              {children}
            </blockquote>
          );
        },
        ul({ children }) {
          return <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>;
        },
        p({ children }) {
          return <p className="my-2 leading-relaxed text-zinc-800">{children}</p>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
};

export default MarkdownRenderer;
