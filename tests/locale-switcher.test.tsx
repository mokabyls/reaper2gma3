import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocaleSwitcher } from "../src/components/LocaleSwitcher.js";
import { I18nProvider } from "../src/i18n.js";

afterEach(cleanup);

function renderSwitcher() {
    return render(
        <I18nProvider>
            <LocaleSwitcher />
        </I18nProvider>,
    );
}

describe("locale switcher", () => {
    beforeEach(() => {
        localStorage.setItem("reaper2ma:ui:v1", JSON.stringify({ locale: "en", theme: "system" }));
    });

    it("shows the active locale and keeps the menu closed until asked", () => {
        renderSwitcher();
        const trigger = screen.getByRole("button", { expanded: false });

        expect(trigger).toHaveTextContent("EN");
        expect(trigger).toHaveAttribute("aria-haspopup", "menu");
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("offers every language in its own spelling, marking the active one", async () => {
        const user = userEvent.setup();
        renderSwitcher();

        await user.click(screen.getByRole("button", { expanded: false }));
        const menu = await screen.findByRole("menu");
        const options = within(menu).getAllByRole("menuitemradio");

        expect(options.map((option) => option.textContent)).toEqual(["FRFrançais", "ENEnglish●"]);
        expect(options[0]).toHaveAttribute("lang", "fr");
        expect(options[1]).toHaveAttribute("aria-checked", "true");
        expect(options[0]).toHaveAttribute("aria-checked", "false");
    });

    it("switches the language when an option is chosen", async () => {
        const user = userEvent.setup();
        renderSwitcher();

        await user.click(screen.getByRole("button", { expanded: false }));
        await user.click(await screen.findByRole("menuitemradio", { name: /Français/ }));

        expect(screen.getByRole("button", { expanded: false })).toHaveTextContent("FR");
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("opens with the arrow keys and moves through the options", async () => {
        const user = userEvent.setup();
        renderSwitcher();

        screen.getByRole("button", { expanded: false }).focus();
        await user.keyboard("{ArrowDown}");

        const menu = await screen.findByRole("menu");
        const options = within(menu).getAllByRole("menuitemradio");
        // Opening lands on the active language, English, so it is the one announced first.
        expect(options[1]).toHaveFocus();

        await user.keyboard("{ArrowDown}");
        expect(options[0]).toHaveFocus();
    });

    it("closes on Escape and returns focus to the trigger", async () => {
        const user = userEvent.setup();
        renderSwitcher();
        const trigger = screen.getByRole("button", { expanded: false });

        await user.click(trigger);
        await screen.findByRole("menu");
        await user.keyboard("{Escape}");

        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { expanded: false })).toHaveFocus();
    });

    it("closes when the pointer goes elsewhere", async () => {
        const user = userEvent.setup();
        render(
            <I18nProvider>
                <LocaleSwitcher />
                <button type="button">ailleurs</button>
            </I18nProvider>,
        );

        await user.click(screen.getByRole("button", { expanded: false }));
        await screen.findByRole("menu");
        await user.click(screen.getByRole("button", { name: "ailleurs" }));

        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
});
