import type { CueTimingTag, CueTimingTagKey } from "../types.js";
import type { MarkerEnrichmentState, MarkerTagProvider } from "./types.js";

export type CueTimingTagFamily = {
    readonly id: string;
    readonly prefix: "FADEFROM" | "FADETO" | "DELAYFROM" | "DELAYTO";
    readonly keyPrefix: "FadeFrom" | "FadeTo" | "DelayFrom" | "DelayTo";
};

export function createCueTimingProvider(family: CueTimingTagFamily): MarkerTagProvider {
    const allowedAxes = new Set(["X", "Y", "Z"]);

    return {
        id: family.id,
        supports(tag) {
            const normalizedKey = tag.key.toUpperCase();
            return (
                normalizedKey.startsWith(family.prefix) &&
                normalizedKey.length === family.prefix.length + 1 &&
                allowedAxes.has(normalizedKey.slice(family.prefix.length))
            );
        },
        apply(tag, state: MarkerEnrichmentState) {
            if (tag.value === null) {
                return;
            }

            const normalizedKey = tag.key.toUpperCase();
            const axis = normalizedKey.slice(family.prefix.length);

            const value = tag.value.trim();

            if (!value) {
                return;
            }

            const cueTimingTag = {
                key: `${family.keyPrefix}${axis}` as CueTimingTagKey,
                value,
            } satisfies CueTimingTag;

            if (!state.cueTiming.some((existing) => existing.key === cueTimingTag.key)) {
                state.cueTiming.push(cueTimingTag);
            }
        },
    };
}
