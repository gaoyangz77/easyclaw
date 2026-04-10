export interface MobilePairingInfo {
    id: string;
    pairingId?: string;
    deviceId: string;
    accessToken: string;
    relayUrl: string;
    createdAt: string;
    mobileDeviceId?: string;
    name?: string;
}

export interface MobilePairingStatusResponse {
    pairings?: MobilePairingInfo[];
    activeCode?: { code: string; expiresAt: number } | null;
    desktopDeviceId?: string;
    error?: string;
}

export interface RegisterPairingBody {
    pairingId?: string;
    desktopDeviceId: string;
    accessToken: string;
    relayUrl: string;
    mobileDeviceId?: string;
}

export interface MobileDeviceStatusResponse {
    devices: Record<string, { relayConnected: boolean; mobileOnline: boolean; stale?: boolean }>;
}
