import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionTabBar } from "./SessionTabBar.js";

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  value: vi.fn(),
  writable: true,
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

describe("SessionTabBar", () => {
  it("shows a local session's title as soon as one exists", () => {
    render(
      <SessionTabBar
        sessions={[
          { key: "agent:main:main" },
          { key: "agent:panel:test", isLocal: true, panelTitle: "First prompt title" },
        ]}
        activeSessionKey="agent:panel:test"
        unreadKeys={new Set()}
        onSwitchSession={() => {}}
        onNewChat={() => {}}
        onArchiveSession={() => {}}
        onRenameSession={() => {}}
        onRestoreSession={() => {}}
        onReorderSession={() => {}}
      />,
    );

    expect(screen.getByText("First prompt title")).toBeTruthy();
    expect(screen.queryByText("chat.newSessionTitle")).toBeNull();
  });

  it("prefers a panel title over a gateway derived title for panel sessions", () => {
    render(
      <SessionTabBar
        sessions={[
          { key: "agent:main:main" },
          { key: "agent:main:panel-9137969f", panelTitle: "我的首条消息", derivedTitle: "panel-9137969f" },
        ]}
        activeSessionKey="agent:main:panel-9137969f"
        unreadKeys={new Set()}
        onSwitchSession={() => {}}
        onNewChat={() => {}}
        onArchiveSession={() => {}}
        onRenameSession={() => {}}
        onRestoreSession={() => {}}
        onReorderSession={() => {}}
      />,
    );

    expect(screen.getByText("我的首条消息")).toBeTruthy();
    expect(screen.queryByText("panel-9137969f")).toBeNull();
  });

  it("keeps the default label for a blank local session", () => {
    render(
      <SessionTabBar
        sessions={[
          { key: "agent:main:main" },
          { key: "agent:panel:test", isLocal: true },
        ]}
        activeSessionKey="agent:panel:test"
        unreadKeys={new Set()}
        onSwitchSession={() => {}}
        onNewChat={() => {}}
        onArchiveSession={() => {}}
        onRenameSession={() => {}}
        onRestoreSession={() => {}}
        onReorderSession={() => {}}
      />,
    );

    expect(screen.getByText("chat.newSessionTitle")).toBeTruthy();
  });
});
