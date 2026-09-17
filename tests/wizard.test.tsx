import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectWizard } from "../src/components/ProjectWizard.js";
import { I18nProvider } from "../src/i18n.js";
import { analyzeReaperCsv } from "../src/lib/reaper2ma/analysis.js";
import { createProjectDocument, type ProjectDocumentV1, type ProjectSourceV1, type ProjectStage } from "../src/lib/projects/index.js";

const flatCsv = "#,Name,Start,Color\n1,Intro,0,\n2,Drop,30,16711680";
const regionCsv = "#,Name,Start,End,Length,Color\nR1,Intro,0,20,20,\nM1,Hit,5,,,";
const executorRegionCsv = "#,Name,Start,End,Length,Color\nR1,Verse,0,10,10,\nR2,Chorus,10,20,10,\nM1,Hit,5,,,\nM2,Drop,15,,,";

afterEach(cleanup);

function sourceFor(csvText: string): ProjectSourceV1 {
    return { schemaVersion: 1, id: "source", projectId: "project", fileName: "show.csv", csvText, importedAt: new Date().toISOString(), sha256: "abc", byteSize: csvText.length };
}

function projectAt(stage: ProjectStage, settings?: Partial<ProjectDocumentV1["settings"]>): ProjectDocumentV1 {
    return {
        ...createProjectDocument("Show"),
        id: "project",
        currentStage: stage,
        completedStages: ["identity", "source", "analysis"],
        settings: { ...createProjectDocument("Show").settings, ...settings },
    };
}

function WizardHarness({ initial, csvText = flatCsv, onDownload = vi.fn(), onConfigured = vi.fn() }: { initial: ProjectDocumentV1; csvText?: string; onDownload?: () => Promise<void>; onConfigured?: () => Promise<void> }) {
    const [project, setProject] = useState(initial);
    const source = sourceFor(csvText);
    return (
        <I18nProvider>
            <ProjectWizard
                project={project}
                source={source}
                analysis={analyzeReaperCsv(csvText)}
                onSave={async (next) => setProject(next)}
                onAttachSource={async () => undefined}
                onExit={() => undefined}
                onHelp={() => undefined}
                onDownload={onDownload}
                onConfigured={onConfigured}
            />
        </I18nProvider>
    );
}

describe("guided wizard branches", () => {
    beforeEach(() => {
        localStorage.setItem("reaper2ma:ui:v1", JSON.stringify({ locale: "en", theme: "system" }));
    });

    it("uses markers-only automatically when no region exists and offers a choice for real regions", () => {
        const { rerender } = render(<WizardHarness initial={projectAt("analysis")} />);
        expect(screen.getByText(/No REAPER region detected/i)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Yes, per region/i })).not.toBeInTheDocument();

        rerender(<WizardHarness initial={projectAt("analysis", { importMode: "regions-and-markers" })} csvText={regionCsv} />);
        expect(screen.getByRole("button", { name: /Yes, per region/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /No, classic mode/i })).toBeInTheDocument();
    });

    it("opens a marker-centered timeline from the analyzed region browser", async () => {
        const user = userEvent.setup();
        render(<WizardHarness initial={projectAt("analysis")} csvText={executorRegionCsv} />);

        await user.click(screen.getAllByRole("button", { name: /Chorus/ })[0]);
        const dropRow = screen.getAllByRole("listitem").find((row) => row.textContent?.includes("Drop"));
        expect(dropRow).toBeDefined();
        await user.dblClick(dropRow!);

        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(screen.getByText(/Focused marker/)).toHaveTextContent("Drop");
    });

    it("shows the Timecode object only when needed and keeps the incoming slot visible", async () => {
        const user = userEvent.setup();
        render(<WizardHarness initial={projectAt("output", { exportMode: "cues-and-timecode" })} />);
        expect(screen.getByText("Timecode object number")).toBeInTheDocument();
        expect(screen.getByText("Incoming timecode offset")).toBeInTheDocument();
        expect(screen.getByText("Incoming timecode slot (TCSlot)")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /Cues only/i }));
        expect(screen.queryByText("Timecode object number")).not.toBeInTheDocument();
        expect(screen.queryByText("Incoming timecode offset")).not.toBeInTheDocument();
        expect(screen.getByText("Incoming timecode slot (TCSlot)")).toBeInTheDocument();
    });

    it("autosaves a valid offset and blocks an incomplete value", async () => {
        const user = userEvent.setup();
        render(<WizardHarness initial={projectAt("output", { exportMode: "cues-and-timecode" })} />);
        const input = screen.getByLabelText("Incoming timecode offset");
        const doneButton = screen.getByRole("button", { name: /Back to summary/ });

        await user.clear(input);
        await user.type(input, "+01:00:00.000");
        expect(doneButton).toBeEnabled();
        expect(screen.getByText(/will trigger when incoming LTC reaches/)).toHaveTextContent("01:01:00.000");

        await user.click(doneButton);
        await user.click(await screen.findByRole("button", { name: "Edit · Output and timecode" }));
        expect(await screen.findByLabelText("Incoming timecode offset")).toHaveValue("+01:00:00.000");

        await user.clear(screen.getByLabelText("Incoming timecode offset"));
        await user.type(screen.getByLabelText("Incoming timecode offset"), "01:60");
        expect(screen.getByRole("alert")).toHaveTextContent("HH:MM:SS");
        expect(screen.getByRole("button", { name: /Back to summary/ })).toBeDisabled();
    });

    it("warns without blocking when a negative offset places events before zero", async () => {
        const user = userEvent.setup();
        render(<WizardHarness initial={projectAt("output", { exportMode: "cues-and-timecode" })} />);
        const input = screen.getByLabelText("Incoming timecode offset");
        await user.clear(input);
        await user.type(input, "-00:00:00.500");

        expect(screen.getByText(/places at least one event before zero/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Back to summary/ })).toBeEnabled();
    });

    it("translates the offset field, validation and explanation into French", async () => {
        localStorage.setItem("reaper2ma:ui:v1", JSON.stringify({ locale: "fr", theme: "system" }));
        const user = userEvent.setup();
        render(<WizardHarness initial={projectAt("output", { exportMode: "cues-and-timecode", timecodeOffsetMs: 3_600_000 })} />);

        const input = screen.getByLabelText("Offset du timecode entrant");
        expect(screen.getByText(/sera déclenché lorsque le LTC entrant atteindra/)).toHaveTextContent("01:01:00.000");
        await user.clear(input);
        await user.type(input, "incorrect");
        expect(screen.getByRole("alert")).toHaveTextContent("Saisissez HH:MM:SS");
    });

    it("reveals executor addresses and extra macro settings only when selected", async () => {
        const user = userEvent.setup();
        const { rerender } = render(<WizardHarness initial={projectAt("executors", { assignExecutors: false })} />);
        expect(screen.queryByText("First main slot")).not.toBeInTheDocument();
        await user.click(screen.getByText("Use executors"));
        expect(screen.getByText("First main slot")).toBeInTheDocument();
        expect(screen.getByText(/Page 1\.201/)).toBeInTheDocument();

        rerender(<WizardHarness key="extras" initial={projectAt("extras")} />);
        expect(screen.queryByText("grandMA3 version")).not.toBeInTheDocument();
        await user.click(screen.getByText("Show Time"));
        expect(screen.getByText("grandMA3 version")).toBeInTheDocument();
        expect(screen.getByText("TCSlot -1")).toBeInTheDocument();
        expect(screen.getByText("TCSlot 1")).toBeInTheDocument();
        await user.click(screen.getByText("REAPER transport"));
        expect(screen.getByText("OSC Slot ID")).toBeInTheDocument();
        expect(screen.getByText("Transport filename")).toBeInTheDocument();
    });

    it("maps every generated sequence and can place one region on each page", () => {
        render(<WizardHarness initial={projectAt("executors", { assignExecutors: true, importMode: "regions-and-markers", executorLayout: "region-per-page" })} csvText={executorRegionCsv} />);

        expect(screen.getByRole("checkbox", { name: "One region per page" })).toBeChecked();
        expect(screen.getByText("MA R1 - Verse").parentElement).toHaveTextContent("Sequence 9002");
        expect(screen.getByText("MA R1 - Verse").parentElement).toHaveTextContent("Page 1.201");
        expect(screen.getByText("MA R2 - Chorus").parentElement).toHaveTextContent("Sequence 9003");
        expect(screen.getByText("MA R2 - Chorus").parentElement).toHaveTextContent("Page 2.201");
    });

    it("downloads and configures the project from the final review", async () => {
        const user = userEvent.setup();
        const onDownload = vi.fn(async () => undefined);
        const onConfigured = vi.fn(async () => undefined);
        render(<WizardHarness initial={projectAt("review")} onDownload={onDownload} onConfigured={onConfigured} />);

        await user.click(screen.getByRole("button", { name: /Download ZIP/i }));
        expect(onDownload).toHaveBeenCalledOnce();
        expect(onConfigured).toHaveBeenCalledOnce();
    });

    it("uses a simple name by default and reveals an optional repeat/bump identifier", async () => {
        const user = userEvent.setup();
        render(<WizardHarness initial={projectAt("sequences")} />);
        const toggle = screen.getByRole("checkbox", { name: "Add an identifier to repeats and bumps" });

        expect(toggle).not.toBeChecked();
        expect(screen.getAllByText("MA Drop").length).toBeGreaterThan(0);
        expect(screen.queryByLabelText("Custom identifier")).not.toBeInTheDocument();

        await user.click(toggle);
        expect(screen.getByLabelText("Custom identifier")).toHaveValue("FX");
        expect(screen.getAllByText("MA FX - Drop").length).toBeGreaterThan(0);
    });

    it("preserves the historical literal identifier on existing projects", () => {
        render(<WizardHarness initial={projectAt("sequences", { prefix: "1" })} />);

        expect(screen.getByRole("checkbox", { name: "Add an identifier to repeats and bumps" })).toBeChecked();
        expect(screen.getByLabelText("Custom identifier")).toHaveValue("1");
        expect(screen.getAllByText("MA 1 - Drop").length).toBeGreaterThan(0);
    });

    it("shows clear cue guidance in accessible help tooltips", async () => {
        const user = userEvent.setup();
        localStorage.setItem("reaper2ma:ui:v1", JSON.stringify({ locale: "fr", theme: "system" }));
        render(<WizardHarness initial={projectAt("cues", { importMode: "regions-and-markers" })} csvText={regionCsv} />);

        expect(screen.getByRole("heading", { name: "Numérotation et fins de région" })).toBeInTheDocument();
        expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Aide : Anticipation de la fin de région" }));
        expect(screen.getByRole("tooltip")).toHaveTextContent("30.000 s");
        expect(screen.getByRole("tooltip")).toHaveTextContent("29.250 s");
    });

    it("shows sequence count, seconds, H:i:s and lets the timecode name be edited on review", async () => {
        const user = userEvent.setup();
        render(<WizardHarness initial={projectAt("review")} />);

        const sequenceLabel = screen.getAllByText("Generated sequences").at(-1);
        expect(sequenceLabel?.parentElement).toHaveTextContent("2Generated sequences");
        expect(screen.getByText("31 s")).toBeInTheDocument();
        expect(screen.getByText("00:00:31")).toBeInTheDocument();

        const input = screen.getByLabelText("Timecode name");
        await user.clear(input);
        await user.type(input, "Show V2");
        await user.tab();
        expect(screen.getByLabelText("Timecode name")).toHaveValue("Show V2");
    });

    it("shows every effective timecode, executor and extra setting in the final summary", () => {
        render(<WizardHarness initial={projectAt("review", {
            importMode: "regions-and-markers",
            prefix: "FX",
            externalTimecodeSlot: 7,
            timecodeOffsetMs: 3_600_000,
            assignExecutors: true,
            executorLayout: "region-per-page",
            pageNumber: 4,
            pageSlotStart: 211,
            bumpPageSlotStart: 111,
            exportShowTimeMacros: true,
            exportTimecodeControlMacros: true,
            includeReaperTransportMacros: true,
            grandmaVersion: "pre-2.4",
            transportOscSlotId: 3,
            transportOscDataName: "REAPER SHOW",
        })} csvText={regionCsv} />);

        expect(screen.getByText("Incoming timecode slot (TCSlot)").parentElement).toHaveTextContent("TCSlot 7");
        expect(screen.getByText("Add an identifier to repeats and bumps").parentElement).toHaveTextContent("Yes · FX");
        expect(screen.getByText("Incoming timecode offset").parentElement).toHaveTextContent("+01:00:00.000");
        expect(screen.getByText("Use executors").parentElement).toHaveTextContent("Yes");
        expect(screen.getByText("Page layout").parentElement).toHaveTextContent("One region per page");
        expect(screen.getByText("Starting page").parentElement).toHaveTextContent("Page 4");
        expect(screen.getByText("First main slot").parentElement).toHaveTextContent("211");
        expect(screen.getByText("First bump slot").parentElement).toHaveTextContent("111");
        expect(screen.getByText("Resolved internal slot").parentElement).toHaveTextContent("TCSlot -2");
        expect(screen.getByText("OSC Slot ID").parentElement).toHaveTextContent("3");
        expect(screen.getByText("OSC name").parentElement).toHaveTextContent("REAPER SHOW");
    });

    it("marks disabled executors and a missing Timecode object explicitly", () => {
        render(<WizardHarness initial={projectAt("review", { assignExecutors: false, exportMode: "cues-only" })} />);

        expect(screen.getByText("Use executors").parentElement).toHaveTextContent("No");
        expect(screen.getByText("Timecode object number").parentElement).toHaveTextContent("Not created");
    });

    it("explains why an empty main sequence does not block the export", () => {
        const coloredOnlyCsv = "#,Name,Start,Color\n1,Drop,30,16711680";
        render(<WizardHarness initial={projectAt("review")} csvText={coloredOnlyCsv} />);

        expect(screen.getByText(/No main sequence will be created because no standard uncolored marker/i)).toHaveTextContent("This does not block the export");
        expect(screen.getByText(/No main sequence will be created/i)).toHaveTextContent("[GLOBAL] or [MAIN]");
    });
});

describe("optional settings stages", () => {
    beforeEach(() => {
        localStorage.setItem("reaper2ma:ui:v1", JSON.stringify({ locale: "en", theme: "system" }));
    });

    it("goes straight from the analysis to the review without walking the settings stages", async () => {
        const user = userEvent.setup();
        render(<WizardHarness initial={projectAt("analysis")} csvText={regionCsv} />);

        await user.click(screen.getByRole("button", { name: /Continue/ }));

        expect(await screen.findByRole("heading", { name: "Everything is ready" })).toBeInTheDocument();
    });

    it("only imposes the three main stages in the progress nav", () => {
        render(<WizardHarness initial={projectAt("analysis")} csvText={regionCsv} />);
        const nav = screen.getByRole("navigation", { name: "Project setup progress" });

        expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual(["1File", "2Analysis", "3Review"]);
    });

    it("returns to the review from a settings stage opened with its Edit link", async () => {
        const user = userEvent.setup();
        render(<WizardHarness initial={projectAt("review")} csvText={regionCsv} />);

        await user.click(screen.getByRole("button", { name: "Edit · Sequences" }));
        expect(await screen.findByRole("heading", { name: "Where should sequences be created?" })).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /Back to summary/ }));
        expect(await screen.findByRole("heading", { name: "Everything is ready" })).toBeInTheDocument();
    });

    it("keeps a settings stage reachable by deep link and still returns it to the review", async () => {
        const user = userEvent.setup();
        render(<WizardHarness initial={projectAt("extras")} csvText={regionCsv} />);

        await user.click(screen.getByRole("button", { name: /Back to summary/ }));

        expect(await screen.findByRole("heading", { name: "Everything is ready" })).toBeInTheDocument();
    });
});

describe("manual executor addresses", () => {
    beforeEach(() => {
        localStorage.setItem("reaper2ma:ui:v1", JSON.stringify({ locale: "en", theme: "system" }));
    });

    it("keeps the assignment list read-only until manual addresses are turned on", () => {
        render(<WizardHarness initial={projectAt("executors")} />);

        expect(screen.getByText("Page 1.201")).toBeInTheDocument();
        expect(screen.queryByRole("textbox", { name: /Executor address/ })).not.toBeInTheDocument();
    });

    it("pins a sequence to a typed address and frees it again", async () => {
        const user = userEvent.setup();
        render(<WizardHarness initial={projectAt("executors")} />);

        await user.click(screen.getByLabelText("Manual addresses"));
        const [field] = await screen.findAllByRole("textbox", { name: /Executor address/ });

        await user.type(field, "2.250");
        await user.tab();

        expect(await screen.findByText("Page 2")).toBeInTheDocument();
        const [pinned] = screen.getAllByRole("textbox", { name: /Executor address/ });
        expect(pinned).toHaveValue("2.250");

        await user.click(screen.getAllByRole("button", { name: "Auto" })[0]);
        expect(screen.getAllByRole("textbox", { name: /Executor address/ })[0]).toHaveValue("");
    });

    it("refuses an address that is not written page.slot", async () => {
        const user = userEvent.setup();
        render(<WizardHarness initial={projectAt("executors")} />);

        await user.click(screen.getByLabelText("Manual addresses"));
        const [field] = await screen.findAllByRole("textbox", { name: /Executor address/ });

        await user.type(field, "250");
        await user.tab();

        expect(field).toHaveAttribute("aria-invalid", "true");
    });

    it("opens in manual mode when the project already carries pinned addresses", () => {
        render(<WizardHarness initial={projectAt("executors", { executorOverrides: { "9001": { pageNumber: 4, slotNumber: 210 } } })} />);

        expect(screen.getAllByRole("textbox", { name: /Executor address/ })[0]).toHaveValue("4.210");
    });
});

describe("manual sequence numbers", () => {
    beforeEach(() => {
        localStorage.setItem("reaper2ma:ui:v1", JSON.stringify({ locale: "en", theme: "system" }));
    });

    it("keeps the numbering hidden until manual numbers are turned on", () => {
        render(<WizardHarness initial={projectAt("sequences")} />);

        expect(screen.queryByRole("textbox", { name: /Sequence number/ })).not.toBeInTheDocument();
    });

    it("pins a sequence to another DataPool number without moving the others", async () => {
        const user = userEvent.setup();
        render(<WizardHarness initial={projectAt("sequences")} />);

        await user.click(screen.getByLabelText("Manual sequence numbers"));
        const fields = await screen.findAllByRole("textbox", { name: /Sequence number/ });

        expect(fields[0]).toHaveAttribute("placeholder", "9001");
        expect(fields[1]).toHaveAttribute("placeholder", "9002");

        await user.type(fields[1], "9050");
        await user.tab();

        const updated = screen.getAllByRole("textbox", { name: /Sequence number/ });
        expect(updated[0]).toHaveAttribute("placeholder", "9001");
        expect(updated[1]).toHaveValue("9050");
    });

    it("treats retyping the automatic number as no override", async () => {
        const user = userEvent.setup();
        render(<WizardHarness initial={projectAt("sequences")} />);

        await user.click(screen.getByLabelText("Manual sequence numbers"));
        const [field] = await screen.findAllByRole("textbox", { name: /Sequence number/ });

        await user.type(field, "9001");
        await user.tab();

        expect(field).toHaveValue("");
    });

    it("refuses a number outside the grandMA3 range", async () => {
        const user = userEvent.setup();
        render(<WizardHarness initial={projectAt("sequences")} />);

        await user.click(screen.getByLabelText("Manual sequence numbers"));
        const [field] = await screen.findAllByRole("textbox", { name: /Sequence number/ });

        await user.type(field, "10000");
        await user.tab();

        expect(field).toHaveAttribute("aria-invalid", "true");
    });

    it("names a number claimed by two sequences", async () => {
        render(<WizardHarness initial={projectAt("sequences", { sequenceNumberOverrides: { "9002": 9001 } })} />);

        expect(await screen.findByRole("alert")).toHaveTextContent("9001");
    });
});
