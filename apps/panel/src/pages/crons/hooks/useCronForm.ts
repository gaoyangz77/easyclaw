import { useState, useCallback, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { fetchChannelStatus, fetchAllowlist, type ChannelsStatusSnapshot } from "../../../api/channels.js";
import { KNOWN_CHANNELS } from "../../../lib/channel-defs.js";
import { setRunProfileForScope } from "../../../api/tool-registry.js";
import { useEntityStore } from "../../../store/EntityStoreProvider.js";
import type { CronJob, CronJobFormData, FormErrors } from "../cron-utils.js";
import { defaultFormData, cronJobToFormData, formDataToCreateParams, formDataToPatch, validateCronForm } from "../cron-utils.js";

/** Stable scope key used for tool selections when creating a new cron job (no real ID yet). */
export const TEMP_CRON_SCOPE_KEY = "__new_cron__";

interface UseCronFormParams {
  mode: "create" | "edit";
  initialData?: CronJob;
  onSubmit: (params: Record<string, unknown>) => Promise<void>;
}

export function useCronForm({ mode, initialData, onSubmit }: UseCronFormParams) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CronJobFormData>(
    initialData ? cronJobToFormData(initialData) : defaultFormData(),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showRawCron, setShowRawCron] = useState(false);

  // Channel status (fetched once on mount)
  const [channelSnapshot, setChannelSnapshot] = useState<ChannelsStatusSnapshot | null>(null);
  const [channelStatusLoading, setChannelStatusLoading] = useState(true);
  // Allowlist for the currently selected delivery channel
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [recipientLabels, setRecipientLabels] = useState<Record<string, string>>({});
  const [_allowlistLoading, setAllowlistLoading] = useState(false);
  const entityStore = useEntityStore();
  const runProfiles = entityStore.allRunProfiles;
  const [selectedRunProfileId, setSelectedRunProfileId] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchChannelStatus(false).then((snapshot) => {
      if (!cancelled) {
        setChannelSnapshot(snapshot);
        setChannelStatusLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setChannelStatusLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const update = useCallback(<K extends keyof CronJobFormData>(key: K, value: CronJobFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    if (form.deliveryMode !== "announce" || !form.deliveryChannel) {
      setAllowlist([]);
      setRecipientLabels({});
      return;
    }
    let cancelled = false;
    setAllowlistLoading(true);
    fetchAllowlist(form.deliveryChannel, form.deliveryAccountId || undefined).then((result) => {
      if (!cancelled) {
        setAllowlist(result.allowlist);
        setRecipientLabels(result.labels);
        setAllowlistLoading(false);
        // Auto-select first recipient if none selected
        if (!form.deliveryTo && result.allowlist.length > 0) {
          update("deliveryTo", result.allowlist[0]);
        }
      }
    }).catch(() => {
      if (!cancelled) {
        setAllowlist([]);
        setRecipientLabels({});
        setAllowlistLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [form.deliveryChannel, form.deliveryAccountId, form.deliveryMode]);

  const handleSubmit = useCallback(async () => {
    const fieldErrors = validateCronForm(form);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      const params = mode === "edit" && initialData
        ? formDataToPatch(initialData, form)
        : formDataToCreateParams(form);
      await onSubmit(params);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [form, mode, initialData, onSubmit]);

  /** Channel account options as `channelId:accountId` pairs, matching EcommercePage pattern. */
  const connectedChannelOptions = useMemo(() => {
    if (!channelSnapshot) return [];
    const options: { value: string; label: string }[] = [];
    for (const [channelId, accounts] of Object.entries(channelSnapshot.channelAccounts)) {
      const knownChannel = KNOWN_CHANNELS.find((c) => c.id === channelId);
      const channelLabel = knownChannel
        ? t(knownChannel.labelKey)
        : channelSnapshot.channelLabels[channelId] || channelId;
      for (const account of accounts) {
        if (account.enabled === false) continue;
        const isSyntheticDefault =
          account.accountId === "default" &&
          account.configured === false &&
          !account.name &&
          (account as any).tokenSource === "none";
        if (isSyntheticDefault) continue;
        options.push({
          value: `${channelId}:${account.accountId}`,
          label: `${channelLabel} - ${account.name || account.accountId}`,
        });
      }
    }
    const orderMap = new Map(channelSnapshot.channelOrder.map((id, i) => [id, i]));
    options.sort((a, b) => {
      const aChannel = a.value.split(":")[0];
      const bChannel = b.value.split(":")[0];
      return (orderMap.get(aChannel) ?? 999) - (orderMap.get(bChannel) ?? 999);
    });
    return options;
  }, [channelSnapshot, t]);

  // Legacy cron jobs store bare channelId without accountId — auto-migrate
  // by matching the first connected account for that channel.
  useEffect(() => {
    if (form.deliveryChannel && !form.deliveryAccountId && connectedChannelOptions.length > 0) {
      const match = connectedChannelOptions.find((o) => o.value.startsWith(`${form.deliveryChannel}:`));
      if (match) {
        const colonIdx = match.value.indexOf(":");
        update("deliveryAccountId", match.value.slice(colonIdx + 1));
      }
    }
  }, [form.deliveryChannel, form.deliveryAccountId, connectedChannelOptions]);

  /** Channel options with fallback for disconnected current selection (edit mode). */
  const channelOptions = useMemo(() => {
    const compositeValue = form.deliveryChannel && form.deliveryAccountId
      ? `${form.deliveryChannel}:${form.deliveryAccountId}`
      : form.deliveryChannel;
    if (!compositeValue) return connectedChannelOptions;
    if (connectedChannelOptions.some((o) => o.value === compositeValue)) return connectedChannelOptions;
    return [
      { value: compositeValue, label: `${compositeValue} (${t("crons.channelDisconnected")})` },
      ...connectedChannelOptions,
    ];
  }, [connectedChannelOptions, form.deliveryChannel, form.deliveryAccountId, t]);

  /** Recipient options from allowlist, showing label (id) when available. */
  const recipientOptions = useMemo(() => {
    const opts = allowlist.map((entry) => {
      const lbl = recipientLabels[entry];
      return { value: entry, label: lbl ? `${lbl} (${entry})` : entry };
    });
    if (form.deliveryTo && !opts.some((o) => o.value === form.deliveryTo)) {
      const lbl = recipientLabels[form.deliveryTo];
      opts.unshift({ value: form.deliveryTo, label: lbl ? `${lbl} (${form.deliveryTo})` : form.deliveryTo });
    }
    return opts;
  }, [allowlist, form.deliveryTo, recipientLabels]);

  const handleChannelChange = useCallback((v: string) => {
    const colonIdx = v.indexOf(":");
    if (colonIdx === -1) {
      update("deliveryChannel", v);
      update("deliveryAccountId", "");
    } else {
      update("deliveryChannel", v.slice(0, colonIdx));
      update("deliveryAccountId", v.slice(colonIdx + 1));
    }
    update("deliveryTo", "");
  }, [update]);

  const handleRunProfileChange = useCallback((profileId: string) => {
    setSelectedRunProfileId(profileId);
    const cronScopeKey = mode === "edit" && initialData ? initialData.id : TEMP_CRON_SCOPE_KEY;
    if (!profileId || !runProfiles.find((p) => p.id === profileId)) {
      setRunProfileForScope(cronScopeKey, null).catch(() => {});
      return;
    }
    setRunProfileForScope(cronScopeKey, profileId).catch(() => {});
  }, [mode, initialData, runProfiles]);

  return {
    form,
    errors,
    saving,
    submitError,
    showRawCron,
    setShowRawCron,
    channelOptions,
    recipientOptions,
    channelStatusLoading,
    selectedRunProfileId,
    handleRunProfileChange,
    update,
    handleSubmit,
    handleChannelChange,
  };
}
