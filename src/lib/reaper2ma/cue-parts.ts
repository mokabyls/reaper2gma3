import { resolveBumpMarkerColor } from "./sequence-services.js";
import type {
    BumpSequence,
    ConvertedMarker,
    ImportMode,
    RegionLayerSequence,
    RegionSequence,
    RepeatedSequence,
    SequenceCue,
    SequenceCuePart,
    SequenceTrigger,
} from "./types.js";

type CuePartTarget = {
    cue: SequenceCue | ConvertedMarker;
    timestamp: string;
    cueName: string;
};

export function splitCuePartMarkers(markers: ConvertedMarker[]): {
    contentMarkers: ConvertedMarker[];
    cuePartMarkers: ConvertedMarker[];
} {
    return {
        contentMarkers: markers.filter((marker) => !marker.isCuePart),
        cuePartMarkers: markers.filter((marker) => marker.isCuePart),
    };
}

export function attachCuePartMarkers(
    allMarkers: ConvertedMarker[],
    uniqueCues: ConvertedMarker[],
    regionSequences: RegionSequence[],
    regionLayerSequences: RegionLayerSequence[],
    repeatedSequences: RepeatedSequence[],
    bumpSequences: BumpSequence[],
    importMode: ImportMode,
): string[] {
    const contentMarkers = allMarkers.filter((marker) => !marker.isCuePart);
    const cuePartMarkers = allMarkers
        .map((marker, sourceOrder) => ({ marker, sourceOrder }))
        .filter(({ marker }) => marker.isCuePart)
        .sort((left, right) => compareMarkerTimes(left.marker.start, right.marker.start, left.sourceOrder, right.sourceOrder));
    const warnings: string[] = [];

    for (const { marker } of cuePartMarkers) {
        const incompatibility = resolveCuePartIncompatibility(marker);

        if (incompatibility) {
            warnings.push(`Cue Part marker "${marker.displayName || "Part"}" ${incompatibility}. It is ignored.`);
            continue;
        }

        const target = resolveCuePartTarget(
            marker,
            contentMarkers,
            uniqueCues,
            regionSequences,
            regionLayerSequences,
            repeatedSequences,
            bumpSequences,
            importMode,
        );

        if (!target) {
            warnings.push(
                `Cue Part marker "${marker.displayName || "Part"}" at ${marker.start}s has no previous cue in its target sequence. It is ignored.`,
            );
            continue;
        }

        const cueDelay = calculateCuePartDelay(target.timestamp, marker.start);

        if (cueDelay === undefined) {
            warnings.push(
                `Cue Part marker "${marker.displayName || "Part"}" has an invalid timestamp relative to cue "${target.cueName}". It is ignored.`,
            );
            continue;
        }

        const cueParts = target.cue.cueParts ?? [];

        if (cueParts.length >= 255) {
            warnings.push(`Cue "${target.cueName}" already has the maximum 255 additional Cue Parts. Marker "${marker.displayName || "Part"}" is ignored.`);
            continue;
        }

        const partNumber = cueParts.length + 1;
        const cuePart: SequenceCuePart = {
            partNumber,
            name: marker.displayName.trim() || `Part ${partNumber}`,
            sourceTimestamp: marker.start,
            cueDelay,
            ...(marker.cueFade !== undefined ? { cueFade: marker.cueFade } : {}),
            ...(marker.cueTiming?.length ? { cueTiming: marker.cueTiming } : {}),
        };

        target.cue.cueParts = [...cueParts, cuePart];
    }

    return warnings;
}

function resolveCuePartIncompatibility(marker: ConvertedMarker): string | undefined {
    if (marker.bumpAction?.phase === "release" || marker.bumpAction?.releaseDelayMs !== undefined || hasTag(marker, "RELEASE")) {
        return "combines [PART] with bump release metadata";
    }

    if (marker.bpm !== undefined || hasTag(marker, "BPM")) {
        return "combines [PART] with BPM metadata";
    }

    if (marker.regionActions?.length || marker.regionLayerActions?.length) {
        return "combines [PART] with an ON/OFF action";
    }

    return undefined;
}

function hasTag(marker: ConvertedMarker, key: string): boolean {
    return marker.tags.some((tag) => tag.key.trim().toUpperCase() === key);
}

function resolveCuePartTarget(
    marker: ConvertedMarker,
    contentMarkers: ConvertedMarker[],
    uniqueCues: ConvertedMarker[],
    regionSequences: RegionSequence[],
    regionLayerSequences: RegionLayerSequence[],
    repeatedSequences: RepeatedSequence[],
    bumpSequences: BumpSequence[],
    importMode: ImportMode,
): CuePartTarget | undefined {
    if (marker.bumpAction?.phase === "start") {
        return resolveBumpCuePartTarget(marker, contentMarkers, bumpSequences);
    }

    if (importMode === "regions-and-markers" && marker.regionId) {
        if (marker.regionLayerName) {
            const layerSequence = regionLayerSequences.find(
                (sequence) => sequence.regionId === marker.regionId && sequence.layerName === marker.regionLayerName,
            );

            return layerSequence ? resolveSequenceTarget(layerSequence.cues, layerSequence.events, marker.start) : undefined;
        }

        const regionSequence = regionSequences.find((sequence) => sequence.regionId === marker.regionId);
        return regionSequence ? resolveSequenceTarget(regionSequence.cues, regionSequence.events, marker.start) : undefined;
    }

    if (marker.color) {
        const repeatedSequence = repeatedSequences.find((sequence) => sequence.color === marker.color);
        return repeatedSequence ? resolveSequenceTarget(repeatedSequence.cues, repeatedSequence.events, marker.start) : undefined;
    }

    return resolveMainSequenceTarget(uniqueCues, marker.start);
}

function resolveBumpCuePartTarget(
    marker: ConvertedMarker,
    contentMarkers: ConvertedMarker[],
    bumpSequences: BumpSequence[],
): CuePartTarget | undefined {
    const kind = marker.bumpAction?.kind;
    const effectiveColor = resolveBumpMarkerColor(marker);
    const regionId = marker.isGlobal ? undefined : marker.regionContextId;
    const previousStart = findLatestMarker(
        contentMarkers.filter(
            (candidate) =>
                candidate.bumpAction?.phase === "start" &&
                candidate.bumpAction.kind === kind &&
                resolveBumpMarkerColor(candidate) === effectiveColor &&
                (candidate.isGlobal ? undefined : candidate.regionContextId) === regionId,
        ),
        marker.start,
    );

    if (!previousStart) {
        return undefined;
    }

    const sequence = bumpSequences.find(
        (candidate) =>
            candidate.color === effectiveColor &&
            candidate.regionId === regionId &&
            candidate.sourceName === previousStart.displayName,
    );

    return sequence ? resolveSequenceTarget(sequence.cues, sequence.events, marker.start) : undefined;
}

function resolveMainSequenceTarget(uniqueCues: ConvertedMarker[], timestamp: string): CuePartTarget | undefined {
    const cue = findLatestMarker(uniqueCues, timestamp);

    return cue
        ? {
              cue,
              timestamp: cue.start,
              cueName: cue.displayName || "Cue",
          }
        : undefined;
}

function resolveSequenceTarget(cues: SequenceCue[], events: SequenceTrigger[], timestamp: string): CuePartTarget | undefined {
    const event = findLatestEvent(events, timestamp);
    const cue = event ? cues.find((candidate) => candidate.cueNumber === event.cueNumber) : undefined;

    return event && cue
        ? {
              cue,
              timestamp: event.timestamp,
              cueName: cue.name,
          }
        : undefined;
}

function findLatestMarker(markers: ConvertedMarker[], timestamp: string): ConvertedMarker | undefined {
    const targetTime = parseTimestamp(timestamp);

    if (targetTime === undefined) {
        return undefined;
    }

    return markers.reduce<ConvertedMarker | undefined>((latest, marker) => {
        const markerTime = parseTimestamp(marker.start);

        if (markerTime === undefined || markerTime > targetTime) {
            return latest;
        }

        if (!latest) {
            return marker;
        }

        const latestTime = parseTimestamp(latest.start) ?? Number.NEGATIVE_INFINITY;
        return markerTime >= latestTime ? marker : latest;
    }, undefined);
}

function findLatestEvent(events: SequenceTrigger[], timestamp: string): SequenceTrigger | undefined {
    const targetTime = parseTimestamp(timestamp);

    if (targetTime === undefined) {
        return undefined;
    }

    return events.reduce<SequenceTrigger | undefined>((latest, event) => {
        const eventTime = parseTimestamp(event.timestamp);

        if (eventTime === undefined || eventTime > targetTime) {
            return latest;
        }

        if (!latest) {
            return event;
        }

        const latestTime = parseTimestamp(latest.timestamp) ?? Number.NEGATIVE_INFINITY;
        return eventTime >= latestTime ? event : latest;
    }, undefined);
}

function calculateCuePartDelay(cueTimestamp: string, partTimestamp: string): string | undefined {
    const cueTime = parseTimestamp(cueTimestamp);
    const partTime = parseTimestamp(partTimestamp);

    if (cueTime === undefined || partTime === undefined || partTime < cueTime) {
        return undefined;
    }

    return Number((partTime - cueTime).toFixed(6)).toString();
}

function parseTimestamp(timestamp: string): number | undefined {
    const parsed = Number.parseFloat(timestamp);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function compareMarkerTimes(left: string, right: string, leftOrder: number, rightOrder: number): number {
    const leftTime = parseTimestamp(left);
    const rightTime = parseTimestamp(right);

    if (leftTime !== undefined && rightTime !== undefined && leftTime !== rightTime) {
        return leftTime - rightTime;
    }

    if (leftTime !== undefined && rightTime === undefined) {
        return -1;
    }

    if (leftTime === undefined && rightTime !== undefined) {
        return 1;
    }

    return leftOrder - rightOrder;
}
