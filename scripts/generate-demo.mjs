import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const defaultInput = "demo/regions-markers-demo.csv";
const defaultOutDir = "demo/generated";
const cliBuildDir = ".cli-build";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
    printHelp();
    process.exit(0);
}

const inputPath = resolve(args.input ?? defaultInput);
const outDir = resolve(args.outDir ?? defaultOutDir);
const settings = {
    sequenceNumber: parseIntegerOption(args.sequenceNumber, "sequence-number", 101),
    appearanceStartNumber: parseIntegerOption(args.appearanceStartNumber, "appearance-start-number", 1),
    sequenceNamePrefix: args.sequenceNamePrefix ?? "MA",
    timecodeNumber: parseIntegerOption(args.timecodeNumber, "timecode-number", 1),
    pageNumber: parseIntegerOption(args.pageNumber, "page-number", 1),
    pageSlotStart: parseIntegerOption(args.pageSlotStart, "page-slot-start", 201),
    bumpPageSlotStart: parseIntegerOption(args.bumpPageSlotStart, "bump-page-slot-start", 101),
    cueStartNumber: parseIntegerOption(args.cueStartNumber, "cue-start-number", 1),
    speedMaster: args.speedMaster ?? "3.4",
    prefix: args.prefix ?? "1",
    importMode: args.importMode ?? "regions-and-markers",
    exportMode: args.exportMode ?? "cues-and-timecode",
};

validateChoice(settings.importMode, "import-mode", ["markers-only", "regions-and-markers"]);
validateChoice(settings.exportMode, "export-mode", ["cues-and-timecode", "cues-only"]);

rmSync(resolve(cliBuildDir), { recursive: true, force: true });

const compile = spawnSync("pnpm", ["exec", "tsc", "-p", "tsconfig.tests.json", "--outDir", cliBuildDir], {
    stdio: "inherit",
    shell: false,
});

if (compile.status !== 0) {
    process.exit(compile.status ?? 1);
}

const [{ convertReaperCsvToArtifacts, createConversionOutputFiles }, { createConversionPreview }, { parseReaperMarkerRows }] = await Promise.all([
    import(new URL("../.cli-build/src/lib/reaper2ma/converter.js", import.meta.url)),
    import(new URL("../.cli-build/src/lib/reaper2ma/preview.js", import.meta.url)),
    import(new URL("../.cli-build/src/lib/reaper2ma/markers.js", import.meta.url)),
]);

const csvText = readFileSync(inputPath, "utf8");
const rows = parseReaperMarkerRows(csvText);
const artifacts = convertReaperCsvToArtifacts(csvText, basename(inputPath), settings);
const preview = createConversionPreview(artifacts, rows.length);
const outputFiles = createConversionOutputFiles(artifacts);

mkdirSync(outDir, { recursive: true });

for (const outputFile of outputFiles) {
    writeFileSync(resolve(outDir, outputFile.name), outputFile.content, "utf8");
}

console.log(`Generated ${outputFiles.length} file(s) from ${inputPath}`);
console.log(`Output directory: ${outDir}`);
console.log(`Import mode: ${preview.importMode}`);
console.log(`Rows: ${preview.sourceMarkerCount}`);
console.log(`Regions: ${preview.regionCount}`);
console.log(`Markers in regions: ${preview.regionMarkerCount}`);
console.log(`Main cues: ${preview.uniqueCueCount}`);
console.log(`Generated sequences: ${preview.generatedSequenceNames.join(", ") || "(none)"}`);
console.log(`Duration: ${preview.duration}s`);
console.log("Files:");

for (const outputFile of outputFiles) {
    console.log(`- ${outputFile.name}`);
}

if (preview.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of preview.warnings) {
        console.log(`- ${warning}`);
    }
}

function parseArgs(rawArgs) {
    const parsed = {};

    for (let index = 0; index < rawArgs.length; index += 1) {
        const arg = rawArgs[index];

        if (arg === "--") {
            continue;
        }

        if (arg === "--help" || arg === "-h") {
            parsed.help = true;
            continue;
        }

        if (!arg.startsWith("--")) {
            throw new Error(`Unexpected positional argument: ${arg}`);
        }

        const key = arg.slice(2);
        const value = rawArgs[index + 1];

        if (!value || value.startsWith("--")) {
            throw new Error(`Missing value for --${key}`);
        }

        parsed[toCamelCase(key)] = value;
        index += 1;
    }

    return parsed;
}

function toCamelCase(value) {
    return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseIntegerOption(value, optionName, fallback) {
    if (value === undefined) {
        return fallback;
    }

    if (!/^-?\d+$/.test(value)) {
        throw new Error(`--${optionName} must be an integer.`);
    }

    const parsed = Number.parseInt(value, 10);

    if (!Number.isInteger(parsed)) {
        throw new Error(`--${optionName} must be an integer.`);
    }

    return parsed;
}

function validateChoice(value, optionName, choices) {
    if (!choices.includes(value)) {
        throw new Error(`--${optionName} must be one of: ${choices.join(", ")}.`);
    }
}

function printHelp() {
    console.log(`Generate Reaper2MA XML files from a CSV.

Usage:
  pnpm generate:demo
  pnpm generate:demo -- --input demo/file.csv --out-dir demo/generated

Options:
  --input <path>                    CSV input path. Default: ${defaultInput}
  --out-dir <path>                  Output directory. Default: ${defaultOutDir}
  --import-mode <mode>              markers-only | regions-and-markers
  --export-mode <mode>              cues-and-timecode | cues-only
  --sequence-number <number>        Default: 101
  --appearance-start-number <n>     Default: 1
  --sequence-name-prefix <value>    Default: MA
  --timecode-number <number>        Default: 1
  --page-number <number>            Default: 1
  --page-slot-start <number>        Default: 201
  --bump-page-slot-start <number>   Default: 101
  --cue-start-number <number>       Default: 1
  --speed-master <value>            Default: 3.4
  --prefix <value>                  Default: 1
`);
}
