---
name: reaper2ma-conversion
description: Project-specific guidance for modifying, testing, or reviewing Reaper marker CSV parsing and grandMA3 macro command XML generation in reaper2ma. Use when working on CSV headers, marker colors, unique versus repeated cues, sequence and cue numbering, generated XML, command-driven timecode generation, conversion bugs, or GrandMA import behavior.
---

# Reaper2MA Conversion

## Overview

Use this skill to preserve the domain rules behind the converter. The important distinction is that uncolored Reaper markers become cues in one master sequence, colored markers become color-grouped repeated/effect sequences, and `Temp` / `Flash` markers become bump overlays. Marker parsing and macro command XML generation are now split into smaller services behind stable facades.

## First steps

1. Read `research.md`, especially the conversion, risks, and demo sections.
2. Inspect `src/lib/reaper2ma/*`; conversion logic now lives there, with the page component handling only UI.
3. Identify whether the change affects input parsing, grouping, macro command XML, command-driven timecode generation, or UI settings.
4. Preserve current behavior unless the user explicitly asks for a conversion semantics change.

## Current conversion rules

- Expect Reaper marker CSV headers: `#`, `Name`, and `Start`; `Color` is optional because REAPER omits it when no markers are colored.
- Treat `Start` as seconds; do not convert beats, frames, or timecode formats unless adding explicit support.
- Sanitize marker names with the existing allowlist before using them in grandMA3 command strings.
- Suffix duplicate marker names after sanitization: first occurrence unsuffixed, later occurrences numbered.
- Treat missing or empty `Color` as a normal cue in the base sequence.
- Treat non-empty `Color` as a repeated/effect marker.
- Group repeated/effect markers by exact color string in first-seen order.
- Name each repeated sequence from the first marker in that color group, prefixed as `{prefix} - {name}`.
- Allocate repeated sequence numbers from `sequenceNumber + 1`.
- In regions-and-markers mode, name generated region sequences from region ID plus sanitized region label, for example `R2 - Introduction - Sub Region`.
- In regions-and-markers mode, route `[LAYER=Name]` markers into region-scoped layer sequences attached to the containing or explicitly targeted region, for example `[R2][LAYER=Voix]`.
- In regions-and-markers mode, uncolored layer markers inherit the readable target region color lightened by 24%; use that derived color for the layer sequence, uncolored layer cues, `Layer Pre-Roll`, grandMA3 appearance, and timeline. Explicit layer marker colors remain authoritative and are not lightened.
- In regions-and-markers mode, route `[OFF_LAYER=Name]` and `[OFF_LAYERS]` into derived `Off` timecode events on region layer tracks. They use the containing region or an explicit `[R2]` target, and they do not affect `OFF_Rx`.
- Region layer pre-roll is enabled by default. It adds a `Layer Pre-Roll` cue/event at the beginning of each layer sequence before the first layer cue.
- Auto Off for region layers is enabled by default. It emits fallback derived `Off` events on layer tracks that have not already received a manual layer Off; with a following region, the fallback uses the next region start plus one second, otherwise the parent region end.
- Allow `[GLOBAL]` or `[MAIN]` markers to stay in the main sequence even when they fall inside a region.
- Route `Temp` and `Flash` execution tokens into bump overlay sequences, grouped by color and cue name.
- In regions-and-markers mode, non-global bump markers keep their region context while routing to bump overlays. If the context region has a readable color, group and display the bump with that region color lightened by 42%; explicit bump marker colors remain authoritative. Region-scoped bump grouping includes the region ID, and `[GLOBAL]` bumps remain global.
- Parse leading or trailing `[]` blocks for `BPM`, `CueFade`, cue timing modifiers, and execution tokens. Cue timing families should stay isolated in their own providers.
- Parse bump release tags as `Release_...`, `TempRelease`, and `FlashRelease`; use them to configure a timed `OffCue`, with a 0.2 second fallback when no release tag is present.
- Validate cue timing modifiers and emit them as grandMA3 `Set DataPool "{temp}" Sequence ... Cue ... Part 0.1 ...` commands.
- Create one grandMA3 appearance per distinct readable Reaper color, starting at the configured appearance ID. Derived layer and bump inherited colors are real distinct colors with their own appearance IDs.
- Convert appearance colors from decimal Reaper values, `0x...`, `#RRGGBB`, and six-digit hex values with A-F characters. Macro output uses grandMA background channels: `COLOR="1,1,1,0" BackR={0..255} BackG={0..255} BackB={0..255} BackAlpha=221`.
- Apply the configured `Speed Master` to every generated sequence.
- Always generate macro XML.
- In `cues-and-timecode` mode, generate timecode creation commands inside the macro XML. Do not emit a separate `GMA3.Timecode` XML file.

## XML constraints

- Keep the `GMA3` root. CSV conversion output is always macro XML using `DataVersion="1.4.0.2"`.
- Macro lines use `@_Command` and `@_Wait: "0.10"`.
- Build generated sequences in a deterministic temporary DataPool named `R2MA {filename}`.
- Use local temporary sequence numbers `1..N`, assign them to the configured page slots, then move them to the final sequence number range.
- Unique cue macro commands store a cue range in the local base sequence, label each cue, and then apply optional cue fade/timing commands.
- If the base sequence has no unique cues, skip base-sequence macro commands rather than emitting `Cue 1 thru 0`.
- Repeated sequence macro commands store a named local sequence, store cue ranges with `/Merge`, assign an appearance, and set OffCue `TRIGTYPE` to `Follow`.
- Region layer macro commands are stored immediately after their parent region sequence, optionally start with a `Layer Pre-Roll` cue/event, use effective layer appearances from marker or inherited region colors, and set OffCue `TRIGTYPE` to `Follow`.
- Bump macro commands follow the same storage/naming pattern as repeated sequences, use effective bump appearances from marker or inherited region colors, but configure a timed `OffCue` instead of emitting release timecode events. Region-scoped bumps are named from their region and placed in that region's timecode track group.
- Timecode commands use the CuePoints-style pattern: `Store DataPool "{temp}" Timecode 1`, `Store DataPool "{temp}" Timecode 1.{group}`, `Label DataPool "{temp}" Timecode 1.{group} "{groupName}"`, `Assign DataPool "{temp}" Sequence {local} At {track}`, `Store Type "CmdSubTrack" 1`, `Set {event} "TIME" "{Start}"`, `Set {event} "TOKEN" "{execToken}"`, and `Assign DataPool "{temp}" Sequence {local} Cue {cueNumber} At Timecode 1.{group}.{track}.1.1.{event}`.
- In regions-and-markers mode, create a `Global` track group only when global/main/repeated/BPM/global-bump material exists. Create one track group per region, containing the region main track, its layer tracks, and its non-global region-scoped bump tracks.
- `OFF_Rx` creates an `Off` event on the target region track without cue assignment and suppresses that region's automatic fallback Off. `ON_Rx` creates a `Goto|Go+` event assigned to the target region's actual `Region Start` cue.
- `[OFF_LAYER=Name]`, `[OFF_LAYERS]`, and automatic region-layer Off create `Off` events on layer tracks without cue assignment. Manual layer Off events suppress automatic fallback Off events for their resolved layer tracks. Do not model layer extinction as layer `Region End` cues.
- Do not generate a separate `GMA3.Timecode`, `RealtimeCmd`, `CueDestination`, `ValCueDestination`, grandMA internal numeric object/cue references, audio tracks, or fader subtracks from CSV-only input.
- Use `XMLBuilder` rather than manual string assembly unless there is a strong reason.

## Watchpoints

- Timecode duration is calculated from unique, region, region layer, repeated, bump, and BPM timestamps.
- Top-level macro GUID is hardcoded; changing this can affect import/update behavior.
- Filename normalization currently removes digits, spaces, uppercase extension artifacts, and non-ASCII characters.
- Sequence names are embedded in labels and command strings. Test grandMA3 import behavior before changing name formatting.

## Validation

Run:

```sh
pnpm check
pnpm build
```

For non-trivial conversion changes, prefer extracting logic into `$lib/conversion.ts` and adding fixture tests before refactoring deeply.
