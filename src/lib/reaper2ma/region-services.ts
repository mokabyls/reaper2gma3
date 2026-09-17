import { parseMarkerName, sanitizeMarkerName } from "./marker-parser.js";
import {
    clampRegionEndPreRollMs,
    clampRegionLayerPreRollMs,
    DEFAULT_REGION_END_PRE_ROLL_MS,
    DEFAULT_REGION_LAYER_PRE_ROLL_ENABLED,
    DEFAULT_REGION_LAYER_PRE_ROLL_MS,
} from "./settings.js";
import { createInheritedRegionLayerColor } from "./colors.js";
import type {
    AppearanceReference,
    ConvertedMarker,
    CueTimingTag,
    RegionActionTag,
    RegionLayerActionTag,
    RegionLayerSequence,
    RegionSequence,
    ReaperRegionRow,
} from "./types.js";

const REGION_START_CUE_NAME = "Region Start";
const REGION_END_CUE_NAME = "Region End";
const REGION_LAYER_PRE_ROLL_CUE_NAME = "Layer Pre-Roll";
const REGION_END_CUE_MIN_GAP_MS = 1;
const NUMERIC_TIMESTAMP_PATTERN = /^-?\d+(?:\.\d+)?$/;

export type ParsedRegion = {
    regionId: string;
    regionLabel: string;
    start: string;
    end: string;
    color: string;
    order: number;
    startValue: number;
    endValue: number;
    lengthValue: number;
    bpm?: number;
    bpmText?: string;
};

export function parseRegions(rows: ReaperRegionRow[]): ParsedRegion[] {
    return rows
        .map((row, index) => {
            const startValue = Number.parseFloat(row.Start);
            const endValueFromEnd = Number.parseFloat(row.End);
            const endValueFromLength = Number.parseFloat(row.Start) + Number.parseFloat(row.Length);
            const endValue = Number.isFinite(endValueFromEnd) ? endValueFromEnd : endValueFromLength;

            if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) {
                return undefined;
            }

            const regionName = parseRegionName(row.Name);

            return {
                regionId: `R${index + 1}`,
                regionLabel: regionName.displayName,
                start: row.Start,
                end: Number.isFinite(endValueFromEnd) ? row.End : String(endValue),
                color: row.Color,
                order: index,
                startValue,
                endValue,
                lengthValue: endValue - startValue,
                ...(regionName.bpm !== undefined && regionName.bpmText !== undefined
                    ? {
                          bpm: regionName.bpm,
                          bpmText: regionName.bpmText,
                      }
                    : {}),
            };
        })
        .filter((region): region is ParsedRegion => region !== undefined);
}

function parseRegionName(name: string): {
    displayName: string;
    bpm?: number;
    bpmText?: string;
} {
    const parsedName = parseMarkerName(name);
    const hasBpmTag = parsedName.tags.some((tag) => tag.key.trim().toUpperCase() === "BPM");

    if (!hasBpmTag) {
        return {
            displayName: name.trim(),
        };
    }

    return {
        displayName: parsedName.displayName,
        ...(parsedName.bpm !== undefined && parsedName.bpmText !== undefined
            ? {
                  bpm: parsedName.bpm,
                  bpmText: parsedName.bpmText,
              }
            : {}),
    };
}

export function assignMarkersToRegions(markers: ConvertedMarker[], regions: ParsedRegion[]): ConvertedMarker[] {
    return markers.map((marker) => {
        const explicitRegion = resolveTargetRegion(marker.regionTargetId, regions);
        const containingRegion = resolveContainingRegion(marker.start, regions);
        const region = explicitRegion ?? containingRegion;
        const markerWithRegionContext = assignRegionContext(marker, region);
        const markerWithRegionLayerActions = assignRegionLayerActionTargets(markerWithRegionContext, region);

        if (marker.isGlobal || marker.bumpAction !== undefined || !region) {
            return markerWithRegionLayerActions;
        }

        return {
            ...markerWithRegionLayerActions,
            regionId: region.regionId,
            regionLabel: region.regionLabel,
        };
    });
}

function assignRegionContext(marker: ConvertedMarker, region: ParsedRegion | undefined): ConvertedMarker {
    if (!region) {
        return marker;
    }

    return {
        ...marker,
        regionContextId: region.regionId,
        regionContextLabel: region.regionLabel,
        regionContextColor: region.color,
    };
}

function assignRegionLayerActionTargets(marker: ConvertedMarker, region: ParsedRegion | undefined): ConvertedMarker {
    if (!marker.regionLayerActions?.length) {
        return marker;
    }

    const regionLayerActions = marker.regionLayerActions.map((action) =>
        action.regionId || !region
            ? action
            : {
                  ...action,
                  regionId: region.regionId,
              },
    );

    return {
        ...marker,
        regionLayerActions,
    };
}

function resolveTargetRegion(regionTargetId: string | undefined, regions: ParsedRegion[]): ParsedRegion | undefined {
    if (!regionTargetId) {
        return undefined;
    }

    return regions.find((region) => region.regionId === regionTargetId);
}

export function buildRegionSequences(
    markers: ConvertedMarker[],
    regions: ParsedRegion[],
    sequenceNumber: number,
    resolveAppearance: (color: string) => AppearanceReference | undefined,
    regionEndPreRollMs = DEFAULT_REGION_END_PRE_ROLL_MS,
    regionLayerPreRollEnabled = DEFAULT_REGION_LAYER_PRE_ROLL_ENABLED,
    regionLayerPreRollMs = DEFAULT_REGION_LAYER_PRE_ROLL_MS,
): {
    regionSequences: RegionSequence[];
    regionLayerSequences: RegionLayerSequence[];
    nextSequenceNumber: number;
} {
    const regionSequences: RegionSequence[] = [];
    const regionLayerSequences: RegionLayerSequence[] = [];
    const resolvedRegionEndPreRollMs = clampRegionEndPreRollMs(regionEndPreRollMs);
    const resolvedRegionLayerPreRollMs = clampRegionLayerPreRollMs(regionLayerPreRollMs);
    let nextSequenceNumber = sequenceNumber + 1;

    regions.forEach((region) => {
        const regionMarkers = markers
            .map((marker, index) => ({ marker, index }))
            .filter(({ marker }) => marker.regionId === region.regionId && !marker.regionLayerName)
            .sort((left, right) => compareMarkerStart(left.marker.start, right.marker.start, left.index, right.index))
            .map(({ marker }) => marker);
        const layerMarkers = markers
            .map((marker, index) => ({ marker, index }))
            .filter(({ marker }) => marker.regionId === region.regionId && marker.regionLayerName)
            .sort((left, right) => compareMarkerStart(left.marker.start, right.marker.start, left.index, right.index))
            .map(({ marker }) => marker);

        const sequenceAppearance = region.color ? resolveAppearance(region.color) : undefined;
        const cuePlan = createRegionCuePlan(region, regionMarkers, resolveAppearance, resolvedRegionEndPreRollMs);
        const cues: RegionSequence["cues"] = cuePlan.map((cue) => ({
            cueNumber: cue.cueNumber,
            name: cue.name,
            ...(cue.appearanceReference
                ? {
                      appearanceName: cue.appearanceReference.appearanceName,
                      appearanceNumber: cue.appearanceReference.appearanceNumber,
                      appearanceColor: cue.appearanceReference.appearanceColor,
                  }
                : {}),
            ...(cue.cueFade !== undefined
                ? {
                      cueFade: cue.cueFade,
                  }
                : {}),
            ...(cue.cueTiming !== undefined
                ? {
                      cueTiming: cue.cueTiming,
                  }
                : {}),
        }));

        const events: RegionSequence["events"] = cuePlan.map((cue) => ({
            timestamp: cue.timestamp,
            execToken: cue.execToken,
            cueNumber: cue.cueNumber,
            cueName: cue.name,
            ...(cue.regionActions?.length
                ? {
                      regionActions: cue.regionActions,
                  }
                : {}),
            ...(cue.regionLayerActions?.length
                ? {
                      regionLayerActions: cue.regionLayerActions,
                  }
                : {}),
            ...(cue.cueFade !== undefined
                ? {
                      cueFade: cue.cueFade,
                  }
                : {}),
            ...(cue.cueTiming !== undefined
                ? {
                      cueTiming: cue.cueTiming,
                  }
                : {}),
        }));

        regionSequences.push({
            regionId: region.regionId,
            displayName: createRegionSequenceDisplayName(region),
            regionLabel: region.regionLabel,
            start: region.start,
            end: region.end,
            color: region.color,
            cues,
            events,
            ...(sequenceAppearance
                ? {
                      appearanceName: sequenceAppearance.appearanceName,
                      appearanceNumber: sequenceAppearance.appearanceNumber,
                      appearanceColor: sequenceAppearance.appearanceColor,
                  }
                : {}),
            sequenceNumber: nextSequenceNumber++,
        });

        regionLayerSequences.push(
            ...buildRegionLayerSequences(
                region,
                layerMarkers,
                nextSequenceNumber,
                resolveAppearance,
                regionLayerPreRollEnabled,
                resolvedRegionLayerPreRollMs,
            ).map((sequence) => {
                nextSequenceNumber = sequence.sequenceNumber + 1;
                return sequence;
            }),
        );
    });

    return {
        regionSequences,
        regionLayerSequences,
        nextSequenceNumber: nextSequenceNumber - 1,
    };
}

function createRegionSequenceDisplayName(region: ParsedRegion): string {
    const regionLabel = sanitizeMarkerName(region.regionLabel).trim();

    return regionLabel ? `${region.regionId} - ${regionLabel}` : region.regionId;
}

function buildRegionLayerSequences(
    region: ParsedRegion,
    markers: ConvertedMarker[],
    sequenceNumber: number,
    resolveAppearance: (color: string) => AppearanceReference | undefined,
    regionLayerPreRollEnabled: boolean,
    regionLayerPreRollMs: number,
): RegionLayerSequence[] {
    const layerGroups = new Map<string, ConvertedMarker[]>();
    let nextSequenceNumber = sequenceNumber;

    for (const marker of markers) {
        const layerName = marker.regionLayerName;

        if (!layerName) {
            continue;
        }

        layerGroups.set(layerName, [...(layerGroups.get(layerName) ?? []), marker]);
    }

    return [...layerGroups.entries()].map(([layerName, layerMarkers]) => {
        const inheritedLayerColor = createInheritedRegionLayerColor(region.color);
        const firstMarkerColor = layerMarkers.find((marker) => marker.color)?.color;
        const sequenceColor = firstMarkerColor ?? inheritedLayerColor ?? "";
        const sequenceAppearanceReference = sequenceColor ? resolveAppearance(sequenceColor) : undefined;
        const inheritedAppearanceReference = inheritedLayerColor ? resolveAppearance(inheritedLayerColor) : undefined;
        const cuePlan = createRegionLayerCuePlan(
            region,
            layerMarkers,
            resolveAppearance,
            regionLayerPreRollEnabled,
            regionLayerPreRollMs,
            inheritedAppearanceReference,
            sequenceAppearanceReference,
        );

        return {
            regionId: region.regionId,
            regionLabel: region.regionLabel,
            layerName,
            displayName: createRegionLayerSequenceDisplayName(region, layerName),
            start: region.start,
            end: region.end,
            color: sequenceColor,
            cues: cuePlan.map((cue) => ({
                cueNumber: cue.cueNumber,
                name: cue.name,
                ...(cue.appearanceReference
                    ? {
                          appearanceName: cue.appearanceReference.appearanceName,
                          appearanceNumber: cue.appearanceReference.appearanceNumber,
                          appearanceColor: cue.appearanceReference.appearanceColor,
                      }
                    : {}),
                ...(cue.cueFade !== undefined ? { cueFade: cue.cueFade } : {}),
                ...(cue.cueTiming !== undefined ? { cueTiming: cue.cueTiming } : {}),
            })),
            events: cuePlan.map((cue) => ({
                timestamp: cue.timestamp,
                execToken: cue.execToken,
                cueNumber: cue.cueNumber,
                cueName: cue.name,
                ...(cue.regionActions?.length ? { regionActions: cue.regionActions } : {}),
                ...(cue.regionLayerActions?.length ? { regionLayerActions: cue.regionLayerActions } : {}),
                ...(cue.cueFade !== undefined ? { cueFade: cue.cueFade } : {}),
                ...(cue.cueTiming !== undefined ? { cueTiming: cue.cueTiming } : {}),
            })),
            ...(sequenceAppearanceReference
                ? {
                      appearanceName: sequenceAppearanceReference.appearanceName,
                      appearanceNumber: sequenceAppearanceReference.appearanceNumber,
                      appearanceColor: sequenceAppearanceReference.appearanceColor,
                  }
                : {}),
            sequenceNumber: nextSequenceNumber++,
        };
    });
}

function createRegionLayerSequenceDisplayName(region: ParsedRegion, layerName: string): string {
    return `${createRegionSequenceDisplayName(region)} - ${layerName}`;
}

type RegionCuePlanSource =
    | {
          kind: "boundary";
          timestamp: string;
          eventTimestamp: string;
          displayName: string;
          sortPriority: number;
          sourceOrder: number;
      }
    | {
          kind: "marker";
          marker: ConvertedMarker;
          timestamp: string;
          sortPriority: number;
          sourceOrder: number;
          boundaryLabels?: string[];
          boundaryEventTimestamp?: string;
      };

type RegionCuePlanEntry = {
    timestamp: string;
    execToken: string;
    cueNumber: number;
    name: string;
    appearanceReference?: AppearanceReference;
    regionActions?: RegionActionTag[];
    regionLayerActions?: RegionLayerActionTag[];
    cueFade?: string;
    cueTiming?: CueTimingTag[];
};

type RegionLayerCuePlanEntry = RegionCuePlanEntry & {
    appearanceReference?: AppearanceReference;
};

function createRegionLayerCuePlan(
    region: ParsedRegion,
    markers: ConvertedMarker[],
    resolveAppearance: (color: string) => AppearanceReference | undefined,
    regionLayerPreRollEnabled: boolean,
    regionLayerPreRollMs: number,
    inheritedAppearanceReference: AppearanceReference | undefined,
    preRollAppearanceReference: AppearanceReference | undefined,
): RegionLayerCuePlanEntry[] {
    const seenNames = new Map<string, number>();

    const markerCuePlan = markers.map((marker, index) => {
        const cueNumber = index + (regionLayerPreRollEnabled ? 2 : 1);
        const sanitizedName = sanitizeMarkerName(marker.displayName).trim();
        const baseName = sanitizedName || `Cue ${cueNumber}`;
        const count = (seenNames.get(baseName) ?? 0) + 1;
        const appearanceReference = marker.color ? resolveAppearance(marker.color) : inheritedAppearanceReference;

        seenNames.set(baseName, count);

        return {
            timestamp: marker.start,
            execToken: marker.execToken,
            cueNumber,
            name: count === 1 ? baseName : `${baseName} ${count}`,
            ...(appearanceReference ? { appearanceReference } : {}),
            ...(marker.regionActions?.length ? { regionActions: marker.regionActions } : {}),
            ...(marker.regionLayerActions?.length ? { regionLayerActions: marker.regionLayerActions } : {}),
            ...(marker.cueFade !== undefined ? { cueFade: marker.cueFade } : {}),
            ...(marker.cueTiming !== undefined ? { cueTiming: marker.cueTiming } : {}),
        };
    });

    if (!regionLayerPreRollEnabled) {
        return markerCuePlan;
    }

    return [
        {
            timestamp: createRegionLayerPreRollTimestamp(region, markers, regionLayerPreRollMs),
            execToken: "Go+",
            cueNumber: 1,
            name: REGION_LAYER_PRE_ROLL_CUE_NAME,
            ...(preRollAppearanceReference ? { appearanceReference: preRollAppearanceReference } : {}),
        },
        ...markerCuePlan,
    ];
}

function createRegionCuePlan(
    region: ParsedRegion,
    markers: ConvertedMarker[],
    resolveAppearance: (color: string) => AppearanceReference | undefined,
    regionEndPreRollMs: number,
): RegionCuePlanEntry[] {
    const seenNames = new Map<string, number>();
    const markerSources: RegionCuePlanSource[] = markers.map((marker, index) => ({
        kind: "marker" as const,
        marker,
        timestamp: marker.start,
        sortPriority: 1,
        sourceOrder: index,
    }));
    const boundarySources: RegionCuePlanSource[] = [
        {
            kind: "boundary" as const,
            timestamp: region.start,
            eventTimestamp: region.start,
            displayName: REGION_START_CUE_NAME,
            sortPriority: 0,
            sourceOrder: -1,
        },
        {
            kind: "boundary" as const,
            timestamp: region.end,
            eventTimestamp: createRegionEndCueTimestamp(region, regionEndPreRollMs),
            displayName: REGION_END_CUE_NAME,
            sortPriority: 2,
            sourceOrder: markers.length,
        },
    ];
    const sources = mergeBoundarySourcesIntoMatchingMarkers(boundarySources, markerSources).sort(compareRegionCuePlanSources);

    return sources.map((source, index) => {
        const cueNumber = index + 1;
        const baseName = resolveRegionCueBaseName(source, cueNumber);
        const count = (seenNames.get(baseName) ?? 0) + 1;
        seenNames.set(baseName, count);
        const cueName = count === 1 ? baseName : `${baseName} ${count}`;

        if (source.kind === "boundary") {
            return {
                timestamp: source.eventTimestamp,
                execToken: "Go+",
                cueNumber,
                name: cueName,
            };
        }

        const appearanceReference = source.marker.color ? resolveAppearance(source.marker.color) : undefined;

        return {
            timestamp: source.boundaryEventTimestamp ?? source.marker.start,
            execToken: source.marker.execToken,
            cueNumber,
            name: cueName,
            ...(appearanceReference ? { appearanceReference } : {}),
            ...(source.marker.regionActions?.length
                ? {
                      regionActions: source.marker.regionActions,
                  }
                : {}),
            ...(source.marker.regionLayerActions?.length
                ? {
                      regionLayerActions: source.marker.regionLayerActions,
                  }
                : {}),
            ...(source.marker.cueFade !== undefined
                ? {
                      cueFade: source.marker.cueFade,
                  }
                : {}),
            ...(source.marker.cueTiming !== undefined
                ? {
                      cueTiming: source.marker.cueTiming,
                  }
                : {}),
        };
    });
}

function resolveRegionCueBaseName(source: RegionCuePlanSource, cueNumber: number): string {
    if (source.kind === "boundary") {
        return source.displayName;
    }

    const sanitizedName = sanitizeMarkerName(source.marker.displayName).trim();
    const markerName = sanitizedName || `Cue ${cueNumber}`;

    if (source.boundaryLabels?.length) {
        return [...source.boundaryLabels, markerName].join(" + ");
    }

    return markerName;
}

function mergeBoundarySourcesIntoMatchingMarkers(
    boundarySources: RegionCuePlanSource[],
    markerSources: RegionCuePlanSource[],
): RegionCuePlanSource[] {
    const remainingBoundarySources: RegionCuePlanSource[] = [];

    for (const boundarySource of boundarySources) {
        if (boundarySource.kind !== "boundary") {
            continue;
        }

        const mergeTarget = findBoundaryMergeTarget(boundarySource, markerSources);

        if (!mergeTarget || mergeTarget.kind !== "marker") {
            remainingBoundarySources.push(boundarySource);
            continue;
        }

        mergeTarget.boundaryLabels = [...(mergeTarget.boundaryLabels ?? []), boundarySource.displayName];

        mergeTarget.boundaryEventTimestamp = boundarySource.eventTimestamp;

        mergeTarget.sortPriority = boundarySource.sortPriority;
    }

    return [...remainingBoundarySources, ...markerSources];
}

export function createRegionPreRollTimestamp(regionStart: string, regionEnd: string, preRollMs: number): string {
    const endValue = parseNumericTimestamp(regionEnd);
    const startValue = parseNumericTimestamp(regionStart);

    if (endValue === undefined || (startValue !== undefined && endValue <= startValue)) {
        return regionEnd;
    }

    const numericPreRollMs = Number(preRollMs);
    const leadSeconds = (Number.isFinite(numericPreRollMs) ? Math.max(0, Math.trunc(numericPreRollMs)) : 0) / 1000;
    const minGapSeconds = REGION_END_CUE_MIN_GAP_MS / 1000;
    let eventTimestamp = endValue - leadSeconds;

    if (startValue !== undefined && eventTimestamp <= startValue && endValue - startValue > minGapSeconds) {
        eventTimestamp = endValue - minGapSeconds;
    }

    if (startValue !== undefined && eventTimestamp < startValue && endValue > startValue) {
        eventTimestamp = startValue;
    }

    return formatDerivedTimestamp(eventTimestamp);
}

function createRegionLayerPreRollTimestamp(region: ParsedRegion, markers: ConvertedMarker[], preRollMs: number): string {
    const candidateStarts = [
        parseNumericTimestamp(region.start),
        ...markers.map((marker) => parseNumericTimestamp(marker.start)),
    ].filter((value): value is number => value !== undefined);

    if (candidateStarts.length === 0) {
        return region.start;
    }

    const earliestStart = Math.min(...candidateStarts);
    const leadSeconds = clampRegionLayerPreRollMs(preRollMs) / 1000;

    return formatDerivedTimestamp(Math.max(0, earliestStart - leadSeconds));
}

function createRegionEndCueTimestamp(region: ParsedRegion, regionEndPreRollMs: number): string {
    return createRegionPreRollTimestamp(region.start, region.end, clampRegionEndPreRollMs(regionEndPreRollMs));
}

function parseNumericTimestamp(timestamp: string): number | undefined {
    const trimmedTimestamp = timestamp.trim();

    if (!NUMERIC_TIMESTAMP_PATTERN.test(trimmedTimestamp)) {
        return undefined;
    }

    const parsedTimestamp = Number.parseFloat(trimmedTimestamp);

    return Number.isFinite(parsedTimestamp) ? parsedTimestamp : undefined;
}

function formatDerivedTimestamp(timestamp: number): string {
    return timestamp.toFixed(3);
}

function findBoundaryMergeTarget(boundarySource: RegionCuePlanSource, markerSources: RegionCuePlanSource[]): RegionCuePlanSource | undefined {
    if (boundarySource.kind !== "boundary") {
        return undefined;
    }

    const matchingMarkerSources = markerSources.filter((source) => source.kind === "marker" && areTimestampsEqual(source.timestamp, boundarySource.timestamp));

    if (matchingMarkerSources.length === 0) {
        return boundarySource.displayName === REGION_END_CUE_NAME ? findRegionEndWindowMergeTarget(boundarySource, markerSources) : undefined;
    }

    return boundarySource.displayName === REGION_END_CUE_NAME ? matchingMarkerSources.at(-1) : matchingMarkerSources[0];
}

function findRegionEndWindowMergeTarget(boundarySource: RegionCuePlanSource, markerSources: RegionCuePlanSource[]): RegionCuePlanSource | undefined {
    if (boundarySource.kind !== "boundary") {
        return undefined;
    }

    const endTimestamp = parseNumericTimestamp(boundarySource.timestamp);
    const shiftedEndTimestamp = parseNumericTimestamp(boundarySource.eventTimestamp);

    if (endTimestamp === undefined || shiftedEndTimestamp === undefined) {
        return undefined;
    }

    return markerSources
        .filter((source) => {
            if (source.kind !== "marker") {
                return false;
            }

            const markerTimestamp = parseNumericTimestamp(source.timestamp);

            return markerTimestamp !== undefined && markerTimestamp >= shiftedEndTimestamp && markerTimestamp < endTimestamp;
        })
        .at(-1);
}

function areTimestampsEqual(left: string, right: string): boolean {
    const leftTime = Number.parseFloat(left);
    const rightTime = Number.parseFloat(right);

    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
        return leftTime === rightTime;
    }

    return left === right;
}

function compareRegionCuePlanSources(left: RegionCuePlanSource, right: RegionCuePlanSource): number {
    const leftTime = Number.parseFloat(left.timestamp);
    const rightTime = Number.parseFloat(right.timestamp);

    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
        if (leftTime !== rightTime) {
            return leftTime - rightTime;
        }
    } else if (left.timestamp !== right.timestamp) {
        return left.timestamp.localeCompare(right.timestamp);
    }

    if (left.sortPriority !== right.sortPriority) {
        return left.sortPriority - right.sortPriority;
    }

    return left.sourceOrder - right.sourceOrder;
}

function resolveContainingRegion(start: string, regions: ParsedRegion[]): ParsedRegion | undefined {
    const markerStart = Number.parseFloat(start);

    if (!Number.isFinite(markerStart)) {
        return undefined;
    }

    return regions
        .filter((region) => markerStart >= region.startValue && markerStart < region.endValue)
        .sort((left, right) => {
            if (left.lengthValue !== right.lengthValue) {
                return left.lengthValue - right.lengthValue;
            }

            return left.order - right.order;
        })[0];
}

function compareMarkerStart(leftStart: string, rightStart: string, leftIndex: number, rightIndex: number): number {
    const leftValue = Number.parseFloat(leftStart);
    const rightValue = Number.parseFloat(rightStart);

    if (leftValue !== rightValue) {
        return leftValue - rightValue;
    }

    return leftIndex - rightIndex;
}
