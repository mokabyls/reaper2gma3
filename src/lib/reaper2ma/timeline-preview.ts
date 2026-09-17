import { convertReaperColorToCssColor } from "./colors.js";
import { createUniqueCuePlan } from "./cue-plan.js";
import { applySequenceNamePrefix } from "./sequence-services.js";
import { collectTimecodeTimestamps } from "./timecode-duration.js";
import type { ConversionArtifacts, ConversionSettings, RegionActionTag, RegionLayerActionTag, RegionLayerSequence, RegionSequence, SequenceTrigger } from "./types.js";

export type TimelineTrackKind = "main" | "region" | "layer" | "repeated" | "bump" | "bpm";

export type TimelinePreviewEvent = {
    id: string;
    timestamp: string;
    timeLabel: string;
    positionPercent: number;
    laneLevel: number;
    label: string;
    token: string;
    cueNumber?: number;
    cueName?: string;
    isDerived: boolean;
};

export type TimelinePreviewTrack = {
    id: string;
    trackIndex: number;
    kind: TimelineTrackKind;
    kindLabel: string;
    sequenceNumber: number;
    displayName: string;
    color: string;
    laneCount: number;
    /** Region owning this track, when the generated sequence is region-scoped. */
    regionId?: string;
    events: TimelinePreviewEvent[];
};

export type TimelinePreviewTick = {
    id: string;
    timeValue: number;
    label: string;
    positionPercent: number;
    isMajor: boolean;
};

export type TimelinePreview = {
    enabled: boolean;
    duration: string;
    durationSeconds: number;
    tracks: TimelinePreviewTrack[];
    ticks: TimelinePreviewTick[];
    eventCount: number;
    emptyMessage?: string;
};

type InternalTimelineEvent = TimelinePreviewEvent & {
    priority: number;
    sourceOrder: number;
    regionActions?: RegionActionTag[];
    regionLayerActions?: RegionLayerActionTag[];
};

type InternalTimelineTrack = Omit<TimelinePreviewTrack, "events"> & {
    events: InternalTimelineEvent[];
    regionId?: string;
    regionLayer?: {
        regionId: string;
        layerName: string;
        start: string;
        end: string;
    };
};

const FALLBACK_DURATION_SECONDS = 1;
const REGION_AUTO_OFF_AFTER_NEXT_START_SECONDS = 1;

const FALLBACK_TRACK_COLORS: Record<TimelineTrackKind, string> = {
    main: "#00d45a",
    region: "#20c7d8",
    layer: "#ff7ab6",
    repeated: "#f5d000",
    bump: "#f59e0b",
    bpm: "#b78cff",
};

const KIND_LABELS: Record<TimelineTrackKind, string> = {
    main: "Main",
    region: "Region",
    layer: "Layer",
    repeated: "Repeat",
    bump: "Bump",
    bpm: "BPM",
};

export function createTimelinePreview(artifacts: ConversionArtifacts, settings: ConversionSettings): TimelinePreview {
    if (settings.exportMode === "cues-only") {
        return createEmptyTimelinePreview("Cues only mode does not create grandMA3 timecode tracks.");
    }

    const tracks = createTimelineTracks(artifacts, settings);
    const timestamps = [
        ...collectTimecodeTimestamps(
            artifacts.uniqueCues,
            artifacts.regionSequences,
            artifacts.regionLayerSequences,
            artifacts.repeatedSequences,
            artifacts.bumpSequences,
            artifacts.bpmSequence,
        ),
        ...tracks.flatMap((track) => track.events.map((event) => event.timestamp)),
    ];
    const durationSeconds = calculatePreviewDurationSeconds(timestamps);
    const ticks = createTimelineTicks(durationSeconds);

    for (const track of tracks) {
        track.events.sort(compareTimelineEvents);

        track.events = track.events.map((event, index) => ({
            ...event,
            id: `${track.id}-event-${index + 1}`,
            positionPercent: calculateTimelinePosition(event.timestamp, durationSeconds),
        }));
        track.events = assignTimelineEventLanes(track.events);
        track.laneCount = Math.max(1, ...track.events.map((event) => event.laneLevel + 1));
    }

    return {
        enabled: true,
        duration: durationSeconds.toFixed(3),
        durationSeconds,
        tracks: tracks.map(({ regionId, regionLayer, ...track }) => ({
            ...track,
            ...((regionId ?? regionLayer?.regionId) ? { regionId: regionId ?? regionLayer?.regionId } : {}),
            events: track.events.map(({ priority, sourceOrder, regionActions, regionLayerActions, ...event }) => event),
        })),
        ticks,
        eventCount: tracks.reduce((total, track) => total + track.events.length, 0),
        ...(tracks.length === 0 ? { emptyMessage: "No timecode tracks will be generated from this CSV." } : {}),
    };
}

function createTimelineTracks(artifacts: ConversionArtifacts, settings: ConversionSettings): InternalTimelineTrack[] {
    const tracks: InternalTimelineTrack[] = [];
    const regionTracksById = new Map<string, InternalTimelineTrack>();
    const layerTracksByKey = new Map<string, InternalTimelineTrack>();
    const layerTracksByRegionId = new Map<string, InternalTimelineTrack[]>();
    const layerSequencesByRegionId = new Map<string, RegionLayerSequence[]>();
    const regionAutoOffTimestampsById = createRegionAutoOffTimestampsById(artifacts.regionSequences);
    const regionStartCueNumbersById = new Map(
        artifacts.regionSequences.map((sequence) => [sequence.regionId, resolveRegionStartCueNumber(sequence)]),
    );
    const manuallyOffedRegionIds = new Set<string>();
    const manuallyOffedRegionLayerKeys = new Set<string>();

    for (const sequence of artifacts.regionSequences) {
        layerSequencesByRegionId.set(
            sequence.regionId,
            artifacts.regionLayerSequences.filter((layerSequence) => layerSequence.regionId === sequence.regionId),
        );
    }
    let sourceOrder = 0;

    const addTrack = (track: Omit<InternalTimelineTrack, "id" | "trackIndex" | "kindLabel" | "laneCount" | "events">): InternalTimelineTrack => {
        const trackIndex = tracks.length + 1;
        const createdTrack: InternalTimelineTrack = {
            id: `${track.kind}-${track.sequenceNumber}-${trackIndex}`,
            trackIndex,
            kindLabel: KIND_LABELS[track.kind],
            events: [],
            laneCount: 1,
            ...track,
        };

        tracks.push(createdTrack);

        if (createdTrack.regionLayer) {
            const layerKey = createRegionLayerKey(createdTrack.regionLayer.regionId, createdTrack.regionLayer.layerName);
            layerTracksByKey.set(layerKey, createdTrack);
            layerTracksByRegionId.set(createdTrack.regionLayer.regionId, [
                ...(layerTracksByRegionId.get(createdTrack.regionLayer.regionId) ?? []),
                createdTrack,
            ]);
        } else if (createdTrack.regionId) {
            regionTracksById.set(createdTrack.regionId, createdTrack);
        }

        return createdTrack;
    };

    if (artifacts.uniqueCues.length > 0) {
        const track = addTrack({
            kind: "main",
            sequenceNumber: settings.sequenceNumber,
            displayName: applySequenceNamePrefix(`Sequence ${settings.sequenceNumber}`, settings.sequenceNamePrefix),
            color: FALLBACK_TRACK_COLORS.main,
        });
        const cuePlan = createUniqueCuePlan(artifacts.uniqueCues);

        cuePlan.forEach((cue, index) => {
            addSequenceTriggerEvent(
                track,
                {
                    timestamp: cue.start,
                    execToken: cue.execToken,
                    cueNumber: settings.cueStartNumber + index,
                    cueName: cue.cueName,
                    ...(cue.regionActions?.length ? { regionActions: cue.regionActions } : {}),
                    ...(cue.regionLayerActions?.length ? { regionLayerActions: cue.regionLayerActions } : {}),
                },
                false,
                1,
                sourceOrder++,
            );
        });
    }

    for (const sequence of artifacts.regionSequences) {
        const track = addTrack({
            kind: "region",
            sequenceNumber: sequence.sequenceNumber,
            displayName: sequence.displayName,
            color: resolveTrackColor("region", sequence.color),
            regionId: sequence.regionId,
        });

        for (const event of sequence.events) {
            addSequenceTriggerEvent(track, event, false, 1, sourceOrder++);
        }

        for (const layerSequence of layerSequencesByRegionId.get(sequence.regionId) ?? []) {
            const layerTrack = addTrack({
                kind: "layer",
                sequenceNumber: layerSequence.sequenceNumber,
                displayName: layerSequence.displayName,
                color: resolveTrackColor("layer", layerSequence.color),
                regionLayer: {
                    regionId: layerSequence.regionId,
                    layerName: layerSequence.layerName,
                    start: layerSequence.start,
                    end: layerSequence.end,
                },
            });

            for (const event of layerSequence.events) {
                addSequenceTriggerEvent(layerTrack, event, false, 1, sourceOrder++);
            }
        }
    }

    for (const sequence of artifacts.repeatedSequences) {
        const track = addTrack({
            kind: "repeated",
            sequenceNumber: sequence.sequenceNumber,
            displayName: sequence.displayName,
            color: resolveTrackColor("repeated", sequence.color),
        });

        for (const event of sequence.events) {
            addSequenceTriggerEvent(track, event, false, 1, sourceOrder++);
        }
    }

    for (const sequence of artifacts.bumpSequences) {
        const track = addTrack({
            kind: "bump",
            sequenceNumber: sequence.sequenceNumber,
            displayName: sequence.displayName,
            color: resolveTrackColor("bump", sequence.color),
        });

        for (const event of sequence.events) {
            addSequenceTriggerEvent(track, event, false, 1, sourceOrder++);
        }
    }

    if (artifacts.bpmSequence) {
        const track = addTrack({
            kind: "bpm",
            sequenceNumber: artifacts.bpmSequence.sequenceNumber,
            displayName: artifacts.bpmSequence.displayName,
            color: FALLBACK_TRACK_COLORS.bpm,
        });

        artifacts.bpmSequence.events.forEach((event, index) => {
            const cueNumber = index + 1;
            const cueName = `BPM ${event.bpmText}`;

            addTimelineEvent(track, {
                timestamp: event.timestamp,
                token: "Go+",
                cueNumber,
                cueName,
                label: cueName,
                isDerived: false,
                priority: 1,
                sourceOrder: sourceOrder++,
            });
        });
    }

    const sourceEvents = tracks.flatMap((track) => [...track.events]);

    for (const event of sourceEvents) {
        for (const action of sortRegionActions(event.regionActions ?? [])) {
            const targetTrack = regionTracksById.get(action.regionId);

            if (!targetTrack) {
                continue;
            }

            const token = action.kind === "ON" ? "Go+" : "Off";

            if (action.kind === "OFF") {
                manuallyOffedRegionIds.add(action.regionId);
            }

            addTimelineEvent(targetTrack, {
                timestamp: event.timestamp,
                token,
                ...(action.kind === "ON"
                    ? { cueNumber: regionStartCueNumbersById.get(action.regionId) ?? 1, cueName: "Region Start" }
                    : {}),
                label: `${action.kind} ${action.regionId}`,
                isDerived: true,
                priority: action.kind === "OFF" ? 0 : 2,
                sourceOrder: sourceOrder++,
            });
        }

        for (const action of event.regionLayerActions ?? []) {
            const targetTracks = resolveRegionLayerActionTracks(action, layerTracksByKey, layerTracksByRegionId);

            for (const targetTrack of targetTracks) {
                if (targetTrack.regionLayer) {
                    manuallyOffedRegionLayerKeys.add(createRegionLayerKey(targetTrack.regionLayer.regionId, targetTrack.regionLayer.layerName));
                }

                addTimelineEvent(targetTrack, {
                    timestamp: event.timestamp,
                    token: "Off",
                    label: `Off Layer ${targetTrack.regionLayer?.layerName ?? ""}`.trim(),
                    isDerived: true,
                    priority: 0,
                    sourceOrder: sourceOrder++,
                });
            }
        }
    }

    for (const track of tracks) {
        if (!track.regionId) {
            continue;
        }

        if (manuallyOffedRegionIds.has(track.regionId)) {
            continue;
        }

        const autoOffTimestamp = regionAutoOffTimestampsById.get(track.regionId);

        if (!autoOffTimestamp) {
            continue;
        }

        addTimelineEvent(track, {
            timestamp: autoOffTimestamp,
            token: "Off",
            label: `Auto Off ${track.displayName}`,
            isDerived: true,
            priority: 3,
            sourceOrder: sourceOrder++,
        });
    }

    if (settings.autoOffRegionLayers !== false) {
        for (const track of tracks) {
            if (!track.regionLayer) {
                continue;
            }

            const regionLayerKey = createRegionLayerKey(track.regionLayer.regionId, track.regionLayer.layerName);

            if (manuallyOffedRegionLayerKeys.has(regionLayerKey)) {
                continue;
            }

            addTimelineEvent(track, {
                timestamp: regionAutoOffTimestampsById.get(track.regionLayer.regionId) ?? track.regionLayer.end,
                token: "Off",
                label: `Auto Off ${track.regionLayer.layerName}`,
                isDerived: true,
                priority: 3,
                sourceOrder: sourceOrder++,
            });
        }
    }

    return tracks;
}

function addSequenceTriggerEvent(
    track: InternalTimelineTrack,
    event: SequenceTrigger,
    isDerived: boolean,
    priority: number,
    sourceOrder: number,
): void {
    addTimelineEvent(track, {
        timestamp: event.timestamp,
        token: event.execToken,
        cueNumber: event.cueNumber,
        cueName: event.cueName,
        label: event.cueName,
        isDerived,
        priority,
        sourceOrder,
        ...(event.regionActions?.length ? { regionActions: event.regionActions } : {}),
        ...(event.regionLayerActions?.length ? { regionLayerActions: event.regionLayerActions } : {}),
    });
}

function addTimelineEvent(
    track: InternalTimelineTrack,
    event: {
        timestamp: string;
        token: string;
        label: string;
        isDerived: boolean;
        priority: number;
        sourceOrder: number;
        cueNumber?: number;
        cueName?: string;
        regionActions?: RegionActionTag[];
        regionLayerActions?: RegionLayerActionTag[];
    },
): void {
    track.events.push({
        id: "",
        timestamp: event.timestamp,
        timeLabel: formatTimelineTime(event.timestamp),
        positionPercent: 0,
        laneLevel: 0,
        label: event.label,
        token: event.token,
        isDerived: event.isDerived,
        priority: event.priority,
        sourceOrder: event.sourceOrder,
        ...(event.cueNumber !== undefined ? { cueNumber: event.cueNumber } : {}),
        ...(event.cueName !== undefined ? { cueName: event.cueName } : {}),
        ...(event.regionActions?.length ? { regionActions: event.regionActions } : {}),
        ...(event.regionLayerActions?.length ? { regionLayerActions: event.regionLayerActions } : {}),
    });
}

function createEmptyTimelinePreview(emptyMessage: string): TimelinePreview {
    return {
        enabled: false,
        duration: "0.000",
        durationSeconds: 0,
        tracks: [],
        ticks: [],
        eventCount: 0,
        emptyMessage,
    };
}

function resolveTrackColor(kind: TimelineTrackKind, color: string): string {
    return convertReaperColorToCssColor(color) ?? FALLBACK_TRACK_COLORS[kind];
}

function calculatePreviewDurationSeconds(timestamps: string[]): number {
    if (timestamps.length === 0) {
        return 0;
    }

    const maxTimestamp = timestamps.reduce((max, timestamp) => {
        const parsed = Number.parseFloat(timestamp);
        return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
    }, 0);

    return maxTimestamp + FALLBACK_DURATION_SECONDS;
}

function calculateTimelinePosition(timestamp: string, durationSeconds: number): number {
    const parsedTimestamp = Number.parseFloat(timestamp);

    if (!Number.isFinite(parsedTimestamp) || durationSeconds <= 0) {
        return 0;
    }

    return clamp((parsedTimestamp / durationSeconds) * 100, 0, 100);
}

function createTimelineTicks(durationSeconds: number): TimelinePreviewTick[] {
    if (durationSeconds <= 0) {
        return [];
    }

    const step = resolveTickStep(durationSeconds);
    const ticks: TimelinePreviewTick[] = [];

    for (let value = 0; value <= durationSeconds + step / 10; value += step) {
        const tickValue = Math.min(value, durationSeconds);
        const existingTick = ticks.find((tick) => Math.abs(tick.timeValue - tickValue) < 0.001);

        if (!existingTick) {
            ticks.push({
                id: `tick-${ticks.length + 1}`,
                timeValue: tickValue,
                label: formatTimelineTime(tickValue.toFixed(3)),
                positionPercent: calculateTimelinePosition(String(tickValue), durationSeconds),
                isMajor: ticks.length === 0 || Math.abs(tickValue - durationSeconds) < 0.001,
            });
        }

        if (tickValue === durationSeconds) {
            break;
        }
    }

    const lastTick = ticks[ticks.length - 1];

    if (!lastTick || Math.abs(lastTick.timeValue - durationSeconds) > 0.001) {
        ticks.push({
            id: `tick-${ticks.length + 1}`,
            timeValue: durationSeconds,
            label: formatTimelineTime(durationSeconds.toFixed(3)),
            positionPercent: 100,
            isMajor: true,
        });
    }

    return ticks;
}

function resolveTickStep(durationSeconds: number): number {
    const rawStep = durationSeconds / 4;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;
    const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;

    return niceNormalized * magnitude;
}

function formatTimelineTime(timestamp: string): string {
    const parsed = Number.parseFloat(timestamp);

    if (!Number.isFinite(parsed)) {
        return timestamp;
    }

    return `${parsed.toFixed(2)}s`;
}

function sortRegionActions(actions: RegionActionTag[]): RegionActionTag[] {
    return [...actions].sort((left, right) => (left.kind === right.kind ? 0 : left.kind === "OFF" ? -1 : 1));
}

function resolveRegionLayerActionTracks(
    action: RegionLayerActionTag,
    layerTracksByKey: Map<string, InternalTimelineTrack>,
    layerTracksByRegionId: Map<string, InternalTimelineTrack[]>,
): InternalTimelineTrack[] {
    if (!action.regionId) {
        return [];
    }

    if (action.scope === "all") {
        return layerTracksByRegionId.get(action.regionId) ?? [];
    }

    const track = layerTracksByKey.get(createRegionLayerKey(action.regionId, action.layerName));

    return track ? [track] : [];
}

function createRegionLayerKey(regionId: string, layerName: string): string {
    return `${regionId}\u0000${layerName}`;
}

function compareTimelineEvents(left: InternalTimelineEvent, right: InternalTimelineEvent): number {
    const leftTime = Number.parseFloat(left.timestamp);
    const rightTime = Number.parseFloat(right.timestamp);

    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
    }

    if (left.priority !== right.priority) {
        return left.priority - right.priority;
    }

    return left.sourceOrder - right.sourceOrder;
}

function createRegionAutoOffTimestampsById(regionSequences: RegionSequence[]): Map<string, string> {
    const sortedRegionSequences = [...regionSequences].sort((left, right) =>
        compareTimestampStrings(left.start, right.start, left.sequenceNumber, right.sequenceNumber),
    );
    const autoOffTimestampsById = new Map<string, string>();

    for (let index = 0; index < sortedRegionSequences.length - 1; index += 1) {
        const sequence = sortedRegionSequences[index];
        const nextSequence = sortedRegionSequences[index + 1];

        autoOffTimestampsById.set(sequence.regionId, addSecondsToTimestamp(nextSequence.start, REGION_AUTO_OFF_AFTER_NEXT_START_SECONDS));
    }

    return autoOffTimestampsById;
}

function resolveRegionStartCueNumber(sequence: RegionSequence): number {
    return sequence.cues.find((cue) => cue.name === "Region Start" || cue.name.startsWith("Region Start + "))?.cueNumber ?? 1;
}

function addSecondsToTimestamp(timestamp: string, seconds: number): string {
    const parsedTimestamp = Number.parseFloat(timestamp);

    if (!Number.isFinite(parsedTimestamp)) {
        return timestamp;
    }

    return (parsedTimestamp + seconds).toFixed(3);
}

function compareTimestampStrings(left: string, right: string, leftFallback: number, rightFallback: number): number {
    const leftTime = Number.parseFloat(left);
    const rightTime = Number.parseFloat(right);

    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
    }

    if (left !== right) {
        return left.localeCompare(right);
    }

    return leftFallback - rightFallback;
}

function assignTimelineEventLanes(events: InternalTimelineEvent[]): InternalTimelineEvent[] {
    const laneLastPositions: number[] = [];
    const minimumGapPercent = 9;

    return events.map((event) => {
        const laneIndex = laneLastPositions.findIndex((lastPosition) => event.positionPercent - lastPosition >= minimumGapPercent);
        const resolvedLaneIndex = laneIndex === -1 ? laneLastPositions.length : laneIndex;

        laneLastPositions[resolvedLaneIndex] = event.positionPercent;

        return {
            ...event,
            laneLevel: resolvedLaneIndex,
        };
    });
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}
