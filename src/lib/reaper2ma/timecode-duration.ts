import type { BpmSequence, BumpSequence, ConvertedMarker, RegionLayerSequence, RegionSequence, RepeatedSequence } from "./types.js";

export function collectTimecodeTimestamps(
    uniqueCues: ConvertedMarker[],
    regionSequences: RegionSequence[],
    regionLayerSequences: RegionLayerSequence[],
    repeatedSequences: RepeatedSequence[],
    bumpSequences: BumpSequence[],
    bpmSequence?: BpmSequence,
): string[] {
    return [
        ...uniqueCues.map((cue) => cue.start),
        ...regionSequences.flatMap((sequence) => sequence.events.map((event) => event.timestamp)),
        ...regionLayerSequences.flatMap((sequence) => sequence.events.map((event) => event.timestamp)),
        ...repeatedSequences.flatMap((sequence) => sequence.events.map((event) => event.timestamp)),
        ...bumpSequences.flatMap((sequence) =>
            sequence.events.flatMap((event) => [event.timestamp, offsetTimestampBySeconds(event.timestamp, sequence.releaseDurationSeconds)]),
        ),
        ...(bpmSequence?.events.flatMap((event) => [
            event.timestamp,
            offsetTimestampBySeconds(event.timestamp, bpmSequence.releaseDurationSeconds),
        ]) ?? []),
    ].filter((timestamp) => timestamp !== "");
}

export function calculateTimecodeDuration(timestamps: string[]): string {
    if (timestamps.length === 0) {
        return "0.00";
    }

    const maxTimestamp = timestamps.reduce((max, value) => {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
    }, 0);

    return (maxTimestamp + 1).toFixed(3);
}

function offsetTimestampBySeconds(timestamp: string, seconds: string): string {
    const parsedTimestamp = Number.parseFloat(timestamp);
    const parsedSeconds = Number.parseFloat(seconds);

    if (!Number.isFinite(parsedTimestamp) || !Number.isFinite(parsedSeconds)) {
        return timestamp;
    }

    return (parsedTimestamp + parsedSeconds).toFixed(3);
}
