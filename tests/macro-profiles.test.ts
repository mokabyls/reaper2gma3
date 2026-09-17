import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { XMLParser } from "fast-xml-parser";
import { convertReaperCsvToArtifacts } from "../src/lib/reaper2ma/converter.js";
import type { ConversionSettings } from "../src/lib/reaper2ma/types.js";

/**
 * Golden-file coverage for macro generation as a function of settings.
 *
 * Every profile below pins one combination of parameters and stores the full command
 * list it produces. Unit tests prove a setting does what it claims in isolation; this
 * proves that nothing else moved. Any change to the generated macro shows up as a diff
 * in `macro-profiles.json`, which must then be read and accepted deliberately.
 *
 * To accept an intended change: `UPDATE_MACRO_PROFILES=1 pnpm test:core`, then review
 * the fixture diff before committing it.
 */

/* Tests run compiled from .test-build/tests, so the fixture is addressed from the repo root. */
const FIXTURE_URL = new URL("../../tests/fixtures/macro-profiles.json", import.meta.url);

const flatCsv = `#,Name,Start,Color
1,Intro,0,
2,SD,1.5,19005190
3,BD,3,F2FF00
4,[Temp] HIT,4.5,19005190
5,[BPM_128] Drop,6,
6,Outro,9,
`;

const regionCsv = `#,Name,Start,End,Length,Color
R1,Verse,0,10,10,
R2,Chorus,10,24,14,
M1,Verse Cue,2,,,
M2,[LAYER=FX] Sweep,4,,,F2FF00
M3,Chorus Cue,12,,,
M4,[Flash] Stab,18,,,19005190
`;

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

type Profile = {
    name: string;
    csv: string;
    fileName: string;
    settings: ConversionSettings;
};

const profiles: Profile[] = [
    {
        name: "markers-only defaults",
        csv: flatCsv,
        fileName: "profile-default.csv",
        settings: baseSettings,
    },
    {
        name: "markers-only cues without timecode",
        csv: flatCsv,
        fileName: "profile-cuesonly.csv",
        settings: { ...baseSettings, exportMode: "cues-only" },
    },
    {
        name: "markers-only without executors",
        csv: flatCsv,
        fileName: "profile-noexec.csv",
        settings: { ...baseSettings, assignExecutors: false },
    },
    {
        name: "markers-only with every number shifted",
        csv: flatCsv,
        fileName: "profile-shifted.csv",
        settings: {
            ...baseSettings,
            sequenceNumber: 500,
            appearanceStartNumber: 700,
            sequenceNamePrefix: "SHOW",
            timecodeNumber: 7,
            pageNumber: 3,
            pageSlotStart: 221,
            bumpPageSlotStart: 141,
            cueStartNumber: 10,
            speedMaster: "3.12",
            prefix: "FX",
        },
    },
    {
        name: "markers-only with a timecode offset",
        csv: flatCsv,
        fileName: "profile-offset.csv",
        settings: { ...baseSettings, timecodeOffsetMs: -2500 },
    },
    {
        name: "markers-only with a pinned executor and a pinned number",
        csv: flatCsv,
        fileName: "profile-pinned.csv",
        settings: {
            ...baseSettings,
            executorOverrides: { "9002": { pageNumber: 4, slotNumber: 260 } },
            sequenceNumberOverrides: { "9003": 9400 },
        },
    },
    {
        name: "regions and markers defaults",
        csv: regionCsv,
        fileName: "profile-regions.csv",
        settings: { ...baseSettings, importMode: "regions-and-markers" },
    },
    {
        name: "regions and markers one page per region",
        csv: regionCsv,
        fileName: "profile-regionpage.csv",
        settings: { ...baseSettings, importMode: "regions-and-markers", executorLayout: "region-per-page" },
    },
    {
        name: "regions and markers without layer pre-roll or auto off",
        csv: regionCsv,
        fileName: "profile-nolayers.csv",
        settings: {
            ...baseSettings,
            importMode: "regions-and-markers",
            regionLayerPreRollEnabled: false,
            autoOffRegionLayers: false,
            regionEndPreRollMs: 0,
        },
    },
    {
        name: "regions and markers with a long region pre-roll",
        csv: regionCsv,
        fileName: "profile-preroll.csv",
        settings: {
            ...baseSettings,
            importMode: "regions-and-markers",
            regionEndPreRollMs: 2000,
            regionLayerPreRollMs: 1500,
        },
    },
];

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseAttributeValue: false });

function macroCommands(profile: Profile): string[] {
    const artifacts = convertReaperCsvToArtifacts(profile.csv, profile.fileName, profile.settings);
    const parsed = xmlParser.parse(artifacts.macroXml);
    const lines = parsed.GMA3.Macro.MacroLine;

    return (Array.isArray(lines) ? lines : [lines]).map((line: Record<string, string>) => line["@_Command"]);
}

function readFixture(): Record<string, string[]> {
    try {
        return JSON.parse(readFileSync(FIXTURE_URL, "utf8")) as Record<string, string[]>;
    } catch {
        return {};
    }
}

describe("macro generation per settings profile", () => {
    const generated = Object.fromEntries(profiles.map((profile) => [profile.name, macroCommands(profile)]));

    if (process.env.UPDATE_MACRO_PROFILES === "1") {
        writeFileSync(FIXTURE_URL, `${JSON.stringify(generated, null, 4)}\n`, "utf8");
    }

    const fixture = readFixture();

    it("covers every profile in the stored fixture", () => {
        assert.deepEqual(Object.keys(fixture).sort(), profiles.map((profile) => profile.name).sort());
    });

    for (const profile of profiles) {
        it(`matches the stored macro for: ${profile.name}`, () => {
            assert.deepEqual(generated[profile.name], fixture[profile.name]);
        });
    }

    it("never emits an empty command", () => {
        for (const [name, commands] of Object.entries(generated)) {
            assert.equal(commands.every((command) => typeof command === "string" && command.length > 0), true, name);
        }
    });
});
