import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineModal } from "../src/components/TimelineModal.js";
import { I18nProvider } from "../src/i18n.js";
import { analyzeReaperCsv } from "../src/lib/reaper2ma/analysis.js";

const analysis = analyzeReaperCsv("#,Name,Start,Color\n1,Intro,0,\n2,Drop,30,16711680");

afterEach(cleanup);

describe("timeline interactions", () => {
    it("supports view switching, zoom controls, wheel gestures, pointer pan and Escape", async () => {
        const onClose = vi.fn();
        const opener = document.createElement("button");
        document.body.append(opener);
        opener.focus();
        const { unmount } = render(<I18nProvider><TimelineModal analysis={analysis} onClose={onClose} /></I18nProvider>);

        const canvas = screen.getByRole("img");
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Close|Fermer/ })).toHaveFocus();
        fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
        expect(screen.getByText("150%")).toBeInTheDocument();
        const pinchWheel = new WheelEvent("wheel", { deltaY: -20, ctrlKey: true, cancelable: true });
        canvas.dispatchEvent(pinchWheel);
        expect(pinchWheel.defaultPrevented).toBe(true);
        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 300, clientY: 80 });
        fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 250, clientY: 80 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });
        fireEvent.click(screen.getByRole("tab", { name: /grandMA3/i }));
        expect(screen.getByText(/Aucun événement|No events/)).toBeInTheDocument();
        fireEvent.keyDown(window, { key: "Escape" });
        await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
        unmount();
        expect(opener).toHaveFocus();
        opener.remove();
    });

    it("handles a two-pointer pinch without losing the accessible canvas alternative", () => {
        render(<I18nProvider><TimelineModal analysis={analysis} onClose={() => undefined} /></I18nProvider>);
        const canvas = screen.getByRole("img");

        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 250, clientY: 80 });
        fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 350, clientY: 80 });
        fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 450, clientY: 80 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 2 });

        expect(canvas).toHaveAttribute("tabindex", "0");
    });

    it("mounts only the selected region and its output events", () => {
        const regionalAnalysis = analyzeReaperCsv("#,Name,Start,End,Length,Color\nR1,Intro,10,20,10,\nR2,Finale,30,40,10,\nM1,First hit,12,,,\nM2,Last hit,32,,,");
        const output = {
            enabled: true,
            duration: "41.500",
            durationSeconds: 41.5,
            ticks: [],
            eventCount: 3,
            tracks: [
                { id: "r1", trackIndex: 1, kind: "region" as const, kindLabel: "Region", sequenceNumber: 2, displayName: "MA R1 - Intro", color: "#00aaff", laneCount: 1, regionId: "R1", events: [{ id: "r1-e1", timestamp: "12", timeLabel: "00:12", positionPercent: 29, laneLevel: 0, label: "First hit", token: "Go+", isDerived: false }] },
                { id: "r2", trackIndex: 2, kind: "region" as const, kindLabel: "Region", sequenceNumber: 3, displayName: "MA R2 - Finale", color: "#ff00aa", laneCount: 1, regionId: "R2", events: [{ id: "r2-e1", timestamp: "32", timeLabel: "00:32", positionPercent: 77, laneLevel: 0, label: "Last hit", token: "Go+", isDerived: false }] },
                { id: "main", trackIndex: 3, kind: "main" as const, kindLabel: "Main", sequenceNumber: 1, displayName: "MA Main", color: "#00ff00", laneCount: 1, events: [{ id: "main-e1", timestamp: "15", timeLabel: "00:15", positionPercent: 36, laneLevel: 0, label: "Global in region", token: "Go+", isDerived: false }] },
            ],
        };

        render(<I18nProvider><TimelineModal analysis={regionalAnalysis} output={output} regionId="R1" timecodeOffsetMs={3_600_000} onClose={() => undefined} /></I18nProvider>);
        expect(screen.getByText(/Timecode offset/)).toHaveTextContent("+01:00:00.000");
        expect(screen.getAllByText(/Intro/).length).toBeGreaterThan(0);
        expect(screen.queryByText(/Finale/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("tab", { name: /grandMA3/i }));
        expect(screen.getByText("MA R1 - Intro")).toBeInTheDocument();
        expect(screen.getByText("MA Main")).toBeInTheDocument();
        expect(screen.queryByText("MA R2 - Finale")).not.toBeInTheDocument();
        const canvas = screen.getByRole("img");
        expect(canvas).toHaveAccessibleName(/Timecode offset.*\+01:00:00\.000/);
        const hoverEvent = createEvent.pointerMove(canvas, { pointerId: 99, clientX: 300, clientY: 60 });
        Object.defineProperties(hoverEvent, { offsetX: { value: 300 }, offsetY: { value: 60 } });
        fireEvent(canvas, hoverEvent);
        expect(screen.getByText(/Relative time/)).toHaveTextContent("00:00:12.000");
        expect(screen.getByText(/Effective incoming LTC/)).toHaveTextContent("01:00:12.000");
    });

    it("centers and announces a marker opened from the region browser", () => {
        const regionalAnalysis = analyzeReaperCsv("#,Name,Start,End,Length,Color\nR1,Long section,0,120,120,\nM1,Late hit,100,,,");

        render(<I18nProvider><TimelineModal analysis={regionalAnalysis} regionId="R1" focusMarkerId={regionalAnalysis.regions[0].markers[0].id} onClose={() => undefined} /></I18nProvider>);

        expect(screen.getByText(/Focused marker|Marqueur ciblé/)).toHaveTextContent("Late hit");
        expect(screen.getByText("667%")).toBeInTheDocument();
        expect(screen.getByRole("img")).toHaveAccessibleName(/Late hit.*01:40/);
    });
});
