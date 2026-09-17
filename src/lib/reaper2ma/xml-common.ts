import { XMLBuilder } from "fast-xml-parser";

export const XML_HEADER = {
    "?xml": {
        "@_version": "1.0",
        "@_encoding": "UTF-8",
    },
};

export const xmlBuilder = new XMLBuilder({
    attributeNamePrefix: "@_",
    ignoreAttributes: false,
    format: true,
    suppressEmptyNode: true,
    indentBy: "    ",
});

export function generateGuid(): string {
    return Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
        .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
        .join(" ");
}
