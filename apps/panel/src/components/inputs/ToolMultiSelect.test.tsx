import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ToolMultiSelect } from "./ToolMultiSelect.js";

const mockStore = {
  availableTools: [] as Array<{ id: string; displayName: string; description: string; category: string; source: "entitled" }>,
  allTools: [] as Array<{ id: string; displayName: string; description: string; category: string }>,
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../store/EntityStoreProvider.js", () => ({
  useEntityStore: () => mockStore,
}));

describe("ToolMultiSelect", () => {
  beforeEach(() => {
    mockStore.availableTools = [
      {
        id: "tool_active",
        displayName: "Active Tool",
        description: "Still available",
        category: "ECOM_CS",
        source: "entitled",
      },
    ];
    mockStore.allTools = [...mockStore.availableTools];
  });

  it("keeps selected unavailable tools visible so they can be deselected", async () => {
    const onChange = vi.fn();

    render(
      <ToolMultiSelect
        selected={new Set(["tool_active", "tool_deprecated"])}
        onChange={onChange}
        allowedToolIds={["tool_active"]}
      />,
    );

    expect(screen.getByText("tool_deprecated")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("tool_deprecated"));

    expect(onChange).toHaveBeenCalledWith(new Set(["tool_active"]));
  });
});
