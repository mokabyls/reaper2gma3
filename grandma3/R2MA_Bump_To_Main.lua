-- @description Reaper2MA : déplacer des repères bump vers une séquence principale
-- @version 1.0.0
-- @author Reaper2MA contributors
-- @about
--   Crée des cues vides dans une séquence principale et leur ajoute des
--   événements Go+ aux heures des événements d'une séquence bump.
--   Compatible avec grandMA3 2.4.1 et 2.4.2.
-- @license MIT

local BumpToMain = {}

-- ============================================================================
-- Configuration et constantes
-- ============================================================================

local CONFIG = {
    title = "Reaper2MA - Bump vers principale",
    minimum_cue_units = 1,          -- Cue 0.001.
    maximum_cue_units = 9999999,   -- Cue 9999.999.
    time_resolution = 1000,        -- Comparaison des temps à la milliseconde.
    preview_line_limit = 24,
    undo_name = "R2MA Bump vers principale",
}

BumpToMain.CONFIG = CONFIG

local ROLE_EDIT = nil
local ROLE_DISPLAY = nil

if type(Enums) == "table" and type(Enums.Roles) == "table" then
    ROLE_EDIT = Enums.Roles.Edit
    ROLE_DISPLAY = Enums.Roles.Display
end

-- ============================================================================
-- Fonctions générales et échappement des commandes grandMA3
-- ============================================================================

local function trim(value)
    return tostring(value or ""):match("^%s*(.-)%s*$")
end

local function normalized_class_name(value)
    return string.lower(tostring(value or "")):gsub("[^%w]", "")
end

local function round(value)
    if value >= 0 then
        return math.floor(value + 0.5)
    end

    return math.ceil(value - 0.5)
end

local function shallow_copy(source)
    local result = {}

    for key, value in pairs(source or {}) do
        result[key] = value
    end

    return result
end

local function command_quote(value)
    -- Les noms grandMA3 ne peuvent pas contenir de guillemet. On supprime aussi
    -- les retours à la ligne pour qu'un label ne puisse pas casser la commande.
    local text = tostring(value or "")
        :gsub("[\r\n\t]", " ")
        :gsub("\\", "/")
        :gsub('"', "'")

    return '"' .. text .. '"'
end

function BumpToMain.sanitize_label(value)
    -- La documentation du mot-clé Label interdit ces caractères. Les remplacer
    -- par des espaces conserve au mieux le nom tout en gardant une commande sûre.
    local sanitized = tostring(value or "")
        :gsub('[\\"%$&%*%?,%.%;%^%{%|%}%~]', " ")
        :gsub("[%c]", " ")
        :gsub("%s+", " ")

    return trim(sanitized)
end

local function is_truthy(value)
    if value == true or value == 1 then
        return true
    end

    local text = string.lower(trim(value))
    return text == "1" or text == "yes" or text == "true" or text == "on"
end

-- ============================================================================
-- Lecture et formatage des temps
-- ============================================================================

function BumpToMain.parse_time(value)
    if type(value) == "number" then
        return value
    end

    local text = trim(value):lower():gsub(",", ".")
    if text == "" then
        return nil
    end

    local direct = tonumber(text)
    if direct then
        return direct
    end

    -- Formats acceptés par l'affichage grandMA3 : 1h02m03.400, 2m03.400,
    -- 01:02:03.400 ou 02:03.400.
    local hours, minutes, seconds = text:match(
        "^(%d+)%s*h%s*(%d+)%s*m%s*(%d+%.?%d*)%s*s?$"
    )
    if hours then
        return tonumber(hours) * 3600 + tonumber(minutes) * 60 + tonumber(seconds)
    end

    minutes, seconds = text:match("^(%d+)%s*m%s*(%d+%.?%d*)%s*s?$")
    if minutes then
        return tonumber(minutes) * 60 + tonumber(seconds)
    end

    hours, minutes, seconds = text:match(
        "^(%d+):(%d+):(%d+%.?%d*)$"
    )
    if hours then
        return tonumber(hours) * 3600 + tonumber(minutes) * 60 + tonumber(seconds)
    end

    minutes, seconds = text:match("^(%d+):(%d+%.?%d*)$")
    if minutes then
        return tonumber(minutes) * 60 + tonumber(seconds)
    end

    return nil
end

function BumpToMain.time_key(seconds)
    return round(seconds * CONFIG.time_resolution)
end

function BumpToMain.format_time(seconds)
    local formatted = string.format("%.6f", seconds)
        :gsub("0+$", "")
        :gsub("%.$", "")

    if not formatted:find("%.") then
        formatted = formatted .. ".000"
    end

    return formatted
end

-- ============================================================================
-- Numéros de cue : stockage entier à la millième
-- ============================================================================

function BumpToMain.cue_number_to_units(value)
    local number = tonumber(trim(value))
    if not number then
        return nil
    end

    local units = round(number * 1000)
    if units < CONFIG.minimum_cue_units or units > CONFIG.maximum_cue_units then
        return nil
    end

    return units
end

function BumpToMain.format_cue_units(units)
    local whole = math.floor(units / 1000)
    local fraction = units % 1000

    if fraction == 0 then
        return tostring(whole)
    end

    local fraction_text = string.format("%03d", fraction):gsub("0+$", "")
    return string.format("%d.%s", whole, fraction_text)
end

local function next_multiple_strictly_after(value, step)
    return (math.floor(value / step) + 1) * step
end

function BumpToMain.find_next_cue_units(cursor, upper_bound, occupied)
    -- La lisibilité est prioritaire : on cherche d'abord un dixième, puis un
    -- centième, puis un millième. Après 45.9, le prochain numéro lisible entre
    -- 45 et 46 devient donc 45.91.
    for _, step in ipairs({ 100, 10, 1 }) do
        local candidate = next_multiple_strictly_after(cursor, step)

        while candidate < upper_bound do
            if candidate >= CONFIG.minimum_cue_units
                and candidate <= CONFIG.maximum_cue_units
                and not occupied[candidate]
            then
                return candidate
            end

            candidate = candidate + step
        end
    end

    return nil
end

-- ============================================================================
-- Recherche des cues précédente et suivante et construction du plan
-- ============================================================================

local function compare_events(left, right)
    if left.time_key ~= right.time_key then
        return left.time_key < right.time_key
    end

    return (left.order or 0) < (right.order or 0)
end

local function validate_destination_anchors(anchors)
    if #anchors == 0 then
        return nil, "Le track principal ne contient aucun événement assigné à une cue."
    end

    table.sort(anchors, compare_events)

    for index = 2, #anchors do
        local previous = anchors[index - 1]
        local current = anchors[index]

        if current.cue_units <= previous.cue_units then
            return nil, string.format(
                "Ordre principal incohérent : la cue %s à %s ne suit pas la cue %s à %s.",
                BumpToMain.format_cue_units(current.cue_units),
                BumpToMain.format_time(current.time),
                BumpToMain.format_cue_units(previous.cue_units),
                BumpToMain.format_time(previous.time)
            )
        end
    end

    return anchors
end

local function find_surrounding_anchors(anchors, event_time_key)
    local previous = nil
    local following = nil

    for _, anchor in ipairs(anchors) do
        if anchor.time_key < event_time_key then
            previous = anchor
        elseif anchor.time_key > event_time_key then
            following = anchor
            break
        end
    end

    return previous, following
end

local function interval_key(previous, following)
    return string.format(
        "%s:%s",
        previous and previous.cue_units or "START",
        following and following.cue_units or "END"
    )
end

function BumpToMain.plan_insertions(source_events, destination_events, occupied_units)
    local anchors = {}
    local destination_times = {}

    for _, event in ipairs(destination_events) do
        destination_times[event.time_key] = true
        if event.cue_units then
            anchors[#anchors + 1] = event
        end
    end

    local valid_anchors, anchor_error = validate_destination_anchors(anchors)
    if not valid_anchors then
        return nil, anchor_error
    end

    local sorted_source = {}
    for _, source_event in ipairs(source_events) do
        sorted_source[#sorted_source + 1] = shallow_copy(source_event)
    end
    table.sort(sorted_source, compare_events)

    local occupied = {}
    for units, present in pairs(occupied_units or {}) do
        if present then
            occupied[units] = true
        end
    end

    local interval_cursors = {}
    local insertions = {}
    local skipped_collisions = {}

    for _, source_event in ipairs(sorted_source) do
        if destination_times[source_event.time_key] then
            skipped_collisions[#skipped_collisions + 1] = source_event
        else
            local previous, following = find_surrounding_anchors(
                valid_anchors,
                source_event.time_key
            )
            local lower_bound = previous
                and previous.cue_units
                or (CONFIG.minimum_cue_units - 1)
            local upper_bound = following
                and following.cue_units
                or (CONFIG.maximum_cue_units + 1)
            local key = interval_key(previous, following)
            local cursor = interval_cursors[key] or lower_bound
            local cue_units = BumpToMain.find_next_cue_units(
                cursor,
                upper_bound,
                occupied
            )

            if not cue_units then
                return nil, string.format(
                    "Aucun numéro de cue libre entre %s et %s pour l'événement à %s.",
                    previous
                        and BumpToMain.format_cue_units(previous.cue_units)
                        or "le début",
                    following
                        and BumpToMain.format_cue_units(following.cue_units)
                        or "la fin",
                    BumpToMain.format_time(source_event.time)
                )
            end

            -- Exemple essentiel : un bump placé temporellement entre les cues
            -- 45 et 46 reçoit 45.1. Il ne reçoit jamais 1.1, car ses bornes sont
            -- toujours lues sur le track principal avant de choisir son numéro.
            interval_cursors[key] = cue_units
            occupied[cue_units] = true

            insertions[#insertions + 1] = {
                source = source_event,
                previous = previous,
                following = following,
                cue_units = cue_units,
                cue_number = BumpToMain.format_cue_units(cue_units),
            }
        end
    end

    return {
        insertions = insertions,
        skipped_collisions = skipped_collisions,
        anchors = valid_anchors,
        occupied_units = occupied,
    }
end

-- ============================================================================
-- Construction des commandes sans exécution
-- ============================================================================

local function fallback_cue_label(context, insertion)
    local fallback = string.format(
        "Bump %s Cue %s",
        context.source_sequence_name,
        insertion.source.cue_number
    )

    local sanitized = BumpToMain.sanitize_label(fallback)
    return sanitized ~= "" and sanitized or "Bump"
end

function BumpToMain.build_commands(context, plan)
    local commands = {}
    local next_event_index = context.first_free_event_index
    local used_event_indices = shallow_copy(context.used_event_indices)

    local function reserve_event_index()
        while used_event_indices[next_event_index] do
            next_event_index = next_event_index + 1
        end

        local reserved = next_event_index
        used_event_indices[reserved] = true
        next_event_index = next_event_index + 1
        return reserved
    end

    for _, insertion in ipairs(plan.insertions) do
        local cue_address = string.format(
            "%s Cue %s",
            context.destination_sequence_address,
            insertion.cue_number
        )
        local event_index = reserve_event_index()
        local event_address = string.format(
            "%s.%d",
            context.destination_subtrack_address,
            event_index
        )
        local source_label = BumpToMain.sanitize_label(
            insertion.source.cue_name
        )
        local label = source_label ~= ""
            and source_label
            or fallback_cue_label(context, insertion)
        local time_value = insertion.source.time_command_value
            or BumpToMain.format_time(insertion.source.time)

        commands[#commands + 1] = {
            kind = "store_cue",
            command = "Store " .. cue_address .. " /Overwrite",
            cue_number = insertion.cue_number,
        }
        commands[#commands + 1] = {
            kind = "label_cue",
            command = "Label " .. cue_address .. " " .. command_quote(label),
        }
        commands[#commands + 1] = {
            kind = "store_event",
            command = "Store " .. event_address .. " /Overwrite",
            event_address = event_address,
        }
        commands[#commands + 1] = {
            kind = "set_time",
            command = string.format(
                "Set %s Property %s %s",
                event_address,
                command_quote("TIME"),
                command_quote(time_value)
            ),
            event_address = event_address,
            time = insertion.source.time,
        }
        commands[#commands + 1] = {
            kind = "set_token",
            command = string.format(
                "Set %s Property %s %s",
                event_address,
                command_quote("TOKEN"),
                command_quote("Go+")
            ),
        }
        commands[#commands + 1] = {
            kind = "assign_cue",
            command = string.format(
                "Assign %s At %s",
                cue_address,
                event_address
            ),
            cue_number = insertion.cue_number,
            event_address = event_address,
        }

        insertion.event_index = event_index
        insertion.event_address = event_address
    end

    return commands
end

-- ============================================================================
-- Adaptateur de lecture des objets grandMA3
-- ============================================================================

local function safe_call(callback, ...)
    local result = table.pack(pcall(callback, ...))
    if not result[1] then
        return nil
    end

    return table.unpack(result, 2, result.n)
end

local function object_children(handle)
    if not handle then
        return {}
    end

    local children = safe_call(function()
        return handle:Children()
    end)

    return type(children) == "table" and children or {}
end

local function object_get(handle, property, role)
    if not handle then
        return nil
    end

    if role ~= nil then
        local value_with_role = safe_call(function()
            return handle:Get(property, role)
        end)
        if value_with_role ~= nil then
            return value_with_role
        end
    end

    local value = safe_call(function()
        return handle:Get(property)
    end)
    if value ~= nil then
        return value
    end

    return safe_call(function()
        return handle[property]
    end)
end

local function object_class(handle)
    local class_name = safe_call(function()
        return handle:GetClass()
    end)

    return class_name or object_get(handle, "Class") or ""
end

local function object_name(handle)
    return tostring(
        object_get(handle, "Name")
        or object_get(handle, "name")
        or ""
    )
end

local function object_dependencies(handle)
    local dependencies = safe_call(function()
        return handle:GetDependencies()
    end)

    return type(dependencies) == "table" and dependencies or {}
end

local function object_addr_native(handle, base)
    local address = safe_call(function()
        return handle:AddrNative(base, true)
    end)

    if address ~= nil then
        return tostring(address)
    end

    return safe_call(function()
        return handle:AddrNative()
    end)
end

local function object_addr(handle, base)
    local address = safe_call(function()
        return handle:Addr(base)
    end)

    return address and tostring(address) or nil
end

local function handle_key(handle)
    if not handle then
        return nil
    end

    if type(HandleToStr) == "function" then
        local key = safe_call(HandleToStr, handle)
        if key then
            return tostring(key)
        end
    end

    return object_addr_native(handle) or tostring(handle)
end

local function object_number(handle, parent)
    for _, property in ipairs({ "No", "NO", "ID", "Id" }) do
        local value = object_get(handle, property)
        local number = tonumber(value)
        if number then
            return number
        end
    end

    local relative_address = object_addr(handle, parent)
    if relative_address then
        local number = relative_address:match("(%d+%.?%d*)%D*$")
        if number then
            return tonumber(number)
        end
    end

    return nil
end

local function class_contains(handle, fragment)
    return normalized_class_name(object_class(handle)):find(fragment, 1, true)
        ~= nil
end

local function is_cue_handle(handle)
    local class_name = normalized_class_name(object_class(handle))
    return class_name == "cue" or (
        class_name:find("cue", 1, true) ~= nil
        and class_name:find("part", 1, true) == nil
    )
end

local function is_cmd_subtrack(handle)
    return class_contains(handle, "cmdsubtrack")
end

local function is_cmd_event(handle)
    if class_contains(handle, "cmdevent") then
        return true
    end

    return object_get(handle, "Time") ~= nil
        and not class_contains(handle, "faderevent")
end

local function read_pool_collection(data_pool, property_name)
    local direct = safe_call(function()
        return data_pool[property_name]
    end)
    if direct then
        return direct
    end

    for _, child in ipairs(object_children(data_pool)) do
        local class_name = normalized_class_name(object_class(child))
        local name = string.lower(object_name(child))
        if class_name:find(string.lower(property_name), 1, true)
            or name == string.lower(property_name)
        then
            return child
        end
    end

    return nil
end

local function collect_pool_objects(collection)
    local objects = object_children(collection)

    table.sort(objects, function(left, right)
        local left_number = object_number(left, collection) or math.huge
        local right_number = object_number(right, collection) or math.huge
        if left_number ~= right_number then
            return left_number < right_number
        end

        return object_name(left) < object_name(right)
    end)

    return objects
end

local function collect_sequence_cues(sequence)
    local cues = {}
    local by_handle = {}
    local by_units = {}
    local by_name = {}

    for _, child in ipairs(object_children(sequence)) do
        if is_cue_handle(child) then
            local cue_number = object_number(child, sequence)
            local cue_units = BumpToMain.cue_number_to_units(cue_number)

            -- CueZero et OffCue ne possèdent pas de numéro exploitable pour une
            -- insertion et sont volontairement exclus.
            if cue_units then
                local cue = {
                    handle = child,
                    handle_key = handle_key(child),
                    number = BumpToMain.format_cue_units(cue_units),
                    units = cue_units,
                    name = object_name(child),
                }
                cues[#cues + 1] = cue
                by_handle[cue.handle_key] = cue
                by_units[cue_units] = cue

                local normalized_name = string.lower(trim(cue.name))
                if normalized_name ~= "" then
                    if by_name[normalized_name] == nil then
                        by_name[normalized_name] = cue
                    else
                        by_name[normalized_name] = false
                    end
                end
            end
        end
    end

    table.sort(cues, function(left, right)
        return left.units < right.units
    end)

    return {
        list = cues,
        by_handle = by_handle,
        by_units = by_units,
        by_name = by_name,
    }
end

local function dependency_matching_sequence(handle, sequence, cue_index)
    local sequence_key = handle_key(sequence)

    for _, dependency in ipairs(object_dependencies(handle)) do
        local dependency_key = handle_key(dependency)
        if dependency_key == sequence_key
            or cue_index.by_handle[dependency_key] ~= nil
        then
            return true
        end
    end

    local target = tostring(
        object_get(handle, "Target", ROLE_EDIT)
        or object_get(handle, "Target", ROLE_DISPLAY)
        or object_get(handle, "Target")
        or ""
    )
    if target == "" then
        return false
    end

    local sequence_name = object_name(sequence)
    local sequence_address = object_addr_native(sequence)
    return (sequence_name ~= "" and target:find(sequence_name, 1, true) ~= nil)
        or (
            sequence_address
            and target:find(sequence_address:gsub('"', ""), 1, true) ~= nil
        )
end

local function collect_cmd_subtracks(timecode, sequence, cue_index)
    local candidates = {}

    local function visit(handle, ancestors)
        if is_cmd_subtrack(handle) then
            local target_track = nil

            for index = #ancestors, 1, -1 do
                local ancestor = ancestors[index]
                if dependency_matching_sequence(
                    ancestor,
                    sequence,
                    cue_index
                ) then
                    target_track = ancestor
                    break
                end
            end

            if target_track then
                candidates[#candidates + 1] = {
                    handle = handle,
                    track = target_track,
                    name = object_name(target_track),
                    address = object_addr_native(handle),
                }
            end

            return
        end

        local next_ancestors = {}
        for index, ancestor in ipairs(ancestors) do
            next_ancestors[index] = ancestor
        end
        next_ancestors[#next_ancestors + 1] = handle

        for _, child in ipairs(object_children(handle)) do
            visit(child, next_ancestors)
        end
    end

    visit(timecode, {})
    return candidates
end

local function find_cue_in_dependencies(handle, cue_index)
    for _, dependency in ipairs(object_dependencies(handle)) do
        local cue = cue_index.by_handle[handle_key(dependency)]
        if cue then
            return cue
        end
    end

    for _, child in ipairs(object_children(handle)) do
        for _, dependency in ipairs(object_dependencies(child)) do
            local cue = cue_index.by_handle[handle_key(dependency)]
            if cue then
                return cue
            end
        end
    end

    return nil
end

local function find_cue_from_destination_text(handle, cue_index)
    local destination = trim(
        object_get(handle, "CueDestination", ROLE_EDIT)
        or object_get(handle, "CueDestination", ROLE_DISPLAY)
        or object_get(handle, "CueDestination")
    )

    if destination == "" then
        return nil, false
    end

    local number_text = destination:match("[Cc]ue%s+([%d%.]+)")
        or destination:match("^([%d%.]+)$")
    if number_text then
        local units = BumpToMain.cue_number_to_units(number_text)
        if units and cue_index.by_units[units] then
            return cue_index.by_units[units], true
        end
    end

    local name = destination:match("^%[(.*)%]$") or destination
    local named_cue = cue_index.by_name[string.lower(trim(name))]
    if named_cue then
        return named_cue, true
    end

    return nil, true
end

local function find_cue_from_value_destination(handle, cue_index)
    local objects = { handle }
    for _, child in ipairs(object_children(handle)) do
        objects[#objects + 1] = child
    end

    for _, object in ipairs(objects) do
        local value = tostring(object_get(object, "ValCueDestination") or "")
        local encoded = tonumber(value:match("(%d+)%D*$"))
        if encoded then
            local units = round(encoded)
            if cue_index.by_units[units] then
                return cue_index.by_units[units]
            end
        end
    end

    return nil
end

local function resolve_event_cue(handle, cue_index)
    local dependency_cue = find_cue_in_dependencies(handle, cue_index)
    if dependency_cue then
        return dependency_cue, false
    end

    local text_cue, had_destination = find_cue_from_destination_text(
        handle,
        cue_index
    )
    if text_cue then
        return text_cue, false
    end

    local value_cue = find_cue_from_value_destination(handle, cue_index)
    if value_cue then
        return value_cue, false
    end

    return nil, had_destination
end

local function read_event_time(handle)
    local function try_value(value)
        local seconds = BumpToMain.parse_time(value)
        if seconds then
            return seconds, BumpToMain.format_time(seconds)
        end

        return nil, nil
    end

    local seconds, command_value = try_value(
        object_get(handle, "Time", ROLE_EDIT)
    )
    if seconds then
        return seconds, command_value
    end

    seconds, command_value = try_value(
        object_get(handle, "Time", ROLE_DISPLAY)
    )
    if seconds then
        return seconds, command_value
    end

    return try_value(object_get(handle, "Time"))
end

local function read_event_index(handle, subtrack, fallback)
    local number = object_number(handle, subtrack)
    if number and number >= 1 and number == math.floor(number) then
        return number
    end

    return fallback
end

local function collect_subtrack_events(candidate, cue_index)
    local events = {}
    local used_indices = {}
    local unresolved = {}

    for child_position, child in ipairs(object_children(candidate.handle)) do
        if is_cmd_event(child) then
            local seconds, command_value = read_event_time(child)
            if not seconds then
                return nil, nil, nil,
                    "Un événement du track ne possède pas d'heure lisible."
            end

            local cue, unresolved_destination = resolve_event_cue(
                child,
                cue_index
            )
            local event_index = read_event_index(
                child,
                candidate.handle,
                child_position
            )
            used_indices[event_index] = true

            local event = {
                handle = child,
                time = seconds,
                time_key = BumpToMain.time_key(seconds),
                time_command_value = command_value,
                order = event_index,
                event_index = event_index,
                cue = cue,
                cue_units = cue and cue.units or nil,
                cue_number = cue and cue.number or nil,
                cue_name = cue and cue.name or nil,
            }
            events[#events + 1] = event

            if unresolved_destination then
                unresolved[#unresolved + 1] = event
            end
        end
    end

    local first_free = 1
    while used_indices[first_free] do
        first_free = first_free + 1
    end

    return events, used_indices, first_free, nil, unresolved
end

-- ============================================================================
-- Vérification du Programmer
-- ============================================================================

local function programmer_part_has_values(part)
    for _, child in ipairs(object_children(part)) do
        local class_name = normalized_class_name(object_class(child))

        -- Une sélection seule ne serait pas stockée dans la cue. Les objets de
        -- données/phasers du Programmer, eux, indiquent qu'un Store capturerait
        -- du contenu et doivent donc bloquer l'opération.
        local selection_only = class_name:find("selection", 1, true) ~= nil
            or class_name:find("grid", 1, true) ~= nil

        if not selection_only then
            return true
        end
    end

    return false
end

function BumpToMain.programmer_has_values(programmer)
    if not programmer then
        return false
    end

    for _, property in ipairs({
        "HasActiveValues",
        "ActiveValues",
        "HasData",
    }) do
        local value = object_get(programmer, property)
        if value ~= nil and is_truthy(value) then
            return true
        end
    end

    for _, child in ipairs(object_children(programmer)) do
        local class_name = normalized_class_name(object_class(child))
        if class_name:find("part", 1, true) then
            if programmer_part_has_values(child) then
                return true
            end
        elseif class_name:find("selection", 1, true) == nil
            and class_name:find("grid", 1, true) == nil
        then
            return true
        end
    end

    -- Certaines versions exposent surtout le ProgrammerPart courant. Ce second
    -- contrôle couvre ce cas sans modifier ni vider le Programmer.
    if type(ProgrammerPart) == "function" then
        local current_part = safe_call(ProgrammerPart)
        if current_part and programmer_part_has_values(current_part) then
            return true
        end
    end

    return false
end

-- ============================================================================
-- Fenêtres de sélection
-- ============================================================================

local function show_message(title, message, is_error)
    MessageBox({
        title = title,
        message = message,
        backColor = is_error and "Global.AlertText" or "Window.Plugins",
        commands = {
            { value = 1, name = "OK" },
        },
    })
end

local function choose_item(title, message, selector_name, items)
    if #items == 0 then
        return nil
    end

    local values = {}
    local by_value = {}
    for index, item in ipairs(items) do
        values[item.label] = index
        by_value[index] = item
    end

    local result = MessageBox({
        title = title,
        message = message,
        selectors = {
            {
                name = selector_name,
                selectedValue = 1,
                type = 0,
                values = values,
            },
        },
        commands = {
            { value = 0, name = "Annuler" },
            { value = 1, name = "Continuer" },
        },
    })

    if not result
        or not result.success
        or result.result ~= 1
        or not result.selectors
    then
        return nil
    end

    return by_value[result.selectors[selector_name]]
end

local function pool_items(objects, collection)
    local items = {}
    for _, handle in ipairs(objects) do
        local number = object_number(handle, collection)
        local name = object_name(handle)
        items[#items + 1] = {
            handle = handle,
            number = number,
            label = string.format(
                "%s — %s",
                number and tostring(number) or "?",
                name ~= "" and name or "Sans nom"
            ),
        }
    end

    return items
end

local function cue_items(cue_index)
    local items = {
        {
            all = true,
            label = "Toutes les cues",
        },
    }

    for _, cue in ipairs(cue_index.list) do
        items[#items + 1] = {
            cue = cue,
            label = string.format(
                "%s — %s",
                cue.number,
                cue.name ~= "" and cue.name or "Sans nom"
            ),
        }
    end

    return items
end

local function subtrack_items(candidates)
    local items = {}
    for _, candidate in ipairs(candidates) do
        items[#items + 1] = {
            candidate = candidate,
            label = string.format(
                "%s — %s",
                candidate.name ~= "" and candidate.name or "Track sans nom",
                candidate.address or "adresse inconnue"
            ),
        }
    end

    return items
end

local function choose_subtrack(candidates, kind)
    if #candidates == 1 then
        return candidates[1]
    end

    local selected = choose_item(
        "Choisir le track " .. kind,
        "Plusieurs CmdSubTrack ciblent cette séquence.",
        "Track " .. kind,
        subtrack_items(candidates)
    )

    return selected and selected.candidate or nil
end

-- ============================================================================
-- Précontrôle et affichage du plan
-- ============================================================================

function BumpToMain.filter_source_events(events, selected_cue_key)
    local selected = {}

    for _, event in ipairs(events) do
        if event.cue
            and (
                selected_cue_key == nil
                or event.cue.handle_key == selected_cue_key
            )
        then
            selected[#selected + 1] = event
        end
    end

    return selected
end

local function preview_line(insertion)
    return string.format(
        "%s : %s → %s / %s / %s",
        BumpToMain.format_time(insertion.source.time),
        insertion.source.cue_number,
        insertion.previous
            and BumpToMain.format_cue_units(insertion.previous.cue_units)
            or "début",
        insertion.cue_number,
        insertion.following
            and BumpToMain.format_cue_units(insertion.following.cue_units)
            or "fin"
    )
end

local function print_complete_plan(plan)
    Printf("========== R2MA Bump vers principale ==========")
    for _, insertion in ipairs(plan.insertions) do
        Printf(preview_line(insertion))
    end

    for _, collision in ipairs(plan.skipped_collisions) do
        Printf(string.format(
            "IGNORÉ (collision) %s : cue source %s",
            BumpToMain.format_time(collision.time),
            collision.cue_number
        ))
    end
    Printf("================================================")
end

local function confirm_plan(plan)
    local lines = {
        string.format("%d cue(s) seront créées.", #plan.insertions),
        string.format(
            "%d bump(s) en collision seront ignorés.",
            #plan.skipped_collisions
        ),
        "",
        "Heure : source → précédente / nouvelle / suivante",
    }

    for index, insertion in ipairs(plan.insertions) do
        if index <= CONFIG.preview_line_limit then
            lines[#lines + 1] = preview_line(insertion)
        end
    end

    if #plan.insertions > CONFIG.preview_line_limit then
        lines[#lines + 1] = string.format(
            "... et %d autre(s), visibles dans le System Monitor.",
            #plan.insertions - CONFIG.preview_line_limit
        )
    end

    lines[#lines + 1] = ""
    lines[#lines + 1] =
        "Les événements et la séquence bump d'origine seront conservés."

    local result = MessageBox({
        title = CONFIG.title,
        message = table.concat(lines, "\n"),
        commands = {
            { value = 0, name = "Annuler" },
            { value = 1, name = "Appliquer" },
        },
    })

    return result
        and result.success
        and result.result == 1
end

-- ============================================================================
-- Exécution, undo et restauration en cas d'erreur
-- ============================================================================

function BumpToMain.execute_commands(runtime, commands)
    local undo = runtime.create_undo(CONFIG.undo_name)
    if not undo then
        return nil, "Impossible de créer le groupe d'annulation."
    end

    local success, execution_error = xpcall(function()
        for _, command in ipairs(commands) do
            -- Règle centrale du plugin : aucune écriture n'est effectuée par
            -- l'API objet Lua. Chaque mutation traverse CmdIndirectWait et
            -- rejoint le même groupe Oops.
            runtime.cmd_indirect_wait(command.command, undo)

            if command.kind == "store_cue"
                and runtime.cue_exists
                and not runtime.cue_exists(command.cue_number)
            then
                error("La cue " .. command.cue_number .. " n'a pas été créée.")
            end

            if command.kind == "store_event"
                and runtime.object_exists
                and not runtime.object_exists(command.event_address)
            then
                error(
                    "L'événement " .. command.event_address
                    .. " n'a pas été créé."
                )
            end

            if command.kind == "set_time"
                and runtime.event_has_time
                and not runtime.event_has_time(
                    command.event_address,
                    command.time
                )
            then
                error(
                    "L'heure de l'événement " .. command.event_address
                    .. " n'a pas été appliquée."
                )
            end

            if command.kind == "assign_cue"
                and runtime.event_targets_cue
                and not runtime.event_targets_cue(
                    command.event_address,
                    command.cue_number
                )
            then
                error(
                    "La cue " .. command.cue_number
                    .. " n'a pas été assignée à l'événement."
                )
            end
        end
    end, debug.traceback)

    local close_ok = runtime.close_undo(undo)
    if not success or close_ok == false then
        -- Aucune autre action utilisateur ne peut s'intercaler dans cette
        -- exécution synchrone. On tente donc Oops même si CloseUndo signale un
        -- problème : c'est la meilleure restauration possible côté plugin.
        runtime.cmd_indirect_wait("Oops")

        return nil, execution_error
            or "Le groupe d'annulation grandMA3 n'a pas pu être fermé."
    end

    return true
end

local function make_execution_runtime(destination_sequence)
    return {
        create_undo = CreateUndo,
        close_undo = CloseUndo,
        cmd_indirect_wait = CmdIndirectWait,
        cue_exists = function(cue_number)
            local cue_units = BumpToMain.cue_number_to_units(cue_number)
            return collect_sequence_cues(destination_sequence)
                .by_units[cue_units] ~= nil
        end,
        object_exists = function(address)
            if type(FromAddr) ~= "function" then
                return true
            end

            return safe_call(FromAddr, address) ~= nil
        end,
        event_has_time = function(address, expected_time)
            if type(FromAddr) ~= "function" then
                return true
            end

            local event_handle = safe_call(FromAddr, address)
            local actual_time = event_handle and read_event_time(event_handle)
            return actual_time ~= nil
                and BumpToMain.time_key(actual_time)
                    == BumpToMain.time_key(expected_time)
        end,
        event_targets_cue = function(address, cue_number)
            if type(FromAddr) ~= "function" then
                return true
            end

            local event_handle = safe_call(FromAddr, address)
            if not event_handle then
                return false
            end

            local refreshed_cues = collect_sequence_cues(destination_sequence)
            local cue = resolve_event_cue(event_handle, refreshed_cues)
            return cue ~= nil
                and cue.units == BumpToMain.cue_number_to_units(cue_number)
        end,
    }
end

-- ============================================================================
-- Orchestration grandMA3
-- ============================================================================

local function build_sequence_address(data_pool, sequence)
    local data_pool_number = object_number(data_pool)
    local data_pool_selector = data_pool_number
        and tostring(data_pool_number)
        or command_quote(object_name(data_pool))
    local sequence_number = object_number(
        sequence,
        read_pool_collection(data_pool, "Sequences")
    )

    if not sequence_number then
        return nil
    end

    return string.format(
        "DataPool %s Sequence %s",
        data_pool_selector,
        tostring(sequence_number)
    )
end

local function occupied_cue_units(cue_index)
    local occupied = {}
    for units in pairs(cue_index.by_units) do
        occupied[units] = true
    end

    return occupied
end

local function main()
    local data_pool = DataPool()
    if not data_pool then
        show_message(CONFIG.title, "Aucun DataPool courant n'est disponible.", true)
        return
    end

    local timecode_pool = read_pool_collection(data_pool, "Timecodes")
    local sequence_pool = read_pool_collection(data_pool, "Sequences")
    local timecodes = collect_pool_objects(timecode_pool)
    local sequences = collect_pool_objects(sequence_pool)

    if #timecodes == 0 or #sequences < 2 then
        show_message(
            CONFIG.title,
            "Il faut au moins un Timecode et deux séquences dans le DataPool courant.",
            true
        )
        return
    end

    local timecode_choice = choose_item(
        "Choisir le Timecode",
        "Sélectionne le Timecode qui contient les tracks bump et principal.",
        "Timecode",
        pool_items(timecodes, timecode_pool)
    )
    if not timecode_choice then
        return
    end

    local source_choice = choose_item(
        "Choisir la séquence bump",
        "Sélectionne la séquence dont les événements doivent être recopiés.",
        "Séquence source",
        pool_items(sequences, sequence_pool)
    )
    if not source_choice then
        return
    end

    local source_sequence = source_choice.handle
    local source_cues = collect_sequence_cues(source_sequence)
    if #source_cues.list == 0 then
        show_message(CONFIG.title, "La séquence source ne contient aucune cue.", true)
        return
    end

    local cue_choice = choose_item(
        "Choisir les cues bump",
        "Une cue sélectionnée reprend toutes ses occurrences dans le Timecode.",
        "Cues source",
        cue_items(source_cues)
    )
    if not cue_choice then
        return
    end

    local destination_options = {}
    for _, item in ipairs(pool_items(sequences, sequence_pool)) do
        if handle_key(item.handle) ~= handle_key(source_sequence) then
            destination_options[#destination_options + 1] = item
        end
    end

    local destination_choice = choose_item(
        "Choisir la séquence principale",
        "Sélectionne la séquence dans laquelle insérer les cues vides.",
        "Séquence destination",
        destination_options
    )
    if not destination_choice then
        return
    end

    local destination_sequence = destination_choice.handle
    local destination_cues = collect_sequence_cues(destination_sequence)
    local selected_timecode = timecode_choice.handle

    local source_candidates = collect_cmd_subtracks(
        selected_timecode,
        source_sequence,
        source_cues
    )
    local destination_candidates = collect_cmd_subtracks(
        selected_timecode,
        destination_sequence,
        destination_cues
    )

    if #source_candidates == 0 or #destination_candidates == 0 then
        show_message(
            CONFIG.title,
            "Impossible de trouver un CmdSubTrack pour l'une des séquences sélectionnées.",
            true
        )
        return
    end

    local source_subtrack = choose_subtrack(source_candidates, "source")
    if not source_subtrack then
        return
    end

    local destination_subtrack = choose_subtrack(
        destination_candidates,
        "destination"
    )
    if not destination_subtrack then
        return
    end

    local source_events, _, _, source_error, source_unresolved =
        collect_subtrack_events(source_subtrack, source_cues)
    local destination_events, used_event_indices, first_free_event_index,
        destination_error, destination_unresolved =
        collect_subtrack_events(destination_subtrack, destination_cues)

    if source_error or destination_error then
        show_message(
            CONFIG.title,
            source_error or destination_error,
            true
        )
        return
    end

    if #source_unresolved > 0 or #destination_unresolved > 0 then
        show_message(
            CONFIG.title,
            "Au moins une CueDestination existante n'a pas pu être résolue. "
                .. "Aucune modification n'a été faite.",
            true
        )
        return
    end

    local source_selection = BumpToMain.filter_source_events(
        source_events,
        cue_choice.all and nil or cue_choice.cue.handle_key
    )
    if #source_selection == 0 then
        show_message(
            CONFIG.title,
            "Aucun événement assigné aux cues choisies n'a été trouvé.",
            true
        )
        return
    end

    local plan, plan_error = BumpToMain.plan_insertions(
        source_selection,
        destination_events,
        occupied_cue_units(destination_cues)
    )
    if not plan then
        show_message(CONFIG.title, plan_error, true)
        return
    end

    if #plan.insertions == 0 then
        show_message(
            CONFIG.title,
            "Tous les bumps sélectionnés entrent en collision avec le track principal. "
                .. "Aucune modification n'est nécessaire.",
            false
        )
        return
    end

    if BumpToMain.programmer_has_values(Programmer()) then
        show_message(
            CONFIG.title,
            "Le Programmer contient des valeurs. Vide-le avant de relancer afin "
                .. "que les nouvelles cues restent réellement vides.",
            true
        )
        return
    end

    print_complete_plan(plan)
    if not confirm_plan(plan) then
        return
    end

    local destination_sequence_address = build_sequence_address(
        data_pool,
        destination_sequence
    )
    if not destination_sequence_address or not destination_subtrack.address then
        show_message(
            CONFIG.title,
            "Impossible de construire les adresses grandMA3 nécessaires.",
            true
        )
        return
    end

    local commands = BumpToMain.build_commands({
        destination_sequence_address = destination_sequence_address,
        destination_subtrack_address = destination_subtrack.address,
        source_sequence_name = object_name(source_sequence),
        used_event_indices = used_event_indices,
        first_free_event_index = first_free_event_index,
    }, plan)

    local execution_ok, execution_error = BumpToMain.execute_commands(
        make_execution_runtime(destination_sequence),
        commands
    )
    if not execution_ok then
        show_message(
            CONFIG.title,
            "L'opération a échoué et le groupe du plugin a été annulé.\n\n"
                .. tostring(execution_error),
            true
        )
        return
    end

    show_message(
        CONFIG.title,
        string.format(
            "%d cue(s) et événement(s) Go+ créés.\n"
                .. "%d collision(s) ignorée(s).\n\n"
                .. "Un seul Oops permet d'annuler l'ensemble.",
            #plan.insertions,
            #plan.skipped_collisions
        ),
        false
    )
end

-- ============================================================================
-- Point d'entrée du plugin et mode test
-- ============================================================================

BumpToMain.main = main

if rawget(_G, "REAPER2MA_BUMP_TO_MAIN_TEST_MODE") then
    return BumpToMain
end

return main
