import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { createChatStore, type IChatStore } from "./store/chat-store.js";
import { ChatGatewayController } from "./controllers/ChatGatewayController.js";

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

const ChatStoreContext = createContext<IChatStore | null>(null);
const ChatControllerContext = createContext<ChatGatewayController | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ChatStoreProvider({ children }: { children: ReactNode }) {
  // Lazy-init: store + controller are created once per provider mount
  const storeRef = useRef<IChatStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createChatStore();
  }

  const controllerRef = useRef<ChatGatewayController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new ChatGatewayController(storeRef.current);
  }

  useEffect(() => {
    const ctrl = controllerRef.current!;
    ctrl.start();
    return () => ctrl.stop();
  }, []);

  return (
    <ChatStoreContext value={storeRef.current}>
      <ChatControllerContext value={controllerRef.current}>
        {children}
      </ChatControllerContext>
    </ChatStoreContext>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Access the Chat MST store from any component within ChatStoreProvider.
 * Wrap the consuming component with `observer()` for MobX reactivity.
 */
export function useChatStore(): IChatStore {
  const store = useContext(ChatStoreContext);
  if (!store) throw new Error("useChatStore must be used within ChatStoreProvider");
  return store;
}

/**
 * Access the ChatGatewayController from any component within ChatStoreProvider.
 */
export function useChatController(): ChatGatewayController {
  const ctrl = useContext(ChatControllerContext);
  if (!ctrl) throw new Error("useChatController must be used within ChatStoreProvider");
  return ctrl;
}
