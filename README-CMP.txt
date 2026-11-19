GarlicTransfer 0.3.3 CMP
App version: 0.3.3
Base: earthonion/GarlicTransfer v0.3.1, e25cbac4c0ebebd8ded508accc2e4826fa15b6ff

INSTALL
Use an existing complete GarlicTransfer v0.3.1 Windows installation.
Close the app and back up resources/app.asar and resources/poc/.
Copy Windows-Update/resources into the installation resources folder,
replace matching files, and run the existing GarlicTransfer.exe.
Only this package is needed; all previous CMP changes are included.
This is an update plus source package, not a standalone EXE installer.

EXTERNAL SKINS
Choose a skin in the left sidebar below USER - source saves.
The skin selector and small Open/Reload buttons are sidebar-only; the
Appearance card has been removed from Settings. Garlic Classic remains available.
Spicy Garlic, Chill Onion, Onion, Green Onion and Evil Onion are included.
Each now uses skin.json and mascot.png; all share one tree stylesheet.
The sidebar Open button opens %root%/Skins beside GarlicTransfer.exe.
External skins now load only from that folder. Copy any existing AppData
skin folders into it to keep using them; nothing is moved automatically.
Copy the provided Skin-Template/my-onion folder into that opened folder.
Edit its skin.json name/colors and replace mascot.png with your PNG.
Click Reload in the sidebar, then select My Onion. No rebuild is needed.
See SKINS.md for the complete format. Skin files contain data and PNG only.
Missing colors use light/dark defaults. Bad files report a message while
other skins load. Missing artwork uses the Spicy Garlic mascot. Low-contrast
text palettes fall back to readable defaults. A removed selected skin shows
Garlic Classic without deleting the saved preference.

INCLUDED FOLDER CHANGES
Saves/<user-id>/<PPSA or CUSA>/<encrypted-save-files>
Transfer-Metadata/ (databases, manifests and transfer metadata)
Other Needed Data/ (support files, backups and staging)
Save folders contain payloads only; existing legacy layouts remain readable.
Multi-file Add save folder uploads and short function notes remain included.
The tree uses the existing Garlic download, upload, editor, import/export
and resign workflows. Source-user filters do not change upload destination.
CMP Fix All, complete-save staging and completion tracking are not added.

SKIN OPTIMIZATIONS
- Mascots load only for the selected skin, rather than every listed skin.
- Unchanged definitions and artwork reuse bounded caches.
- Edited, deleted and invalid files are rechecked with normal fallback behavior.
- Same-layout skin changes and Settings navigation do not rebuild save trees.
- Scroll, focus, expanded branches and selections stay in place for color changes.
- Warnings have a separate expandable list and stay visible after saving.
- Skin options sort by display name, with Garlic Classic first.
- Function notes use short identifiers such as Function Skin Loading.
- Existing skin format, %root%/Skins and NAME-TO-LONG remain supported.
- All previous skin, folder and upload changes are included.

TREE CLEANUP
- Files match exact normalized user, game title and entry ID; no cross-entry fallback.
- Shared tree adapters replace duplicate upload/local wiring and repeated searches.
- Upload checkbox changes update selection and labels without rebuilding trees.
- Unchanged tree data reuses existing DOM while callbacks use current records.
- Changed inventory restores expansion, scroll and matching focus when possible.
- Local/global busy state consistently controls filters and tree actions.
- Keyboard context menus open once; latest actions are used after refresh.
- Refreshing the same profile retains the selected save and current workspace.
- Older local inventory responses cannot replace newer results.
- Basic function notes remain, such as Function Tree Refresh.

INCLUDED TREE CLEANUP
- Collapsed branches stay remembered while user filters hide/show them.
- Branch memory is bounded and clears for a different console/profile.
- Hidden Classic save tables are skipped in tree mode and built from current
  data on return to Classic. Other-content tables remain available.
- Mascots that fail browser decoding fall back once to the bundled mascot.
- If the fallback also fails, the broken image hides with a sidebar warning.
- Escape and menu actions restore focus to the opening row when appropriate.
- Outside clicks, refresh and removed rows do not steal keyboard focus.
- Function notes remain basic, such as Function Menu Focus.
- All previous changes and external skin formats are included.

VALIDATION
78 Node checks and 89 Python tests passed, plus syntax and whitespace checks.
Image failure behavior is tested through simulated browser error events.
No rendered Windows appearance or live PS5 test performed.

CONTENTS
Windows-Update/: app.asar and matching backend files.
Source/: complete modified source and tests.
Skin-Template/my-onion/: editable external add-in example.
SKINS.md: skin format and instructions.
Changes.patch: complete changes against the upstream commit above.

MASCOT LOADING FIX (v0.3.3)
Mascots remain invisible until their image load event. The reserved image
space prevents name/alt-text flashes and layout jumps, including fallback
loading. Unchanged loaded mascots stay visible on reload.
This source matches the full-resources build from before the size cleanup.
