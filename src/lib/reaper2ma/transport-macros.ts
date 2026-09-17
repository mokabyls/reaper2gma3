import { XML_HEADER, xmlBuilder } from "./xml-common.js";

export interface ReaperMacroGeneratorOptions {
    oscSlotId?: number;
    oscDataName?: string;
    macroNamePrefix?: string;
    outputFileName?: string;
}

export type ReaperTransportMacroOutputFile = {
    name: string;
    content: string;
};

export type ReaperTransportMacroDefinition = {
    label: string;
    command: string;
};

const DEFAULT_OSC_SLOT_ID = 1;
const DEFAULT_OSC_DATA_NAME = "REAPER";
const DEFAULT_MACRO_NAME_PREFIX = "REAPER - ";
const DEFAULT_OUTPUT_FILE_NAME = "reaper_transport_macros.xml";
const TRANSPORT_MACRO_XML_VERSION = "2.4.2.2";

const transportMacros: ReaperTransportMacroDefinition[] = [
    { label: "REWIND", command: 'SendOSC {oscSlotId} "/action,i,40042"' },
    { label: "PLAY", command: 'SendOSC {oscSlotId} "/play,i,1"' },
    { label: "PAUSE", command: 'SendOSC {oscSlotId} "/pause,i,1"' },
    { label: "STOP", command: 'SendOSC {oscSlotId} "/stop,i,1"' },
    { label: "NEXT MARKER", command: 'SendOSC {oscSlotId} "/action,i,40173"' },
    { label: "PREV MARKER", command: 'SendOSC {oscSlotId} "/action,i,40172"' },
    { label: "NEXT REGION", command: 'SendOSC {oscSlotId} "/ma3/region/next,i,1"' },
    { label: "PREV REGION", command: 'SendOSC {oscSlotId} "/ma3/region/previous,i,1"' },
];

function resolveReaperMacroGeneratorOptions(options: ReaperMacroGeneratorOptions = {}) {
    const oscSlotId = options.oscSlotId ?? DEFAULT_OSC_SLOT_ID;

    if (!Number.isInteger(oscSlotId) || oscSlotId <= 0) {
        throw new RangeError("oscSlotId must be a positive integer.");
    }

    return {
        oscSlotId,
        oscDataName: options.oscDataName ?? DEFAULT_OSC_DATA_NAME,
        macroNamePrefix: options.macroNamePrefix ?? DEFAULT_MACRO_NAME_PREFIX,
        outputFileName: options.outputFileName ?? DEFAULT_OUTPUT_FILE_NAME,
    };
}

function hash32(input: string, salt: number): number {
    let hash = (0x811c9dc5 ^ salt) >>> 0;

    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
        hash ^= hash >>> 13;
    }

    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x846ca68b);
    hash ^= hash >>> 16;

    return hash >>> 0;
}

function createDeterministicGuid(seed: string): string {
    const bytes: number[] = [];

    for (let index = 0; index < 4; index += 1) {
        const value = hash32(seed, index);
        bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
    }

    return bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function renderTransportMacroCommand(definition: ReaperTransportMacroDefinition, oscSlotId: number): string {
    return definition.command.replaceAll("{oscSlotId}", String(oscSlotId));
}

function createTransportMacroObjects(resolvedOptions: ReturnType<typeof resolveReaperMacroGeneratorOptions>) {
    return transportMacros.map((definition) => {
        const macroName = `${resolvedOptions.macroNamePrefix}${definition.label}`;
        const command = renderTransportMacroCommand(definition, resolvedOptions.oscSlotId);

        return {
            "@_Name": macroName,
            "@_Guid": createDeterministicGuid(`macro:${macroName}`),
            MacroLine: [
                {
                    "@_Guid": createDeterministicGuid(`macro-line:${macroName}:${command}`),
                    "@_Command": command,
                },
            ],
        };
    });
}

export function generateReaperTransportMacros(options: ReaperMacroGeneratorOptions = {}): string {
    const resolvedOptions = resolveReaperMacroGeneratorOptions(options);

    const obj = {
        ...XML_HEADER,
        GMA3: {
            "@_DataVersion": TRANSPORT_MACRO_XML_VERSION,
            Macro: createTransportMacroObjects(resolvedOptions),
        },
    };

    return xmlBuilder.build(obj);
}

export function createReaperTransportMacroOutputFile(options: ReaperMacroGeneratorOptions = {}): ReaperTransportMacroOutputFile {
    const resolvedOptions = resolveReaperMacroGeneratorOptions(options);

    return {
        name: resolvedOptions.outputFileName,
        content: generateReaperTransportMacros(resolvedOptions),
    };
}

export function getDefaultReaperTransportMacroOptions(): Required<ReaperMacroGeneratorOptions> {
    return {
        oscSlotId: DEFAULT_OSC_SLOT_ID,
        oscDataName: DEFAULT_OSC_DATA_NAME,
        macroNamePrefix: DEFAULT_MACRO_NAME_PREFIX,
        outputFileName: DEFAULT_OUTPUT_FILE_NAME,
    };
}
