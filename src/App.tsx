import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { analyzeReaperCsv, createProjectOutputBaseName, downloadBlob, type ReaperCsvAnalysis } from "./lib/reaper2ma/index.js";
import {
    IndexedDbProjectRepository,
    createProjectDocument,
    getStorageUsage,
    nextProjectVersionName,
    parseProjectExport,
    requestPersistentStorage,
    resolveInheritedSettings,
    serializeProjectExport,
    type ProjectDocumentV1,
    type ProjectRevisionV1,
    type ProjectSourceV1,
    type ProjectStage,
    type StorageUsage,
} from "./lib/projects/index.js";
import { downloadProjectZip } from "./lib/projects/runtime.js";
import { CreateProject } from "./components/CreateProject.js";
import { HelpPage } from "./components/HelpPage.js";
import { LocaleSwitcher } from "./components/LocaleSwitcher.js";
import { ProjectLibrary } from "./components/ProjectLibrary.js";
import { ProjectOverview } from "./components/ProjectOverview.js";
import { ProjectWizard } from "./components/ProjectWizard.js";
import { readPreferences, useI18n, writePreferences } from "./i18n.js";

type Theme = "system" | "light" | "dark";
type AppRoute =
    | { kind: "home" }
    | { kind: "create" }
    | { kind: "help" }
    | { kind: "project"; projectId: string; mode: "overview" | "setup"; stage?: ProjectStage }
    | { kind: "invalid" };

const wizardStages = new Set<ProjectStage>(["source", "analysis", "cues", "sequences", "output", "executors", "extras", "review"]);

export function App() {
    const { locale, t } = useI18n();
    const navigate = useNavigate();
    const location = useLocation();
    const route = useMemo(() => resolveAppRoute(location.pathname), [location.pathname]);
    const routeProjectId = route.kind === "project" ? route.projectId : undefined;
    const repository = useMemo(() => new IndexedDbProjectRepository(), []);
    const importInputRef = useRef<HTMLInputElement>(null);
    const saveQueue = useRef(Promise.resolve());
    const projectLoadRequest = useRef(0);
    const [libraryLoading, setLibraryLoading] = useState(true);
    const [projectLoading, setProjectLoading] = useState(false);
    const [projects, setProjects] = useState<ProjectDocumentV1[]>([]);
    const [activeProject, setActiveProject] = useState<ProjectDocumentV1>();
    const [source, setSource] = useState<ProjectSourceV1>();
    const [analysis, setAnalysis] = useState<ReaperCsvAnalysis>();
    const [revisions, setRevisions] = useState<ProjectRevisionV1[]>([]);
    const [storageUsage, setStorageUsage] = useState<StorageUsage>();
    const [theme, setTheme] = useState<Theme>(() => readPreferences().theme ?? "system");
    const [notice, setNotice] = useState("");

    useEffect(() => { void loadLibrary(); }, []);
    useEffect(() => {
        if (theme === "system") delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = theme;
        writePreferences({ theme });
    }, [theme]);
    useEffect(() => {
        if (!notice) return;
        const timeout = window.setTimeout(() => setNotice(""), 5000);
        return () => window.clearTimeout(timeout);
    }, [notice]);
    useEffect(() => {
        if (!libraryLoading && route.kind === "invalid") navigate("/", { replace: true });
    }, [libraryLoading, navigate, route.kind]);
    useEffect(() => {
        if (libraryLoading || !routeProjectId) {
            setProjectLoading(false);
            return;
        }
        if (activeProject?.id === routeProjectId) {
            setProjectLoading(false);
            return;
        }

        const requestId = ++projectLoadRequest.current;
        setProjectLoading(true);
        void (async () => {
            try {
                const project = await repository.getProject(routeProjectId);
                if (requestId !== projectLoadRequest.current) return;
                if (!project) {
                    setNotice(t("project.notFound"));
                    navigate("/", { replace: true });
                    return;
                }
                const nextSource = project.sourceId ? await repository.getSource(project.sourceId) : undefined;
                if (requestId !== projectLoadRequest.current) return;
                setActiveProject(project);
                setSource(nextSource);
                setAnalysis(nextSource ? analyzeReaperCsv(nextSource.csvText) : undefined);
                setRevisions(await repository.listRevisions(project.id));
            } catch (error) {
                if (requestId === projectLoadRequest.current) {
                    setNotice(messageFromError(error));
                    navigate("/", { replace: true });
                }
            } finally {
                if (requestId === projectLoadRequest.current) setProjectLoading(false);
            }
        })();
    }, [activeProject?.id, libraryLoading, navigate, repository, routeProjectId, t]);

    const loadLibrary = async () => {
        try {
            setProjects(await repository.listProjects());
            setStorageUsage(await getStorageUsage());
        } catch (error) {
            setNotice(messageFromError(error));
        } finally {
            setLibraryLoading(false);
        }
    };

    const refreshStorage = async () => setStorageUsage(await getStorageUsage());
    const updateProjectList = (project: ProjectDocumentV1) => setProjects((items) => [project, ...items.filter((item) => item.id !== project.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    const navigateToProject = (project: ProjectDocumentV1, replace = false) => navigate(project.status === "configured" ? projectPath(project.id) : wizardPath(project.id, project.currentStage), { replace });

    const inheritedSettings = useMemo(() => resolveInheritedSettings(projects), [projects]);

    const createProject = async (name: string) => {
        const project = createProjectDocument(name, inheritedSettings.settings);
        await repository.saveProject(project);
        setProjects((items) => [project, ...items]);
        setActiveProject(project);
        setSource(undefined);
        setAnalysis(undefined);
        setRevisions([]);
        navigate(wizardPath(project.id, "source"));
    };

    const saveProject = async (project: ProjectDocumentV1, checkpoint = false) => {
        setActiveProject(project);
        updateProjectList(project);
        saveQueue.current = saveQueue.current.then(async () => {
            await repository.saveProject(project);
            if (checkpoint) {
                await repository.createCheckpoint(project, "stage");
                setRevisions(await repository.listRevisions(project.id));
            }
        });
        await saveQueue.current;
    };

    const attachSource = async (file: File, nextAnalysis: ReaperCsvAnalysis) => {
        if (!activeProject) return;
        try {
            if (activeProject.sourceId) await repository.createCheckpoint(activeProject, "source-replaced");
            const projectWithAnalysis: ProjectDocumentV1 = {
                ...activeProject,
                currentStage: "analysis",
                completedStages: [...new Set([...activeProject.completedStages, "source" as ProjectStage])],
                analysis: {
                    rowCount: nextAnalysis.rowCount,
                    markerCount: nextAnalysis.markerCount,
                    regionCount: nextAnalysis.regionCount,
                    durationSeconds: nextAnalysis.durationSeconds,
                    warningCount: nextAnalysis.diagnostics.length,
                },
                settings: { ...activeProject.settings, importMode: nextAnalysis.recommendedImportMode },
                updatedAt: new Date().toISOString(),
            };
            const csvText = await file.text();
            const attached = await repository.attachSource(projectWithAnalysis, file.name, csvText);
            await repository.createCheckpoint(attached.project, "stage");
            setActiveProject(attached.project);
            setSource(attached.source);
            setAnalysis(nextAnalysis);
            updateProjectList(attached.project);
            setRevisions(await repository.listRevisions(attached.project.id));
            navigate(wizardPath(attached.project.id, "analysis"));
            await requestPersistentStorage();
            await refreshStorage();
        } catch (error) {
            setNotice(messageFromError(error));
            throw error;
        }
    };

    const downloadZip = async (projectOverride?: ProjectDocumentV1) => {
        const projectToDownload = projectOverride ?? activeProject;
        if (!projectToDownload || !source) return;
        downloadProjectZip(projectToDownload, source);
        const updated = { ...projectToDownload, updatedAt: new Date().toISOString() };
        await repository.saveProject(updated);
        await repository.createCheckpoint(updated, "zip-export");
        setActiveProject(updated);
        updateProjectList(updated);
        setRevisions(await repository.listRevisions(updated.id));
        setNotice(t("review.downloaded"));
    };

    const finishProject = async (projectOverride?: ProjectDocumentV1) => {
        const projectToConfigure = projectOverride ?? activeProject;
        if (!projectToConfigure) return;
        const configured: ProjectDocumentV1 = { ...projectToConfigure, status: "configured", currentStage: "review", completedStages: [...new Set([...projectToConfigure.completedStages, "review" as ProjectStage])], updatedAt: new Date().toISOString() };
        await saveProject(configured, true);
        navigate(projectPath(configured.id), { replace: true });
    };

    const exportProject = async (project: ProjectDocumentV1) => {
        try {
            const bundle = await repository.exportProject(project.id);
            const fileName = `${createProjectOutputBaseName(project.projectName)}.reaper2ma.json`;
            downloadBlob(new Blob([serializeProjectExport(bundle)], { type: "application/json;charset=utf-8" }), fileName);
        } catch (error) { setNotice(messageFromError(error)); }
    };

    const importProject = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
            const bundle = parseProjectExport(await file.text());
            const existing = await repository.getProject(bundle.project.id);
            let mode: "replace" | "copy" = "copy";
            if (existing) {
                mode = window.confirm(locale === "fr" ? "Ce projet existe déjà. OK pour le remplacer, Annuler pour importer une copie." : "This project already exists. OK to replace it, Cancel to import a copy.") ? "replace" : "copy";
            }
            const project = await repository.importProject(bundle, mode);
            setActiveProject(undefined);
            await loadLibrary();
            navigateToProject(project);
        } catch (error) { setNotice(messageFromError(error)); }
    };

    const duplicateProject = async (project: ProjectDocumentV1) => {
        const name = window.prompt(locale === "fr" ? "Nom de la nouvelle version" : "New version name", nextProjectVersionName(project.projectName));
        if (!name?.trim()) return;
        try {
            const duplicate = await repository.duplicateProject(project.id, name.trim());
            updateProjectList(duplicate);
            setActiveProject(undefined);
            navigateToProject(duplicate);
        } catch (error) { setNotice(messageFromError(error)); }
    };

    const deleteProject = async (project: ProjectDocumentV1) => {
        if (!window.confirm(locale === "fr" ? `Supprimer définitivement « ${project.projectName} » ?` : `Permanently delete “${project.projectName}”?`)) return;
        try {
            await repository.deleteProject(project.id);
            setProjects((items) => items.filter((item) => item.id !== project.id));
            if (activeProject?.id === project.id) setActiveProject(undefined);
            navigate("/", { replace: true });
            await refreshStorage();
        } catch (error) { setNotice(messageFromError(error)); }
    };

    const restoreRevision = async (revision: ProjectRevisionV1) => {
        if (!activeProject || !window.confirm(locale === "fr" ? "Restaurer cette version ? L’état actuel sera sauvegardé." : "Restore this version? The current state will be saved.")) return;
        try {
            const restored = await repository.restoreRevision(activeProject.id, revision.id);
            updateProjectList(restored);
            setActiveProject(undefined);
            navigate(projectPath(restored.id), { replace: true });
        } catch (error) { setNotice(messageFromError(error)); }
    };

    const saveNames = async (projectName: string, timecodeName: string) => {
        if (!activeProject) return;
        await saveProject({ ...activeProject, projectName: projectName.trim(), timecodeName: timecodeName.trim(), updatedAt: new Date().toISOString() }, true);
    };

    const editStage = async (stage: ProjectStage) => {
        if (!activeProject) return;
        const edited = { ...activeProject, currentStage: stage };
        setActiveProject(edited);
        await repository.saveProject(edited);
        navigate(wizardPath(edited.id, stage));
    };

    const cycleTheme = () => setTheme((value) => value === "system" ? "light" : value === "light" ? "dark" : "system");
    const openHelp = (section?: string) => navigate("/help", { state: { from: route.kind === "help" ? "/" : location.pathname, ...(section ? { section } : {}) } });
    const closeHelp = () => navigate(resolveHelpReturnPath(location.state));
    const loading = route.kind !== "help" && (libraryLoading || route.kind === "invalid" || (route.kind === "project" && (projectLoading || activeProject?.id !== route.projectId)));
    const routedProject = route.kind === "project" && activeProject && route.mode === "setup" && route.stage ? { ...activeProject, currentStage: route.stage } : activeProject;
    const wizardVisible = route.kind === "project" && routedProject && (route.mode === "setup" || routedProject.status !== "configured");

    return (
        <div className="app-shell">
            <header className="app-header">
                <button className="brand" type="button" onClick={() => navigate("/")} aria-label="Reaper2MA home"><span className="brand-mark">R2</span><span><strong>Reaper2MA</strong><small>{t("app.local")}</small></span></button>
                <div className="header-controls">
                    <button className={`header-control help-control${route.kind === "help" ? " active" : ""}`} type="button" onClick={() => openHelp()} aria-label={t("action.help")} aria-current={route.kind === "help" ? "page" : undefined}><span aria-hidden="true">?</span><span>{t("action.help")}</span></button>
                    <LocaleSwitcher />
                    <button className="header-control" type="button" onClick={cycleTheme} aria-label={t("app.theme")}>{theme === "system" ? "◐" : theme === "light" ? "☀" : "☾"}</button>
                </div>
            </header>
            {notice ? <div className="notice" role="status">{notice}<button type="button" onClick={() => setNotice("")}>×</button></div> : null}
            {loading ? <main className="page centered-page"><div className="analysis-spinner" /></main> : null}
            {route.kind === "help" ? <HelpPage onBack={closeHelp} initialSection={resolveHelpInitialSection(location.state)} /> : null}
            {!loading && route.kind === "home" && projects.length > 0 ? <ProjectLibrary projects={projects} storageUsage={storageUsage} onOpen={navigateToProject} onCreate={() => navigate("/new")} onImport={() => importInputRef.current?.click()} onDuplicate={(project) => void duplicateProject(project)} onExport={(project) => void exportProject(project)} onDelete={(project) => void deleteProject(project)} /> : null}
            {!loading && (route.kind === "create" || (route.kind === "home" && projects.length === 0)) ? <CreateProject canGoBack={projects.length > 0} inheritedFrom={inheritedSettings.from?.projectName} onCreate={(name) => void createProject(name)} onBack={() => navigate("/")} onImport={() => importInputRef.current?.click()} onHelp={() => openHelp()} /> : null}
            {!loading && route.kind === "project" && routedProject && wizardVisible ? <ProjectWizard key={routedProject.id} project={routedProject} source={source} analysis={analysis} onSave={saveProject} onAttachSource={attachSource} onExit={() => navigate(routedProject.status === "configured" ? projectPath(routedProject.id) : "/")} onStageChange={(stage) => navigate(wizardPath(routedProject.id, stage))} onHelp={(section) => openHelp(section)} onDownload={downloadZip} onConfigured={finishProject} /> : null}
            {!loading && route.kind === "project" && routedProject && !wizardVisible ? <ProjectOverview project={routedProject} source={source} analysis={analysis} revisions={revisions} onBack={() => navigate("/")} onEdit={(stage) => void editStage(stage)} onSaveNames={saveNames} onDownload={downloadZip} onExportProject={() => void exportProject(routedProject)} onDuplicate={() => void duplicateProject(routedProject)} onRestore={(revision) => void restoreRevision(revision)} /> : null}
            <input ref={importInputRef} className="sr-only" type="file" accept=".json,.reaper2ma.json,application/json" onChange={(event) => void importProject(event)} />
        </div>
    );
}

function resolveAppRoute(pathname: string): AppRoute {
    if (pathname === "/") return { kind: "home" };
    if (pathname === "/new") return { kind: "create" };
    if (pathname === "/help") return { kind: "help" };

    const stageMatch = matchPath("/projects/:projectId/setup/:stage", pathname);
    if (stageMatch?.params.projectId && stageMatch.params.stage) {
        const stage = stageMatch.params.stage as ProjectStage;
        return wizardStages.has(stage) ? { kind: "project", projectId: stageMatch.params.projectId, mode: "setup", stage } : { kind: "invalid" };
    }

    const setupMatch = matchPath("/projects/:projectId/setup", pathname);
    if (setupMatch?.params.projectId) return { kind: "project", projectId: setupMatch.params.projectId, mode: "setup" };

    const projectMatch = matchPath("/projects/:projectId", pathname);
    if (projectMatch?.params.projectId) return { kind: "project", projectId: projectMatch.params.projectId, mode: "overview" };
    return { kind: "invalid" };
}

function projectPath(projectId: string): string { return `/projects/${encodeURIComponent(projectId)}`; }
function wizardPath(projectId: string, stage: ProjectStage): string { return `${projectPath(projectId)}/setup/${wizardStages.has(stage) ? stage : "source"}`; }
function resolveHelpReturnPath(state: unknown): string {
    if (!state || typeof state !== "object" || !("from" in state)) return "/";
    const from = (state as { from?: unknown }).from;
    return typeof from === "string" && from.startsWith("/") && from !== "/help" ? from : "/";
}
function resolveHelpInitialSection(state: unknown): string | undefined {
    if (!state || typeof state !== "object" || !("section" in state)) return undefined;
    const section = (state as { section?: unknown }).section;
    return typeof section === "string" ? section : undefined;
}
function messageFromError(error: unknown): string { return error instanceof Error ? error.message : "Unexpected error"; }
