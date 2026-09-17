import type { StorageUsage } from "./types.js";

export async function getStorageUsage(): Promise<StorageUsage | undefined> {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
        return undefined;
    }

    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage ?? 0;
    const quota = estimate.quota ?? 0;

    if (quota <= 0) {
        return undefined;
    }

    const ratio = usage / quota;
    return {
        usage,
        quota,
        ratio,
        warning: ratio >= 0.8,
        critical: ratio >= 0.95,
    };
}

export async function canStoreBytes(additionalBytes: number): Promise<boolean> {
    const usage = await getStorageUsage();
    return !usage || (usage.usage + Math.max(0, additionalBytes)) / usage.quota < 0.95;
}

export async function requestPersistentStorage(): Promise<boolean | undefined> {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) {
        return undefined;
    }

    return navigator.storage.persist();
}
