import type { ConvertedMarker } from "./types.js";

export function createUniqueCuePlan(uniqueCues: ConvertedMarker[]): Array<ConvertedMarker & { cueName: string }> {
    const seenNames = new Map<string, number>();

    return uniqueCues.map((marker, index) => {
        const hasDisplayName = marker.displayName.trim().length > 0;
        const baseName = hasDisplayName ? marker.displayName : `Cue ${index + 1}`;
        const nextIndex = hasDisplayName ? (seenNames.get(baseName) ?? 0) + 1 : 1;

        if (hasDisplayName) {
            seenNames.set(baseName, nextIndex);
        }

        return {
            ...marker,
            cueName: hasDisplayName ? (nextIndex === 1 ? baseName : `${baseName} ${nextIndex}`) : baseName,
        };
    });
}
