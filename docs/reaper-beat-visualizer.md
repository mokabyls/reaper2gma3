# REAPER beat visualizer

The beat visualizer is a standalone Lua ReaScript that turns project markers
into a fixed eight-pad visual chase. It does not upload data, modify the
project, or depend on ReaPack, SWS, or ReaImGui.

## Install

1. In REAPER, choose **Options > Show REAPER resource path in
   explorer/finder**.
2. Copy
   `reaper/Reaper2MA_Beat_Visualizer.lua` into the resource directory's
   `Scripts` folder. A `Scripts/Reaper2MA` subfolder is fine.
3. Open **Actions > Show action list**.
4. Choose **ReaScript: Load...** and select the copied Lua file.
5. Run the new **Reaper2MA: Beat Visualizer** action.

The script can also be loaded directly from a checkout of this repository.
Close its window, or invoke the running action again, to stop it. Right-click
inside the visualizer to dock or undock its window.

## Behavior

- Project markers are sorted chronologically and assigned to pads 1 through
  8. The ninth marker reuses pad 1, the tenth reuses pad 2, and so on.
- Markers at the exact same timestamp count as one beat.
- A custom marker color wins. Otherwise, the marker inherits the color of the
  most deeply nested colored region containing it. Markers without either use
  a neutral light pulse color.
- A triggered pad holds its color for 80 ms, fades back to gray over 220 ms,
  and hides its marker name. Triggering the same pad again immediately
  restarts the animation with the new marker color and name.
- Marker names use the largest font size that fits on up to three centered
  lines. The font can shrink to 8 px; text that still does not fit ends with an
  ellipsis on the third line.
- The grid uses four columns by two rows in a landscape window and two columns
  by four rows in a portrait window.
- Playback and recording trigger beats. Stopped playback and manual scrubbing
  do not.
- Loops re-arm the markers. Large seeks skip all intermediate markers while
  preserving the marker-to-pad assignment at the destination.
- Marker and region edits are detected while the visualizer is open.

Regions only supply fallback colors; crossing a region boundary does not
trigger a beat.

## Development checks

From the repository root:

```sh
luac -p reaper/Reaper2MA_Beat_Visualizer.lua
lua tests/reaper-beat-visualizer.test.lua
pnpm check
pnpm build
```
