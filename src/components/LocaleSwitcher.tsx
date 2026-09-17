import { useEffect, useId, useRef, useState } from "react";
import { useI18n, type Locale } from "../i18n.js";

/** Endonyms: a language is always offered in its own spelling, never translated. */
const locales: Array<{ code: Locale; label: string }> = [
    { code: "fr", label: "Français" },
    { code: "en", label: "English" },
];

export function LocaleSwitcher() {
    const { locale, setLocale, t } = useI18n();
    const menuId = useId();
    const rootRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);

    const current = locales.find((entry) => entry.code === locale) ?? locales[0];

    const close = (refocus = true) => {
        setOpen(false);
        if (refocus) buttonRef.current?.focus();
    };

    const openMenu = () => {
        setActiveIndex(Math.max(0, locales.findIndex((entry) => entry.code === locale)));
        setOpen(true);
    };

    const choose = (code: Locale) => {
        setLocale(code);
        close();
    };

    useEffect(() => {
        if (!open) return;

        const closeOutside = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("pointerdown", closeOutside);
        return () => document.removeEventListener("pointerdown", closeOutside);
    }, [open]);

    // Focus follows the active item so screen readers announce the language being considered.
    useEffect(() => {
        if (open) itemRefs.current[activeIndex]?.focus();
    }, [open, activeIndex]);

    const onMenuKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === "Escape") { event.preventDefault(); close(); return; }
        if (event.key === "Tab") { close(false); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActiveIndex((index) => (index + step + locales.length) % locales.length);
            return;
        }
        if (event.key === "Home") { event.preventDefault(); setActiveIndex(0); return; }
        if (event.key === "End") { event.preventDefault(); setActiveIndex(locales.length - 1); }
    };

    return (
        <div className="locale-switcher" ref={rootRef}>
            <button
                ref={buttonRef}
                className={`header-control locale-control${open ? " is-open" : ""}`}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                aria-label={`${t("app.locale")} — ${current.label}`}
                onClick={() => (open ? close(false) : openMenu())}
                onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openMenu(); }
                }}
            >
                <span aria-hidden="true">{current.code.toUpperCase()}</span>
                <i aria-hidden="true" className="locale-caret" />
            </button>

            {open ? (
                <div className="locale-menu" id={menuId} role="menu" aria-label={t("app.locale")} onKeyDown={onMenuKeyDown}>
                    {locales.map((entry, index) => (
                        <button
                            key={entry.code}
                            ref={(node) => { itemRefs.current[index] = node; }}
                            className="locale-option"
                            type="button"
                            role="menuitemradio"
                            aria-checked={entry.code === locale}
                            tabIndex={index === activeIndex ? 0 : -1}
                            lang={entry.code}
                            onClick={() => choose(entry.code)}
                            onFocus={() => setActiveIndex(index)}
                        >
                            <span className="locale-option-code">{entry.code.toUpperCase()}</span>
                            <span>{entry.label}</span>
                            <span className="locale-option-mark" aria-hidden="true">{entry.code === locale ? "●" : ""}</span>
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
