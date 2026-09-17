import { useEffect, useMemo, useState } from "react";
import type { ReaperCsvAnalysis } from "../lib/reaper2ma/index.js";
import type { ProjectDocumentV1, ProjectRevisionV1, ProjectSourceV1, ProjectStage } from "../lib/projects/index.js";
import { createProjectRuntime } from "../lib/projects/runtime.js";
import { formatDate, formatDuration } from "../lib/format.js";
import { useI18n } from "../i18n.js";
import { RegionBrowser } from "./RegionBrowser.js";
import { TimelineModal } from "./TimelineModal.js";
import { ProjectSettingsSummary } from "./ProjectSettingsSummary.js";

export function ProjectOverview({
    project,
    source,
    analysis,
    revisions,
    onBack,
    onEdit,
    onSaveNames,
    onDownload,
    onExportProject,
    onDuplicate,
    onRestore,
}: {
    project: ProjectDocumentV1;
    source?: ProjectSourceV1;
    analysis?: ReaperCsvAnalysis;
    revisions: ProjectRevisionV1[];
    onBack: () => void;
    onEdit: (stage: ProjectStage) => void;
    onSaveNames: (projectName: string, timecodeName: string) => Promise<void>;
    onDownload: () => Promise<void>;
    onExportProject: () => void;
    onDuplicate: () => void;
    onRestore: (revision: ProjectRevisionV1) => void;
}) {
    const { t, locale } = useI18n();
    const [projectName, setProjectName] = useState(project.projectName);
    const [timecodeName, setTimecodeName] = useState(project.timecodeName);
    const [timelineOpen, setTimelineOpen] = useState(false);
    const [timelineRegionId, setTimelineRegionId] = useState<string | undefined>(analysis?.regions[0]?.id);
    const [timelineMarkerId, setTimelineMarkerId] = useState<string>();
    const openTimeline = (regionId?: string, markerId?: string) => {
        setTimelineRegionId(regionId);
        setTimelineMarkerId(markerId);
        setTimelineOpen(true);
    };
    const runtime = useMemo(() => {
        if (!source) return undefined;
        try { return createProjectRuntime(project, source); } catch { return undefined; }
    }, [project, source]);

    useEffect(() => { setProjectName(project.projectName); setTimecodeName(project.timecodeName); }, [project.projectName, project.timecodeName]);

    return (
        <main className="page overview-page">
            <button className="text-button back-to-library" type="button" onClick={onBack}>← {t("library.title")}</button>
            <header className="overview-hero">
                <div>
                    <span className="status-pill configured">{t("project.ready")}</span>
                    <h1>{project.projectName}</h1>
                    <p>{project.sourceFileName} · {formatDuration(project.analysis?.durationSeconds)}</p>
                </div>
                <div className="heading-actions">
                    <button className="button secondary" type="button" onClick={() => openTimeline()} disabled={!analysis}>{t("action.timeline")}</button>
                    <button className="button primary" type="button" onClick={() => void onDownload()} disabled={!source}>{t("review.download")} ↓</button>
                </div>
            </header>

            <div className="overview-grid">
                <section className="overview-card identity-overview">
                    <div className="card-heading"><div><span className="eyebrow">01</span><h2>{t("project.identity")}</h2></div></div>
                    <label className="field"><span>{t("project.name")}</span><input value={projectName} maxLength={100} onChange={(event) => setProjectName(event.target.value)} /></label>
                    <label className="field"><span>{t("project.timecode")}</span><input value={timecodeName} maxLength={120} onChange={(event) => setTimecodeName(event.target.value)} /></label>
                    <button className="button secondary full" type="button" disabled={!projectName.trim() || !timecodeName.trim() || (projectName === project.projectName && timecodeName === project.timecodeName)} onClick={() => void onSaveNames(projectName, timecodeName)}>{t("project.saveNames")}</button>
                </section>

                <section className="overview-card source-overview">
                    <div className="card-heading"><div><span className="eyebrow">02</span><h2>{t("project.source")}</h2></div><button className="text-button" type="button" onClick={() => onEdit("source")}>{source ? t("source.replace") : t("source.choose")}</button></div>
                    <div className="source-summary-row"><span className="file-icon">CSV</span><div><strong>{project.sourceFileName ?? "—"}</strong><span>{project.analysis?.markerCount ?? 0} {t("project.markers").toLowerCase()} · {project.analysis?.regionCount ?? 0} {t("project.regions").toLowerCase()}</span></div></div>
                    <div className="project-dates overview-dates"><span>{t("project.created")} · {formatDate(project.createdAt, locale)}</span><span>{t("project.updated")} · {formatDate(project.updatedAt, locale)}</span></div>
                </section>

                <section className="overview-card setup-overview wide-card">
                    <div className="card-heading"><div><span className="eyebrow">03</span><h2>{t("project.settings")}</h2></div></div>
                    <ProjectSettingsSummary project={project} executorAssignments={runtime?.executorAssignments} onEdit={onEdit} />
                </section>
            </div>

            {analysis ? (
                <section className="overview-card regions-overview">
                    <div className="card-heading"><div><span className="eyebrow">Timeline</span><h2>{t("analysis.title")}</h2></div><button className="text-button" type="button" onClick={() => openTimeline(timelineRegionId ?? analysis.regions[0]?.id)}>{t("action.timelineRegion")}</button></div>
                    <RegionBrowser analysis={analysis} onSelectionChange={setTimelineRegionId} onOpenTimeline={openTimeline} />
                </section>
            ) : null}

            <section className="overview-card history-overview">
                <div className="card-heading"><div><span className="eyebrow">Versions</span><h2>{t("project.history")}</h2></div><span>{revisions.length}/10</span></div>
                {revisions.length ? (
                    <div className="revision-list">
                        {revisions.map((revision) => (
                            <div className="revision-row" key={revision.id}>
                                <span className="revision-icon">↶</span>
                                <div><strong>{revisionReason(revision.reason, locale)}</strong><span>{formatDate(revision.createdAt, locale)}</span></div>
                                <button className="text-button" type="button" onClick={() => onRestore(revision)}>{t("history.restore")}</button>
                            </div>
                        ))}
                    </div>
                ) : <p className="empty-inline">{t("history.empty")}</p>}
            </section>

            <div className="overview-footer-actions">
                <button className="button secondary" type="button" onClick={onExportProject}>{t("action.export")} .reaper2ma.json</button>
                <button className="button secondary" type="button" onClick={onDuplicate}>{t("action.duplicate")} V2/V3</button>
            </div>
            {timelineOpen && analysis ? <TimelineModal analysis={analysis} output={runtime?.timeline} regionId={timelineRegionId} focusMarkerId={timelineMarkerId} timecodeOffsetMs={project.settings.exportMode === "cues-and-timecode" ? project.settings.timecodeOffsetMs ?? 0 : undefined} onClose={() => setTimelineOpen(false)} /> : null}
        </main>
    );
}

function revisionReason(reason: ProjectRevisionV1["reason"], locale: string) {
    const fr = { stage: "Étape terminée", "source-replaced": "CSV remplacé", restore: "Restauration", "zip-export": "ZIP exporté" };
    const en = { stage: "Stage completed", "source-replaced": "CSV replaced", restore: "Restore", "zip-export": "ZIP exported" };
    return (locale === "fr" ? fr : en)[reason];
}
