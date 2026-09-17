import { useMemo, useState } from "react";
import type { ProjectDocumentV1, StorageUsage } from "../lib/projects/index.js";
import { formatBytes, formatDate, formatDuration } from "../lib/format.js";
import { useI18n } from "../i18n.js";

type Filter = "all" | "draft" | "configured";
type Sort = "updated" | "created" | "name" | "duration";

export function ProjectLibrary({
    projects,
    storageUsage,
    onOpen,
    onCreate,
    onImport,
    onDuplicate,
    onExport,
    onDelete,
}: {
    projects: ProjectDocumentV1[];
    storageUsage?: StorageUsage;
    onOpen: (project: ProjectDocumentV1) => void;
    onCreate: () => void;
    onImport: () => void;
    onDuplicate: (project: ProjectDocumentV1) => void;
    onExport: (project: ProjectDocumentV1) => void;
    onDelete: (project: ProjectDocumentV1) => void;
}) {
    const { t, locale } = useI18n();
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<Filter>("all");
    const [sort, setSort] = useState<Sort>("updated");
    const visibleProjects = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return projects
            .filter((project) => filter === "all" || project.status === filter)
            .filter((project) => !needle || [project.projectName, project.timecodeName, project.sourceFileName ?? ""].some((value) => value.toLowerCase().includes(needle)))
            .sort((left, right) => {
                if (sort === "name") return left.projectName.localeCompare(right.projectName, locale);
                if (sort === "created") return right.createdAt.localeCompare(left.createdAt);
                if (sort === "duration") return (right.analysis?.durationSeconds ?? 0) - (left.analysis?.durationSeconds ?? 0);
                return right.updatedAt.localeCompare(left.updatedAt);
            });
    }, [projects, query, filter, sort, locale]);

    return (
        <main className="page library-page">
            <div className="page-heading library-heading">
                <div>
                    <span className="eyebrow">Reaper2MA</span>
                    <h1>{t("library.title")}</h1>
                    <p>{t("library.subtitle")}</p>
                </div>
                <div className="heading-actions">
                    <button className="button secondary" type="button" onClick={onImport}>{t("action.import")}</button>
                    <button className="button primary" type="button" onClick={onCreate}>＋ {t("action.newProject")}</button>
                </div>
            </div>

            {storageUsage ? (
                <div className={`storage-meter${storageUsage.warning ? " warning" : ""}`}>
                    <span>{t("storage.title")}</span>
                    <div className="storage-track"><span style={{ width: `${Math.min(100, storageUsage.ratio * 100)}%` }} /></div>
                    <strong>{formatBytes(storageUsage.usage)} / {formatBytes(storageUsage.quota)}</strong>
                    {storageUsage.warning ? <p>{t("storage.warning")}</p> : null}
                </div>
            ) : null}

            <div className="library-toolbar">
                <label className="search-field">
                    <span className="sr-only">{t("library.search")}</span>
                    <span aria-hidden="true">⌕</span>
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("library.search")} type="search" />
                </label>
                <div className="segmented" aria-label={t("library.statusLabel")}>
                    {(["all", "draft", "configured"] as const).map((value) => (
                        <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
                            {value === "all" ? t("library.all") : value === "draft" ? t("library.drafts") : t("library.configured")}
                        </button>
                    ))}
                </div>
                <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label={t("library.sortLabel")}>
                    <option value="updated">{t("library.sort.updated")}</option>
                    <option value="created">{t("library.sort.created")}</option>
                    <option value="name">{t("library.sort.name")}</option>
                    <option value="duration">{t("library.sort.duration")}</option>
                </select>
            </div>

            {visibleProjects.length ? (
                <div className="project-grid">
                    {visibleProjects.map((project) => (
                        <article className="project-card" key={project.id}>
                            <button className="project-card-main" type="button" onClick={() => onOpen(project)}>
                                <div className="project-card-top">
                                    <span className={`status-pill ${project.status}`}>{project.status === "configured" ? t("project.ready") : t("project.draft")}</span>
                                    <span className="duration-pill">{formatDuration(project.analysis?.durationSeconds)}</span>
                                </div>
                                <h2>{project.projectName}</h2>
                                {project.timecodeName !== project.projectName ? <p className="timecode-name">TC · {project.timecodeName}</p> : null}
                                <p className="source-name">{project.sourceFileName ?? "CSV —"}</p>
                                <div className="project-stats">
                                    <span><strong>{project.analysis?.regionCount ?? 0}</strong>{t("project.regions")}</span>
                                    <span><strong>{project.analysis?.markerCount ?? 0}</strong>{t("project.markers")}</span>
                                </div>
                                <div className="project-dates">
                                    <span>{t("project.created")} · {formatDate(project.createdAt, locale)}</span>
                                    <span>{t("project.updated")} · {formatDate(project.updatedAt, locale)}</span>
                                </div>
                            </button>
                            <div className="project-card-actions">
                                <button type="button" onClick={() => onDuplicate(project)}>{t("action.duplicate")}</button>
                                <button type="button" onClick={() => onExport(project)}>{t("action.export")}</button>
                                <button className="danger-link" type="button" onClick={() => onDelete(project)}>{t("action.delete")}</button>
                            </div>
                        </article>
                    ))}
                </div>
            ) : <div className="empty-state">{t("library.empty")}</div>}
        </main>
    );
}
