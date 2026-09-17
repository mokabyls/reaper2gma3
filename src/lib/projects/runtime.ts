import {
    convertReaperCsvToArtifacts,
    createExecutorAssignmentPreview,
    createConversionPreview,
    createExportBundleFiles,
    createTimelinePreview,
    createTimestampedZipFileName,
    createZipArchiveBlob,
    downloadBlob,
} from "../reaper2ma/index.js";
import type { ProjectDocumentV1, ProjectSourceV1 } from "./types.js";

export function createProjectRuntime(project: ProjectDocumentV1, source: ProjectSourceV1) {
    const artifacts = convertReaperCsvToArtifacts({
        csvText: source.csvText,
        sourceFileName: source.fileName,
        settings: project.settings,
        identity: {
            projectName: project.projectName,
            timecodeName: project.timecodeName,
        },
    });
    const preview = createConversionPreview(artifacts, project.analysis?.markerCount ?? 0);
    const executorAssignments = createExecutorAssignmentPreview(artifacts, project.settings);
    const timeline = createTimelinePreview(artifacts, project.settings);
    const files = createExportBundleFiles({
        conversionArtifacts: artifacts,
        sourceFileName: source.fileName,
        timecodeName: project.timecodeName,
        macroPresetSelection: {
            showTime: project.settings.exportShowTimeMacros,
            timecodeControl: project.settings.exportTimecodeControlMacros,
        },
        grandmaVersion: project.settings.grandmaVersion,
        externalTimecodeSlot: project.settings.externalTimecodeSlot,
        includeReaperTransportMacros: project.settings.includeReaperTransportMacros,
        transportMacroOptions: {
            oscSlotId: project.settings.transportOscSlotId,
            oscDataName: project.settings.transportOscDataName,
            macroNamePrefix: project.settings.transportMacroNamePrefix,
            outputFileName: project.settings.transportOutputFileName,
        },
    });

    return { artifacts, preview, executorAssignments, timeline, files };
}

export function downloadProjectZip(project: ProjectDocumentV1, source: ProjectSourceV1): string {
    const runtime = createProjectRuntime(project, source);
    const exportedAt = new Date();
    const fileName = createTimestampedZipFileName(runtime.artifacts.outputBaseName, exportedAt);
    downloadBlob(createZipArchiveBlob(runtime.files, exportedAt), fileName);
    return fileName;
}
