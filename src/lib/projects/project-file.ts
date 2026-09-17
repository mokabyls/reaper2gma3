import type { ProjectDocumentV1, ProjectExportV1, ProjectSettingsV1, ProjectSnapshotV1, ProjectStage } from "./types.js";
import { isValidTimecodeOffsetMs } from "../reaper2ma/timecode-offset.js";

const PROJECT_STAGES = new Set<ProjectStage>(["identity", "source", "analysis", "cues", "sequences", "output", "executors", "extras", "review"]);

export function serializeProjectExport(bundle: ProjectExportV1): string {
    return JSON.stringify(bundle, null, 2);
}

export function parseProjectExport(value: string): ProjectExportV1 {
    const parsed: unknown = JSON.parse(value);
    if (!isProjectExportV1(parsed)) throw new TypeError("This file is not a supported Reaper2MA project export.");
    return parsed;
}

export function isProjectExportV1(value: unknown): value is ProjectExportV1 {
    if (!value || typeof value !== "object") return false;
    const bundle = value as Partial<ProjectExportV1>;
    if (bundle.kind !== "reaper2ma-project" || bundle.schemaVersion !== 1 || typeof bundle.exportedAt !== "string" || !isProjectDocument(bundle.project)) return false;
    const project = bundle.project;
    if (!Array.isArray(bundle.sources) || !bundle.sources.every((source) => isRecord(source) && source.schemaVersion === 1 && typeof source.id === "string" && source.projectId === project.id && typeof source.fileName === "string" && typeof source.csvText === "string" && typeof source.importedAt === "string" && typeof source.sha256 === "string" && isNonNegativeNumber(source.byteSize))) return false;
    if (!Array.isArray(bundle.revisions) || !bundle.revisions.every((revision) => isRecord(revision) && revision.schemaVersion === 1 && typeof revision.id === "string" && revision.projectId === project.id && typeof revision.createdAt === "string" && ["stage", "source-replaced", "restore", "zip-export"].includes(String(revision.reason)) && isProjectSnapshot(revision.snapshot))) return false;

    const sourceIds = new Set(bundle.sources.map((source) => source.id));
    return (!project.sourceId || sourceIds.has(project.sourceId)) && bundle.revisions.every((revision) => !revision.snapshot.sourceId || sourceIds.has(revision.snapshot.sourceId));
}

function isProjectDocument(value: unknown): value is ProjectDocumentV1 {
    if (!isRecord(value)) return false;
    return value.schemaVersion === 1 && typeof value.id === "string" && typeof value.projectName === "string" && typeof value.timecodeName === "string" && (value.status === "draft" || value.status === "configured") && typeof value.createdAt === "string" && typeof value.updatedAt === "string" && isStage(value.currentStage) && isStageList(value.completedStages) && optionalString(value.sourceId) && optionalString(value.sourceFileName) && isAnalysisSummary(value.analysis) && isProjectSettings(value.settings);
}

function isProjectSnapshot(value: unknown): value is ProjectSnapshotV1 {
    if (!isRecord(value)) return false;
    return typeof value.projectName === "string" && typeof value.timecodeName === "string" && (value.status === "draft" || value.status === "configured") && isStage(value.currentStage) && isStageList(value.completedStages) && optionalString(value.sourceId) && optionalString(value.sourceFileName) && isAnalysisSummary(value.analysis) && isProjectSettings(value.settings);
}

function isProjectSettings(value: unknown): value is ProjectSettingsV1 {
    if (!isRecord(value)) return false;
    const numberKeys = ["sequenceNumber", "appearanceStartNumber", "timecodeNumber", "pageNumber", "pageSlotStart", "bumpPageSlotStart", "cueStartNumber", "regionEndPreRollMs", "regionLayerPreRollMs", "externalTimecodeSlot", "transportOscSlotId"];
    const booleanKeys = ["assignExecutors", "autoOffRegionLayers", "regionLayerPreRollEnabled", "exportShowTimeMacros", "exportTimecodeControlMacros", "includeReaperTransportMacros"];
    const stringKeys = ["sequenceNamePrefix", "speedMaster", "prefix", "transportOscDataName", "transportMacroNamePrefix", "transportOutputFileName"];
    const offsetIsValid = value.timecodeOffsetMs === undefined || isValidTimecodeOffsetMs(value.timecodeOffsetMs);
    return numberKeys.every((key) => isNonNegativeNumber(value[key])) && offsetIsValid && booleanKeys.every((key) => typeof value[key] === "boolean") && stringKeys.every((key) => typeof value[key] === "string") && (value.importMode === "markers-only" || value.importMode === "regions-and-markers") && (value.exportMode === "cues-only" || value.exportMode === "cues-and-timecode") && (value.grandmaVersion === "pre-2.4" || value.grandmaVersion === "2.4+") && (value.executorLayout === undefined || value.executorLayout === "continuous" || value.executorLayout === "region-per-page");
}

function isAnalysisSummary(value: unknown): boolean {
    return value === undefined || (isRecord(value) && ["rowCount", "markerCount", "regionCount", "durationSeconds", "warningCount"].every((key) => isNonNegativeNumber(value[key])));
}

function isStage(value: unknown): value is ProjectStage {
    return typeof value === "string" && PROJECT_STAGES.has(value as ProjectStage);
}

function isStageList(value: unknown): value is ProjectStage[] {
    return Array.isArray(value) && value.every(isStage);
}

function optionalString(value: unknown): boolean {
    return value === undefined || typeof value === "string";
}

function isNonNegativeNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object";
}
