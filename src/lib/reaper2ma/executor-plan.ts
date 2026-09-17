import { resolveSequenceNumber } from "./sequence-numbering.js";
import { applySequenceNamePrefix } from "./sequence-services.js";
import type { ConversionArtifacts, ConversionSettings, ExecutorAddress } from "./types.js";

export type ExecutorSlotGroup = "main" | "bump";

export type ExecutorPlanItem = {
    localSequenceNumber: number;
    /** The number this sequence receives automatically: the key every override is stated against. */
    finalSequenceNumber: number;
    /** What actually lands on the console once a number override is applied. */
    effectiveSequenceNumber?: number;
    displayName: string;
    assignToExecutor: boolean;
    executorSlotGroup: ExecutorSlotGroup;
    executorRegionId?: string;
    regionLabel?: string;
};

export type ExecutorAssignment = {
    localSequenceNumber: number;
    sequenceNumber: number;
    sequenceName: string;
    pageNumber: number;
    slotNumber: number;
    slotGroup: ExecutorSlotGroup;
    pinned?: true;
    regionId?: string;
    regionLabel?: string;
};

export function createExecutorAssignmentPlan(settings: ConversionSettings, sequences: ExecutorPlanItem[]): ExecutorAssignment[] {
    if (settings.assignExecutors === false) return [];

    const layout = settings.executorLayout ?? "continuous";
    const regionPages = new Map<string, number>();

    if (layout === "region-per-page") {
        for (const sequence of sequences) {
            if (sequence.executorRegionId && !regionPages.has(sequence.executorRegionId)) {
                regionPages.set(sequence.executorRegionId, settings.pageNumber + regionPages.size);
            }
        }
    }

    const overrides = settings.executorOverrides ?? {};
    /* Pinned addresses are reserved first so automatic sequences pack around them
       instead of landing on top of a slot the user deliberately chose. */
    const reserved = new Set(
        sequences
            .filter((sequence) => sequence.assignToExecutor)
            .map((sequence) => overrides[String(sequence.finalSequenceNumber)])
            .filter((address): address is ExecutorAddress => isUsableAddress(address))
            .map((address) => addressKey(address.pageNumber, address.slotNumber)),
    );
    const offsets = new Map<string, number>();

    return sequences.flatMap((sequence) => {
        if (!sequence.assignToExecutor) return [];

        const pinned = overrides[String(sequence.finalSequenceNumber)];
        const autoPage = sequence.executorRegionId ? (regionPages.get(sequence.executorRegionId) ?? settings.pageNumber) : settings.pageNumber;
        let pageNumber = autoPage;
        let slotNumber: number;

        if (isUsableAddress(pinned)) {
            pageNumber = pinned.pageNumber;
            slotNumber = pinned.slotNumber;
        } else {
            const offsetKey = layout === "region-per-page" ? `${autoPage}:${sequence.executorSlotGroup}` : sequence.executorSlotGroup;
            const slotStart = sequence.executorSlotGroup === "bump" ? settings.bumpPageSlotStart : settings.pageSlotStart;
            let offset = offsets.get(offsetKey) ?? 0;

            while (reserved.has(addressKey(autoPage, slotStart + offset))) offset += 1;

            slotNumber = slotStart + offset;
            offsets.set(offsetKey, offset + 1);
        }

        return [{
            localSequenceNumber: sequence.localSequenceNumber,
            sequenceNumber: sequence.effectiveSequenceNumber ?? sequence.finalSequenceNumber,
            sequenceName: sequence.displayName,
            pageNumber,
            slotNumber,
            slotGroup: sequence.executorSlotGroup,
            ...(isUsableAddress(pinned) ? { pinned: true as const } : {}),
            ...(sequence.executorRegionId ? { regionId: sequence.executorRegionId } : {}),
            ...(sequence.regionLabel ? { regionLabel: sequence.regionLabel } : {}),
        }];
    });
}

function addressKey(pageNumber: number, slotNumber: number): string {
    return `${pageNumber}.${slotNumber}`;
}

function isUsableAddress(address: ExecutorAddress | undefined): address is ExecutorAddress {
    return Boolean(address) && Number.isInteger(address?.pageNumber) && Number.isInteger(address?.slotNumber);
}

/** Addresses claimed by more than one sequence. Surfaced in the UI instead of silently shipped. */
export function findExecutorAddressConflicts(assignments: ExecutorAssignment[]): string[] {
    const seen = new Map<string, number>();
    for (const assignment of assignments) {
        const key = addressKey(assignment.pageNumber, assignment.slotNumber);
        seen.set(key, (seen.get(key) ?? 0) + 1);
    }

    return [...seen].filter(([, count]) => count > 1).map(([key]) => key);
}

export function createExecutorAssignmentPreview(artifacts: ConversionArtifacts, settings: ConversionSettings): ExecutorAssignment[] {
    const sequences: ExecutorPlanItem[] = [];
    const add = (sequence: Omit<ExecutorPlanItem, "localSequenceNumber" | "assignToExecutor"> & { assignToExecutor?: boolean }) => {
        sequences.push({
            localSequenceNumber: sequences.length + 1,
            assignToExecutor: sequence.assignToExecutor ?? true,
            effectiveSequenceNumber: resolveSequenceNumber(settings, sequence.finalSequenceNumber),
            ...sequence,
        });
    };

    if (artifacts.uniqueCues.length > 0) {
        add({
            finalSequenceNumber: settings.sequenceNumber,
            displayName: applySequenceNamePrefix(`Sequence ${settings.sequenceNumber}`, settings.sequenceNamePrefix),
            executorSlotGroup: "main",
        });
    }

    for (const region of artifacts.regionSequences) {
        add({
            finalSequenceNumber: region.sequenceNumber,
            displayName: region.displayName,
            executorSlotGroup: "main",
            executorRegionId: region.regionId,
            regionLabel: region.regionLabel,
        });

        for (const layer of artifacts.regionLayerSequences.filter((candidate) => candidate.regionId === region.regionId)) {
            add({
                finalSequenceNumber: layer.sequenceNumber,
                displayName: layer.displayName,
                executorSlotGroup: "main",
                executorRegionId: layer.regionId,
                regionLabel: layer.regionLabel,
            });
        }
    }

    for (const repeated of artifacts.repeatedSequences) {
        add({ finalSequenceNumber: repeated.sequenceNumber, displayName: repeated.displayName, executorSlotGroup: "main" });
    }

    for (const bump of artifacts.bumpSequences) {
        add({
            finalSequenceNumber: bump.sequenceNumber,
            displayName: bump.displayName,
            executorSlotGroup: "bump",
            ...(bump.regionId ? { executorRegionId: bump.regionId } : {}),
            ...(bump.regionLabel ? { regionLabel: bump.regionLabel } : {}),
        });
    }

    return createExecutorAssignmentPlan(settings, sequences);
}
