export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

export function downloadTextFile(content: string, filename: string, mimeType = "application/xml"): void {
    const blob = new Blob([content], { type: mimeType });

    downloadBlob(blob, filename);
}
