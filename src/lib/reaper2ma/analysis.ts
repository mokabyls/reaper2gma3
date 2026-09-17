import { validateReaperCsvRows } from "./csv-validation.js";
import { assignMarkersToRegions, parseRegions, type ParsedRegion } from "./region-services.js";
import { isRegionRow, normalizeMarkerRows, parseReaperMarkerCsv } from "./markers.js";
import type { ConversionDiagnostic, ConvertedMarker, ImportMode, ReaperMarkerRow } from "./types.js";

const REQUIRED_HEADERS = ["#", "Name", "Start"] as const;

export type ReaperAnalysisPhase = "validation" | "regions" | "markers" | "preview";

export type ReaperAnalysisMarker = {
    id: string;
    name: string;
    start: string;
    startSeconds: number;
    color: string;
    regionId?: string;
};

export type ReaperAnalysisRegion = {
    id: string;
    label: string;
    start: string;
    end: string;
    startSeconds: number;
    endSeconds: number;
    color: string;
    isSynthetic: boolean;
    markers: ReaperAnalysisMarker[];
};

export type ReaperCsvAnalysis = {
    rowCount: number;
    markerCount: number;
    regionCount: number;
    durationSeconds: number;
    recommendedImportMode: ImportMode;
    regions: ReaperAnalysisRegion[];
    globalMarkers: ReaperAnalysisMarker[];
    diagnostics: ConversionDiagnostic[];
    warnings: string[];
};

export function analyzeReaperCsv(csvText: string): ReaperCsvAnalysis {
    const parsed = validateCsv(csvText);
    const detected = detectRegions(parsed.rows);
    const grouped = groupMarkers(parsed.rows, detected.regions);
    return createAnalysis(parsed, detected, grouped);
}

export async function analyzeReaperCsvProgressively(
    csvText: string,
    onPhase: (phase: ReaperAnalysisPhase) => void,
): Promise<ReaperCsvAnalysis> {
    onPhase("validation");
    await yieldToBrowser();
    const parsed = validateCsv(csvText);

    onPhase("regions");
    await yieldToBrowser();
    const detected = detectRegions(parsed.rows);

    onPhase("markers");
    await yieldToBrowser();
    const grouped = groupMarkers(parsed.rows, detected.regions);

    onPhase("preview");
    await yieldToBrowser();
    return createAnalysis(parsed, detected, grouped);
}

function validateCsv(csvText: string) {
    const { headers, rows } = parseReaperMarkerCsv(csvText);
    const warnings = validateReaperCsvRows(headers, rows);
    const normalizedHeaders = new Set(headers.map((header) => header.trim()));
    const missingHeaders = REQUIRED_HEADERS.filter((header) => !normalizedHeaders.has(header));
    return { rows, warnings, missingHeaders };
}

function detectRegions(rows: ReaperMarkerRow[]) {
    const regionRows = rows.filter(isRegionRow);
    return { regions: parseRegions(regionRows), regionCount: regionRows.length };
}

function groupMarkers(rows: ReaperMarkerRow[], regions: ParsedRegion[]) {
    const normalizedMarkers = normalizeMarkerRows(rows.filter((row) => !isRegionRow(row)));
    const assignedMarkers = assignMarkersToRegions(normalizedMarkers, regions);
    const analysisMarkers = assignedMarkers.map(createAnalysisMarker);
    const markersByRegionId = new Map<string, ReaperAnalysisMarker[]>();
    const globalMarkers: ReaperAnalysisMarker[] = [];

    for (const marker of analysisMarkers) {
        const regionId = marker.regionId;
        if (!regionId) {
            globalMarkers.push(marker);
            continue;
        }
        const groupedMarkers = markersByRegionId.get(regionId) ?? [];
        groupedMarkers.push(marker);
        markersByRegionId.set(regionId, groupedMarkers);
    }

    return { analysisMarkers, markersByRegionId, globalMarkers };
}

function createAnalysis(
    parsed: ReturnType<typeof validateCsv>,
    detected: ReturnType<typeof detectRegions>,
    grouped: ReturnType<typeof groupMarkers>,
): ReaperCsvAnalysis {
    const analysisRegions: ReaperAnalysisRegion[] = detected.regions.map((region) => ({
        id: region.regionId,
        label: region.regionLabel || region.regionId,
        start: region.start,
        end: region.end,
        startSeconds: region.startValue,
        endSeconds: region.endValue,
        color: region.color,
        isSynthetic: false,
        markers: grouped.markersByRegionId.get(region.regionId) ?? [],
    }));
    const globalMarkers = [...grouped.globalMarkers];

    if (analysisRegions.length === 0) {
        const duration = calculateSourceDuration(grouped.analysisMarkers, []);
        analysisRegions.push({
            id: "default",
            label: "Default",
            start: "0",
            end: String(duration),
            startSeconds: 0,
            endSeconds: duration,
            color: "",
            isSynthetic: true,
            markers: globalMarkers.splice(0),
        });
    }

    return {
        rowCount: parsed.rows.length,
        markerCount: grouped.analysisMarkers.length,
        regionCount: detected.regions.length,
        durationSeconds: calculateSourceDuration(grouped.analysisMarkers, analysisRegions),
        recommendedImportMode: detected.regions.length > 0 ? "regions-and-markers" : "markers-only",
        regions: analysisRegions,
        globalMarkers,
        diagnostics: createAnalysisDiagnostics(parsed.warnings, parsed.missingHeaders),
        warnings: parsed.warnings,
    };
}

function createAnalysisMarker(marker: ConvertedMarker, index: number): ReaperAnalysisMarker {
    const startSeconds = Number.parseFloat(marker.start);
    const regionId = marker.regionId ?? marker.regionContextId;
    return {
        id: `marker-${index + 1}`,
        name: marker.displayName || `Marker ${index + 1}`,
        start: marker.start,
        startSeconds: Number.isFinite(startSeconds) ? startSeconds : 0,
        color: marker.color,
        ...(regionId ? { regionId } : {}),
    };
}

function calculateSourceDuration(markers: ReaperAnalysisMarker[], regions: ReaperAnalysisRegion[]): number {
    return Math.max(0, ...markers.map((marker) => marker.startSeconds), ...regions.map((region) => region.endSeconds));
}

function createAnalysisDiagnostics(warnings: string[], missingHeaders: readonly string[]): ConversionDiagnostic[] {
    const diagnostics: ConversionDiagnostic[] = [];
    if (missingHeaders.length > 0) {
        diagnostics.push({
            code: "csv.missing-headers",
            severity: "error",
            params: { headers: missingHeaders.join(", ") },
            message: warnings.find((warning) => warning.includes("missing")) ?? `Missing CSV headers: ${missingHeaders.join(", ")}`,
        });
    }
    for (const warning of warnings) {
        if (missingHeaders.length > 0 && warning.includes("missing")) continue;
        diagnostics.push({
            code: warning.includes("seconds") ? "csv.invalid-timestamp" : "conversion.warning",
            severity: "warning",
            message: warning,
        });
    }
    return diagnostics;
}

function yieldToBrowser(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
