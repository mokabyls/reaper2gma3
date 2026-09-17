import { useEffect, useRef } from "react";
import { useI18n, type Locale } from "../i18n.js";
import reaperMarkersImage from "../lib/assets/reaper-markers.webp";
import grandma3TimecodeImage from "../lib/assets/grandma3-timecode.webp";
import grandma3ExecutorsImage from "../lib/assets/grandma3-executors.webp";

/**
 * A real screenshot, never a mock-up: programmers use these to recognize their own screen.
 * `src` stays undefined until the real capture exists; a clearly-marked placeholder is drawn
 * instead, and `alt` doubles as its visible description so the slot still teaches something.
 */
type HelpFigure = {
    src?: string;
    alt: string;
    caption: string;
};

type ConsoleGuide = {
    id: string;
    eyebrow: string;
    title: string;
    introduction: string;
    steps: Array<{ title: string; description: string; result?: string }>;
    figures: HelpFigure[];
    note: string;
};

type HelpItem = {
    syntax: string;
    title: string;
    description: string;
    result?: string;
};

type HelpSection = {
    id: string;
    eyebrow: string;
    title: string;
    introduction: string;
    items: HelpItem[];
    figure?: HelpFigure;
    note?: string;
};

type ExportTutorial = {
    id: string;
    eyebrow: string;
    title: string;
    introduction: string;
    criticalTitle: string;
    criticalCopy: string;
    steps: Array<{ title: string; description: string; result?: string }>;
    checkTitle: string;
    checkCopy: string;
    validLabel: string;
    validValue: string;
    invalidLabel: string;
    invalidValues: string[];
    figure?: HelpFigure;
    renumberTitle: string;
    renumberCopy: string;
    tools: Array<{ name: string; description: string; href?: string }>;
    resourcesLabel: string;
};

type HelpContent = {
    eyebrow: string;
    title: string;
    introduction: string;
    back: string;
    tocLabel: string;
    exportTutorial: ExportTutorial;
    consoleGuide: ConsoleGuide;
    quickTitle: string;
    quickCopy: string;
    syntaxTitle: string;
    syntaxLines: Array<{ code: string; text: string }>;
    exampleTitle: string;
    exampleCode: string;
    exampleCopy: string;
    sections: HelpSection[];
    figurePending: string;
    limitsTitle: string;
    limits: string[];
};

const contentByLocale: Record<Locale, HelpContent> = {
    fr: {
        eyebrow: "Aide REAPER → grandMA3",
        title: "Guide REAPER, CSV et tags",
        introduction:
            "Retrouve ici la syntaxe reconnue dans la colonne Name du CSV, ce que chaque tag génère dans grandMA3 et le rôle des pré-rolls. Cette page reste disponible depuis le bouton Aide, où que tu sois dans un projet.",
        back: "Revenir à l’application",
        tocLabel: "Sommaire de l’aide",
        exportTutorial: {
            id: "export-csv",
            eyebrow: "00 · Préparer le fichier",
            title: "Exporter les markers REAPER en secondes",
            introduction:
                "Reaper2MA utilise directement la valeur Start du CSV. Il faut donc demander à REAPER d’exporter une position numérique en secondes avant d’ouvrir le Region/Marker Manager.",
            criticalTitle: "Le point critique : choisir Seconds",
            criticalCopy:
                "Choisis bien Seconds — pas Minutes:Seconds, Hours:Minutes:Seconds:Frames, Measures:Beats ou Samples. Reaper2MA attend par exemple 12.500 et ne convertit volontairement aucun autre format.",
            steps: [
                {
                    title: "Passer la règle en secondes",
                    description: "Fais un clic droit sur la règle, tout en haut de la timeline, puis choisis Time unit for ruler → Seconds. L’affichage de la règle doit devenir un nombre de secondes.",
                    result: "Sur les versions récentes avec plusieurs ruler lanes, vérifie aussi que la lane des markers/régions utilise le temps et non les beats.",
                },
                {
                    title: "Ouvrir le Region/Marker Manager",
                    description: "Dans le menu View, ouvre Region/Marker Manager. La colonne Start doit maintenant afficher des nombres comme 0.000, 7.250 ou 125.800.",
                },
                {
                    title: "Choisir ce qui sera exporté",
                    description: "Active Markers. Active aussi Regions si tu veux créer une séquence grandMA3 par région. Les take markers ne sont pas nécessaires. Clique sur la colonne Start pour vérifier que la liste est bien affichée du plus tôt au plus tard.",
                },
                {
                    title: "Renuméroter dans l’ordre, si nécessaire",
                    description: "Dans le menu contextuel du manager, utilise Renumber in timeline order. REAPER possède déjà cette fonction : aucune extension n’est requise pour ce cas simple.",
                },
                {
                    title: "Exporter le fichier",
                    description: "Fais un clic droit dans le manager, choisis Export regions/markers…, sélectionne le format CSV, donne un nom au fichier puis enregistre-le.",
                },
                {
                    title: "Faire le contrôle de cinq secondes",
                    description: "Ouvre le CSV dans un éditeur de texte. Il doit contenir les colonnes #, Name et Start ; les valeurs de Start, End et Length doivent être des nombres décimaux sans deux-points.",
                },
            ],
            checkTitle: "Reconnaître immédiatement un bon export",
            checkCopy: "Le premier marqueur ci-dessous est à douze secondes et demie. Seule la première écriture est compatible avec Reaper2MA.",
            validLabel: "Compatible",
            validValue: "M1,Intro,12.500,,,",
            invalidLabel: "À réexporter",
            invalidValues: ["M1,Intro,0:12.500,,,", "M1,Intro,1.1.00,,,", "M1,Intro,00:00:12:12,,,"],
            figure: {
            src: reaperMarkersImage,
            alt: "Piste de marqueurs REAPER montrant des marqueurs rouges, verts, violets et blancs le long de la timeline.",
            caption: "Une piste de marqueurs REAPER. Les marqueurs laissés sans couleur (rouges par défaut) deviennent les cues de la séquence principale : Intro, VER, REF, Outro. Chaque couleur forme sa propre séquence répétée — ici SD en vert, BD en violet, Crash en blanc.",
        },
        renumberTitle: "Renumérotation et outils optionnels",
            renumberCopy:
                "La position en secondes reste la source du timing. Cependant, l’ordre des lignes détermine aussi la première occurrence d’une couleur, la numérotation de certaines cues et l’ordre R1, R2… retenu par l’importeur. Trier par Start puis renuméroter dans l’ordre de la timeline est donc fortement recommandé pour éviter les surprises.",
            tools: [
                {
                    name: "REAPER natif — recommandé",
                    description: "Renumber in timeline order suffit pour remettre markers et régions dans l’ordre avant l’export.",
                    href: "https://www.reaper.fm/userguide.php",
                },
                {
                    name: "SWS Extension",
                    description: "Ajoute les actions SWS: Renumber marker IDs et SWS: Renumber region IDs. Utile pour créer un raccourci, une toolbar ou une custom action qui renumérote automatiquement.",
                    href: "https://sws-extension.org/",
                },
                {
                    name: "ReaPack",
                    description: "Gestionnaire de scripts pour des workflows plus avancés. Les scripts installés dépendent de tes besoins ; ReaPack n’est pas requis par Reaper2MA.",
                    href: "https://github.com/cfillion/reapack",
                },
            ],
            resourcesLabel: "Ouvrir la source officielle",
        },
        quickTitle: "Le principe en 30 secondes",
        quickCopy:
            "Un marqueur REAPER devient une cue ou un événement. Sa couleur choisit son type de séquence ; les tags placés dans son nom précisent où il doit aller et comment il doit s’exécuter.",
        syntaxTitle: "Comment écrire les tags",
        syntaxLines: [
            { code: "[TAG] Nom du marqueur", text: "Place les tags au début du nom." },
            { code: "[Temp|Release_250] HIT", text: "Combine plusieurs instructions avec | dans un même bloc." },
            { code: "[R2][LAYER=FX] Impact", text: "Enchaîne plusieurs blocs lorsque la lecture est plus claire." },
            { code: "Intro [Go-]", text: "Les tokens d’exécution peuvent aussi être placés à la fin." },
        ],
        exampleTitle: "Exemple complet",
        exampleCode: "[R2][LAYER=FX|CueFade_0.2|FadeFromX_0.5] White Hit",
        exampleCopy:
            "Dans la région R2, crée une cue White Hit sur le layer FX, avec un CueFade de 0,2 et un FadeFromX de 0,5.",
        sections: [
            {
                id: "organisation",
                eyebrow: "01 · Organisation",
                title: "Couleurs, régions et séquences",
                introduction: "Avant les tags, la couleur et la position du marqueur déterminent déjà sa destination.",
                items: [
                    {
                        syntax: "Sans couleur",
                        title: "Cue principale",
                        description: "En mode classique, le marqueur rejoint la séquence principale. En mode régions, il rejoint la séquence de la région qui le contient.",
                    },
                    {
                        syntax: "Color renseignée",
                        title: "Répétition / effet",
                        description: "En mode classique, les marqueurs de couleur identique partagent une séquence d’effet. La première occurrence donne son nom.",
                        result: "Nom par défaut : MA Drop. Avec l’identifiant optionnel FX : MA FX - Drop.",
                    },
                    {
                        syntax: "Région REAPER",
                        title: "Une séquence par région",
                        description: "Si le mode régions est activé, chaque vraie région produit sa séquence, avec des cues automatiques Region Start et Region End.",
                    },
                    {
                        syntax: "[GLOBAL] ou [MAIN]",
                        title: "Forcer la séquence principale",
                        description: "Conserve le marqueur dans la séquence principale même s’il se trouve à l’intérieur d’une région.",
                        result: "Exemple : [GLOBAL] House Lights",
                    },
                    {
                        syntax: "[R2]",
                        title: "Cibler une région",
                        description: "Envoie le marqueur vers la région R2, quelle que soit sa position réelle dans le CSV.",
                        result: "Exemple : [R2] Intro Look",
                    },
                    {
                        syntax: "[LAYER=FX]",
                        title: "Créer un layer de région",
                        description: "Crée ou alimente une séquence FX attachée à la région qui contient le marqueur. Ajoute [R2] devant pour cibler explicitement R2.",
                        result: "Exemple : [R2][LAYER=Voix] Face Light",
                    },
                ],
            },
            {
                id: "execution",
                eyebrow: "02 · Exécution",
                title: "Go, Temp, Flash et relâchements",
                introduction: "Sans token, un marqueur utilise Go+. Les tokens changent la commande portée par l’événement de timecode.",
                items: [
                    {
                        syntax: "[Go+] [Go-] [Goto]",
                        title: "Déclencher ou naviguer",
                        description: "Go+ avance, Go- revient et Goto vise directement la cue calculée. Le token peut aussi être écrit à la fin : Intro [Go-].",
                    },
                    {
                        syntax: "[Load] [On] [Select] [Top]",
                        title: "Autres tokens grandMA3",
                        description: "Transmet le token correspondant à l’événement : charger, activer, sélectionner ou revenir au début de la séquence.",
                    },
                    {
                        syntax: "[Temp] ou [Flash]",
                        title: "Créer un bump temporaire",
                        description: "Crée une séquence de bump distincte, regroupée par région, couleur et nom. Elle contient un OffCue automatique au lieu de rester active.",
                        result: "Sans durée précisée, le relâchement par défaut est de 0,2 s.",
                    },
                    {
                        syntax: "[Temp|Release_250]",
                        title: "Relâchement après une durée fixe",
                        description: "Déclenche le bump puis règle son OffCue automatique à 250 ms. Release_750 produirait 0,75 s.",
                        result: "Exemple : [Flash|Release_120] Strobe Hit",
                    },
                    {
                        syntax: "[TempRelease] [FlashRelease]",
                        title: "Relâchement placé sur la timeline",
                        description: "Place un second marqueur pour mesurer la durée depuis le dernier Temp ou Flash encore ouvert de même région, couleur et type. Ce marqueur de release ne crée pas une cue visible.",
                        result: "Exemple : [Temp] HIT à 10 s puis [TempRelease] à 10,8 s → OffCue de 0,8 s.",
                    },
                    {
                        syntax: "[Bump] [BumpRelease]",
                        title: "Alias de compatibilité",
                        description: "Bump est interprété comme Temp, et BumpRelease comme TempRelease. Pour les nouveaux fichiers, préfère les noms Temp.",
                    },
                ],
            },
            {
                id: "regions",
                eyebrow: "03 · Régions",
                title: "Démarrer, arrêter et isoler les layers",
                introduction: "Ces actions pilotent les tracks calculés en mode régions sans créer de cue parasite dans la séquence source.",
                items: [
                    {
                        syntax: "[ON_R2]",
                        title: "Démarrer la région R2",
                        description: "Crée un événement Goto|Go+ vers la vraie cue Region Start de R2.",
                    },
                    {
                        syntax: "[OFF_R2]",
                        title: "Arrêter la région R2",
                        description: "Crée un événement Off sur le track de R2 et remplace l’extinction automatique de cette région.",
                    },
                    {
                        syntax: "[OFF_LAYER=FX]",
                        title: "Arrêter un layer précis",
                        description: "Émet Off sur le layer FX de la région courante. Combine avec [R2] pour viser le layer FX de R2.",
                        result: "Exemple : [R2][OFF_LAYER=FX] Stop FX",
                    },
                    {
                        syntax: "[OFF_LAYERS]",
                        title: "Arrêter tous les layers",
                        description: "Émet Off sur chaque layer de la région courante ou de la région explicitement ciblée.",
                    },
                ],
                figure: {
                    alt: "Une piste de régions REAPER : deux ou trois régions nommées se suivant sur la timeline, avec leurs marqueurs à l’intérieur.",
                    caption: "En mode « Régions + marqueurs », chaque région REAPER devient une séquence avec ses cues de début et de fin, et les marqueurs tombant dans son intervalle deviennent ses cues intermédiaires.",
                },
                note: "Si la région ou le layer ciblé n’existe pas, l’analyse l’indique dans les avertissements au lieu d’inventer une destination.",
            },
            {
                id: "timing",
                eyebrow: "04 · Timing",
                title: "BPM, fades, délais et Cue Parts",
                introduction: "Ces tags ajoutent des réglages à la cue calculée. Ils peuvent être combinés dans le même bloc.",
                items: [
                    {
                        syntax: "[BPM_128]",
                        title: "Événement BPM",
                        description: "Ajoute un événement de tempo à 128 BPM. Sur le nom d’une région, il est placé au début de cette région.",
                    },
                    {
                        syntax: "[CueFade_2]",
                        title: "CueFade",
                        description: "Applique la valeur 2 au CueFade de la cue générée. La valeur est transmise à grandMA3.",
                    },
                    {
                        syntax: "[FadeFromX_0.5]",
                        title: "Fades par axe",
                        description: "Les familles FadeFromX/Y/Z et FadeToX/Y/Z règlent les propriétés correspondantes sur la Cue Part 0.1.",
                        result: "Exemple : [FadeFromX_0.5|FadeToZ_1.2] Move",
                    },
                    {
                        syntax: "[DelayFromX_0.25]",
                        title: "Délais par axe",
                        description: "Les familles DelayFromX/Y/Z et DelayToX/Y/Z règlent les délais correspondants sur la Cue Part 0.1.",
                    },
                    {
                        syntax: "[PART]",
                        title: "Ajouter une Cue Part",
                        description: "Attache une nouvelle Cue Part à la cue précédente de la même séquence. Son CueDelay correspond à l’écart entre les deux marqueurs.",
                        result: "Une Cue Part peut recevoir CueFade et les tags Fade/Delay, mais pas BPM, Release ou une action ON/OFF.",
                    },
                ],
            },
            {
                id: "prerolls",
                eyebrow: "05 · Options automatiques",
                title: "À quoi servent les pré-rolls ?",
                introduction: "Les pré-rolls ne sont pas des tags CSV : ce sont des réglages du wizard qui ajoutent ou déplacent des événements calculés.",
                items: [
                    {
                        syntax: "Fin de région · 750 ms",
                        title: "Anticiper Region End",
                        description: "Crée la cue Region End avant la fin physique. Une région finissant à 30,000 s déclenche cet événement à 29,250 s avec 750 ms, afin de préparer la transition.",
                        result: "Si un marqueur se trouve déjà dans cette fenêtre, la boundary peut fusionner avec lui pour éviter deux déclenchements quasi simultanés.",
                    },
                    {
                        syntax: "Layer Pre-Roll · 750 ms",
                        title: "Préparer un layer",
                        description: "Ajoute une première cue Layer Pre-Roll avant le début du layer. Pour un départ à 12,000 s, 750 ms la place à 11,250 s, sans jamais passer sous 0.",
                    },
                    {
                        syntax: "Auto Off des layers",
                        title: "Éviter qu’un layer reste actif",
                        description: "Ajoute un Off de secours lorsqu’aucun OFF_LAYER manuel n’a été rencontré. Avec une région suivante, il intervient une seconde après son départ ; sinon, à la fin de la région parente.",
                    },
                ],
            },
            {
                id: "timecode-offset",
                eyebrow: "06 · Timecode",
                title: "Synchroniser un projet avec le LTC entrant",
                introduction: "L’offset est appliqué nativement à l’objet Timecode grandMA3. Il change le moment LTC auquel le show répond, sans réécrire les positions REAPER.",
                items: [
                    {
                        syntax: "+01:00:00.000",
                        title: "Faire démarrer le LTC à une heure",
                        description: "Un événement conservé à 00:01:00 dans le projet se déclenche lorsque le LTC entrant atteint 01:01:00. Les événements, pré-rolls et durées restent sur leur temps relatif.",
                    },
                    {
                        syntax: "-00:00:00.500",
                        title: "Avancer le déclenchement",
                        description: "Un offset négatif déclenche le show plus tôt par rapport au LTC. Si le résultat place un événement avant zéro, Reaper2MA l’indique sans bloquer l’export.",
                    },
                    {
                        syntax: "Offset · TCSlot · objet Timecode",
                        title: "Trois réglages indépendants",
                        description: "L’offset décale l’objet ; le TCSlot choisit la source LTC ; le numéro Timecode choisit l’emplacement de l’objet dans le DataPool. Les macros INT/LTC changent seulement le TCSlot et conservent l’offset.",
                        result: "À zéro, ou en mode Cues uniquement, aucune commande Offset supplémentaire n’est générée.",
                    },
                ],
            },
        ],
        consoleGuide: {
            id: "grandma3-import",
            eyebrow: "09 · Côté console",
            title: "Et maintenant, dans grandMA3 ?",
            introduction:
                "Le ZIP contient un ou plusieurs fichiers XML. Ce sont des bibliothèques grandMA3 : elles s’importent dans un pool, elles ne s’ouvrent pas comme un show. Tant que le macro n’a pas été exécuté, rien n’est créé sur la console.",
            steps: [
                {
                    title: "Décompressez le ZIP",
                    description:
                        "Copiez les fichiers XML sur une clé USB ou dans le dossier d’import de la console. grandMA3 ne lit pas l’archive : les XML doivent être décompressés.",
                },
                {
                    title: "Importez le fichier dans le pool Macro",
                    description:
                        "Changez la destination vers Macro, importez la bibliothèque XML, puis revenez à Root. Le fichier s’importe comme bibliothèque de macros, jamais comme pile de cues.",
                    result: 'ChangeDestination Macro → Import Library "votre_projet_macro.xml" → ChangeDestination Root',
                },
                {
                    title: "Exécutez le macro",
                    description:
                        "C’est lui qui crée les séquences, les cues, les appearances, le timecode et ses pistes, et qui assigne les executors si vous l’avez demandé. Avant cette exécution, la console est inchangée.",
                },
                {
                    title: "Vérifiez le résultat",
                    description:
                        "Les numéros attendus sont ceux qu’annonçait le récapitulatif avant le téléchargement : plage de séquences, adresses d’executors, numéro de l’objet Timecode.",
                },
            ],
            figures: [
                {
                    src: grandma3TimecodeImage,
                    alt: "Éditeur de timecode grandMA3 avec ses pistes et la feuille de cues correspondante.",
                    caption: "Le timecode créé par le macro. Chaque séquence a sa piste, chaque marqueur son événement, et la feuille de cues reprend les noms venus de REAPER.",
                },
                {
                    src: grandma3ExecutorsImage,
                    alt: "Barre d’executors grandMA3 montrant les pools Macro, Timecode et Sequence remplis.",
                    caption: "Les pools remplis : le timecode d’un côté, les séquences de l’autre — 101 pour la principale, 102, 103 et 104 pour les répétitions issues des couleurs.",
                },
            ],
            note:
                "Les intitulés de menu varient légèrement d’une version de grandMA3 à l’autre. Ce qui ne change pas : le fichier s’importe comme bibliothèque de macros, et c’est l’exécution du macro qui construit le show.",
        },
        figurePending: "Capture à venir",
        limitsTitle: "Ce que le CSV doit contenir",
        limits: [
            "Les colonnes #, Name et Start sont obligatoires. Color est facultative.",
            "Start est interprété en secondes, pas en beats, frames ou chaîne de timecode.",
            "End ou Length permettent d’identifier les lignes de régions.",
            "Le convertisseur génère les séquences, cues, tracks, événements, appearances et macros localement dans le navigateur.",
            "Il n’importe pas l’audio et ne simule pas sa lecture : la timeline est un aperçu de contrôle.",
        ],
    },
    en: {
        eyebrow: "REAPER → grandMA3 help",
        title: "REAPER, CSV, and tag guide",
        introduction:
            "Find the syntax recognized in the CSV Name column, what each tag generates in grandMA3, and what pre-rolls do. This page remains available from the Help button anywhere in a project.",
        back: "Return to the application",
        tocLabel: "Help contents",
        exportTutorial: {
            id: "export-csv",
            eyebrow: "00 · Prepare the file",
            title: "Export REAPER markers in seconds",
            introduction:
                "Reaper2MA uses the CSV Start value directly. Ask REAPER to export a numeric position in seconds before opening the Region/Marker Manager.",
            criticalTitle: "The critical setting: choose Seconds",
            criticalCopy:
                "Choose Seconds — not Minutes:Seconds, Hours:Minutes:Seconds:Frames, Measures:Beats, or Samples. Reaper2MA expects a value such as 12.500 and intentionally converts no other time format.",
            steps: [
                {
                    title: "Set the ruler to seconds",
                    description: "Right-click the ruler at the top of the timeline, then choose Time unit for ruler → Seconds. The ruler should now display a number of seconds.",
                    result: "In recent versions with multiple ruler lanes, also make sure the marker/region lane uses time rather than beats.",
                },
                {
                    title: "Open the Region/Marker Manager",
                    description: "Open Region/Marker Manager from the View menu. The Start column should now contain values such as 0.000, 7.250, or 125.800.",
                },
                {
                    title: "Choose what to export",
                    description: "Enable Markers. Also enable Regions if you want one grandMA3 sequence per region. Take markers are not needed. Click the Start column to verify the list is displayed from earliest to latest.",
                },
                {
                    title: "Renumber in order, when useful",
                    description: "Use Renumber in timeline order from the manager's context menu. REAPER already provides this feature; no extension is needed for the simple case.",
                },
                {
                    title: "Export the file",
                    description: "Right-click inside the manager, choose Export regions/markers…, select CSV, give the file a name, and save it.",
                },
                {
                    title: "Perform the five-second check",
                    description: "Open the CSV in a text editor. It must contain #, Name, and Start; Start, End, and Length values must be decimal numbers without colons.",
                },
            ],
            checkTitle: "Recognize a correct export immediately",
            checkCopy: "The marker below is at twelve and a half seconds. Only the first representation is compatible with Reaper2MA.",
            validLabel: "Compatible",
            validValue: "M1,Intro,12.500,,,",
            invalidLabel: "Export again",
            invalidValues: ["M1,Intro,0:12.500,,,", "M1,Intro,1.1.00,,,", "M1,Intro,00:00:12:12,,,"],
            figure: {
            src: reaperMarkersImage,
            alt: "REAPER marker lane showing red, green, purple, and white markers along the timeline.",
            caption: "A REAPER marker lane. Markers left uncolored (red by default) become the cues of the main sequence: Intro, VER, REF, Outro. Each color forms its own repeated sequence — here SD in green, BD in purple, Crash in white.",
        },
        renumberTitle: "Renumbering and optional tools",
            renumberCopy:
                "Seconds remain the source of event timing. However, row order also determines a color's first occurrence, some cue numbering, and the R1, R2… order used by the importer. Sorting by Start and then renumbering in timeline order is therefore strongly recommended to avoid surprises.",
            tools: [
                {
                    name: "Native REAPER — recommended",
                    description: "Renumber in timeline order is enough to put markers and regions back in order before export.",
                    href: "https://www.reaper.fm/userguide.php",
                },
                {
                    name: "SWS Extension",
                    description: "Adds SWS: Renumber marker IDs and SWS: Renumber region IDs. Useful for a shortcut, toolbar, or custom action that renumbers automatically.",
                    href: "https://sws-extension.org/",
                },
                {
                    name: "ReaPack",
                    description: "A script package manager for more advanced workflows. Installed scripts depend on your needs; ReaPack is not required by Reaper2MA.",
                    href: "https://github.com/cfillion/reapack",
                },
            ],
            resourcesLabel: "Open the official source",
        },
        quickTitle: "The idea in 30 seconds",
        quickCopy:
            "A REAPER marker becomes a cue or event. Its color selects its sequence type; tags in its name define where it goes and how it executes.",
        syntaxTitle: "Writing tags",
        syntaxLines: [
            { code: "[TAG] Marker name", text: "Put tags at the beginning of the name." },
            { code: "[Temp|Release_250] HIT", text: "Combine instructions with | in one block." },
            { code: "[R2][LAYER=FX] Impact", text: "Chain blocks when that reads more clearly." },
            { code: "Intro [Go-]", text: "Execution tokens may also appear at the end." },
        ],
        exampleTitle: "Complete example",
        exampleCode: "[R2][LAYER=FX|CueFade_0.2|FadeFromX_0.5] White Hit",
        exampleCopy:
            "In region R2, creates a White Hit cue on the FX layer, with a 0.2 CueFade and a 0.5 FadeFromX.",
        sections: [
            {
                id: "organisation",
                eyebrow: "01 · Organization",
                title: "Colors, regions, and sequences",
                introduction: "Before tags are considered, marker color and position already define its destination.",
                items: [
                    { syntax: "No color", title: "Main cue", description: "In classic mode, the marker joins the main sequence. In region mode, it joins the sequence of its containing region." },
                    { syntax: "Color set", title: "Repeat / effect", description: "In classic mode, markers with the exact same color share an effect sequence. The first occurrence provides its name.", result: "Default name: MA Drop. With the optional FX identifier: MA FX - Drop." },
                    { syntax: "REAPER region", title: "One sequence per region", description: "When region mode is enabled, every real region creates a sequence with automatic Region Start and Region End cues." },
                    { syntax: "[GLOBAL] or [MAIN]", title: "Force the main sequence", description: "Keeps a marker in the main sequence even when it falls inside a region.", result: "Example: [GLOBAL] House Lights" },
                    { syntax: "[R2]", title: "Target a region", description: "Sends the marker to region R2 regardless of its actual position in the CSV.", result: "Example: [R2] Intro Look" },
                    { syntax: "[LAYER=FX]", title: "Create a region layer", description: "Creates or feeds an FX sequence attached to the containing region. Prefix it with [R2] to explicitly target R2.", result: "Example: [R2][LAYER=Voice] Face Light" },
                ],
            },
            {
                id: "execution",
                eyebrow: "02 · Execution",
                title: "Go, Temp, Flash, and releases",
                introduction: "Without a token, a marker uses Go+. Tokens change the command carried by the timecode event.",
                items: [
                    { syntax: "[Go+] [Go-] [Goto]", title: "Trigger or navigate", description: "Go+ advances, Go- goes back, and Goto directly targets the computed cue. A token can also be written at the end: Intro [Go-]." },
                    { syntax: "[Load] [On] [Select] [Top]", title: "Other grandMA3 tokens", description: "Passes the corresponding token to the event: load, enable, select, or return to the top of the sequence." },
                    { syntax: "[Temp] or [Flash]", title: "Create a temporary bump", description: "Creates a separate bump sequence grouped by region, color, and name. It contains an automatic OffCue instead of remaining active.", result: "Without an explicit duration, the default release is 0.2 s." },
                    { syntax: "[Temp|Release_250]", title: "Release after a fixed duration", description: "Triggers the bump, then sets its automatic OffCue to 250 ms. Release_750 would produce 0.75 s.", result: "Example: [Flash|Release_120] Strobe Hit" },
                    { syntax: "[TempRelease] [FlashRelease]", title: "Place the release on the timeline", description: "Add a second marker to measure duration from the last open Temp or Flash of the same region, color, and type. The release marker does not create a visible cue.", result: "Example: [Temp] HIT at 10 s then [TempRelease] at 10.8 s → 0.8 s OffCue." },
                    { syntax: "[Bump] [BumpRelease]", title: "Compatibility aliases", description: "Bump is interpreted as Temp and BumpRelease as TempRelease. Prefer the Temp names for new files." },
                ],
            },
            {
                id: "regions",
                eyebrow: "03 · Regions",
                title: "Start, stop, and isolate layers",
                introduction: "These actions control computed tracks in region mode without creating an extra source cue.",
                items: [
                    { syntax: "[ON_R2]", title: "Start region R2", description: "Creates a Goto|Go+ event pointing to R2's actual Region Start cue." },
                    { syntax: "[OFF_R2]", title: "Stop region R2", description: "Creates an Off event on R2's track and replaces that region's automatic shutdown." },
                    { syntax: "[OFF_LAYER=FX]", title: "Stop one layer", description: "Emits Off on the current region's FX layer. Combine with [R2] to target R2's FX layer.", result: "Example: [R2][OFF_LAYER=FX] Stop FX" },
                    { syntax: "[OFF_LAYERS]", title: "Stop all layers", description: "Emits Off on every layer in the current or explicitly targeted region." },
                ],
                figure: {
                    alt: "A REAPER region lane: two or three named regions following each other on the timeline, with their markers inside.",
                    caption: "In “Regions + markers” mode, each REAPER region becomes a sequence with its own start and end cues, and markers falling inside its range become its intermediate cues.",
                },
                note: "If a targeted region or layer does not exist, analysis reports a warning instead of inventing a destination.",
            },
            {
                id: "timing",
                eyebrow: "04 · Timing",
                title: "BPM, fades, delays, and Cue Parts",
                introduction: "These tags add settings to the computed cue. They can be combined in the same block.",
                items: [
                    { syntax: "[BPM_128]", title: "BPM event", description: "Adds a 128 BPM tempo event. On a region name, it is placed at that region's start." },
                    { syntax: "[CueFade_2]", title: "CueFade", description: "Applies 2 as the generated cue's CueFade value. The value is passed to grandMA3." },
                    { syntax: "[FadeFromX_0.5]", title: "Axis fades", description: "FadeFromX/Y/Z and FadeToX/Y/Z set their matching properties on Cue Part 0.1.", result: "Example: [FadeFromX_0.5|FadeToZ_1.2] Move" },
                    { syntax: "[DelayFromX_0.25]", title: "Axis delays", description: "DelayFromX/Y/Z and DelayToX/Y/Z set their matching delay properties on Cue Part 0.1." },
                    { syntax: "[PART]", title: "Add a Cue Part", description: "Attaches a new Cue Part to the preceding cue in the same sequence. Its CueDelay is the gap between both markers.", result: "A Cue Part may use CueFade and Fade/Delay tags, but not BPM, Release, or an ON/OFF action." },
                ],
            },
            {
                id: "prerolls",
                eyebrow: "05 · Automatic options",
                title: "What are pre-rolls for?",
                introduction: "Pre-rolls are not CSV tags. They are wizard settings that add or move computed events.",
                items: [
                    { syntax: "Region end · 750 ms", title: "Anticipate Region End", description: "Creates the Region End cue before the physical end. A region ending at 30.000 s triggers it at 29.250 s with 750 ms, preparing the transition.", result: "If a marker already falls in that window, the boundary may merge into it to avoid two nearly simultaneous triggers." },
                    { syntax: "Layer Pre-Roll · 750 ms", title: "Prepare a layer", description: "Adds a first Layer Pre-Roll cue before the layer begins. For a 12.000 s start, 750 ms places it at 11.250 s, never below 0." },
                    { syntax: "Layer Auto Off", title: "Keep a layer from remaining active", description: "Adds a fallback Off when no manual OFF_LAYER was found. With a following region it occurs one second after that region starts; otherwise at the parent region's end." },
                ],
            },
            {
                id: "timecode-offset",
                eyebrow: "06 · Timecode",
                title: "Synchronize a project with incoming LTC",
                introduction: "The offset is applied natively to the grandMA3 Timecode object. It changes the incoming LTC time the show responds to without rewriting REAPER positions.",
                items: [
                    { syntax: "+01:00:00.000", title: "Start LTC at one hour", description: "An event kept at 00:01:00 in the project triggers when incoming LTC reaches 01:01:00. Events, pre-rolls, and durations remain at their relative times." },
                    { syntax: "-00:00:00.500", title: "Trigger earlier", description: "A negative offset triggers the show earlier relative to LTC. If it places an event before zero, Reaper2MA warns without blocking export." },
                    { syntax: "Offset · TCSlot · Timecode object", title: "Three independent settings", description: "Offset shifts the object; TCSlot selects the LTC source; the Timecode number selects the object's DataPool location. INT/LTC macros only change TCSlot and retain the offset.", result: "At zero, or in Cues only mode, no extra Offset command is generated." },
                ],
            },
        ],
        consoleGuide: {
            id: "grandma3-import",
            eyebrow: "09 · On the console",
            title: "And now, in grandMA3?",
            introduction:
                "The ZIP holds one or more XML files. These are grandMA3 libraries: they are imported into a pool, not opened as a show. Until the macro is executed, nothing is created on the console.",
            steps: [
                {
                    title: "Unzip the archive",
                    description:
                        "Copy the XML files onto a USB stick or into the console import folder. grandMA3 does not read the archive: the XML files must be extracted.",
                },
                {
                    title: "Import the file into the Macro pool",
                    description:
                        "Change the destination to Macro, import the XML library, then return to Root. The file is imported as a macro library, never as a cue stack.",
                    result: 'ChangeDestination Macro → Import Library "your_project_macro.xml" → ChangeDestination Root',
                },
                {
                    title: "Execute the macro",
                    description:
                        "The macro is what creates the sequences, cues, appearances, the timecode and its tracks, and assigns the executors if you asked for it. Before that execution, the console is untouched.",
                },
                {
                    title: "Check the result",
                    description:
                        "The expected numbers are the ones the summary announced before the download: sequence range, executor addresses, Timecode object number.",
                },
            ],
            figures: [
                {
                    src: grandma3TimecodeImage,
                    alt: "grandMA3 timecode editor with its tracks and the matching cue sheet.",
                    caption: "The timecode built by the macro. Each sequence has its track, each marker its event, and the cue sheet carries the names that came from REAPER.",
                },
                {
                    src: grandma3ExecutorsImage,
                    alt: "grandMA3 executor bar showing the Macro, Timecode, and Sequence pools filled in.",
                    caption: "The filled pools: the timecode on one side, the sequences on the other — 101 for the main stack, 102, 103, and 104 for the repeats built from colors.",
                },
            ],
            note:
                "Menu labels vary slightly between grandMA3 versions. What does not vary: the file is imported as a macro library, and executing the macro is what builds the show.",
        },
        figurePending: "Screenshot coming",
        limitsTitle: "What the CSV must contain",
        limits: [
            "Columns #, Name, and Start are required. Color is optional.",
            "Start is interpreted as seconds, not beats, frames, or a timecode string.",
            "End or Length identifies region rows.",
            "The converter generates sequences, cues, tracks, events, appearances, and macros locally in the browser.",
            "It does not import or play audio; the timeline is a verification preview.",
        ],
    },
};

export function HelpPage({ onBack, initialSection }: { onBack: () => void; initialSection?: string }) {
    const { locale } = useI18n();
    const content = contentByLocale[locale];
    const headingRef = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        const sectionHeading = initialSection ? document.getElementById(`${initialSection}-title`) : undefined;

        if (sectionHeading) {
            sectionHeading.focus({ preventScroll: true });
            sectionHeading.scrollIntoView?.({ behavior: "auto" });
            return;
        }

        window.scrollTo({ top: 0, behavior: "auto" });
        headingRef.current?.focus();
    }, [initialSection]);

    return (
        <main className="page help-page">
            <div className="help-hero">
                <button className="button secondary help-back" type="button" onClick={onBack}>← {content.back}</button>
                <span className="eyebrow">{content.eyebrow}</span>
                <h1 ref={headingRef} tabIndex={-1}>{content.title}</h1>
                <p>{content.introduction}</p>
            </div>

            <nav className="help-toc" aria-label={content.tocLabel}>
                <button type="button" onClick={() => document.getElementById(content.exportTutorial.id)?.scrollIntoView?.({ behavior: "smooth" })}>
                    {content.exportTutorial.title}
                </button>
                {content.sections.map((section) => (
                    <button key={section.id} type="button" onClick={() => document.getElementById(section.id)?.scrollIntoView?.({ behavior: "smooth" })}>
                        {section.title}
                    </button>
                ))}
                <button type="button" onClick={() => document.getElementById(content.consoleGuide.id)?.scrollIntoView?.({ behavior: "smooth" })}>
                    {content.consoleGuide.title}
                </button>
            </nav>

            <section className="help-tutorial" id={content.exportTutorial.id} aria-labelledby={`${content.exportTutorial.id}-title`}>
                <header>
                    <span className="eyebrow">{content.exportTutorial.eyebrow}</span>
                    <h2 id={`${content.exportTutorial.id}-title`} tabIndex={-1}>{content.exportTutorial.title}</h2>
                    <p>{content.exportTutorial.introduction}</p>
                </header>

                {content.exportTutorial.figure ? <HelpFigureView figure={content.exportTutorial.figure} pendingLabel={content.figurePending} /> : null}

                <div className="help-critical">
                    <span aria-hidden="true">!</span>
                    <div><h3>{content.exportTutorial.criticalTitle}</h3><p>{content.exportTutorial.criticalCopy}</p></div>
                </div>

                <ol className="help-tutorial-steps">
                    {content.exportTutorial.steps.map((step, index) => (
                        <li key={step.title}>
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            <div>
                                <h3>{step.title}</h3>
                                <p>{step.description}</p>
                                {step.result ? <small>{step.result}</small> : null}
                            </div>
                        </li>
                    ))}
                </ol>

                <section className="help-csv-check" aria-labelledby="help-csv-check-title">
                    <header><h3 id="help-csv-check-title">{content.exportTutorial.checkTitle}</h3><p>{content.exportTutorial.checkCopy}</p></header>
                    <div className="help-csv-examples">
                        <div className="valid"><span>✓ {content.exportTutorial.validLabel}</span><code>{content.exportTutorial.validValue}</code></div>
                        <div className="invalid"><span>× {content.exportTutorial.invalidLabel}</span>{content.exportTutorial.invalidValues.map((value) => <code key={value}>{value}</code>)}</div>
                    </div>
                </section>

                <section className="help-tools" aria-labelledby="help-tools-title">
                    <header><h3 id="help-tools-title">{content.exportTutorial.renumberTitle}</h3><p>{content.exportTutorial.renumberCopy}</p></header>
                    <div className="help-tool-grid">
                        {content.exportTutorial.tools.map((tool) => (
                            <article key={tool.name}>
                                <h4>{tool.name}</h4>
                                <p>{tool.description}</p>
                                {tool.href ? <a href={tool.href} target="_blank" rel="noreferrer" aria-label={`${content.exportTutorial.resourcesLabel} : ${tool.name}`}>{content.exportTutorial.resourcesLabel} ↗</a> : null}
                            </article>
                        ))}
                    </div>
                </section>
            </section>

            <section className="help-quick" aria-labelledby="help-quick-title">
                <div>
                    <span className="eyebrow">CSV · Name</span>
                    <h2 id="help-quick-title">{content.quickTitle}</h2>
                    <p>{content.quickCopy}</p>
                </div>
                <div className="help-syntax-card">
                    <h3>{content.syntaxTitle}</h3>
                    <div className="help-syntax-list">
                        {content.syntaxLines.map((line) => (
                            <div key={line.code}>
                                <code>{line.code}</code>
                                <span>{line.text}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="help-example">
                    <span>{content.exampleTitle}</span>
                    <code>{content.exampleCode}</code>
                    <p>{content.exampleCopy}</p>
                </div>
            </section>

            <div className="help-sections">
                {content.sections.map((section) => (
                    <section className="help-section" id={section.id} key={section.id} aria-labelledby={`${section.id}-title`}>
                        <header>
                            <span className="eyebrow">{section.eyebrow}</span>
                            <h2 id={`${section.id}-title`} tabIndex={-1}>{section.title}</h2>
                            <p>{section.introduction}</p>
                        </header>
                        <div className="help-item-list">
                            {section.items.map((item) => (
                                <article className="help-item" key={`${section.id}-${item.syntax}`}>
                                    <code>{item.syntax}</code>
                                    <div>
                                        <h3>{item.title}</h3>
                                        <p>{item.description}</p>
                                        {item.result ? <small>{item.result}</small> : null}
                                    </div>
                                </article>
                            ))}
                        </div>
                        {section.figure ? <HelpFigureView figure={section.figure} pendingLabel={content.figurePending} /> : null}
                        {section.note ? <p className="help-note">{section.note}</p> : null}
                    </section>
                ))}
            </div>

            <section className="help-tutorial help-console-guide" id={content.consoleGuide.id} aria-labelledby={`${content.consoleGuide.id}-title`}>
                <header>
                    <span className="eyebrow">{content.consoleGuide.eyebrow}</span>
                    <h2 id={`${content.consoleGuide.id}-title`} tabIndex={-1}>{content.consoleGuide.title}</h2>
                    <p>{content.consoleGuide.introduction}</p>
                </header>

                <ol className="help-tutorial-steps">
                    {content.consoleGuide.steps.map((step, index) => (
                        <li key={step.title}>
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            <div>
                                <h3>{step.title}</h3>
                                <p>{step.description}</p>
                                {step.result ? <small>{step.result}</small> : null}
                            </div>
                        </li>
                    ))}
                </ol>

                {content.consoleGuide.figures.map((figure) => <HelpFigureView key={figure.src ?? figure.alt} figure={figure} pendingLabel={content.figurePending} />)}

                <p className="help-note">{content.consoleGuide.note}</p>
            </section>

            <section className="help-limits">
                <h2>{content.limitsTitle}</h2>
                <ul>{content.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul>
            </section>
        </main>
    );
}

function HelpFigureView({ figure, pendingLabel }: { figure: HelpFigure; pendingLabel: string }) {
    return (
        <figure className="help-figure">
            {figure.src ? (
                <div className="help-figure-frame">
                    <img src={figure.src} alt={figure.alt} loading="lazy" decoding="async" />
                </div>
            ) : (
                <div className="help-figure-pending">
                    <span className="help-figure-pending-badge">{pendingLabel}</span>
                    <p>{figure.alt}</p>
                </div>
            )}
            <figcaption>{figure.caption}</figcaption>
        </figure>
    );
}
