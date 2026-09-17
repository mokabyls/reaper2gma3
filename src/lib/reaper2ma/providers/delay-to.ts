import { createCueTimingProvider } from "./cue-timing-utils.js";

export const delayToTagProvider = createCueTimingProvider({
    id: "delay-to",
    prefix: "DELAYTO",
    keyPrefix: "DelayTo",
});
