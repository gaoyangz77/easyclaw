import { useState, useEffect } from "react";
import type { Instance } from "mobx-state-tree";
import { useTranslation } from "react-i18next";
import { useToast } from "../../../components/Toast.js";
import { fetchJson } from "../../../api/client.js";
import { ShopModel } from "../../../store/models/index.js";

type Shop = Instance<typeof ShopModel>;

export function useDeviceBinding(shops: Shop[]) {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [myDeviceId, setMyDeviceId] = useState<string | null>(null);
  const [bindConflictShopId, setBindConflictShopId] = useState<string | null>(null);
  const [togglingBindShopId, setTogglingBindShopId] = useState<string | null>(null);

  // Fetch deviceId from desktop on mount
  useEffect(() => {
    fetchJson<{ deviceId?: string }>("/status")
      .then((status) => setMyDeviceId(status.deviceId || null))
      .catch(() => setMyDeviceId(null));
  }, []);

  async function handleBindDevice(shopId: string) {
    if (!myDeviceId) return;
    const shop = shops.find((s) => s.id === shopId);
    if (!shop) return;
    const existingDeviceId = shop.services?.customerService?.csDeviceId;
    if (existingDeviceId && existingDeviceId !== myDeviceId) {
      // Another device is handling this shop — ask for confirmation
      setBindConflictShopId(shopId);
      return;
    }
    setTogglingBindShopId(shopId);
    try {
      await shop.update({
        services: { customerService: { csDeviceId: myDeviceId } },
      });
      showToast(t("ecommerce.deviceBound"), "success");
    } catch {
      showToast(t("ecommerce.updateFailed"), "error");
    } finally {
      setTogglingBindShopId(null);
    }
  }

  async function handleForceBindConfirmed() {
    const shopId = bindConflictShopId;
    setBindConflictShopId(null);
    if (!shopId || !myDeviceId) return;
    const shop = shops.find((s) => s.id === shopId);
    if (!shop) return;
    setTogglingBindShopId(shopId);
    try {
      await shop.update({
        services: { customerService: { csDeviceId: myDeviceId } },
      });
      showToast(t("ecommerce.deviceBound"), "success");
    } catch {
      showToast(t("ecommerce.updateFailed"), "error");
    } finally {
      setTogglingBindShopId(null);
    }
  }

  async function handleUnbindDevice(shopId: string) {
    const shop = shops.find((s) => s.id === shopId);
    if (!shop) return;
    setTogglingBindShopId(shopId);
    try {
      await shop.update({
        services: { customerService: { csDeviceId: null } },
      });
      showToast(t("ecommerce.deviceUnbound"), "success");
    } catch {
      showToast(t("ecommerce.updateFailed"), "error");
    } finally {
      setTogglingBindShopId(null);
    }
  }

  return {
    myDeviceId,
    bindConflictShopId,
    togglingBindShopId,
    setBindConflictShopId,
    handleBindDevice,
    handleForceBindConfirmed,
    handleUnbindDevice,
  };
}
