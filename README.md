# Reaper2MA

Reaper2MA transforme localement un export CSV de marqueurs et régions REAPER en macros XML grandMA3. L’application est une SPA React : aucun CSV n’est envoyé à un serveur et aucun compte n’est requis.

## Parcours

- Bibliothèque locale de projets avec recherche, filtres, tris, duplication V2/V3, import et export JSON.
- Assistant guidé pour analyser le CSV, choisir le mode régions, configurer cues, séquences, timecode, executors et macros additionnelles.
- Aperçu compact des régions et marqueurs, avec virtualisation des longues listes.
- Timeline canvas `Source REAPER` / `Sortie grandMA3`, cadrée sur la région sélectionnée ou sur le projet complet, zoomable et déplaçable à la souris, au trackpad ou au tactile.
- Vérification finale et téléchargement d’un ZIP contenant le macro principal et les extras sélectionnés.
- Aide permanente avec tutoriel d’export REAPER en secondes, contrôle du CSV, tags et outils optionnels de renumérotation.
- Interface français/anglais, thème système, clair ou sombre.

## Préparer le CSV REAPER

Reaper2MA attend les positions `Start`, `End` et `Length` en secondes décimales (`12.500`), sans timecode, mesures/beats ni format minutes:secondes.

1. Clic droit sur la règle REAPER, puis `Time unit for ruler` → `Seconds`.
2. Ouvrir `View` → `Region/Marker Manager` et activer `Markers`, ainsi que `Regions` si nécessaire.
3. Trier la colonne `Start`, puis choisir `Renumber in timeline order` dans le menu contextuel (recommandé).
4. Choisir `Export regions/markers…`, puis enregistrer en CSV.

Le tutoriel complet, avec exemples valides/invalides et options SWS/ReaPack, est accessible via `Aide` ou directement depuis l’étape d’import du CSV.

## Stockage et confidentialité

Les projets sont conservés dans IndexedDB. Un projet stocke le CSV source, les noms, les réglages, la progression et les dix dernières révisions ; les XML, le ZIP et la timeline sont recalculés à la demande.

L’application surveille le quota fourni par `navigator.storage.estimate()` : elle avertit à 80 %, refuse préventivement un import qui atteindrait 95 % et ne supprime jamais automatiquement un projet. Un export `.reaper2ma.json` contient le projet, ses sources référencées et son historique.

Les anciens réglages `reaper2ma:settings:v1` restent lus comme valeurs initiales du premier projet. La langue et le thème utilisent une préférence locale séparée.

## Conversion grandMA3

- Les marqueurs non colorés deviennent les cues de la séquence principale.
- Les marqueurs colorés sont regroupés par couleur exacte en séquences répétées.
- Les marqueurs `Temp` et `Flash` deviennent des séquences de bump.
- Le mode régions crée les séquences de régions, layers, pré-rolls et événements Off configurés.
- Les tags existants (`BPM`, `CueFade`, timing de cue, parties, actions régions/layers) restent pris en charge.
- Chaque séquence reçoit le Speed Master choisi.
- L’identifiant secondaire des répétitions et bumps est optionnel et désactivé par défaut. Il peut être activé pour obtenir par exemple `MA FX - Drop` au lieu du nom simple `MA Drop` ; il n’affecte ni le timing ni la numérotation. Les anciens projets conservent leur valeur, notamment l’ancien `1`.
- Le nom du projet définit le slug des fichiers (`Traversée V2` → `traversee-v2_macro.xml`).
- Le nom du timecode, modifiable indépendamment, définit les noms et références grandMA3.
- L’offset signé du Timecode (`HH:MM:SS.mmm`) synchronise un projet REAPER restant à zéro avec un LTC entrant démarrant par exemple à `01:00:00`. Il est appliqué nativement à l’objet grandMA3 sans déplacer les événements, pré-rolls ni durées.
- Pour les macros additionnelles, le slot INT vaut `-2` avant grandMA3 2.4 et `-1` à partir de 2.4. Les modes LTC et la restauration automatique utilisent le slot externe choisi.

Le `Timecode Number`, l’`Offset`, le `TCSlot` source (choisi dans l’étape Sortie) et l’`OSC Slot ID` REAPER restent des réglages distincts. Un événement relatif à `00:01:00` avec un offset `+01:00:00.000` répond ainsi au LTC entrant `01:01:00`. L’offset accepte les valeurs de `-255:59:58.960` à `+255:59:58.960` ; à zéro ou en mode `Cues uniquement`, aucune commande supplémentaire n’est générée. Voir la [documentation Timecode grandMA3](https://help2.malighting.com/grandMA3/2.4/HTML/timecode_settings.html) et la [syntaxe du mot-clé Timecode](https://help2.malighting.com/grandMA3/2.4/HTML/keyword_timecode.html).

## Développement

Prérequis : Node.js 22 et pnpm 10.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Validation complète :

```sh
pnpm test
pnpm check
pnpm build
```

Le build statique est écrit dans `build/`. En production, Vite utilise le chemin de base `/reaper2gma3/` pour GitHub Pages.

## Architecture

- `src/App.tsx` : orchestration de la bibliothèque, import/export et navigation.
- `src/components/ProjectWizard.tsx` : reducer et étapes du parcours guidé.
- `src/components/ProjectLibrary.tsx` et `ProjectOverview.tsx` : bibliothèque et synthèse d’un projet configuré.
- `src/components/RegionBrowser.tsx` et `TimelineModal.tsx` : inspection accessible et canvas.
- `src/lib/projects/` : modèles versionnés, repository IndexedDB, quotas, historique et runtime.
- `src/lib/reaper2ma/` : analyse CSV, conversion et génération grandMA3.
- `tests/reaper2ma.test.ts` : tests de compatibilité de conversion.
- `tests/*.ui.test.*` et `tests/timeline.test.tsx` : stockage et interactions React.

## Outils complémentaires

Le dépôt contient aussi :

- une bibliothèque de macros de transport REAPER via OSC, documentée dans [docs/grandma3-reaper-osc.md](./docs/grandma3-reaper-osc.md) ;
- le plugin grandMA3 bump-to-main, documenté dans [docs/grandma3-bump-to-main.md](./docs/grandma3-bump-to-main.md) ;
- le visualiseur REAPER autonome, documenté dans [docs/reaper-beat-visualizer.md](./docs/reaper-beat-visualizer.md).

La synchronisation Google et les contrôles DJ/métronome ne font pas partie de cette version.

## Licence

MIT — voir [LICENSE](./LICENSE).

Ce projet dérive de [hrueger/reaper2ma](https://github.com/hrueger/reaper2ma), publié sous licence MIT par Hannes Rüger, et a depuis été largement réécrit.
