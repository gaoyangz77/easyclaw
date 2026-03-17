import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { Storage, MobilePairing } from "@rivonclaw/storage";
import { createLogger } from "@rivonclaw/logger";

const log = createLogger("mobile-manager");

/** How long a pairing code stays valid (ms). Shared with panel via API response. */
export const PAIRING_CODE_TTL_MS = 60_000;

export class MobileManager {
    private activeCode: { code: string; expiresAt: number } | null = null;
    private desktopDeviceId: string | null = null;

    constructor(
        private readonly storage: Storage,
        private readonly controlPlaneUrl: string = "https://api.easy-claw.com",
        private readonly stateDir?: string,
    ) { }

    public getDesktopDeviceId(): string {
        if (this.desktopDeviceId) {
            return this.desktopDeviceId;
        }

        // Persist desktop device ID to disk so pairings survive restarts
        if (this.stateDir) {
            const idDir = join(this.stateDir, "identity");
            const idPath = join(idDir, "mobile-desktop-id.txt");
            try {
                const stored = readFileSync(idPath, "utf-8").trim();
                if (stored) {
                    this.desktopDeviceId = stored;
                    return stored;
                }
            } catch {
                // File doesn't exist yet — will create below
            }

            const id = randomUUID();
            try {
                mkdirSync(idDir, { recursive: true });
                writeFileSync(idPath, id, "utf-8");
            } catch (err) {
                log.error("Failed to persist desktop device ID:", err);
            }
            this.desktopDeviceId = id;
            return id;
        }

        this.desktopDeviceId = randomUUID();
        return this.desktopDeviceId;
    }

    public getActivePairing() {
        return this.storage.mobilePairings.getActivePairing();
    }

    public getAllPairings(): MobilePairing[] {
        return this.storage.mobilePairings.getAllPairings();
    }

    public disconnectPairing(pairingId?: string): void {
        if (pairingId) {
            this.storage.mobilePairings.removePairingById(pairingId);
            log.info("Mobile pairing disconnected:", pairingId);
        } else {
            this.storage.mobilePairings.clearPairing();
            this.activeCode = null;
            log.info("All mobile pairings disconnected");
        }
    }

    public getActiveCode(): { code: string; expiresAt: number } | null {
        if (this.activeCode && this.activeCode.expiresAt > Date.now()) {
            return this.activeCode;
        }
        this.activeCode = null;
        return null;
    }

    public clearActiveCode(): void {
        this.activeCode = null;
    }
}
