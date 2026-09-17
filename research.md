# Reaper2MA Research Report

Last updated: 2026-08-17

## Executive summary

Reaper2MA is a React 19 + TypeScript + Vite static SPA that converts REAPER marker/region CSV exports into grandMA3 macro and command-driven timecode XML. Everything runs locally in the browser. There is no backend, authentication, or network upload.

The application now has two product layers:

1. A versioned local project library backed by IndexedDB.
2. A typed conversion library in `src/lib/reaper2ma/`, kept independent from React.

The primary UI is a conversational wizard. It analyzes a CSV before conversion, lets the user progressively reveal advanced grandMA3 settings, shows source/output previews, and downloads one ZIP. Configured projects reopen in a summary view instead of restarting the wizard.

Production remains a static site under `/reaper2ma/`, with output in `build/`. pnpm is the only supported package manager, including GitHub Actions.

Navigation uses React Router with hash-based URLs. Project summaries live at `#/projects/:id`, wizard stages at `#/projects/:id/setup/:stage`, and the permanent marker guide at `#/help`, so refreshing or reopening a bookmarked screen works on static GitHub Pages without server-side rewrite rules.

## Repository map

- `index.html` and `src/main.tsx`: Vite HTML entry and React root.
- `src/App.tsx`: project-library orchestration, navigation, imports, downloads and persistence coordination.
- `src/i18n.tsx`: French/English UI copy plus language/theme preferences.
- `src/styles.css`: system-font design system, light/dark themes and responsive layouts.
- `src/components/ProjectLibrary.tsx`: search, status filters, sorting and project cards.
- `src/components/CreateProject.tsx`: zero-project and new-project entry screen.
- `src/components/HelpPage.tsx`: permanent bilingual reference for marker tags, region actions, releases, cue timing and pre-roll behavior.
- `src/components/ProjectWizard.tsx`: typed reducer and guided conversion flow.
- `src/components/ProjectOverview.tsx`: configured-project summary and revision restore UI.
- `src/components/RegionBrowser.tsx`: desktop region grid, mobile accordions and virtualized marker lists.
- `src/components/TimelineModal.tsx`: resizable two-view canvas timeline.
- `src/lib/projects/`: versioned project models, IndexedDB repository, quotas, project files and runtime exports.
- `src/lib/reaper2ma/`: parser, analysis, conversion, previews, timeline model, XML emitters and ZIP generation.
- `tests/reaper2ma.test.ts`: Node fixture tests for converter compatibility.
- `tests/projects.ui.test.ts`: IndexedDB, quota, import/export and revision tests.
- `tests/timeline.test.tsx`: DOM tests for timeline controls and Pointer Events.
- `reaper/`: the standalone REAPER Lua visualizer.

## Runtime and build

Current stack:

- React 19 and React DOM 19.
- React Router 7 with `HashRouter` for static-host-compatible project and wizard URLs.
- Vite 7 with `@vitejs/plugin-react`.
- TypeScript 5 in strict mode.
- Vitest + Testing Library + jsdom for UI/storage tests.
- Native IndexedDB; `fake-indexeddb` is test-only.
- `@vanillaes/csv` for CSV parsing.
- `fast-xml-parser` for XML construction.

Commands:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm check
pnpm build
```

`pnpm test` runs the historical Node conversion suite followed by Vitest. `pnpm check` is `tsc --noEmit`. Production builds use base `/reaper2ma/` and write `build/`; development uses `/`.

The GitHub workflow runs install, tests, TypeScript and build on pull requests and main pushes. Only successful main pushes upload and deploy the Pages artifact.

## User flow

Startup is based on IndexedDB state:

- No projects: show the project-name question immediately, with project import and the tag guide as secondary actions.
- Existing projects: show a searchable grid, with `draft`/`configured` filters and updated/created/name/duration sorts.

Project cards expose project and timecode names, CSV metadata, source duration, marker/region totals, dates, duplication, JSON export and confirmed deletion. Duplication proposes V2, then increments existing V suffixes (V2 → V3). The timecode name is copied without being silently renamed.

The wizard stages are:

1. CSV source.
2. Progressive validation and analysis.
3. Cue and region-layer behavior.
4. Sequence IDs, the global name prefix, an optional repeat/bump identifier, Appearance ID and Speed Master.
5. Cues-only or cues-and-timecode output, with separate Timecode object number, signed native offset and incoming `TCSlot`.
6. Optional executor assignments with a complete sequence-to-executor preview and either continuous placement or one REAPER region per grandMA3 page.
7. Show Time, Timecode Control and REAPER OSC extras.
8. Final diagnostics, exact generated-sequence count, duration in seconds and `H:i:s`, editable timecode name, file list, timeline, ZIP download and a complete effective-settings summary. The summary explicitly distinguishes the Timecode object number, incoming `TCSlot`, derived internal slot, executor activation/layout/addresses and every optional macro setting.

The project name and timecode name start with the same value. They are edited independently from the configured-project overview. Each completed stage is autosaved and checkpointed.

The Help control in the global header opens `#/help` from the library, first-project question, wizard, or configured-project summary. Returning from help restores the route that opened it. The CSV source step links directly to the export tutorial while preserving the project route for return. The guide is also directly bookmarkable and covers the native REAPER export flow, the required decimal-seconds format, a valid/invalid CSV check, native timeline-order renumbering, optional SWS/ReaPack workflows, and supported marker syntax: color routing, `[GLOBAL]`/`[MAIN]`, explicit regions and layers, grandMA3 execution tokens, Temp/Flash and paired or timed releases, ON/OFF actions, BPM/CueFade/axis timing, Cue Parts, and the exact effects of region/layer pre-roll settings.

## Project persistence

`ProjectRepository` is the boundary for local persistence and a future remote implementation. `IndexedDbProjectRepository` uses database `reaper2ma-projects` and three stores:

- `projects`: one current `ProjectDocumentV1` per project.
- `sources`: immutable `ProjectSourceV1` CSV documents.
- `revisions`: `ProjectRevisionV1` snapshots indexed by project ID.

The main types are:

- `ProjectDocumentV1`: identity, status, dates, source reference, analysis summary, settings and wizard progress.
- `ProjectSourceV1`: CSV filename/text, import date, byte size and SHA-256.
- `ProjectRevisionV1`: names/settings/progression snapshot plus source reference.
- `ProjectExportV1`: current document, referenced sources and revision history.

Only source CSV, metadata, settings, analysis summaries and progress are stored. XML, ZIP, detailed analysis and timeline data are recalculated.

Revision rules:

- Keep the current document plus the 10 newest revisions.
- Checkpoint completed stages, CSV replacement, restore and ZIP export.
- Restore checkpoints the current state before applying the selected snapshot.
- Pruning revisions also prunes CSV sources that are no longer referenced.

Project JSON validation checks document, settings, source, revision and reference shapes. Identifier collision is an explicit replace-or-copy choice. Replace is one IndexedDB transaction, so a quota/transaction failure does not first destroy the old project.

Quota policy uses `navigator.storage.estimate()`:

- Warning at 80%.
- Prevent a new source/import/duplicate estimated to reach 95%.
- Translate `QuotaExceededError` into `ProjectStorageQuotaError`.
- Never automatically delete projects.

Legacy `reaper2ma:settings:v1` values initialize the first new project. UI language and theme remain in the separate `reaper2ma:ui:v1` localStorage preference because they are not project data.

## CSV analysis

`analyzeReaperCsv()` is the synchronous API. `analyzeReaperCsvProgressively()` is the wizard API and yields between real validation, region detection, marker grouping and preview preparation.

Analysis returns:

- row, marker and real-region counts;
- source duration;
- real regions and their assigned markers;
- markers outside regions;
- recommended import mode;
- legacy English warnings and structured `ConversionDiagnostic` entries.

Markers are assigned to the innermost containing region unless an explicit region target applies. Markers with global/bump semantics retain the conversion behavior defined by the region services. If no real region exists, analysis creates one synthetic visual `Default` group and recommends `markers-only`; the converter never receives a fake region. With real regions, outside markers appear in `Global / Outside regions`.

Required headers are `#`, `Name` and `Start`. `Color` is optional. Start/end values are seconds and are not converted from beats, frames or musical time.

The in-app export tutorial makes that final constraint explicit: set REAPER's ruler time unit to `Seconds` before using Region/Marker Manager → Export regions/markers. It shows `12.500` as compatible and rejects instructional examples such as `0:12.500`, `1.1.00`, and frame timecode. REAPER's native `Renumber in timeline order` is the recommended preparation step; SWS marker/region renumber actions and ReaPack scripts are documented as optional workflow automation, never as conversion dependencies.

## Conversion API and identity

`convertReaperCsvToArtifacts()` has two supported signatures:

```ts
convertReaperCsvToArtifacts(csvText, sourceFileName, settings)
convertReaperCsvToArtifacts({ csvText, sourceFileName, settings, identity })
```

The historical three-argument signature and its aggressive filename normalizer stay unchanged for compatibility.

The structured request separates identity:

- `projectName` creates the output slug and ZIP/XML filenames.
- `timecodeName` creates grandMA3 object names, labels and macro references.
- `sourceFileName` remains metadata and fallback context only.

The new slugger keeps digits and version suffixes and removes diacritics: `Traversée V2` becomes `traversee-v2`. grandMA object names preserve Unicode but remove quotes, control characters and unsafe newlines.

## Conversion invariants

Preserve these rules unless a requested change explicitly changes conversion semantics:

- Empty/missing `Color` is a normal cue in the main sequence.
- Non-empty colors create repeated/effect sequences grouped by exact color string.
- The first marker name in a color group names that repeated sequence.
- Repeated sequences start after the main/region/layer sequence range.
- `Temp` and `Flash` create bump overlays grouped by color, cue and region context.
- Main cue numbering starts at `cueStartNumber`.
- Every generated sequence receives the configured Speed Master.
- `prefix` remains the schema-compatible secondary identifier for colored repeat and bump names. New projects store an empty string and show simple names such as `MA Drop`; enabling the option reveals a custom identifier such as `FX` and produces `MA FX - Drop`. Existing projects retain literal values such as the historical `1`, so their XML is unchanged.
- Macro XML is always generated; command-driven timecode is added only in `cues-and-timecode` mode.
- `timecodeOffsetMs` is an optional signed millisecond value with an effective default of zero and a range of ±`255:59:58.960`. New projects persist zero; schema-v1 projects and revisions without the field remain valid.
- A non-zero offset is emitted immediately after the Timecode object move as `Set Timecode {number} Property "Offset" "{decimal seconds}"`. Zero and cues-only exports omit this line, preserving historical XML byte-for-byte.
- The offset changes only the grandMA3 Timecode object's relationship to incoming LTC. Source timestamps, calculated events, duration, pre-rolls, releases, OffCue behavior and TCSlot-switching macros remain unchanged.
- The converter uses source seconds directly.
- Existing execution, BPM, CueFade, timing, Cue Part, region action and layer action tags remain supported.
- Region sequences include start/end boundaries and configured end pre-roll behavior.
- Region layers retain optional Layer Pre-Roll and automatic/manual Off behavior.
- Distinct readable colors generate distinct grandMA3 appearances from the configured Appearance Start ID.
- Executor assignment remains optional, with separate main and bump start slots. The default continuous layout preserves historical XML. The optional region-per-page layout places the first region on `pageNumber`, advances one page per later region, and resets both slot counters on each page; global sequences remain on the first page.

The macro generator still uses a temporary DataPool, creates/cooks local objects, then moves them into the requested final ranges. XML structure remains guarded by fixture tests. Top-level macro GUIDs remain static and are still a known risk.

## Extra macros and slot semantics

Project extras preserve all existing REAPER options:

- OSC Slot ID.
- OSC Data Name.
- Macro Name Prefix.
- Output File Name.

Timecode source settings are separate from the Timecode object number, its native offset and the REAPER OSC slot:

- `grandmaVersion: "pre-2.4" | "2.4+"`.
- `externalTimecodeSlot`, positive integer, default 1.
- Derived internal slot: `-2` before 2.4, `-1` for 2.4+.

Show Time manual and every INT switching/rewind macro use the derived internal slot. Show Time auto restore and every LTC macro use the selected external slot. New projects default to grandMA3 2.4+; the old helper API keeps its pre-2.4 default so historical output remains stable.

The Output step accepts signed `HH:MM:SS` and `HH:MM:SS.mmm` values. It keeps incomplete text local, blocks navigation on malformed or out-of-range input, autosaves only valid values and warns without blocking when a negative offset places calculated events before zero. The complete settings summary and project overview show the effective offset. Timeline canvases remain on relative coordinates; their header shows the offset and output-event hover details show both relative time and effective incoming LTC.

grandMA3 2.4 documents Offset as a native Timecode property and describes the one-hour project-offset use case: [Timecode settings](https://help2.malighting.com/grandMA3/2.4/HTML/timecode_settings.html), [Timecode keyword](https://help2.malighting.com/grandMA3/2.4/HTML/keyword_timecode.html).

## Region browser and timeline

Desktop renders a compact region grid and mounts one marker detail panel. Mobile renders accordion rows. Marker lists over 100 items use windowed rendering, and closed regions do not mount their marker list.

Double-clicking a region card opens the timeline scoped to that region. Double-clicking a marker row additionally centers a focused viewport on that marker, announces its name/time in the modal, and animates a short map-pin-style bounce and halo on the canvas. Reduced-motion preferences keep the steady highlight but skip the bounce. The explicit timeline action remains available for keyboard and touch users.

Opening the timeline from the region browser carries the selected region ID. Source view then mounts only that region; output view keeps only the selected region's tracks plus global tracks/events that occur inside the same time window. Opening the timeline from the project-level action still shows the complete project.

The full-screen timeline has two models:

- Source REAPER: analyzed regions and markers.
- grandMA3 output: calculated sequence tracks and events with current settings.

The canvas is resized with `ResizeObserver`. It supports:

- pointer-centered Ctrl/Meta wheel zoom (including macOS trackpad pinch), captured by a native non-passive listener so Chrome does not zoom the page at the same time;
- horizontal wheel/pan;
- mouse or pointer dragging;
- two-pointer touch pinch;
- minus, fit and plus controls;
- lane legend, labels and hover/touch details.

There are no play, pause, rewind, bump pads, metronome or search simulation controls. The DOM region/marker browser remains the accessible inspection path.

## UI system and accessibility

The interface uses system fonts, restrained translucent surfaces, large conversational questions and progressive disclosure for expert fields. Stage changes fade out/in with short eased motion, modals animate in both directions, and conditional settings reveal without abrupt layout jumps. Field-level explanations are exposed through keyboard- and touch-accessible help tooltips so the form stays compact; cue guidance names the affected grandMA3 object and gives concrete timecode examples. Sequence prefixes show examples generated from the current CSV. The global help route provides a longer keyboard-accessible reference without overloading wizard questions. CSS variables support explicit light/dark themes and the system preference. `document.documentElement.lang` updates with the selected locale.

Interactive cards are buttons, form fields have labels, diagnostics use status/alert roles, the timeline is an ARIA modal, Escape closes it, focus begins on its close control and returns to the previous element. Mobile layouts collapse grids and switch the region browser to accordions. Reduced-motion preferences disable nonessential transitions.

## Validation status and watchpoints

Validated locally on 2026-08-17:

- `pnpm test`: 92 conversion tests plus 33 Vitest project/wizard/timeline/routing tests pass.
- `pnpm check`: passes.
- `pnpm build`: passes and creates the static `build/` bundle.

The browser-control runtime was not available during this change, so final visual QA relied on DOM interaction tests, CSS responsive review and the production build. Before a public release, manually smoke-test at least Safari/macOS trackpad, iOS touch pinch, a large CSV and actual grandMA3 2.4 import.

Known technical watchpoints:

- Top-level macro GUIDs are hardcoded.
- The app depends on browser IndexedDB and Storage APIs; private browsing policies differ by browser.
- Canvas rendering is optimized for many nearby markers, but very large real show files should still be profiled on older mobile hardware.
- Storage sync, Google account integration and DJ/metronome controls are intentionally deferred.
