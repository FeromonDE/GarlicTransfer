GarlicTransfer main - Local Oracle Test5 Cleanup
App version: 0.3.2
Base: earthonion/GarlicTransfer main, 26b36b1bce4d83f8f8b6e26cd6b0f41a255835b6

INSTALL
The Local Oracle test Windows ZIP is a complete portable x64 build.
Extract it into a new folder and run GarlicTransfer.exe.
Python is bundled; no separate Python installation is needed.
For the Test5 update ZIP, close GarlicTransfer and merge its resources folder
into an existing Local Oracle Test1/2/3/4 installation, replacing matching files.
Run GarlicTransfer.exe normally; the existing Python files are reused.
Test5 includes all previous Local PC, local worker and cleanup changes.

LOCAL PC SAVES
In Local files / My Saves, choose Local PC in the Console selector.
Click Browse folder and choose Saves/<USER>/PPSA##### or Saves/PPSA#####.
A parent containing Saves, a user folder or a single PPSA folder also works.
The selected folder and source are remembered. No transfer metadata is needed.
Saves without a user folder appear under Unassigned.
These folders must contain encrypted PS5 saves; arbitrary files are not saves.
Save & encrypt replaces the selected PC save after making a recovery backup.
Matching .bin sidecars stay associated with their save container.
Upload to PS5 stages all recognized encrypted files in the selected PPSA folder.
Choose the actual destination PS5 user in the upload dialog; a PC user-folder
name only groups files and does not set the account ID.
The editor More-menu fix and upstream save context-menu styles are included.

LOCAL SAVE PROCESSING
With Use GarlicWorker off, Decrypt/Encrypt/Resign use your local PS5.
Enter the local PS5 IPv4 address and start its ELF payload listener on 9021.
Local mode does not require a Server URL or server key.
With Use GarlicWorker on, the existing Server URL and key are used instead.
The bundled combined helper provides transfer keys on 9022 and local save
jobs on 9023. It is sent when needed; an existing compatible helper is reused.
Local inputs are packed and validated before helper startup. Each file and
its complete packed archive must fit below 4 GiB.
Results become available only after complete receipt and successful completion.
The helper binary and save-processing code are unchanged from Test2.

LOCAL ADDITIONS CLEANUP
- Transfers and save editing share helper startup and connection checks.
- Cancel stops the app request and waits for cleanup before another save job.
- Remote deadlines cover uploads, status requests, polling and result downloads.
- A busy helper port waits for readiness without deploying another helper.
- Inactive Local PC folders avoid scans; user filters reuse loaded inventory.
- Refresh and file operations still validate current files and selected titles.
- Workspace details and account IDs share one folder walk without stale caching.
- Edited files use unique staging; failed writes preserve the original file.
- Add files checks conflicting names before copying and rolls back its new
  files if copying or the final workspace refresh fails.
- Failed Local PC exports and upload preparation clean up their owned files.
- Generated temporary files are released after their consumers finish; open
  workspaces remain available while editing, exporting or running save jobs.
- Original saves, recovery backups and user-selected folders are preserved.
- Existing temporary folders from earlier app sessions are not swept.
- Function notes remain short, such as Function Workspace Scan.

Cancel or timeout closes the app request. A PS5 or remote worker may finish
its current processing after the app disconnects.
Save changes updates the decrypted workspace; encrypt or export files to keep
those edits. Closing or replacing a generated workspace releases its temporary
files after confirmation, including confirmation for unencrypted saved edits.

EXTERNAL SKINS
Choose a skin in the left sidebar below USER - source saves.
The skin selector and small Open/Reload buttons are sidebar-only; the
Appearance card has been removed from Settings. Garlic Classic remains available.
Spicy Garlic, Chill Onion, Onion, Green Onion and Evil Onion are included.
Each now uses skin.json and mascot.png; all share one tree stylesheet.
The sidebar Open button opens %root%/Skins beside GarlicTransfer.exe.
External skins now load only from that folder. Copy any existing AppData
skin folders into it to keep using them; nothing is moved automatically.
Copy the provided skin-template/my-onion folder into that opened folder.
Edit its skin.json name/colors and replace mascot.png with your PNG.
Click Reload in the sidebar, then select My Onion. No rebuild is needed.
Skin files contain data and PNG only.
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
263 Node 22 tests and 105 Python tests passed (368 total).
Targeted compatibility checks also passed under Node 18.
The packaged Electron files match the tested source.
See BUILD-NOTES.txt in the source archive for detailed validation results.
Image failure behavior is tested through simulated browser error events.
No rendered Windows appearance or live PS5 test performed.

CONTENTS
The update ZIP contains resources/app.asar and matching helper resources.
The source ZIP opens directly at the project root, with source and tests.
skin-template/my-onion/: editable external add-in example.
poc/local_worker/: matching helper source and GPL license.

MASCOT LOADING FIX (v0.3.3)
Mascots remain invisible until their image load event. The reserved image
space prevents name/alt-text flashes and layout jumps, including fallback
loading. Unchanged loaded mascots stay visible on reload.
The mascot code matches the full-resources build from before the size cleanup.

CI DEPENDENCIES
The identity-check workflow installs locked development dependencies before
testing. This includes jsdom for the skin and tree tests. Install scripts
are skipped in that test job because the Electron binary is not needed.

WINDOWS DATABASE CLEANUP
SQLite readers and test fixtures close their connections explicitly, including
query failures. This releases database files before temporary-folder cleanup.
POSIX privilege tests run only on POSIX; Windows pairing behavior has a separate
test. All languages, plain title lists and original artwork are retained.
