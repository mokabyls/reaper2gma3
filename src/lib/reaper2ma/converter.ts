import { createAppearanceNameFromReaperColor, convertReaperColorToGrandmaAppearanceColor } from "./colors.js";
import { attachCuePartMarkers, splitCuePartMarkers } from "./cue-parts.js";
import { validateReaperCsvRows } from "./csv-validation.js";
import { assignMarkersToRegions, buildRegionSequences, parseRegions, type ParsedRegion } from "./region-services.js";
import type {
    AppearanceReference,
    BpmSequenceSource,
    ConversionArtifacts,
    ConversionDiagnostic,
    ConversionSettings,
    ConvertedMarker,
    ReaperCsvConversionRequest,
    ReaperRegionRow,
} from "./types.js";
import { buildOutputFileName, createProjectOutputBaseName, normalizeOutputBaseName, sanitizeGrandmaObjectName } from "./filename.js";
import {
    createBpmSequence,
    groupBumpSequences,
    groupRepeatedSequences,
    normalizeMarkerRows,
    parseReaperMarkerCsv,
    isRegionRow,
    splitMarkerRows,
} from "./markers.js";
import { applySequenceNamePrefix } from "./sequence-services.js";
import { generateMacroXML } from "./xml.js";

export function convertReaperMarkersToArtifacts(
    normalizedMarkers: ConvertedMarker[],
    sourceFileName: string,
    settings: ConversionSettings,
): ConversionArtifacts {
    const outputBaseName = normalizeOutputBaseName(sourceFileName);
    return convertMarkersAndRegionsToArtifacts(normalizedMarkers, [], outputBaseName, outputBaseName, settings, []);
}

export function convertReaperCsvToArtifacts(request: ReaperCsvConversionRequest): ConversionArtifacts;
export function convertReaperCsvToArtifacts(dataString: string, sourceFileName: string, settings: ConversionSettings): ConversionArtifacts;
export function convertReaperCsvToArtifacts(
    requestOrDataString: ReaperCsvConversionRequest | string,
    legacySourceFileName?: string,
    legacySettings?: ConversionSettings,
): ConversionArtifacts {
    const request = resolveConversionRequest(requestOrDataString, legacySourceFileName, legacySettings);
    const { csvText: dataString, sourceFileName, settings } = request;
    const { headers, rows } = parseReaperMarkerCsv(dataString);
    const validationWarnings = validateReaperCsvRows(headers, rows);
    const regionRows = settings.importMode === "regions-and-markers" ? rows.filter(isRegionRow) : [];
    const markerRows = rows.filter((row) => !isRegionRow(row));
    const normalizedMarkers = normalizeMarkerRows(markerRows);
    const outputBaseName = request.identity
        ? request.identity.outputBaseName?.trim() || createProjectOutputBaseName(request.identity.projectName)
        : normalizeOutputBaseName(sourceFileName);
    const grandmaName = request.identity
        ? sanitizeGrandmaObjectName(request.identity.timecodeName, outputBaseName)
        : outputBaseName;

    return convertMarkersAndRegionsToArtifacts(normalizedMarkers, regionRows, outputBaseName, grandmaName, settings, validationWarnings);
}

export function createConversionOutputFiles(artifacts: ConversionArtifacts) {
    return [
        {
            name: buildOutputFileName(artifacts.outputBaseName, "macro"),
            content: artifacts.macroXml,
        },
    ];
}

function convertMarkersAndRegionsToArtifacts(
    normalizedMarkers: ConvertedMarker[],
    regionRows: ReaperRegionRow[],
    outputBaseName: string,
    grandmaName: string,
    settings: ConversionSettings,
    validationWarnings: string[],
): ConversionArtifacts {
    const appearanceRegistry = createAppearanceRegistry(settings.appearanceStartNumber);

    if (settings.importMode === "regions-and-markers" && regionRows.length > 0) {
        return convertHybridArtifacts(normalizedMarkers, regionRows, outputBaseName, grandmaName, settings, appearanceRegistry, validationWarnings);
    }

    return convertMarkersOnlyArtifacts(normalizedMarkers, outputBaseName, grandmaName, settings, appearanceRegistry, validationWarnings);
}

function convertMarkersOnlyArtifacts(
    normalizedMarkers: ConvertedMarker[],
    outputBaseName: string,
    grandmaName: string,
    settings: ConversionSettings,
    appearanceRegistry: ReturnType<typeof createAppearanceRegistry>,
    validationWarnings: string[],
): ConversionArtifacts {
    const { contentMarkers } = splitCuePartMarkers(normalizedMarkers);
    const { uniqueCues, repeatedMarkers, bumpMarkers } = splitMarkerRows(contentMarkers);
    const repeatedSequences = groupRepeatedSequences(
        repeatedMarkers,
        settings.prefix,
        settings.sequenceNumber,
        appearanceRegistry.nextAppearanceNumber(),
        appearanceRegistry.resolveAppearance,
    );
    const repeatedSequenceNamesByColor = new Map(repeatedSequences.map((sequence) => [sequence.color, sequence.displayName]));
    const bumpSequences = groupBumpSequences(
        bumpMarkers,
        settings.sequenceNumber + repeatedSequences.length,
        settings.prefix,
        repeatedSequenceNamesByColor,
        appearanceRegistry.resolveAppearance,
    );
    const bumpReleaseWarnings = collectBumpReleaseWarnings(bumpSequences);
    const regionLayerWarnings = collectRegionLayerWarnings(contentMarkers, []);
    const cuePartWarnings = attachCuePartMarkers(
        normalizedMarkers,
        uniqueCues,
        [],
        [],
        repeatedSequences,
        bumpSequences,
        settings.importMode ?? "markers-only",
    );
    const bpmSources = collectBpmMarkerSources(contentMarkers);
    const bpmSequence = createBpmSequence(bpmSources, settings.sequenceNumber, repeatedSequences.length + bumpSequences.length);
    const prefixed = prefixGeneratedSequences(settings.sequenceNamePrefix, [], [], repeatedSequences, bumpSequences, bpmSequence);
    const macroXml = generateMacroXML(
        settings,
        uniqueCues,
        prefixed.regionSequences,
        prefixed.regionLayerSequences,
        prefixed.repeatedSequences,
        prefixed.bumpSequences,
        prefixed.bpmSequence,
        grandmaName,
    );

    const allWarnings = [...validationWarnings, ...regionLayerWarnings, ...cuePartWarnings, ...bumpReleaseWarnings];

    return {
        importMode: settings.importMode ?? "markers-only",
        outputBaseName,
        grandmaName,
        validationWarnings: allWarnings,
        diagnostics: createLegacyDiagnostics(allWarnings),
        regionSequences: prefixed.regionSequences,
        regionLayerSequences: prefixed.regionLayerSequences,
        uniqueCues,
        repeatedSequences: prefixed.repeatedSequences,
        bumpSequences: prefixed.bumpSequences,
        bpmSequence: prefixed.bpmSequence,
        macroXml,
    };
}

function convertHybridArtifacts(
    normalizedMarkers: ConvertedMarker[],
    regionRows: ReaperRegionRow[],
    outputBaseName: string,
    grandmaName: string,
    settings: ConversionSettings,
    appearanceRegistry: ReturnType<typeof createAppearanceRegistry>,
    validationWarnings: string[],
): ConversionArtifacts {
    const regions = parseRegions(regionRows);
    const markersWithRegions = assignMarkersToRegions(normalizedMarkers, regions);
    const { contentMarkers } = splitCuePartMarkers(markersWithRegions);
    const outsideRegionMarkers = contentMarkers.filter((marker) => !marker.regionId);
    const {
        regionSequences,
        regionLayerSequences,
        nextSequenceNumber: nextSequenceAfterRegionsAndLayers,
    } = buildRegionSequences(
        contentMarkers,
        regions,
        settings.sequenceNumber,
        appearanceRegistry.resolveAppearance,
        settings.regionEndPreRollMs,
        settings.regionLayerPreRollEnabled,
        settings.regionLayerPreRollMs,
    );
    const { uniqueCues, repeatedMarkers, bumpMarkers } = splitMarkerRows(outsideRegionMarkers);
    const repeatedSequences = groupRepeatedSequences(
        repeatedMarkers,
        settings.prefix,
        nextSequenceAfterRegionsAndLayers,
        appearanceRegistry.nextAppearanceNumber(),
        appearanceRegistry.resolveAppearance,
    );
    const repeatedSequenceNamesByColor = new Map(repeatedSequences.map((sequence) => [sequence.color, sequence.displayName]));
    const bumpSequences = groupBumpSequences(
        bumpMarkers,
        nextSequenceAfterRegionsAndLayers + repeatedSequences.length,
        settings.prefix,
        repeatedSequenceNamesByColor,
        appearanceRegistry.resolveAppearance,
    );
    const bumpReleaseWarnings = collectBumpReleaseWarnings(bumpSequences);
    const regionLayerWarnings = collectRegionLayerWarnings(contentMarkers, regionLayerSequences);
    const cuePartWarnings = attachCuePartMarkers(
        markersWithRegions,
        uniqueCues,
        regionSequences,
        regionLayerSequences,
        repeatedSequences,
        bumpSequences,
        settings.importMode ?? "regions-and-markers",
    );
    const bpmSources = [...collectRegionBpmSources(regions), ...collectBpmMarkerSources(contentMarkers)];
    const bpmSequence = createBpmSequence(
        bpmSources,
        settings.sequenceNumber,
        regionSequences.length + regionLayerSequences.length + repeatedSequences.length + bumpSequences.length,
    );
    const prefixed = prefixGeneratedSequences(
        settings.sequenceNamePrefix,
        regionSequences,
        regionLayerSequences,
        repeatedSequences,
        bumpSequences,
        bpmSequence,
    );
    const macroXml = generateMacroXML(
        settings,
        uniqueCues,
        prefixed.regionSequences,
        prefixed.regionLayerSequences,
        prefixed.repeatedSequences,
        prefixed.bumpSequences,
        prefixed.bpmSequence,
        grandmaName,
    );

    const allWarnings = [...validationWarnings, ...regionLayerWarnings, ...cuePartWarnings, ...bumpReleaseWarnings];

    return {
        importMode: settings.importMode ?? "regions-and-markers",
        outputBaseName,
        grandmaName,
        validationWarnings: allWarnings,
        diagnostics: createLegacyDiagnostics(allWarnings),
        regionSequences: prefixed.regionSequences,
        regionLayerSequences: prefixed.regionLayerSequences,
        uniqueCues,
        repeatedSequences: prefixed.repeatedSequences,
        bumpSequences: prefixed.bumpSequences,
        bpmSequence: prefixed.bpmSequence,
        macroXml,
    };
}

function resolveConversionRequest(
    requestOrDataString: ReaperCsvConversionRequest | string,
    legacySourceFileName: string | undefined,
    legacySettings: ConversionSettings | undefined,
): Omit<ReaperCsvConversionRequest, "identity"> & { identity?: ReaperCsvConversionRequest["identity"] } {
    if (typeof requestOrDataString !== "string") {
        return requestOrDataString;
    }

    if (!legacySourceFileName || !legacySettings) {
        throw new TypeError("Legacy conversion requires CSV text, source filename and settings.");
    }

    return {
        csvText: requestOrDataString,
        sourceFileName: legacySourceFileName,
        settings: legacySettings,
    };
}

function createLegacyDiagnostics(warnings: string[]): ConversionDiagnostic[] {
    return warnings.map((message) => ({
        code: message.includes("seconds") ? "csv.invalid-timestamp" : "conversion.warning",
        severity: "warning",
        message,
    }));
}

function collectBumpReleaseWarnings(bumpSequences: ConversionArtifacts["bumpSequences"]): string[] {
    return bumpSequences.flatMap((sequence) => sequence.releaseWarnings ?? []);
}

function collectBpmMarkerSources(markers: ConvertedMarker[]): BpmSequenceSource[] {
    return markers.flatMap((marker): BpmSequenceSource[] =>
        marker.bpm !== undefined && marker.bpmText !== undefined
            ? [
                  {
                      displayName: marker.displayName,
                      start: marker.start,
                      bpm: marker.bpm,
                      bpmText: marker.bpmText,
                  },
              ]
            : [],
    );
}

function collectRegionBpmSources(regions: ParsedRegion[]): BpmSequenceSource[] {
    return regions.flatMap((region): BpmSequenceSource[] =>
        region.bpm !== undefined && region.bpmText !== undefined
            ? [
                  {
                      displayName: region.regionLabel,
                      start: region.start,
                      bpm: region.bpm,
                      bpmText: region.bpmText,
                  },
              ]
            : [],
    );
}

function collectRegionLayerWarnings(markers: ConvertedMarker[], regionLayerSequences: ConversionArtifacts["regionLayerSequences"]): string[] {
    const warnings: string[] = [];
    const layerNamesByRegionId = new Map<string, Set<string>>();

    for (const sequence of regionLayerSequences) {
        const layerNames = layerNamesByRegionId.get(sequence.regionId) ?? new Set<string>();
        layerNames.add(sequence.layerName);
        layerNamesByRegionId.set(sequence.regionId, layerNames);
    }

    for (const marker of markers) {
        if (marker.regionLayerName && !marker.regionId) {
            warnings.push(
                `Layer marker "${marker.displayName || "Cue"}" uses [LAYER=${marker.regionLayerName}] without a target region. It is handled as a normal marker.`,
            );
        }

        for (const action of marker.regionLayerActions ?? []) {
            const actionTag = formatRegionLayerActionTag(action);

            if (!action.regionId) {
                warnings.push(
                    `Layer off marker "${marker.displayName || "Cue"}" uses ${actionTag} without a target region. No layer Off event will be generated.`,
                );
                continue;
            }

            const layerNames = layerNamesByRegionId.get(action.regionId) ?? new Set<string>();

            if (action.scope === "layer" && !layerNames.has(action.layerName)) {
                warnings.push(
                    `Layer off marker "${marker.displayName || "Cue"}" targets ${actionTag} for ${action.regionId}, but that layer sequence does not exist.`,
                );
            }

            if (action.scope === "all" && layerNames.size === 0) {
                warnings.push(
                    `Layer off marker "${marker.displayName || "Cue"}" targets [OFF_LAYERS] for ${action.regionId}, but that region has no layer sequences.`,
                );
            }
        }
    }

    return warnings;
}

function formatRegionLayerActionTag(action: NonNullable<ConvertedMarker["regionLayerActions"]>[number]): string {
    return action.scope === "layer" ? `[OFF_LAYER=${action.layerName}]` : "[OFF_LAYERS]";
}

function prefixGeneratedSequences(
    sequenceNamePrefix: string,
    regionSequences: ConversionArtifacts["regionSequences"],
    regionLayerSequences: ConversionArtifacts["regionLayerSequences"],
    repeatedSequences: ConversionArtifacts["repeatedSequences"],
    bumpSequences: ConversionArtifacts["bumpSequences"],
    bpmSequence: ConversionArtifacts["bpmSequence"],
): Pick<ConversionArtifacts, "regionSequences" | "regionLayerSequences" | "repeatedSequences" | "bumpSequences" | "bpmSequence"> {
    const prefix = sequenceNamePrefix.trim();

    if (!prefix) {
        return {
            regionSequences,
            regionLayerSequences,
            repeatedSequences,
            bumpSequences,
            bpmSequence,
        };
    }

    return {
        regionSequences: regionSequences.map((sequence) => ({
            ...sequence,
            displayName: applySequenceNamePrefix(sequence.displayName, prefix),
        })),
        regionLayerSequences: regionLayerSequences.map((sequence) => ({
            ...sequence,
            displayName: applySequenceNamePrefix(sequence.displayName, prefix),
        })),
        repeatedSequences: repeatedSequences.map((sequence) => ({
            ...sequence,
            displayName: applySequenceNamePrefix(sequence.displayName, prefix),
        })),
        bumpSequences: bumpSequences.map((sequence) => ({
            ...sequence,
            displayName: applySequenceNamePrefix(sequence.displayName, prefix),
        })),
        bpmSequence: bpmSequence
            ? {
                  ...bpmSequence,
                  displayName: applySequenceNamePrefix(bpmSequence.displayName, prefix),
              }
            : bpmSequence,
    };
}

function createAppearanceRegistry(startNumber: number) {
    const appearancesByColor = new Map<string, AppearanceReference>();
    let nextAppearanceNumber = startNumber;

    return {
        resolveAppearance(color: string): AppearanceReference | undefined {
            const trimmedColor = color.trim();

            if (!trimmedColor) {
                return undefined;
            }

            const existing = appearancesByColor.get(trimmedColor);

            if (existing) {
                return existing;
            }

            const appearanceColor = convertReaperColorToGrandmaAppearanceColor(trimmedColor);

            if (!appearanceColor) {
                return undefined;
            }

            const appearanceReference: AppearanceReference = {
                appearanceName: createAppearanceNameFromReaperColor(trimmedColor),
                appearanceNumber: nextAppearanceNumber++,
                appearanceColor,
            };

            appearancesByColor.set(trimmedColor, appearanceReference);

            return appearanceReference;
        },
        nextAppearanceNumber(): number {
            return nextAppearanceNumber;
        },
    };
}
