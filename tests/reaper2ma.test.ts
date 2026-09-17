import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { XMLParser } from "fast-xml-parser";

import { convertReaperCsvToArtifacts, createConversionOutputFiles } from "../src/lib/reaper2ma/converter.js";
import {
    convertReaperColorToCssColor,
    convertReaperColorToGrandmaAppearanceColor,
    createInheritedRegionBumpColor,
    createInheritedRegionLayerColor,
} from "../src/lib/reaper2ma/colors.js";
import { createExportBundleFiles } from "../src/lib/reaper2ma/export-bundle.js";
import { createExecutorAssignmentPreview, findExecutorAddressConflicts } from "../src/lib/reaper2ma/executor-plan.js";
import { createSequenceMoves, findSequenceNumberConflicts } from "../src/lib/reaper2ma/sequence-numbering.js";
import { buildOutputFileName, normalizeOutputBaseName } from "../src/lib/reaper2ma/filename.js";
import { createExampleMacroPresetOutputFiles, resolveExampleMacroTimecodeName } from "../src/lib/reaper2ma/macro-presets.js";
import { createConversionPreview } from "../src/lib/reaper2ma/preview.js";
import { resolveSpeedMaster } from "../src/lib/reaper2ma/settings.js";
import { MAX_TIMECODE_OFFSET_MS, formatEffectiveTimecode, formatTimecodeOffset, formatTimecodeOffsetSeconds, parseTimecodeOffset } from "../src/lib/reaper2ma/timecode-offset.js";
import { createTimelinePreview } from "../src/lib/reaper2ma/timeline-preview.js";
import { analyzeReaperCsv, analyzeReaperCsvProgressively, type ReaperAnalysisPhase } from "../src/lib/reaper2ma/analysis.js";
import { createProjectOutputBaseName } from "../src/lib/reaper2ma/filename.js";
import { createReaperTransportMacroOutputFile, generateReaperTransportMacros } from "../src/lib/reaper2ma/transport-macros.js";
import { bpmTagProvider } from "../src/lib/reaper2ma/providers/bpm.js";
import { cueFadeTagProvider } from "../src/lib/reaper2ma/providers/cue-fade.js";
import { createDefaultMarkerTagProviderRegistry } from "../src/lib/reaper2ma/providers/registry.js";
import { delayFromTagProvider } from "../src/lib/reaper2ma/providers/delay-from.js";
import { delayToTagProvider } from "../src/lib/reaper2ma/providers/delay-to.js";
import { fadeFromTagProvider } from "../src/lib/reaper2ma/providers/fade-from.js";
import { fadeToTagProvider } from "../src/lib/reaper2ma/providers/fade-to.js";
import { groupBumpSequences, groupRepeatedSequences, normalizeMarkerRows, parseMarkerExecution, parseMarkerName, parseReaperMarkerRows, sanitizeMarkerName, splitMarkerRows } from "../src/lib/reaper2ma/markers.js";
import type { ConversionSettings } from "../src/lib/reaper2ma/types.js";
import { createTimestampedZipFileName, createZipArchiveBytes } from "../src/lib/reaper2ma/zip.js";

const baseSettings: ConversionSettings = {
    sequenceNumber: 9001,
    appearanceStartNumber: 9001,
    sequenceNamePrefix: "MA",
    timecodeNumber: 1,
    pageNumber: 1,
    pageSlotStart: 201,
    bumpPageSlotStart: 101,
    assignExecutors: true,
    cueStartNumber: 1,
    regionEndPreRollMs: 750,
    autoOffRegionLayers: true,
    regionLayerPreRollEnabled: true,
    regionLayerPreRollMs: 750,
    speedMaster: "3.4",
    prefix: "1",
    exportMode: "cues-and-timecode",
};

const fixtureCsv = readFileSync(new URL("../../tests/fixtures/basic.csv", import.meta.url), "utf8");
const regionFixtureCsv = readFileSync(new URL("../../demo/regions-markers-demo.csv", import.meta.url), "utf8");
const transportMacroFixture = readFileSync(new URL("../../tests/fixtures/reaper-transport-macros.default.xml", import.meta.url), "utf8");
const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: false,
    parseTagValue: false,
    parseAttributeValue: false,
});

function parseXml(xml: string) {
    return xmlParser.parse(xml);
}

function asArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined) {
        return [];
    }

    return Array.isArray(value) ? value : [value];
}

function getMacroCommands(xml: string): string[] {
    const parsed = parseXml(xml);
    return asArray<any>(parsed.GMA3.Macro.MacroLine).map((line) => line["@_Command"]);
}

function getTimecodeTrackCommands(commands: string[], tempDataPoolName: string, sequenceIndex: number): string[] {
    const assignPattern = new RegExp(`^Assign DataPool "${tempDataPoolName}" Sequence ${sequenceIndex} At \\d+$`);
    const startIndex = commands.findIndex((command) => assignPattern.test(command));

    assert.notEqual(startIndex, -1);

    const nextAssignIndex = commands.findIndex((command, index) => index > startIndex && /^Assign DataPool ".*" Sequence \d+ At \d+$/.test(command));

    return commands.slice(startIndex, nextAssignIndex === -1 ? undefined : nextAssignIndex);
}

describe("native grandMA3 timecode offset", () => {
    it("parses and formats signed offsets with millisecond precision", () => {
        assert.equal(parseTimecodeOffset("00:00:00"), 0);
        assert.equal(parseTimecodeOffset("+01:00:00.000"), 3_600_000);
        assert.equal(parseTimecodeOffset("-00:00:00.500"), -500);
        assert.equal(parseTimecodeOffset("12:34:56.7"), 45_296_700);
        assert.equal(parseTimecodeOffset("+255:59:58.960"), MAX_TIMECODE_OFFSET_MS);
        assert.equal(parseTimecodeOffset("-255:59:58.960"), -MAX_TIMECODE_OFFSET_MS);
        assert.equal(formatTimecodeOffset(undefined), "00:00:00.000");
        assert.equal(formatTimecodeOffset(3_600_000), "+01:00:00.000");
        assert.equal(formatTimecodeOffset(-500), "-00:00:00.500");
        assert.equal(formatTimecodeOffsetSeconds(3_600_000), "3600");
        assert.equal(formatTimecodeOffsetSeconds(-500), "-0.5");
        assert.equal(formatEffectiveTimecode(3_660_000), "01:01:00.000");
    });

    it("rejects malformed and out-of-range offsets", () => {
        for (const value of ["", "1:00", "1:00:00", "01:60:00", "01:00:60", "01:00:00.0000", "256:00:00", "+255:59:58.961", "timecode"]) {
            assert.equal(parseTimecodeOffset(value), undefined, value);
        }
    });
});

function readUint32(bytes: Uint8Array, offset: number): number {
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function parseZipLocalEntries(bytes: Uint8Array): Map<string, string> {
    const decoder = new TextDecoder();
    const entries = new Map<string, string>();
    let offset = 0;

    while (readUint32(bytes, offset) === 0x04034b50) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 30);
        const compressedSize = view.getUint32(18, true);
        const fileNameLength = view.getUint16(26, true);
        const extraLength = view.getUint16(28, true);
        const fileNameStart = offset + 30;
        const contentStart = fileNameStart + fileNameLength + extraLength;
        const fileName = decoder.decode(bytes.slice(fileNameStart, fileNameStart + fileNameLength));
        const content = decoder.decode(bytes.slice(contentStart, contentStart + compressedSize));

        entries.set(fileName, content);
        offset = contentStart + compressedSize;
    }

    assert.equal(readUint32(bytes, offset), 0x02014b50);
    assert.equal(readUint32(bytes, bytes.length - 22), 0x06054b50);

    return entries;
}

describe("marker normalization", () => {
    it("preserves allowed marker characters and removes unsupported ones", () => {
        assert.equal(sanitizeMarkerName('Crash! "Main" / Intro'), "Crash Main / Intro");
        assert.equal(sanitizeMarkerName("Début Récit / Montée façade Œuvre Übergröße"), "Début Récit / Montée façade Œuvre Übergröße");
        assert.equal(sanitizeMarkerName("De\u0301but Récit"), "Début Récit");
    });

    it("extracts a final bracketed execution token when present", () => {
        assert.deepEqual(parseMarkerExecution("Intro [Temp|Flash]"), {
            displayName: "Intro",
            execToken: "Temp|Flash",
        });
        assert.deepEqual(parseMarkerExecution("Intro [Temp | Flash]"), {
            displayName: "Intro",
            execToken: "Temp|Flash",
        });
        assert.deepEqual(parseMarkerExecution("Intro [Boom]"), {
            displayName: "Intro",
            execToken: "Go+",
        });
    });

    it("parses leading metadata tags and trailing execution tokens together", () => {
        assert.deepEqual(parseMarkerName("[PART|CueFade_0.2|FadeFromX_0.1] Dimmer Off"), {
            displayName: "Dimmer Off",
            execToken: "Go+",
            tags: [
                { key: "PART", value: null },
                { key: "CUEFADE", value: "0.2" },
                { key: "FADEFROMX", value: "0.1" },
            ],
            isCuePart: true,
            cueTiming: [{ key: "FadeFromX", value: "0.1" }],
            cueFade: "0.2",
        });
        assert.deepEqual(parseMarkerName("[BPM_129.5|X_foo|Temp] Intro"), {
            displayName: "Intro",
            execToken: "Temp",
            tags: [
                { key: "BPM", value: "129.5" },
                { key: "X", value: "foo" },
            ],
            bumpAction: {
                kind: "Temp",
                phase: "start",
            },
            bpm: 129.5,
            bpmText: "129.5",
        });
        assert.deepEqual(parseMarkerName("[BPM_129.5|X_foo|Go+] Intro"), {
            displayName: "Intro",
            execToken: "Go+",
            tags: [
                { key: "BPM", value: "129.5" },
                { key: "X", value: "foo" },
            ],
            bpm: 129.5,
            bpmText: "129.5",
        });
        assert.deepEqual(parseMarkerName("[CueFade_6/12|X_foo|Temp] Intro"), {
            displayName: "Intro",
            execToken: "Temp",
            tags: [
                { key: "CUEFADE", value: "6/12" },
                { key: "X", value: "foo" },
            ],
            bumpAction: {
                kind: "Temp",
                phase: "start",
            },
            cueFade: "6/12",
        });
        assert.deepEqual(parseMarkerName("[TEMP] Intro"), {
            displayName: "Intro",
            execToken: "Temp",
            tags: [],
            bumpAction: {
                kind: "Temp",
                phase: "start",
            },
        });
        assert.deepEqual(parseMarkerName("[TEMP] Intro [Flash]"), {
            displayName: "Intro",
            execToken: "Flash",
            tags: [],
            bumpAction: {
                kind: "Flash",
                phase: "start",
            },
        });
        assert.deepEqual(parseMarkerName("[FadeFromX_0.5|FadeToX_1.2|DelayFromY_0.25|DelayToZ_2] Intro"), {
            displayName: "Intro",
            execToken: "Go+",
            tags: [
                { key: "FADEFROMX", value: "0.5" },
                { key: "FADETOX", value: "1.2" },
                { key: "DELAYFROMY", value: "0.25" },
                { key: "DELAYTOZ", value: "2" },
            ],
            cueTiming: [
                { key: "FadeFromX", value: "0.5" },
                { key: "FadeToX", value: "1.2" },
                { key: "DelayFromY", value: "0.25" },
                { key: "DelayToZ", value: "2" },
            ],
        });
        assert.deepEqual(parseMarkerName("[FadeFromA_0.5] Intro"), {
            displayName: "Intro",
            execToken: "Go+",
            tags: [{ key: "FADEFROMA", value: "0.5" }],
        });
        assert.deepEqual(parseMarkerName("[Temp|Release_250] Intro"), {
            displayName: "Intro",
            execToken: "Temp",
            tags: [
                { key: "RELEASE", value: "250" },
            ],
            bumpAction: {
                kind: "Temp",
                phase: "start",
                releaseDelayMs: 250,
            },
        });
        assert.deepEqual(parseMarkerName("[Flash|Release_120] Intro"), {
            displayName: "Intro",
            execToken: "Flash",
            tags: [
                { key: "RELEASE", value: "120" },
            ],
            bumpAction: {
                kind: "Flash",
                phase: "start",
                releaseDelayMs: 120,
            },
        });
        assert.deepEqual(parseMarkerName("[BUMP|Release_250|FadeFromX_0|FadeFromY_1] Blanc"), {
            displayName: "Blanc",
            execToken: "Temp",
            tags: [
                { key: "RELEASE", value: "250" },
                { key: "FADEFROMX", value: "0" },
                { key: "FADEFROMY", value: "1" },
            ],
            bumpAction: {
                kind: "Temp",
                phase: "start",
                releaseDelayMs: 250,
            },
            cueTiming: [
                { key: "FadeFromX", value: "0" },
                { key: "FadeFromY", value: "1" },
            ],
        });
        assert.deepEqual(parseMarkerName("[TempRelease] Intro"), {
            displayName: "Intro",
            execToken: "TempRelease",
            tags: [],
            bumpAction: {
                kind: "Temp",
                phase: "release",
            },
        });
        assert.deepEqual(parseMarkerName("[FlashRelease] Intro"), {
            displayName: "Intro",
            execToken: "FlashRelease",
            tags: [],
            bumpAction: {
                kind: "Flash",
                phase: "release",
            },
        });
        assert.deepEqual(parseMarkerName("[GLOBAL] Intro"), {
            displayName: "Intro",
            execToken: "Go+",
            tags: [{ key: "GLOBAL", value: null }],
            isGlobal: true,
        });
        assert.deepEqual(parseMarkerName("[R2] Prep Chorus"), {
            displayName: "Prep Chorus",
            execToken: "Go+",
            tags: [{ key: "R2", value: null }],
            regionTargetId: "R2",
        });
        assert.deepEqual(parseMarkerName("[LAYER=FX|CueFade_2] Impact"), {
            displayName: "Impact",
            execToken: "Go+",
            tags: [
                { key: "LAYER", value: "FX" },
                { key: "CUEFADE", value: "2" },
            ],
            regionLayerName: "FX",
            cueFade: "2",
        });
        assert.deepEqual(parseMarkerName("[OFF_LAYER=FX] Stop FX"), {
            displayName: "Stop FX",
            execToken: "Go+",
            tags: [{ key: "OFF_LAYER", value: "FX" }],
            regionLayerActions: [{ kind: "OFF", scope: "layer", layerName: "FX" }],
        });
        assert.deepEqual(parseMarkerName("[OFF_LAYERS] Stop layers"), {
            displayName: "Stop layers",
            execToken: "Go+",
            tags: [{ key: "OFF_LAYERS", value: null }],
            regionLayerActions: [{ kind: "OFF", scope: "all" }],
        });
        assert.deepEqual(parseMarkerName("[R2][OFF_LAYER=Voix] Stop Voix"), {
            displayName: "Stop Voix",
            execToken: "Go+",
            tags: [
                { key: "R2", value: null },
                { key: "OFF_LAYER", value: "Voix" },
            ],
            regionTargetId: "R2",
            regionLayerActions: [{ kind: "OFF", scope: "layer", layerName: "Voix" }],
        });
    });

    it("ignores invalid BPM metadata and keeps exporting", () => {
        const markers = normalizeMarkerRows([
            { "#": "1", Name: "[BPM_bad] Intro [Broken]", Start: "0", Color: "" },
        ]);

        assert.deepEqual(markers[0], {
            displayName: "Intro",
            execToken: "Go+",
            tags: [{ key: "BPM", value: "bad" }],
            start: "0",
            color: "",
        });
    });

    it("ignores empty cue fade metadata", () => {
        const marker = parseMarkerName("[CueFade_] Intro");

        assert.equal(marker.cueFade, undefined);
        assert.deepEqual(marker.tags, [{ key: "CUEFADE", value: null }]);
    });

    it("routes metadata through dedicated providers by family", () => {
        const registry = createDefaultMarkerTagProviderRegistry();

        assert.equal(fadeFromTagProvider.supports({ key: "FADEFROMX", value: "0.5" }), true);
        assert.equal(fadeFromTagProvider.supports({ key: "FADETOX", value: "0.5" }), false);
        assert.equal(fadeToTagProvider.supports({ key: "FADETOZ", value: "1.2" }), true);
        assert.equal(delayFromTagProvider.supports({ key: "DELAYFROMY", value: "0.25" }), true);
        assert.equal(delayToTagProvider.supports({ key: "DELAYTOZ", value: "2" }), true);
        assert.equal(cueFadeTagProvider.supports({ key: "CUEFADE", value: "6/12" }), true);
        assert.equal(bpmTagProvider.supports({ key: "BPM", value: "129.5" }), true);

        assert.deepEqual(registry.enrich([{ key: "FADEFROMX", value: "0.5" }]), {
            cueTiming: [{ key: "FadeFromX", value: "0.5" }],
        });
        assert.deepEqual(registry.enrich([{ key: "CUEFADE", value: "6/12" }]), {
            cueTiming: [],
            cueFade: "6/12",
        });
        assert.deepEqual(registry.enrich([{ key: "BPM", value: "129.5" }]), {
            cueTiming: [],
            bpm: 129.5,
            bpmText: "129.5",
        });
    });

    it("preserves sanitized marker names before sequence-local dedupe", () => {
        const markers = normalizeMarkerRows([
            { "#": "1", Name: "Intro!", Start: "0", Color: "" },
            { "#": "2", Name: "Intro!", Start: "1", Color: "" },
            { "#": "3", Name: "Crash", Start: "2", Color: "19005190" },
        ]);

        assert.deepEqual(
            markers.map((marker) => marker.displayName),
            ["Intro", "Intro", "Crash"],
        );
    });

    it("groups repeated markers by exact color and reuses cue names locally", () => {
        const repeatedSequences = groupRepeatedSequences(
            [
                { displayName: "Intro", execToken: "Goto", tags: [], start: "2", color: "19005190" },
                { displayName: "Hit", execToken: "Load", tags: [], start: "3", color: "19005190" },
                { displayName: "Intro", execToken: "Goto", tags: [], start: "4", color: "33554431" },
            ],
            "1",
            101,
            1,
        );

        assert.deepEqual(
            repeatedSequences.map((sequence) => ({
                color: sequence.color,
                displayName: sequence.displayName,
                cues: sequence.cues,
                appearanceName: sequence.appearanceName,
                appearanceNumber: sequence.appearanceNumber,
                appearanceColor: sequence.appearanceColor,
                sequenceNumber: sequence.sequenceNumber,
                events: sequence.events,
            })),
            [
                {
                    color: "19005190",
                    displayName: "1 - Intro",
                    cues: [
                        { cueNumber: 1, name: "Start" },
                        { cueNumber: 2, name: "Hit" },
                    ],
                    appearanceName: "R2MA Color 19005190",
                    appearanceNumber: 1,
                    appearanceColor: "19005190",
                    sequenceNumber: 102,
                    events: [
                        { timestamp: "2", execToken: "Goto", cueNumber: 1, cueName: "Start" },
                        { timestamp: "3", execToken: "Load", cueNumber: 2, cueName: "Hit" },
                    ],
                },
                {
                    color: "33554431",
                    displayName: "1 - Intro 2",
                    cues: [{ cueNumber: 1, name: "Start" }],
                    appearanceName: "R2MA Color 33554431",
                    appearanceNumber: 2,
                    appearanceColor: "33554431",
                    sequenceNumber: 103,
                    events: [{ timestamp: "4", execToken: "Goto", cueNumber: 1, cueName: "Start" }],
                },
            ],
        );
    });

    it("routes bump markers into their own overlay sequences", () => {
        const bumpSequences = groupBumpSequences(
            [
                { displayName: "HIT", execToken: "Temp", tags: [], start: "5", color: "19005190" },
                { displayName: "HIT", execToken: "Flash", tags: [], start: "7", color: "19005190" },
                { displayName: "HIT", execToken: "Temp", tags: [], start: "9", color: "33554431" },
            ],
            103,
            "1",
            new Map([
                ["19005190", "1 - Intro"],
                ["33554431", "1 - Verse"],
            ]),
        );

        assert.deepEqual(
            bumpSequences.map((sequence) => ({
                color: sequence.color,
                displayName: sequence.displayName,
                cues: sequence.cues,
                sequenceNumber: sequence.sequenceNumber,
                releaseDurationSeconds: sequence.releaseDurationSeconds,
                events: sequence.events,
            })),
            [
                {
                    color: "19005190",
                    displayName: "1 - Intro - BUMP - HIT",
                    cues: [{ cueNumber: 1, name: "Start" }],
                    sequenceNumber: 104,
                    releaseDurationSeconds: "0.2",
                    events: [
                        { timestamp: "5", execToken: "Temp", cueNumber: 1, cueName: "Start" },
                        { timestamp: "7", execToken: "Flash", cueNumber: 1, cueName: "Start" },
                    ],
                },
                {
                    color: "33554431",
                    displayName: "1 - Verse - BUMP - HIT",
                    cues: [{ cueNumber: 1, name: "Start" }],
                    sequenceNumber: 105,
                    releaseDurationSeconds: "0.2",
                    events: [{ timestamp: "9", execToken: "Temp", cueNumber: 1, cueName: "Start" }],
                },
            ],
        );
    });

    it("converts Reaper color values to grandMA3 appearance colors", () => {
        assert.equal(convertReaperColorToGrandmaAppearanceColor("19005190"), 'COLOR="1,1,1,0" BackR=33 BackG=255 BackB=6 BackAlpha=221');
        assert.equal(convertReaperColorToGrandmaAppearanceColor("33554431"), 'COLOR="1,1,1,0" BackR=255 BackG=255 BackB=255 BackAlpha=221');
        assert.equal(convertReaperColorToGrandmaAppearanceColor("F2FF00"), 'COLOR="1,1,1,0" BackR=242 BackG=255 BackB=0 BackAlpha=221');
        assert.equal(convertReaperColorToGrandmaAppearanceColor("#00BFFF"), 'COLOR="1,1,1,0" BackR=0 BackG=191 BackB=255 BackAlpha=221');
        assert.equal(convertReaperColorToGrandmaAppearanceColor(""), undefined);
        assert.equal(convertReaperColorToCssColor("#00BFFF"), "rgb(0, 191, 255)");
        assert.equal(convertReaperColorToCssColor("not-a-color"), undefined);
        assert.equal(createInheritedRegionLayerColor("#000000"), "#3D3D3D");
        assert.equal(createInheritedRegionBumpColor("#000000"), "#6B6B6B");
    });
});

describe("conversion artifacts", () => {
    it("builds the expected XML artifacts from the fixture", () => {
        const artifacts = convertReaperCsvToArtifacts(fixtureCsv, "Song 01.CSV", baseSettings);
        const commands = getMacroCommands(artifacts.macroXml);

        assert.equal(artifacts.outputBaseName, "songcsv");
        assert.equal(artifacts.uniqueCues.length, 3);
        assert.equal(artifacts.repeatedSequences.length, 2);
        assert.equal(artifacts.bumpSequences.length, 0);
        assert.equal(artifacts.bpmSequence, undefined);
        assert.equal(commands.includes("Store Appearance 9001"), true);
        assert.equal(commands.includes('Label Appearance 9001 "R2MA Color 19005190"'), true);
        assert.equal(commands.includes('Set Appearance 9001 COLOR="1,1,1,0" BackR=33 BackG=255 BackB=6 BackAlpha=221'), true);
        assert.equal(commands.includes('Store DataPool "R2MA songcsv" Sequence 1 "MA Sequence 9001"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA songcsv" Sequence 1 "MA Sequence 9001"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA songcsv" Sequence 2 APPEARANCE="R2MA Color 19005190"'), true);
        assert.equal(commands.includes("Store Appearance 9002"), true);
        assert.equal(commands.includes('Label Appearance 9002 "R2MA Color 33554431"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA songcsv" Sequence 3 APPEARANCE="R2MA Color 33554431"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA songcsv" Sequence 1 Cue 1 "Intro"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA songcsv" Sequence 1 Cue 2 "Intro 2"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA songcsv" Sequence 1 Cue 3 "Outro"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA songcsv" Sequence 2 Cue 1 "Start"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA songcsv" Sequence 3 Cue 1 "Start"'), true);
        assert.equal(commands.includes('Store DataPool "R2MA songcsv" Sequence 1 Cue 1 /Overwrite'), true);
        assert.equal(commands.includes('Store DataPool "R2MA songcsv" Sequence 1 Cue 2 /Overwrite'), true);
        assert.equal(commands.includes('Store DataPool "R2MA songcsv" Sequence 1 Cue 3 /Overwrite'), true);
        assert.equal(commands.includes('Store Type "StandardRecipe" DataPool "R2MA songcsv" Sequence 1 Cue 1 Part 0.1'), true);
        assert.equal(commands.includes('Store Type "StandardRecipe" DataPool "R2MA songcsv" Sequence 1 Cue 2 Part 0.1'), true);
        assert.equal(commands.some((command) => command.includes("Cue 1 Thru 3 /Merge")), false);
        assert.equal(commands.includes('Set DataPool "R2MA songcsv" Sequence 1 Property "SpeedMaster" #[Master 3.4]'), true);
        assert.equal(commands.includes('Set DataPool "R2MA songcsv" Sequence 2 Property "SpeedMaster" #[Master 3.4]'), true);
        assert.equal(commands.filter((command) => command.startsWith('Cook DataPool "R2MA songcsv" Sequence ')).length, 3);
        assert.equal(commands.includes('set 1 DURATION="6.000"'), true);

        const cue2Index = commands.indexOf('Store DataPool "R2MA songcsv" Sequence 1 Cue 2 /Overwrite');
        const cue2RecipeIndex = commands.indexOf('Store Type "StandardRecipe" DataPool "R2MA songcsv" Sequence 1 Cue 2 Part 0.1');
        assert.equal(cue2Index >= 0 && cue2RecipeIndex === cue2Index + 1, true);

        const outputFiles = createConversionOutputFiles(artifacts);
        assert.deepEqual(outputFiles.map((file) => file.name), ["songcsv_macro.xml"]);
    });

    it("generates command-driven timecode inside the macro XML", () => {
        const artifacts = convertReaperCsvToArtifacts(fixtureCsv, "Song 01.CSV", baseSettings);
        const parsed = parseXml(artifacts.macroXml);
        const commands = getMacroCommands(artifacts.macroXml);

        assert.equal(parsed.GMA3["@_DataVersion"], "1.4.0.2");
        assert.equal(parsed.GMA3.Timecode, undefined);
        assert.equal(commands.includes('Delete DataPool "R2MA songcsv" /NC'), true);
        assert.equal(commands.includes('Store DataPool "R2MA songcsv" /NC'), true);
        assert.equal(commands.includes('Store DataPool "R2MA songcsv" Timecode 1'), true);
        assert.equal(commands.includes('Store Type "CmdSubTrack" 1'), true);
        assert.equal(commands.includes('Set 2 "TIME" "1"'), true);
        assert.equal(commands.includes('Set 2 "TOKEN" "Go+"'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA songcsv" Sequence 1 Cue 2 At Timecode 1.1.1.1.1.2'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA songcsv" Sequence 2 Cue 1 At Timecode 1.1.2.1.1.1'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA songcsv" Sequence 1 At Page 1.201'), true);
        assert.equal(commands.includes('Move DataPool "R2MA songcsv" Sequence 1 Thru At Sequence 9001'), true);
        assert.equal(commands.includes('Move DataPool "R2MA songcsv" Timecode 1 Thru At Timecode 1'), true);
        assert.equal(commands.includes('Set Timecode 1 Property "PlaybackAndRecord" "Manual Events"'), true);
        assert.equal(commands.includes('Delete DataPool "R2MA songcsv" /NoConfirm'), true);
        assert.equal(artifacts.macroXml.includes("GMA3.Timecode"), false);
        assert.equal(artifacts.macroXml.includes("RealtimeCmd"), false);
        assert.equal(artifacts.macroXml.includes("CueDestination"), false);
        assert.equal(artifacts.macroXml.includes("ValCueDestination"), false);
        assert.equal(artifacts.macroXml.includes("import Timecode"), false);
        assert.equal(artifacts.macroXml.includes("Drive"), false);
        assert.equal(artifacts.macroXml.includes("FaderSubTrack"), false);
        assert.equal(artifacts.macroXml.includes("ShowData.MediaPools.Sounds"), false);
    });

    it("sets a signed native offset after moving the Timecode object", () => {
        const positive = convertReaperCsvToArtifacts(fixtureCsv, "Song 01.CSV", { ...baseSettings, timecodeOffsetMs: 3_600_000 });
        const positiveCommands = getMacroCommands(positive.macroXml);
        const moveIndex = positiveCommands.indexOf('Move DataPool "R2MA songcsv" Timecode 1 Thru At Timecode 1');
        const offsetIndex = positiveCommands.indexOf('Set Timecode 1 Property "Offset" "3600"');
        const playbackIndex = positiveCommands.indexOf('Set Timecode 1 Property "PlaybackAndRecord" "Manual Events"');

        assert.equal(moveIndex >= 0 && offsetIndex === moveIndex + 1 && playbackIndex === offsetIndex + 1, true);

        const negative = convertReaperCsvToArtifacts(fixtureCsv, "Song 01.CSV", { ...baseSettings, timecodeOffsetMs: -500 });
        assert.equal(getMacroCommands(negative.macroXml).includes('Set Timecode 1 Property "Offset" "-0.5"'), true);
    });

    it("keeps historical XML unchanged at zero and omits the offset in cues-only mode", () => {
        const legacy = convertReaperCsvToArtifacts(fixtureCsv, "Song 01.CSV", baseSettings);
        const explicitZero = convertReaperCsvToArtifacts(fixtureCsv, "Song 01.CSV", { ...baseSettings, timecodeOffsetMs: 0 });
        const cuesOnly = convertReaperCsvToArtifacts(fixtureCsv, "Song 01.CSV", { ...baseSettings, exportMode: "cues-only", timecodeOffsetMs: 3_600_000 });

        assert.equal(explicitZero.macroXml, legacy.macroXml);
        assert.equal(getMacroCommands(explicitZero.macroXml).some((command) => command.includes('Property "Offset"')), false);
        assert.equal(getMacroCommands(cuesOnly.macroXml).some((command) => command.includes('Property "Offset"')), false);
    });

    it("can omit the optional repeat and bump identifier without changing their grouping", () => {
        const artifacts = convertReaperCsvToArtifacts(fixtureCsv, "Song 01.CSV", { ...baseSettings, prefix: "" });
        const bumpArtifacts = convertReaperCsvToArtifacts("#,Name,Start,Color\n1,[Temp] HIT,0,16711680", "Bump.csv", { ...baseSettings, prefix: "" });

        assert.equal(artifacts.repeatedSequences.length, 2);
        assert.deepEqual(artifacts.repeatedSequences.map((sequence) => sequence.displayName), ["MA SD", "MA Crash"]);
        assert.deepEqual(artifacts.repeatedSequences.map((sequence) => sequence.sequenceNumber), [9002, 9003]);
        assert.equal(bumpArtifacts.bumpSequences[0]?.displayName, "MA BUMP - HIT");
    });

    it("keeps command time values in CSV seconds", () => {
        const csv = `#,Name,Start,Color
1,Intro,0,
2,Verse,110.167,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "long-time.csv", baseSettings);
        const commands = getMacroCommands(artifacts.macroXml);

        assert.equal(commands.includes('Set 2 "TIME" "110.167"'), true);
        assert.equal(commands.includes('set 1 DURATION="111.167"'), true);
    });

    it("builds a conversion preview from derived artifacts", () => {
        const artifacts = convertReaperCsvToArtifacts(fixtureCsv, "Song 01.CSV", baseSettings);
        const preview = createConversionPreview(artifacts, 6);

        assert.deepEqual(preview.outputFileNames, ["songcsv_macro.xml"]);
        assert.equal(preview.sourceMarkerCount, 6);
        assert.equal(preview.uniqueCueCount, 3);
        assert.equal(preview.regionLayerSequenceCount, 0);
        assert.equal(preview.repeatedSequenceCount, 2);
        assert.equal(preview.bumpSequenceCount, 0);
        assert.equal(preview.bpmEventCount, 0);
        assert.equal(preview.duration, "6.000");
        assert.deepEqual(preview.generatedSequenceNames, ["MA 1 - SD", "MA 1 - Crash"]);
        assert.equal(preview.warnings.length, 0);
    });

    it("warns when the CSV looks exported with musical time instead of seconds", () => {
        const csv = `#,Name,Start,End,Length,Lane
R1,Region A,1.1.00000000,4.1.00000000,3.0.000000,0
M1,Cue A,1.2.00000000,,,1
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "musical-time.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const preview = createConversionPreview(artifacts, 2);

        assert.equal(artifacts.validationWarnings.some((warning) => warning.includes("Color")), false);
        assert.equal(
            preview.warnings.some((warning) => warning.includes("measures/beats") && warning.includes("seconds")),
            true,
        );
    });

    it("accepts CSV exports without a Color column", () => {
        const csv = `#,Name,Start
1,Intro,0
2,Verse,1
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "no-color.csv", baseSettings);

        assert.deepEqual(artifacts.validationWarnings, []);
        assert.deepEqual(artifacts.uniqueCues.map((cue) => cue.displayName), ["Intro", "Verse"]);
        assert.equal(artifacts.repeatedSequences.length, 0);
    });

    it("builds timeline preview tracks in generated timecode order", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region A,0,5,5,#00BFFF
1,Region Cue,1,,,
2,Main Cue,6,,,
3,Hit,7,,,19005190
4,[Temp|Release_250] Bump,8,,,19005190
5,[BPM_120] Tempo,9,,,
`;
        const settings: ConversionSettings = {
            ...baseSettings,
            importMode: "regions-and-markers",
        };
        const artifacts = convertReaperCsvToArtifacts(csv, "timeline.csv", settings);
        const timeline = createTimelinePreview(artifacts, settings);

        assert.equal(timeline.enabled, true);
        assert.deepEqual(timeline.tracks.map((track) => track.kind), ["main", "region", "repeated", "bump", "bpm"]);
        assert.deepEqual(timeline.tracks.map((track) => track.sequenceNumber), [9001, 9002, 9003, 9004, 9005]);
        assert.equal(timeline.tracks[1].color, "rgb(0, 191, 255)");
        assert.equal(timeline.duration, "10.500");
        assert.equal(timeline.eventCount, 8);
        assert.deepEqual(
            timeline.tracks[4].events.map((event) => ({
                timestamp: event.timestamp,
                token: event.token,
                label: event.label,
                isDerived: event.isDerived,
            })),
            [{ timestamp: "9", token: "Go+", label: "BPM 120", isDerived: false }],
        );
    });

    it("routes compact region action tags into the target timeline tracks", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region One,0,5,5,
R2,Region Two,5,10,5,
1,[OFF_R1|ON_R2] Cue,1,,,
`;
        const settings: ConversionSettings = {
            ...baseSettings,
            importMode: "regions-and-markers",
        };
        const artifacts = convertReaperCsvToArtifacts(csv, "timeline-actions.csv", settings);
        const timeline = createTimelinePreview(artifacts, settings);
        const regionOneTrack = timeline.tracks.find((track) => track.displayName === "MA R1 - Region One");
        const regionTwoTrack = timeline.tracks.find((track) => track.displayName === "MA R2 - Region Two");

        assert.ok(regionOneTrack);
        assert.ok(regionTwoTrack);
        assert.deepEqual(
            regionOneTrack.events.map((event) => ({
                timestamp: event.timestamp,
                token: event.token,
                label: event.label,
                isDerived: event.isDerived,
            })),
            [
                { timestamp: "0", token: "Go+", label: "Region Start", isDerived: false },
                { timestamp: "1", token: "Off", label: "OFF R1", isDerived: true },
                { timestamp: "1", token: "Go+", label: "Cue", isDerived: false },
                { timestamp: "4.250", token: "Go+", label: "Region End", isDerived: false },
            ],
        );
        assert.deepEqual(
            regionTwoTrack.events
                .filter((event) => event.isDerived)
                .map((event) => ({
                    timestamp: event.timestamp,
                    token: event.token,
                    label: event.label,
                    cueNumber: event.cueNumber,
                    isDerived: event.isDerived,
                })),
            [{ timestamp: "1", token: "Go+", label: "ON R2", cueNumber: 1, isDerived: true }],
        );
    });

    it("adds automatic region Off events when no manual OFF_Rx targets the region", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region One,0,5,5,
R2,Region Two,5,10,5,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "region-auto-off.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);
        const r1TrackCommands = getTimecodeTrackCommands(commands, "R2MA regionautooff", 1);

        assert.equal(r1TrackCommands.includes('Set 3 "TIME" "6.000"'), true);
        assert.equal(r1TrackCommands.includes('Set 3 "TOKEN" "Off"'), true);
    });

    it("handles cues-only and non-numeric timestamps in timeline preview", () => {
        const csv = `#,Name,Start,Color
1,Intro,not-a-time,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "bad-time.csv", baseSettings);
        const cuesOnlyTimeline = createTimelinePreview(artifacts, {
            ...baseSettings,
            exportMode: "cues-only",
        });
        const timeline = createTimelinePreview(artifacts, baseSettings);

        assert.equal(cuesOnlyTimeline.enabled, false);
        assert.equal(cuesOnlyTimeline.emptyMessage, "Cues only mode does not create grandMA3 timecode tracks.");
        assert.equal(timeline.enabled, true);
        assert.equal(timeline.duration, "1.000");
        assert.equal(timeline.tracks[0].events[0].timeLabel, "not-a-time");
        assert.equal(timeline.tracks[0].events[0].positionPercent, 0);
    });

    it("builds hybrid region artifacts from the demo CSV fixture", () => {
        const artifacts = convertReaperCsvToArtifacts(regionFixtureCsv, "regions-markers-demo.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);
        const tempDataPoolName = "R2MA regionsmarkersdemo";

        assert.equal(artifacts.regionSequences.length, 2);
        assert.deepEqual(
            artifacts.regionSequences.map((sequence) => ({
                regionId: sequence.regionId,
                displayName: sequence.displayName,
                sequenceNumber: sequence.sequenceNumber,
                cues: sequence.cues.map((cue) => cue.name),
            })),
            [
                { regionId: "R1", displayName: "MA R1 - Introduction", sequenceNumber: 9002, cues: ["Region Start + Introduction", "Region End"] },
                {
                    regionId: "R2",
                    displayName: "MA R2 - Introduction - Sub Region",
                    sequenceNumber: 9003,
                    cues: ["Region Start", "Début Récit", "Récit Enfance", "Intro Musique", "Montée", "Fin montée", "Region End"],
                },
            ],
        );
        assert.equal(artifacts.repeatedSequences.length, 1);
        assert.equal(artifacts.repeatedSequences[0].displayName, "MA 1 - Wand Song Deb");
        assert.equal(artifacts.bumpSequences.length, 1);
        assert.equal(artifacts.bumpSequences[0].displayName, "MA R2 - Introduction - Sub Region - BUMP - Blanc");
        assert.equal(artifacts.bumpSequences[0].regionId, "R2");
        assert.equal(artifacts.bumpSequences[0].events[0].timestamp, "13.810");
        assert.equal(artifacts.bumpSequences[0].events.length, 1);
        assert.equal(artifacts.bumpSequences[0].releaseDurationSeconds, "0.25");
        assert.equal(artifacts.bpmSequence?.sequenceNumber, 9006);
        assert.equal(commands.includes(`Store DataPool "${tempDataPoolName}" Sequence 1 "MA R1 - Introduction"`), true);
        assert.equal(commands.includes(`Label DataPool "${tempDataPoolName}" Sequence 1 "MA R1 - Introduction"`), true);
        assert.equal(commands.includes(`Store DataPool "${tempDataPoolName}" Sequence 2 "MA R2 - Introduction - Sub Region"`), true);
        assert.equal(commands.includes(`Label DataPool "${tempDataPoolName}" Sequence 2 "MA R2 - Introduction - Sub Region"`), true);
        assert.equal(commands.includes(`Store DataPool "${tempDataPoolName}" Sequence 4 "MA R2 - Introduction - Sub Region - BUMP - Blanc"`), true);
        assert.equal(commands.includes(`Label DataPool "${tempDataPoolName}" Sequence 4 "MA R2 - Introduction - Sub Region - BUMP - Blanc"`), true);
        assert.equal(commands.includes("Store Appearance 9001"), true);
        assert.equal(commands.includes('Set Appearance 9001 COLOR="1,1,1,0" BackR=217 BackG=61 BackB=0 BackAlpha=221'), true);
        assert.equal(commands.includes(`Set DataPool "${tempDataPoolName}" Sequence 2 Cue 4 APPEARANCE="R2MA Color F2FF00"`), true);
        assert.equal(commands.includes('Set Appearance 9002 COLOR="1,1,1,0" BackR=242 BackG=255 BackB=0 BackAlpha=221'), true);
        assert.equal(commands.includes(`Set DataPool "${tempDataPoolName}" Sequence 3 APPEARANCE="R2MA Color 00BFFF"`), true);
        assert.equal(commands.includes(`Label DataPool "${tempDataPoolName}" Sequence 2 Cue 1 "Region Start"`), true);
        assert.equal(commands.includes(`Label DataPool "${tempDataPoolName}" Sequence 2 Cue 2 "Début Récit"`), true);
        assert.equal(commands.includes(`Label DataPool "${tempDataPoolName}" Sequence 2 Cue 5 "Montée"`), true);
        assert.equal(commands.includes(`Label DataPool "${tempDataPoolName}" Sequence 2 Cue 6 "Fin montée"`), true);
        assert.equal(commands.includes(`Label DataPool "${tempDataPoolName}" Sequence 2 Cue 7 "Region End"`), true);
        assert.equal(commands.includes(`Store DataPool "${tempDataPoolName}" Timecode 1`), true);
        assert.equal(commands.includes(`Label DataPool "${tempDataPoolName}" Timecode 1.1 "Global"`), true);
        assert.equal(commands.includes(`Label DataPool "${tempDataPoolName}" Timecode 1.2 "MA R1 - Introduction"`), true);
        assert.equal(commands.includes(`Label DataPool "${tempDataPoolName}" Timecode 1.3 "MA R2 - Introduction - Sub Region"`), true);
        assert.equal(commands.includes(`Assign DataPool "${tempDataPoolName}" Sequence 2 Cue 1 At Timecode 1.3.1.1.1.1`), true);
        assert.equal(commands.includes(`Assign DataPool "${tempDataPoolName}" Sequence 4 Cue 1 At Timecode 1.3.2.1.1.1`), true);
        assert.equal(commands.includes(`Move DataPool "${tempDataPoolName}" Sequence 1 Thru At Sequence 9002`), true);
        assert.equal(commands.includes(`Move DataPool "${tempDataPoolName}" Timecode 1 Thru At Timecode 1`), true);
        assert.deepEqual(createConversionOutputFiles(artifacts).map((file) => file.name), ["regionsmarkersdemo_macro.xml"]);
    });

    it("keeps global markers in the main sequence even when they sit inside a region", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region A,0,10,10,
1,[GLOBAL] Global Cue,1,,,
2,Region Cue,2,,,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "global-region.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);

        assert.equal(artifacts.uniqueCues.length, 1);
        assert.equal(artifacts.uniqueCues[0].displayName, "Global Cue");
        assert.equal(artifacts.regionSequences.length, 1);
        assert.deepEqual(artifacts.regionSequences[0].cues.map((cue) => cue.name), ["Region Start", "Region Cue", "Region End"]);
        assert.equal(commands.includes('Label DataPool "R2MA globalregion" Sequence 1 Cue 1 "Global Cue"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA globalregion" Sequence 1 Cue 1 "Region Cue"'), false);
    });

    it("routes explicitly tagged markers into a region sequence before the region starts", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Verse,0,5,5,
R2,Chorus,10,20,10,
1,Verse Cue,1,,,
2,Outside Main,6,,,
3,[R2] Prep Chorus,8,,,
4,Chorus Start,10,,,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "explicit-region.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);

        assert.deepEqual(artifacts.uniqueCues.map((cue) => cue.displayName), ["Outside Main"]);
        assert.deepEqual(
            artifacts.regionSequences.map((sequence) => ({
                regionId: sequence.regionId,
                cues: sequence.cues.map((cue) => cue.name),
                events: sequence.events.map((event) => event.timestamp),
            })),
            [
                {
                    regionId: "R1",
                    cues: ["Region Start", "Verse Cue", "Region End"],
                    events: ["0", "1", "4.250"],
                },
                {
                    regionId: "R2",
                    cues: ["Prep Chorus", "Region Start + Chorus Start", "Region End"],
                    events: ["8", "10", "19.250"],
                },
            ],
        );
        assert.equal(commands.includes('Label DataPool "R2MA explicitregion" Sequence 3 Cue 1 "Prep Chorus"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA explicitregion" Sequence 3 Cue 2 "Region Start + Chorus Start"'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA explicitregion" Sequence 3 Cue 1 At Timecode 1.3.1.1.1.1'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA explicitregion" Sequence 3 Cue 2 At Timecode 1.3.1.1.1.2'), true);
    });

    it("routes layer markers into region-scoped layer sequences", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Verse,0,10,10,#00BFFF
R2,Chorus,10,20,10,
1,Region Cue,1,,,
2,[LAYER=FX|CueFade_2|FadeFromX_0.5] Impact,2,,,F2FF00
3,[LAYER=FX] Impact,3,,,F2FF00
4,[LAYER=Voix] Line [Load],4,,,654321
5,[R2][LAYER=FX] Prep FX,8,,,654321
6,R2 Cue,11,,,
7,[LAYER=FX] Hit,12,,,F2FF00
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "region-layers.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);

        assert.deepEqual(
            artifacts.regionSequences.map((sequence) => ({
                regionId: sequence.regionId,
                sequenceNumber: sequence.sequenceNumber,
                cues: sequence.cues.map((cue) => cue.name),
            })),
            [
                {
                    regionId: "R1",
                    sequenceNumber: 9002,
                    cues: ["Region Start", "Region Cue", "Region End"],
                },
                {
                    regionId: "R2",
                    sequenceNumber: 9005,
                    cues: ["Region Start", "R2 Cue", "Region End"],
                },
            ],
        );
        assert.deepEqual(
            artifacts.regionLayerSequences.map((sequence) => ({
                regionId: sequence.regionId,
                layerName: sequence.layerName,
                displayName: sequence.displayName,
                sequenceNumber: sequence.sequenceNumber,
                cues: sequence.cues.map((cue) => ({
                    cueNumber: cue.cueNumber,
                    name: cue.name,
                    appearanceName: cue.appearanceName,
                    cueFade: cue.cueFade,
                    cueTiming: cue.cueTiming,
                })),
                events: sequence.events.map((event) => ({
                    timestamp: event.timestamp,
                    execToken: event.execToken,
                    cueNumber: event.cueNumber,
                    cueName: event.cueName,
                })),
            })),
            [
                {
                    regionId: "R1",
                    layerName: "FX",
                    displayName: "MA R1 - Verse - FX",
                    sequenceNumber: 9003,
                    cues: [
                        {
                            cueNumber: 1,
                            name: "Layer Pre-Roll",
                            appearanceName: "R2MA Color F2FF00",
                            cueFade: undefined,
                            cueTiming: undefined,
                        },
                        {
                            cueNumber: 2,
                            name: "Impact",
                            appearanceName: "R2MA Color F2FF00",
                            cueFade: "2",
                            cueTiming: [{ key: "FadeFromX", value: "0.5" }],
                        },
                        {
                            cueNumber: 3,
                            name: "Impact 2",
                            appearanceName: "R2MA Color F2FF00",
                            cueFade: undefined,
                            cueTiming: undefined,
                        },
                    ],
                    events: [
                        { timestamp: "0.000", execToken: "Go+", cueNumber: 1, cueName: "Layer Pre-Roll" },
                        { timestamp: "2", execToken: "Go+", cueNumber: 2, cueName: "Impact" },
                        { timestamp: "3", execToken: "Go+", cueNumber: 3, cueName: "Impact 2" },
                    ],
                },
                {
                    regionId: "R1",
                    layerName: "Voix",
                    displayName: "MA R1 - Verse - Voix",
                    sequenceNumber: 9004,
                    cues: [
                        {
                            cueNumber: 1,
                            name: "Layer Pre-Roll",
                            appearanceName: "R2MA Color 654321",
                            cueFade: undefined,
                            cueTiming: undefined,
                        },
                        {
                            cueNumber: 2,
                            name: "Line",
                            appearanceName: "R2MA Color 654321",
                            cueFade: undefined,
                            cueTiming: undefined,
                        },
                    ],
                    events: [
                        { timestamp: "0.000", execToken: "Go+", cueNumber: 1, cueName: "Layer Pre-Roll" },
                        { timestamp: "4", execToken: "Load", cueNumber: 2, cueName: "Line" },
                    ],
                },
                {
                    regionId: "R2",
                    layerName: "FX",
                    displayName: "MA R2 - Chorus - FX",
                    sequenceNumber: 9006,
                    cues: [
                        {
                            cueNumber: 1,
                            name: "Layer Pre-Roll",
                            appearanceName: "R2MA Color 654321",
                            cueFade: undefined,
                            cueTiming: undefined,
                        },
                        {
                            cueNumber: 2,
                            name: "Prep FX",
                            appearanceName: "R2MA Color 654321",
                            cueFade: undefined,
                            cueTiming: undefined,
                        },
                        {
                            cueNumber: 3,
                            name: "Hit",
                            appearanceName: "R2MA Color F2FF00",
                            cueFade: undefined,
                            cueTiming: undefined,
                        },
                    ],
                    events: [
                        { timestamp: "7.250", execToken: "Go+", cueNumber: 1, cueName: "Layer Pre-Roll" },
                        { timestamp: "8", execToken: "Go+", cueNumber: 2, cueName: "Prep FX" },
                        { timestamp: "12", execToken: "Go+", cueNumber: 3, cueName: "Hit" },
                    ],
                },
            ],
        );
        assert.equal(artifacts.repeatedSequences.length, 0);
        assert.equal(commands.includes('Store DataPool "R2MA regionlayers" Sequence 1 "MA R1 - Verse"'), true);
        assert.equal(commands.includes('Store DataPool "R2MA regionlayers" Sequence 2 "MA R1 - Verse - FX"'), true);
        assert.equal(commands.includes('Store DataPool "R2MA regionlayers" Sequence 3 "MA R1 - Verse - Voix"'), true);
        assert.equal(commands.includes('Store DataPool "R2MA regionlayers" Sequence 4 "MA R2 - Chorus"'), true);
        assert.equal(commands.includes('Store DataPool "R2MA regionlayers" Sequence 5 "MA R2 - Chorus - FX"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA regionlayers" Sequence 2 Cue 2 CueFade 2'), true);
        assert.equal(commands.includes('Set DataPool "R2MA regionlayers" Sequence 2 Cue 2 Part 0.1 FadeFromX "0.5"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA regionlayers" Sequence 2 Cue 2 APPEARANCE="R2MA Color F2FF00"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA regionlayers" Sequence 3 Cue 2 APPEARANCE="R2MA Color 654321"'), true);
        assert.equal(commands.includes('Set 2 "TOKEN" "Load"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA regionlayers" Timecode 1.1 "MA R1 - Verse"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA regionlayers" Timecode 1.2 "MA R2 - Chorus"'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA regionlayers" Sequence 2 Cue 1 At Timecode 1.1.2.1.1.1'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA regionlayers" Sequence 5 Cue 1 At Timecode 1.2.2.1.1.1'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA regionlayers" Sequence 1 At Page 1.201'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA regionlayers" Sequence 2 At Page 1.202'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA regionlayers" Sequence 5 At Page 1.205'), true);
        assert.equal(commands.includes('Move DataPool "R2MA regionlayers" Sequence 1 Thru At Sequence 9002'), true);

        const preview = createConversionPreview(artifacts, 9);
        const timeline = createTimelinePreview(artifacts, {
            ...baseSettings,
            importMode: "regions-and-markers",
        });

        assert.equal(preview.regionLayerSequenceCount, 3);
        assert.deepEqual(preview.generatedSequenceNames, [
            "MA R1 - Verse",
            "MA R1 - Verse - FX",
            "MA R1 - Verse - Voix",
            "MA R2 - Chorus",
            "MA R2 - Chorus - FX",
        ]);
        assert.deepEqual(timeline.tracks.map((track) => track.kind), ["region", "layer", "layer", "region", "layer"]);
        assert.deepEqual(timeline.tracks.map((track) => track.sequenceNumber), [9002, 9003, 9004, 9005, 9006]);
        assert.equal(timeline.tracks[1].kindLabel, "Layer");
    });

    it("warns and falls back to normal routing for layer markers outside regions", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region A,0,5,5,
1,[LAYER=FX] Outside,6,,,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "outside-layer.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);

        assert.equal(artifacts.regionLayerSequences.length, 0);
        assert.deepEqual(artifacts.uniqueCues.map((cue) => cue.displayName), ["Outside"]);
        assert.equal(artifacts.validationWarnings.some((warning) => warning.includes("[LAYER=FX]") && warning.includes("normal marker")), true);
        assert.equal(commands.includes('Label DataPool "R2MA outsidelayer" Sequence 1 Cue 1 "Outside"'), true);
    });

    it("emits manual layer Off events on targeted region layer tracks only", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Verse,0,10,10,
R2,Chorus,10,20,10,
1,[LAYER=FX] Impact,2,,,
2,[LAYER=Voix] Line,3,,,
3,[OFF_LAYER=FX] Stop FX,4,,,
4,[OFF_LAYERS] Stop All,5,,,
5,[R2][LAYER=FX] Prep FX,8,,,
6,[R2][OFF_LAYER=FX] Stop R2 FX,9,,,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "layer-off.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);
        const r1TrackCommands = getTimecodeTrackCommands(commands, "R2MA layeroff", 1);
        const r1FxTrackCommands = getTimecodeTrackCommands(commands, "R2MA layeroff", 2);
        const r1VoixTrackCommands = getTimecodeTrackCommands(commands, "R2MA layeroff", 3);
        const r2FxTrackCommands = getTimecodeTrackCommands(commands, "R2MA layeroff", 5);

        assert.deepEqual(
            artifacts.regionLayerSequences.map((sequence) => `${sequence.regionId}:${sequence.layerName}`),
            ["R1:FX", "R1:Voix", "R2:FX"],
        );
        assert.equal(r1TrackCommands.includes('Set 5 "TIME" "11.000"'), true);
        assert.equal(r1TrackCommands.includes('Set 5 "TOKEN" "Off"'), true);
        assert.equal(r1FxTrackCommands.includes('Set 3 "TIME" "4"'), true);
        assert.equal(r1FxTrackCommands.includes('Set 3 "TOKEN" "Off"'), true);
        assert.equal(r1FxTrackCommands.includes('Set 4 "TIME" "5"'), true);
        assert.equal(r1FxTrackCommands.includes('Set 4 "TOKEN" "Off"'), true);
        assert.equal(r1FxTrackCommands.includes('Set 5 "TOKEN" "Off"'), false);
        assert.equal(r1FxTrackCommands.includes('Assign DataPool "R2MA layeroff" Sequence 2 Cue 2 At Timecode 1.1.2.1.1.3'), false);
        assert.equal(r1VoixTrackCommands.includes('Set 3 "TIME" "5"'), true);
        assert.equal(r1VoixTrackCommands.includes('Set 3 "TOKEN" "Off"'), true);
        assert.equal(r1VoixTrackCommands.includes('Set 4 "TOKEN" "Off"'), false);
        assert.equal(r2FxTrackCommands.includes('Set 3 "TIME" "9"'), true);
        assert.equal(r2FxTrackCommands.includes('Set 3 "TOKEN" "Off"'), true);
        assert.equal(r2FxTrackCommands.includes('Set 4 "TOKEN" "Off"'), false);
        assert.equal(r2FxTrackCommands.includes('Assign DataPool "R2MA layeroff" Sequence 5 Cue 2 At Timecode 1.2.2.1.1.3'), false);
    });

    it("creates layer pre-roll cues and keeps auto-off as a separate end event", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region A,10,20,10,
1,[LAYER=FX] Impact,12,,,
`;
        const defaultArtifacts = convertReaperCsvToArtifacts(csv, "auto-layer-off.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const disabledArtifacts = convertReaperCsvToArtifacts(csv, "auto-layer-off-disabled.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
            autoOffRegionLayers: false,
        });
        const customPreRollArtifacts = convertReaperCsvToArtifacts(csv, "auto-layer-pre-roll-custom.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
            regionLayerPreRollMs: 250,
        });
        const noPreRollArtifacts = convertReaperCsvToArtifacts(csv, "auto-layer-pre-roll-disabled.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
            regionLayerPreRollEnabled: false,
        });
        const defaultLayerTrack = getTimecodeTrackCommands(getMacroCommands(defaultArtifacts.macroXml), "R2MA autolayeroff", 2);
        const disabledLayerTrack = getTimecodeTrackCommands(getMacroCommands(disabledArtifacts.macroXml), "R2MA autolayeroffdisabled", 2);
        const customPreRollLayerTrack = getTimecodeTrackCommands(getMacroCommands(customPreRollArtifacts.macroXml), "R2MA autolayerprerollcustom", 2);
        const noPreRollCommands = getMacroCommands(noPreRollArtifacts.macroXml);
        const noPreRollLayerTrack = getTimecodeTrackCommands(noPreRollCommands, "R2MA autolayerprerolldisabled", 2);
        const defaultTimeline = createTimelinePreview(defaultArtifacts, {
            ...baseSettings,
            importMode: "regions-and-markers",
        });

        assert.equal(defaultLayerTrack.includes('Set 1 "TIME" "9.250"'), true);
        assert.equal(defaultLayerTrack.includes('Set 1 "TOKEN" "Go+"'), true);
        assert.equal(defaultLayerTrack.includes('Assign DataPool "R2MA autolayeroff" Sequence 2 Cue 1 At Timecode 1.1.2.1.1.1'), true);
        assert.equal(defaultLayerTrack.includes('Set 3 "TIME" "20"'), true);
        assert.equal(defaultLayerTrack.includes('Set 3 "TOKEN" "Off"'), true);
        assert.equal(defaultLayerTrack.includes('Assign DataPool "R2MA autolayeroff" Sequence 2 Cue 2 At Timecode 1.1.2.1.1.3'), false);
        assert.equal(disabledLayerTrack.some((command) => command.includes('"TOKEN" "Off"')), false);
        assert.equal(customPreRollLayerTrack.includes('Set 1 "TIME" "9.750"'), true);
        assert.equal(customPreRollLayerTrack.includes('Set 1 "TOKEN" "Go+"'), true);
        assert.equal(noPreRollCommands.includes('Label DataPool "R2MA autolayerprerolldisabled" Sequence 2 Cue 1 "Layer Pre-Roll"'), false);
        assert.equal(noPreRollLayerTrack.includes('Set 1 "TIME" "12"'), true);
        assert.deepEqual(defaultTimeline.tracks[1].events.map((event) => ({ timestamp: event.timestamp, token: event.token, label: event.label })), [
            { timestamp: "9.250", token: "Go+", label: "Layer Pre-Roll" },
            { timestamp: "12", token: "Go+", label: "Impact" },
            { timestamp: "20", token: "Off", label: "Auto Off FX" },
        ]);
    });

    it("warns for layer Off markers without a target region or missing target layer", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region A,0,5,5,
1,[LAYER=FX] Impact,1,,,
2,[OFF_LAYER=Missing] Stop Missing,2,,,
3,[OFF_LAYER=FX] Outside,6,,,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "layer-off-warnings.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });

        assert.equal(
            artifacts.validationWarnings.some((warning) => warning.includes("[OFF_LAYER=Missing]") && warning.includes("does not exist")),
            true,
        );
        assert.equal(
            artifacts.validationWarnings.some((warning) => warning.includes("[OFF_LAYER=FX]") && warning.includes("without a target region")),
            true,
        );
    });

    it("merges region boundary cue names with markers at the same timestamp", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region A,0,10,10,
1,Intro Cue,0,,,
2,[R1] Outro Cue,10,,,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "boundary-merge.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);

        assert.deepEqual(
            artifacts.regionSequences[0].cues.map((cue) => ({
                cueNumber: cue.cueNumber,
                name: cue.name,
            })),
            [
                { cueNumber: 1, name: "Region Start + Intro Cue" },
                { cueNumber: 2, name: "Region End + Outro Cue" },
            ],
        );
        assert.deepEqual(
            artifacts.regionSequences[0].events.map((event) => ({
                timestamp: event.timestamp,
                cueName: event.cueName,
            })),
            [
                { timestamp: "0", cueName: "Region Start + Intro Cue" },
                { timestamp: "9.250", cueName: "Region End + Outro Cue" },
            ],
        );
        assert.equal(commands.includes('Label DataPool "R2MA boundarymerge" Sequence 1 Cue 1 "Region Start + Intro Cue"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA boundarymerge" Sequence 1 Cue 2 "Region End + Outro Cue"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA boundarymerge" Sequence 1 Cue 3'), false);
    });

    it("merges the shifted region end cue with markers near the region end", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region A,0,10,10,
1,Last Marker,9.950,,,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "near-region-end.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);

        assert.deepEqual(
            artifacts.regionSequences[0].events.map((event) => ({
                timestamp: event.timestamp,
                cueName: event.cueName,
            })),
            [
                { timestamp: "0", cueName: "Region Start" },
                { timestamp: "9.250", cueName: "Region End + Last Marker" },
            ],
        );
        assert.equal(commands.includes('Label DataPool "R2MA nearregionend" Sequence 1 Cue 2 "Region End + Last Marker"'), true);
        assert.equal(commands.includes('Set 2 "TIME" "9.250"'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA nearregionend" Sequence 1 Cue 2 At Timecode 1.1.1.1.1.2'), true);
        assert.equal(commands.includes('Label DataPool "R2MA nearregionend" Sequence 1 Cue 3'), false);
    });

    it("uses the configured region end pre-roll when no marker is in the final window", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region A,0,10,10,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "custom-region-end-pre-roll.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
            regionEndPreRollMs: 250,
        });
        const commands = getMacroCommands(artifacts.macroXml);

        assert.deepEqual(
            artifacts.regionSequences[0].events.map((event) => ({
                timestamp: event.timestamp,
                cueName: event.cueName,
            })),
            [
                { timestamp: "0", cueName: "Region Start" },
                { timestamp: "9.750", cueName: "Region End" },
            ],
        );
        assert.equal(commands.includes('Set 2 "TIME" "9.750"'), true);
    });

    it("merges region end with the latest marker inside the pre-roll window", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region A,0,10,10,
1,Near Marker,9.400,,,
2,Latest Marker,9.800,,,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "latest-region-end-marker.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);

        assert.deepEqual(
            artifacts.regionSequences[0].events.map((event) => ({
                timestamp: event.timestamp,
                cueName: event.cueName,
            })),
            [
                { timestamp: "0", cueName: "Region Start" },
                { timestamp: "9.400", cueName: "Near Marker" },
                { timestamp: "9.250", cueName: "Region End + Latest Marker" },
            ],
        );
        assert.equal(commands.includes('Label DataPool "R2MA latestregionendmarker" Sequence 1 Cue 3 "Region End + Latest Marker"'), true);
		assert.equal(commands.includes('Set 2 "TIME" "9.250"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA latestregionendmarker" Sequence 1 Cue 4'), false);
    });

    it("merges a marker exactly at region end while keeping the event before the off boundary", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region A,0,10,10,
1,[R1] Exact End Marker,10,,,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "exact-region-end-marker.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);

        assert.deepEqual(
            artifacts.regionSequences[0].events.map((event) => ({
                timestamp: event.timestamp,
                cueName: event.cueName,
            })),
            [
                { timestamp: "0", cueName: "Region Start" },
                { timestamp: "9.250", cueName: "Region End + Exact End Marker" },
            ],
        );
        assert.equal(commands.includes('Label DataPool "R2MA exactregionendmarker" Sequence 1 Cue 2 "Region End + Exact End Marker"'), true);
        assert.equal(commands.includes('Set 2 "TIME" "9.250"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA exactregionendmarker" Sequence 1 Cue 3'), false);
    });

    it("keeps region end inside regions shorter than the pre-roll", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Short Region,0,0.5,0.5,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "short-region.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });

        assert.deepEqual(
            artifacts.regionSequences[0].events.map((event) => ({
                timestamp: event.timestamp,
                cueName: event.cueName,
            })),
            [
                { timestamp: "0", cueName: "Region Start" },
                { timestamp: "0.499", cueName: "Region End" },
            ],
        );
    });

    it("adds automatic start and end cues to empty region sequences", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Empty Region,4,12,8,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "empty-region.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);

        assert.equal(artifacts.regionSequences.length, 1);
        assert.deepEqual(
            artifacts.regionSequences[0].cues.map((cue) => ({
                cueNumber: cue.cueNumber,
                name: cue.name,
            })),
            [
                { cueNumber: 1, name: "Region Start" },
                { cueNumber: 2, name: "Region End" },
            ],
        );
        assert.deepEqual(
            artifacts.regionSequences[0].events.map((event) => ({
                timestamp: event.timestamp,
                cueName: event.cueName,
            })),
            [
                { timestamp: "4", cueName: "Region Start" },
                { timestamp: "11.250", cueName: "Region End" },
            ],
        );
        assert.equal(commands.includes('Label DataPool "R2MA emptyregion" Sequence 1 Cue 1 "Region Start"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA emptyregion" Sequence 1 Cue 2 "Region End"'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA emptyregion" Sequence 1 Cue 2 At Timecode 1.1.1.1.1.2'), true);
    });

    it("creates BPM events from BPM tags on region names", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,[BPM_129.5] Chorus,10,20,10,#00BFFF
1,[BPM_120] Downbeat,12,,,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "region-bpm.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);
        const bpmTrackCommands = getTimecodeTrackCommands(commands, "R2MA regionbpm", 2);

        assert.equal(artifacts.regionSequences[0].regionLabel, "Chorus");
        assert.equal(artifacts.regionSequences[0].displayName, "MA R1 - Chorus");
        assert.equal(artifacts.bpmSequence?.sequenceNumber, 9003);
        assert.deepEqual(
            artifacts.bpmSequence?.events.map((event) => ({
                displayName: event.displayName,
                timestamp: event.timestamp,
                bpmText: event.bpmText,
            })),
            [
                { displayName: "Chorus", timestamp: "10", bpmText: "129.5" },
                { displayName: "Downbeat", timestamp: "12", bpmText: "120" },
            ],
        );
        assert.equal(commands.includes('Store DataPool "R2MA regionbpm" Sequence 1 "MA R1 - Chorus"'), true);
        assert.equal(commands.includes('Store DataPool "R2MA regionbpm" Sequence 2 "MA BPM"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA regionbpm" Sequence 2 Cue 1 "BPM 129.5"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA regionbpm" Sequence 2 Cue 2 "BPM 120"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA regionbpm" Sequence 2 Cue 1 Property "Command" "Master 3.4 At BPM 129.5"'), true);
        assert.equal(bpmTrackCommands.includes('Set 1 "TIME" "10"'), true);
        assert.equal(bpmTrackCommands.includes('Set 1 "TOKEN" "Go+"'), true);
        assert.equal(bpmTrackCommands.includes('Set 1 "TOKEN" "Temp"'), false);
        assert.equal(bpmTrackCommands.includes('Set 2 "TIME" "12"'), true);
        assert.equal(artifacts.macroXml.includes("BPM_129.5"), false);
    });

    it("calculates timecode duration from the latest generated event", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region A,10,20,10,
1,Main Cue,0,,,
2,Repeated Cue,5,,,19005190
3,[Temp] Bump Cue,8,,,19005190
4,Region Cue,19,,,
5,[BPM_120] Late BPM,25,,,33554431
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "duration.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const preview = createConversionPreview(artifacts, 5);
        const commands = getMacroCommands(artifacts.macroXml);

        assert.equal(commands.includes('set 1 DURATION="26.500"'), true);
        assert.equal(preview.duration, "26.500");
    });

    it("falls back to the cue number for an unlabeled marker inside a region", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region A,0,10,10,
1,,1,,,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "blank-cue.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });

        assert.equal(artifacts.regionSequences.length, 1);
        assert.deepEqual(artifacts.regionSequences[0].cues.map((cue) => cue.name), ["Region Start", "Cue 2", "Region End"]);
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Label DataPool "R2MA blankcue" Sequence 1 Cue 2 "Cue 2"'), true);
    });

    it("assigns sequence and cue appearances independently in hybrid mode", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region A,0,10,10,123456
1,Marker A,1,,,
2,Marker B,2,,,654321
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "appearance-region.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });

        assert.equal(artifacts.regionSequences[0].appearanceName, "R2MA Color 123456");
        assert.equal(artifacts.regionSequences[0].cues[2].appearanceName, "R2MA Color 654321");
        assert.equal(artifacts.regionSequences[0].cues[2].appearanceColor, 'COLOR="1,1,1,0" BackR=9 BackG=251 BackB=241 BackAlpha=221');
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Set DataPool "R2MA appearanceregion" Sequence 1 APPEARANCE="R2MA Color 123456"'), true);
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Set DataPool "R2MA appearanceregion" Sequence 1 Cue 3 APPEARANCE="R2MA Color 654321"'), true);
    });

    it("lets uncolored layers inherit a lightened region color while explicit layer colors win", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Black Region,0,10,10,#000000
1,[LAYER=FX] Inherited Hit,2,,,
2,[LAYER=Color] Explicit Hit,3,,,#112233
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "layer-inherited-color.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);
        const timeline = createTimelinePreview(artifacts, {
            ...baseSettings,
            importMode: "regions-and-markers",
        });

        assert.deepEqual(
            artifacts.regionLayerSequences.map((sequence) => ({
                layerName: sequence.layerName,
                color: sequence.color,
                appearanceName: sequence.appearanceName,
                appearanceNumber: sequence.appearanceNumber,
                cueAppearances: sequence.cues.map((cue) => cue.appearanceName),
            })),
            [
                {
                    layerName: "FX",
                    color: "#3D3D3D",
                    appearanceName: "R2MA Color #3D3D3D",
                    appearanceNumber: 9002,
                    cueAppearances: ["R2MA Color #3D3D3D", "R2MA Color #3D3D3D"],
                },
                {
                    layerName: "Color",
                    color: "#112233",
                    appearanceName: "R2MA Color #112233",
                    appearanceNumber: 9003,
                    cueAppearances: ["R2MA Color #112233", "R2MA Color #112233"],
                },
            ],
        );
        assert.deepEqual(timeline.tracks.map((track) => track.color), ["rgb(0, 0, 0)", "rgb(61, 61, 61)", "rgb(17, 34, 51)"]);
        assert.equal(commands.includes('Label Appearance 9002 "R2MA Color #3D3D3D"'), true);
        assert.equal(commands.includes('Set Appearance 9002 COLOR="1,1,1,0" BackR=61 BackG=61 BackB=61 BackAlpha=221'), true);
        assert.equal(commands.includes('Set DataPool "R2MA layerinheritedcolor" Sequence 2 APPEARANCE="R2MA Color #3D3D3D"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA layerinheritedcolor" Sequence 2 Cue 1 APPEARANCE="R2MA Color #3D3D3D"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA layerinheritedcolor" Sequence 3 APPEARANCE="R2MA Color #112233"'), true);
    });

    it("lets uncolored bumps inherit a lighter region color while explicit bump colors win", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Black Region,0,10,10,#000000
1,[Temp] HIT,1,,,
2,[Flash] SNAP,2,,,#112233
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "bump-inherited-color.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);
        const timeline = createTimelinePreview(artifacts, {
            ...baseSettings,
            importMode: "regions-and-markers",
        });

        assert.deepEqual(
            artifacts.bumpSequences.map((sequence) => ({
                color: sequence.color,
                displayName: sequence.displayName,
                appearanceName: sequence.appearanceName,
                appearanceNumber: sequence.appearanceNumber,
                cueAppearances: sequence.cues.map((cue) => cue.appearanceName),
            })),
            [
                {
                    color: "#6B6B6B",
                    displayName: "MA R1 - Black Region - BUMP - HIT",
                    appearanceName: "R2MA Color #6B6B6B",
                    appearanceNumber: 9002,
                    cueAppearances: ["R2MA Color #6B6B6B"],
                },
                {
                    color: "#112233",
                    displayName: "MA R1 - Black Region - BUMP - SNAP",
                    appearanceName: "R2MA Color #112233",
                    appearanceNumber: 9003,
                    cueAppearances: ["R2MA Color #112233"],
                },
            ],
        );
        assert.deepEqual(timeline.tracks.map((track) => track.color), ["rgb(0, 0, 0)", "rgb(107, 107, 107)", "rgb(17, 34, 51)"]);
        assert.equal(commands.includes('Label Appearance 9002 "R2MA Color #6B6B6B"'), true);
        assert.equal(commands.includes('Set Appearance 9002 COLOR="1,1,1,0" BackR=107 BackG=107 BackB=107 BackAlpha=221'), true);
        assert.equal(commands.includes('Set DataPool "R2MA bumpinheritedcolor" Sequence 2 APPEARANCE="R2MA Color #6B6B6B"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA bumpinheritedcolor" Sequence 2 Cue 1 APPEARANCE="R2MA Color #6B6B6B"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA bumpinheritedcolor" Sequence 3 APPEARANCE="R2MA Color #112233"'), true);
    });

    it("keeps global bumps in the global timecode group while region bumps stay with their region", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region A,0,10,10,#000000
1,[GLOBAL][Temp] Global Hit,1,,,
2,[Temp] Local Hit,2,,,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "global-bump-group.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);

        assert.deepEqual(
            artifacts.bumpSequences.map((sequence) => ({
                displayName: sequence.displayName,
                regionId: sequence.regionId,
            })),
            [
                { displayName: "MA 1 - BUMP - Global Hit", regionId: undefined },
                { displayName: "MA R1 - Region A - BUMP - Local Hit", regionId: "R1" },
            ],
        );
        assert.equal(commands.includes('Label DataPool "R2MA globalbumpgroup" Timecode 1.1 "Global"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA globalbumpgroup" Timecode 1.2 "MA R1 - Region A"'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA globalbumpgroup" Sequence 2 Cue 1 At Timecode 1.1.1.1.1.1'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA globalbumpgroup" Sequence 3 Cue 1 At Timecode 1.2.2.1.1.1'), true);
    });

    it("keeps layer and bump color fallbacks when a region color is unreadable", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Bad Region,0,10,10,not-a-color
1,[LAYER=FX] Layer Hit,1,,,
2,[Temp] Bump Hit,2,,,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "invalid-region-color.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);
        const timeline = createTimelinePreview(artifacts, {
            ...baseSettings,
            importMode: "regions-and-markers",
        });

        assert.equal(artifacts.regionSequences[0].appearanceName, undefined);
        assert.equal(artifacts.regionLayerSequences[0].color, "");
        assert.equal(artifacts.regionLayerSequences[0].appearanceName, undefined);
        assert.deepEqual(artifacts.regionLayerSequences[0].cues.map((cue) => cue.appearanceName), [undefined, undefined]);
        assert.equal(artifacts.bumpSequences[0].color, "");
        assert.equal(artifacts.bumpSequences[0].appearanceName, undefined);
        assert.deepEqual(timeline.tracks.map((track) => track.color), ["#20c7d8", "#ff7ab6", "#f59e0b"]);
        assert.equal(commands.some((command) => command.includes("not-a-color")), false);
        assert.equal(commands.some((command) => command.includes("APPEARANCE=")), false);
    });

    it("does not create grandMA3 appearances for unreadable repeated marker colors", () => {
        const csv = `#,Name,Start,Color
1,Bad Color,0,not-a-color
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "invalid-marker-color.csv", baseSettings);
        const commands = getMacroCommands(artifacts.macroXml);

        assert.equal(artifacts.repeatedSequences.length, 1);
        assert.equal(artifacts.repeatedSequences[0].appearanceName, undefined);
        assert.equal(commands.some((command) => command.includes("Store Appearance")), false);
        assert.equal(commands.some((command) => command.includes("APPEARANCE=")), false);
    });

    it("emits OFF before ON for compact region action tags", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Region One,0,5,5,
R2,Region Two,5,10,5,
1,[OFF_R1|ON_R2] Cue,1,,,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "region-actions.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);
        const offTokenIndex = commands.indexOf('Set 2 "TOKEN" "Off"');
        const onTokenIndex = commands.indexOf('Set 1 "TOKEN" "Go+"', offTokenIndex + 1);

        assert.notEqual(offTokenIndex, -1);
        assert.notEqual(onTokenIndex, -1);
        assert.ok(offTokenIndex < onTokenIndex);
        assert.equal(commands.includes('Assign DataPool "R2MA regionactions" Sequence 2 Cue 1 At Timecode 1.2.1.1.1.1'), true);
        assert.equal(commands.includes('Set 5 "TIME" "6.000"'), false);
    });

    it("ignores region rows in markers-only mode", () => {
        const artifacts = convertReaperCsvToArtifacts(regionFixtureCsv, "regions-markers-demo.csv", baseSettings);

        assert.equal(artifacts.regionSequences.length, 0);
        assert.equal(artifacts.uniqueCues.length, 3);
        assert.equal(artifacts.repeatedSequences.length, 2);
        assert.equal(artifacts.bumpSequences.length, 1);
    });

    it("creates standalone example macro exports by group with a CSV filename fallback", () => {
        const outputFiles = createExampleMacroPresetOutputFiles({
            sourceFileName: "demo-show.csv",
            timecodeName: "",
            selection: {
                showTime: true,
                timecodeControl: false,
            },
        });

        assert.deepEqual(outputFiles.map((file) => file.name), ["show-time-manuel.xml", "show-time-auto-restore.xml"]);
        assert.equal(outputFiles[0].content.includes('Macro Name="SHOW TIME MANUEL"'), true);
        assert.equal(outputFiles[0].content.includes('Off Timecode &quot;demo-show&quot;'), true);
        assert.equal(outputFiles[0].content.includes('Macro &quot;RESET&quot;'), false);
        assert.equal(outputFiles[1].content.includes('Macro Name="SHOW TIME AUTO RESTORE"'), true);
        assert.equal(outputFiles[1].content.includes('Go+ Timecode &quot;demo-show&quot;'), true);
    });

    it("creates the timecode control macro presets independently", () => {
        const outputFiles = createExampleMacroPresetOutputFiles({
            sourceFileName: "show.csv",
            timecodeName: "custom-timecode",
            selection: {
                showTime: false,
                timecodeControl: true,
            },
        });

        assert.deepEqual(outputFiles.map((file) => file.name), [
            "timecode-switch-int.xml",
            "timecode-switch-ltc.xml",
            "timecode-rewind-and-switch-int.xml",
            "timecode-rewind-tc-and-switch-ltc.xml",
        ]);
        assert.equal(outputFiles[0].content.includes('Macro Name="Timecode Switch INT"'), true);
        assert.equal(outputFiles[0].content.includes('Set Timecode &quot;custom-timecode&quot; &quot;TCSlot&quot; -2'), true);
        assert.equal(outputFiles[2].content.includes('Pause Timecode &quot;custom-timecode&quot;'), true);
    });

    it("resolves the example macro timecode name from the CSV basename when blank", () => {
        assert.equal(resolveExampleMacroTimecodeName("", "Demo Show 2026.csv"), "Demo Show 2026");
        assert.equal(resolveExampleMacroTimecodeName("manual-name", "Demo Show 2026.csv"), "manual-name");
    });

    it("omits the timecode export in cues-only mode", () => {
        const artifacts = convertReaperCsvToArtifacts(fixtureCsv, "demo.csv", {
            ...baseSettings,
            exportMode: "cues-only",
        });
        const commands = getMacroCommands(artifacts.macroXml);

        assert.deepEqual(createConversionOutputFiles(artifacts).map((file) => file.name), ["demo_macro.xml"]);
        assert.equal(commands.includes('Store DataPool "R2MA demo" Timecode 1'), false);
        assert.equal(commands.includes('Store Type "CmdSubTrack" 1'), false);
        assert.equal(commands.includes('Move DataPool "R2MA demo" Timecode 1 Thru At Timecode 1'), false);
        assert.equal(commands.includes('Assign DataPool "R2MA demo" Sequence 1 At Page 1.201'), true);
        assert.equal(commands.includes('Move DataPool "R2MA demo" Sequence 1 Thru At Sequence 9001'), true);
    });

    it("keeps the current file name normalization semantics", () => {
        assert.equal(normalizeOutputBaseName("Song 01.CSV"), "songcsv");
        assert.equal(buildOutputFileName("demo", "macro"), "demo_macro.xml");
    });

    it("resolves the numeric UI Speed Master to the grandMA3 Master 3.X address", () => {
        assert.equal(resolveSpeedMaster(1), "3.1");
        assert.equal(resolveSpeedMaster(4), "3.4");
        assert.equal(resolveSpeedMaster(15), "3.15");
        assert.throws(() => resolveSpeedMaster(0), /1 to 15/);
        assert.throws(() => resolveSpeedMaster(16), /1 to 15/);
        assert.throws(() => resolveSpeedMaster(1.5), /1 to 15/);
    });

    it("parses raw CSV rows with the expected headers", () => {
        const rows = parseReaperMarkerRows(fixtureCsv);
        const { uniqueCues, repeatedMarkers, bumpMarkers } = splitMarkerRows(normalizeMarkerRows(rows));

        assert.equal(uniqueCues.length, 3);
        assert.equal(repeatedMarkers.length, 3);
        assert.equal(bumpMarkers.length, 0);
        assert.equal(uniqueCues[0].displayName, "Intro");
        assert.equal(uniqueCues[1].displayName, "Intro");
        assert.equal(uniqueCues[2].displayName, "Outro");
        assert.equal(repeatedMarkers[0].displayName, "SD");
        assert.equal(repeatedMarkers[1].displayName, "SD");
    });

    it("uses the execution token from a bracket suffix in generated XML", () => {
        const csv = `#,Name,Start,Color
1,Intro [Load],0,
2,SD [Go+],1,19005190
3,SD,2,19005190
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "tokens.csv", baseSettings);
        const commands = getMacroCommands(artifacts.macroXml);

        assert.equal(commands.includes('Label DataPool "R2MA tokens" Sequence 1 Cue 1 "Intro"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA tokens" Sequence 2 Cue 1 "Start"'), true);
        assert.equal(commands.includes('Set 1 "TOKEN" "Load"'), true);
        assert.equal(commands.includes('Set 1 "TOKEN" "Go+"'), true);
        assert.equal(commands.includes('Set 2 "TOKEN" "Go+"'), true);
    });

    it("honors a configurable appearance start id", () => {
        const csv = `#,Name,Start,Color
1,SD,0,19005190
2,Crash,1,33554431
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "appearances.csv", {
            ...baseSettings,
            appearanceStartNumber: 50,
        });

        assert.deepEqual(
            artifacts.repeatedSequences.map((sequence) => ({
                appearanceName: sequence.appearanceName,
                appearanceNumber: sequence.appearanceNumber,
                appearanceColor: sequence.appearanceColor,
            })),
            [
                { appearanceName: "R2MA Color 19005190", appearanceNumber: 50, appearanceColor: 'COLOR="1,1,1,0" BackR=33 BackG=255 BackB=6 BackAlpha=221' },
                { appearanceName: "R2MA Color 33554431", appearanceNumber: 51, appearanceColor: 'COLOR="1,1,1,0" BackR=255 BackG=255 BackB=255 BackAlpha=221' },
            ],
        );
        assert.equal(artifacts.macroXml.includes('Command="Store Appearance 50"'), true);
        assert.equal(artifacts.macroXml.includes('Command="Label Appearance 50 &quot;R2MA Color 19005190&quot;"'), true);
        assert.equal(artifacts.macroXml.includes('Command="Store Appearance 51"'), true);
        assert.equal(artifacts.macroXml.includes('Command="Label Appearance 51 &quot;R2MA Color 33554431&quot;"'), true);
    });

    it("creates a dedicated BPM sequence when BPM tags are present", () => {
        const csv = `#,Name,Start,Color
1,[BPM_129.5|X_foo] Intro [Load],0,
2,Verse,1,
3,[BPM_123.45] SD [Go+],2,19005190
4,SD,3,19005190
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "bpm.csv", baseSettings);
        const commands = getMacroCommands(artifacts.macroXml);

        assert.equal(artifacts.uniqueCues.length, 2);
        assert.equal(artifacts.repeatedSequences.length, 1);
        assert.equal(artifacts.bumpSequences.length, 0);
        assert.equal(artifacts.bpmSequence?.sequenceNumber, 9003);
        assert.equal(artifacts.bpmSequence?.displayName, "MA BPM");
        assert.equal(artifacts.bpmSequence?.events.length, 2);
        assert.equal(artifacts.bpmSequence?.releaseDurationSeconds, "0.5");
        assert.equal(commands.includes('Set DataPool "R2MA bpm" Sequence 3 Property "SpeedMaster" #[Master 3.4]'), true);
        assert.equal(commands.includes('Store DataPool "R2MA bpm" Sequence 3 "MA BPM"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA bpm" Sequence 3 "MA BPM"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA bpm" Sequence 3 Cue 1 "BPM 129.5"'), true);
        assert.equal(commands.includes('Label DataPool "R2MA bpm" Sequence 3 Cue 2 "BPM 123.45"'), true);
        assert.equal(artifacts.macroXml.includes('Master 3.4 At BPM 129.5'), true);
        assert.equal(artifacts.macroXml.includes('Master 3.4 At BPM 123.45'), true);
        assert.equal(commands.includes('Set DataPool "R2MA bpm" Sequence 3 Cue 1 Property "Command" "Master 3.4 At BPM 129.5"'), true);
        assert.equal(commands.includes('Store DataPool "R2MA bpm" Timecode 1'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA bpm" Sequence 3 At Page 1.203'), false);
        assert.equal(commands.includes('Assign DataPool "R2MA bpm" Sequence 3 Cue 1 At Timecode 1.1.3.1.1.1'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA bpm" Sequence 3 Cue 2 At Timecode 1.1.3.1.1.2'), true);
        assert.equal(commands.includes('Set DataPool "R2MA bpm" Sequence 3 Cue 1 Property "Assert" "Yes"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA bpm" Sequence 3 Cue 2 Property "Assert" "Yes"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA bpm" Sequence 3.OffCue Property "TrigType" "Time"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA bpm" Sequence 3.OffCue Property "TrigTime" "0.5"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA bpm" Sequence 3.OffCue Property "CueFade" "0.5"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA bpm" Sequence 3 Property "UseExecutorTime" "No"'), true);

        const bpmTrackStart = commands.indexOf('Assign DataPool "R2MA bpm" Sequence 3 At 3');
        const bpmTrackEnd = commands.indexOf("cd root", bpmTrackStart + 1);
        const bpmTrackCommands = commands.slice(bpmTrackStart, bpmTrackEnd);

        assert.notEqual(bpmTrackStart, -1);
        assert.equal(bpmTrackCommands.includes('Set 1 "TOKEN" "Go+"'), true);
        assert.equal(bpmTrackCommands.includes('Set 2 "TIME" "2"'), true);
        assert.equal(bpmTrackCommands.includes('Set 2 "TOKEN" "Go+"'), true);
        assert.equal(bpmTrackCommands.some((command) => command.includes("TempRelease")), false);
        assert.equal(bpmTrackCommands.includes('Set 1 "TOKEN" "Temp"'), false);
        assert.equal(bpmTrackCommands.includes('Set 2 "TOKEN" "Temp"'), false);
    });

    it("applies cue fade commands to unique, repeated and bump cues", () => {
        const csv = `#,Name,Start,Color
1,[CueFade_5] Intro,0,
2,Verse,1,
3,[CueFade_6/12] Intro,2,19005190
4,[CueFade_3/] Hit,3,19005190
5,[Temp|CueFade_*2] Flash,4,19005190
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "cuefade.csv", baseSettings);

        assert.equal(artifacts.uniqueCues[0].cueFade, "5");
        assert.equal(artifacts.repeatedSequences[0].cues[0].cueFade, "6/12");
        assert.equal(artifacts.repeatedSequences[0].cues[1].cueFade, "3/");
        assert.equal(artifacts.bumpSequences[0].cues[0].cueFade, "*2");
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Set DataPool "R2MA cuefade" Sequence 1 Cue 1 CueFade 5'), true);
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Set DataPool "R2MA cuefade" Sequence 2 Cue 1 CueFade 6/12'), true);
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Set DataPool "R2MA cuefade" Sequence 2 Cue 2 CueFade 3/'), true);
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Set DataPool "R2MA cuefade" Sequence 3 Cue 1 CueFade *2'), true);
    });

    it("emits cue timing modifiers for repeated and bump cues", () => {
        const csv = `#,Name,Start,Color
1,Intro,0,
2,[FadeFromX_0.5|FadeToX_1.2] Verse,1,19005190
3,[FadeFromX_1.5|DelayToZ_2] Hit,2,19005190
4,[Temp|FadeFromY_0.25|DelayFromY_0.75] Flash,3,19005190
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "cue-timing.csv", baseSettings);

        assert.equal(artifacts.repeatedSequences[0].cues[0].cueTiming?.[0].key, "FadeFromX");
        assert.equal(artifacts.repeatedSequences[0].cues[0].cueTiming?.[0].value, "0.5");
        assert.equal(artifacts.repeatedSequences[0].cues[0].cueTiming?.[1].key, "FadeToX");
        assert.equal(artifacts.repeatedSequences[0].cues[1].cueTiming?.[0].key, "FadeFromX");
        assert.equal(artifacts.repeatedSequences[0].cues[1].cueTiming?.[1].key, "DelayToZ");
        assert.equal(artifacts.bumpSequences[0].cues[0].cueTiming?.[0].key, "FadeFromY");
        assert.equal(artifacts.bumpSequences[0].cues[0].cueTiming?.[1].key, "DelayFromY");
        assert.equal(
            getMacroCommands(artifacts.macroXml).includes('Set DataPool "R2MA cuetiming" Sequence 2 Cue 1 Part 0.1 FadeFromX "0.5" FadeToX "1.2"'),
            true,
        );
        assert.equal(
            getMacroCommands(artifacts.macroXml).includes('Set DataPool "R2MA cuetiming" Sequence 2 Cue 2 Part 0.1 FadeFromX "1.5" DelayToZ "2"'),
            true,
        );
        assert.equal(
            getMacroCommands(artifacts.macroXml).includes('Set DataPool "R2MA cuetiming" Sequence 3 Cue 1 Part 0.1 FadeFromY "0.25" DelayFromY "0.75"'),
            true,
        );
    });

    it("ignores invalid BPM tags without creating a BPM sequence", () => {
        const csv = `#,Name,Start,Color
1,[BPM_bad] Intro,0,
2,SD,1,19005190
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "invalid-bpm.csv", baseSettings);

        assert.equal(artifacts.bpmSequence, undefined);
        assert.equal(artifacts.uniqueCues[0].displayName, "Intro");
        assert.equal(artifacts.uniqueCues[0].bpm, undefined);
    });

    it("creates bump overlay sequences for Temp and Flash markers", () => {
        const csv = `#,Name,Start,Color
1,Intro,0,19005190
2,[Temp] HIT,1,19005190
3,[Flash] HIT,2,19005190
4,Verse,3,33554431
5,[Temp] HIT,4,33554431
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "bump.csv", baseSettings);

        assert.equal(artifacts.repeatedSequences.length, 2);
        assert.equal(artifacts.bumpSequences.length, 2);
        assert.equal(artifacts.bumpSequences[0].color, "19005190");
        assert.equal(artifacts.bumpSequences[0].displayName, "MA 1 - Intro - BUMP - HIT");
        assert.equal(artifacts.bumpSequences[0].cues[0].name, "Start");
        assert.equal(artifacts.bumpSequences[0].events[0].cueName, "Start");
        assert.equal(artifacts.bumpSequences[0].events[1].cueName, "Start");
        assert.equal(artifacts.bumpSequences[1].color, "33554431");
        assert.equal(artifacts.bumpSequences[1].displayName, "MA 1 - Verse - BUMP - HIT");
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Store DataPool "R2MA bump" Sequence 3 "MA 1 - Intro - BUMP - HIT"'), true);
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Store DataPool "R2MA bump" Sequence 4 "MA 1 - Verse - BUMP - HIT"'), true);
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Assign DataPool "R2MA bump" Sequence 1 At Page 1.201'), true);
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Assign DataPool "R2MA bump" Sequence 2 At Page 1.202'), true);
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Assign DataPool "R2MA bump" Sequence 3 At Page 1.101'), true);
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Assign DataPool "R2MA bump" Sequence 4 At Page 1.102'), true);
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Assign DataPool "R2MA bump" Sequence 3 At Page 1.203'), false);
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Assign DataPool "R2MA bump" Sequence 3 Cue 1 At Timecode 1.1.3.1.1.1'), true);
    });

    it("uses the configured bump page slot start for bump executor assignments", () => {
        const csv = `#,Name,Start,Color
1,Intro,0,19005190
2,[Temp] HIT,1,19005190
3,Verse,2,33554431
4,[Flash] SNAP,3,33554431
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "bump-custom.csv", {
            ...baseSettings,
            bumpPageSlotStart: 111,
        });
        const commands = getMacroCommands(artifacts.macroXml);

        assert.equal(commands.includes('Assign DataPool "R2MA bumpcustom" Sequence 1 At Page 1.201'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA bumpcustom" Sequence 2 At Page 1.202'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA bumpcustom" Sequence 3 At Page 1.111'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA bumpcustom" Sequence 4 At Page 1.112'), true);
    });

    it("can omit executor page assignments from the generated macro", () => {
        const csv = `#,Name,Start,Color
1,Intro,0,
2,[Temp] HIT,1,19005190
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "no-executors.csv", {
            ...baseSettings,
            assignExecutors: false,
        });
        const commands = getMacroCommands(artifacts.macroXml);

        assert.equal(commands.some((command) => command.includes(" At Page ")), false);
        assert.equal(commands.some((command) => command.startsWith("Label Page ")), false);
        assert.equal(commands.includes('Move DataPool "R2MA noexecutors" Sequence 1 Thru At Sequence 9001'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA noexecutors" Sequence 1 Cue 1 At Timecode 1.1.1.1.1.1'), true);
    });

    it("can restart executor slots on one page per region", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Verse,0,10,10,
R2,Chorus,10,20,10,
M1,Verse Cue,2,,,
M2,[LAYER=FX] Hit,4,,,F2FF00
M3,Chorus Cue,12,,,
`;
        const settings: ConversionSettings = {
            ...baseSettings,
            importMode: "regions-and-markers",
            pageNumber: 3,
            executorLayout: "region-per-page",
        };
        const artifacts = convertReaperCsvToArtifacts(csv, "region-page.csv", settings);
        const commands = getMacroCommands(artifacts.macroXml);
        const assignments = createExecutorAssignmentPreview(artifacts, settings);

        assert.deepEqual(
            assignments.map((assignment) => [assignment.sequenceNumber, assignment.pageNumber, assignment.slotNumber]),
            [[9002, 3, 201], [9003, 3, 202], [9004, 4, 201]],
        );
        assert.equal(commands.includes('Assign DataPool "R2MA regionpage" Sequence 1 At Page 3.201'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA regionpage" Sequence 2 At Page 3.202'), true);
        assert.equal(commands.includes('Assign DataPool "R2MA regionpage" Sequence 3 At Page 4.201'), true);
        assert.equal(commands.includes('Label Page 3 "regionpage - Verse"'), true);
        assert.equal(commands.includes('Label Page 4 "regionpage - Chorus"'), true);
    });

    it("pins a sequence to a manual executor address and packs the others around it", () => {
        const csv = `#,Name,Start,Color
1,Intro,0,
2,SD,1,19005190
3,BD,2,F2FF00
`;
        const settings: ConversionSettings = {
            ...baseSettings,
            executorOverrides: { "9002": { pageNumber: 2, slotNumber: 250 } },
        };
        const artifacts = convertReaperCsvToArtifacts(csv, "pinned.csv", settings);
        const assignments = createExecutorAssignmentPreview(artifacts, settings);

        assert.deepEqual(
            assignments.map((assignment) => [assignment.sequenceNumber, assignment.pageNumber, assignment.slotNumber]),
            [[9001, 1, 201], [9002, 2, 250], [9003, 1, 202]],
        );
        assert.equal(assignments.find((assignment) => assignment.sequenceNumber === 9002)?.pinned, true);
        assert.equal(getMacroCommands(artifacts.macroXml).includes('Assign DataPool "R2MA pinned" Sequence 2 At Page 2.250'), true);
    });

    it("reserves a pinned slot so an automatic sequence never lands on it", () => {
        const csv = `#,Name,Start,Color
1,Intro,0,
2,SD,1,19005190
3,BD,2,F2FF00
`;
        const settings: ConversionSettings = {
            ...baseSettings,
            executorOverrides: { "9003": { pageNumber: 1, slotNumber: 201 } },
        };
        const artifacts = convertReaperCsvToArtifacts(csv, "reserved.csv", settings);
        const assignments = createExecutorAssignmentPreview(artifacts, settings);

        assert.deepEqual(
            assignments.map((assignment) => [assignment.sequenceNumber, assignment.pageNumber, assignment.slotNumber]),
            [[9001, 1, 202], [9002, 1, 203], [9003, 1, 201]],
        );
        assert.deepEqual(findExecutorAddressConflicts(assignments), []);
    });

    it("ignores an incomplete override instead of producing a broken address", () => {
        const csv = `#,Name,Start,Color
1,Intro,0,
`;
        const settings: ConversionSettings = {
            ...baseSettings,
            executorOverrides: { "9001": { pageNumber: 2, slotNumber: Number.NaN } },
        };
        const artifacts = convertReaperCsvToArtifacts(csv, "invalid.csv", settings);

        assert.deepEqual(
            createExecutorAssignmentPreview(artifacts, settings).map((a) => [a.pageNumber, a.slotNumber]),
            [[1, 201]],
        );
    });

    it("groups contiguous destinations into runs and isolates the pinned one", () => {
        const sequences = [
            { localSequenceNumber: 1, effectiveSequenceNumber: 9001 },
            { localSequenceNumber: 2, effectiveSequenceNumber: 9002 },
            { localSequenceNumber: 3, effectiveSequenceNumber: 9080 },
            { localSequenceNumber: 4, effectiveSequenceNumber: 9004 },
            { localSequenceNumber: 5, effectiveSequenceNumber: 9005 },
        ];

        assert.deepEqual(createSequenceMoves(sequences), [
            { fromLocalNumber: 1, throughLocalNumber: 2, toSequenceNumber: 9001 },
            { fromLocalNumber: 3, toSequenceNumber: 9080 },
            { fromLocalNumber: 4, throughLocalNumber: 5, toSequenceNumber: 9004 },
        ]);
    });

    it("names every number claimed by more than one sequence", () => {
        assert.deepEqual(findSequenceNumberConflicts([9001, 9050, 9002, 9050, 9001]), [9001, 9050]);
        assert.deepEqual(findSequenceNumberConflicts([9001, 9002]), []);
    });

    it("keeps the historical block move when no sequence number is overridden", () => {
        const csv = `#,Name,Start,Color
1,Intro,0,
2,SD,1,19005190
3,BD,2,F2FF00
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "blockmove.csv", baseSettings);
        const moves = getMacroCommands(artifacts.macroXml).filter((command) => command.startsWith("Move DataPool") && command.includes("Sequence"));

        assert.deepEqual(moves, ['Move DataPool "R2MA blockmove" Sequence 1 Thru At Sequence 9001']);
    });

    it("splits the move into runs around an overridden sequence number", () => {
        const csv = `#,Name,Start,Color
1,Intro,0,
2,SD,1,19005190
3,BD,2,F2FF00
`;
        const settings: ConversionSettings = { ...baseSettings, sequenceNumberOverrides: { "9002": 9050 } };
        const artifacts = convertReaperCsvToArtifacts(csv, "splitmove.csv", settings);
        const moves = getMacroCommands(artifacts.macroXml).filter((command) => command.startsWith("Move DataPool") && command.includes("Sequence"));

        assert.deepEqual(moves, [
            'Move DataPool "R2MA splitmove" Sequence 1 At Sequence 9001',
            'Move DataPool "R2MA splitmove" Sequence 2 At Sequence 9050',
            'Move DataPool "R2MA splitmove" Sequence 3 At Sequence 9003',
        ]);
    });

    it("reports the overridden number in the executor assignment preview", () => {
        const csv = `#,Name,Start,Color
1,Intro,0,
2,SD,1,19005190
`;
        const settings: ConversionSettings = { ...baseSettings, sequenceNumberOverrides: { "9002": 9050 } };
        const artifacts = convertReaperCsvToArtifacts(csv, "renumbered.csv", settings);

        assert.deepEqual(
            createExecutorAssignmentPreview(artifacts, settings).map((assignment) => assignment.sequenceNumber),
            [9001, 9050],
        );
    });

    it("ignores a sequence number override that is out of range", () => {
        const csv = `#,Name,Start,Color
1,Intro,0,
`;
        const settings: ConversionSettings = { ...baseSettings, sequenceNumberOverrides: { "9001": 0 } };
        const artifacts = convertReaperCsvToArtifacts(csv, "outofrange.csv", settings);
        const moves = getMacroCommands(artifacts.macroXml).filter((command) => command.startsWith("Move DataPool") && command.includes("Sequence"));

        assert.deepEqual(moves, ['Move DataPool "R2MA outofrange" Sequence 1 Thru At Sequence 9001']);
    });

    it("reports an address claimed by two pinned sequences", () => {
        const csv = `#,Name,Start,Color
1,Intro,0,
2,SD,1,19005190
`;
        const settings: ConversionSettings = {
            ...baseSettings,
            executorOverrides: {
                "9001": { pageNumber: 1, slotNumber: 210 },
                "9002": { pageNumber: 1, slotNumber: 210 },
            },
        };
        const artifacts = convertReaperCsvToArtifacts(csv, "conflict.csv", settings);

        assert.deepEqual(findExecutorAddressConflicts(createExecutorAssignmentPreview(artifacts, settings)), ["1.210"]);
    });

    it("emits timed OffCue setup from inline, paired, fallback and Flash release tags", () => {
        const inlineCsv = `#,Name,Start,Color
1,[Temp|Release_250] HIT,0,19005190
`;
        const pairedCsv = `#,Name,Start,Color
1,[Temp] HIT,0,19005190
2,[TempRelease] Release,0.75,19005190
`;
        const fallbackCsv = `#,Name,Start,Color
1,[Temp] HIT,0,19005190
`;
        const flashCsv = `#,Name,Start,Color
1,[Flash|Release_120] HIT,0,19005190
`;

        const inlineArtifacts = convertReaperCsvToArtifacts(inlineCsv, "inline.csv", baseSettings);
        const pairedArtifacts = convertReaperCsvToArtifacts(pairedCsv, "paired.csv", baseSettings);
        const fallbackArtifacts = convertReaperCsvToArtifacts(fallbackCsv, "fallback.csv", baseSettings);
        const flashArtifacts = convertReaperCsvToArtifacts(flashCsv, "flash.csv", baseSettings);
        const inlineCommands = getMacroCommands(inlineArtifacts.macroXml);
        const pairedCommands = getMacroCommands(pairedArtifacts.macroXml);
        const fallbackCommands = getMacroCommands(fallbackArtifacts.macroXml);
        const flashCommands = getMacroCommands(flashArtifacts.macroXml);

        assert.equal(inlineArtifacts.bumpSequences[0].releaseDurationSeconds, "0.25");
        assert.equal(pairedArtifacts.bumpSequences[0].releaseDurationSeconds, "0.75");
        assert.equal(fallbackArtifacts.bumpSequences[0].releaseDurationSeconds, "0.2");
        assert.equal(flashArtifacts.bumpSequences[0].releaseDurationSeconds, "0.12");
        assert.equal(inlineCommands.includes('Set 1 "TOKEN" "Temp"'), true);
        assert.equal(inlineCommands.includes('Set 2 "TOKEN" "Off"'), false);
        assert.equal(inlineCommands.includes('Assign DataPool "R2MA inline" Sequence 1 Cue 1 At Timecode 1.1.1.1.1.1'), true);
        assert.equal(inlineCommands.includes('Assign DataPool "R2MA inline" Sequence 1 Cue 1 At Timecode 1.1.1.1.1.2'), false);
        assert.equal(inlineCommands.includes('Set DataPool "R2MA inline" Sequence 1 Cue 1 Property "Assert" "Yes"'), true);
        assert.equal(inlineCommands.includes('Set DataPool "R2MA inline" Sequence 1.OffCue Property "TrigType" "Time"'), true);
        assert.equal(inlineCommands.includes('Set DataPool "R2MA inline" Sequence 1.OffCue Property "TrigTime" "0.25"'), true);
        assert.equal(inlineCommands.includes('Set DataPool "R2MA inline" Sequence 1.OffCue Property "CueFade" "0.25"'), true);
        assert.equal(inlineCommands.includes('Set DataPool "R2MA inline" Sequence 1 Property "UseExecutorTime" "No"'), true);

        assert.equal(pairedCommands.includes('Set 1 "TOKEN" "Temp"'), true);
        assert.equal(pairedCommands.includes('Set 2 "TOKEN" "Off"'), false);
        assert.equal(pairedCommands.includes('Set DataPool "R2MA paired" Sequence 1.OffCue Property "TrigTime" "0.75"'), true);

        assert.equal(fallbackCommands.includes('Set 1 "TOKEN" "Temp"'), true);
        assert.equal(fallbackCommands.includes('Set 2 "TOKEN" "Off"'), false);
        assert.equal(fallbackCommands.includes('Set 2 "TIME" "0.001"'), false);
        assert.equal(fallbackCommands.includes('Set DataPool "R2MA fallback" Sequence 1.OffCue Property "TrigTime" "0.2"'), true);

        assert.equal(flashCommands.includes('Set 1 "TOKEN" "Flash"'), true);
        assert.equal(flashCommands.includes('Set 2 "TOKEN" "Off"'), false);
        assert.equal(flashCommands.includes('Set DataPool "R2MA flash" Sequence 1.OffCue Property "TrigTime" "0.12"'), true);
    });

    it("keeps the first explicit bump release duration and warns on conflicts", () => {
        const csv = `#,Name,Start,Color
1,[Temp|Release_250] HIT,0,19005190
2,[Temp|Release_750] HIT,1,19005190
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "conflict.csv", baseSettings);
        const commands = getMacroCommands(artifacts.macroXml);

        assert.equal(artifacts.bumpSequences[0].releaseDurationSeconds, "0.25");
        assert.equal(artifacts.validationWarnings.some((warning) => warning.includes("multiple release durations")), true);
        assert.equal(commands.includes('Set DataPool "R2MA conflict" Sequence 1.OffCue Property "TrigTime" "0.25"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA conflict" Sequence 1.OffCue Property "TrigTime" "0.75"'), false);
    });

    it("creates delayed Cue Parts without adding cues or timecode events", () => {
        const csv = `#,Name,Start,Color
1,Intro,10,
2,[PART|CueFade_0.2|FadeFromX_0.1] Dimmer Off,10.5,
3,[PART] Snap Off,10.5,
4,Verse,12,
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "cue-parts.csv", baseSettings);
        const commands = getMacroCommands(artifacts.macroXml);
        const introParts = artifacts.uniqueCues[0].cueParts;

        assert.equal(artifacts.uniqueCues.length, 2);
        assert.deepEqual(introParts, [
            {
                partNumber: 1,
                name: "Dimmer Off",
                sourceTimestamp: "10.5",
                cueDelay: "0.5",
                cueFade: "0.2",
                cueTiming: [{ key: "FadeFromX", value: "0.1" }],
            },
            {
                partNumber: 2,
                name: "Snap Off",
                sourceTimestamp: "10.5",
                cueDelay: "0.5",
            },
        ]);
        assert.equal(commands.filter((command) => command.includes('Property "AllowDuplicates" "Yes"')).length, 1);
        assert.equal(commands.includes('Store DataPool "R2MA cueparts" Sequence 1 Cue 1 /Overwrite'), true);
        assert.equal(commands.includes('Store DataPool "R2MA cueparts" Sequence 1 Cue 2 /Overwrite'), true);
        assert.equal(commands.includes('Store Type "StandardRecipe" DataPool "R2MA cueparts" Sequence 1 Cue 1 Part 0.1'), true);
        assert.equal(commands.includes('Store Type "StandardRecipe" DataPool "R2MA cueparts" Sequence 1 Cue 2 Part 0.1'), true);
        assert.equal(commands.includes('Store Type "StandardRecipe" DataPool "R2MA cueparts" Sequence 1 Cue 1 Part 1.1'), true);
        assert.equal(commands.includes('Store Type "StandardRecipe" DataPool "R2MA cueparts" Sequence 1 Cue 1 Part 2.1'), true);
        assert.equal(commands.includes('Label DataPool "R2MA cueparts" Sequence 1 Cue 1 Part 1 "Dimmer Off"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA cueparts" Sequence 1 Cue 1 Part 1 Property "CueDelay" "0.5"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA cueparts" Sequence 1 Cue 1 Part 1 Property "CueFade" "0.2"'), true);
        assert.equal(commands.includes('Set DataPool "R2MA cueparts" Sequence 1 Cue 1 Part 1.1 FadeFromX "0.1"'), true);
        assert.equal(commands.some((command) => command.includes('Part 2 Property "CueFade"')), false);
        assert.equal(commands.some((command) => command === 'Set 2 "TIME" "10.5"'), false);
        assert.equal(
            commands.some((command) => /^Store DataPool "R2MA cueparts" Sequence 1 Cue \d+ Part /.test(command)),
            false,
        );
        assert.equal(commands.filter((command) => command === 'Cook DataPool "R2MA cueparts" Sequence 1 /Overwrite').length, 1);

        const cueIndex = commands.indexOf('Store DataPool "R2MA cueparts" Sequence 1 Cue 1 /Overwrite');
        const mainRecipeIndex = commands.indexOf('Store Type "StandardRecipe" DataPool "R2MA cueparts" Sequence 1 Cue 1 Part 0.1');
        const allowIndex = commands.indexOf('Set DataPool "R2MA cueparts" Sequence 1 Cue 1 Property "AllowDuplicates" "Yes"');
        const recipeIndex = commands.indexOf('Store Type "StandardRecipe" DataPool "R2MA cueparts" Sequence 1 Cue 1 Part 1.1');
        const propertyIndex = commands.indexOf('Set DataPool "R2MA cueparts" Sequence 1 Cue 1 Part 1 Property "CueDelay" "0.5"');
        const cookIndex = commands.indexOf('Cook DataPool "R2MA cueparts" Sequence 1 /Overwrite');
        const timecodeIndex = commands.indexOf('Store DataPool "R2MA cueparts" Timecode 1');

        assert.equal(
            [cueIndex, mainRecipeIndex, allowIndex, recipeIndex, propertyIndex, cookIndex, timecodeIndex].every((index) => index >= 0),
            true,
        );
        assert.equal(cueIndex < mainRecipeIndex && mainRecipeIndex < allowIndex, true);
        assert.equal(allowIndex < recipeIndex && recipeIndex < propertyIndex, true);
        assert.equal(propertyIndex < cookIndex && cookIndex < timecodeIndex, true);
    });

    it("routes Cue Parts to region, layer, repeated and bump cues", () => {
        const csv = `#,Name,Start,End,Length,Color
R1,Verse,0,10,10,#00BFFF
1,Region Cue,1,,,
2,[PART] Region Off,1.25,,,
3,[LAYER=FX] Layer Cue,2,,,
4,[LAYER=FX|PART] Layer Off,2.4,,,
5,Repeated,11,,,19005190
6,[PART] Repeated Off,11.3,,,19005190
7,Repeated,12,,,19005190
8,[Temp] Hit,13,,,33554431
9,[Temp|PART] Hit Off,13.15,,,33554431
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "routed-parts.csv", {
            ...baseSettings,
            importMode: "regions-and-markers",
        });
        const commands = getMacroCommands(artifacts.macroXml);

        assert.equal(artifacts.regionSequences[0].cues.find((cue) => cue.name === "Region Cue")?.cueParts?.[0].cueDelay, "0.25");
        assert.equal(artifacts.regionLayerSequences[0].cues.find((cue) => cue.name === "Layer Cue")?.cueParts?.[0].cueDelay, "0.4");
        assert.equal(artifacts.repeatedSequences[0].events.length, 2);
        assert.equal(artifacts.repeatedSequences[0].cues[0].cueParts?.[0].cueDelay, "0.3");
        assert.equal(artifacts.bumpSequences[0].events.length, 1);
        assert.equal(artifacts.bumpSequences[0].cues[0].cueParts?.[0].cueDelay, "0.15");
        assert.equal(commands.includes('Store Type "StandardRecipe" DataPool "R2MA routedparts" Sequence 1 Cue 2 Part 1.1'), true);
        assert.equal(commands.includes('Store Type "StandardRecipe" DataPool "R2MA routedparts" Sequence 2 Cue 2 Part 1.1'), true);
        assert.equal(commands.includes('Store Type "StandardRecipe" DataPool "R2MA routedparts" Sequence 3 Cue 1 Part 1.1'), true);
        assert.equal(commands.includes('Store Type "StandardRecipe" DataPool "R2MA routedparts" Sequence 4 Cue 1 Part 1.1'), true);
        assert.equal(commands.filter((command) => command.startsWith('Cook DataPool "R2MA routedparts" Sequence ')).length, 4);
        assert.equal(
            commands
                .filter((command) => command.startsWith('Store DataPool "R2MA routedparts" Sequence ') && command.includes(" Cue "))
                .every((command) => command.endsWith("/Overwrite")),
            true,
        );
    });

    it("warns and ignores orphaned or incompatible Cue Part markers", () => {
        const csv = `#,Name,Start,Color
1,[PART] Orphan,0,
2,Intro,1,
3,[PART|BPM_120] Invalid BPM Part,1.5,
4,[Temp|PART|Release_250] Invalid Release Part,2,19005190
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "invalid-parts.csv", baseSettings);

        assert.equal(artifacts.uniqueCues.length, 1);
        assert.equal(artifacts.uniqueCues[0].cueParts, undefined);
        assert.equal(artifacts.bumpSequences.length, 0);
        assert.equal(artifacts.bpmSequence, undefined);
        assert.equal(artifacts.validationWarnings.some((warning) => warning.includes("has no previous cue")), true);
        assert.equal(artifacts.validationWarnings.some((warning) => warning.includes("BPM metadata")), true);
        assert.equal(artifacts.validationWarnings.some((warning) => warning.includes("bump release metadata")), true);
    });

    it("warns when the main sequence is empty", () => {
        const csv = `#,Name,Start,Color
1,SD,0,19005190
2,Crash,1,33554431
`;
        const artifacts = convertReaperCsvToArtifacts(csv, "warning.csv", baseSettings);
        const preview = createConversionPreview(artifacts, 2);

        assert.equal(preview.warnings.some((warning) => warning.includes("main sequence is empty")), true);
        assert.equal(artifacts.macroXml.includes("Cue 1 thru 0"), false);
        assert.equal(artifacts.macroXml.includes('Sequence 9001 Property &quot;SpeedMaster&quot;'), false);
    });
});

describe("reaper transport macro library", () => {
    it("matches the default fixture output", () => {
        const xml = generateReaperTransportMacros();

        assert.equal(xml, transportMacroFixture);
    });

    it("creates a valid macro library with the expected macro order and commands", () => {
        const xml = generateReaperTransportMacros();
        const parsed = parseXml(xml);
        const macros = Array.isArray(parsed.GMA3.Macro) ? parsed.GMA3.Macro : [parsed.GMA3.Macro];

        assert.equal(parsed.GMA3["@_DataVersion"], "2.4.2.2");
        assert.equal(macros.length, 8);
        assert.deepEqual(
            macros.map((macro: any) => macro["@_Name"]),
            [
                "REAPER - REWIND",
                "REAPER - PLAY",
                "REAPER - PAUSE",
                "REAPER - STOP",
                "REAPER - NEXT MARKER",
                "REAPER - PREV MARKER",
                "REAPER - NEXT REGION",
                "REAPER - PREV REGION",
            ],
        );
        assert.deepEqual(
            macros.map((macro: any) => {
                const lines = Array.isArray(macro.MacroLine) ? macro.MacroLine : [macro.MacroLine];
                return lines.map((line: any) => line["@_Command"]);
            }),
            [
                ['SendOSC 1 "/action,i,40042"'],
                ['SendOSC 1 "/play,i,1"'],
                ['SendOSC 1 "/pause,i,1"'],
                ['SendOSC 1 "/stop,i,1"'],
                ['SendOSC 1 "/action,i,40173"'],
                ['SendOSC 1 "/action,i,40172"'],
                ['SendOSC 1 "/ma3/region/next,i,1"'],
                ['SendOSC 1 "/ma3/region/previous,i,1"'],
            ],
        );
        assert.equal(xml.includes("record"), false);
        assert.equal(xml.includes("/record"), false);
        assert.equal(xml.includes("REC"), false);
        assert.equal(xml.includes("&quot;/play,i,1&quot;"), true);
        assert.equal(xml.includes("&quot;/ma3/region/previous,i,1&quot;"), true);
        assert.equal(macros.every((macro: any) => {
            const lines = Array.isArray(macro.MacroLine) ? macro.MacroLine : [macro.MacroLine];
            return lines.length === 1 && Boolean(lines[0]["@_Guid"]) && Boolean(lines[0]["@_Command"]);
        }), true);
    });

    it("supports custom slot ids and display names without changing the command payload", () => {
        const defaultXml = generateReaperTransportMacros();
        const oscDataNameOnlyXml = generateReaperTransportMacros({
            oscDataName: "AUDIO_REAPER",
        });
        const customXml = generateReaperTransportMacros({
            oscSlotId: 3,
            oscDataName: "AUDIO_REAPER",
            macroNamePrefix: "AUDIO_REAPER - ",
            outputFileName: "audio_reaper_macros.xml",
        });

        assert.equal(oscDataNameOnlyXml, defaultXml);
        assert.equal(customXml.includes('SendOSC 3 &quot;/play,i,1&quot;'), true);
        assert.equal(customXml.includes('SendOSC 3 &quot;/action,i,40042&quot;'), true);
        assert.equal(customXml.includes("AUDIO_REAPER - PLAY"), true);
        assert.equal(defaultXml.includes("AUDIO_REAPER - PLAY"), false);
        assert.notEqual(customXml, defaultXml);
    });

    it("is deterministic for repeated generations with the same options", () => {
        const first = generateReaperTransportMacros({
            oscSlotId: 3,
            oscDataName: "AUDIO_REAPER",
            macroNamePrefix: "AUDIO_REAPER - ",
        });
        const second = generateReaperTransportMacros({
            oscSlotId: 3,
            oscDataName: "AUDIO_REAPER",
            macroNamePrefix: "AUDIO_REAPER - ",
        });

        assert.equal(first, second);
    });

    it("rejects invalid slot ids", () => {
        assert.throws(() => generateReaperTransportMacros({ oscSlotId: 0 }), /positive integer/);
        assert.throws(() => generateReaperTransportMacros({ oscSlotId: -1 }), /positive integer/);
        assert.throws(() => generateReaperTransportMacros({ oscSlotId: 1.25 }), /positive integer/);
    });

    it("creates an output file wrapper with the configured filename", () => {
        const output = createReaperTransportMacroOutputFile({
            outputFileName: "custom.xml",
        });

        assert.equal(output.name, "custom.xml");
        assert.equal(output.content, generateReaperTransportMacros({ outputFileName: "custom.xml" }));
    });
});

describe("zip export bundle", () => {
    it("builds timestamped ZIP filenames from the conversion basename", () => {
        assert.equal(createTimestampedZipFileName("demo", new Date(2026, 6, 10, 15, 4, 6)), "demo_20260710-150406.zip");
        assert.equal(createTimestampedZipFileName(" ", new Date(2026, 0, 2, 3, 4, 5)), "reaper2ma_20260102-030405.zip");
    });

    it("creates a standard ZIP archive containing UTF-8 XML files", () => {
        const bytes = createZipArchiveBytes(
            [
                { name: "main.xml", content: "<GMA3>Main</GMA3>" },
                { name: "accent.xml", content: "<GMA3>Début</GMA3>" },
            ],
            new Date(2026, 6, 10, 15, 4, 6),
        );
        const firstLocalHeader = new DataView(bytes.buffer, bytes.byteOffset, 30);
        const entries = parseZipLocalEntries(bytes);

        assert.equal(readUint32(bytes, 0), 0x04034b50);
        assert.equal(readUint32(bytes, bytes.length - 22), 0x06054b50);
        assert.equal(firstLocalHeader.getUint16(6, true) & 0x0800, 0x0800);
        assert.deepEqual([...entries.keys()], ["main.xml", "accent.xml"]);
        assert.equal(entries.get("main.xml"), "<GMA3>Main</GMA3>");
        assert.equal(entries.get("accent.xml"), "<GMA3>Début</GMA3>");
    });

    it("rejects empty archives and duplicate entry names", () => {
        assert.throws(() => createZipArchiveBytes([]), /empty ZIP/);
        assert.throws(
            () =>
                createZipArchiveBytes([
                    { name: "macro.xml", content: "one" },
                    { name: "macro.xml", content: "two" },
                ]),
            /Duplicate ZIP entry name/,
        );
    });

    it("builds bundle files from the main macro and selected extras", () => {
        const artifacts = convertReaperCsvToArtifacts(fixtureCsv, "Song 01.CSV", baseSettings);
        const withoutTransport = createExportBundleFiles({
            conversionArtifacts: artifacts,
            sourceFileName: "Song 01",
            timecodeName: "",
            macroPresetSelection: {
                showTime: true,
                timecodeControl: false,
            },
            includeReaperTransportMacros: false,
        });
        const withTransport = createExportBundleFiles({
            conversionArtifacts: artifacts,
            sourceFileName: "Song 01",
            timecodeName: "custom-timecode",
            macroPresetSelection: {
                showTime: false,
                timecodeControl: true,
            },
            includeReaperTransportMacros: true,
            transportMacroOptions: {
                outputFileName: "transport.xml",
            },
        });

        assert.deepEqual(withoutTransport.map((file) => file.name), [
            "songcsv_macro.xml",
            "show-time-manuel.xml",
            "show-time-auto-restore.xml",
        ]);
        assert.deepEqual(withTransport.map((file) => file.name), [
            "songcsv_macro.xml",
            "timecode-switch-int.xml",
            "timecode-switch-ltc.xml",
            "timecode-rewind-and-switch-int.xml",
            "timecode-rewind-tc-and-switch-ltc.xml",
            "transport.xml",
        ]);
        assert.equal(withoutTransport.some((file) => file.name === "transport.xml"), false);
        assert.equal(withTransport.at(-1)?.content.includes('Macro Name="REAPER - PLAY"'), true);
    });
});

describe("React conversion request", () => {
    it("keeps project filenames independent from grandMA3 object names", () => {
        const artifacts = convertReaperCsvToArtifacts({
            csvText: fixtureCsv,
            sourceFileName: "reaper-export.csv",
            identity: {
                projectName: "Traversée V2",
                timecodeName: "TC Principal",
            },
            settings: baseSettings,
        });

        assert.equal(createProjectOutputBaseName("Traversée V2"), "traversee-v2");
        assert.equal(artifacts.outputBaseName, "traversee-v2");
        assert.equal(artifacts.grandmaName, "TC Principal");
        assert.equal(createConversionOutputFiles(artifacts)[0]?.name, "traversee-v2_macro.xml");
        assert.equal(artifacts.macroXml.includes("TC Principal"), true);
        assert.equal(artifacts.macroXml.includes("reaper-export"), false);
    });

    it("keeps the historical three-argument naming behavior", () => {
        const artifacts = convertReaperCsvToArtifacts(fixtureCsv, "Song 01.CSV", baseSettings);

        assert.equal(artifacts.outputBaseName, "songcsv");
        assert.equal(artifacts.grandmaName, "songcsv");
    });
});

describe("pre-conversion CSV analysis", () => {
    it("creates a visual default group without enabling region conversion", () => {
        const analysis = analyzeReaperCsv(fixtureCsv);

        assert.equal(analysis.regionCount, 0);
        assert.equal(analysis.recommendedImportMode, "markers-only");
        assert.equal(analysis.regions.length, 1);
        assert.equal(analysis.regions[0]?.isSynthetic, true);
        assert.equal(analysis.regions[0]?.markers.length, analysis.markerCount);
        assert.equal(analysis.globalMarkers.length, 0);
    });

    it("keeps markers outside real regions in the global group", () => {
        const csv = [
            "#,Name,Start,End,Length,Color",
            "R1,Intro,10,20,10,16711680",
            "M1,Before,5,,,",
            "M2,Inside,12,,,",
            "M3,After,22,,,",
        ].join("\n");
        const analysis = analyzeReaperCsv(csv);

        assert.equal(analysis.regionCount, 1);
        assert.equal(analysis.recommendedImportMode, "regions-and-markers");
        assert.deepEqual(analysis.regions[0]?.markers.map((marker) => marker.name), ["Inside"]);
        assert.deepEqual(analysis.globalMarkers.map((marker) => marker.name), ["Before", "After"]);
    });

    it("assigns markers in nested regions to the innermost region", () => {
        const csv = [
            "#,Name,Start,End,Length,Color",
            "R1,Outer,0,100,100,",
            "R2,Inner,10,20,10,",
            "M1,Deep,12,,,",
            "M2,Outer only,30,,,",
        ].join("\n");
        const analysis = analyzeReaperCsv(csv);

        assert.deepEqual(analysis.regions.find((region) => region.label === "Inner")?.markers.map((marker) => marker.name), ["Deep"]);
        assert.deepEqual(analysis.regions.find((region) => region.label === "Outer")?.markers.map((marker) => marker.name), ["Outer only"]);
    });

    it("reports progressive work phases in order and returns the same analysis", async () => {
        const phases: ReaperAnalysisPhase[] = [];
        const progressive = await analyzeReaperCsvProgressively(fixtureCsv, (phase) => phases.push(phase));

        assert.deepEqual(phases, ["validation", "regions", "markers", "preview"]);
        assert.deepEqual(progressive, analyzeReaperCsv(fixtureCsv));
    });
});

describe("grandMA timecode slot profiles", () => {
    const selection = { showTime: true, timecodeControl: true };

    it("uses internal slot -2 before grandMA3 2.4", () => {
        const files = createExampleMacroPresetOutputFiles({
            sourceFileName: "show.csv",
            timecodeName: "Show",
            selection,
            grandmaVersion: "pre-2.4",
            externalTimecodeSlot: 7,
        });
        const commands = files.flatMap((file) => getMacroCommands(file.content));

        assert.equal(commands.some((command) => command === 'Set Timecode "Show" "TCSlot" -2'), true);
        assert.equal(commands.some((command) => command === 'Set Timecode "Show" "TCSlot" 7'), true);
        assert.equal(commands.some((command) => command === 'Set Timecode "Show" "TCSlot" -1'), false);
    });

    it("uses internal slot -1 from grandMA3 2.4 onward and preserves the chosen LTC slot", () => {
        const files = createExampleMacroPresetOutputFiles({
            sourceFileName: "show.csv",
            timecodeName: "Show",
            selection,
            grandmaVersion: "2.4+",
            externalTimecodeSlot: 9,
        });
        const commands = files.flatMap((file) => getMacroCommands(file.content));

        assert.equal(commands.some((command) => command === 'Set Timecode "Show" "TCSlot" -1'), true);
        assert.equal(commands.some((command) => command === 'Set Timecode "Show" "TCSlot" 9'), true);
        assert.equal(commands.some((command) => command === 'Set Timecode "Show" "TCSlot" -2'), false);
    });
});
