export function formatDuration(seconds: number | undefined): string {
    const value = Number.isFinite(seconds) ? Math.max(0, seconds ?? 0) : 0;
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const remaining = Math.floor(value % 60);
    return hours > 0
        ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
        : `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

export function formatDate(value: string, locale: string): string {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function formatBytes(value: number): string {
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
