import { canStoreBytes } from "./quota.js";
import { createId } from "./defaults.js";
import type {
    ProjectDocumentV1,
    ProjectExportV1,
    ProjectRevisionReason,
    ProjectRevisionV1,
    ProjectSourceV1,
} from "./types.js";

const DATABASE_NAME = "reaper2ma-projects";
const DATABASE_VERSION = 1;
const PROJECTS_STORE = "projects";
const SOURCES_STORE = "sources";
const REVISIONS_STORE = "revisions";
const REVISION_LIMIT = 10;

export class ProjectStorageQuotaError extends Error {
    constructor() {
        super("The browser does not have enough local storage for this project.");
        this.name = "ProjectStorageQuotaError";
    }
}

export interface ProjectRepository {
    listProjects(): Promise<ProjectDocumentV1[]>;
    getProject(id: string): Promise<ProjectDocumentV1 | undefined>;
    saveProject(project: ProjectDocumentV1): Promise<void>;
    deleteProject(id: string): Promise<void>;
    duplicateProject(id: string, projectName: string): Promise<ProjectDocumentV1>;
    getSource(id: string): Promise<ProjectSourceV1 | undefined>;
    attachSource(project: ProjectDocumentV1, fileName: string, csvText: string): Promise<{ project: ProjectDocumentV1; source: ProjectSourceV1 }>;
    listRevisions(projectId: string): Promise<ProjectRevisionV1[]>;
    createCheckpoint(project: ProjectDocumentV1, reason: ProjectRevisionReason): Promise<ProjectRevisionV1>;
    restoreRevision(projectId: string, revisionId: string): Promise<ProjectDocumentV1>;
    exportProject(projectId: string): Promise<ProjectExportV1>;
    importProject(bundle: ProjectExportV1, mode: "replace" | "copy"): Promise<ProjectDocumentV1>;
}

export class IndexedDbProjectRepository implements ProjectRepository {
    private databasePromise?: Promise<IDBDatabase>;

    async listProjects(): Promise<ProjectDocumentV1[]> {
        const database = await this.database();
        const projects = await requestToPromise<ProjectDocumentV1[]>(database.transaction(PROJECTS_STORE).objectStore(PROJECTS_STORE).getAll());
        return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    async getProject(id: string): Promise<ProjectDocumentV1 | undefined> {
        const database = await this.database();
        return requestToPromise<ProjectDocumentV1 | undefined>(database.transaction(PROJECTS_STORE).objectStore(PROJECTS_STORE).get(id));
    }

    async saveProject(project: ProjectDocumentV1): Promise<void> {
        const database = await this.database();
        const transaction = database.transaction(PROJECTS_STORE, "readwrite");
        transaction.objectStore(PROJECTS_STORE).put(project);
        try {
            await transactionToPromise(transaction);
        } catch (error) {
            if (isQuotaError(error)) throw new ProjectStorageQuotaError();
            throw error;
        }
    }

    async deleteProject(id: string): Promise<void> {
        const database = await this.database();
        const sources = await this.sourcesForProject(id);
        const revisions = await this.listRevisions(id);
        const transaction = database.transaction([PROJECTS_STORE, SOURCES_STORE, REVISIONS_STORE], "readwrite");
        transaction.objectStore(PROJECTS_STORE).delete(id);
        for (const source of sources) transaction.objectStore(SOURCES_STORE).delete(source.id);
        for (const revision of revisions) transaction.objectStore(REVISIONS_STORE).delete(revision.id);
        await transactionToPromise(transaction);
    }

    async duplicateProject(id: string, projectName: string): Promise<ProjectDocumentV1> {
        const sourceProject = await this.requireProject(id);
        const now = new Date().toISOString();
        const duplicateId = createId();
        let duplicatedSource: ProjectSourceV1 | undefined;

        if (sourceProject.sourceId) {
            const source = await this.getSource(sourceProject.sourceId);
            if (source) {
                if (!(await canStoreBytes(source.byteSize))) throw new ProjectStorageQuotaError();
                duplicatedSource = { ...source, id: createId(), projectId: duplicateId, importedAt: now };
            }
        }

        const duplicate: ProjectDocumentV1 = {
            ...structuredClone(sourceProject),
            id: duplicateId,
            projectName: projectName.trim(),
            createdAt: now,
            updatedAt: now,
            sourceId: duplicatedSource?.id,
        };
        const database = await this.database();
        const transaction = database.transaction([PROJECTS_STORE, SOURCES_STORE], "readwrite");
        transaction.objectStore(PROJECTS_STORE).put(duplicate);
        if (duplicatedSource) transaction.objectStore(SOURCES_STORE).put(duplicatedSource);
        try {
            await transactionToPromise(transaction);
        } catch (error) {
            if (isQuotaError(error)) throw new ProjectStorageQuotaError();
            throw error;
        }
        return duplicate;
    }

    async getSource(id: string): Promise<ProjectSourceV1 | undefined> {
        const database = await this.database();
        return requestToPromise<ProjectSourceV1 | undefined>(database.transaction(SOURCES_STORE).objectStore(SOURCES_STORE).get(id));
    }

    async attachSource(
        project: ProjectDocumentV1,
        fileName: string,
        csvText: string,
    ): Promise<{ project: ProjectDocumentV1; source: ProjectSourceV1 }> {
        const byteSize = new TextEncoder().encode(csvText).byteLength;
        if (!(await canStoreBytes(byteSize))) throw new ProjectStorageQuotaError();

        const now = new Date().toISOString();
        const source: ProjectSourceV1 = {
            schemaVersion: 1,
            id: createId(),
            projectId: project.id,
            fileName,
            csvText,
            importedAt: now,
            sha256: await hashText(csvText),
            byteSize,
        };
        const updatedProject: ProjectDocumentV1 = {
            ...project,
            sourceId: source.id,
            sourceFileName: fileName,
            updatedAt: now,
        };
        const database = await this.database();
        const transaction = database.transaction([PROJECTS_STORE, SOURCES_STORE], "readwrite");
        transaction.objectStore(SOURCES_STORE).put(source);
        transaction.objectStore(PROJECTS_STORE).put(updatedProject);

        try {
            await transactionToPromise(transaction);
        } catch (error) {
            if (isQuotaError(error)) throw new ProjectStorageQuotaError();
            throw error;
        }

        return { project: updatedProject, source };
    }

    async listRevisions(projectId: string): Promise<ProjectRevisionV1[]> {
        const database = await this.database();
        const transaction = database.transaction(REVISIONS_STORE);
        const index = transaction.objectStore(REVISIONS_STORE).index("projectId");
        const revisions = await requestToPromise<ProjectRevisionV1[]>(index.getAll(projectId));
        return revisions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    }

    async createCheckpoint(project: ProjectDocumentV1, reason: ProjectRevisionReason): Promise<ProjectRevisionV1> {
        const revision: ProjectRevisionV1 = {
            schemaVersion: 1,
            id: createId(),
            projectId: project.id,
            createdAt: new Date().toISOString(),
            reason,
            snapshot: createSnapshot(project),
        };
        const database = await this.database();
        const transaction = database.transaction(REVISIONS_STORE, "readwrite");
        transaction.objectStore(REVISIONS_STORE).put(revision);
        try {
            await transactionToPromise(transaction);
        } catch (error) {
            if (isQuotaError(error)) throw new ProjectStorageQuotaError();
            throw error;
        }
        await this.pruneRevisions(project.id);
        return revision;
    }

    async restoreRevision(projectId: string, revisionId: string): Promise<ProjectDocumentV1> {
        const current = await this.requireProject(projectId);
        const database = await this.database();
        const revision = await requestToPromise<ProjectRevisionV1 | undefined>(
            database.transaction(REVISIONS_STORE).objectStore(REVISIONS_STORE).get(revisionId),
        );
        if (!revision || revision.projectId !== projectId) throw new Error("Project revision not found.");

        await this.createCheckpoint(current, "restore");
        const restored: ProjectDocumentV1 = {
            schemaVersion: 1,
            id: current.id,
            createdAt: current.createdAt,
            updatedAt: new Date().toISOString(),
            ...structuredClone(revision.snapshot),
        };
        await this.saveProject(restored);
        return restored;
    }

    async exportProject(projectId: string): Promise<ProjectExportV1> {
        const project = await this.requireProject(projectId);
        const revisions = await this.listRevisions(projectId);
        const sourceIds = new Set([project.sourceId, ...revisions.map((revision) => revision.snapshot.sourceId)].filter(Boolean) as string[]);
        const sources = (await Promise.all([...sourceIds].map((sourceId) => this.getSource(sourceId)))).filter(
            (source): source is ProjectSourceV1 => source !== undefined,
        );
        return {
            kind: "reaper2ma-project",
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            project,
            sources,
            revisions,
        };
    }

    async importProject(bundle: ProjectExportV1, mode: "replace" | "copy"): Promise<ProjectDocumentV1> {
        const importedId = mode === "copy" ? createId() : bundle.project.id;
        const sourceIdMap = new Map<string, string>();
        const now = new Date().toISOString();
        const sources = bundle.sources.map((source) => {
            const nextSourceId = mode === "copy" ? createId() : source.id;
            sourceIdMap.set(source.id, nextSourceId);
            return { ...structuredClone(source), id: nextSourceId, projectId: importedId };
        });
        const project: ProjectDocumentV1 = {
            ...structuredClone(bundle.project),
            id: importedId,
            projectName: mode === "copy" ? `${bundle.project.projectName} (import)` : bundle.project.projectName,
            updatedAt: now,
            sourceId: bundle.project.sourceId ? sourceIdMap.get(bundle.project.sourceId) : undefined,
        };
        const revisions = bundle.revisions.slice(0, REVISION_LIMIT).map((revision) => ({
            ...structuredClone(revision),
            id: mode === "copy" ? createId() : revision.id,
            projectId: importedId,
            snapshot: {
                ...structuredClone(revision.snapshot),
                sourceId: revision.snapshot.sourceId ? sourceIdMap.get(revision.snapshot.sourceId) : undefined,
            },
        }));
        const existingProject = mode === "replace" ? await this.getProject(importedId) : undefined;
        const replacedSources = existingProject ? await this.sourcesForProject(importedId) : [];
        const replacedRevisions = existingProject ? await this.listRevisions(importedId) : [];
        const importedBytes = sources.reduce((total, source) => total + source.byteSize, 0);
        const replacedBytes = replacedSources.reduce((total, source) => total + source.byteSize, 0);
        if (!(await canStoreBytes(Math.max(0, importedBytes - replacedBytes)))) throw new ProjectStorageQuotaError();

        const database = await this.database();
        const transaction = database.transaction([PROJECTS_STORE, SOURCES_STORE, REVISIONS_STORE], "readwrite");
        if (existingProject) {
            transaction.objectStore(PROJECTS_STORE).delete(existingProject.id);
            for (const source of replacedSources) transaction.objectStore(SOURCES_STORE).delete(source.id);
            for (const revision of replacedRevisions) transaction.objectStore(REVISIONS_STORE).delete(revision.id);
        }
        transaction.objectStore(PROJECTS_STORE).put(project);
        for (const source of sources) transaction.objectStore(SOURCES_STORE).put(source);
        for (const revision of revisions) transaction.objectStore(REVISIONS_STORE).put(revision);
        try {
            await transactionToPromise(transaction);
        } catch (error) {
            if (isQuotaError(error)) throw new ProjectStorageQuotaError();
            throw error;
        }
        return project;
    }

    private async requireProject(id: string): Promise<ProjectDocumentV1> {
        const project = await this.getProject(id);
        if (!project) throw new Error("Project not found.");
        return project;
    }

    private async sourcesForProject(projectId: string): Promise<ProjectSourceV1[]> {
        const database = await this.database();
        const index = database.transaction(SOURCES_STORE).objectStore(SOURCES_STORE).index("projectId");
        return requestToPromise<ProjectSourceV1[]>(index.getAll(projectId));
    }

    private async pruneRevisions(projectId: string): Promise<void> {
        const revisions = await this.listRevisions(projectId);
        const discarded = revisions.slice(REVISION_LIMIT);
        if (discarded.length === 0) return;

        const database = await this.database();
        const transaction = database.transaction(REVISIONS_STORE, "readwrite");
        for (const revision of discarded) transaction.objectStore(REVISIONS_STORE).delete(revision.id);
        await transactionToPromise(transaction);
        await this.pruneOrphanSources(projectId);
    }

    private async pruneOrphanSources(projectId: string): Promise<void> {
        const project = await this.requireProject(projectId);
        const revisions = await this.listRevisions(projectId);
        const usedIds = new Set([project.sourceId, ...revisions.map((revision) => revision.snapshot.sourceId)].filter(Boolean));
        const sources = await this.sourcesForProject(projectId);
        const orphaned = sources.filter((source) => !usedIds.has(source.id));
        if (orphaned.length === 0) return;

        const database = await this.database();
        const transaction = database.transaction(SOURCES_STORE, "readwrite");
        for (const source of orphaned) transaction.objectStore(SOURCES_STORE).delete(source.id);
        await transactionToPromise(transaction);
    }

    private database(): Promise<IDBDatabase> {
        this.databasePromise ??= openDatabase();
        return this.databasePromise;
    }
}

function createSnapshot(project: ProjectDocumentV1): ProjectRevisionV1["snapshot"] {
    return structuredClone({
        projectName: project.projectName,
        timecodeName: project.timecodeName,
        status: project.status,
        currentStage: project.currentStage,
        completedStages: project.completedStages,
        sourceId: project.sourceId,
        sourceFileName: project.sourceFileName,
        analysis: project.analysis,
        settings: project.settings,
    });
}

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(PROJECTS_STORE)) database.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
            if (!database.objectStoreNames.contains(SOURCES_STORE)) {
                const store = database.createObjectStore(SOURCES_STORE, { keyPath: "id" });
                store.createIndex("projectId", "projectId");
            }
            if (!database.objectStoreNames.contains(REVISIONS_STORE)) {
                const store = database.createObjectStore(REVISIONS_STORE, { keyPath: "id" });
                store.createIndex("projectId", "projectId");
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Project database upgrade is blocked by another tab."));
    });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    });
}

async function hashText(value: string): Promise<string> {
    if (crypto.subtle) {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }

    let hash = 0;
    for (let index = 0; index < value.length; index += 1) hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
    return Math.abs(hash).toString(16);
}

function isQuotaError(error: unknown): boolean {
    return error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}
