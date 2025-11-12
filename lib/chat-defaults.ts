import { INITIAL_MESSAGE } from "@/config/constants";
import { Item } from "@/lib/assistant";

export const createInitialChatMessages = (): Item[] => [
  {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: INITIAL_MESSAGE }],
  },
];
