import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { convertReaperColorToCssColor, formatEffectiveTimecode, formatTimecodeOffset, type ReaperCsvAnalysis, type TimelinePreview } from "../lib/reaper2ma/index.js";
import { formatDuration } from "../lib/format.js";
import { useI18n } from "../i18n.js";

type TimelineView = "source" | "output";
type TimelineLane = { id: string; label: string; color: string; regionId?: string; events: Array<{ id: string; label: string; time: number; meta: string }> };
type HoveredEvent = { lane: TimelineLane; event: TimelineLane["events"][number]; x: number; y: number };
type TimelineScope = { lanes: TimelineLane[]; rangeStart: number; rangeEnd: number; label?: string };
type TimelineFocus = { id: string; label: string; time: number };

const LEFT_GUTTER = 150;
const RULER_HEIGHT = 38;
const LANE_HEIGHT = 56;

export function TimelineModal({
    analysis,
    output,
    regionId,
    focusMarkerId,
    timecodeOffsetMs,
    onClose,
}: {
    analysis: ReaperCsvAnalysis;
    output?: TimelinePreview;
    regionId?: string;
    focusMarkerId?: string;
    timecodeOffsetMs?: number;
    onClose: () => void;
}) {
    const { t } = useI18n();
    const previousFocusRef = useRef<HTMLElement | undefined>(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
    const closeTimerRef = useRef<number | undefined>(undefined);
    const closingRef = useRef(false);
    const [view, setView] = useState<TimelineView>("source");
    const [closing, setClosing] = useState(false);
    const scope = useMemo(() => createTimelineScope(view, analysis, output, regionId, t("region.default"), t("region.global")), [view, analysis, output, regionId, t]);
    const focus = useMemo(() => resolveMarkerFocus(analysis, regionId, focusMarkerId), [analysis, focusMarkerId, regionId]);
    const requestClose = useCallback(() => {
        if (closingRef.current) return;
        closingRef.current = true;
        setClosing(true);
        closeTimerRef.current = window.setTimeout(onClose, 180);
    }, [onClose]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") requestClose(); };
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current);
            previousFocusRef.current?.focus();
        };
    }, [requestClose]);

    return (
        <div className={`modal-backdrop${closing ? " closing" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
            <section className="timeline-modal" role="dialog" aria-modal="true" aria-labelledby="timeline-heading">
                <header className="timeline-modal-header">
                    <div>
                        <span className="eyebrow">REAPER / grandMA3</span>
                        <h2 id="timeline-heading">{t("timeline.title")}</h2>
                        {timecodeOffsetMs !== undefined ? <p className="timeline-offset-label">{t("timeline.timecodeOffset")} · <strong>{formatTimecodeOffset(timecodeOffsetMs)}</strong></p> : null}
                        {scope.label ? <p className="timeline-scope-label">{t("timeline.scope")} · {scope.label}</p> : null}
                        {focus ? <p className="timeline-focus-label"><span aria-hidden="true">⌖</span> {t("timeline.focusedMarker")} · <strong>{focus.label}</strong> · {formatDuration(focus.time)}</p> : null}
                    </div>
                    <button className="icon-button" type="button" onClick={requestClose} aria-label={t("action.close")} autoFocus>×</button>
                </header>
                <div className="segmented timeline-tabs" role="tablist">
                    <button type="button" role="tab" aria-selected={view === "source"} className={view === "source" ? "active" : ""} onClick={() => setView("source")}>{t("timeline.source")}</button>
                    <button type="button" role="tab" aria-selected={view === "output"} className={view === "output" ? "active" : ""} onClick={() => setView("output")}>{t("timeline.output")}</button>
                </div>
                {scope.lanes.length ? <TimelineCanvas key={`${view}-${regionId ?? "all"}-${focusMarkerId ?? "none"}`} lanes={scope.lanes} rangeStart={scope.rangeStart} rangeEnd={scope.rangeEnd} focus={focus} timecodeOffsetMs={timecodeOffsetMs ?? 0} showEffectiveTime={view === "output"} /> : <div className="empty-state">{t("timeline.empty")}</div>}
            </section>
        </div>
    );
}

function TimelineCanvas({ lanes, rangeStart, rangeEnd, focus, timecodeOffsetMs, showEffectiveTime }: { lanes: TimelineLane[]; rangeStart: number; rangeEnd: number; focus?: TimelineFocus; timecodeOffsetMs: number; showEffectiveTime: boolean }) {
    const { t } = useI18n();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const lastPointer = useRef<{ x: number; offset: number } | undefined>(undefined);
    const pinch = useRef<{ distance: number; zoom: number; offset: number; anchorX: number } | undefined>(undefined);
    const focusAnimationRef = useRef(focus ? 0 : 1);
    const paintRef = useRef<(progress: number) => void>(() => undefined);
    const duration = Math.max(1, rangeEnd - rangeStart);
    const initialViewport = createFocusedViewport(rangeStart, rangeEnd, focus?.time);
    const [size, setSize] = useState({ width: 900, height: Math.max(320, RULER_HEIGHT + lanes.length * LANE_HEIGHT) });
    const [zoom, setZoom] = useState(initialViewport.zoom);
    const [offset, setOffset] = useState(initialViewport.offset);
    const [hovered, setHovered] = useState<HoveredEvent>();
    const visibleDuration = duration / zoom;

    const clampOffset = useCallback((value: number, nextZoom = zoom) => Math.min(Math.max(rangeStart, rangeEnd - duration / nextZoom), Math.max(rangeStart, value)), [duration, rangeEnd, rangeStart, zoom]);
    const applyZoom = useCallback((nextZoomValue: number, anchorX = size.width / 2) => {
        const nextZoom = Math.min(80, Math.max(1, nextZoomValue));
        const plotWidth = Math.max(1, size.width - LEFT_GUTTER);
        const normalizedX = Math.min(1, Math.max(0, (anchorX - LEFT_GUTTER) / plotWidth));
        const anchorTime = offset + normalizedX * visibleDuration;
        const nextVisible = duration / nextZoom;
        setZoom(nextZoom);
        setOffset(Math.min(Math.max(rangeStart, rangeEnd - nextVisible), Math.max(rangeStart, anchorTime - normalizedX * nextVisible)));
    }, [duration, offset, rangeEnd, rangeStart, size.width, visibleDuration]);

    useEffect(() => {
        if (!wrapRef.current) return;
        const observer = new ResizeObserver(([entry]) => {
            const width = Math.max(320, Math.floor(entry.contentRect.width));
            setSize({ width, height: Math.max(320, RULER_HEIGHT + lanes.length * LANE_HEIGHT) });
        });
        observer.observe(wrapRef.current);
        return () => observer.disconnect();
    }, [lanes.length]);

    paintRef.current = (progress: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ratio = window.devicePixelRatio || 1;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawTimeline(context, size, lanes, duration, zoom, offset, hovered, focus, progress);
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(size.width * ratio);
        canvas.height = Math.floor(size.height * ratio);
        canvas.style.width = `${size.width}px`;
        canvas.style.height = `${size.height}px`;
        paintRef.current(focusAnimationRef.current);
    }, [size, lanes, duration, zoom, offset, hovered, focus]);

    useEffect(() => {
        if (!focus || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
            focusAnimationRef.current = 1;
            paintRef.current(1);
            return;
        }
        focusAnimationRef.current = 0;
        let frame = 0;
        const startedAt = performance.now();
        const animate = (now: number) => {
            const progress = Math.min(1, (now - startedAt) / 1150);
            focusAnimationRef.current = progress;
            paintRef.current(progress);
            if (progress < 1) frame = requestAnimationFrame(animate);
        };
        frame = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(frame);
    }, [focus?.id, focus?.time]);

    const eventAtPoint = (x: number, y: number): HoveredEvent | undefined => {
        const laneIndex = Math.floor((y - RULER_HEIGHT) / LANE_HEIGHT);
        const lane = lanes[laneIndex];
        if (!lane || x < LEFT_GUTTER) return undefined;
        const time = offset + ((x - LEFT_GUTTER) / Math.max(1, size.width - LEFT_GUTTER)) * visibleDuration;
        const tolerance = visibleDuration / Math.max(1, size.width - LEFT_GUTTER) * 10;
        const event = lane.events.reduce<TimelineLane["events"][number] | undefined>((closest, candidate) =>
            Math.abs(candidate.time - time) <= tolerance && (!closest || Math.abs(candidate.time - time) < Math.abs(closest.time - time)) ? candidate : closest, undefined);
        return event ? { lane, event, x, y } : undefined;
    };

    const handleWheel = useCallback((event: WheelEvent) => {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
            applyZoom(zoom * Math.exp(-event.deltaY * 0.01), event.offsetX);
        } else {
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            setOffset(clampOffset(offset + delta / Math.max(1, size.width - LEFT_GUTTER) * visibleDuration));
        }
    }, [applyZoom, clampOffset, offset, size.width, visibleDuration, zoom]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        // Chrome maps a macOS trackpad pinch to ctrl+wheel. A native non-passive
        // listener is required so preventDefault also blocks browser page zoom.
        canvas.addEventListener("wheel", handleWheel, { passive: false });
        return () => canvas.removeEventListener("wheel", handleWheel);
    }, [handleWheel]);

    const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY });
        if (event.pointerType === "touch") setHovered(eventAtPoint(event.nativeEvent.offsetX, event.nativeEvent.offsetY));
        if (pointers.current.size === 1) lastPointer.current = { x: event.nativeEvent.offsetX, offset };
        if (pointers.current.size === 2) {
            const [left, right] = [...pointers.current.values()];
            pinch.current = { distance: Math.hypot(right.x - left.x, right.y - left.y), zoom, offset, anchorX: (left.x + right.x) / 2 };
        }
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!pointers.current.has(event.pointerId)) {
            setHovered(eventAtPoint(event.nativeEvent.offsetX, event.nativeEvent.offsetY));
            return;
        }
        pointers.current.set(event.pointerId, { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY });
        if (pointers.current.size === 2 && pinch.current) {
            const [left, right] = [...pointers.current.values()];
            const distance = Math.max(1, Math.hypot(right.x - left.x, right.y - left.y));
            const midpoint = (left.x + right.x) / 2;
            const nextZoom = Math.min(80, Math.max(1, pinch.current.zoom * distance / Math.max(1, pinch.current.distance)));
            const plotWidth = Math.max(1, size.width - LEFT_GUTTER);
            const anchorRatio = Math.min(1, Math.max(0, (pinch.current.anchorX - LEFT_GUTTER) / plotWidth));
            const anchorTime = pinch.current.offset + anchorRatio * (duration / pinch.current.zoom);
            const nextRatio = Math.min(1, Math.max(0, (midpoint - LEFT_GUTTER) / plotWidth));
            setZoom(nextZoom);
            setOffset(Math.min(Math.max(rangeStart, rangeEnd - duration / nextZoom), Math.max(rangeStart, anchorTime - nextRatio * (duration / nextZoom))));
        } else if (lastPointer.current) {
            const deltaPixels = lastPointer.current.x - event.nativeEvent.offsetX;
            setOffset(clampOffset(lastPointer.current.offset + deltaPixels / Math.max(1, size.width - LEFT_GUTTER) * visibleDuration));
        }
    };

    const endPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        pointers.current.delete(event.pointerId);
        lastPointer.current = undefined;
        pinch.current = undefined;
    };

    return (
        <div className="timeline-canvas-shell">
            <div className="timeline-zoom-controls" aria-label={t("timeline.zoom")}>
                <button type="button" onClick={() => applyZoom(zoom / 1.5)} aria-label="Zoom out">−</button>
                <button type="button" onClick={() => { setZoom(1); setOffset(rangeStart); }}>{t("timeline.fit")}</button>
                <button type="button" onClick={() => applyZoom(zoom * 1.5)} aria-label="Zoom in">+</button>
                <span>{Math.round(zoom * 100)}%</span>
            </div>
            <div className="timeline-legend" aria-label={t("timeline.legend")}>
                {lanes.slice(0, 12).map((lane) => <span key={lane.id}><i style={{ backgroundColor: lane.color }} />{lane.label}</span>)}
                {lanes.length > 12 ? <strong>+{lanes.length - 12}</strong> : null}
            </div>
            <div className="timeline-canvas-wrap" ref={wrapRef}>
                <canvas
                    ref={canvasRef}
                    role="img"
                    tabIndex={0}
                    aria-label={`${t("timeline.title")}, ${lanes.length} tracks, ${formatDuration(rangeEnd - rangeStart)}${showEffectiveTime ? `, ${t("timeline.timecodeOffset")}: ${formatTimecodeOffset(timecodeOffsetMs)}` : ""}${focus ? `, ${t("timeline.focusedMarker")}: ${focus.label}, ${formatDuration(focus.time)}` : ""}`}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={endPointer}
                    onPointerCancel={endPointer}
                    onPointerLeave={() => { if (pointers.current.size === 0) setHovered(undefined); }}
                />
                {hovered ? (
                    <div className="timeline-tooltip" style={{ left: Math.min(size.width - 230, hovered.x + 12), top: Math.max(8, hovered.y - 34) }}>
                        <strong>{hovered.event.label}</strong>
                        <span>{hovered.lane.label}</span>
                        <small>{t("timeline.relativeTime")} · {formatEffectiveTimecode(hovered.event.time * 1000)}</small>
                        {showEffectiveTime ? <small>{t("timeline.effectiveLtc")} · {formatEffectiveTimecode(hovered.event.time * 1000 + timecodeOffsetMs)}</small> : null}
                        <small>{hovered.event.meta}</small>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function resolveMarkerFocus(analysis: ReaperCsvAnalysis, regionId: string | undefined, markerId: string | undefined): TimelineFocus | undefined {
    if (!markerId) return undefined;
    const markers = regionId === "global"
        ? analysis.globalMarkers
        : analysis.regions.find((region) => region.id === regionId)?.markers
            ?? [...analysis.regions.flatMap((region) => region.markers), ...analysis.globalMarkers];
    const marker = markers.find((candidate) => candidate.id === markerId);
    return marker ? { id: marker.id, label: marker.name, time: marker.startSeconds } : undefined;
}

function createFocusedViewport(rangeStart: number, rangeEnd: number, focusTime: number | undefined) {
    const duration = Math.max(1, rangeEnd - rangeStart);
    if (focusTime === undefined || !Number.isFinite(focusTime) || focusTime < rangeStart || focusTime > rangeEnd) {
        return { zoom: 1, offset: rangeStart };
    }
    const visibleDuration = Math.min(duration, Math.max(8, Math.min(18, duration * 0.35)));
    const zoom = duration / visibleDuration;
    const offset = Math.min(rangeEnd - visibleDuration, Math.max(rangeStart, focusTime - visibleDuration / 2));
    return { zoom, offset };
}

function createTimelineScope(
    view: TimelineView,
    analysis: ReaperCsvAnalysis,
    output: TimelinePreview | undefined,
    regionId: string | undefined,
    defaultLabel: string,
    globalLabel: string,
): TimelineScope {
    const lanes = createLanes(view, analysis, output, defaultLabel, globalLabel);
    if (!regionId) {
        return { lanes, rangeStart: 0, rangeEnd: Math.max(1, view === "source" ? analysis.durationSeconds : output?.durationSeconds ?? 1) };
    }

    const region = analysis.regions.find((candidate) => candidate.id === regionId);
    if (!region && regionId !== "global") {
        return { lanes, rangeStart: 0, rangeEnd: Math.max(1, view === "source" ? analysis.durationSeconds : output?.durationSeconds ?? 1) };
    }

    const label = region ? (region.isSynthetic ? defaultLabel : region.label) : globalLabel;
    const regionStart = region?.startSeconds ?? 0;
    const regionEnd = Math.max(regionStart + 0.001, region?.endSeconds ?? analysis.durationSeconds);

    if (view === "source") {
        return {
            lanes: lanes.filter((lane) => lane.id === regionId),
            rangeStart: regionStart,
            rangeEnd: regionEnd,
            label,
        };
    }

    const ownedEvents = lanes
        .filter((lane) => lane.regionId === regionId)
        .flatMap((lane) => lane.events)
        .map((event) => event.time);
    const scopedStart = Math.max(0, Math.min(regionStart, ...ownedEvents));
    const scopedEnd = Math.max(regionEnd, ...ownedEvents);
    const scopedLanes = lanes
        .filter((lane) => !lane.regionId || lane.regionId === regionId)
        .map((lane) => ({
            ...lane,
            events: lane.events.filter((event) => event.time >= scopedStart && event.time <= scopedEnd),
        }))
        .filter((lane) => lane.events.length > 0 || lane.regionId === regionId);

    return {
        lanes: scopedLanes,
        rangeStart: scopedStart,
        rangeEnd: Math.max(scopedStart + 1, scopedEnd),
        label,
    };
}

function createLanes(view: TimelineView, analysis: ReaperCsvAnalysis, output: TimelinePreview | undefined, defaultLabel: string, globalLabel: string): TimelineLane[] {
    if (view === "output") {
        return (output?.tracks ?? []).map((track) => ({
            id: track.id,
            label: track.displayName,
            color: track.color,
            ...(track.regionId ? { regionId: track.regionId } : {}),
            events: track.events.map((event) => ({ id: event.id, label: event.label, time: Number.parseFloat(event.timestamp) || 0, meta: event.token })),
        }));
    }
    const sourceLanes: TimelineLane[] = analysis.regions.map((region) => ({
        id: region.id,
        label: region.isSynthetic ? defaultLabel : region.label,
        color: convertReaperColorToCssColor(region.color) ?? "#8e8e93",
        regionId: region.id,
        events: region.markers.map((marker) => ({ id: marker.id, label: marker.name, time: marker.startSeconds, meta: marker.start })),
    }));
    if (analysis.globalMarkers.length) {
        sourceLanes.push({
            id: "global",
            label: globalLabel,
            color: "#8e8e93",
            events: analysis.globalMarkers.map((marker) => ({ id: marker.id, label: marker.name, time: marker.startSeconds, meta: marker.start })),
        });
    }
    return sourceLanes;
}

function drawTimeline(
    context: CanvasRenderingContext2D,
    size: { width: number; height: number },
    lanes: TimelineLane[],
    duration: number,
    zoom: number,
    offset: number,
    hovered?: HoveredEvent,
    focus?: TimelineFocus,
    focusAnimation = 1,
) {
    const style = getComputedStyle(document.documentElement);
    const background = style.getPropertyValue("--surface-solid").trim() || "#ffffff";
    const text = style.getPropertyValue("--text").trim() || "#1d1d1f";
    const muted = style.getPropertyValue("--muted").trim() || "#6e6e73";
    const border = style.getPropertyValue("--border").trim() || "#d2d2d7";
    const accent = style.getPropertyValue("--accent").trim() || "#0071e3";
    const plotWidth = Math.max(1, size.width - LEFT_GUTTER);
    const visibleDuration = duration / zoom;
    const toX = (time: number) => LEFT_GUTTER + (time - offset) / visibleDuration * plotWidth;
    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = background;
    context.fillRect(0, 0, size.width, size.height);
    context.strokeStyle = border;
    context.lineWidth = 1;

    const roughStep = visibleDuration / Math.max(2, Math.floor(plotWidth / 110));
    const step = chooseTickStep(roughStep);
    const firstTick = Math.ceil(offset / step) * step;
    context.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
    context.fillStyle = muted;
    for (let time = firstTick; time <= offset + visibleDuration; time += step) {
        const x = toX(time);
        context.beginPath(); context.moveTo(x, RULER_HEIGHT - 8); context.lineTo(x, size.height); context.stroke();
        context.fillText(formatDuration(time), x + 5, 20);
    }
    context.beginPath(); context.moveTo(LEFT_GUTTER, 0); context.lineTo(LEFT_GUTTER, size.height); context.stroke();

    lanes.forEach((lane, laneIndex) => {
        const y = RULER_HEIGHT + laneIndex * LANE_HEIGHT;
        context.fillStyle = laneIndex % 2 ? "rgba(127,127,127,.035)" : "rgba(127,127,127,.07)";
        context.fillRect(0, y, size.width, LANE_HEIGHT);
        context.fillStyle = text;
        context.font = "600 12px -apple-system, BlinkMacSystemFont, sans-serif";
        context.fillText(trimCanvasText(context, lane.label, LEFT_GUTTER - 26), 14, y + 25);
        context.fillStyle = muted;
        context.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
        context.fillText(`${lane.events.length} events`, 14, y + 42);
        for (const event of lane.events) {
            const x = toX(event.time);
            if (x < LEFT_GUTTER - 8 || x > size.width + 8) continue;
            const active = (hovered?.lane.id === lane.id && hovered.event.id === event.id) || focus?.id === event.id;
            context.strokeStyle = active ? text : lane.color;
            context.lineWidth = active ? 3 : 2;
            context.beginPath(); context.moveTo(x, y + 9); context.lineTo(x, y + LANE_HEIGHT - 9); context.stroke();
            context.fillStyle = active ? text : lane.color;
            context.beginPath(); context.arc(x, y + 14, active ? 5 : 3.5, 0, Math.PI * 2); context.fill();
        }
        context.strokeStyle = border;
        context.lineWidth = 1;
        context.beginPath(); context.moveTo(0, y + LANE_HEIGHT); context.lineTo(size.width, y + LANE_HEIGHT); context.stroke();
    });

    if (focus) {
        const x = toX(focus.time);
        if (x >= LEFT_GUTTER - 12 && x <= size.width + 12) {
            const focusedLaneIndex = lanes.findIndex((lane) => lane.events.some((event) => event.id === focus.id));
            const baseY = focusedLaneIndex >= 0 ? RULER_HEIGHT + focusedLaneIndex * LANE_HEIGHT + 14 : RULER_HEIGHT + 10;
            const bounce = focusAnimation < 1
                ? Math.abs(Math.sin(focusAnimation * Math.PI * 3)) * (1 - focusAnimation) * 19
                : 0;
            const markerY = baseY - bounce;
            const haloRadius = focusAnimation < 1 ? 11 + Math.sin(focusAnimation * Math.PI) * 8 : 11;

            context.save();
            context.globalAlpha = 0.38;
            context.strokeStyle = accent;
            context.lineWidth = 1.5;
            context.setLineDash([5, 5]);
            context.beginPath(); context.moveTo(x, RULER_HEIGHT); context.lineTo(x, size.height); context.stroke();
            context.setLineDash([]);
            context.globalAlpha = focusAnimation < 1 ? 0.34 + (1 - focusAnimation) * 0.22 : 0.34;
            context.fillStyle = accent;
            context.beginPath(); context.arc(x, markerY, haloRadius, 0, Math.PI * 2); context.fill();
            context.globalAlpha = 1;
            context.shadowColor = accent;
            context.shadowBlur = 16;
            context.fillStyle = accent;
            context.beginPath(); context.arc(x, markerY, 7, 0, Math.PI * 2); context.fill();
            context.shadowBlur = 0;
            context.fillStyle = background;
            context.beginPath(); context.arc(x, markerY, 2.5, 0, Math.PI * 2); context.fill();
            context.restore();
        }
    }
}

function chooseTickStep(value: number): number {
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
    return steps.find((step) => step >= value) ?? Math.ceil(value / 1200) * 1200;
}

function trimCanvasText(context: CanvasRenderingContext2D, value: string, maxWidth: number): string {
    if (context.measureText(value).width <= maxWidth) return value;
    let result = value;
    while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
    return `${result}…`;
}
