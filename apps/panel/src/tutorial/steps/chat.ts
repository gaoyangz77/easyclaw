import type { TutorialStep } from "../types.js"

export const chatSteps: TutorialStep[] = [
  // --- Overview ---
  {
    target: ".chat-container",
    titleKey: "tutorial.chat.welcomeTitle",
    bodyKey: "tutorial.chat.welcomeBody",
    placement: "bottom",
  },
  // --- Session Tabs ---
  {
    target: ".chat-session-tabs",
    titleKey: "tutorial.chat.sessionTabsTitle",
    bodyKey: "tutorial.chat.sessionTabsBody",
    placement: "bottom",
  },
  {
    target: ".chat-session-tab-new-btn",
    titleKey: "tutorial.chat.newSessionBtnTitle",
    bodyKey: "tutorial.chat.newSessionBtnBody",
    placement: "bottom",
  },
  {
    target: ".chat-archived-trigger-wrap",
    titleKey: "tutorial.chat.archivedBtnTitle",
    bodyKey: "tutorial.chat.archivedBtnBody",
    placement: "bottom",
  },
  // --- Message Area ---
  {
    target: ".chat-messages, .chat-empty",
    titleKey: "tutorial.chat.messageAreaTitle",
    bodyKey: "tutorial.chat.messageAreaBody",
    placement: "bottom",
  },
  // --- Example Prompts ---
  {
    target: ".chat-examples",
    titleKey: "tutorial.chat.examplesTitle",
    bodyKey: "tutorial.chat.examplesBody",
    placement: "top",
  },
  {
    target: ".chat-example-edit",
    titleKey: "tutorial.chat.exampleEditTitle",
    bodyKey: "tutorial.chat.exampleEditBody",
    placement: "top",
  },
  // --- Status Bar ---
  {
    target: ".chat-status",
    titleKey: "tutorial.chat.statusBarTitle",
    bodyKey: "tutorial.chat.statusBarBody",
    placement: "top",
  },
  {
    target: ".chat-status-dot",
    titleKey: "tutorial.chat.connectionDotTitle",
    bodyKey: "tutorial.chat.connectionDotBody",
    placement: "right",
  },
  {
    target: ".key-model-selector",
    titleKey: "tutorial.chat.modelSelectTitle",
    bodyKey: "tutorial.chat.modelSelectBody",
    placement: "top",
  },
  {
    target: ".chat-thinking-select",
    titleKey: "tutorial.chat.thinkingSelectTitle",
    bodyKey: "tutorial.chat.thinkingSelectBody",
    placement: "top",
  },
  {
    target: ".chat-context-usage",
    titleKey: "tutorial.chat.contextUsageTitle",
    bodyKey: "tutorial.chat.contextUsageBody",
    placement: "top",
  },
  {
    target: ".chat-profile-select",
    titleKey: "tutorial.chat.runProfileTitle",
    bodyKey: "tutorial.chat.runProfileBody",
    placement: "top",
  },
  {
    target: ".chat-status .btn-secondary",
    titleKey: "tutorial.chat.resetBtnTitle",
    bodyKey: "tutorial.chat.resetBtnBody",
    placement: "top",
  },
  // --- Input Area ---
  {
    target: ".chat-input-area",
    titleKey: "tutorial.chat.inputAreaTitle",
    bodyKey: "tutorial.chat.inputAreaBody",
    placement: "top",
  },
  {
    target: ".chat-attach-btn",
    titleKey: "tutorial.chat.attachBtnTitle",
    bodyKey: "tutorial.chat.attachBtnBody",
    placement: "top",
  },
  {
    target: ".chat-emoji-btn",
    titleKey: "tutorial.chat.emojiBtnTitle",
    bodyKey: "tutorial.chat.emojiBtnBody",
    placement: "top",
  },
  {
    target: ".chat-input-area .btn-primary, .chat-input-area .btn-danger",
    titleKey: "tutorial.chat.sendStopBtnTitle",
    bodyKey: "tutorial.chat.sendStopBtnBody",
    placement: "top",
  },
]
