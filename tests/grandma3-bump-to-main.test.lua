REAPER2MA_BUMP_TO_MAIN_TEST_MODE = true

local plugin = assert(dofile("grandma3/R2MA_Bump_To_Main.lua"))

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

local function assert_contains(text, fragment, message)
    assertions = assertions + 1
    if not string.find(text, fragment, 1, true) then
        fail(string.format(
            "%s: %q does not contain %q",
            message,
            text,
            fragment
        ))
    end
end

local function assert_not_contains(text, fragment, message)
    assertions = assertions + 1
    if string.find(text, fragment, 1, true) then
        fail(string.format(
            "%s: %q unexpectedly contains %q",
            message,
            text,
            fragment
        ))
    end
end

local function event(time, cue_number, order, cue_name)
    local cue_units = cue_number
        and plugin.cue_number_to_units(cue_number)
        or nil

    return {
        time = time,
        time_key = plugin.time_key(time),
        time_command_value = plugin.format_time(time),
        cue_number = cue_number and tostring(cue_number) or nil,
        cue_units = cue_units,
        cue_name = cue_name,
        order = order or 1,
    }
end

local function occupied(...)
    local result = {}
    for _, cue_number in ipairs({ ... }) do
        result[plugin.cue_number_to_units(cue_number)] = true
    end

    return result
end

local function cue_numbers(plan)
    local result = {}
    for _, insertion in ipairs(plan.insertions) do
        result[#result + 1] = insertion.cue_number
    end

    return table.concat(result, ",")
end

-- Lecture des formats affichés ou éditables par grandMA3.
assert_equal(plugin.parse_time("10.667"), 10.667, "plain seconds are parsed")
assert_equal(plugin.parse_time("2m03.400"), 123.4, "minute display is parsed")
assert_equal(plugin.parse_time("1h02m03.400"), 3723.4, "hour display is parsed")
assert_equal(plugin.parse_time("01:02:03.400"), 3723.4, "colon display is parsed")
assert_equal(plugin.time_key(12.3454), 12345, "time collision key rounds to milliseconds")

assert_equal(plugin.format_cue_units(45000), "45", "whole cue number is formatted")
assert_equal(plugin.format_cue_units(45100), "45.1", "tenth cue number is formatted")
assert_equal(plugin.format_cue_units(45910), "45.91", "hundredth cue number is formatted")
assert_equal(plugin.format_cue_units(45911), "45.911", "thousandth cue number is formatted")

-- Le cas central demandé : les bornes 45 et 46 produisent 45.1 et 45.2.
local basic_plan, basic_error = plugin.plan_insertions({
    event(12, 1, 1, "Bump"),
    event(14, 1, 2, "Bump"),
}, {
    event(10, 45, 1, "Avant"),
    event(20, 46, 2, "Après"),
}, occupied(45, 46))

assert_true(basic_plan ~= nil, basic_error or "basic plan is created")
assert_equal(cue_numbers(basic_plan), "45.1,45.2", "cues use surrounding destination numbers")

-- Une cue source répétée dans le Timecode crée une cue destination par occurrence.
assert_equal(#basic_plan.insertions, 2, "repeated source cue creates two insertions")
assert_equal(basic_plan.insertions[1].source.cue_number, "1", "first occurrence keeps source cue")
assert_equal(basic_plan.insertions[2].source.cue_number, "1", "second occurrence keeps source cue")

-- Après 45.8, le premier dixième est 45.9 puis les centièmes continuent.
local decimal_plan = assert(plugin.plan_insertions({
    event(12, 1, 1),
    event(14, 2, 2),
}, {
    event(10, 45.8, 1),
    event(20, 46, 2),
}, occupied(45.8, 46)))

assert_equal(cue_numbers(decimal_plan), "45.9,45.91", "precision increases only when needed")

-- Les cues non présentes dans le Timecode réservent quand même leur numéro.
local occupied_plan = assert(plugin.plan_insertions({
    event(12, 1, 1),
}, {
    event(10, 45, 1),
    event(20, 46, 2),
}, occupied(45, 45.1, 46)))

assert_equal(cue_numbers(occupied_plan), "45.2", "untimed occupied cue number is skipped")

-- Une collision avec n'importe quel événement du track principal est ignorée.
local collision_plan = assert(plugin.plan_insertions({
    event(10, 1, 1),
    event(15, 1, 2),
}, {
    event(10, 45, 1),
    event(20, 46, 2),
}, occupied(45, 46)))

assert_equal(#collision_plan.skipped_collisions, 1, "same-time bump is skipped")
assert_equal(cue_numbers(collision_plan), "45.1", "non-colliding bump remains planned")

-- Les extrémités utilisent la cue principale la plus proche comme borne.
local edge_plan = assert(plugin.plan_insertions({
    event(5, 1, 1),
    event(25, 1, 2),
}, {
    event(10, 45, 1),
    event(20, 46, 2),
}, occupied(45, 46)))

assert_equal(cue_numbers(edge_plan), "0.1,46.1", "events before and after the main range are supported")

-- Aucun millième ne peut être placé entre deux cues déjà consécutives.
local no_space_plan, no_space_error = plugin.plan_insertions({
    event(15, 1, 1),
}, {
    event(10, 45.001, 1),
    event(20, 45.002, 2),
}, occupied(45.001, 45.002))

assert_equal(no_space_plan, nil, "full interval is rejected")
assert_contains(no_space_error, "Aucun numéro de cue libre", "full interval explains failure")

-- Un ordre de cue qui recule dans le temps rend l'insertion dangereuse.
local bad_order_plan, bad_order_error = plugin.plan_insertions({
    event(15, 1, 1),
}, {
    event(10, 46, 1),
    event(20, 45, 2),
}, occupied(45, 46))

assert_equal(bad_order_plan, nil, "non-monotonic destination is rejected")
assert_contains(bad_order_error, "Ordre principal incohérent", "ordering error is explicit")

local no_anchor_plan, no_anchor_error = plugin.plan_insertions({
    event(15, 1, 1),
}, {
    event(10, nil, 1),
}, occupied(45))

assert_equal(no_anchor_plan, nil, "destination without cue anchors is rejected")
assert_contains(no_anchor_error, "aucun événement assigné", "missing track anchors are explicit")

-- Le filtre « une cue » conserve toutes les occurrences ; le filtre nil les prend toutes.
local filtered_events = {
    { cue = { handle_key = "cue-a" }, order = 1 },
    { cue = { handle_key = "cue-b" }, order = 2 },
    { cue = { handle_key = "cue-a" }, order = 3 },
    { cue = nil, order = 4 },
}
assert_equal(
    #plugin.filter_source_events(filtered_events, "cue-a"),
    2,
    "single-cue selection keeps all its occurrences"
)
assert_equal(
    #plugin.filter_source_events(filtered_events, nil),
    3,
    "all-cues selection keeps all assigned events"
)

-- Simulation minimale d'objets Programmer.
local function fake_object(class_name, children, properties)
    local object = {
        _class = class_name,
        _children = children or {},
        _properties = properties or {},
    }

    function object:GetClass()
        return self._class
    end

    function object:Children()
        return self._children
    end

    function object:Get(property)
        return self._properties[property]
    end

    return object
end

local empty_programmer = fake_object("Programmer", {
    fake_object("ProgrammerPart", {
        fake_object("SelectionGrid"),
    }),
})
local full_programmer = fake_object("Programmer", {
    fake_object("ProgrammerPart", {
        fake_object("ProgPhaser"),
    }),
})
local explicit_full_programmer = fake_object("Programmer", {}, {
    HasActiveValues = "Yes",
})

assert_true(not plugin.programmer_has_values(empty_programmer), "selection-only programmer is accepted")
assert_true(plugin.programmer_has_values(full_programmer), "programmer data is detected")
assert_true(plugin.programmer_has_values(explicit_full_programmer), "active-value property is detected")

-- Les commandes ne créent qu'une cue vide et un CmdEvent Go+.
local command_plan = assert(plugin.plan_insertions({
    event(12.345, 1, 1, "Impact"),
}, {
    event(10, 45, 1),
    event(20, 46, 2),
}, occupied(45, 46)))

local commands = plugin.build_commands({
    destination_sequence_address = "DataPool 1 Sequence 101",
    destination_subtrack_address = "Timecode 1.1.2.1.1",
    source_sequence_name = "Bump Rouge",
    used_event_indices = { [1] = true, [3] = true },
    first_free_event_index = 2,
}, command_plan)

assert_equal(#commands, 6, "one insertion emits six commands")
assert_equal(
    commands[1].command,
    "Store DataPool 1 Sequence 101 Cue 45.1 /Overwrite",
    "cue is explicitly stored at the computed number"
)
assert_equal(
    commands[2].command,
    'Label DataPool 1 Sequence 101 Cue 45.1 "Impact"',
    "source cue label is reused"
)
assert_equal(
    commands[3].command,
    "Store Timecode 1.1.2.1.1.2 /Overwrite",
    "first free event index is used"
)
assert_contains(commands[4].command, '"TIME" "12.345"', "source time is retained")
assert_contains(commands[5].command, '"TOKEN" "Go+"', "destination token is Go+")
assert_equal(
    commands[6].command,
    "Assign DataPool 1 Sequence 101 Cue 45.1 At Timecode 1.1.2.1.1.2",
    "new cue is assigned to the new event"
)

local all_commands = {}
for _, command in ipairs(commands) do
    all_commands[#all_commands + 1] = command.command
end
local command_text = table.concat(all_commands, "\n")

assert_not_contains(command_text, " Part ", "no CuePart is created")
assert_not_contains(command_text, "StandardRecipe", "no recipe is created")
assert_not_contains(command_text, "Cook ", "empty cue does not cook a sequence")
assert_not_contains(command_text, "Copy ", "source cue content is not copied")
assert_not_contains(command_text, "Delete ", "source events are not deleted")

-- Toutes les écritures reçoivent le même undo et une erreur déclenche Oops.
local captured = {}
local undo_handle = {}
local runtime = {
    create_undo = function(name)
        assert_equal(name, plugin.CONFIG.undo_name, "undo group is named")
        return undo_handle
    end,
    close_undo = function(handle)
        assert_equal(handle, undo_handle, "same undo group is closed")
        return true
    end,
    cmd_indirect_wait = function(command, undo)
        captured[#captured + 1] = { command = command, undo = undo }
    end,
    cue_exists = function()
        return true
    end,
    object_exists = function()
        return true
    end,
}

assert_true(plugin.execute_commands(runtime, commands), "command batch succeeds")
assert_equal(#captured, #commands, "all commands are executed")
for _, call in ipairs(captured) do
    assert_equal(call.undo, undo_handle, "every mutation belongs to the undo group")
end

local failed_calls = {}
local failed_runtime = {
    create_undo = function()
        return undo_handle
    end,
    close_undo = function()
        return true
    end,
    cmd_indirect_wait = function(command, undo)
        failed_calls[#failed_calls + 1] = { command = command, undo = undo }
        if #failed_calls == 2 then
            error("échec simulé")
        end
    end,
}

local failed, failure_message = plugin.execute_commands(
    failed_runtime,
    commands
)
assert_equal(failed, nil, "failed command batch reports failure")
assert_contains(failure_message, "échec simulé", "original execution error is retained")
assert_equal(
    failed_calls[#failed_calls].command,
    "Oops",
    "failed batch is rolled back"
)
assert_equal(
    failed_calls[#failed_calls].undo,
    nil,
    "rollback is outside the closed undo group"
)

-- Contrôle statique : aucune écriture directe via l'API objet Lua.
local source_file = assert(io.open("grandma3/R2MA_Bump_To_Main.lua", "r"))
local source_text = source_file:read("*a")
source_file:close()

assert_not_contains(source_text, ":Set(", "plugin never mutates an object through Lua Set")
assert_contains(source_text, "CmdIndirectWait", "plugin uses CmdIndirectWait for mutations")

REAPER2MA_BUMP_TO_MAIN_TEST_MODE = nil

print(string.format(
    "grandMA3 bump-to-main tests passed (%d assertions)",
    assertions
))
