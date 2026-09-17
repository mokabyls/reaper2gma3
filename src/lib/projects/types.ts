import type { ConversionSettings, GrandmaVersionProfile } from "../reaper2ma/types.js";

export type ProjectStatus = "draft" | "configured";
export type ProjectStage =
    | "identity"
    | "source"
    | "analysis"
    | "cues"
    | "sequences"
    | "output"
    | "executors"
    | "extras"
    | "review";

export type ProjectSettingsV1 = ConversionSettings & {
    grandmaVersion: GrandmaVersionProfile;
    externalTimecodeSlot: number;
    exportShowTimeMacros: boolean;
    exportTimecodeControlMacros: boolean;
    includeReaperTransportMacros: boolean;
    transportOscSlotId: number;
    transportOscDataName: string;
    transportMacroNamePrefix: string;
    transportOutputFileName: string;
};

export type ProjectAnalysisSummaryV1 = {
    rowCount: number;
    markerCount: number;
    regionCount: number;
    durationSeconds: number;
    warningCount: number;
};

export type ProjectDocumentV1 = {
    schemaVersion: 1;
    id: string;
    projectName: string;
    timecodeName: string;
    status: ProjectStatus;
    createdAt: string;
    updatedAt: string;
    currentStage: ProjectStage;
    completedStages: ProjectStage[];
    sourceId?: string;
    sourceFileName?: string;
    analysis?: ProjectAnalysisSummaryV1;
    settings: ProjectSettingsV1;
};

export type ProjectSourceV1 = {
    schemaVersion: 1;
    id: string;
    projectId: string;
    fileName: string;
    csvText: string;
    importedAt: string;
    sha256: string;
    byteSize: number;
};

export type ProjectRevisionReason = "stage" | "source-replaced" | "restore" | "zip-export";

export type ProjectSnapshotV1 = Pick<
    ProjectDocumentV1,
    | "projectName"
    | "timecodeName"
    | "status"
    | "currentStage"
    | "completedStages"
    | "sourceId"
    | "sourceFileName"
    | "analysis"
    | "settings"
>;

export type ProjectRevisionV1 = {
    schemaVersion: 1;
    id: string;
    projectId: string;
    createdAt: string;
    reason: ProjectRevisionReason;
    snapshot: ProjectSnapshotV1;
};

export type ProjectExportV1 = {
    kind: "reaper2ma-project";
    schemaVersion: 1;
    exportedAt: string;
    project: ProjectDocumentV1;
    sources: ProjectSourceV1[];
    revisions: ProjectRevisionV1[];
};

export type StorageUsage = {
    usage: number;
    quota: number;
    ratio: number;
    warning: boolean;
    critical: boolean;
};
