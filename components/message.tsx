import { MessageItem } from "@/lib/assistant";
import React from "react";
import MarkdownRenderer from "@/components/markdown-renderer";

interface MessageProps {
  message: MessageItem;
}

const Message: React.FC<MessageProps> = ({ message }) => {
  const contentBlocks = Array.isArray(message.content) ? message.content : [];
  const annotations = contentBlocks[0]?.annotations ?? [];
  const textBlocks = contentBlocks.filter(
    (block) => block.metadata?.kind !== "attachment"
  );
  const attachmentBlocks = contentBlocks.filter(
    (block) => block.metadata?.kind === "attachment"
  );

  return (
    <div className="text-sm">
      {message.role === "user" ? (
        <div className="flex justify-end">
          <div>
            <div className="ml-4 rounded-[16px] px-4 py-2 md:ml-24 bg-[#ededed] text-stone-900  font-light">
              <div className="space-y-3">
                {(textBlocks.length ? textBlocks : contentBlocks).map(
                  (block, idx) => (
                    <MarkdownRenderer
                      key={idx}
                      content={typeof block?.text === "string" ? block.text : ""}
                    />
                  )
                )}
                {attachmentBlocks.map((block, idx) => (
                  <div
                    key={`attachment-${idx}`}
                    className="rounded-md border border-zinc-300 bg-white/70 p-2 text-[13px]"
                  >
                    <div className="flex items-center justify-between text-[12px] text-zinc-600">
                      <span className="font-medium">
                        {block.metadata?.filename || "Attachment"}
                      </span>
                      <span className="text-[11px] text-zinc-500">
                        {block.metadata?.mime_type}
                        {block.metadata?.truncated ? " · truncated" : ""}
                      </span>
                    </div>
                    <div className="mt-1 max-h-40 overflow-y-auto text-zinc-800">
                      <MarkdownRenderer
                        content={typeof block?.text === "string" ? block.text : ""}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="flex">
            <div className="mr-4 rounded-[16px] px-4 py-2 md:mr-24 text-black bg-white font-light">
              <div>
                {contentBlocks.length > 0 ? (
                  contentBlocks.map((block, idx) => (
                    <MarkdownRenderer
                      key={idx}
                      content={typeof block?.text === "string" ? block.text : ""}
                    />
                  ))
                ) : (
                  <MarkdownRenderer content="" />
                )}
                {annotations
                  .filter(
                    (a) =>
                      a.type === "container_file_citation" &&
                      a.filename &&
                      /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.filename)
                  )
                  .map((a, i) => (
                    <img
                      key={i}
                      src={`/api/container_files/content?file_id=${a.fileId}${a.containerId ? `&container_id=${a.containerId}` : ""}${a.filename ? `&filename=${encodeURIComponent(a.filename)}` : ""}`}
                      alt={a.filename || ""}
                      className="mt-2 max-w-full"
                    />
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Message;
