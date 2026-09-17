import type { CueTimingTag, MarkerTag } from "../types.js";

export type MarkerEnrichmentState = {
    bpm?: number;
    bpmText?: string;
    cueFade?: string;
    cueTiming: CueTimingTag[];
};

export interface MarkerTagProvider {
    readonly id: string;
    supports(tag: MarkerTag): boolean;
    apply(tag: MarkerTag, state: MarkerEnrichmentState): void;
}

export function createMarkerEnrichmentState(): MarkerEnrichmentState {
    return {
        cueTiming: [],
    };
}
