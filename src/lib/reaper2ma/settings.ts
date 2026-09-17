export const DEFAULT_REGION_END_PRE_ROLL_MS = 750;
export const MIN_REGION_END_PRE_ROLL_MS = 0;
export const MAX_REGION_END_PRE_ROLL_MS = 5000;
export const DEFAULT_AUTO_OFF_REGION_LAYERS = true;
export const DEFAULT_REGION_LAYER_PRE_ROLL_ENABLED = true;
export const DEFAULT_REGION_LAYER_PRE_ROLL_MS = 750;
export const MIN_REGION_LAYER_PRE_ROLL_MS = 0;
export const MAX_REGION_LAYER_PRE_ROLL_MS = 5000;

export function resolveSpeedMaster(speedMasterNumber: number): string {
    if (!Number.isInteger(speedMasterNumber) || speedMasterNumber < 1 || speedMasterNumber > 15) {
        throw new RangeError("Speed Master must be an integer from 1 to 15.");
    }

    return `3.${speedMasterNumber}`;
}

export function clampRegionEndPreRollMs(value: number): number {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        return DEFAULT_REGION_END_PRE_ROLL_MS;
    }

    return Math.min(MAX_REGION_END_PRE_ROLL_MS, Math.max(MIN_REGION_END_PRE_ROLL_MS, Math.trunc(numericValue)));
}

export function clampRegionLayerPreRollMs(value: number): number {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        return DEFAULT_REGION_LAYER_PRE_ROLL_MS;
    }

    return Math.min(MAX_REGION_LAYER_PRE_ROLL_MS, Math.max(MIN_REGION_LAYER_PRE_ROLL_MS, Math.trunc(numericValue)));
}
