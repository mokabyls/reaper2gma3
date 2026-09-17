import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HashRouter } from "react-router-dom";
import { App } from "../src/App.js";
import { I18nProvider } from "../src/i18n.js";
import { IndexedDbProjectRepository, createProjectDocument, type ProjectDocumentV1 } from "../src/lib/projects/index.js";

async function clearProjects() {
    const repository = new IndexedDbProjectRepository();
    for (const project of await repository.listProjects()) await repository.deleteProject(project.id);
}

function renderRoutedApp() {
    return render(<HashRouter><I18nProvider><App /></I18nProvider></HashRouter>);
}

async function createStoredProject(status: ProjectDocumentV1["status"] = "draft") {
    const repository = new IndexedDbProjectRepository();
    const project = createProjectDocument("Routed Show");
    await repository.saveProject(project);
    const attached = await repository.attachSource(project, "show.csv", "#,Name,Start,Color\n1,Intro,0,");
    const stored: ProjectDocumentV1 = { ...attached.project, status, currentStage: status === "configured" ? "review" : "output" };
    await repository.saveProject(stored);
    return stored;
}

describe("persistent project routing", () => {
    beforeEach(async () => {
        cleanup();
        await clearProjects();
        localStorage.setItem("reaper2ma:ui:v1", JSON.stringify({ locale: "en", theme: "system" }));
        window.history.replaceState(null, "", "/#/");
    });

    afterEach(() => {
        cleanup();
        window.history.replaceState(null, "", "/#/");
    });

    it("reopens a configured project directly after an application remount", async () => {
        const user = userEvent.setup();
        const project = await createStoredProject("configured");

        const firstMount = renderRoutedApp();
        await user.click(await screen.findByText("Routed Show"));
        expect(await screen.findByRole("heading", { name: "Routed Show", level: 1 })).toBeInTheDocument();
        expect(window.location.hash).toBe(`#/projects/${project.id}`);

        firstMount.unmount();
        renderRoutedApp();
        expect(await screen.findByRole("heading", { name: "Routed Show", level: 1 })).toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "Projects" })).not.toBeInTheDocument();
    });

    it("restores the exact wizard stage encoded in the URL", async () => {
        const project = await createStoredProject("draft");
        window.history.replaceState(null, "", `/#/projects/${project.id}/setup/executors`);

        renderRoutedApp();
        expect(await screen.findByRole("heading", { name: "Assign sequences to executors?" })).toBeInTheDocument();
        expect(window.location.hash).toBe(`#/projects/${project.id}/setup/executors`);
    });

    it("opens the tag guide from the first screen before any project exists", async () => {
        const user = userEvent.setup();

        renderRoutedApp();
        expect(await screen.findByRole("heading", { name: "What is this project called?" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /REAPER and tag guide/ }));

        expect(await screen.findByRole("heading", { name: "REAPER, CSV, and tag guide" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Export REAPER markers in seconds" })).toBeInTheDocument();
        expect(screen.getByText("M1,Intro,12.500,,," )).toBeInTheDocument();
        expect(screen.getByText("[TempRelease] [FlashRelease]")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "What are pre-rolls for?" })).toBeInTheDocument();
        expect(window.location.hash).toBe("#/help");
    });

    it("keeps help available inside a project and returns to the same route", async () => {
        const user = userEvent.setup();
        const project = await createStoredProject("configured");
        window.history.replaceState(null, "", `/#/projects/${project.id}`);

        renderRoutedApp();
        expect(await screen.findByRole("heading", { name: "Routed Show" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Help" }));
        expect(await screen.findByRole("heading", { name: "REAPER, CSV, and tag guide" })).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /Return to the application/ }));
        expect(await screen.findByRole("heading", { name: "Routed Show" })).toBeInTheDocument();
        expect(window.location.hash).toBe(`#/projects/${project.id}`);
    });

    it("links the CSV upload step directly to the REAPER export tutorial", async () => {
        const user = userEvent.setup();
        const project = await createStoredProject("draft");
        window.history.replaceState(null, "", `/#/projects/${project.id}/setup/source`);

        renderRoutedApp();
        expect(await screen.findByRole("heading", { name: "Add the REAPER export" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /How do I export a CSV in seconds from REAPER\?/ }));

        expect(await screen.findByRole("heading", { name: "Export REAPER markers in seconds" })).toHaveFocus();
        expect(screen.getByText(/Renumber in timeline order is enough/)).toBeInTheDocument();
        expect(window.location.hash).toBe("#/help");

        await user.click(screen.getByRole("button", { name: /Return to the application/ }));
        expect(await screen.findByRole("heading", { name: "Add the REAPER export" })).toBeInTheDocument();
        expect(window.location.hash).toBe(`#/projects/${project.id}/setup/source`);
    });
});
