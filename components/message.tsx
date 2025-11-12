import { MessageItem } from "@/lib/assistant";
import React from "react";
import MarkdownRenderer from "@/components/markdown-renderer";

interface MessageProps {
  message: MessageItem;
}

const Message: React.FC<MessageProps> = ({ message }) => {
  const primaryContent = message.content?.[0];
  const textContent = typeof primaryContent?.text === "string" ? primaryContent.text : "";
  const annotations = primaryContent?.annotations ?? [];

  return (
    <div className="text-sm">
      {message.role === "user" ? (
        <div className="flex justify-end">
          <div>
            <div className="ml-4 rounded-[16px] px-4 py-2 md:ml-24 bg-[#ededed] text-stone-900  font-light">
              <div>
                <div>
                  <MarkdownRenderer content={textContent} />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="flex">
            <div className="mr-4 rounded-[16px] px-4 py-2 md:mr-24 text-black bg-white font-light">
              <div>
                <MarkdownRenderer content={textContent} />
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
