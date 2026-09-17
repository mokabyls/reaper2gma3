import { buildOutputFileName } from "./filename.js";
import { calculateTimecodeDuration, collectTimecodeTimestamps } from "./timecode-duration.js";
import type { ConversionArtifacts, ConversionDiagnostic } from "./types.js";

export type ConversionPreview = {
    importMode: string;
    sourceMarkerCount: number;
    regionCount: number;
    regionMarkerCount: number;
    regionLayerSequenceCount: number;
    uniqueCueCount: number;
    repeatedSequenceCount: number;
    bumpSequenceCount: number;
    bpmEventCount: number;
    appearanceCount: number;
    duration: string;
    generatedSequenceNames: string[];
    outputFileNames: string[];
    warnings: string[];
    diagnostics: ConversionDiagnostic[];
};

export function createConversionPreview(artifacts: ConversionArtifacts, sourceMarkerCount: number): ConversionPreview {
    const timestamps = collectTimecodeTimestamps(
        artifacts.uniqueCues,
        artifacts.regionSequences,
        artifacts.regionLayerSequences,
        artifacts.repeatedSequences,
        artifacts.bumpSequences,
        artifacts.bpmSequence,
    );
    const generatedSequenceNames = [
        ...artifacts.regionSequences.flatMap((sequence) => [
            sequence.displayName,
            ...artifacts.regionLayerSequences
                .filter((layerSequence) => layerSequence.regionId === sequence.regionId)
                .map((layerSequence) => layerSequence.displayName),
        ]),
        ...artifacts.repeatedSequences.map((sequence) => sequence.displayName),
        ...artifacts.bumpSequences.map((sequence) => sequence.displayName),
        ...(artifacts.bpmSequence ? [artifacts.bpmSequence.displayName] : []),
    ];
    const appearanceCount = collectAppearanceNumbers(artifacts).size;
    const warnings: string[] = [...(artifacts.validationWarnings ?? [])];
    const diagnostics: ConversionDiagnostic[] = [...(artifacts.diagnostics ?? [])];

    if (artifacts.uniqueCues.length === 0) {
        const message = "The main sequence is empty: no cues will be created in the base sequence.";
        warnings.push(message);
        diagnostics.push({ code: "conversion.empty-main-sequence", severity: "warning", message });
    }

    if (artifacts.importMode === "regions-and-markers" && artifacts.regionSequences.length === 0) {
        const message = "Regions + markers mode is selected, but no valid region was found in the CSV.";
        warnings.push(message);
        diagnostics.push({ code: "conversion.no-regions", severity: "warning", message });
    }

    if (sourceMarkerCount === 0) {
        const message = "No markers were found in the CSV.";
        warnings.push(message);
        diagnostics.push({ code: "conversion.no-markers", severity: "warning", message });
    }

    return {
        importMode: artifacts.importMode,
        sourceMarkerCount,
        regionCount: artifacts.regionSequences.length,
        regionMarkerCount: artifacts.regionSequences.reduce((total, sequence) => total + sequence.events.length, 0),
        regionLayerSequenceCount: artifacts.regionLayerSequences.length,
        uniqueCueCount: artifacts.uniqueCues.length,
        repeatedSequenceCount: artifacts.repeatedSequences.length,
        bumpSequenceCount: artifacts.bumpSequences.length,
        bpmEventCount: artifacts.bpmSequence?.events.length ?? 0,
        appearanceCount,
        duration: calculateTimecodeDuration(timestamps),
        generatedSequenceNames,
        outputFileNames: [buildOutputFileName(artifacts.outputBaseName, "macro")],
        warnings,
        diagnostics,
    };
}

function collectAppearanceNumbers(artifacts: ConversionArtifacts): Set<number> {
    const appearanceNumbers = new Set<number>();

    for (const regionSequence of artifacts.regionSequences) {
        if (regionSequence.appearanceNumber !== undefined) {
            appearanceNumbers.add(regionSequence.appearanceNumber);
        }

        for (const cue of regionSequence.cues) {
            if (cue.appearanceNumber !== undefined) {
                appearanceNumbers.add(cue.appearanceNumber);
            }
        }
    }

    for (const regionLayerSequence of artifacts.regionLayerSequences) {
        if (regionLayerSequence.appearanceNumber !== undefined) {
            appearanceNumbers.add(regionLayerSequence.appearanceNumber);
        }

        for (const cue of regionLayerSequence.cues) {
            if (cue.appearanceNumber !== undefined) {
                appearanceNumbers.add(cue.appearanceNumber);
            }
        }
    }

    for (const repeatedSequence of artifacts.repeatedSequences) {
        if (repeatedSequence.appearanceNumber !== undefined) {
            appearanceNumbers.add(repeatedSequence.appearanceNumber);
        }
    }

    for (const bumpSequence of artifacts.bumpSequences) {
        if (bumpSequence.appearanceNumber !== undefined) {
            appearanceNumbers.add(bumpSequence.appearanceNumber);
        }

        for (const cue of bumpSequence.cues) {
            if (cue.appearanceNumber !== undefined) {
                appearanceNumbers.add(cue.appearanceNumber);
            }
        }
    }

    return appearanceNumbers;
}
