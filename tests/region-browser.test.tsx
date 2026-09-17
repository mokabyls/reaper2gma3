import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegionBrowser } from "../src/components/RegionBrowser.js";
import { I18nProvider } from "../src/i18n.js";
import { analyzeReaperCsv } from "../src/lib/reaper2ma/analysis.js";

const analysis = analyzeReaperCsv(`#,Name,Start,End,Length,Color
R1,Verse,0,10,10,
R2,Chorus,10,20,10,
M1,Hit,5,,,
M2,Drop,15,,,
`);

afterEach(cleanup);

describe("region browser timeline shortcuts", () => {
    it("opens the matching region from a double-click on its card or marker row", async () => {
        const user = userEvent.setup();
        const onOpenTimeline = vi.fn();
        render(
            <I18nProvider>
                <RegionBrowser analysis={analysis} onOpenTimeline={onOpenTimeline} />
            </I18nProvider>,
        );

        await user.dblClick(screen.getAllByRole("button", { name: /Chorus/ })[0]);
        expect(onOpenTimeline).toHaveBeenLastCalledWith("R2");

        const dropRow = screen.getAllByRole("listitem").find((row) => row.textContent?.includes("Drop"));
        expect(dropRow).toBeDefined();
        await user.dblClick(dropRow!);
        expect(onOpenTimeline).toHaveBeenLastCalledWith("R2", analysis.regions[1].markers[0].id);
        expect(onOpenTimeline).toHaveBeenCalledTimes(2);
    });
});
