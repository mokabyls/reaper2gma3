import { useState, type FormEvent } from "react";
import { useI18n } from "../i18n.js";

export function CreateProject({ canGoBack, inheritedFrom, onCreate, onBack, onImport, onHelp }: { canGoBack: boolean; inheritedFrom?: string; onCreate: (name: string) => void; onBack: () => void; onImport: () => void; onHelp: () => void }) {
    const { t } = useI18n();
    const [name, setName] = useState("");
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (name.trim()) onCreate(name.trim());
    };
    return (
        <main className="page centered-page">
            <section className="panel identity-panel">
                <span className="eyebrow">01 · Identity</span>
                <h1>{t("project.create.title")}</h1>
                <p>{t("project.create.copy")}</p>
                <form onSubmit={submit} className="identity-form">
                    <label className="field large-field">
                        <span>{t("project.name")}</span>
                        <input autoFocus maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("project.namePlaceholder")} />
                    </label>
                    <button className="button primary large" type="submit" disabled={!name.trim()}>{t("action.continue")} →</button>
                </form>
                {inheritedFrom ? (
                    <p className="inherited-settings-note">
                        {t("project.create.inherited")} <strong>{inheritedFrom}</strong>
                    </p>
                ) : null}
                <div className="secondary-actions">
                    {canGoBack ? <button className="text-button" type="button" onClick={onBack}>{t("action.back")}</button> : null}
                    <button className="text-button" type="button" onClick={onImport}>{t("action.import")}</button>
                    <button className="text-button" type="button" onClick={onHelp}>? {t("help.firstView")}</button>
                </div>
            </section>
        </main>
    );
}
