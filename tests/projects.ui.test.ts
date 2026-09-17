import { beforeEach, describe, expect, it } from "vitest";
import {
    IndexedDbProjectRepository,
    canStoreBytes,
    DEFAULT_PROJECT_SETTINGS,
    createProjectDocument,
    getStorageUsage,
    nextProjectVersionName,
    parseProjectExport,
    resolveInheritedSettings,
    serializeProjectExport,
    type ProjectSettingsV1,
} from "../src/lib/projects/index.js";

async function emptyProjectDatabase() {
    const repository = new IndexedDbProjectRepository();
    for (const project of await repository.listProjects()) await repository.deleteProject(project.id);
}

describe("IndexedDB project repository", () => {
    beforeEach(async () => {
        await emptyProjectDatabase();
    });

    it("creates, updates, reads and deletes projects", async () => {
        const repository = new IndexedDbProjectRepository();
        const project = createProjectDocument("Demo Show");
        expect(project.settings.timecodeOffsetMs).toBe(0);
        expect(project.settings.prefix).toBe("");
        await repository.saveProject(project);

        expect(await repository.getProject(project.id)).toEqual(project);
        expect(await repository.listProjects()).toHaveLength(1);

        const updated = { ...project, timecodeName: "Demo Show TC", updatedAt: new Date(Date.now() + 1000).toISOString() };
        await repository.saveProject(updated);
        expect((await repository.getProject(project.id))?.timecodeName).toBe("Demo Show TC");

        await repository.deleteProject(project.id);
        expect(await repository.getProject(project.id)).toBeUndefined();
    });

    it("stores the CSV and SHA-256 fingerprint, then duplicates it with an independent identity", async () => {
        const repository = new IndexedDbProjectRepository();
        const project = createProjectDocument("Show V2");
        await repository.saveProject(project);
        const attached = await repository.attachSource(project, "markers.csv", "#,Name,Start,Color\n1,Intro,0,");
        const duplicated = await repository.duplicateProject(project.id, nextProjectVersionName(project.projectName));

        expect(attached.source.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(duplicated.projectName).toBe("Show V3");
        expect(duplicated.timecodeName).toBe("Show V2");
        expect(duplicated.id).not.toBe(project.id);
        expect(duplicated.sourceId).not.toBe(attached.source.id);
        expect((await repository.getSource(duplicated.sourceId!))?.csvText).toBe(attached.source.csvText);
    });

    it("keeps only ten checkpoints and preserves the current state before a restore", async () => {
        const repository = new IndexedDbProjectRepository();
        let project = createProjectDocument("Revision 0");
        await repository.saveProject(project);

        for (let index = 1; index <= 12; index += 1) {
            project = { ...project, projectName: `Revision ${index}`, updatedAt: new Date().toISOString() };
            await repository.saveProject(project);
            await repository.createCheckpoint(project, "stage");
            await new Promise((resolve) => setTimeout(resolve, 2));
        }

        const revisions = await repository.listRevisions(project.id);
        expect(revisions).toHaveLength(10);
        const target = revisions[5]!;
        const restored = await repository.restoreRevision(project.id, target.id);
        expect(restored.projectName).toBe(target.snapshot.projectName);
        expect(await repository.listRevisions(project.id)).toHaveLength(10);
    });

    it("exports validated history and supports replace or copy on identifier collision", async () => {
        const repository = new IndexedDbProjectRepository();
        const createdProject = createProjectDocument("Export me");
        const project = { ...createdProject, settings: { ...createdProject.settings, timecodeOffsetMs: -500, prefix: "1" } };
        await repository.saveProject(project);
        const attached = await repository.attachSource(project, "show.csv", "#,Name,Start,Color\n1,Intro,0,");
        await repository.createCheckpoint(attached.project, "stage");

        const serialized = serializeProjectExport(await repository.exportProject(project.id));
        const parsed = parseProjectExport(serialized);
        expect(parsed.project.id).toBe(project.id);
        expect(parsed.project.settings.timecodeOffsetMs).toBe(-500);
        expect(parsed.project.settings.prefix).toBe("1");
        expect(parsed.sources).toHaveLength(1);
        expect(parsed.revisions).toHaveLength(1);

        const copy = await repository.importProject(parsed, "copy");
        expect(copy.id).not.toBe(project.id);
        expect(copy.projectName).toBe("Export me (import)");
        expect((await repository.getSource(copy.sourceId!))?.projectId).toBe(copy.id);

        const replacement = await repository.importProject(parsed, "replace");
        expect(replacement.id).toBe(project.id);
        expect((await repository.getProject(project.id))?.projectName).toBe("Export me");

        const legacyBundle = JSON.parse(serialized) as { project: { settings: { executorLayout?: string; timecodeOffsetMs?: number } }; revisions: Array<{ snapshot: { settings: { executorLayout?: string; timecodeOffsetMs?: number } } }> };
        delete legacyBundle.project.settings.executorLayout;
        delete legacyBundle.project.settings.timecodeOffsetMs;
        for (const revision of legacyBundle.revisions) {
            delete revision.snapshot.settings.executorLayout;
            delete revision.snapshot.settings.timecodeOffsetMs;
        }
        const parsedLegacy = parseProjectExport(JSON.stringify(legacyBundle));
        expect(parsedLegacy.project.settings.executorLayout).toBeUndefined();
        expect(parsedLegacy.project.settings.timecodeOffsetMs).toBeUndefined();

        const legacyCopy = await repository.importProject(parsedLegacy, "copy");
        const legacyRevision = (await repository.listRevisions(legacyCopy.id))[0];
        expect(legacyRevision).toBeDefined();
        const restoredLegacy = await repository.restoreRevision(legacyCopy.id, legacyRevision!.id);
        expect(restoredLegacy.settings.timecodeOffsetMs).toBeUndefined();

        const invalidOffsetBundle = structuredClone(parsed);
        invalidOffsetBundle.project.settings.timecodeOffsetMs = 921_598_961;
        expect(() => parseProjectExport(JSON.stringify(invalidOffsetBundle))).toThrow(/not a supported/i);
    });

    it("rejects malformed project exports", () => {
        expect(() => parseProjectExport('{"kind":"reaper2ma-project","schemaVersion":1}')).toThrow(/not a supported/i);
    });
});

describe("storage quota policy", () => {
    it("warns at 80% and preemptively blocks imports that would reach 95%", async () => {
        const original = Object.getOwnPropertyDescriptor(navigator, "storage");
        Object.defineProperty(navigator, "storage", {
            configurable: true,
            value: { estimate: async () => ({ usage: 80, quota: 100 }) },
        });

        expect(await getStorageUsage()).toMatchObject({ ratio: 0.8, warning: true, critical: false });
        expect(await canStoreBytes(14)).toBe(true);
        expect(await canStoreBytes(15)).toBe(false);

        if (original) Object.defineProperty(navigator, "storage", original);
        else Reflect.deleteProperty(navigator, "storage");
    });
});

describe("project version names", () => {
    it("increments V2/V3 suffixes without changing the timecode implicitly", () => {
        expect(nextProjectVersionName("Traversée")).toBe("Traversée V2");
        expect(nextProjectVersionName("Traversée V2")).toBe("Traversée V3");
    });
});

describe("settings inheritance for a new project", () => {
    const projectAt = (name: string, updatedAt: string, status: "draft" | "configured", settings: Partial<ProjectSettingsV1> = {}) => ({
        ...createProjectDocument(name, { ...DEFAULT_PROJECT_SETTINGS, ...settings }),
        status,
        updatedAt,
    });

    it("falls back to the defaults when there is no earlier project", () => {
        const inherited = resolveInheritedSettings([]);

        expect(inherited.from).toBeUndefined();
        expect(inherited.settings).toEqual(DEFAULT_PROJECT_SETTINGS);
    });

    it("reuses the console numbers of the most recent configured project", () => {
        const older = projectAt("Show A", "2026-01-01T00:00:00.000Z", "configured", { pageNumber: 4, pageSlotStart: 301 });
        const newer = projectAt("Show B", "2026-06-01T00:00:00.000Z", "configured", { pageNumber: 7, pageSlotStart: 221, sequenceNumber: 5000 });

        const inherited = resolveInheritedSettings([older, newer]);

        expect(inherited.from).toEqual({ id: newer.id, projectName: "Show B" });
        expect(inherited.settings.pageNumber).toBe(7);
        expect(inherited.settings.pageSlotStart).toBe(221);
        expect(inherited.settings.sequenceNumber).toBe(5000);
    });

    it("prefers a configured project over a more recent draft", () => {
        const configured = projectAt("Configured", "2026-01-01T00:00:00.000Z", "configured", { pageNumber: 9 });
        const draft = projectAt("Draft", "2026-06-01T00:00:00.000Z", "draft", { pageNumber: 2 });

        expect(resolveInheritedSettings([draft, configured]).settings.pageNumber).toBe(9);
    });

    it("falls back to the most recent draft when nothing is configured yet", () => {
        const draft = projectAt("Draft", "2026-06-01T00:00:00.000Z", "draft", { pageNumber: 2 });

        expect(resolveInheritedSettings([draft]).from?.projectName).toBe("Draft");
        expect(resolveInheritedSettings([draft]).settings.pageNumber).toBe(2);
    });

    it("never carries the timecode offset of another show over", () => {
        const previous = projectAt("Show A", "2026-06-01T00:00:00.000Z", "configured", { timecodeOffsetMs: 4500 });

        expect(resolveInheritedSettings([previous]).settings.timecodeOffsetMs).toBe(0);
    });

    it("completes a project saved under an older schema with the current defaults", () => {
        const previous = projectAt("Show A", "2026-06-01T00:00:00.000Z", "configured");
        delete (previous.settings as Partial<ProjectSettingsV1>).grandmaVersion;

        expect(resolveInheritedSettings([previous]).settings.grandmaVersion).toBe(DEFAULT_PROJECT_SETTINGS.grandmaVersion);
    });
});
