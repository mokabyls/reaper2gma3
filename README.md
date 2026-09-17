# Reaper2MA

**→ [Open the app](https://mokabyls.github.io/reaper2gma3/)** — no install, no account, free.

Reaper2MA turns a REAPER marker and region CSV export into grandMA3 XML macros, locally. It is a React SPA: no CSV is ever sent to a server.

## What it does

- Local project library with search, filters, sorting, V2/V3 duplication, and JSON import/export.
- Guided wizard to analyse the CSV, pick the region mode, and configure cues, sequences, timecode, executors and extra macros.
- Compact region and marker preview, with virtualisation for long lists.
- `REAPER source` / `grandMA3 output` canvas timeline, framed on the selected region or the whole project, zoomable and pannable with mouse, trackpad or touch.
- Final review and download of a ZIP holding the main macro and the selected extras.
- Always-available help: REAPER export tutorial in seconds, CSV check, tag reference, and optional renumbering tools.
- French/English interface, system, light or dark theme.

## Preparing the REAPER CSV

Reaper2MA expects `Start`, `End` and `Length` in decimal seconds (`12.500`) — not timecode, not bars/beats, not minutes:seconds.

1. Right-click the REAPER ruler, then `Time unit for ruler` → `Seconds`.
2. Open `View` → `Region/Marker Manager` and enable `Markers`, plus `Regions` if needed.
3. Sort by the `Start` column, then choose `Renumber in timeline order` from the context menu (recommended).
4. Choose `Export regions/markers…` and save as CSV.

The full tutorial, with valid and invalid examples plus SWS/ReaPack options, is available under `Help` or straight from the CSV import step.

## Storage and privacy

Projects live in IndexedDB. A project stores the source CSV, its names, settings, progress and the last ten revisions; the XML, the ZIP and the timeline are recomputed on demand.

The app watches the quota reported by `navigator.storage.estimate()`: it warns at 80%, pre-emptively refuses an import that would reach 95%, and never deletes a project on its own. A `.reaper2ma.json` export contains the project, its referenced sources and its history.

Legacy `reaper2ma:settings:v1` settings are still read as the starting values of a first project. Language and theme use a separate local preference.

## grandMA3 conversion

- Uncoloured markers become the cues of the main sequence.
- Coloured markers are grouped by exact colour into repeated sequences.
- `Temp` and `Flash` markers become bump sequences.
- Region mode creates region sequences, layers, pre-rolls and the configured Off events.
- Existing tags (`BPM`, `CueFade`, cue timing, parts, region/layer actions) remain supported.
- Every sequence receives the chosen Speed Master.
- The secondary identifier on repeats and bumps is optional and off by default. Turning it on yields `MA FX - Drop` instead of the plain `MA Drop`; it affects neither timing nor numbering. Existing projects keep their own value, including the historical `1`.
- Sequence numbers and executor addresses follow the configured ranges, and either can be pinned per sequence in the advanced settings. A pinned address is reserved: automatically placed sequences pack around it.
- The project name drives the file slug (`Autumn Tour V2` → `autumn-tour-v2_macro.xml`).
- The timecode name, editable independently, drives the grandMA3 names and references.
- The signed Timecode offset (`HH:MM:SS.mmm`) syncs a REAPER project that starts at zero with an incoming LTC starting at, say, `01:00:00`. It is applied natively to the grandMA3 object without shifting events, pre-rolls or durations.
- For extra macros, the INT slot is `-2` before grandMA3 2.4 and `-1` from 2.4 onwards. LTC modes and automatic restore use the chosen external slot.

`Timecode Number`, `Offset`, the source `TCSlot` (picked in the Output step) and the REAPER `OSC Slot ID` stay separate settings. An event relative to `00:01:00` with a `+01:00:00.000` offset therefore answers incoming LTC `01:01:00`. The offset accepts values from `-255:59:58.960` to `+255:59:58.960`; at zero, or in `Cues only` mode, no extra command is generated. See the [grandMA3 Timecode documentation](https://help2.malighting.com/grandMA3/2.4/HTML/timecode_settings.html) and the [Timecode keyword syntax](https://help2.malighting.com/grandMA3/2.4/HTML/keyword_timecode.html).

## Development

Requires Node.js 24 and pnpm 10.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Full validation:

```sh
pnpm test
pnpm check
pnpm build
```

The static build is written to `build/`. In production Vite uses the `/reaper2gma3/` base path for GitHub Pages.

`pnpm test` runs both suites: the conversion tests under Node, and the React tests under Vitest. Macro output is additionally locked by `tests/fixtures/macro-profiles.json`, which pins the full command list for ten settings profiles — any drift shows up as a diff. To accept an intended change, run `UPDATE_MACRO_PROFILES=1 pnpm test:core` and review the fixture before committing it.

## Architecture

- `src/App.tsx` — library orchestration, import/export and navigation.
- `src/components/ProjectWizard.tsx` — reducer and steps of the guided flow.
- `src/components/ProjectLibrary.tsx` and `ProjectOverview.tsx` — library and summary of a configured project.
- `src/components/RegionBrowser.tsx` and `TimelineModal.tsx` — accessible inspection and canvas.
- `src/lib/projects/` — versioned models, IndexedDB repository, quotas, history and runtime.
- `src/lib/reaper2ma/` — CSV analysis, conversion and grandMA3 generation.
- `tests/reaper2ma.test.ts` — conversion compatibility tests.
- `tests/macro-profiles.test.ts` — golden-file coverage of macro generation per settings profile.
- `tests/projects.ui.test.ts`, `tests/wizard.test.tsx`, `tests/routing.test.tsx`, `tests/region-browser.test.tsx`, `tests/timeline.test.tsx` — storage and React interactions.
- `tests/*.lua` — the companion REAPER and grandMA3 plugins.

## Companion tools

The repository also holds:

- a REAPER transport macro library over OSC, documented in [docs/grandma3-reaper-osc.md](./docs/grandma3-reaper-osc.md);
- the grandMA3 bump-to-main plugin, documented in [docs/grandma3-bump-to-main.md](./docs/grandma3-bump-to-main.md);
- the standalone REAPER beat visualiser, documented in [docs/reaper-beat-visualizer.md](./docs/reaper-beat-visualizer.md).

Google sync and the DJ/metronome controls are not part of this version.

## Licence

MIT — see [LICENSE](./LICENSE).

This project derives from [hrueger/reaper2ma](https://github.com/hrueger/reaper2ma), released under the MIT licence by Hannes Rüger, and has been largely rewritten since.
