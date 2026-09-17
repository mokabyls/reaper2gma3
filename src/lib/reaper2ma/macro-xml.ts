import { createUniqueCuePlan } from "./cue-plan.js";
import { createExecutorAssignmentPlan, type ExecutorAssignment, type ExecutorSlotGroup } from "./executor-plan.js";
import { createSequenceMoves, resolveSequenceNumber, type SequenceMove } from "./sequence-numbering.js";
import { calculateTimecodeDuration, collectTimecodeTimestamps } from "./timecode-duration.js";
import { formatTimecodeOffsetSeconds, resolveTimecodeOffsetMs } from "./timecode-offset.js";
import { XML_HEADER, xmlBuilder } from "./xml-common.js";
import { applySequenceNamePrefix } from "./sequence-services.js";
import type {
    BpmSequence,
    BumpSequence,
    ConversionSettings,
    ConvertedMarker,
    CueTimingTag,
    RegionLayerSequence,
    RegionSequence,
    RepeatedSequence,
    SequenceCue,
    SequenceTrigger,
} from "./types.js";

type MacroLine = Record<string, string>;
type OffCueBehavior =
    | {
          kind: "none";
      }
    | {
          kind: "follow";
      }
    | {
          kind: "timed";
          releaseDurationSeconds: string;
      };

type GeneratedSequence = {
    localSequenceNumber: number;
    finalSequenceNumber: number;
    effectiveSequenceNumber: number;
    displayName: string;
    cues: SequenceCue[];
    events: SequenceTrigger[];
    offCueBehavior: OffCueBehavior;
    assignToExecutor: boolean;
    executorSlotGroup: ExecutorSlotGroup;
    executorRegionId?: string;
    regionLabel?: string;
    appearanceName?: string;
    appearanceNumber?: number;
    appearanceColor?: string;
    regionId?: string;
    regionStart?: string;
    regionEnd?: string;
    regionLayer?: {
        regionId: string;
        layerName: string;
        start: string;
        end: string;
    };
    timecodeRegionId?: string;
};

type TimecodeMacroEvent = {
    timestamp: string;
    token: string;
    cueNumber?: number;
    priority: number;
    sourceOrder: number;
};

type TimecodeTrackPlacement = {
    sequence: GeneratedSequence;
    groupIndex: number;
    trackIndex: number;
};

type TimecodeTrackGroup = {
    groupIndex: number;
    name: string;
    tracks: TimecodeTrackPlacement[];
};

const DEFAULT_WAIT = "0.10";
const REGION_AUTO_OFF_AFTER_NEXT_START_SECONDS = 1;

function createCommand(command: string, wait = DEFAULT_WAIT): MacroLine {
    return {
        "@_Command": command,
        "@_Wait": wait,
    };
}

function quoteCommandValue(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function createTempDataPoolName(filename: string): string {
    return `R2MA ${filename || "export"}`;
}

function createSpeedMasterCommand(tempDataPoolName: string, sequence: GeneratedSequence, speedMaster: string): MacroLine {
    return createCommand(
        `Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Property "SpeedMaster" #[Master ${speedMaster}]`,
    );
}

function createCueLabelCommands(tempDataPoolName: string, sequence: GeneratedSequence): MacroLine[] {
    return sequence.cues.map((cue) =>
        createCommand(
            `Label DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Cue ${cue.cueNumber} ${quoteCommandValue(cue.name)}`,
        ),
    );
}

function createSequenceLabelCommand(tempDataPoolName: string, sequence: GeneratedSequence): MacroLine {
    return createCommand(
        `Label DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} ${quoteCommandValue(sequence.displayName)}`,
    );
}

function createSequenceAppearanceAssignmentCommands(tempDataPoolName: string, sequence: GeneratedSequence): MacroLine[] {
    if (!sequence.appearanceName) {
        return [];
    }

    return [
        createCommand(
            `Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} APPEARANCE=${quoteCommandValue(sequence.appearanceName)}`,
        ),
    ];
}

function createCueAppearanceAssignmentCommands(tempDataPoolName: string, sequence: GeneratedSequence): MacroLine[] {
    return sequence.cues.flatMap((cue) =>
        cue.appearanceName
            ? [
                  createCommand(
                      `Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Cue ${cue.cueNumber} APPEARANCE=${quoteCommandValue(cue.appearanceName)}`,
                  ),
              ]
            : [],
    );
}

function createCueFadeCommands(tempDataPoolName: string, sequence: GeneratedSequence): MacroLine[] {
    return sequence.cues.flatMap((cue) =>
        cue.cueFade
            ? [
                  createCommand(
                      `Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Cue ${cue.cueNumber} CueFade ${cue.cueFade}`,
                  ),
              ]
            : [],
    );
}

function createCueTimingCommands(tempDataPoolName: string, sequence: GeneratedSequence): MacroLine[] {
    return sequence.cues.flatMap((cue) => {
        if (!cue.cueTiming || cue.cueTiming.length === 0) {
            return [];
        }

        const modifiers = formatCueTimingModifiers(cue.cueTiming);

        return [
            createCommand(
                `Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Cue ${cue.cueNumber} Part 0.1 ${modifiers}`,
            ),
        ];
    });
}

function createStandardRecipeCommand(
    tempDataPoolName: string,
    sequence: GeneratedSequence,
    cueNumber: number,
    partNumber: number,
): MacroLine {
    return createCommand(
        `Store Type "StandardRecipe" DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Cue ${cueNumber} Part ${partNumber}.1`,
    );
}

function createCueAndMainRecipeCommands(tempDataPoolName: string, sequence: GeneratedSequence): MacroLine[] {
    return sequence.cues.flatMap((cue) => [
        createCommand(
            `Store DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Cue ${cue.cueNumber} /Overwrite`,
        ),
        createStandardRecipeCommand(tempDataPoolName, sequence, cue.cueNumber, 0),
    ]);
}

function createCuePartCommands(tempDataPoolName: string, sequence: GeneratedSequence): MacroLine[] {
    return sequence.cues.flatMap((cue) => {
        const cueParts = cue.cueParts ?? [];

        if (cueParts.length === 0) {
            return [];
        }

        return [
            createCommand(
                `Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Cue ${cue.cueNumber} Property "AllowDuplicates" "Yes"`,
            ),
            ...cueParts.flatMap((part) => [
                createStandardRecipeCommand(tempDataPoolName, sequence, cue.cueNumber, part.partNumber),
                createCommand(
                    `Label DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Cue ${cue.cueNumber} Part ${part.partNumber} ${quoteCommandValue(part.name)}`,
                ),
                createCommand(
                    `Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Cue ${cue.cueNumber} Part ${part.partNumber} Property "CueDelay" ${quoteCommandValue(part.cueDelay)}`,
                ),
                ...(part.cueFade !== undefined
                    ? [
                          createCommand(
                              `Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Cue ${cue.cueNumber} Part ${part.partNumber} Property "CueFade" ${quoteCommandValue(part.cueFade)}`,
                          ),
                      ]
                    : []),
                ...(part.cueTiming?.length
                    ? [
                          createCommand(
                              `Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Cue ${cue.cueNumber} Part ${part.partNumber}.1 ${formatCueTimingModifiers(part.cueTiming)}`,
                          ),
                      ]
                    : []),
            ]),
        ];
    });
}

function createCueCommandCommands(tempDataPoolName: string, sequence: GeneratedSequence): MacroLine[] {
    return sequence.cues.flatMap((cue) =>
        (cue.commands ?? []).map((command) =>
            createCommand(
                `Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Cue ${cue.cueNumber} Property "Command" ${quoteCommandValue(command)}`,
            ),
        ),
    );
}

function createOffCueCommands(tempDataPoolName: string, sequence: GeneratedSequence): MacroLine[] {
    if (sequence.offCueBehavior.kind === "none") {
        return [];
    }

    if (sequence.offCueBehavior.kind === "follow") {
        return [
            createCommand(
                `Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Cue "OffCue" Property "TRIGTYPE" "Follow"`,
            ),
        ];
    }

    const releaseDurationSeconds = sequence.offCueBehavior.releaseDurationSeconds;

    return [
        ...sequence.cues.map((cue) =>
            createCommand(
                `Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Cue ${cue.cueNumber} Property "Assert" "Yes"`,
            ),
        ),
        createCommand(
            `Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber}.OffCue Property "TrigType" "Time"`,
        ),
        createCommand(
            `Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber}.OffCue Property "TrigTime" ${quoteCommandValue(releaseDurationSeconds)}`,
        ),
        createCommand(
            `Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber}.OffCue Property "CueFade" ${quoteCommandValue(releaseDurationSeconds)}`,
        ),
        createCommand(`Set DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Property "UseExecutorTime" "No"`),
    ];
}

function formatCueTimingModifiers(cueTiming: CueTimingTag[]): string {
    return cueTiming.map((tag) => `${tag.key} ${quoteCommandValue(tag.value)}`).join(" ");
}

function createSequenceSetupCommands(tempDataPoolName: string, settings: ConversionSettings, sequence: GeneratedSequence): MacroLine[] {
    if (sequence.cues.length === 0) {
        return [];
    }

    return [
        createCommand(`Store DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} ${quoteCommandValue(sequence.displayName)}`),
        createSequenceLabelCommand(tempDataPoolName, sequence),
        ...createCueAndMainRecipeCommands(tempDataPoolName, sequence),
        ...createCuePartCommands(tempDataPoolName, sequence),
        createSpeedMasterCommand(tempDataPoolName, sequence, settings.speedMaster),
        ...createSequenceAppearanceAssignmentCommands(tempDataPoolName, sequence),
        ...createCueLabelCommands(tempDataPoolName, sequence),
        ...createCueAppearanceAssignmentCommands(tempDataPoolName, sequence),
        ...createCueFadeCommands(tempDataPoolName, sequence),
        ...createCueTimingCommands(tempDataPoolName, sequence),
        ...createCueCommandCommands(tempDataPoolName, sequence),
        ...createOffCueCommands(tempDataPoolName, sequence),
        createCommand(`Cook DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} /Overwrite`),
    ];
}

function createGeneratedSequences(
    settings: ConversionSettings,
    uniqueCues: ConvertedMarker[],
    regionSequences: RegionSequence[],
    regionLayerSequences: RegionLayerSequence[],
    repeatedSequences: RepeatedSequence[],
    bumpSequences: BumpSequence[],
    bpmSequence: BpmSequence | undefined,
): GeneratedSequence[] {
    const generatedSequences: GeneratedSequence[] = [];
    const regionLayerSequencesByRegionId = groupRegionLayerSequencesByRegionId(regionLayerSequences);
    const addSequence = (
        sequence: Omit<GeneratedSequence, "localSequenceNumber" | "assignToExecutor" | "executorSlotGroup" | "effectiveSequenceNumber"> & {
            assignToExecutor?: boolean;
            executorSlotGroup?: ExecutorSlotGroup;
        },
    ) => {
        generatedSequences.push({
            localSequenceNumber: generatedSequences.length + 1,
            assignToExecutor: sequence.assignToExecutor ?? true,
            executorSlotGroup: sequence.executorSlotGroup ?? "main",
            effectiveSequenceNumber: resolveSequenceNumber(settings, sequence.finalSequenceNumber),
            ...sequence,
        });
    };

    if (uniqueCues.length > 0) {
        const cuePlan = createUniqueCuePlan(uniqueCues);
        const cues: SequenceCue[] = cuePlan.map((cue, index) => ({
            cueNumber: settings.cueStartNumber + index,
            name: cue.cueName,
            ...(cue.cueFade !== undefined ? { cueFade: cue.cueFade } : {}),
            ...(cue.cueTiming !== undefined ? { cueTiming: cue.cueTiming } : {}),
            ...(cue.cueParts?.length ? { cueParts: cue.cueParts } : {}),
        }));
        const events: SequenceTrigger[] = cuePlan.map((cue, index) => ({
            timestamp: cue.start,
            execToken: cue.execToken,
            cueNumber: settings.cueStartNumber + index,
            cueName: cue.cueName,
            ...(cue.regionActions?.length ? { regionActions: cue.regionActions } : {}),
            ...(cue.regionLayerActions?.length ? { regionLayerActions: cue.regionLayerActions } : {}),
            ...(cue.cueFade !== undefined ? { cueFade: cue.cueFade } : {}),
            ...(cue.cueTiming !== undefined ? { cueTiming: cue.cueTiming } : {}),
        }));

        addSequence({
            finalSequenceNumber: settings.sequenceNumber,
            displayName: applySequenceNamePrefix(`Sequence ${settings.sequenceNumber}`, settings.sequenceNamePrefix),
            cues,
            events,
            offCueBehavior: { kind: "none" },
        });
    }

    for (const sequence of regionSequences) {
        addSequence({
            finalSequenceNumber: sequence.sequenceNumber,
            displayName: sequence.displayName,
            cues: sequence.cues,
            events: sequence.events,
            offCueBehavior: { kind: "follow" },
            ...(sequence.appearanceName ? { appearanceName: sequence.appearanceName } : {}),
            ...(sequence.appearanceNumber !== undefined ? { appearanceNumber: sequence.appearanceNumber } : {}),
            ...(sequence.appearanceColor ? { appearanceColor: sequence.appearanceColor } : {}),
            regionId: sequence.regionId,
            executorRegionId: sequence.regionId,
            regionLabel: sequence.regionLabel,
            regionStart: sequence.start,
            regionEnd: sequence.end,
        });

        for (const layerSequence of regionLayerSequencesByRegionId.get(sequence.regionId) ?? []) {
            addSequence({
                finalSequenceNumber: layerSequence.sequenceNumber,
                displayName: layerSequence.displayName,
                cues: layerSequence.cues,
                events: layerSequence.events,
                offCueBehavior: { kind: "follow" },
                ...(layerSequence.appearanceName ? { appearanceName: layerSequence.appearanceName } : {}),
                ...(layerSequence.appearanceNumber !== undefined ? { appearanceNumber: layerSequence.appearanceNumber } : {}),
                ...(layerSequence.appearanceColor ? { appearanceColor: layerSequence.appearanceColor } : {}),
                regionLayer: {
                    regionId: layerSequence.regionId,
                    layerName: layerSequence.layerName,
                    start: layerSequence.start,
                    end: layerSequence.end,
                },
                executorRegionId: layerSequence.regionId,
                regionLabel: layerSequence.regionLabel,
            });
        }
    }

    for (const sequence of repeatedSequences) {
        addSequence({
            finalSequenceNumber: sequence.sequenceNumber,
            displayName: sequence.displayName,
            cues: sequence.cues,
            events: sequence.events,
            offCueBehavior: { kind: "follow" },
            appearanceName: sequence.appearanceName,
            appearanceNumber: sequence.appearanceNumber,
            appearanceColor: sequence.appearanceColor,
        });
    }

    for (const sequence of bumpSequences) {
        addSequence({
            finalSequenceNumber: sequence.sequenceNumber,
            displayName: sequence.displayName,
            cues: sequence.cues,
            events: sequence.events,
            offCueBehavior: { kind: "timed", releaseDurationSeconds: sequence.releaseDurationSeconds },
            executorSlotGroup: "bump",
            ...(sequence.regionId ? { executorRegionId: sequence.regionId } : {}),
            ...(sequence.regionLabel ? { regionLabel: sequence.regionLabel } : {}),
            ...(sequence.appearanceName ? { appearanceName: sequence.appearanceName } : {}),
            ...(sequence.appearanceNumber !== undefined ? { appearanceNumber: sequence.appearanceNumber } : {}),
            ...(sequence.appearanceColor ? { appearanceColor: sequence.appearanceColor } : {}),
            ...(sequence.regionId ? { timecodeRegionId: sequence.regionId } : {}),
        });
    }

    if (bpmSequence) {
        addSequence({
            finalSequenceNumber: bpmSequence.sequenceNumber,
            displayName: bpmSequence.displayName,
            cues: bpmSequence.events.map((event, index) => ({
                cueNumber: index + 1,
                name: createBpmCueName(event.bpmText),
                commands: [`Master ${settings.speedMaster} At BPM ${event.bpmText}`],
            })),
            events: bpmSequence.events.map((event, index) => {
                const cueNumber = index + 1;
                const cueName = createBpmCueName(event.bpmText);

                return {
                    timestamp: event.timestamp,
                    execToken: "Go+",
                    cueNumber,
                    cueName,
                };
            }),
            offCueBehavior: { kind: "timed", releaseDurationSeconds: bpmSequence.releaseDurationSeconds },
            assignToExecutor: false,
        });
    }

    return generatedSequences;
}

function groupRegionLayerSequencesByRegionId(regionLayerSequences: RegionLayerSequence[]): Map<string, RegionLayerSequence[]> {
    const sequencesByRegionId = new Map<string, RegionLayerSequence[]>();

    for (const sequence of regionLayerSequences) {
        sequencesByRegionId.set(sequence.regionId, [...(sequencesByRegionId.get(sequence.regionId) ?? []), sequence]);
    }

    return sequencesByRegionId;
}

function collectAppearanceSetupCommands(sequences: GeneratedSequence[]): MacroLine[] {
    const appearancesByNumber = new Map<
        number,
        {
            appearanceName: string;
            appearanceColor: string;
        }
    >();

    for (const sequence of sequences) {
        if (sequence.appearanceNumber !== undefined && sequence.appearanceName && sequence.appearanceColor) {
            appearancesByNumber.set(sequence.appearanceNumber, {
                appearanceName: sequence.appearanceName,
                appearanceColor: sequence.appearanceColor,
            });
        }

        for (const cue of sequence.cues) {
            if (cue.appearanceNumber !== undefined && cue.appearanceName && cue.appearanceColor) {
                appearancesByNumber.set(cue.appearanceNumber, {
                    appearanceName: cue.appearanceName,
                    appearanceColor: cue.appearanceColor,
                });
            }
        }
    }

    return [...appearancesByNumber.entries()].flatMap(([appearanceNumber, appearance]) => [
        createCommand(`Store Appearance ${appearanceNumber}`),
        createCommand(`Label Appearance ${appearanceNumber} ${quoteCommandValue(appearance.appearanceName)}`),
        createCommand(`Set Appearance ${appearanceNumber} ${appearance.appearanceColor}`),
    ]);
}

function createTimecodeCommands(
    settings: ConversionSettings,
    tempDataPoolName: string,
    filename: string,
    sequences: GeneratedSequence[],
    uniqueCues: ConvertedMarker[],
    regionSequences: RegionSequence[],
    regionLayerSequences: RegionLayerSequence[],
    repeatedSequences: RepeatedSequence[],
    bumpSequences: BumpSequence[],
    bpmSequence: BpmSequence | undefined,
): MacroLine[] {
    if (settings.exportMode !== "cues-and-timecode" || sequences.length === 0) {
        return [];
    }

    const eventsBySequence = collectTimecodeEventsBySequence(sequences, settings);
    const trackGroups = createTimecodeTrackGroups(settings, filename, sequences);
    const duration = calculateTimecodeDuration([
        ...collectTimecodeTimestamps(uniqueCues, regionSequences, regionLayerSequences, repeatedSequences, bumpSequences, bpmSequence),
        ...[...eventsBySequence.values()].flatMap((events) => events.map((event) => event.timestamp)),
    ]);
    const commands: MacroLine[] = [
        createCommand("cd root"),
        createCommand(`Store DataPool ${quoteCommandValue(tempDataPoolName)} Timecode 1`),
        ...trackGroups.flatMap((group) => [
            createCommand(`Store DataPool ${quoteCommandValue(tempDataPoolName)} Timecode 1.${group.groupIndex}`),
            createCommand(`Label DataPool ${quoteCommandValue(tempDataPoolName)} Timecode 1.${group.groupIndex} ${quoteCommandValue(group.name)}`),
        ]),
        createCommand("cd root"),
        createCommand(`cd DataPool ${quoteCommandValue(tempDataPoolName)}`),
        createCommand('cd "Timecodes"'),
        createCommand('set 1 OFFSETTCSLOT="0"'),
        createCommand(`set 1 DURATION=${quoteCommandValue(duration)}`),
        createCommand('set 1 IGNOREFOLLOW="1"'),
    ];

    for (const group of trackGroups) {
        for (const placement of group.tracks) {
            const { sequence, trackIndex } = placement;
            const events = eventsBySequence.get(sequence.localSequenceNumber) ?? [];

            commands.push(
                createCommand("cd root"),
                createCommand(`cd DataPool ${quoteCommandValue(tempDataPoolName)} Timecode 1`),
                createCommand(`cd ${group.groupIndex}`),
            );

            if (trackIndex > 1) {
                commands.push(createCommand(`Store ${trackIndex}`));
            }

            commands.push(
                createCommand(`Assign DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} At ${trackIndex}`),
                createCommand(`cd ${trackIndex}`),
                createCommand("cd 1"),
                createCommand('Store Type "CmdSubTrack" 1'),
                createCommand("cd 1"),
                ...events.flatMap((event, eventIndex) => [
                    createCommand(`Store ${eventIndex + 1}`),
                    createCommand(`Set ${eventIndex + 1} "TIME" ${quoteCommandValue(event.timestamp)}`),
                    createCommand(`Set ${eventIndex + 1} "TOKEN" ${quoteCommandValue(event.token)}`),
                ]),
                createCommand("cd root"),
                createCommand(`cd DataPool ${quoteCommandValue(tempDataPoolName)}`),
                ...events.flatMap((event, eventIndex) =>
                    event.cueNumber === undefined
                        ? []
                        : [
                              createCommand(
                                  `Assign DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${sequence.localSequenceNumber} Cue ${event.cueNumber} At Timecode 1.${group.groupIndex}.${trackIndex}.1.1.${eventIndex + 1}`,
                              ),
                          ],
                ),
            );
        }
    }

    return commands;
}

function createTimecodeTrackGroups(settings: ConversionSettings, filename: string, sequences: GeneratedSequence[]): TimecodeTrackGroup[] {
    const isHybridMode = settings.importMode === "regions-and-markers";
    const groups: TimecodeTrackGroup[] = [];
    const groupsByRegionId = new Map<string, TimecodeTrackGroup>();
    const regionGroupNamesById = new Map(
        sequences.filter((sequence) => sequence.regionId).map((sequence) => [sequence.regionId as string, sequence.displayName]),
    );
    let globalGroup: TimecodeTrackGroup | undefined;

    const createGroup = (name: string): TimecodeTrackGroup => {
        const group: TimecodeTrackGroup = {
            groupIndex: groups.length + 1,
            name,
            tracks: [],
        };

        groups.push(group);

        return group;
    };

    const ensureGlobalGroup = (): TimecodeTrackGroup => {
        globalGroup ??= createGroup(isHybridMode ? "Global" : filename);

        return globalGroup;
    };

    const ensureRegionGroup = (regionId: string): TimecodeTrackGroup => {
        const existingGroup = groupsByRegionId.get(regionId);

        if (existingGroup) {
            return existingGroup;
        }

        const group = createGroup(regionGroupNamesById.get(regionId) ?? regionId);
        groupsByRegionId.set(regionId, group);

        return group;
    };

    if (!isHybridMode || sequences.some((sequence) => resolveSequenceTimecodeRegionId(sequence) === undefined)) {
        ensureGlobalGroup();
    }

    for (const sequence of sequences) {
        const regionId = isHybridMode ? resolveSequenceTimecodeRegionId(sequence) : undefined;
        const group = regionId ? ensureRegionGroup(regionId) : ensureGlobalGroup();

        group.tracks.push({
            sequence,
            groupIndex: group.groupIndex,
            trackIndex: group.tracks.length + 1,
        });
    }

    return groups;
}

function resolveSequenceTimecodeRegionId(sequence: GeneratedSequence): string | undefined {
    return sequence.regionId ?? sequence.regionLayer?.regionId ?? sequence.timecodeRegionId;
}

function collectTimecodeEventsBySequence(sequences: GeneratedSequence[], settings: ConversionSettings): Map<number, TimecodeMacroEvent[]> {
    const eventsBySequence = new Map(sequences.map((sequence) => [sequence.localSequenceNumber, [] as TimecodeMacroEvent[]]));
    const regionSequencesById = new Map(sequences.filter((sequence) => sequence.regionId).map((sequence) => [sequence.regionId as string, sequence]));
    const regionLayerSequencesByKey = new Map(
        sequences
            .filter((sequence) => sequence.regionLayer)
            .map((sequence) => [createRegionLayerKey(sequence.regionLayer!.regionId, sequence.regionLayer!.layerName), sequence]),
    );
    const regionLayerSequencesByRegionId = groupGeneratedRegionLayerSequencesByRegionId(sequences);
    const regionAutoOffTimestampsById = createRegionAutoOffTimestampsById(sequences);
    const manuallyOffedRegionIds = new Set<string>();
    const manuallyOffedRegionLayerKeys = new Set<string>();
    let sourceOrder = 0;

    for (const sequence of sequences) {
        const sequenceEvents = eventsBySequence.get(sequence.localSequenceNumber);

        if (!sequenceEvents) {
            continue;
        }

        for (const event of sequence.events) {
            sequenceEvents.push({
                timestamp: event.timestamp,
                token: event.execToken,
                cueNumber: event.cueNumber,
                priority: 1,
                sourceOrder: sourceOrder++,
            });

            for (const action of sortRegionActions(event.regionActions ?? [])) {
                const targetSequence = regionSequencesById.get(action.regionId);

                if (!targetSequence) {
                    continue;
                }

                if (action.kind === "OFF") {
                    manuallyOffedRegionIds.add(action.regionId);
                }

                eventsBySequence.get(targetSequence.localSequenceNumber)?.push({
                    timestamp: event.timestamp,
                    token: action.kind === "ON" ? "Go+" : "Off",
                    ...(action.kind === "ON" ? { cueNumber: resolveRegionStartCueNumber(targetSequence) } : {}),
                    priority: action.kind === "OFF" ? 0 : 2,
                    sourceOrder: sourceOrder++,
                });
            }

            for (const action of event.regionLayerActions ?? []) {
                const targetSequences = resolveRegionLayerActionSequences(action, regionLayerSequencesByKey, regionLayerSequencesByRegionId);

                for (const targetSequence of targetSequences) {
                    if (targetSequence.regionLayer) {
                        manuallyOffedRegionLayerKeys.add(createRegionLayerKey(targetSequence.regionLayer.regionId, targetSequence.regionLayer.layerName));
                    }

                    eventsBySequence.get(targetSequence.localSequenceNumber)?.push({
                        timestamp: event.timestamp,
                        token: "Off",
                        priority: 0,
                        sourceOrder: sourceOrder++,
                    });
                }
            }
        }
    }

    for (const sequence of sequences) {
        if (!sequence.regionId) {
            continue;
        }

        if (manuallyOffedRegionIds.has(sequence.regionId)) {
            continue;
        }

        const autoOffTimestamp = regionAutoOffTimestampsById.get(sequence.regionId);

        if (!autoOffTimestamp) {
            continue;
        }

        eventsBySequence.get(sequence.localSequenceNumber)?.push({
            timestamp: autoOffTimestamp,
            token: "Off",
            priority: 3,
            sourceOrder: sourceOrder++,
        });
    }

    if (settings.autoOffRegionLayers !== false) {
        for (const sequence of sequences) {
            if (!sequence.regionLayer) {
                continue;
            }

            const regionLayerKey = createRegionLayerKey(sequence.regionLayer.regionId, sequence.regionLayer.layerName);

            if (manuallyOffedRegionLayerKeys.has(regionLayerKey)) {
                continue;
            }

            eventsBySequence.get(sequence.localSequenceNumber)?.push({
                timestamp: regionAutoOffTimestampsById.get(sequence.regionLayer.regionId) ?? sequence.regionLayer.end,
                token: "Off",
                priority: 3,
                sourceOrder: sourceOrder++,
            });
        }
    }

    for (const events of eventsBySequence.values()) {
        events.sort(compareTimecodeMacroEvents);
    }

    return eventsBySequence;
}

function createRegionAutoOffTimestampsById(sequences: GeneratedSequence[]): Map<string, string> {
    const regionSequences = sequences
        .filter((sequence) => sequence.regionId && sequence.regionStart)
        .sort((left, right) => compareTimestampStrings(left.regionStart ?? "", right.regionStart ?? "", left.localSequenceNumber, right.localSequenceNumber));
    const autoOffTimestampsById = new Map<string, string>();

    for (let index = 0; index < regionSequences.length - 1; index += 1) {
        const sequence = regionSequences[index];
        const nextSequence = regionSequences[index + 1];

        if (!sequence.regionId || !nextSequence.regionStart) {
            continue;
        }

        autoOffTimestampsById.set(sequence.regionId, addSecondsToTimestamp(nextSequence.regionStart, REGION_AUTO_OFF_AFTER_NEXT_START_SECONDS));
    }

    return autoOffTimestampsById;
}

function resolveRegionStartCueNumber(sequence: GeneratedSequence): number {
    return sequence.cues.find((cue) => cue.name === "Region Start" || cue.name.startsWith("Region Start + "))?.cueNumber ?? 1;
}

function groupGeneratedRegionLayerSequencesByRegionId(sequences: GeneratedSequence[]): Map<string, GeneratedSequence[]> {
    const sequencesByRegionId = new Map<string, GeneratedSequence[]>();

    for (const sequence of sequences) {
        if (!sequence.regionLayer) {
            continue;
        }

        sequencesByRegionId.set(sequence.regionLayer.regionId, [...(sequencesByRegionId.get(sequence.regionLayer.regionId) ?? []), sequence]);
    }

    return sequencesByRegionId;
}

function resolveRegionLayerActionSequences(
    action: NonNullable<SequenceTrigger["regionLayerActions"]>[number],
    regionLayerSequencesByKey: Map<string, GeneratedSequence>,
    regionLayerSequencesByRegionId: Map<string, GeneratedSequence[]>,
): GeneratedSequence[] {
    if (!action.regionId) {
        return [];
    }

    if (action.scope === "all") {
        return regionLayerSequencesByRegionId.get(action.regionId) ?? [];
    }

    const targetSequence = regionLayerSequencesByKey.get(createRegionLayerKey(action.regionId, action.layerName));

    return targetSequence ? [targetSequence] : [];
}

function createRegionLayerKey(regionId: string, layerName: string): string {
    return `${regionId}\u0000${layerName}`;
}

function sortRegionActions(actions: NonNullable<SequenceTrigger["regionActions"]>): NonNullable<SequenceTrigger["regionActions"]> {
    return [...actions].sort((left, right) => (left.kind === right.kind ? 0 : left.kind === "OFF" ? -1 : 1));
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

function compareTimecodeMacroEvents(left: TimecodeMacroEvent, right: TimecodeMacroEvent): number {
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

function createPageAssignmentCommands(tempDataPoolName: string, assignments: ExecutorAssignment[]): MacroLine[] {
    return assignments.map((assignment) => createCommand(
        `Assign DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${assignment.localSequenceNumber} At Page ${assignment.pageNumber}.${assignment.slotNumber}`,
    ));
}

function createPageLabelCommands(settings: ConversionSettings, filename: string, assignments: ExecutorAssignment[]): MacroLine[] {
    if (settings.assignExecutors === false) return [];
    if ((settings.executorLayout ?? "continuous") === "continuous" || assignments.length === 0) {
        return [createCommand(`Label Page ${settings.pageNumber} ${quoteCommandValue(filename)}`)];
    }

    const pages = new Map<number, ExecutorAssignment[]>();
    for (const assignment of assignments) {
        pages.set(assignment.pageNumber, [...(pages.get(assignment.pageNumber) ?? []), assignment]);
    }

    return [...pages].map(([pageNumber, pageAssignments]) => {
        const regionLabel = pageAssignments.find((assignment) => assignment.regionLabel)?.regionLabel;
        const label = regionLabel ? `${filename} - ${regionLabel}` : filename;
        return createCommand(`Label Page ${pageNumber} ${quoteCommandValue(label)}`);
    });
}

function createBpmCueName(bpmText: string): string {
    return `BPM ${bpmText}`;
}


/**
 * Without overrides every sequence lands contiguously, so the historical open-ended
 * `Sequence 1 Thru At Sequence N` is emitted unchanged — existing shows keep the exact
 * same macro. Only a pinned number splits the move into explicit runs.
 */
function createSequenceMoveCommands(tempDataPoolName: string, moves: SequenceMove[]): MacroLine[] {
    if (moves.length === 0) return [];

    if (moves.length === 1 && moves[0].fromLocalNumber === 1) {
        return [createCommand(`Move DataPool ${quoteCommandValue(tempDataPoolName)} Sequence 1 Thru At Sequence ${moves[0].toSequenceNumber}`)];
    }

    return moves.map((move) =>
        createCommand(
            move.throughLocalNumber === undefined
                ? `Move DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${move.fromLocalNumber} At Sequence ${move.toSequenceNumber}`
                : `Move DataPool ${quoteCommandValue(tempDataPoolName)} Sequence ${move.fromLocalNumber} Thru ${move.throughLocalNumber} At Sequence ${move.toSequenceNumber}`,
        ),
    );
}

export function generateMacroXML(
    settings: ConversionSettings,
    uniqueCues: ConvertedMarker[],
    regionSequences: RegionSequence[],
    regionLayerSequences: RegionLayerSequence[],
    repeatedSequences: RepeatedSequence[],
    bumpSequences: BumpSequence[],
    bpmSequence: BpmSequence | undefined,
    filename: string,
): string {
    const tempDataPoolName = createTempDataPoolName(filename);
    const sequences = createGeneratedSequences(settings, uniqueCues, regionSequences, regionLayerSequences, repeatedSequences, bumpSequences, bpmSequence);
    const executorAssignments = createExecutorAssignmentPlan(settings, sequences);
    const timecodeCommands = createTimecodeCommands(
        settings,
        tempDataPoolName,
        filename,
        sequences,
        uniqueCues,
        regionSequences,
        regionLayerSequences,
        repeatedSequences,
        bumpSequences,
        bpmSequence,
    );
    const sequenceMoves = createSequenceMoves(sequences);
    const obj = {
        ...XML_HEADER,
        GMA3: {
            "@_DataVersion": "1.4.0.2",
            Macro: {
                "@_Name": `Macro ${filename}`,
                "@_Guid": "00 00 00 00 A8 F8 B9 20 78 06 00 00 A5 46 09 AA",
                MacroLine: [
                    createCommand("cd root", "0.01"),
                    createCommand(`Delete DataPool ${quoteCommandValue(tempDataPoolName)} /NC`),
                    createCommand(`Store DataPool ${quoteCommandValue(tempDataPoolName)} /NC`),
                    ...collectAppearanceSetupCommands(sequences),
                    ...sequences.flatMap((sequence) => createSequenceSetupCommands(tempDataPoolName, settings, sequence)),
                    ...timecodeCommands,
                    createCommand("cd root", "0.01"),
                    ...createPageAssignmentCommands(tempDataPoolName, executorAssignments),
                    ...(settings.exportMode === "cues-and-timecode" && sequences.length > 0
                        ? [createCommand(`Label DataPool ${quoteCommandValue(tempDataPoolName)} Timecode 1 ${quoteCommandValue(filename)}`)]
                        : []),
                    ...createPageLabelCommands(settings, filename, executorAssignments),
                    ...createSequenceMoveCommands(tempDataPoolName, sequenceMoves),
                    ...(settings.exportMode === "cues-and-timecode" && sequences.length > 0
                        ? [
                              createCommand(`Move DataPool ${quoteCommandValue(tempDataPoolName)} Timecode 1 Thru At Timecode ${settings.timecodeNumber}`),
                              ...(resolveTimecodeOffsetMs(settings.timecodeOffsetMs) !== 0
                                  ? [createCommand(
                                        `Set Timecode ${settings.timecodeNumber} Property ${quoteCommandValue("Offset")} ${quoteCommandValue(formatTimecodeOffsetSeconds(settings.timecodeOffsetMs))}`,
                                    )]
                                  : []),
                              createCommand(
                                  `Set Timecode ${settings.timecodeNumber} Property ${quoteCommandValue("PlaybackAndRecord")} ${quoteCommandValue("Manual Events")}`,
                              ),
                          ]
                        : []),
                    createCommand(`Delete DataPool ${quoteCommandValue(tempDataPoolName)} /NoConfirm`),
                ],
            },
        },
    };

    return xmlBuilder.build(obj);
}
