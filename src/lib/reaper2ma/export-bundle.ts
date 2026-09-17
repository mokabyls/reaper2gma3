import { createConversionOutputFiles } from "./converter.js";
import { createExampleMacroPresetOutputFiles } from "./macro-presets.js";
import { createReaperTransportMacroOutputFile } from "./transport-macros.js";
import type { ConversionArtifacts, ExampleMacroPresetSelection, GrandmaVersionProfile } from "./types.js";
import type { ReaperMacroGeneratorOptions } from "./transport-macros.js";
import type { ZipTextFile } from "./zip.js";

export type ExportBundleOptions = {
    conversionArtifacts: ConversionArtifacts;
    sourceFileName: string;
    timecodeName: string;
    macroPresetSelection: ExampleMacroPresetSelection;
    grandmaVersion?: GrandmaVersionProfile;
    externalTimecodeSlot?: number;
    includeReaperTransportMacros: boolean;
    transportMacroOptions?: ReaperMacroGeneratorOptions;
};

export function createExportBundleFiles(options: ExportBundleOptions): ZipTextFile[] {
    const files: ZipTextFile[] = [
        ...createConversionOutputFiles(options.conversionArtifacts).map(({ name, content }) => ({
            name,
            content,
        })),
        ...createExampleMacroPresetOutputFiles({
            sourceFileName: options.sourceFileName,
            timecodeName: options.timecodeName,
            selection: options.macroPresetSelection,
            grandmaVersion: options.grandmaVersion,
            externalTimecodeSlot: options.externalTimecodeSlot,
        }).map(({ name, content }) => ({
            name,
            content,
        })),
    ];

    if (options.includeReaperTransportMacros) {
        const transportFile = createReaperTransportMacroOutputFile(options.transportMacroOptions);
        files.push({
            name: transportFile.name,
            content: transportFile.content,
        });
    }

    return files;
}

export function createExportBundleFileNames(options: ExportBundleOptions): string[] {
    return createExportBundleFiles(options).map((file) => file.name);
}
