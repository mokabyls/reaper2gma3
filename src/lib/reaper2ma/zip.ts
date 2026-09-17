export type ZipTextFile = {
    name: string;
    content: string;
};

const textEncoder = new TextEncoder();

const crc32Table = new Uint32Array(256);

for (let index = 0; index < crc32Table.length; index += 1) {
    let crc = index;

    for (let bit = 0; bit < 8; bit += 1) {
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }

    crc32Table[index] = crc >>> 0;
}

function calculateCrc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;

    for (const byte of bytes) {
        crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
}

function createHeader(length: number): DataView {
    return new DataView(new ArrayBuffer(length));
}

function toDosDateTime(date: Date): { dosDate: number; dosTime: number } {
    const year = Math.max(1980, date.getFullYear());

    return {
        dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
        dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    };
}

function sanitizeZipEntryName(name: string): string {
    const normalized = name.replaceAll("\\", "/");
    const entryName = normalized.split("/").filter(Boolean).at(-1)?.trim() ?? "";

    if (!entryName) {
        throw new Error("ZIP entries must have a filename.");
    }

    return entryName;
}

function assertZip32Size(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
        throw new Error(`${label} is too large for a standard ZIP archive.`);
    }
}

function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
    const output = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
    }

    return output;
}

export function createTimestampedZipFileName(baseName: string, date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    const safeBaseName = baseName.trim() || "reaper2ma";
    const timestamp = [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        "-",
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join("");

    return `${safeBaseName}_${timestamp}.zip`;
}

export function createZipArchiveBytes(files: ZipTextFile[], modifiedAt = new Date()): Uint8Array {
    if (files.length === 0) {
        throw new Error("Cannot create an empty ZIP archive.");
    }

    if (files.length > 0xffff) {
        throw new Error("Too many files for a standard ZIP archive.");
    }

    const { dosDate, dosTime } = toDosDateTime(modifiedAt);
    const chunks: Uint8Array[] = [];
    const centralDirectoryChunks: Uint8Array[] = [];
    const seenEntryNames = new Set<string>();
    let offset = 0;
    let centralDirectoryLength = 0;

    for (const file of files) {
        const entryName = sanitizeZipEntryName(file.name);

        if (seenEntryNames.has(entryName)) {
            throw new Error(`Duplicate ZIP entry name: ${entryName}`);
        }

        seenEntryNames.add(entryName);

        const fileNameBytes = textEncoder.encode(entryName);
        const contentBytes = textEncoder.encode(file.content);
        const crc32 = calculateCrc32(contentBytes);

        assertZip32Size(fileNameBytes.length, "ZIP filename");
        assertZip32Size(contentBytes.length, "ZIP entry");
        assertZip32Size(offset, "ZIP entry offset");

        const localHeader = createHeader(30);
        localHeader.setUint32(0, 0x04034b50, true);
        localHeader.setUint16(4, 20, true);
        localHeader.setUint16(6, 0x0800, true);
        localHeader.setUint16(8, 0, true);
        localHeader.setUint16(10, dosTime, true);
        localHeader.setUint16(12, dosDate, true);
        localHeader.setUint32(14, crc32, true);
        localHeader.setUint32(18, contentBytes.length, true);
        localHeader.setUint32(22, contentBytes.length, true);
        localHeader.setUint16(26, fileNameBytes.length, true);
        localHeader.setUint16(28, 0, true);

        chunks.push(new Uint8Array(localHeader.buffer), fileNameBytes, contentBytes);

        const centralDirectoryHeader = createHeader(46);
        centralDirectoryHeader.setUint32(0, 0x02014b50, true);
        centralDirectoryHeader.setUint16(4, 20, true);
        centralDirectoryHeader.setUint16(6, 20, true);
        centralDirectoryHeader.setUint16(8, 0x0800, true);
        centralDirectoryHeader.setUint16(10, 0, true);
        centralDirectoryHeader.setUint16(12, dosTime, true);
        centralDirectoryHeader.setUint16(14, dosDate, true);
        centralDirectoryHeader.setUint32(16, crc32, true);
        centralDirectoryHeader.setUint32(20, contentBytes.length, true);
        centralDirectoryHeader.setUint32(24, contentBytes.length, true);
        centralDirectoryHeader.setUint16(28, fileNameBytes.length, true);
        centralDirectoryHeader.setUint16(30, 0, true);
        centralDirectoryHeader.setUint16(32, 0, true);
        centralDirectoryHeader.setUint16(34, 0, true);
        centralDirectoryHeader.setUint16(36, 0, true);
        centralDirectoryHeader.setUint32(38, 0, true);
        centralDirectoryHeader.setUint32(42, offset, true);

        centralDirectoryChunks.push(new Uint8Array(centralDirectoryHeader.buffer), fileNameBytes);
        centralDirectoryLength += centralDirectoryHeader.byteLength + fileNameBytes.length;
        offset += localHeader.byteLength + fileNameBytes.length + contentBytes.length;
    }

    assertZip32Size(centralDirectoryLength, "ZIP central directory");
    assertZip32Size(offset, "ZIP central directory offset");

    const endOfCentralDirectory = createHeader(22);
    endOfCentralDirectory.setUint32(0, 0x06054b50, true);
    endOfCentralDirectory.setUint16(4, 0, true);
    endOfCentralDirectory.setUint16(6, 0, true);
    endOfCentralDirectory.setUint16(8, files.length, true);
    endOfCentralDirectory.setUint16(10, files.length, true);
    endOfCentralDirectory.setUint32(12, centralDirectoryLength, true);
    endOfCentralDirectory.setUint32(16, offset, true);
    endOfCentralDirectory.setUint16(20, 0, true);

    const allChunks = [...chunks, ...centralDirectoryChunks, new Uint8Array(endOfCentralDirectory.buffer)];

    return concatChunks(allChunks, offset + centralDirectoryLength + endOfCentralDirectory.byteLength);
}

export function createZipArchiveBlob(files: ZipTextFile[], modifiedAt = new Date()): Blob {
    const bytes = createZipArchiveBytes(files, modifiedAt);
    const buffer = new ArrayBuffer(bytes.byteLength);

    new Uint8Array(buffer).set(bytes);

    return new Blob([buffer], { type: "application/zip" });
}
