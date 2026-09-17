import { createCueTimingProvider } from "./cue-timing-utils.js";

export const delayFromTagProvider = createCueTimingProvider({
    id: "delay-from",
    prefix: "DELAYFROM",
    keyPrefix: "DelayFrom",
});
