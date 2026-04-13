import { createContext, useContext, useRef, type ReactNode } from "react";
import { createChatPreferenceStore, type IChatPreferenceStore } from "./store/chat-preference-store.js";

const ChatPreferenceStoreContext = createContext<IChatPreferenceStore | null>(null);

export function ChatPreferenceStoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<IChatPreferenceStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createChatPreferenceStore();
  }
  return (
    <ChatPreferenceStoreContext value={storeRef.current}>
      {children}
    </ChatPreferenceStoreContext>
  );
}

export function useChatPreferenceStore(): IChatPreferenceStore {
  const store = useContext(ChatPreferenceStoreContext);
  if (!store) throw new Error("useChatPreferenceStore must be used within ChatPreferenceStoreProvider");
  return store;
}
