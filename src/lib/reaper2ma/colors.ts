const REAPER_COLOR_MASK = 0xFFFFFF;
const GRANDMA_APPEARANCE_COLOR = "1,1,1,0";
const GRANDMA_APPEARANCE_BACK_ALPHA = 221;
const REGION_LAYER_INHERITED_LIGHTEN_AMOUNT = 0.24;
const REGION_BUMP_INHERITED_LIGHTEN_AMOUNT = 0.42;

function parseReaperColorValue(color: string): number | undefined {
    const trimmedColor = color.trim();

    if (!trimmedColor) {
        return undefined;
    }

    if (/^#[0-9a-f]{6}$/i.test(trimmedColor)) {
        return Number.parseInt(trimmedColor.slice(1), 16);
    }

    if (/^0x[0-9a-f]+$/i.test(trimmedColor)) {
        return Number.parseInt(trimmedColor.slice(2), 16);
    }

    if (/^[0-9a-f]{6}$/i.test(trimmedColor) && /[a-f]/i.test(trimmedColor)) {
        return Number.parseInt(trimmedColor, 16);
    }

    if (!/^\d+$/.test(trimmedColor)) {
        return undefined;
    }

    return Number.parseInt(trimmedColor, 10);
}

function convertReaperColorToRgb(color: string): { red: number; green: number; blue: number } | undefined {
    const parsedColor = parseReaperColorValue(color);

    if (parsedColor === undefined || !Number.isFinite(parsedColor)) {
        return undefined;
    }

    const rgb = parsedColor & REAPER_COLOR_MASK;

    return {
        red: (rgb >> 16) & 0xff,
        green: (rgb >> 8) & 0xff,
        blue: rgb & 0xff,
    };
}

export function convertReaperColorToGrandmaAppearanceColor(color: string): string | undefined {
    const rgb = convertReaperColorToRgb(color);

    if (!rgb) {
        return undefined;
    }

    return `COLOR="${GRANDMA_APPEARANCE_COLOR}" BackR=${rgb.red} BackG=${rgb.green} BackB=${rgb.blue} BackAlpha=${GRANDMA_APPEARANCE_BACK_ALPHA}`;
}

export function convertReaperColorToCssColor(color: string): string | undefined {
    const rgb = convertReaperColorToRgb(color);

    if (!rgb) {
        return undefined;
    }

    return `rgb(${rgb.red}, ${rgb.green}, ${rgb.blue})`;
}

export function createInheritedRegionLayerColor(regionColor: string): string | undefined {
    return createLightenedReaperColor(regionColor, REGION_LAYER_INHERITED_LIGHTEN_AMOUNT);
}

export function createInheritedRegionBumpColor(regionColor: string): string | undefined {
    return createLightenedReaperColor(regionColor, REGION_BUMP_INHERITED_LIGHTEN_AMOUNT);
}

export function createAppearanceNameFromReaperColor(color: string): string {
    return `R2MA Color ${color.trim()}`;
}

function createLightenedReaperColor(color: string, amount: number): string | undefined {
    const rgb = convertReaperColorToRgb(color);

    if (!rgb) {
        return undefined;
    }

    return [
        "#",
        formatColorChannel(lightenColorChannel(rgb.red, amount)),
        formatColorChannel(lightenColorChannel(rgb.green, amount)),
        formatColorChannel(lightenColorChannel(rgb.blue, amount)),
    ].join("");
}

function lightenColorChannel(channel: number, amount: number): number {
    const normalizedAmount = Math.min(1, Math.max(0, amount));

    return Math.round(channel + (255 - channel) * normalizedAmount);
}

function formatColorChannel(channel: number): string {
    return channel.toString(16).padStart(2, "0").toUpperCase();
}
