import type { MarkerTagProvider } from "./types.js";

export const cueFadeTagProvider: MarkerTagProvider = {
    id: "cue-fade",
    supports(tag) {
        return tag.key.toUpperCase() === "CUEFADE";
    },
    apply(tag, state) {
        if (tag.value === null) {
            return;
        }

        const value = tag.value.trim();

        if (!value || state.cueFade !== undefined) {
            return;
        }

        state.cueFade = value;
    },
};
