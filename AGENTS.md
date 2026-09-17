# Agent Instructions

## Project purpose

Reaper2MA is a React + Vite static web app that converts Reaper marker CSV exports into grandMA3 macro and timecode XML files. It is intended for lighting/audio workflows where uncolored Reaper markers become a main grandMA3 cue stack, colored markers become repeated effect sequences, and `Temp` / `Flash` markers become bump overlays.

Read `research.md` before making non-trivial changes. It documents the current conversion semantics, build/deploy setup, risks, and validation results.

## Project skills

Use these repo-local skills when the task matches:

- `skills/reaper2ma-conversion` - Use for CSV parsing, marker naming, unique/repeated cue grouping, sequence/cue numbering, and grandMA3 XML generation.
- `skills/reaper2ma-frontend` - Use for React/Vite UI, styling, static behavior, assets, and deployment changes.

These skills live in `skills/` because this workspace does not allow writing to a project `.codex/` directory.

## Commands

Use pnpm for this repository:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm dev
```

Run `pnpm check` after TypeScript/React edits. Run `pnpm build` after changes that affect routing, Vite config, static deployment, assets, or dependencies.

Do not rely on the current GitHub Actions workflow as proof of package-manager intent: it uses `yarn`, while the repo has `pnpm-lock.yaml` and README instructions use pnpm.

## Architecture notes

- Main converter code is in `src/lib/reaper2ma/`; `src/App.tsx` and `src/components/` handle the UI and wire user input to the converter.
- Marker parsing and XML generation are split into smaller services and emitters behind `markers.ts` and `xml.ts` facades.
- There is no backend. File parsing and XML generation happen in the browser.
- Projects are stored in IndexedDB through `src/lib/projects/`; language and theme preferences alone use localStorage.
- Vite builds a static SPA. Production base path is `/reaper2ma`; development base path is `/`.
- Build output is `build/` and must not be committed.

## Conversion invariants

Preserve these unless the user explicitly asks to change conversion semantics:

- CSV headers are expected to include `#`, `Name`, `Start`, and `Color`.
- Empty `Color` means a normal cue in the main sequence.
- Non-empty `Color` means a repeated/effect sequence.
- Repeated sequences are grouped by exact color string.
- The first marker name in a color group names that repeated sequence.
- Repeated sequence numbers start at `sequenceNumber + 1`.
- `Temp` and `Flash` execution tokens route markers into bump overlay sequences, still grouped by color and cue name.
- Main cue numbers start at `cueStartNumber`.
- `Start` is treated as seconds and passed through without time conversion.
- Macro XML is always downloaded.
- Timecode XML is downloaded only in `cues-and-timecode` mode.
- Marker names may carry leading or trailing `[]` tags for `BPM`, `CueFade`, cue timing modifiers, or execution tokens.
- Supported execution tokens are `Go+`, `Go-`, `Goto`, `Load`, `On`, `Select`, `Top`, `Temp`, and `Flash`.
- Repeated, bump, and main cues may receive `CueFade` and cue timing modifiers in the macro XML.
- Cue timing families are handled by dedicated providers in the registry.
- Distinct Reaper colors should produce distinct grandMA3 appearances, with a configurable start ID in the UI.
- Every generated sequence receives the configured `Speed Master`.

Be careful with marker-name changes. Names are command-sensitive because they are embedded in grandMA3 command strings and object paths.

## Coding guidance

- Keep privacy local: do not introduce uploads or server-side processing unless requested.
- Prefer extracting conversion logic to `$lib` before adding larger behavior changes or tests.
- Add fixture-based tests before broad conversion refactors.
- Keep generated XML structure stable unless there is a grandMA3-specific reason to change it.
- Validate user-facing input paths with helpful UI state rather than only `console.error` or `alert`.
- Keep styles responsive and test mobile layout when changing the single-page UI.
- Update `research.md` when conversion semantics or XML generation behavior changes.

## Known watchpoints

- Top-level macro and timecode GUIDs are hardcoded.
- Browser IndexedDB and storage quota behavior differs in private browsing modes.
- Large canvas timelines should be profiled on older mobile hardware.

## Validation expectations

At minimum, report the result of:

```sh
pnpm check
pnpm build
```

If dependencies are missing, run `pnpm install --frozen-lockfile` first. If network access is blocked, say that validation could not proceed and include the exact failure.
