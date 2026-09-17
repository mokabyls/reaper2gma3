# REAPER OSC Transport Macros for grandMA3

This project can generate a standalone grandMA3 macro library with eight transport macros that control REAPER over OSC.

The library is reusable across shows:

- it does not depend on a specific REAPER project;
- it does not record, write, or edit REAPER;
- it only sends transport and navigation commands.

## Generated Macros

The generated XML contains these macros, in this exact order:

1. `REAPER - REWIND`
2. `REAPER - PLAY`
3. `REAPER - PAUSE`
4. `REAPER - STOP`
5. `REAPER - NEXT MARKER`
6. `REAPER - PREV MARKER`
7. `REAPER - NEXT REGION`
8. `REAPER - PREV REGION`

Each macro contains one active grandMA3 command line.

The generated `SendOSC` commands use the numeric OSC slot ID, not the OSC line name.

Example:

```text
oscSlotId = 1
SendOSC 1 "/play,i,1"

oscSlotId = 3
SendOSC 3 "/play,i,1"
```

`oscDataName` is only a display/documentation name. It helps humans identify the OSC line in grandMA3, but it is not substituted into `SendOSC`.

## REAPER Configuration

In REAPER, open:

```text
Options
→ Preferences
→ Control/OSC/web
→ Add
→ OSC (Open Sound Control)
```

Recommended settings:

```text
Pattern config:
Default

Local listen port:
8000

Allow binding messages to REAPER actions and FX learn:
Enabled
```

The port does not have to be `8000`, but it must match the port configured in grandMA3.

## grandMA3 Configuration

In grandMA3, open:

```text
Menu
→ In & Out
→ OSC
→ Insert New OSC Data
```

Recommended settings:

```text
Name:
REAPER

Destination IP:
127.0.0.1 if grandMA3 onPC and REAPER are on the same computer

Destination IP:
the IPv4 address of the REAPER computer if they are on separate computers

Mode:
UDP

Port:
8000, or the same port configured in REAPER

Prefix:
empty

Enable Output:
Yes

Send Command:
Yes

Send:
No, unless you specifically need automatic OSC feedback

Echo Output:
Yes only while testing
```

### Why the prefix must stay empty

Leave the OSC prefix blank if you want the generated macros to send paths such as:

- `/play`
- `/pause`
- `/stop`
- `/action`

If you set a prefix, grandMA3 will prepend it to the outgoing OSC path, which would change the messages the generator is designed to send.

### Slot ID versus line name

The OSC line name and the OSC slot ID are two different values:

- the name is for display and documentation;
- the slot ID is the numeric identifier used by `SendOSC`.

If you move the OSC line to another grandMA3 project and it ends up in a different slot, regenerate the XML with the new `oscSlotId`.

## Same Computer Setup

When grandMA3 onPC and REAPER run on the same computer, use:

```text
Destination IP: 127.0.0.1
Mode: UDP
Port: 8000
```

If that does not work, check:

- Windows firewall access for both applications;
- the UDP port in both applications;
- whether REAPER is actually listening on the chosen port;
- whether the grandMA3 session is active;
- whether `Echo Output` helps during testing;
- whether the computer's real IPv4 address works better than `127.0.0.1`.

## Two Computer Setup

If REAPER and grandMA3 run on different computers:

- set grandMA3 `Destination IP` to the IPv4 address of the REAPER computer;
- keep the port identical in both applications;
- make sure both machines are on the same network, or have a valid route between them;
- allow inbound UDP traffic on the REAPER computer;
- prefer a fixed unicast address instead of broadcast when possible.

## Importing the Library

You can import the generated XML as a grandMA3 library file.

One common graphical workflow is:

```text
Change destination to Macro
Import library XML
Return to Root
```

One command-line style workflow is:

```text
ChangeDestination Macro
Import Library "reaper_transport_macros.xml"
ChangeDestination Root
```

The exact menu labels can vary slightly between grandMA3 versions, but the key point is that the file must be imported as a macro library, not as a show-specific cue stack.

## REAPER Region Macros

The transport macros for next/previous region use custom OSC paths:

- `/ma3/region/next`
- `/ma3/region/previous`

These paths only work if you map them in REAPER to actions or Custom Actions.

Typical setup:

```text
Actions
→ Show action list
→ select or create the desired action
→ Add shortcut
→ trigger the grandMA3 macro
```

Associate `/ma3/region/next` with the action or Custom Action that jumps to the next region.

Associate `/ma3/region/previous` with the action or Custom Action that jumps to the previous region.

The other six macros use commands or REAPER action IDs that are already embedded directly in the generated XML.

## Generator Options

The generator accepts these options:

```ts
interface ReaperMacroGeneratorOptions {
  oscSlotId?: number;
  oscDataName?: string;
  macroNamePrefix?: string;
  outputFileName?: string;
}
```

Defaults:

```ts
oscSlotId: 1
oscDataName: "REAPER"
macroNamePrefix: "REAPER - "
outputFileName: "reaper_transport_macros.xml"
```

`oscSlotId` must be a positive integer.

