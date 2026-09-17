-- @description Reaper2MA: Beat Visualizer
-- @version 1.1.0
-- @author Reaper2MA contributors
-- @about
--   Displays project markers as an eight-pad visual chase.
--   Marker colors take priority over the innermost containing region color.
--   Requires only REAPER's built-in Lua and gfx APIs.
-- @license MIT

local BeatVisualizer = {}

local CONFIG = {
    title = "Reaper2MA - Beat Visualizer",
    tile_count = 8,
    window_width = 760,
    window_height = 420,
    hold_seconds = 0.080,
    fade_seconds = 0.220,
    landing_tolerance_seconds = 0.075,
    timestamp_epsilon = 0.000000001,
    seek_minimum_seconds = 0.250,
    seek_margin_seconds = 0.050,
    seek_expected_factor = 3.0,
    max_font_size = 20,
    min_font_size = 8,
    max_text_lines = 3,
    background_color = { 0.055, 0.063, 0.078 },
    idle_tile_color = { 0.185, 0.200, 0.225 },
    fallback_pulse_color = { 0.760, 0.790, 0.850 },
}

BeatVisualizer.CONFIG = CONFIG

local function clamp(value, minimum, maximum)
    return math.max(minimum, math.min(maximum, value))
end

local function copy_color(color)
    return { color[1], color[2], color[3] }
end

local function is_color(color)
    return type(color) == "table"
        and type(color[1]) == "number"
        and type(color[2]) == "number"
        and type(color[3]) == "number"
end

local function lerp(from, to, amount)
    return from + (to - from) * amount
end

local function lerp_color(from, to, amount)
    return {
        lerp(from[1], to[1], amount),
        lerp(from[2], to[2], amount),
        lerp(from[3], to[3], amount),
    }
end

local function smoothstep(value)
    local normalized = clamp(value, 0, 1)
    return normalized * normalized * (3 - 2 * normalized)
end

local function utf8_character_count(text)
    if utf8 and utf8.len then
        return utf8.len(text) or #text
    end

    return #text
end

local function utf8_prefix(text, character_count)
    if character_count <= 0 then
        return ""
    end

    if utf8 and utf8.offset and utf8.len then
        local total_characters = utf8.len(text)
        if total_characters and character_count >= total_characters then
            return text
        end

        local next_character = utf8.offset(text, character_count + 1)
        if next_character then
            return string.sub(text, 1, next_character - 1)
        end
    end

    return string.sub(text, 1, character_count)
end

local function prefix_that_fits(text, maximum_width, measure_width, suffix)
    local appended_suffix = suffix or ""
    local suffix_width = measure_width(appended_suffix)

    if suffix_width > maximum_width then
        return ""
    end

    local low = 0
    local high = utf8_character_count(text)
    local best = ""

    while low <= high do
        local middle = math.floor((low + high) / 2)
        local candidate = utf8_prefix(text, middle)

        if measure_width(candidate) + suffix_width <= maximum_width then
            best = candidate
            low = middle + 1
        else
            high = middle - 1
        end
    end

    return best
end

local function append_wrapped_word(lines, word, maximum_width, measure_width)
    local current_line = lines[#lines]
    local candidate = current_line and (current_line .. " " .. word) or word

    if measure_width(candidate) <= maximum_width then
        if current_line then
            lines[#lines] = candidate
        else
            lines[1] = candidate
        end
        return
    end

    if current_line then
        lines[#lines + 1] = ""
    elseif #lines == 0 then
        lines[1] = ""
    end

    local remaining_word = word

    while remaining_word ~= "" do
        local current = lines[#lines]
        local available_prefix = prefix_that_fits(
            remaining_word,
            maximum_width,
            measure_width
        )

        if available_prefix == "" then
            available_prefix = utf8_prefix(remaining_word, 1)
        end

        if current == "" then
            lines[#lines] = available_prefix
        else
            lines[#lines + 1] = available_prefix
        end

        remaining_word = string.sub(remaining_word, #available_prefix + 1)
        if remaining_word ~= "" then
            lines[#lines + 1] = ""
        end
    end
end

function BeatVisualizer.wrap_text(text, maximum_width, maximum_lines, measure_width)
    if text == "" or maximum_width <= 0 or maximum_lines <= 0 then
        return {}, text ~= ""
    end

    local lines = {}

    for word in string.gmatch(text, "%S+") do
        append_wrapped_word(lines, word, maximum_width, measure_width)
    end

    if #lines == 0 then
        return {}, false
    end

    local truncated = #lines > maximum_lines
    while #lines > maximum_lines do
        table.remove(lines)
    end

    if truncated then
        local ellipsis = "..."
        local last_line = lines[#lines] or ""
        lines[#lines] = prefix_that_fits(
            last_line,
            maximum_width,
            measure_width,
            ellipsis
        ) .. ellipsis
    end

    return lines, truncated
end

local function compare_markers(left, right)
    if left.position ~= right.position then
        return left.position < right.position
    end

    return left.order < right.order
end

local function region_contains_position(region, position)
    return position >= region.start_position and position < region.end_position
end

function BeatVisualizer.resolve_marker_color(marker, regions, fallback_color)
    if is_color(marker.color) then
        return copy_color(marker.color)
    end

    local best_region = nil
    local best_duration = math.huge

    for _, region in ipairs(regions) do
        if is_color(region.color) and region_contains_position(region, marker.position) then
            local duration = math.max(0, region.end_position - region.start_position)
            local is_more_specific = duration < best_duration
            local is_later_equal_region = best_region
                and duration == best_duration
                and region.start_position > best_region.start_position

            if is_more_specific or is_later_equal_region then
                best_region = region
                best_duration = duration
            end
        end
    end

    if best_region then
        return copy_color(best_region.color)
    end

    return copy_color(fallback_color or CONFIG.fallback_pulse_color)
end

local function marker_copy(marker, order)
    return {
        position = tonumber(marker.position) or 0,
        name = type(marker.name) == "string" and marker.name or "",
        color = is_color(marker.color) and copy_color(marker.color) or nil,
        order = tonumber(marker.order) or order,
    }
end

function BeatVisualizer.build_beat_events(markers, regions, tile_count)
    local sorted_markers = {}
    local assigned_tile_count = tile_count or CONFIG.tile_count

    for index, marker in ipairs(markers) do
        sorted_markers[#sorted_markers + 1] = marker_copy(marker, index)
    end

    table.sort(sorted_markers, compare_markers)

    local grouped_markers = {}

    for _, marker in ipairs(sorted_markers) do
        local current_group = grouped_markers[#grouped_markers]

        if not current_group
            or math.abs(marker.position - current_group.position) > CONFIG.timestamp_epsilon
        then
            current_group = {
                position = marker.position,
                markers = {},
            }
            grouped_markers[#grouped_markers + 1] = current_group
        end

        current_group.markers[#current_group.markers + 1] = marker
    end

    local events = {}

    for event_index, group in ipairs(grouped_markers) do
        local first_name = ""
        local first_custom_color = nil

        for _, marker in ipairs(group.markers) do
            if first_name == "" and marker.name ~= "" then
                first_name = marker.name
            end

            if not first_custom_color and is_color(marker.color) then
                first_custom_color = marker.color
            end
        end

        local marker_count = #group.markers
        local label = first_name
        if label ~= "" and marker_count > 1 then
            label = string.format("%s +%d", label, marker_count - 1)
        end

        events[#events + 1] = {
            position = group.position,
            tile_index = ((event_index - 1) % assigned_tile_count) + 1,
            name = label,
            marker_count = marker_count,
            color = BeatVisualizer.resolve_marker_color({
                position = group.position,
                color = first_custom_color,
            }, regions, CONFIG.fallback_pulse_color),
        }
    end

    return events
end

function BeatVisualizer.make_tiles(tile_count)
    local tiles = {}

    for index = 1, tile_count or CONFIG.tile_count do
        tiles[index] = {
            activated_at = nil,
            color = copy_color(CONFIG.fallback_pulse_color),
            name = "",
        }
    end

    return tiles
end

function BeatVisualizer.activate_tile(tile, event, now)
    tile.activated_at = now
    tile.color = copy_color(event.color)
    tile.name = event.name or ""
end

function BeatVisualizer.sample_tile(tile, now)
    if not tile.activated_at then
        return {
            color = copy_color(CONFIG.idle_tile_color),
            text_alpha = 0,
            name = "",
            active = false,
        }
    end

    local elapsed = math.max(0, now - tile.activated_at)
    local total_duration = CONFIG.hold_seconds + CONFIG.fade_seconds

    if elapsed >= total_duration then
        tile.activated_at = nil
        tile.name = ""

        return {
            color = copy_color(CONFIG.idle_tile_color),
            text_alpha = 0,
            name = "",
            active = false,
        }
    end

    local strength = 1
    if elapsed > CONFIG.hold_seconds then
        local fade_progress = (elapsed - CONFIG.hold_seconds) / CONFIG.fade_seconds
        strength = 1 - smoothstep(fade_progress)
    end

    return {
        color = lerp_color(CONFIG.idle_tile_color, tile.color, strength),
        text_alpha = strength,
        name = tile.name,
        active = true,
    }
end

local function first_event_after(events, position)
    local low = 1
    local high = #events
    local result = #events + 1

    while low <= high do
        local middle = math.floor((low + high) / 2)
        if events[middle].position > position + CONFIG.timestamp_epsilon then
            result = middle
            high = middle - 1
        else
            low = middle + 1
        end
    end

    return result
end

function BeatVisualizer.collect_crossed_events(events, previous_position, current_position)
    if current_position + CONFIG.timestamp_epsilon < previous_position then
        return {}
    end

    local crossed = {}
    local event_index = first_event_after(events, previous_position)

    while event_index <= #events
        and events[event_index].position <= current_position + CONFIG.timestamp_epsilon
    do
        crossed[#crossed + 1] = events[event_index]
        event_index = event_index + 1
    end

    return crossed
end

function BeatVisualizer.find_landing_event(events, position, tolerance)
    local allowed_distance = tolerance or CONFIG.landing_tolerance_seconds
    local low = 1
    local high = #events
    local candidate = nil

    while low <= high do
        local middle = math.floor((low + high) / 2)
        if events[middle].position <= position + CONFIG.timestamp_epsilon then
            candidate = events[middle]
            low = middle + 1
        else
            high = middle - 1
        end
    end

    if candidate and candidate.position >= position - allowed_distance then
        return candidate
    end

    return nil
end

function BeatVisualizer.is_continuous_forward_motion(
    previous_position,
    current_position,
    elapsed_wall_time,
    play_rate
)
    local position_delta = current_position - previous_position
    if position_delta < -CONFIG.timestamp_epsilon then
        return false
    end

    local expected_delta = math.max(0, elapsed_wall_time)
        * math.max(0.01, play_rate or 1)
    local allowed_delta = math.max(
        CONFIG.seek_minimum_seconds,
        expected_delta * CONFIG.seek_expected_factor + CONFIG.seek_margin_seconds
    )

    return position_delta <= allowed_delta
end

function BeatVisualizer.grid_dimensions(width, height)
    if width >= height then
        return 4, 2
    end

    return 2, 4
end

if rawget(_G, "REAPER2MA_BEAT_VISUALIZER_TEST_MODE") then
    return BeatVisualizer
end

local function native_color_to_rgb(native_color)
    local custom_color_flag = 0x1000000

    if type(native_color) ~= "number" or native_color < custom_color_flag then
        return nil
    end

    local color_without_flag = native_color % custom_color_flag
    local red, green, blue = reaper.ColorFromNative(color_without_flag)

    return {
        red / 255,
        green / 255,
        blue / 255,
    }
end

local function enumerate_project_markers(project)
    local _, marker_count, region_count = reaper.CountProjectMarkers(project)
    local item_count = (marker_count or 0) + (region_count or 0)
    local markers = {}
    local regions = {}

    for item_index = 0, item_count - 1 do
        local found,
            is_region,
            position,
            region_end,
            name,
            displayed_index,
            native_color = reaper.EnumProjectMarkers3(project, item_index)

        if found and found > 0 then
            local item = {
                name = name or "",
                color = native_color_to_rgb(native_color),
                order = item_index + 1,
                displayed_index = displayed_index,
            }

            if is_region then
                item.start_position = position
                item.end_position = region_end
                regions[#regions + 1] = item
            else
                item.position = position
                markers[#markers + 1] = item
            end
        end
    end

    return markers, regions
end

local function set_graphics_color(color, alpha)
    gfx.set(color[1], color[2], color[3], alpha or 1)
end

local function draw_filled_round_rect(x, y, width, height, radius)
    local safe_radius = math.max(0, math.min(radius, width / 2, height / 2))

    if safe_radius <= 0 then
        gfx.rect(x, y, width, height, 1)
        return
    end

    gfx.rect(x + safe_radius, y, width - safe_radius * 2, height, 1)
    gfx.rect(x, y + safe_radius, width, height - safe_radius * 2, 1)
    gfx.circle(x + safe_radius, y + safe_radius, safe_radius, 1, 1)
    gfx.circle(x + width - safe_radius, y + safe_radius, safe_radius, 1, 1)
    gfx.circle(x + safe_radius, y + height - safe_radius, safe_radius, 1, 1)
    gfx.circle(x + width - safe_radius, y + height - safe_radius, safe_radius, 1, 1)
end

local function contrasting_text_color(color)
    local luminance = color[1] * 0.299 + color[2] * 0.587 + color[3] * 0.114
    if luminance > 0.62 then
        return { 0.035, 0.040, 0.050 }
    end

    return { 0.970, 0.975, 0.985 }
end

local function choose_text_layout(text, maximum_width, maximum_height, preferred_font_size)
    local function measure_width(value)
        return gfx.measurestr(value)
    end

    local fallback_layout = nil

    for font_size = preferred_font_size, CONFIG.min_font_size, -1 do
        gfx.setfont(1, "Arial", font_size)

        local _, line_height = gfx.measurestr("Ag")
        local line_spacing = math.max(1, math.floor(font_size * 0.15))
        local lines, truncated = BeatVisualizer.wrap_text(
            text,
            maximum_width,
            CONFIG.max_text_lines,
            measure_width
        )
        local text_height = #lines * line_height
            + math.max(0, #lines - 1) * line_spacing

        local layout = {
            font_size = font_size,
            line_height = line_height,
            line_spacing = line_spacing,
            lines = lines,
            total_height = text_height,
            truncated = truncated,
        }

        if text_height <= maximum_height then
            fallback_layout = layout
            if not truncated then
                return layout
            end
        end
    end

    return fallback_layout
end

local function draw_tile(tile, x, y, width, height, now)
    local sampled = BeatVisualizer.sample_tile(tile, now)
    local radius = math.min(22, width * 0.12, height * 0.12)

    gfx.set(0, 0, 0, 0.34)
    draw_filled_round_rect(x + 3, y + 5, width, height, radius)

    set_graphics_color(sampled.color, 1)
    draw_filled_round_rect(x, y, width, height, radius)

    gfx.set(1, 1, 1, sampled.active and 0.20 or 0.075)
    gfx.roundrect(x + 0.5, y + 0.5, width - 1, height - 1, radius, 1)

    if sampled.text_alpha <= 0 or sampled.name == "" then
        return
    end

    local preferred_font_size = math.floor(math.min(width, height) * 0.135)
    preferred_font_size = clamp(
        preferred_font_size,
        CONFIG.min_font_size,
        CONFIG.max_font_size
    )
    local text_layout = choose_text_layout(
        sampled.name,
        math.max(0, width - 24),
        math.max(0, height - 20),
        preferred_font_size
    )
    if not text_layout or #text_layout.lines == 0 then
        return
    end

    local text_color = contrasting_text_color(tile.color)

    gfx.setfont(1, "Arial", text_layout.font_size)
    set_graphics_color(text_color, sampled.text_alpha)

    local first_line_y = y + (height - text_layout.total_height) / 2
    for line_index, line in ipairs(text_layout.lines) do
        local text_width = gfx.measurestr(line)
        gfx.x = x + (width - text_width) / 2
        gfx.y = first_line_y
            + (line_index - 1)
                * (text_layout.line_height + text_layout.line_spacing)
        gfx.drawstr(line)
    end
end

local function draw_grid(tiles, now)
    set_graphics_color(CONFIG.background_color, 1)
    gfx.rect(0, 0, gfx.w, gfx.h, 1)

    local columns, rows = BeatVisualizer.grid_dimensions(gfx.w, gfx.h)
    local shortest_side = math.max(1, math.min(gfx.w, gfx.h))
    local gap = clamp(math.floor(shortest_side / 32), 8, 20)
    local outer_padding = gap
    local available_width = math.max(1, gfx.w - outer_padding * 2 - gap * (columns - 1))
    local available_height = math.max(1, gfx.h - outer_padding * 2 - gap * (rows - 1))
    local tile_width = available_width / columns
    local tile_height = available_height / rows

    for tile_index, tile in ipairs(tiles) do
        local zero_based_index = tile_index - 1
        local column = zero_based_index % columns
        local row = math.floor(zero_based_index / columns)
        local x = outer_padding + column * (tile_width + gap)
        local y = outer_padding + row * (tile_height + gap)

        draw_tile(tile, x, y, tile_width, tile_height, now)
    end
end

local state = {
    project = nil,
    project_change_count = nil,
    events = {},
    tiles = BeatVisualizer.make_tiles(CONFIG.tile_count),
    was_running = false,
    previous_position = nil,
    previous_wall_time = nil,
    previous_right_mouse_down = false,
    action_section_id = nil,
    action_command_id = nil,
}

local function set_action_toggle(enabled)
    if not state.action_section_id
        or not state.action_command_id
        or state.action_command_id <= 0
    then
        return
    end

    reaper.SetToggleCommandState(
        state.action_section_id,
        state.action_command_id,
        enabled and 1 or 0
    )
    reaper.RefreshToolbar2(state.action_section_id, state.action_command_id)
end

local function trigger_event(event, now)
    BeatVisualizer.activate_tile(state.tiles[event.tile_index], event, now)
end

local function refresh_project_cache()
    local project = reaper.EnumProjects(-1)
    local project_changed = project ~= state.project
    local change_count = project and reaper.GetProjectStateChangeCount(project) or -1

    if not project_changed and change_count == state.project_change_count then
        return
    end

    state.project = project
    state.project_change_count = change_count
    state.was_running = false
    state.previous_position = nil
    state.previous_wall_time = nil

    if project_changed then
        state.tiles = BeatVisualizer.make_tiles(CONFIG.tile_count)
    end

    if not project then
        state.events = {}
        return
    end

    local markers, regions = enumerate_project_markers(project)
    state.events = BeatVisualizer.build_beat_events(markers, regions, CONFIG.tile_count)
end

local function play_state_is_running(play_state)
    local is_playing = play_state % 2 == 1
    local is_recording = math.floor(play_state / 4) % 2 == 1
    return is_playing or is_recording
end

local function process_transport(now)
    if not state.project then
        return
    end

    local play_state = reaper.GetPlayStateEx(state.project)
    local is_running = play_state_is_running(play_state)

    if not is_running then
        state.was_running = false
        state.previous_position = nil
        state.previous_wall_time = nil
        return
    end

    local position = reaper.GetPlayPositionEx(state.project)

    if not state.was_running
        or not state.previous_position
        or not state.previous_wall_time
    then
        local landing_event = BeatVisualizer.find_landing_event(state.events, position)
        if landing_event then
            trigger_event(landing_event, now)
        end
    else
        local elapsed_wall_time = now - state.previous_wall_time
        local play_rate = reaper.Master_GetPlayRate(state.project)
        local continuous_forward = BeatVisualizer.is_continuous_forward_motion(
            state.previous_position,
            position,
            elapsed_wall_time,
            play_rate
        )

        if continuous_forward then
            local crossed_events = BeatVisualizer.collect_crossed_events(
                state.events,
                state.previous_position,
                position
            )

            for _, event in ipairs(crossed_events) do
                trigger_event(event, now)
            end
        else
            local landing_event = BeatVisualizer.find_landing_event(state.events, position)
            if landing_event then
                trigger_event(landing_event, now)
            end
        end
    end

    state.was_running = true
    state.previous_position = position
    state.previous_wall_time = now
end

local function handle_context_menu()
    local right_mouse_down = math.floor(gfx.mouse_cap / 2) % 2 == 1

    if right_mouse_down and not state.previous_right_mouse_down then
        local dock_state = gfx.dock(-1)
        local is_docked = dock_state % 2 == 1

        gfx.x = gfx.mouse_x
        gfx.y = gfx.mouse_y

        local selection = gfx.showmenu(is_docked and "Undock window" or "Dock window")
        if selection == 1 then
            gfx.dock(is_docked and 0 or 1)
        end
    end

    state.previous_right_mouse_down = right_mouse_down
end

local function on_exit()
    set_action_toggle(false)
    gfx.quit()
end

local function run()
    local now = reaper.time_precise()

    refresh_project_cache()
    process_transport(now)
    handle_context_menu()
    draw_grid(state.tiles, now)
    gfx.update()

    if gfx.getchar() >= 0 then
        reaper.defer(run)
    end
end

local _, _, section_id, command_id = reaper.get_action_context()
state.action_section_id = section_id
state.action_command_id = command_id

reaper.atexit(on_exit)
set_action_toggle(true)
gfx.init(CONFIG.title, CONFIG.window_width, CONFIG.window_height, 0)
run()
