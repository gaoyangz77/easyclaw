import type { Instance } from "mobx-state-tree";
import type { ChatStoreModel } from "./chat-store.js";
import type { ChatSessionModel } from "./models/ChatSessionModel.js";
import type { ChatRunStateModel } from "./models/ChatRunStateModel.js";

export type IChatStore = Instance<typeof ChatStoreModel>;
export type IChatSession = Instance<typeof ChatSessionModel>;
export type IChatRunState = Instance<typeof ChatRunStateModel>;
