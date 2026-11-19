# External skins

Use the **Skin** selector in the left sidebar below **USER · source saves**.
Click **Open** to open the Skins folder. Copy a folder such as `my-onion`
there, click **Reload**, and select its name. The choice saves automatically.
The controls remain available in Garlic Classic. Restarting also discovers skins.
The external folder is `%root%/Skins`, beside `GarlicTransfer.exe`.
For example, `D:/Mods/GarlicTransfer/Skins/my-onion/skin.json` and
`D:/Mods/GarlicTransfer/Skins/my-onion/mascot.png`.
Use the sidebar Open button for the exact location. When running from source,
`Skins` is under the project root. The folder stays outside app.asar.
Existing skins in the old AppData location can be copied into this folder;
they are not moved automatically. The app now scans the root folder only.

Each add-in is one folder, named with lowercase letters, digits and hyphens
(start with a letter; maximum 48 characters). Example:

```text
my-onion/
  skin.json
  mascot.png
```

```json
{
  "version": 1,
  "name": "My Onion",
  "mode": "dark",
  "mascot": "mascot.png",
  "colors": {
    "primary": "#316b35",
    "primary-hover": "#3c8040",
    "primary-border": "#8ade72",
    "skin-accent": "#8ade72"
  }
}
```

Use `light` or `dark` mode. Names longer than 40 characters display as `NAME-TO-LONG`; the skin still loads.
Empty names remain invalid. Colors: six-digit
`#RRGGBB`. Omitted colors inherit readable defaults for the selected mode.
For full control copy the included template, which lists every color.
If supplied, `mode` must be `light` or `dark`, and `colors` must be a JSON
object. Unknown color keys are ignored. No HTML, CSS, scripts, remote assets, or fonts
are loaded from add-ins. Names display as plain text.

| Color | Purpose |
| --- | --- |
| bg, bg-main, bg-sidebar | Window, main area, sidebar |
| bg-card, bg-input, bg-status | Cards, inputs, status area |
| text, text-2, text-3 | Main, secondary, hint text |
| border, border-focus | Control borders |
| primary, primary-hover, primary-border | Main action buttons |
| gold, success, danger, danger-border | Status and destructive actions |
| skin-panel, skin-hover, skin-selected | Navigation, hover and selection |
| skin-accent, skin-edge, skin-edgeFocus | Accent and tree borders |
| skin-input, skin-inputEdge, skin-focus | Tree background and focus |
| skin-text, skin-muted, skin-link | Tree text, details and file links |
| primary-text, primary-hover-text | Optional button foregrounds |
| skin-hover-text, skin-selected-text | Optional hover and selection foregrounds |

Artwork must be a local PNG filename in that same folder, up to 4 MiB.
Square transparent artwork works best; it displays at about 78 px. Missing
or invalid artwork falls back to the bundled Spicy Garlic mascot. Files
outside the skin folder and linked directories are not loaded. JSON is
limited to 64 KiB. Invalid skin metadata is skipped with a sidebar warning.
Core text/background pairs need contrast of at least 4.5:1; otherwise the
whole palette falls back to that mode's defaults, with a message.

External IDs are generated as `ext-<folder-name>` and cannot replace bundled
IDs. Keep the folder name unchanged to preserve the saved choice. After
editing, click Reload. Existing source filters/selections stay in place.
If a selected folder disappears or becomes invalid, Garlic Classic appears;
the preference remains saved so restoring the folder restores it on restart.

Bundled skin definitions are in `Source/electron/skins`. Copy any of them
into the opened add-in folder under a new folder name and edit its display
name. The shared layout and backend operations remain controlled by the app.

Button, hover and selection foregrounds are chosen automatically when omitted.
If an explicit foreground is unreadable over its background, black or white
is chosen and a message is shown. These optional keys preserve older packs.
Reloads ignore outdated results and retain skin choices made while loading.
Long sidebar names wrap, and names over 40 trimmed characters still display
as NAME-TO-LONG. Changes remain limited to appearance and tree presentation.

## Loading and testing

The list is sorted by display name, with Garlic Classic first. Reload
checks file details and reuses unchanged JSON and artwork. Mascot files are
read and sent to the window only when selected; unchanged selected artwork
stays in place on reload. PNG content errors therefore appear when that
skin is selected. Edited files are refreshed using file identity, size,
modification time and change time. Metadata caching is bounded to 256 files,
and artwork caching to eight images.

Warnings have a separate expandable list below the sidebar skin controls. Saving a skin does
not hide them. Reload after correcting a file to refresh its warnings.
Color changes and reloads within the tree layout preserve tree elements,
scroll, expansion and selection. Entering Settings does not rebuild trees.
Function notes use short identifiers such as `Function Skin Loading`.

The shared tree uses indexed user/title/entry identities for downloaded files.
Changing selection updates checkboxes and labels without a full rebuild.
Inventory refreshes keep scroll, expansion and matching focus when possible;
removed items do not receive focus. Refreshing the same local profile preserves
the selected save. These changes do not require skin-pack changes.

Collapsed branches remain remembered when user filters hide them. Their memory
is bounded and resets when the console or local profile changes. Hidden Classic
save tables are skipped in tree mode and refreshed on a switch back to Classic.
Other-content tables stay available in both layouts.

If a PNG passes file checks but the browser cannot display it, the bundled
mascot is tried once. A second failure hides the broken image and reports a
sidebar warning. Escape from a context menu returns focus to the opening row
when that row is still available.
