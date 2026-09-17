import { useEffect, useId, useMemo, useReducer, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { analyzeReaperCsvProgressively, createSequenceNumberPlan, findExecutorAddressConflicts, findSequenceNumberConflicts, formatEffectiveTimecode, formatTimecodeOffset, parseTimecodeOffset, resolveInternalTimecodeSlot, type ExecutorAddress, type ReaperAnalysisPhase, type ReaperCsvAnalysis, type TimelinePreview } from "../lib/reaper2ma/index.js";
import { createProjectRuntime } from "../lib/projects/runtime.js";
import type { ProjectDocumentV1, ProjectSourceV1, ProjectStage } from "../lib/projects/index.js";
import { useI18n } from "../i18n.js";
import { RegionBrowser } from "./RegionBrowser.js";
import { TimelineModal } from "./TimelineModal.js";
import { ProjectSettingsSummary } from "./ProjectSettingsSummary.js";

const stages: ProjectStage[] = ["source", "analysis", "cues", "sequences", "output", "executors", "extras", "review"];
/** The only stages a user must walk through to produce a ZIP. */
const mainStages: ProjectStage[] = ["source", "analysis", "review"];
/** Settings panels reached on demand from the review summary, never imposed. */
const detailStages: ProjectStage[] = ["cues", "sequences", "output", "executors", "extras"];
const isDetailStage = (stage: ProjectStage) => detailStages.includes(stage);

export function ProjectWizard({
    project,
    source,
    analysis,
    onSave,
    onAttachSource,
    onExit,
    onStageChange,
    onHelp,
    onDownload,
    onConfigured,
}: {
    project: ProjectDocumentV1;
    source?: ProjectSourceV1;
    analysis?: ReaperCsvAnalysis;
    onSave: (project: ProjectDocumentV1, checkpoint?: boolean) => Promise<void>;
    onAttachSource: (file: File, analysis: ReaperCsvAnalysis) => Promise<void>;
    onExit: () => void;
    onStageChange?: (stage: ProjectStage) => void;
    onHelp: (section?: string) => void;
    onDownload: (projectOverride?: ProjectDocumentV1) => Promise<void>;
    onConfigured: (projectOverride?: ProjectDocumentV1) => Promise<void>;
}) {
    const { t, locale } = useI18n();
    const [wizard, dispatch] = useReducer((state: { stage: ProjectStage }, action: { type: "go"; stage: ProjectStage }) => action.type === "go" ? { stage: action.stage } : state, { stage: project.currentStage });
    const [timelineOpen, setTimelineOpen] = useState(false);
    const [timelineRegionId, setTimelineRegionId] = useState<string | undefined>(analysis?.regions[0]?.id);
    const [timelineMarkerId, setTimelineMarkerId] = useState<string>();
    const [stageMotion, setStageMotion] = useState<"in" | "idle" | "out">("in");
    const [reviewTimecodeName, setReviewTimecodeName] = useState(project.timecodeName);
    const [timecodeOffsetValid, setTimecodeOffsetValid] = useState(true);
    const [manualExecutors, setManualExecutors] = useState(() => Object.keys(project.settings.executorOverrides ?? {}).length > 0);
    const [manualSequenceNumbers, setManualSequenceNumbers] = useState(() => Object.keys(project.settings.sequenceNumberOverrides ?? {}).length > 0);
    const [repeatPrefixEnabled, setRepeatPrefixEnabled] = useState(() => Boolean(project.settings.prefix.trim()));
    const [repeatPrefixDraft, setRepeatPrefixDraft] = useState(() => project.settings.prefix.trim() || "FX");
    const transitionFrameRef = useRef<number | undefined>(undefined);
    const [error, setError] = useState("");
    const runtime = useMemo(() => {
        if (!source) return undefined;
        try { return createProjectRuntime(project, source); } catch { return undefined; }
    }, [project, source]);
    const sequenceNumberPlan = useMemo(() => (runtime ? createSequenceNumberPlan(runtime.artifacts, project.settings) : []), [runtime, project.settings]);
    const sequenceExamples = useMemo(() => {
        const generated = runtime?.preview.generatedSequenceNames ?? [];
        const mainName = `${project.settings.sequenceNamePrefix.trim()} Sequence ${project.settings.sequenceNumber}`.trim();
        return [...new Set([...generated, ...(runtime?.artifacts.uniqueCues.length ? [mainName] : [])])].slice(0, 2);
    }, [project.settings.sequenceNamePrefix, project.settings.sequenceNumber, runtime]);
    const repeatExamples = useMemo(() => [
        ...(runtime?.artifacts.repeatedSequences.map((sequence) => sequence.displayName) ?? []),
        ...(runtime?.artifacts.bumpSequences.map((sequence) => sequence.displayName) ?? []),
    ].slice(0, 2), [runtime]);
    const generatedSequenceCount = runtime
        ? runtime.preview.generatedSequenceNames.length + (runtime.artifacts.uniqueCues.length > 0 ? 1 : 0)
        : 0;
    const totalDurationSeconds = runtime ? Number.parseFloat(runtime.preview.duration) || 0 : 0;
    const earliestOutputEventSeconds = useMemo(() => {
        const timestamps = runtime?.timeline.tracks.flatMap((track) => track.events.map((event) => Number.parseFloat(event.timestamp))).filter(Number.isFinite) ?? [];
        return timestamps.length ? Math.min(...timestamps) : undefined;
    }, [runtime]);

    useEffect(() => { dispatch({ type: "go", stage: project.currentStage }); }, [project.currentStage]);
    useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [wizard.stage]);
    useEffect(() => { setReviewTimecodeName(project.timecodeName); }, [project.timecodeName]);
    useEffect(() => {
        setRepeatPrefixEnabled(Boolean(project.settings.prefix.trim()));
        setRepeatPrefixDraft(project.settings.prefix.trim() || "FX");
    }, [project.id]);
    useEffect(() => {
        if (!timelineRegionId && analysis?.regions[0]) setTimelineRegionId(analysis.regions[0].id);
    }, [analysis, timelineRegionId]);
    useEffect(() => {
        transitionFrameRef.current = requestAnimationFrame(() => setStageMotion("idle"));
        return () => { if (transitionFrameRef.current !== undefined) cancelAnimationFrame(transitionFrameRef.current); };
    }, []);

    const update = async (patch: Partial<ProjectDocumentV1>, checkpoint = false) => {
        await onSave({ ...project, ...patch, updatedAt: new Date().toISOString() }, checkpoint);
    };
    const updateSettings = (patch: Partial<ProjectDocumentV1["settings"]>) => update({ settings: { ...project.settings, ...patch } });
    const go = async (stage: ProjectStage, checkpoint = true) => {
        const completedStages = [...new Set([...project.completedStages, wizard.stage])];
        if (stage !== wizard.stage) {
            setStageMotion("out");
            await waitForStageTransition();
        }
        dispatch({ type: "go", stage });
        onStageChange?.(stage);
        setStageMotion("in");
        transitionFrameRef.current = requestAnimationFrame(() => {
            transitionFrameRef.current = requestAnimationFrame(() => setStageMotion("idle"));
        });
        await update({ currentStage: stage, completedStages }, checkpoint);
    };
    const openTimeline = (regionId?: string, markerId?: string) => {
        setTimelineRegionId(regionId);
        setTimelineMarkerId(markerId);
        setTimelineOpen(true);
    };
    const saveReviewTimecodeName = async (): Promise<ProjectDocumentV1> => {
        const value = reviewTimecodeName.trim();
        if (!value) { setReviewTimecodeName(project.timecodeName); return project; }
        if (value === project.timecodeName) return project;
        const nextProject = { ...project, timecodeName: value, updatedAt: new Date().toISOString() };
        await onSave(nextProject);
        return nextProject;
    };
    const activeMainStage: ProjectStage = isDetailStage(wizard.stage) ? "review" : wizard.stage;
    const mainIndex = mainStages.indexOf(activeMainStage);
    const back = () => {
        if (isDetailStage(wizard.stage)) return void go("review", false);
        return mainIndex <= 0 ? onExit() : void go(mainStages[mainIndex - 1], false);
    };
    const detailEyebrow = (stage: ProjectStage) => `${t("stage.settingsGroup")} · ${stageLabel(stage)}`;
    const stageLabel = (stage: ProjectStage) => {
        if (stage === "identity") return t("project.identity");
        if (stage === "source") return t("stage.source");
        if (stage === "analysis") return t("stage.analysis");
        if (stage === "cues") return t("stage.cues");
        if (stage === "sequences") return t("stage.sequences");
        if (stage === "output") return t("stage.output");
        if (stage === "executors") return t("stage.executors");
        if (stage === "extras") return t("stage.extras");
        return t("stage.review");
    };

    return (
        <main className="page wizard-page">
            <div className="wizard-topbar">
                <button className="text-button" type="button" onClick={onExit}>← {project.projectName}</button>
                <span>{isDetailStage(wizard.stage) ? detailEyebrow(wizard.stage) : `${stageLabel(wizard.stage)} · ${mainIndex + 1}/${mainStages.length}`}</span>
            </div>
            <nav className="wizard-progress" aria-label="Project setup progress">
                {mainStages.map((stage, index) => (
                    <button
                        key={stage}
                        type="button"
                        className={`${activeMainStage === stage ? "active" : ""}${project.completedStages.includes(stage) ? " complete" : ""}`}
                        onClick={() => { if (source && (index <= mainIndex || project.completedStages.includes(stage))) void go(stage, false); }}
                        aria-current={activeMainStage === stage ? "step" : undefined}
                    >
                        <span>{index + 1}</span><small>{stageLabel(stage)}</small>
                    </button>
                ))}
            </nav>

            <section className="panel wizard-card">
                <div className={`wizard-stage-content is-${stageMotion}`} key={wizard.stage}>
                {wizard.stage === "source" ? (
                    <SourceStep
                        currentFileName={source?.fileName}
                        error={error}
                        onError={setError}
                        onHelp={() => onHelp("export-csv")}
                        onFile={async (file, nextAnalysis) => { await onAttachSource(file, nextAnalysis); dispatch({ type: "go", stage: "analysis" }); }}
                    />
                ) : null}

                {wizard.stage === "analysis" && analysis ? (
                    <>
                        <StepHeader eyebrow={`02 · ${stageLabel("analysis")}`} title={t("analysis.title")} copy={t("analysis.copy")} />
                        <div className="analysis-stats">
                            <Stat value={analysis.markerCount} label={t("project.markers")} />
                            <Stat value={analysis.regionCount} label={t("project.regions")} />
                            <Stat value={formatShortDuration(analysis.durationSeconds)} label={t("project.duration")} />
                        </div>
                        {analysis.diagnostics.length ? (
                            <div className="diagnostic-list">
                                {analysis.diagnostics.map((diagnostic, index) => <p className={diagnostic.severity} key={`${diagnostic.code}-${index}`}>{translateDiagnostic(diagnostic.code, diagnostic.message, locale)}</p>)}
                            </div>
                        ) : null}
                        <RegionBrowser analysis={analysis} onSelectionChange={setTimelineRegionId} onOpenTimeline={openTimeline} />
                        <button className="button secondary timeline-launch" type="button" onClick={() => openTimeline(timelineRegionId ?? analysis.regions[0]?.id)}>⌁ {t("action.timelineRegion")}</button>
                        <div className="step-question">
                            {analysis.regionCount ? (
                                <>
                                    <h2>{t("analysis.useRegions")}</h2>
                                    <p>{t("analysis.useRegionsHelp")}</p>
                                    <div className="choice-grid two">
                                        <button className={project.settings.importMode === "regions-and-markers" ? "choice selected" : "choice"} type="button" onClick={() => void updateSettings({ importMode: "regions-and-markers" })}><strong>{t("analysis.yes")}</strong><span>R1 → Sequence {project.settings.sequenceNumber + 1}</span></button>
                                        <button className={project.settings.importMode === "markers-only" ? "choice selected" : "choice"} type="button" onClick={() => void updateSettings({ importMode: "markers-only" })}><strong>{t("analysis.no")}</strong><span>Main + colors</span></button>
                                    </div>
                                </>
                            ) : <p className="inline-note">{t("analysis.noRegions")}</p>}
                        </div>
                        <WizardActions onBack={back} onNext={() => go("review")} />
                    </>
                ) : null}

                {wizard.stage === "cues" ? (
                    <>
                        <StepHeader eyebrow={detailEyebrow("cues")} title={t("cues.title")} copy={t("cues.copy")} />
                        <div className="field-grid">
                            <NumberField label={t("cues.start")} help={t("cues.startHelp")} value={project.settings.cueStartNumber} min={1} max={9999} onChange={(value) => updateSettings({ cueStartNumber: value })} />
                            {project.settings.importMode === "regions-and-markers" ? <NumberField label={t("cues.regionEnd")} help={t("cues.regionEndHelp")} value={project.settings.regionEndPreRollMs} min={0} max={5000} step={50} suffix="ms" onChange={(value) => updateSettings({ regionEndPreRollMs: value })} /> : null}
                        </div>
                        {project.settings.importMode === "regions-and-markers" ? (
                            <div className="settings-section">
                                <Toggle label={t("cues.layerPreRollEnabled")} help={t("cues.layerPreRollEnabledHelp")} checked={project.settings.regionLayerPreRollEnabled} onChange={(value) => updateSettings({ regionLayerPreRollEnabled: value })} />
                                {project.settings.regionLayerPreRollEnabled ? <div className="reveal-panel"><NumberField label={t("cues.layerPreRoll")} help={t("cues.layerPreRollHelp")} value={project.settings.regionLayerPreRollMs} min={0} max={5000} step={50} suffix="ms" onChange={(value) => updateSettings({ regionLayerPreRollMs: value })} /></div> : null}
                                <Toggle label={t("cues.autoOff")} help={t("cues.autoOffHelp")} checked={project.settings.autoOffRegionLayers} onChange={(value) => updateSettings({ autoOffRegionLayers: value })} />
                            </div>
                        ) : null}
                        <DetailStageActions onDone={() => go("review")} />
                    </>
                ) : null}

                {wizard.stage === "sequences" ? (
                    <>
                        <StepHeader eyebrow={detailEyebrow("sequences")} title={t("sequences.title")} copy={locale === "fr" ? "Définissez la plage et les noms utilisés dans votre DataPool." : "Set the range and names used in your DataPool."} />
                        <div className="field-grid">
                            <NumberField label={t("sequences.number")} help={t("sequences.numberHelp")} value={project.settings.sequenceNumber} min={1} max={9999} onChange={(value) => updateSettings({ sequenceNumber: value })} />
                            <TextField label={t("sequences.namePrefix")} help={t("sequences.namePrefixHelp")} value={project.settings.sequenceNamePrefix} onChange={(value) => updateSettings({ sequenceNamePrefix: value })} examples={sequenceExamples} />
                            <div className="optional-prefix-setting">
                                <Toggle
                                    label={t("sequences.repeatPrefixToggle")}
                                    help={t("sequences.repeatPrefixToggleHelp")}
                                    checked={repeatPrefixEnabled}
                                    onChange={async (enabled) => {
                                        setRepeatPrefixEnabled(enabled);
                                        const nextPrefix = enabled ? repeatPrefixDraft.trim() || "FX" : "";
                                        if (enabled) setRepeatPrefixDraft(nextPrefix);
                                        await updateSettings({ prefix: nextPrefix });
                                    }}
                                />
                                {repeatPrefixEnabled ? (
                                    <div className="reveal-panel optional-prefix-field">
                                        <TextField
                                            label={t("sequences.repeatPrefix")}
                                            help={t("sequences.repeatPrefixHelp")}
                                            value={repeatPrefixDraft}
                                            onChange={(value) => {
                                                setRepeatPrefixDraft(value);
                                                return updateSettings({ prefix: value });
                                            }}
                                            onBlur={() => {
                                                if (!repeatPrefixDraft.trim()) setRepeatPrefixEnabled(false);
                                            }}
                                            examples={repeatExamples}
                                        />
                                    </div>
                                ) : <GeneratedExamples examples={repeatExamples} standalone />}
                            </div>
                            <NumberField label={t("sequences.appearance")} help={t("sequences.appearanceHelp")} value={project.settings.appearanceStartNumber} min={1} max={9999} onChange={(value) => updateSettings({ appearanceStartNumber: value })} />
                            <NumberField label={t("sequences.speed")} help={t("sequences.speedHelp")} value={Number(project.settings.speedMaster.split(".")[1] ?? 4)} min={1} max={15} prefix="3." onChange={(value) => updateSettings({ speedMaster: `3.${value}` })} />
                        </div>
                        {sequenceNumberPlan.length ? (
                            <>
                                <div className="executor-manual-toggle">
                                    <Toggle label={t("sequences.manual")} help={t("sequences.manualHelp")} checked={manualSequenceNumbers} onChange={setManualSequenceNumbers} />
                                </div>
                                {manualSequenceNumbers ? (
                                    <SequenceNumberEditor
                                        entries={sequenceNumberPlan}
                                        overrides={project.settings.sequenceNumberOverrides ?? {}}
                                        onChange={(sequenceNumberOverrides) => void updateSettings({ sequenceNumberOverrides })}
                                    />
                                ) : null}
                            </>
                        ) : null}
                        <DetailStageActions onDone={() => go("review")} />
                    </>
                ) : null}

                {wizard.stage === "output" ? (
                    <>
                        <StepHeader eyebrow={detailEyebrow("output")} title={t("output.title")} copy={locale === "fr" ? "Le macro XML est toujours inclus dans le ZIP." : "The macro XML is always included in the ZIP."} />
                        <div className="choice-grid two output-choices">
                            <button className={project.settings.exportMode === "cues-and-timecode" ? "choice selected" : "choice"} type="button" onClick={() => void updateSettings({ exportMode: "cues-and-timecode" })}><strong>{t("output.full")}</strong><span>{t("output.fullHelp")}</span></button>
                            <button className={project.settings.exportMode === "cues-only" ? "choice selected" : "choice"} type="button" onClick={() => void updateSettings({ exportMode: "cues-only" })}><strong>{t("output.cues")}</strong><span>{t("output.cuesHelp")}</span></button>
                        </div>
                        <div className="field-grid output-fields reveal-panel">
                            {project.settings.exportMode === "cues-and-timecode" ? (
                                <>
                                    <NumberField label={t("output.timecodeNumber")} help={t("output.timecodeNumberHelp")} value={project.settings.timecodeNumber} min={1} max={9999} onChange={(value) => updateSettings({ timecodeNumber: value })} />
                                    <TimecodeOffsetField
                                        value={project.settings.timecodeOffsetMs ?? 0}
                                        earliestEventSeconds={earliestOutputEventSeconds}
                                        onChange={(value) => updateSettings({ timecodeOffsetMs: value })}
                                        onValidityChange={setTimecodeOffsetValid}
                                    />
                                </>
                            ) : null}
                            <NumberField label={t("output.incomingSlot")} help={t("output.incomingSlotHelp")} value={project.settings.externalTimecodeSlot} min={1} max={9999} onChange={(value) => updateSettings({ externalTimecodeSlot: value })} />
                        </div>
                        <DetailStageActions onDone={() => go("review")} disabled={project.settings.exportMode === "cues-and-timecode" && !timecodeOffsetValid} />
                    </>
                ) : null}

                {wizard.stage === "executors" ? (
                    <>
                        <StepHeader eyebrow={detailEyebrow("executors")} title={t("executors.title")} copy={locale === "fr" ? "Vous pourrez toujours assigner les séquences manuellement plus tard." : "You can always assign sequences manually later."} />
                        <Toggle label={t("executors.assign")} help={t("executors.assignHelp")} checked={project.settings.assignExecutors} onChange={(value) => updateSettings({ assignExecutors: value })} />
                        {project.settings.assignExecutors ? (
                            <div className="reveal-panel">
                                {project.settings.importMode === "regions-and-markers" && analysis?.regionCount ? (
                                    <div className="executor-layout-option">
                                        <Toggle label={t("executors.regionPerPage")} help={t("executors.regionPerPageHelp")} checked={(project.settings.executorLayout ?? "continuous") === "region-per-page"} onChange={(value) => updateSettings({ executorLayout: value ? "region-per-page" : "continuous" })} />
                                    </div>
                                ) : null}
                                <div className="field-grid three">
                                    <NumberField label={t("executors.page")} help={t("executors.pageHelp")} value={project.settings.pageNumber} min={1} max={9999} onChange={(value) => updateSettings({ pageNumber: value })} />
                                    <NumberField label={t("executors.main")} help={t("executors.mainHelp")} value={project.settings.pageSlotStart} min={101} max={490} onChange={(value) => updateSettings({ pageSlotStart: value })} />
                                    <NumberField label={t("executors.bump")} help={t("executors.bumpHelp")} value={project.settings.bumpPageSlotStart} min={101} max={490} onChange={(value) => updateSettings({ bumpPageSlotStart: value })} />
                                </div>
                                {runtime?.executorAssignments.length ? (
                                    <div className="executor-manual-toggle">
                                        <Toggle label={t("executors.manual")} help={t("executors.manualHelp")} checked={manualExecutors} onChange={setManualExecutors} />
                                    </div>
                                ) : null}
                                <ExecutorAssignmentPreview
                                    assignments={runtime?.executorAssignments ?? []}
                                    overrides={manualExecutors ? project.settings.executorOverrides ?? {} : undefined}
                                    onOverridesChange={(executorOverrides) => void updateSettings({ executorOverrides })}
                                />
                            </div>
                        ) : null}
                        <DetailStageActions onDone={() => go("review")} />
                    </>
                ) : null}

                {wizard.stage === "extras" ? (
                    <>
                        <StepHeader eyebrow={detailEyebrow("extras")} title={t("extras.title")} copy={locale === "fr" ? "Ces bibliothèques XML sont ajoutées au même ZIP." : "These XML libraries are added to the same ZIP."} />
                        <div className="settings-section">
                            <Toggle label={t("extras.showTime")} help={t("extras.showTimeHelp")} checked={project.settings.exportShowTimeMacros} onChange={(value) => updateSettings({ exportShowTimeMacros: value })} />
                            <Toggle label={t("extras.timecodeControl")} help={t("extras.timecodeControlHelp")} checked={project.settings.exportTimecodeControlMacros} onChange={(value) => updateSettings({ exportTimecodeControlMacros: value })} />
                            <Toggle label={t("extras.reaper")} help={t("extras.reaperHelp")} checked={project.settings.includeReaperTransportMacros} onChange={(value) => updateSettings({ includeReaperTransportMacros: value })} />
                        </div>
                        {project.settings.exportShowTimeMacros || project.settings.exportTimecodeControlMacros ? (
                            <div className="field-grid reveal-panel">
                                <SelectField label={t("extras.version")} help={t("extras.versionHelp")} value={project.settings.grandmaVersion} onChange={(value) => updateSettings({ grandmaVersion: value as "pre-2.4" | "2.4+" })} options={[{ value: "2.4+", label: "2.4+" }, { value: "pre-2.4", label: "Pre 2.4" }]} />
                                <div className="resolved-field"><span>{t("extras.ltcSlot")}</span><strong>TCSlot {project.settings.externalTimecodeSlot}</strong><small>{t("extras.ltcSlotReview")}</small></div>
                                <div className="resolved-field"><span>{t("extras.internalSlot")}</span><strong>TCSlot {resolveInternalTimecodeSlot(project.settings.grandmaVersion)}</strong></div>
                            </div>
                        ) : null}
                        {project.settings.includeReaperTransportMacros ? (
                            <details className="advanced-details" open>
                                <summary>REAPER OSC</summary>
                                <div className="field-grid">
                                    <NumberField label={t("extras.oscSlot")} help={t("extras.oscSlotHelp")} value={project.settings.transportOscSlotId} min={1} onChange={(value) => updateSettings({ transportOscSlotId: value })} />
                                    <TextField label={t("extras.oscName")} help={t("extras.oscNameHelp")} value={project.settings.transportOscDataName} onChange={(value) => updateSettings({ transportOscDataName: value })} />
                                    <TextField label={t("extras.macroPrefix")} help={t("extras.macroPrefixHelp")} value={project.settings.transportMacroNamePrefix} onChange={(value) => updateSettings({ transportMacroNamePrefix: value })} />
                                    <TextField label={t("extras.outputFile")} help={t("extras.outputFileHelp")} value={project.settings.transportOutputFileName} onChange={(value) => updateSettings({ transportOutputFileName: value })} />
                                </div>
                            </details>
                        ) : null}
                        <DetailStageActions onDone={() => go("review")} />
                    </>
                ) : null}

                {wizard.stage === "review" ? (
                    <>
                        <StepHeader eyebrow={`03 · ${stageLabel("review")}`} title={t("review.title")} copy={t("review.copy")} />
                        {runtime ? (
                            <>
                                <div className="analysis-stats review-stats">
                                    <Stat value={generatedSequenceCount} label={t("review.sequences")} />
                                    <Stat value={runtime.preview.uniqueCueCount} label={t("review.mainCues")} />
                                    <Stat value={`${formatSeconds(totalDurationSeconds)} s`} label={t("review.durationSeconds")} />
                                    <Stat value={formatClockDuration(totalDurationSeconds)} label={t("review.durationClock")} />
                                </div>
                                {runtime.preview.diagnostics.length ? <div className="diagnostic-list">{runtime.preview.diagnostics.map((diagnostic, index) => <p className={diagnostic.severity} key={`${diagnostic.code}-${index}`}>{translateDiagnostic(diagnostic.code, diagnostic.message, locale)}</p>)}</div> : null}
                                <div className="review-files"><h3>{t("review.files")}</h3>{runtime.files.map((file) => <code key={file.name}>{file.name}</code>)}</div>
                                <div className="review-identity">
                                    <div><span>{t("project.name")}</span><strong>{project.projectName}</strong></div>
                                    <TextField
                                        label={t("project.timecode")}
                                        help={t("review.timecodeEditable")}
                                        value={reviewTimecodeName}
                                        onChange={setReviewTimecodeName}
                                        onBlur={() => void saveReviewTimecodeName()}
                                        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                                    />
                                </div>
                                <ProjectSettingsSummary project={project} executorAssignments={runtime.executorAssignments} onEdit={(stage) => void go(stage, false)} />
                                {runtime.executorAssignments.length ? (
                                    <details className="advanced-details review-executor-details">
                                        <summary>{t("review.executorDetail")}</summary>
                                        <ExecutorAssignmentPreview assignments={runtime.executorAssignments} />
                                    </details>
                                ) : null}
                                <button className="button secondary timeline-launch" type="button" onClick={() => openTimeline(undefined)}>⌁ {t("action.timeline")}</button>
                                <p className="console-guide-link">{t("review.consoleHint")} <button className="text-button" type="button" onClick={() => onHelp("grandma3-import")}>{t("review.consoleLink")}</button></p>
                                <div className="wizard-actions final-actions">
                                    <button className="button secondary" type="button" onClick={back}>{t("action.back")}</button>
                                    <button className="button primary large" type="button" onClick={async () => { const projectForExport = await saveReviewTimecodeName(); await onDownload(projectForExport); await onConfigured(projectForExport); }}>{t("review.download")} ↓</button>
                                </div>
                            </>
                        ) : <div className="diagnostic-list"><p className="error">{t("error.generic")}</p></div>}
                    </>
                ) : null}
                </div>
            </section>
            {timelineOpen && analysis ? <TimelineModal analysis={analysis} output={runtime?.timeline as TimelinePreview | undefined} regionId={timelineRegionId} focusMarkerId={timelineMarkerId} timecodeOffsetMs={project.settings.exportMode === "cues-and-timecode" ? project.settings.timecodeOffsetMs ?? 0 : undefined} onClose={() => setTimelineOpen(false)} /> : null}
        </main>
    );
}

function SourceStep({ currentFileName, error, onError, onHelp, onFile }: { currentFileName?: string; error: string; onError: (value: string) => void; onHelp: () => void; onFile: (file: File, analysis: ReaperCsvAnalysis) => Promise<void> }) {
    const { t } = useI18n();
    const [phase, setPhase] = useState<string>();
    const processFile = async (file: File) => {
        if (!file.name.toLowerCase().endsWith(".csv")) { onError(t("source.invalid")); return; }
        onError("");
        try {
            setPhase(t("analysis.processing.read"));
            const csvText = await file.text();
            await yieldFrame();
            const phaseLabels: Record<ReaperAnalysisPhase, string> = {
                validation: t("analysis.processing.validate"),
                regions: t("analysis.processing.regions"),
                markers: t("analysis.processing.markers"),
                preview: t("analysis.processing.preview"),
            };
            const analysis = await analyzeReaperCsvProgressively(csvText, (nextPhase) => setPhase(phaseLabels[nextPhase]));
            const fatal = analysis.diagnostics.find((diagnostic) => diagnostic.severity === "error");
            if (fatal) { onError(fatal.message); setPhase(undefined); return; }
            await onFile(file, analysis);
        } catch (caught) {
            onError(caught instanceof Error ? caught.message : t("error.generic"));
        } finally {
            setPhase(undefined);
        }
    };
    const fromInput = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void processFile(file); event.target.value = ""; };
    const drop = (event: DragEvent<HTMLLabelElement>) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void processFile(file); };
    return (
        <>
            <StepHeader eyebrow="01 · CSV" title={t("source.title")} copy={t("source.copy")} />
            <label className={`drop-zone${phase ? " processing" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={drop}>
                <input type="file" accept=".csv,text/csv" onChange={fromInput} />
                {phase ? <><span className="analysis-spinner" /><strong>{phase}</strong><small>{currentFileName ?? "CSV"}</small></> : <><span className="upload-symbol">↑</span><strong>{t("source.drop")}</strong><span>{t("source.choose")}</span>{currentFileName ? <small>{t("source.replace")} · {currentFileName}</small> : null}</>}
            </label>
            <button className="source-help-link" type="button" onClick={onHelp}>? {t("source.exportHelp")}</button>
            {error ? <div className="diagnostic-list"><p className="error" role="alert">{error}</p></div> : null}
        </>
    );
}

function StepHeader({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) { return <header className="step-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{copy}</p></header>; }
function Stat({ value, label }: { value: string | number; label: string }) { return <div className="stat-card"><strong>{value}</strong><span>{label}</span></div>; }
function Toggle({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (value: boolean) => void | Promise<void> }) {
    const id = useId();
    return <div className="toggle-row"><div className="toggle-copy"><label htmlFor={id}>{label}</label>{help ? <HelpTooltip label={label} content={help} /> : null}</div><label className="toggle-switch" htmlFor={id}><input id={id} type="checkbox" checked={checked} onChange={(event) => void onChange(event.target.checked)} /><i aria-hidden="true" /></label></div>;
}
function NumberField({ label, help, value, onChange, min, max, step = 1, prefix, suffix }: { label: string; help?: string; value: number; onChange: (value: number) => void | Promise<void>; min?: number; max?: number; step?: number; prefix?: string; suffix?: string }) {
    const id = useId();
    return <div className="field"><FieldHeading id={id} label={label} help={help} /><div className="affixed-input">{prefix ? <b>{prefix}</b> : null}<input id={id} aria-label={label} type="number" value={value} min={min} max={max} step={step} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next) && (min === undefined || next >= min) && (max === undefined || next <= max)) void onChange(next); }} />{suffix ? <b>{suffix}</b> : null}</div></div>;
}
function TextField({ label, help, value, onChange, examples, onBlur, onKeyDown }: { label: string; help?: string; value: string; onChange: (value: string) => void | Promise<void>; examples?: string[]; onBlur?: () => void; onKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void }) {
    const id = useId();
    return <div className="field"><FieldHeading id={id} label={label} help={help} /><input id={id} aria-label={label} type="text" value={value} onChange={(event) => void onChange(event.target.value)} onBlur={onBlur} onKeyDown={onKeyDown} />{examples?.length ? <GeneratedExamples examples={examples} /> : null}</div>;
}
function GeneratedExamples({ examples, standalone = false }: { examples: string[]; standalone?: boolean }) {
    const { t } = useI18n();
    return examples.length ? <span className={`generated-examples${standalone ? " standalone" : ""}`}><small>{t("field.preview")}</small>{examples.map((example) => <code key={example}>{example}</code>)}</span> : null;
}
function TimecodeOffsetField({ value, earliestEventSeconds, onChange, onValidityChange }: { value: number; earliestEventSeconds?: number; onChange: (value: number) => void | Promise<void>; onValidityChange: (valid: boolean) => void }) {
    const { t } = useI18n();
    const id = useId();
    const errorId = `${id}-error`;
    const exampleId = `${id}-example`;
    const focusedRef = useRef(false);
    const [draft, setDraft] = useState(() => formatTimecodeOffset(value));
    const parsed = parseTimecodeOffset(draft);
    const valid = parsed !== undefined;
    const displayedOffset = parsed ?? value;
    const exampleRelativeMs = 60_000;
    const hasEventsBeforeZero = earliestEventSeconds !== undefined && earliestEventSeconds * 1000 + displayedOffset < 0;

    useEffect(() => {
        if (!focusedRef.current) setDraft(formatTimecodeOffset(value));
    }, [value]);
    useEffect(() => onValidityChange(valid), [onValidityChange, valid]);

    return (
        <div className="field timecode-offset-field">
            <FieldHeading id={id} label={t("output.timecodeOffset")} help={t("output.timecodeOffsetHelp")} />
            <input
                id={id}
                aria-label={t("output.timecodeOffset")}
                aria-describedby={valid ? exampleId : errorId}
                aria-invalid={!valid}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                maxLength={17}
                value={draft}
                onFocus={() => { focusedRef.current = true; }}
                onChange={(event) => {
                    const nextDraft = event.target.value;
                    const nextValue = parseTimecodeOffset(nextDraft);
                    setDraft(nextDraft);
                    if (nextValue !== undefined) void onChange(nextValue);
                }}
                onBlur={() => {
                    focusedRef.current = false;
                    const nextValue = parseTimecodeOffset(draft);
                    if (nextValue !== undefined) setDraft(formatTimecodeOffset(nextValue));
                }}
                placeholder="+01:00:00.000"
            />
            {valid ? <p className="timecode-offset-example" id={exampleId}>
                {t("output.timecodeOffsetExampleStart")} <code>{formatEffectiveTimecode(exampleRelativeMs)}</code> {t("output.timecodeOffsetExampleMiddle")} <code>{formatEffectiveTimecode(exampleRelativeMs + displayedOffset)}</code>.
            </p> : null}
            {!valid ? <small className="field-error" id={errorId} role="alert">{t("output.timecodeOffsetInvalid")}</small> : null}
            {valid && hasEventsBeforeZero ? <small className="field-warning" role="status">{t("output.timecodeOffsetNegativeWarning")}</small> : null}
        </div>
    );
}
function SelectField({ label, help, value, onChange, options }: { label: string; help?: string; value: string; onChange: (value: string) => void | Promise<void>; options: Array<{ value: string; label: string }> }) {
    const id = useId();
    return <div className="field"><FieldHeading id={id} label={label} help={help} /><select id={id} value={value} onChange={(event) => void onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
}
function FieldHeading({ id, label, help }: { id: string; label: string; help?: string }) {
    return <div className="field-heading"><label htmlFor={id}>{label}</label>{help ? <HelpTooltip label={label} content={help} /> : null}</div>;
}
function HelpTooltip({ label, content }: { label: string; content: string }) {
    const { t } = useI18n();
    const tooltipId = useId();
    const rootRef = useRef<HTMLSpanElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!open) return;
        const closeOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
        const closeWithEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); buttonRef.current?.blur(); } };
        document.addEventListener("pointerdown", closeOutside);
        document.addEventListener("keydown", closeWithEscape);
        return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeWithEscape); };
    }, [open]);

    return <span ref={rootRef} className={`help-tooltip${open ? " is-open" : ""}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}><button ref={buttonRef} className="help-tooltip-button" type="button" aria-label={`${t("action.help")} : ${label}`} aria-describedby={open ? tooltipId : undefined} onClick={(event) => { event.preventDefault(); setOpen(true); }}><span aria-hidden="true">?</span></button>{open ? <span className="help-tooltip-bubble" id={tooltipId} role="tooltip">{content}</span> : null}</span>;
}
/** One list, two modes: read-only by default,each row editable when `overrides` is supplied. */
function ExecutorAssignmentPreview({
    assignments,
    overrides,
    onOverridesChange,
}: {
    assignments: NonNullable<ReturnType<typeof createProjectRuntime>["executorAssignments"]>;
    overrides?: Record<string, ExecutorAddress>;
    onOverridesChange?: (overrides: Record<string, ExecutorAddress>) => void;
}) {
    const { t } = useI18n();
    const editable = Boolean(overrides && onOverridesChange);
    const conflicts = editable ? findExecutorAddressConflicts(assignments) : [];
    const pages = new Map<number, typeof assignments>();
    for (const assignment of assignments) pages.set(assignment.pageNumber, [...(pages.get(assignment.pageNumber) ?? []), assignment]);

    const setOverride = (sequenceNumber: number, address?: ExecutorAddress) => {
        const next = { ...(overrides ?? {}) };
        if (address) next[String(sequenceNumber)] = address;
        else delete next[String(sequenceNumber)];
        onOverridesChange?.(next);
    };

    return (
        <section className={`executor-assignment-preview${editable ? " is-editable" : ""}`} aria-labelledby="executor-assignment-title">
            <header>
                <div>
                    <h3 id="executor-assignment-title">{t("executors.preview")}</h3>
                    <p>{editable ? t("executors.manualHint") : t("executors.previewHelp")}</p>
                </div>
                <span>{assignments.length}</span>
            </header>
            {conflicts.length ? <p className="field-error" role="alert">{t("executors.manualConflict")} {conflicts.join(", ")}</p> : null}
            <div className="executor-page-list">
                {[...pages].map(([pageNumber, pageAssignments]) => (
                    <section className="executor-page" key={pageNumber}>
                        <header><strong>Page {pageNumber}</strong><span>{pageAssignments.length} {t("executors.sequenceCount")}</span></header>
                        <div className="executor-assignment-list" role="list">
                            {pageAssignments.map((assignment) => (
                                <div className="executor-assignment-row" role="listitem" key={assignment.sequenceNumber}>
                                    <code>Sequence {assignment.sequenceNumber}</code>
                                    <span title={assignment.sequenceName}>{assignment.sequenceName}</span>
                                    {editable ? (
                                        <ExecutorAddressField
                                            sequenceName={assignment.sequenceName}
                                            address={`${assignment.pageNumber}.${assignment.slotNumber}`}
                                            pinned={Boolean(assignment.pinned)}
                                            conflicting={conflicts.includes(`${assignment.pageNumber}.${assignment.slotNumber}`)}
                                            onPin={(address) => setOverride(assignment.sequenceNumber, address)}
                                            onReset={() => setOverride(assignment.sequenceNumber)}
                                        />
                                    ) : (
                                        <strong>Page {assignment.pageNumber}.{assignment.slotNumber}</strong>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </section>
    );
}

/** Empty means automatic; the placeholder shows where the sequence would land on its own. */
function ExecutorAddressField({
    sequenceName,
    address,
    pinned,
    conflicting,
    onPin,
    onReset,
}: {
    sequenceName: string;
    address: string;
    pinned: boolean;
    conflicting: boolean;
    onPin: (address: ExecutorAddress) => void;
    onReset: () => void;
}) {
    const { t } = useI18n();
    const inputId = useId();
    const [draft, setDraft] = useState(pinned ? address : "");
    const [invalid, setInvalid] = useState(false);

    const commit = () => {
        const value = draft.trim();
        if (!value) { setInvalid(false); if (pinned) onReset(); return; }

        const parsed = parseExecutorAddress(value);
        if (!parsed) { setInvalid(true); return; }

        setInvalid(false);
        setDraft(`${parsed.pageNumber}.${parsed.slotNumber}`);
        onPin(parsed);
    };

    return (
        <span className="executor-address-field">
            <label className="sr-only" htmlFor={inputId}>{`${t("executors.manualAddress")} — ${sequenceName}`}</label>
            <input
                id={inputId}
                type="text"
                inputMode="decimal"
                value={draft}
                placeholder={address}
                aria-invalid={invalid || conflicting ? true : undefined}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            />
            <button className="text-button" type="button" disabled={!pinned} onClick={() => { setDraft(""); setInvalid(false); onReset(); }}>
                {t("executors.manualAuto")}
            </button>
        </span>
    );
}
/** Accepts the grandMA3 spelling of an address, e.g. "2.250". */
function parseExecutorAddress(value: string): ExecutorAddress | undefined {
    const match = /^(\d{1,4})\.(\d{1,4})$/.exec(value);
    if (!match) return undefined;

    const pageNumber = Number(match[1]);
    const slotNumber = Number(match[2]);
    if (pageNumber < 1 || slotNumber < 1) return undefined;

    return { pageNumber, slotNumber };
}

/** Each row states the number a sequence receives on its own; typing another one pins it. */
function SequenceNumberEditor({
    entries,
    overrides,
    onChange,
}: {
    entries: ReturnType<typeof createSequenceNumberPlan>;
    overrides: Record<string, number>;
    onChange: (overrides: Record<string, number>) => void;
}) {
    const { t } = useI18n();
    const conflicts = findSequenceNumberConflicts(entries.map((entry) => entry.effectiveNumber));

    const setOverride = (automaticNumber: number, value?: number) => {
        const next = { ...overrides };
        if (value === undefined) delete next[String(automaticNumber)];
        else next[String(automaticNumber)] = value;
        onChange(next);
    };

    return (
        <section className="sequence-number-editor" aria-labelledby="sequence-number-title">
            <header>
                <div>
                    <h3 id="sequence-number-title">{t("sequences.manualTitle")}</h3>
                    <p>{t("sequences.manualHint")}</p>
                </div>
                <span>{entries.length}</span>
            </header>
            {conflicts.length ? (
                <p className="field-error" role="alert">{t("sequences.manualConflict")} {conflicts.join(", ")}</p>
            ) : null}
            <div className="sequence-number-list" role="list">
                {entries.map((entry) => (
                    <div className="sequence-number-row" role="listitem" key={entry.automaticNumber}>
                        <span title={entry.displayName}>{entry.displayName}</span>
                        <SequenceNumberField
                            sequenceName={entry.displayName}
                            automaticNumber={entry.automaticNumber}
                            effectiveNumber={entry.effectiveNumber}
                            pinned={entry.pinned}
                            conflicting={conflicts.includes(entry.effectiveNumber)}
                            onPin={(value) => setOverride(entry.automaticNumber, value)}
                            onReset={() => setOverride(entry.automaticNumber)}
                        />
                    </div>
                ))}
            </div>
        </section>
    );
}

function SequenceNumberField({
    sequenceName,
    automaticNumber,
    effectiveNumber,
    pinned,
    conflicting,
    onPin,
    onReset,
}: {
    sequenceName: string;
    automaticNumber: number;
    effectiveNumber: number;
    pinned: boolean;
    conflicting: boolean;
    onPin: (value: number) => void;
    onReset: () => void;
}) {
    const { t } = useI18n();
    const inputId = useId();
    const [draft, setDraft] = useState(pinned ? String(effectiveNumber) : "");
    const [invalid, setInvalid] = useState(false);

    const commit = () => {
        const value = draft.trim();
        if (!value) { setInvalid(false); if (pinned) onReset(); return; }

        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 9999) { setInvalid(true); return; }

        setInvalid(false);
        if (parsed === automaticNumber) { setDraft(""); onReset(); return; }

        setDraft(String(parsed));
        onPin(parsed);
    };

    return (
        <span className="executor-address-field">
            <label className="sr-only" htmlFor={inputId}>{`${t("sequences.manualNumber")} — ${sequenceName}`}</label>
            <input
                id={inputId}
                type="text"
                inputMode="numeric"
                value={draft}
                placeholder={String(automaticNumber)}
                aria-invalid={invalid || conflicting ? true : undefined}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            />
            <button className="text-button" type="button" disabled={!pinned} onClick={() => { setDraft(""); setInvalid(false); onReset(); }}>
                {t("executors.manualAuto")}
            </button>
        </span>
    );
}

function DetailStageActions({ onDone, disabled = false }: { onDone: () => void | Promise<void>; disabled?: boolean }) { const { t } = useI18n(); return <div className="wizard-actions detail-actions"><button className="button primary" type="button" disabled={disabled} onClick={() => void onDone()}>← {t("action.backToReview")}</button></div>; }
function WizardActions({ onBack, onNext, nextDisabled = false }: { onBack: () => void; onNext: () => void | Promise<void>; nextDisabled?: boolean }) { const { t } = useI18n(); return <div className="wizard-actions"><button className="button secondary" type="button" onClick={onBack}>{t("action.back")}</button><button className="button primary" type="button" disabled={nextDisabled} onClick={() => void onNext()}>{t("action.continue")} →</button></div>; }
function formatShortDuration(value: number) { const minutes = Math.floor(value / 60); const seconds = Math.floor(value % 60); return `${minutes}:${String(seconds).padStart(2, "0")}`; }
function formatSeconds(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""); }
function formatClockDuration(value: number) { const total = Math.max(0, Math.floor(value)); const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const seconds = total % 60; return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`; }
function yieldFrame() { return new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); }
function waitForStageTransition() { if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return Promise.resolve(); return new Promise<void>((resolve) => window.setTimeout(resolve, 150)); }
function translateDiagnostic(code: string, fallback: string, locale: string) {
    if (code === "conversion.empty-main-sequence") {
        return locale === "fr"
            ? "Aucune séquence principale ne sera créée : aucun marqueur standard non coloré n’est envoyé vers cette pile. Ce n’est pas bloquant : les séquences de régions, layers, répétitions, bumps et BPM seront tout de même exportées lorsqu’elles existent ; le numéro réservé à la séquence principale restera simplement libre. Si ce n’est pas le résultat attendu, ajoutez un marqueur non coloré hors région ou le tag [GLOBAL] ou [MAIN] à un marqueur."
            : "No main sequence will be created because no standard uncolored marker is routed to it. This does not block the export: region, layer, repeated-effect, bump, and BPM sequences are still exported when present; the number reserved for the main sequence simply remains unused. If you expected a main sequence, add an uncolored marker outside the regions or tag a marker with [GLOBAL] or [MAIN].";
    }
    if (locale !== "fr") return fallback;
    if (code === "csv.missing-headers") return "Le CSV ne contient pas toutes les colonnes obligatoires : #, Name et Start.";
    if (code === "csv.invalid-timestamp") return "Certaines positions ne sont pas exprimées en secondes. Réexportez le CSV depuis REAPER avec la règle en secondes.";
    if (code === "conversion.no-regions") return "Le mode régions est actif mais aucune région valide n’a été trouvée.";
    if (code === "conversion.no-markers") return "Aucun marqueur n’a été trouvé dans le CSV.";
    return fallback;
}
