import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent, fetchOpenClawStateDir, updateOpenClawStateDir, resetOpenClawStateDir, openFileDialog } from "../../../api/index.js";
import type { OpenClawStateDirInfo } from "../../../api/index.js";
import { useToast } from "../../../components/Toast.js";

export function useOpenClawStateDir() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [dataDirInfo, setDataDirInfo] = useState<OpenClawStateDirInfo | null>(null);
  const [dataDirRestartNeeded, setDataDirRestartNeeded] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadStateDir() {
    try {
      const dirInfo = await fetchOpenClawStateDir();
      setDataDirInfo(dirInfo);
    } catch (err) {
      console.error("Failed to load state dir:", err);
    }
  }

  useEffect(() => { loadStateDir(); }, []);

  async function handleChangeDataDir() {
    const selected = await openFileDialog();
    if (!selected) return;
    try {
      setSaving(true);
      await updateOpenClawStateDir(selected);
      setDataDirInfo((prev) => prev ? { ...prev, override: selected } : prev);
      setDataDirRestartNeeded(true);
    } catch (err) {
      showToast(t("settings.dataDir.failedToSave") + String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleResetDataDir() {
    try {
      setSaving(true);
      await resetOpenClawStateDir();
      trackEvent("settings.state_dir_reset");
      setDataDirInfo((prev) => prev ? { ...prev, override: null } : prev);
      setDataDirRestartNeeded(true);
    } catch (err) {
      showToast(t("settings.dataDir.failedToReset") + String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  return { dataDirInfo, dataDirRestartNeeded, saving, handleChangeDataDir, handleResetDataDir };
}
