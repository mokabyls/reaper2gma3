export const MAX_TIMECODE_OFFSET_MS = 921_598_960;

const TIMECODE_OFFSET_PATTERN = /^([+-]?)(\d{2,3}):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/;

export function isValidTimecodeOffsetMs(value: unknown): value is number {
    return typeof value === "number"
        && Number.isInteger(value)
        && Number.isFinite(value)
        && Math.abs(value) <= MAX_TIMECODE_OFFSET_MS;
}

export function resolveTimecodeOffsetMs(value: number | undefined): number {
    if (value === undefined) return 0;
    if (!isValidTimecodeOffsetMs(value)) {
        throw new RangeError("Timecode offset must be an integer number of milliseconds between -255:59:58.960 and +255:59:58.960.");
    }
    return Object.is(value, -0) ? 0 : value;
}

export function parseTimecodeOffset(value: string): number | undefined {
    const match = value.trim().match(TIMECODE_OFFSET_PATTERN);
    if (!match) return undefined;

    const hours = Number(match[2]);
    const minutes = Number(match[3]);
    const seconds = Number(match[4]);
    const milliseconds = Number((match[5] ?? "").padEnd(3, "0"));
    const magnitude = ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
    const offset = match[1] === "-" ? -magnitude : magnitude;

    return isValidTimecodeOffsetMs(offset) ? (Object.is(offset, -0) ? 0 : offset) : undefined;
}

export function formatTimecodeOffset(value: number | undefined): string {
    const offset = resolveTimecodeOffsetMs(value);
    if (offset === 0) return "00:00:00.000";
    return `${offset > 0 ? "+" : "-"}${formatTimecodeMagnitude(Math.abs(offset))}`;
}

export function formatEffectiveTimecode(valueMs: number): string {
    const sign = valueMs < 0 ? "-" : "";
    return `${sign}${formatTimecodeMagnitude(Math.abs(Math.round(valueMs)))}`;
}

export function formatTimecodeOffsetSeconds(value: number | undefined): string {
    const offset = resolveTimecodeOffsetMs(value);
    if (offset === 0) return "0";
    return (offset / 1000).toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatTimecodeMagnitude(valueMs: number): string {
    const rounded = Math.round(valueMs);
    const hours = Math.floor(rounded / 3_600_000);
    const minutes = Math.floor((rounded % 3_600_000) / 60_000);
    const seconds = Math.floor((rounded % 60_000) / 1000);
    const milliseconds = rounded % 1000;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}
