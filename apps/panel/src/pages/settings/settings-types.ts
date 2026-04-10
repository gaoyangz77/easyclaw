export const DM_SCOPE_OPTIONS = [
  { value: "main", labelKey: "settings.agent.dmScopeMain" },
  { value: "per-peer", labelKey: "settings.agent.dmScopePerPeer" },
  { value: "per-channel-peer", labelKey: "settings.agent.dmScopePerChannelPeer" },
  { value: "per-account-channel-peer", labelKey: "settings.agent.dmScopePerAccountChannelPeer" },
];

export type DoctorStatus = "idle" | "running" | "done" | "error";
