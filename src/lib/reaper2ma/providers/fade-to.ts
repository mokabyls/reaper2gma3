import { createCueTimingProvider } from "./cue-timing-utils.js";

export const fadeToTagProvider = createCueTimingProvider({
    id: "fade-to",
    prefix: "FADETO",
    keyPrefix: "FadeTo",
});
