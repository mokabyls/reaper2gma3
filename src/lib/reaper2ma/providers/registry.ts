import { bpmTagProvider } from "./bpm.js";
import { cueFadeTagProvider } from "./cue-fade.js";
import { delayFromTagProvider } from "./delay-from.js";
import { delayToTagProvider } from "./delay-to.js";
import { fadeFromTagProvider } from "./fade-from.js";
import { fadeToTagProvider } from "./fade-to.js";
import { createMarkerEnrichmentState, type MarkerEnrichmentState, type MarkerTagProvider } from "./types.js";
import type { MarkerTag } from "../types.js";

const DEFAULT_PROVIDERS: MarkerTagProvider[] = [
    bpmTagProvider,
    cueFadeTagProvider,
    fadeFromTagProvider,
    fadeToTagProvider,
    delayFromTagProvider,
    delayToTagProvider,
];

export class MarkerTagProviderRegistry {
    constructor(private readonly providers: MarkerTagProvider[] = DEFAULT_PROVIDERS) {}

    enrich(tags: MarkerTag[]): MarkerEnrichmentState {
        const state = createMarkerEnrichmentState();

        for (const tag of tags) {
            for (const provider of this.providers) {
                if (!provider.supports(tag)) {
                    continue;
                }

                provider.apply(tag, state);
                break;
            }
        }

        return state;
    }
}

export function createDefaultMarkerTagProviderRegistry(): MarkerTagProviderRegistry {
    return new MarkerTagProviderRegistry();
}
