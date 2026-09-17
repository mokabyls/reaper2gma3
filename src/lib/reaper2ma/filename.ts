export function normalizeOutputBaseName(fileName: string): string {
    return fileName.replace(".csv", "").toLowerCase().replace(/[^a-z]/g, "");
}

export function createProjectOutputBaseName(projectName: string): string {
    const slug = projectName
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return slug || "reaper2ma";
}

export function sanitizeGrandmaObjectName(value: string, fallback = "reaper2ma"): string {
    const sanitized = value
        .normalize("NFC")
        .replace(/["\r\n\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, 120);

    return sanitized || fallback;
}

export function buildOutputFileName(baseName: string, suffix: string): string {
    return `${baseName}_${suffix}.xml`;
}

export function stripFileExtension(fileName: string): string {
    return fileName.replace(/\.[^.]+$/, "");
}
