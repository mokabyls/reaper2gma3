import { formatEffectiveTimecode, formatTimecodeOffset, resolveInternalTimecodeSlot, type ExecutorAssignment } from "../lib/reaper2ma/index.js";
import type { ProjectDocumentV1, ProjectStage } from "../lib/projects/index.js";
import { useI18n, type Locale } from "../i18n.js";

/** `effect` states what the raw value actually does, so the summary reads without opening a tooltip. */
type SummaryItem = { label: string; value: string; effect?: string; enabled?: boolean };
type SummaryGroup = { title: string; description: string; stage: ProjectStage; items: SummaryItem[] };

/** A reference event used to show where the timecode offset lands. */
const OFFSET_EXAMPLE_MS = 10_000;

export function ProjectSettingsSummary({ project, executorAssignments, onEdit }: { project: ProjectDocumentV1; executorAssignments?: ExecutorAssignment[]; onEdit?: (stage: ProjectStage) => void }) {
    const { t, locale } = useI18n();
    const settings = project.settings;
    const yesNo = (value: boolean) => value ? t("summary.yes") : t("summary.no");
    const regionMode = settings.importMode === "regions-and-markers";
    const extrasUseSlots = settings.exportShowTimeMacros || settings.exportTimecodeControlMacros;
    const assignments = executorAssignments ?? [];

    const cueItems: SummaryItem[] = [
        { label: t("summary.importMode"), value: regionMode ? t("summary.perRegion") : t("summary.classic") },
        { label: t("cues.start"), value: String(settings.cueStartNumber) },
    ];
    if (regionMode) {
        cueItems.push(
            { label: t("cues.regionEnd"), value: `${settings.regionEndPreRollMs} ms`, effect: describeRegionEnd(settings.regionEndPreRollMs, locale) },
            { label: t("cues.layerPreRollEnabled"), value: yesNo(settings.regionLayerPreRollEnabled), enabled: settings.regionLayerPreRollEnabled },
            ...(settings.regionLayerPreRollEnabled ? [{ label: t("cues.layerPreRoll"), value: `${settings.regionLayerPreRollMs} ms` }] : []),
            { label: t("cues.autoOff"), value: yesNo(settings.autoOffRegionLayers), enabled: settings.autoOffRegionLayers },
        );
    }

    const outputItems: SummaryItem[] = [
        { label: t("summary.exportMode"), value: settings.exportMode === "cues-and-timecode" ? t("output.full") : t("output.cues") },
        { label: t("output.timecodeNumber"), value: settings.exportMode === "cues-and-timecode" ? String(settings.timecodeNumber) : t("summary.notCreated") },
        {
            label: t("output.timecodeOffset"),
            value: settings.exportMode === "cues-and-timecode" ? formatTimecodeOffset(settings.timecodeOffsetMs) : t("summary.notApplied"),
            effect: settings.exportMode === "cues-and-timecode" ? describeOffset(settings.timecodeOffsetMs, locale) : undefined,
        },
        { label: t("output.incomingSlot"), value: `TCSlot ${settings.externalTimecodeSlot}` },
    ];

    const executorItems: SummaryItem[] = [
        { label: t("executors.assign"), value: yesNo(settings.assignExecutors), enabled: settings.assignExecutors },
    ];
    if (settings.assignExecutors) {
        executorItems.push(
            { label: t("summary.executorLayout"), value: (settings.executorLayout ?? "continuous") === "region-per-page" ? t("executors.regionPerPage") : t("summary.continuous") },
            { label: t("executors.page"), value: `Page ${settings.pageNumber}` },
            { label: t("executors.main"), value: String(settings.pageSlotStart) },
            { label: t("executors.bump"), value: String(settings.bumpPageSlotStart) },
            ...(executorAssignments === undefined ? [] : [{ label: t("summary.assignments"), value: String(assignments.length), effect: describeExecutorFootprint(assignments, locale) }]),
        );
    }

    const extrasItems: SummaryItem[] = [
        { label: t("extras.showTime"), value: yesNo(settings.exportShowTimeMacros), enabled: settings.exportShowTimeMacros },
        { label: t("extras.timecodeControl"), value: yesNo(settings.exportTimecodeControlMacros), enabled: settings.exportTimecodeControlMacros },
        { label: t("extras.reaper"), value: yesNo(settings.includeReaperTransportMacros), enabled: settings.includeReaperTransportMacros },
    ];
    if (extrasUseSlots) {
        extrasItems.push(
            { label: t("extras.version"), value: settings.grandmaVersion },
            { label: t("extras.internalSlot"), value: `TCSlot ${resolveInternalTimecodeSlot(settings.grandmaVersion)}` },
            { label: t("extras.ltcSlot"), value: `TCSlot ${settings.externalTimecodeSlot}` },
        );
    }
    if (settings.includeReaperTransportMacros) {
        extrasItems.push(
            { label: t("extras.oscSlot"), value: String(settings.transportOscSlotId) },
            { label: t("extras.oscName"), value: settings.transportOscDataName || "—" },
            { label: t("extras.macroPrefix"), value: settings.transportMacroNamePrefix || "—" },
            { label: t("extras.outputFile"), value: settings.transportOutputFileName || "—" },
        );
    }

    const groups: SummaryGroup[] = [
        { title: t("summary.cuesRegions"), description: t("summary.cuesRegionsWhat"), stage: "cues", items: cueItems },
        { title: t("summary.sequences"), description: t("summary.sequencesWhat"), stage: "sequences", items: [
            { label: t("sequences.number"), value: String(settings.sequenceNumber), effect: describeSequenceRange(assignments, locale) },
            { label: t("sequences.namePrefix"), value: settings.sequenceNamePrefix || "—" },
            { label: t("sequences.repeatPrefixToggle"), value: settings.prefix.trim() ? `${t("summary.yes")} · ${settings.prefix.trim()}` : t("summary.no"), enabled: Boolean(settings.prefix.trim()) },
            { label: t("sequences.appearance"), value: String(settings.appearanceStartNumber) },
            { label: t("sequences.speed"), value: settings.speedMaster, effect: locale === "fr" ? `Toutes les séquences générées suivent le Speed Master ${settings.speedMaster}.` : `Every generated sequence follows Speed Master ${settings.speedMaster}.` },
        ] },
        { title: t("summary.output"), description: t("summary.outputWhat"), stage: "output", items: outputItems },
        { title: t("summary.executors"), description: t("summary.executorsWhat"), stage: "executors", items: executorItems },
        { title: t("summary.extras"), description: t("summary.extrasWhat"), stage: "extras", items: extrasItems },
    ];

    return (
        <section className="complete-settings-summary" aria-labelledby="complete-settings-title">
            <header>
                <div>
                    <h3 id="complete-settings-title">{t("summary.title")}</h3>
                    <p>{t("summary.copy")}</p>
                </div>
            </header>
            <div className="settings-summary-groups">
                {groups.map((group) => (
                    <section className="settings-summary-group" key={group.stage}>
                        <header>
                            <div>
                                <h4>{group.title}</h4>
                                <p className="settings-summary-what">{group.description}</p>
                            </div>
                            {onEdit ? <button className="text-button" type="button" onClick={() => onEdit(group.stage)} aria-label={`${t("action.edit")} · ${group.title}`}>{t("action.edit")}</button> : null}
                        </header>
                        <dl>
                            {group.items.map((item) => (
                                <div className="settings-summary-row" key={item.label}>
                                    <dt>{item.label}</dt>
                                    <dd className={item.enabled === undefined ? undefined : item.enabled ? "is-enabled" : "is-disabled"}>
                                        {item.value}
                                        {item.effect ? <small className="settings-summary-effect">{item.effect}</small> : null}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </section>
                ))}
            </div>
        </section>
    );
}

/** Spell out which faders the generated sequences will actually occupy. */
function describeExecutorFootprint(assignments: ExecutorAssignment[], locale: Locale): string | undefined {
    if (!assignments.length) return undefined;

    const parts = [...groupByPage(assignments)].map(([pageNumber, pageAssignments]) => {
        const groups = (["main", "bump"] as const)
            .map((slotGroup) => describeSlotRange(pageNumber, pageAssignments.filter((assignment) => assignment.slotGroup === slotGroup), slotGroup, locale))
            .filter(Boolean);
        return groups.join(" · ");
    });

    return parts.join(" · ");
}

function describeSlotRange(pageNumber: number, assignments: ExecutorAssignment[], slotGroup: "main" | "bump", locale: Locale): string {
    if (!assignments.length) return "";

    const slots = assignments.map((assignment) => assignment.slotNumber);
    const first = Math.min(...slots);
    const last = Math.max(...slots);
    const label = slotGroup === "bump" ? (locale === "fr" ? "bumps" : "bumps") : (locale === "fr" ? "principaux" : "main");
    const range = first === last ? `${pageNumber}.${first}` : `${pageNumber}.${first} → ${pageNumber}.${last}`;

    return `${label} ${range}`;
}

function describeSequenceRange(assignments: ExecutorAssignment[], locale: Locale): string | undefined {
    if (!assignments.length) return undefined;

    const numbers = [...new Set(assignments.map((assignment) => assignment.sequenceNumber))].sort((left, right) => left - right);
    const first = numbers[0];
    const last = numbers[numbers.length - 1];
    if (first === last) return locale === "fr" ? `Séquence ${first} dans le DataPool.` : `Sequence ${first} in the DataPool.`;

    /* A pinned number leaves gaps, so "first to last" would claim slots that stay free. */
    const contiguous = last - first + 1 === numbers.length;
    if (contiguous) return locale === "fr" ? `Séquences ${first} à ${last} dans le DataPool.` : `Sequences ${first} to ${last} in the DataPool.`;

    return locale === "fr"
        ? `${numbers.length} séquences entre ${first} et ${last}, numéros non contigus.`
        : `${numbers.length} sequences between ${first} and ${last}, numbers not contiguous.`;
}

function describeRegionEnd(preRollMs: number, locale: Locale): string {
    const endSeconds = 30;
    const triggered = (endSeconds - preRollMs / 1000).toFixed(3);

    return locale === "fr"
        ? `Une région finissant à 30.000 s déclenche sa cue de fin à ${triggered} s.`
        : `A region ending at 30.000 s fires its end cue at ${triggered} s.`;
}

function describeOffset(offsetMs: number | undefined, locale: Locale): string {
    const offset = offsetMs ?? 0;
    if (offset === 0) return locale === "fr" ? "Les événements partent à l’heure lue dans le CSV." : "Events fire at the time read from the CSV.";

    const shifted = formatEffectiveTimecode(OFFSET_EXAMPLE_MS + offset);

    return locale === "fr"
        ? `Un événement à 00:00:10.000 partira à ${shifted}.`
        : `An event at 00:00:10.000 will fire at ${shifted}.`;
}

function groupByPage(assignments: ExecutorAssignment[]): Map<number, ExecutorAssignment[]> {
    const pages = new Map<number, ExecutorAssignment[]>();
    for (const assignment of assignments) pages.set(assignment.pageNumber, [...(pages.get(assignment.pageNumber) ?? []), assignment]);

    return pages;
}
