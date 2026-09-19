import regionsCsv from "../../demo/regions-markers-demo.csv?url&no-inline";
import complexCsv from "../../demo/complex-markers.csv?url&no-inline";
import simpleProject from "../../demo/demo.RPP?url&no-inline";
import regionsProject from "../../demo/regions-markers-demo.RPP?url&no-inline";
import visualizer from "../../reaper/Reaper2MA_Beat_Visualizer.lua?url&no-inline";
import type { Locale } from "../i18n.js";

export const downloadsTitle = {
    fr: "Démos et plugin REAPER",
    en: "Demos and REAPER plugin",
};

const copy = {
    fr: {
        intro: "Télécharge un CSV pour essayer l’interface, puis ouvre un projet REAPER pour comprendre comment placer et nommer les markers.",
        csvTitle: "1 · Tester avec un CSV",
        csvCopy: "Commence par la démo avec régions et markers. Dans l’application, crée un projet, puis importe le CSV téléchargé à l’étape Source. Le CSV complexe permet ensuite d’explorer un exemple plus riche.",
        csv: "Télécharger le CSV de démo",
        complex: "Télécharger le CSV complexe",
        projectTitle: "2 · Explorer dans REAPER",
        projectCopy: "Ouvre le fichier .RPP dans REAPER pour examiner les positions, noms, tags et couleurs. Le projet avec régions accompagne le CSV de démo ; le projet simple est un autre exemple pour découvrir les markers.",
        simple: "Télécharger le projet simple (.RPP)",
        regions: "Télécharger le projet avec régions (.RPP)",
        pluginTitle: "3 · Visualiser les markers",
        pluginCopy: "Le plugin Reaper2MA Beat Visualizer est un script Lua qui affiche les markers sur huit pads animés pendant la lecture. Il utilise la couleur du marker, ou celle de la région qui le contient. Il fonctionne avec les API natives de REAPER, sans SWS ni ReaPack, et reste facultatif pour convertir un CSV.",
        plugin: "Télécharger Beat Visualizer (.lua)",
        steps: [
            "Enregistre le fichier .lua dans un dossier où tu souhaites le conserver.",
            "Dans REAPER, ouvre Actions → Show action list…, puis New action… → Load ReaScript… (ou ReaScript → Load… selon la version) et sélectionne le fichier .lua.",
            "Sélectionne Reaper2MA: Beat Visualizer dans la liste des actions et clique sur Run. Lance la lecture d’un projet contenant des markers pour voir les pads s’animer.",
        ],
    },
    en: {
        intro: "Download a CSV to try the interface, then open a REAPER project to see how markers are placed and named.",
        csvTitle: "1 · Try a CSV",
        csvCopy: "Start with the regions and markers demo. Create a project in the app, then import the downloaded CSV at the Source step. Use the complex CSV next to explore a larger example.",
        csv: "Download demo CSV",
        complex: "Download complex CSV",
        projectTitle: "2 · Explore in REAPER",
        projectCopy: "Open the .RPP file in REAPER to inspect positions, names, tags and colors. The regions project accompanies the demo CSV; the simple project is a separate example for discovering markers.",
        simple: "Download simple project (.RPP)",
        regions: "Download regions project (.RPP)",
        pluginTitle: "3 · Visualize markers",
        pluginCopy: "The Reaper2MA Beat Visualizer plugin is a Lua script that displays markers on eight animated pads during playback. It uses the marker color, falling back to the containing region’s color. It uses REAPER’s built-in APIs, requires neither SWS nor ReaPack, and is optional for CSV conversion.",
        plugin: "Download Beat Visualizer (.lua)",
        steps: [
            "Save the .lua file in a folder where you want to keep it.",
            "In REAPER, open Actions → Show action list…, then New action… → Load ReaScript… (or ReaScript → Load… depending on your version) and select the .lua file.",
            "Select Reaper2MA: Beat Visualizer in the action list and click Run. Play a project containing markers to see the pads animate.",
        ],
    },
};

export function HelpDownloads({ locale }: { locale: Locale }) {
    const content = copy[locale];
    return (
        <section className="help-tutorial help-downloads" id="downloads" aria-labelledby="downloads-title">
            <header>
                <h2 id="downloads-title" tabIndex={-1}>{downloadsTitle[locale]}</h2>
                <p>{content.intro}</p>
            </header>
            <div className="help-tool-grid">
                <article>
                    <h3>{content.csvTitle}</h3>
                    <p>{content.csvCopy}</p>
                    <a href={regionsCsv} download="regions-markers-demo.csv">{content.csv}</a>
                    <a href={complexCsv} download="complex-markers.csv">{content.complex}</a>
                </article>
                <article>
                    <h3>{content.projectTitle}</h3>
                    <p>{content.projectCopy}</p>
                    <a href={regionsProject} download="regions-markers-demo.RPP">{content.regions}</a>
                    <a href={simpleProject} download="demo.RPP">{content.simple}</a>
                </article>
                <article>
                    <h3>{content.pluginTitle}</h3>
                    <p>{content.pluginCopy}</p>
                    <a href={visualizer} download="Reaper2MA_Beat_Visualizer.lua">{content.plugin}</a>
                    <ol>{content.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                    <a href="https://www.reaper.fm/sdk/reascript/reascript.php" target="_blank" rel="noreferrer">{locale === "fr" ? "Documentation officielle ReaScript" : "Official ReaScript documentation"} ↗</a>
                </article>
            </div>
        </section>
    );
}
