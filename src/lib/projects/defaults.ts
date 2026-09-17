import {
    DEFAULT_AUTO_OFF_REGION_LAYERS,
    DEFAULT_REGION_END_PRE_ROLL_MS,
    DEFAULT_REGION_LAYER_PRE_ROLL_ENABLED,
    DEFAULT_REGION_LAYER_PRE_ROLL_MS,
} from "../reaper2ma/settings.js";
import type { ImportMode, ExportMode } from "../reaper2ma/types.js";
import type { ProjectDocumentV1, ProjectSettingsV1 } from "./types.js";

const LEGACY_SETTINGS_KEY = "reaper2ma:settings:v1";

export const DEFAULT_PROJECT_SETTINGS: ProjectSettingsV1 = {
    sequenceNumber: 9001,
    appearanceStartNumber: 9001,
    sequenceNamePrefix: "MA",
    timecodeNumber: 1,
    timecodeOffsetMs: 0,
    pageNumber: 1,
    pageSlotStart: 201,
    bumpPageSlotStart: 101,
    assignExecutors: true,
    executorLayout: "continuous",
    executorOverrides: {},
    sequenceNumberOverrides: {},
    cueStartNumber: 1,
    regionEndPreRollMs: DEFAULT_REGION_END_PRE_ROLL_MS,
    autoOffRegionLayers: DEFAULT_AUTO_OFF_REGION_LAYERS,
    regionLayerPreRollEnabled: DEFAULT_REGION_LAYER_PRE_ROLL_ENABLED,
    regionLayerPreRollMs: DEFAULT_REGION_LAYER_PRE_ROLL_MS,
    speedMaster: "3.4",
    prefix: "",
    importMode: "markers-only",
    exportMode: "cues-and-timecode",
    grandmaVersion: "2.4+",
    externalTimecodeSlot: 1,
    exportShowTimeMacros: false,
    exportTimecodeControlMacros: false,
    includeReaperTransportMacros: false,
    transportOscSlotId: 1,
    transportOscDataName: "REAPER",
    transportMacroNamePrefix: "REAPER - ",
    transportOutputFileName: "reaper_transport_macros.xml",
};

/**
 * Settings that describe one specific show. They must never carry over to a new
 * project: a timecode offset aligns grandMA3 to one particular audio file, and
 * pinned executor addresses and sequence numbers are keyed to this show's numbering.
 * Inheriting any of them would silently misconfigure the next show.
 */
const SHOW_SPECIFIC_SETTINGS: Partial<ProjectSettingsV1> = { timecodeOffsetMs: 0, executorOverrides: {}, sequenceNumberOverrides: {} };

export type InheritedProjectSettings = {
    settings: ProjectSettingsV1;
    from?: { id: string; projectName: string };
};

/**
 * Resolve the settings a new project should start from. A returning user keeps the
 * console numbers they configured last time instead of retyping them each show.
 */
export function resolveInheritedSettings(projects: readonly ProjectDocumentV1[]): InheritedProjectSettings {
    const template = pickSettingsTemplate(projects);

    if (!template) {
        return { settings: readLegacyProjectSettings() };
    }

    return {
        settings: { ...DEFAULT_PROJECT_SETTINGS, ...template.settings, ...SHOW_SPECIFIC_SETTINGS },
        from: { id: template.id, projectName: template.projectName },
    };
}

function pickSettingsTemplate(projects: readonly ProjectDocumentV1[]): ProjectDocumentV1 | undefined {
    const byRecency = [...projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return byRecency.find((project) => project.status === "configured") ?? byRecency[0];
}

export function createProjectDocument(name: string, settings = readLegacyProjectSettings()): ProjectDocumentV1 {
    const now = new Date().toISOString();
    const trimmedName = name.trim();

    return {
        schemaVersion: 1,
        id: createId(),
        projectName: trimmedName,
        timecodeName: trimmedName,
        status: "draft",
        createdAt: now,
        updatedAt: now,
        currentStage: "source",
        completedStages: ["identity"],
        settings,
    };
}

export function readLegacyProjectSettings(): ProjectSettingsV1 {
    if (typeof localStorage === "undefined") {
        return { ...DEFAULT_PROJECT_SETTINGS };
    }

    try {
        const parsed = JSON.parse(localStorage.getItem(LEGACY_SETTINGS_KEY) ?? "null") as Record<string, unknown> | null;

        if (!parsed || typeof parsed !== "object") {
            return { ...DEFAULT_PROJECT_SETTINGS };
        }

        return {
            ...DEFAULT_PROJECT_SETTINGS,
            sequenceNumber: readInteger(parsed.sequenceNumber, DEFAULT_PROJECT_SETTINGS.sequenceNumber, 1, 9999),
            appearanceStartNumber: readInteger(parsed.appearanceStartNumber, DEFAULT_PROJECT_SETTINGS.appearanceStartNumber, 1, 9999),
            sequenceNamePrefix: readString(parsed.sequenceNamePrefix, DEFAULT_PROJECT_SETTINGS.sequenceNamePrefix),
            timecodeNumber: readInteger(parsed.timecodeNumber, DEFAULT_PROJECT_SETTINGS.timecodeNumber, 1, 9999),
            pageNumber: readInteger(parsed.pageNumber, DEFAULT_PROJECT_SETTINGS.pageNumber, 1, 9999),
            pageSlotStart: readInteger(parsed.pageSlotStart, DEFAULT_PROJECT_SETTINGS.pageSlotStart, 101, 490),
            bumpPageSlotStart: readInteger(parsed.bumpPageSlotStart, DEFAULT_PROJECT_SETTINGS.bumpPageSlotStart, 101, 490),
            assignExecutors: readBoolean(parsed.assignExecutors, DEFAULT_PROJECT_SETTINGS.assignExecutors),
            executorLayout: parsed.executorLayout === "region-per-page" ? "region-per-page" : DEFAULT_PROJECT_SETTINGS.executorLayout,
            cueStartNumber: readInteger(parsed.cueStartNumber, DEFAULT_PROJECT_SETTINGS.cueStartNumber, 1, 9999),
            regionEndPreRollMs: readInteger(parsed.regionEndPreRollMs, DEFAULT_PROJECT_SETTINGS.regionEndPreRollMs, 0, 5000),
            autoOffRegionLayers: readBoolean(parsed.autoOffRegionLayers, DEFAULT_PROJECT_SETTINGS.autoOffRegionLayers),
            regionLayerPreRollEnabled: readBoolean(parsed.regionLayerPreRollEnabled, DEFAULT_PROJECT_SETTINGS.regionLayerPreRollEnabled),
            regionLayerPreRollMs: readInteger(parsed.regionLayerPreRollMs, DEFAULT_PROJECT_SETTINGS.regionLayerPreRollMs, 0, 5000),
            speedMaster: resolveLegacySpeedMaster(parsed.speedMasterNumber),
            prefix: readString(parsed.prefix, DEFAULT_PROJECT_SETTINGS.prefix),
            importMode: readImportMode(parsed.importMode, DEFAULT_PROJECT_SETTINGS.importMode),
            exportMode: readExportMode(parsed.exportMode, DEFAULT_PROJECT_SETTINGS.exportMode),
            exportShowTimeMacros: readBoolean(parsed.exportShowTimeMacros, false),
            exportTimecodeControlMacros: readBoolean(parsed.exportTimecodeControlMacros, false),
            includeReaperTransportMacros: readBoolean(parsed.includeReaperTransportMacros, false),
            transportOscSlotId: readInteger(parsed.transportOscSlotId, 1, 1),
            transportOscDataName: readString(parsed.transportOscDataName, "REAPER"),
            transportMacroNamePrefix: readString(parsed.transportMacroNamePrefix, "REAPER - "),
            transportOutputFileName: readString(parsed.transportOutputFileName, "reaper_transport_macros.xml"),
        };
    } catch {
        return { ...DEFAULT_PROJECT_SETTINGS };
    }
}

export function createId(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function nextProjectVersionName(value: string): string {
    const match = value.match(/\bV(\d+)\s*$/i);
    return match ? value.replace(/\bV\d+\s*$/i, `V${Number(match[1]) + 1}`) : `${value.trim()} V2`;
}

function readInteger(value: unknown, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function readString(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function readImportMode(value: unknown, fallback: ImportMode | undefined): ImportMode {
    return value === "regions-and-markers" || value === "markers-only" ? value : fallback ?? "markers-only";
}

function readExportMode(value: unknown, fallback: ExportMode): ExportMode {
    return value === "cues-only" || value === "cues-and-timecode" ? value : fallback;
}

function resolveLegacySpeedMaster(value: unknown): string {
    const number = readInteger(value, 4, 1, 15);
    return `3.${number}`;
}
