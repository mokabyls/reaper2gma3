import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import os from "node:os";

const defaultSource = "demo/generated/regionsmarkersdemo_macro.xml";
const defaultDestination = getDefaultDestination();

const args = parseArgs(process.argv.slice(2));

if (args.help) {
    printHelp();
    process.exit(0);
}

const sourcePath = resolve(expandHomePath(args.source ?? defaultSource));
const destinationDir = resolve(expandHomePath(args.dest ?? defaultDestination));
const destinationPath = join(destinationDir, "regionsmarkersdemo_macro.xml");

if (!existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
}

mkdirSync(destinationDir, { recursive: true });
copyFileSync(sourcePath, destinationPath);

console.log(`Copied ${sourcePath}`);
console.log(`To ${destinationPath}`);

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

function expandHomePath(value) {
    if (!value.startsWith("~")) {
        return value;
    }

    if (value === "~") {
        return os.homedir();
    }

    if (value.startsWith("~/") || value.startsWith("~\\")) {
        return join(os.homedir(), value.slice(2));
    }

    return value;
}

function getDefaultDestination() {
    if (process.platform === "win32") {
        const programData = process.env.PROGRAMDATA ?? "C:\\ProgramData";
        return join(programData, "MALightingTechnology", "gma3_library", "datapools", "macros");
    }

    return join(os.homedir(), "MALightingTechnology", "gma3_library", "datapools", "macros");
}

function printHelp() {
    console.log(`Copy the generated demo macro to the grandMA3 macro library folder.

Usage:
  pnpm copy:demo-macro
  pnpm copy:demo-macro -- --source demo/generated/custom_macro.xml
  pnpm copy:demo-macro -- --dest ~/MALightingTechnology/gma3_library/datapools/macros

Options:
  --source <path>    Source macro XML. Default: ${defaultSource}
  --dest <path>      Destination directory. Default: ${defaultDestination}
`);
}
