import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCronForm, SUBMIT_RUN_PROFILE_ID_KEY } from "./useCronForm.js";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const {
  fetchChannelStatus,
  fetchAllowlist,
  getRunProfileForScope,
} = vi.hoisted(() => ({
  fetchChannelStatus: vi.fn(),
  fetchAllowlist: vi.fn(),
  getRunProfileForScope: vi.fn(),
}));

vi.mock("../../../api/channels.js", () => ({
  fetchChannelStatus,
  fetchAllowlist,
}));

vi.mock("../../../api/tool-registry.js", () => ({
  getRunProfileForScope,
}));

vi.mock("../../../store/EntityStoreProvider.js", () => ({
  useEntityStore: () => ({
    allRunProfiles: [
      { id: "rp-1" },
      { id: "rp-2" },
    ],
  }),
}));

describe("useCronForm", () => {
  beforeEach(() => {
    fetchChannelStatus.mockResolvedValue({
      channelAccounts: {},
      channelLabels: {},
      channelOrder: [],
    });
    fetchAllowlist.mockResolvedValue({ allowlist: [], labels: {} });
    getRunProfileForScope.mockReset();
  });

  it("loads the saved run profile for an existing cron job", async () => {
    getRunProfileForScope.mockResolvedValue("rp-1");

    const { result } = renderHook(() => useCronForm({
      mode: "edit",
      initialData: {
        id: "job-1",
        name: "Existing job",
        enabled: true,
        createdAtMs: 1,
        updatedAtMs: 1,
        schedule: { kind: "cron", expr: "0 * * * *" },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "hello" },
        state: {},
      },
      onSubmit: vi.fn(),
    }));

    await waitFor(() => {
      expect(result.current.selectedRunProfileId).toBe("rp-1");
    });
    expect(getRunProfileForScope).toHaveBeenCalledWith("job-1");
  });

  it("keeps run profile changes local until submit and includes the chosen profile in submit params", async () => {
    getRunProfileForScope.mockResolvedValue("rp-1");
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useCronForm({
      mode: "edit",
      initialData: {
        id: "job-1",
        name: "Existing job",
        enabled: true,
        createdAtMs: 1,
        updatedAtMs: 1,
        schedule: { kind: "cron", expr: "0 * * * *" },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "hello" },
        state: {},
      },
      onSubmit,
    }));

    await waitFor(() => {
      expect(result.current.selectedRunProfileId).toBe("rp-1");
    });

    act(() => {
      result.current.handleRunProfileChange("rp-2");
    });

    expect(result.current.selectedRunProfileId).toBe("rp-2");
    expect(getRunProfileForScope).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      schedule: { kind: "cron", expr: "0 * * * *" },
      payload: { kind: "agentTurn", message: "hello" },
      [SUBMIT_RUN_PROFILE_ID_KEY]: "rp-2",
    });
  });
});
