import { createCueTimingProvider } from "./cue-timing-utils.js";

export const fadeFromTagProvider = createCueTimingProvider({
    id: "fade-from",
    prefix: "FADEFROM",
    keyPrefix: "FadeFrom",
});
