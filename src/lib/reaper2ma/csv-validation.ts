import type { ReaperMarkerRow } from "./types.js";

const REQUIRED_HEADERS = ["#", "Name", "Start"];
const TIME_FIELDS: Array<keyof Pick<ReaperMarkerRow, "Start" | "End" | "Length">> = ["Start", "End", "Length"];
const SECONDS_VALUE_PATTERN = /^-?\d+(?:\.\d+)?$/;

export function validateReaperCsvRows(headers: string[], rows: ReaperMarkerRow[]): string[] {
    const warnings: string[] = [];
    const normalizedHeaders = new Set(headers.map((header) => header.trim()));
    const missingHeaders = REQUIRED_HEADERS.filter((header) => !normalizedHeaders.has(header));
    const nonSecondTimestamp = findNonSecondTimestamp(rows);

    if (missingHeaders.length > 0) {
        warnings.push(
            `The CSV is missing ${formatHeaderList(missingHeaders)}. Check the REAPER export: the required columns are #, Name, and Start. Color is optional because REAPER omits it when no markers are colored.`,
        );
    }

    if (nonSecondTimestamp) {
        const formatHint = hasMultipleDecimalSeparators(nonSecondTimestamp.value)
            ? "The timestamps look like measures/beats instead of seconds."
            : "Some time values are not numeric seconds.";

        warnings.push(
            `${formatHint} Example: ${nonSecondTimestamp.field}="${nonSecondTimestamp.value}" on line ${nonSecondTimestamp.lineNumber}. Re-export the CSV from REAPER with the ruler time unit set to seconds, otherwise regions and timecode can be misaligned.`,
        );
    }

    return warnings;
}

function findNonSecondTimestamp(rows: ReaperMarkerRow[]): { field: string; value: string; lineNumber: number } | undefined {
    for (const [index, row] of rows.entries()) {
        for (const field of TIME_FIELDS) {
            const value = row[field]?.trim();

            if (!value || SECONDS_VALUE_PATTERN.test(value)) {
                continue;
            }

            return {
                field,
                value,
                lineNumber: index + 2,
            };
        }
    }

    return undefined;
}

function hasMultipleDecimalSeparators(value: string): boolean {
    return (value.match(/\./g) ?? []).length > 1;
}

function formatHeaderList(headers: string[]): string {
    if (headers.length === 1) {
        return `the ${headers[0]} column`;
    }

    return `these columns: ${headers.join(", ")}`;
}
