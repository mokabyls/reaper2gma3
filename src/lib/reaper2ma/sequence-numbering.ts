import { applySequenceNamePrefix } from "./sequence-services.js";
import type { ConversionArtifacts, ConversionSettings } from "./types.js";

/**
 * Sequence numbers are the DataPool identity of every generated object, so an override
 * is keyed by the number the sequence would receive automatically. Overriding one
 * sequence never renumbers the others: a programmer who pins the main stack at 9001
 * expects it to stay there when another sequence is moved away.
 */
export function resolveSequenceNumber(settings: ConversionSettings, automaticNumber: number): number {
    const override = settings.sequenceNumberOverrides?.[String(automaticNumber)];

    return isUsableSequenceNumber(override) ? override : automaticNumber;
}

export function isUsableSequenceNumber(value: number | undefined): value is number {
    return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 9999;
}

/** Numbers claimed by more than one sequence. Surfaced in the UI instead of silently shipped. */
export function findSequenceNumberConflicts(numbers: number[]): number[] {
    const seen = new Map<number, number>();
    for (const number of numbers) seen.set(number, (seen.get(number) ?? 0) + 1);

    return [...seen].filter(([, count]) => count > 1).map(([number]) => number).sort((left, right) => left - right);
}

export type SequenceMove = {
    fromLocalNumber: number;
    throughLocalNumber?: number;
    toSequenceNumber: number;
};

/**
 * The temporary DataPool holds sequences at local numbers 1..N. Moving them out used to be
 * one block command, which only works while the destinations stay contiguous. Overrides break
 * that, so consecutive locals landing on consecutive destinations are grouped into runs and
 * anything else is moved on its own.
 */
export function createSequenceMoves(sequences: Array<{ localSequenceNumber: number; effectiveSequenceNumber: number }>): SequenceMove[] {
    const ordered = [...sequences].sort((left, right) => left.localSequenceNumber - right.localSequenceNumber);
    const moves: SequenceMove[] = [];

    for (const sequence of ordered) {
        const current = moves[moves.length - 1];
        const previousLocal = current ? current.throughLocalNumber ?? current.fromLocalNumber : undefined;
        const continuesRun =
            current !== undefined &&
            previousLocal !== undefined &&
            sequence.localSequenceNumber === previousLocal + 1 &&
            sequence.effectiveSequenceNumber === current.toSequenceNumber + (previousLocal - current.fromLocalNumber) + 1;

        if (continuesRun) current.throughLocalNumber = sequence.localSequenceNumber;
        else moves.push({ fromLocalNumber: sequence.localSequenceNumber, toSequenceNumber: sequence.effectiveSequenceNumber });
    }

    return moves;
}

export type SequenceNumberEntry = {
    /** The number this sequence receives automatically: the key an override is stated against. */
    automaticNumber: number;
    /** What will actually land in the DataPool. */
    effectiveNumber: number;
    displayName: string;
    pinned: boolean;
};

/**
 * Every sequence the macro will create, in the order it creates them, with the number
 * each one will end up on. Mirrors the enumeration used to build the macro so the editor
 * never shows a sequence the export does not produce.
 */
export function createSequenceNumberPlan(artifacts: ConversionArtifacts, settings: ConversionSettings): SequenceNumberEntry[] {
    const entries: SequenceNumberEntry[] = [];
    const add = (automaticNumber: number, displayName: string) => {
        const effectiveNumber = resolveSequenceNumber(settings, automaticNumber);
        entries.push({ automaticNumber, effectiveNumber, displayName, pinned: effectiveNumber !== automaticNumber });
    };

    if (artifacts.uniqueCues.length > 0) {
        add(settings.sequenceNumber, applySequenceNamePrefix(`Sequence ${settings.sequenceNumber}`, settings.sequenceNamePrefix));
    }

    for (const region of artifacts.regionSequences) {
        add(region.sequenceNumber, region.displayName);
        for (const layer of artifacts.regionLayerSequences.filter((candidate) => candidate.regionId === region.regionId)) {
            add(layer.sequenceNumber, layer.displayName);
        }
    }

    for (const repeated of artifacts.repeatedSequences) add(repeated.sequenceNumber, repeated.displayName);
    for (const bump of artifacts.bumpSequences) add(bump.sequenceNumber, bump.displayName);
    if (artifacts.bpmSequence) add(artifacts.bpmSequence.sequenceNumber, artifacts.bpmSequence.displayName);

    return entries;
}
