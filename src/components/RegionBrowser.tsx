import { useMemo, useState, type UIEvent } from "react";
import { convertReaperColorToCssColor, type ReaperCsvAnalysis, type ReaperAnalysisMarker, type ReaperAnalysisRegion } from "../lib/reaper2ma/index.js";
import { formatDuration } from "../lib/format.js";
import { useI18n } from "../i18n.js";

const ROW_HEIGHT = 46;

export function RegionBrowser({
    analysis,
    onSelectionChange,
    onOpenTimeline,
}: {
    analysis: ReaperCsvAnalysis;
    onSelectionChange?: (regionId: string | undefined) => void;
    onOpenTimeline?: (regionId: string | undefined, markerId?: string) => void;
}) {
    const { t } = useI18n();
    const regions = useMemo(() => {
        const items = analysis.regions.map((region) => ({
            ...region,
            label: region.isSynthetic ? t("region.default") : region.label,
        }));
        if (analysis.globalMarkers.length > 0) {
            items.push({
                id: "global",
                label: t("region.global"),
                start: "0",
                end: String(analysis.durationSeconds),
                startSeconds: 0,
                endSeconds: analysis.durationSeconds,
                color: "",
                isSynthetic: true,
                markers: analysis.globalMarkers,
            });
        }
        return items;
    }, [analysis, t]);
    const [selectedId, setSelectedId] = useState(regions[0]?.id ?? "");
    const selectedRegion = regions.find((region) => region.id === selectedId) ?? regions[0];
    const selectRegion = (regionId: string) => {
        setSelectedId(regionId);
        onSelectionChange?.(regionId || undefined);
    };

    return (
        <section className="region-browser" aria-label={t("project.regions")}>
            <div className="region-grid">
                {regions.map((region) => (
                    <RegionButton
                        key={region.id}
                        region={region}
                        selected={region.id === selectedRegion?.id}
                        onSelect={() => selectRegion(region.id)}
                        onOpenTimeline={onOpenTimeline ? () => onOpenTimeline(region.id) : undefined}
                    />
                ))}
            </div>
            <div className="region-mobile-list">
                {regions.map((region) => (
                    <div className="region-accordion" key={region.id}>
                        <RegionButton
                            region={region}
                            selected={region.id === selectedRegion?.id}
                            onSelect={() => selectRegion(region.id === selectedId ? "" : region.id)}
                            onOpenTimeline={onOpenTimeline ? () => onOpenTimeline(region.id) : undefined}
                        />
                        {selectedId === region.id ? <MarkerList markers={region.markers} onOpenTimeline={onOpenTimeline ? (markerId) => onOpenTimeline(region.id, markerId) : undefined} /> : null}
                    </div>
                ))}
            </div>
            {selectedRegion ? (
                <div className="region-detail desktop-region-detail">
                    <div className="region-detail-heading">
                        <div>
                            <span className="eyebrow">{selectedRegion.id === "global" || selectedRegion.isSynthetic ? t("region.group") : selectedRegion.id}</span>
                            <h3>{selectedRegion.label}</h3>
                        </div>
                        <span>{selectedRegion.markers.length} {t("project.markers").toLowerCase()}</span>
                    </div>
                    <MarkerList markers={selectedRegion.markers} onOpenTimeline={onOpenTimeline ? (markerId) => onOpenTimeline(selectedRegion.id, markerId) : undefined} />
                </div>
            ) : null}
        </section>
    );
}

function RegionButton({
    region,
    selected,
    onSelect,
    onOpenTimeline,
}: {
    region: ReaperAnalysisRegion;
    selected: boolean;
    onSelect: () => void;
    onOpenTimeline?: () => void;
}) {
    const { t } = useI18n();
    const color = convertReaperColorToCssColor(region.color) ?? "#8e8e93";
    return (
        <button
            type="button"
            className={`region-card${selected ? " selected" : ""}`}
            onClick={onSelect}
            onDoubleClick={onOpenTimeline}
            aria-expanded={selected}
            title={onOpenTimeline ? t("region.openTimelineHint") : undefined}
        >
            <span className="region-color" style={{ backgroundColor: color }} />
            <span className="region-card-copy">
                <strong>{region.label}</strong>
                <span>{formatDuration(region.startSeconds)} — {formatDuration(region.endSeconds)}</span>
            </span>
            <span className="region-count"><strong>{region.markers.length}</strong><small>{t("project.markers")}</small></span>
        </button>
    );
}

function MarkerList({ markers, onOpenTimeline }: { markers: ReaperAnalysisMarker[]; onOpenTimeline?: (markerId: string) => void }) {
    const { t } = useI18n();
    const [scrollTop, setScrollTop] = useState(0);
    const virtualized = markers.length > 100;
    const viewportHeight = Math.min(360, Math.max(ROW_HEIGHT, markers.length * ROW_HEIGHT));
    const start = virtualized ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4) : 0;
    const visibleCount = virtualized ? Math.ceil(viewportHeight / ROW_HEIGHT) + 8 : markers.length;
    const visible = markers.slice(start, start + visibleCount);

    if (markers.length === 0) return <p className="empty-inline">{t("region.empty")}</p>;

    return (
        <div
            className="marker-list"
            style={{ height: viewportHeight }}
            onScroll={(event: UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop)}
            role="list"
        >
            <div style={{ height: virtualized ? markers.length * ROW_HEIGHT : "auto", position: "relative" }}>
                {visible.map((marker, index) => {
                    const absoluteIndex = start + index;
                    const color = convertReaperColorToCssColor(marker.color) ?? "#8e8e93";
                    return (
                        <div
                            className="marker-row"
                            role="listitem"
                            key={marker.id}
                            onDoubleClick={() => onOpenTimeline?.(marker.id)}
                            title={onOpenTimeline ? t("marker.openTimelineHint") : undefined}
                            style={virtualized ? { position: "absolute", top: absoluteIndex * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT } : undefined}
                        >
                            <span className="marker-dot" style={{ backgroundColor: color }} />
                            <strong>{marker.name}</strong>
                            <time>{formatDuration(marker.startSeconds)}</time>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
