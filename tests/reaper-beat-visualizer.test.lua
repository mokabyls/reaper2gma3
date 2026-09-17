REAPER2MA_BEAT_VISUALIZER_TEST_MODE = true

local visualizer = assert(dofile("reaper/Reaper2MA_Beat_Visualizer.lua"))
local config = visualizer.CONFIG

local assertions = 0

local function fail(message)
    error(message, 2)
end

local function assert_equal(actual, expected, message)
    assertions = assertions + 1
    if actual ~= expected then
        fail(string.format(
            "%s: expected %s, got %s",
            message,
            tostring(expected),
            tostring(actual)
        ))
    end
end

local function assert_true(value, message)
    assertions = assertions + 1
    if not value then
        fail(message)
    end
end

local function assert_near(actual, expected, tolerance, message)
    assertions = assertions + 1
    if math.abs(actual - expected) > tolerance then
        fail(string.format(
            "%s: expected %.6f, got %.6f",
            message,
            expected,
            actual
        ))
    end
end

local function assert_color(actual, expected, message)
    assert_near(actual[1], expected[1], 0.000001, message .. " (red)")
    assert_near(actual[2], expected[2], 0.000001, message .. " (green)")
    assert_near(actual[3], expected[3], 0.000001, message .. " (blue)")
end

local ten_markers = {}
for index = 1, 10 do
    ten_markers[index] = {
        position = index,
        name = "Beat " .. index,
        order = index,
    }
end

local ten_events = visualizer.build_beat_events(ten_markers, {}, 8)
assert_equal(#ten_events, 10, "ten marker timestamps produce ten events")
assert_equal(ten_events[1].tile_index, 1, "first marker uses tile one")
assert_equal(ten_events[8].tile_index, 8, "eighth marker uses tile eight")
assert_equal(ten_events[9].tile_index, 1, "ninth marker wraps to tile one")
assert_equal(ten_events[10].tile_index, 2, "tenth marker wraps to tile two")

local simultaneous_events = visualizer.build_beat_events({
    { position = 1, name = "Kick", order = 1 },
    { position = 1, name = "Flash", order = 2 },
    { position = 2, name = "Snare", order = 3 },
}, {}, 8)

assert_equal(#simultaneous_events, 2, "simultaneous markers count as one beat")
assert_equal(simultaneous_events[1].marker_count, 2, "group keeps marker count")
assert_equal(simultaneous_events[1].name, "Kick +1", "group label describes extra marker")
assert_equal(simultaneous_events[2].tile_index, 2, "next timestamp advances one tile")

local outer_color = { 0.1, 0.2, 0.3 }
local inner_color = { 0.4, 0.5, 0.6 }
local marker_color = { 0.8, 0.7, 0.2 }
local regions = {
    {
        start_position = 0,
        end_position = 20,
        color = outer_color,
    },
    {
        start_position = 5,
        end_position = 10,
        color = inner_color,
    },
}

local colored_events = visualizer.build_beat_events({
    { position = 6, name = "Marker color", color = marker_color, order = 1 },
    { position = 7, name = "Region color", order = 2 },
    { position = 30, name = "Fallback color", order = 3 },
}, regions, 8)

assert_color(colored_events[1].color, marker_color, "marker color takes priority")
assert_color(colored_events[2].color, inner_color, "innermost region color is inherited")
assert_color(
    colored_events[3].color,
    config.fallback_pulse_color,
    "marker outside colored regions uses fallback"
)

local tiles = visualizer.make_tiles(8)
local first_event = {
    color = { 1, 0.2, 0.1 },
    name = "First",
}

visualizer.activate_tile(tiles[1], first_event, 10)
local held_sample = visualizer.sample_tile(tiles[1], 10 + config.hold_seconds / 2)
assert_true(held_sample.active, "tile stays active during hold")
assert_color(held_sample.color, first_event.color, "hold uses full event color")
assert_near(held_sample.text_alpha, 1, 0.000001, "hold keeps text fully visible")

local fade_sample = visualizer.sample_tile(
    tiles[1],
    10 + config.hold_seconds + config.fade_seconds / 2
)
assert_true(fade_sample.active, "tile stays active during fade")
assert_true(
    fade_sample.color[1] < first_event.color[1]
        and fade_sample.color[1] > config.idle_tile_color[1],
    "fade interpolates toward idle color"
)

local second_event = {
    color = { 0.1, 0.8, 0.3 },
    name = "Second",
}
local retrigger_time = 10 + config.hold_seconds + config.fade_seconds / 2
visualizer.activate_tile(tiles[1], second_event, retrigger_time)
local retriggered_sample = visualizer.sample_tile(tiles[1], retrigger_time)
assert_color(retriggered_sample.color, second_event.color, "retrigger restarts at full color")
assert_equal(retriggered_sample.name, "Second", "retrigger replaces label")
assert_near(retriggered_sample.text_alpha, 1, 0.000001, "retrigger restores text opacity")

local idle_sample = visualizer.sample_tile(
    tiles[1],
    retrigger_time + config.hold_seconds + config.fade_seconds
)
assert_true(not idle_sample.active, "tile returns to idle after animation")
assert_equal(idle_sample.name, "", "idle tile clears marker name")
assert_color(idle_sample.color, config.idle_tile_color, "idle tile returns to neutral gray")

local crossed = visualizer.collect_crossed_events(ten_events, 3.2, 5.1)
assert_equal(#crossed, 2, "continuous playback collects crossed markers")
assert_equal(crossed[1].name, "Beat 4", "crossing starts after previous position")
assert_equal(crossed[2].name, "Beat 5", "crossing includes current position")

local ninth_landing = visualizer.find_landing_event(ten_events, 9.04, 0.075)
assert_true(ninth_landing ~= nil, "seek can resolve event near landing position")
assert_equal(ninth_landing.tile_index, 1, "ninth marker landing remains deterministic")

assert_true(
    visualizer.is_continuous_forward_motion(1, 1.02, 0.02, 1),
    "normal playback is continuous"
)
assert_true(
    not visualizer.is_continuous_forward_motion(1, 12, 0.02, 1),
    "large forward seek is not continuous playback"
)
assert_true(
    not visualizer.is_continuous_forward_motion(12, 1, 0.02, 1),
    "backward loop or seek is not continuous playback"
)

local landscape_columns, landscape_rows = visualizer.grid_dimensions(800, 400)
assert_equal(landscape_columns, 4, "landscape grid has four columns")
assert_equal(landscape_rows, 2, "landscape grid has two rows")

local portrait_columns, portrait_rows = visualizer.grid_dimensions(400, 800)
assert_equal(portrait_columns, 2, "portrait grid has two columns")
assert_equal(portrait_rows, 4, "portrait grid has four rows")

local function measure_characters(text)
    return utf8.len(text) or #text
end

local wrapped_lines, wrapped_truncated = visualizer.wrap_text(
    "Part 3 Part C Magic Lift End Final Rise",
    16,
    3,
    measure_characters
)
assert_equal(#wrapped_lines, 3, "long marker name wraps onto three lines")
assert_true(not wrapped_truncated, "three fitting lines do not use ellipsis")
assert_equal(wrapped_lines[1], "Part 3 Part C", "first wrapped line keeps whole words")
assert_equal(wrapped_lines[2], "Magic Lift End", "second wrapped line keeps whole words")
assert_equal(wrapped_lines[3], "Final Rise", "third wrapped line keeps remaining words")

local ellipsis_lines, ellipsis_truncated = visualizer.wrap_text(
    "abcdefgh ijklmnop qrstuvwx yz012345 more",
    10,
    3,
    measure_characters
)
assert_equal(#ellipsis_lines, 3, "overflowing marker name stays within three lines")
assert_true(ellipsis_truncated, "overflowing marker name reports truncation")
assert_true(
    string.sub(ellipsis_lines[3], -3) == "...",
    "overflowing third line ends with ellipsis"
)
for _, line in ipairs(ellipsis_lines) do
    assert_true(measure_characters(line) <= 10, "wrapped line respects maximum width")
end

local unicode_lines = visualizer.wrap_text(
    "Départ très éloigné derrière",
    10,
    3,
    measure_characters
)
for _, line in ipairs(unicode_lines) do
    assert_true(utf8.len(line) ~= nil, "wrapping preserves valid UTF-8")
end

REAPER2MA_BEAT_VISUALIZER_TEST_MODE = nil

local exit_callback = nil
local toggles = {}
local fake_project = {}
local drawn_strings = {}

reaper = {
    ColorFromNative = function()
        return 255, 64, 32
    end,
    CountProjectMarkers = function(project)
        assert_equal(project, fake_project, "runtime enumerates the active project")
        return 2, 1, 1
    end,
    EnumProjectMarkers3 = function(project, index)
        assert_equal(project, fake_project, "runtime marker enumeration keeps project context")

        if index == 0 then
            return 1, true, 0, 10, "Section", 1, 0x10000FF
        end

        return 1, false, 1, 1, "Part 3 Part C Magic Lift End Final Rise", 2, 0
    end,
    EnumProjects = function(index)
        assert_equal(index, -1, "runtime requests the current project")
        return fake_project
    end,
    GetProjectStateChangeCount = function(project)
        assert_equal(project, fake_project, "runtime watches project changes")
        return 1
    end,
    GetPlayStateEx = function(project)
        assert_equal(project, fake_project, "runtime reads project play state")
        return 1
    end,
    GetPlayPositionEx = function(project)
        assert_equal(project, fake_project, "runtime reads project play position")
        return 1.01
    end,
    Master_GetPlayRate = function()
        return 1
    end,
    SetToggleCommandState = function(section_id, command_id, enabled)
        toggles[#toggles + 1] = {
            section_id = section_id,
            command_id = command_id,
            enabled = enabled,
        }
    end,
    RefreshToolbar2 = function()
    end,
    get_action_context = function()
        return true, "script.lua", 0, 123, 0, 0, 0
    end,
    atexit = function(callback)
        exit_callback = callback
    end,
    defer = function()
        fail("closed gfx window must not schedule another frame")
    end,
    time_precise = function()
        return 100
    end,
}

gfx = {
    w = 760,
    h = 420,
    mouse_cap = 0,
    mouse_x = 0,
    mouse_y = 0,
    x = 0,
    y = 0,
    init = function(_, width, height)
        gfx.w = width
        gfx.h = height
    end,
    set = function()
    end,
    rect = function(_, _, _, _, filled)
        assert_equal(filled, 1, "runtime requests filled rectangles numerically")
    end,
    circle = function(_, _, _, filled, antialias)
        assert_equal(filled, 1, "runtime requests filled circles numerically")
        assert_equal(antialias, 1, "runtime requests antialiased circles numerically")
    end,
    roundrect = function(_, _, _, _, _, antialias)
        assert_equal(antialias, 1, "runtime requests antialiased tile outlines numerically")
    end,
    setfont = function()
    end,
    measurestr = function(text)
        return #text * 8, 16
    end,
    drawstr = function(text)
        drawn_strings[#drawn_strings + 1] = text
    end,
    update = function()
    end,
    getchar = function()
        return -1
    end,
    dock = function()
        return 0
    end,
    showmenu = function()
        return 0
    end,
    quit = function()
    end,
}

dofile("reaper/Reaper2MA_Beat_Visualizer.lua")
assert_equal(toggles[1].enabled, 1, "runtime enables the action toggle")
assert_true(type(exit_callback) == "function", "runtime registers an exit callback")
assert_equal(#drawn_strings, 3, "runtime draws a long marker name on three lines")

exit_callback()
assert_equal(toggles[#toggles].enabled, 0, "runtime clears the action toggle on exit")

print(string.format("Beat visualizer tests passed (%d assertions)", assertions))
