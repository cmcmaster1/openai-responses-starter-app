import { create } from "zustand";
import { Item } from "@/lib/assistant";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { createInitialChatMessages } from "@/lib/chat-defaults";

interface ConversationState {
  // Items displayed in the chat
  chatMessages: Item[];
  // Items sent to the Responses API
  conversationItems: any[];
  // Whether we are waiting for the assistant response
  isAssistantLoading: boolean;

  setChatMessages: (items: Item[]) => void;
  setConversationItems: (messages: any[]) => void;
  addChatMessage: (item: Item) => void;
  addConversationItem: (message: ChatCompletionMessageParam) => void;
  setAssistantLoading: (loading: boolean) => void;
  rawSet: (state: any) => void;
  loadConversation: (messages: Item[], conversation: any[]) => void;
  resetConversation: () => void;
}

const useConversationStore = create<ConversationState>((set) => ({
  chatMessages: createInitialChatMessages(),
  conversationItems: [],
  isAssistantLoading: false,
  setChatMessages: (items) => set({ chatMessages: items }),
  setConversationItems: (messages) => set({ conversationItems: messages }),
  addChatMessage: (item) =>
    set((state) => ({ chatMessages: [...state.chatMessages, item] })),
  addConversationItem: (message) =>
    set((state) => ({
      conversationItems: [...state.conversationItems, message],
    })),
  setAssistantLoading: (loading) => set({ isAssistantLoading: loading }),
  rawSet: set,
  loadConversation: (messages, conversation) =>
    set(() => ({
      chatMessages: messages,
      conversationItems: conversation,
      isAssistantLoading: false,
    })),
  resetConversation: () =>
    set(() => ({
      chatMessages: createInitialChatMessages(),
      conversationItems: [],
      isAssistantLoading: false,
    })),
}));

export default useConversationStore;
