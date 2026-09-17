export type ExportMode = "cues-and-timecode" | "cues-only";
export type ImportMode = "markers-only" | "regions-and-markers";
export type GrandmaVersionProfile = "pre-2.4" | "2.4+";

export type ConversionDiagnosticCode =
    | "csv.missing-headers"
    | "csv.invalid-timestamp"
    | "conversion.empty-main-sequence"
    | "conversion.no-regions"
    | "conversion.no-markers"
    | "conversion.warning";

export type ConversionDiagnostic = {
    code: ConversionDiagnosticCode;
    severity: "warning" | "error";
    params?: Record<string, string | number>;
    message: string;
};

export type ReaperMarkerRow = {
    "#": string;
    Name: string;
    Start: string;
    End?: string;
    Length?: string;
    Color: string;
};

export type ReaperRegionRow = ReaperMarkerRow & {
    End: string;
    Length: string;
};

export type MarkerTag = {
    key: string;
    value: string | null;
};

export type RegionActionTag = {
    kind: "ON" | "OFF";
    regionId: string;
};

export type RegionLayerActionTag =
    | {
          kind: "OFF";
          scope: "layer";
          layerName: string;
          regionId?: string;
      }
    | {
          kind: "OFF";
          scope: "all";
          regionId?: string;
      };

export type BumpActionTag = {
    kind: "Temp" | "Flash";
    phase: "start" | "release";
    releaseDelayMs?: number;
};

export type CueTimingTagKey =
    | "FadeFromX"
    | "FadeFromY"
    | "FadeFromZ"
    | "FadeToX"
    | "FadeToY"
    | "FadeToZ"
    | "DelayFromX"
    | "DelayFromY"
    | "DelayFromZ"
    | "DelayToX"
    | "DelayToY"
    | "DelayToZ";

export type CueTimingTag = {
    key: CueTimingTagKey;
    value: string;
};

export type AppearanceReference = {
    appearanceName: string;
    appearanceNumber: number;
    appearanceColor: string;
};

export type ConvertedMarker = {
    displayName: string;
    execToken: string;
    tags: MarkerTag[];
    isCuePart?: boolean;
    isGlobal?: boolean;
    bumpAction?: BumpActionTag;
    regionActions?: RegionActionTag[];
    regionLayerActions?: RegionLayerActionTag[];
    regionLayerName?: string;
    start: string;
    color: string;
    regionTargetId?: string;
    regionId?: string;
    regionLabel?: string;
    regionContextId?: string;
    regionContextLabel?: string;
    regionContextColor?: string;
    bpm?: number;
    bpmText?: string;
    cueFade?: string;
    cueTiming?: CueTimingTag[];
    cueParts?: SequenceCuePart[];
};

export type SequenceCuePart = {
    partNumber: number;
    name: string;
    sourceTimestamp: string;
    cueDelay: string;
    cueFade?: string;
    cueTiming?: CueTimingTag[];
};

export type SequenceCue = {
    cueNumber: number;
    name: string;
    appearanceName?: string;
    appearanceNumber?: number;
    appearanceColor?: string;
    commands?: string[];
    cueFade?: string;
    cueTiming?: CueTimingTag[];
    cueParts?: SequenceCuePart[];
};

export type SequenceTrigger = {
    timestamp: string;
    execToken: string;
    cueNumber: number;
    cueName: string;
    regionActions?: RegionActionTag[];
    regionLayerActions?: RegionLayerActionTag[];
    cueFade?: string;
    cueTiming?: CueTimingTag[];
};

export type RepeatedSequence = {
    color: string;
    displayName: string;
    cues: SequenceCue[];
    events: SequenceTrigger[];
    appearanceName?: string;
    appearanceNumber?: number;
    appearanceColor?: string;
    sequenceNumber: number;
};

export type RegionSequence = {
    regionId: string;
    displayName: string;
    regionLabel: string;
    start: string;
    end: string;
    color: string;
    cues: SequenceCue[];
    events: SequenceTrigger[];
    appearanceName?: string;
    appearanceNumber?: number;
    appearanceColor?: string;
    sequenceNumber: number;
};

export type RegionLayerSequence = {
    regionId: string;
    regionLabel: string;
    layerName: string;
    displayName: string;
    start: string;
    end: string;
    color: string;
    cues: SequenceCue[];
    events: SequenceTrigger[];
    appearanceName?: string;
    appearanceNumber?: number;
    appearanceColor?: string;
    sequenceNumber: number;
};

export type BumpSequence = {
    color: string;
    sourceName: string;
    displayName: string;
    regionId?: string;
    regionLabel?: string;
    cues: SequenceCue[];
    events: SequenceTrigger[];
    appearanceName?: string;
    appearanceNumber?: number;
    appearanceColor?: string;
    releaseDurationSeconds: string;
    releaseWarnings?: string[];
    sequenceNumber: number;
};

export type BpmSequenceEvent = {
    displayName: string;
    timestamp: string;
    bpm: number;
    bpmText: string;
};

export type BpmSequenceSource = {
    displayName: string;
    start: string;
    bpm: number;
    bpmText: string;
};

export type BpmSequence = {
    displayName: string;
    events: BpmSequenceEvent[];
    releaseDurationSeconds: string;
    sequenceNumber: number;
};

export type ExecutorLayout = "continuous" | "region-per-page";

export type ExecutorAddress = {
    pageNumber: number;
    slotNumber: number;
};

export type ConversionSettings = {
    importMode?: ImportMode;
    sequenceNumber: number;
    appearanceStartNumber: number;
    sequenceNamePrefix: string;
    timecodeNumber: number;
    timecodeOffsetMs?: number;
    pageNumber: number;
    pageSlotStart: number;
    bumpPageSlotStart: number;
    assignExecutors: boolean;
    executorLayout?: ExecutorLayout;
    /**
     * Manual executor addresses keyed by final sequence number. Advanced use: a pinned
     * address is reserved, and automatically placed sequences pack around it.
     */
    executorOverrides?: Record<string, ExecutorAddress>;
    /**
     * Manual DataPool sequence numbers, keyed by the number the sequence would receive
     * automatically. Overriding one never renumbers the others.
     */
    sequenceNumberOverrides?: Record<string, number>;
    cueStartNumber: number;
    regionEndPreRollMs: number;
    autoOffRegionLayers: boolean;
    regionLayerPreRollEnabled: boolean;
    regionLayerPreRollMs: number;
    speedMaster: string;
    prefix: string;
    exportMode: ExportMode;
};

export type ConversionIdentity = {
    projectName: string;
    timecodeName: string;
    outputBaseName?: string;
};

export type ReaperCsvConversionRequest = {
    csvText: string;
    sourceFileName: string;
    settings: ConversionSettings;
    identity: ConversionIdentity;
};

export type ExampleMacroPresetGroupId = "show-time" | "timecode-control";

export type ExampleMacroPresetId =
    | "show-time-manuel"
    | "show-time-auto-restore"
    | "timecode-switch-int"
    | "timecode-switch-ltc"
    | "timecode-rewind-and-switch-int"
    | "timecode-rewind-tc-and-switch-ltc";

export type ExampleMacroPresetSelection = {
    showTime: boolean;
    timecodeControl: boolean;
};

export type ExampleMacroPresetContext = {
    timecodeName: string;
    internalTimecodeSlot: -2 | -1;
    externalTimecodeSlot: number;
};

export type ExampleMacroPresetDefinition = {
    id: ExampleMacroPresetId;
    groupId: ExampleMacroPresetGroupId;
    label: string;
    xmlName: string;
    fileBaseName: string;
    lines: Array<string | ((context: ExampleMacroPresetContext) => string)>;
};

export type ExampleMacroPresetGroup = {
    id: ExampleMacroPresetGroupId;
    label: string;
    description: string;
    presets: ExampleMacroPresetDefinition[];
};

export type ExampleMacroPresetOutputFile = {
    name: string;
    content: string;
    presetId: ExampleMacroPresetId;
};

export type ConversionArtifacts = {
    importMode: ImportMode;
    outputBaseName: string;
    grandmaName: string;
    validationWarnings: string[];
    diagnostics: ConversionDiagnostic[];
    regionSequences: RegionSequence[];
    regionLayerSequences: RegionLayerSequence[];
    uniqueCues: ConvertedMarker[];
    repeatedSequences: RepeatedSequence[];
    bumpSequences: BumpSequence[];
    bpmSequence?: BpmSequence;
    macroXml: string;
};
