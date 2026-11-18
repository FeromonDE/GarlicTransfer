GarlicTransfer 0.3.1 CMP Clean Folders Test2
App version: 0.3.1-cmp-clean2
Upstream base: https://github.com/earthonion/GarlicTransfer
Commit: e25cbac4c0ebebd8ded508accc2e4826fa15b6ff

INSTALL
Use with an existing complete GarlicTransfer v0.3.1 Windows installation,
including one already running the CMP Clean Folders Test1 update.
Close GarlicTransfer. Back up resources/app.asar and resources/poc/.
Copy Windows-Update/resources/ into the installation's resources/ folder.
Replace matching files and reopen the existing GarlicTransfer.exe.
Example: D:\Mods\GarlicTransfer\resources\
Only this Test2 package is needed. Do not apply an older CMP patch afterward.
This is an update and source package, not a standalone EXE installer.

TEST2 CLEANUP
- Centralized folder names and path construction.
- Browser and main process share electron/folder_paths.js.
- Both runtimes search manifests in this order:
  organized index, organized entry, legacy index, legacy entry.
- Missing entries in stale indexes fall back to individual manifests.
- Malformed index JSON can fall back to a readable individual manifest.
- New downloads explicitly write to the organized layout.
- Existing legacy files remain readable; they are not moved or deleted.
- Removed duplicate manifest-update and payload-lookup code.
- Added short function notes, for example Build metadata folder / Find selected payload.

UNCHANGED FOLDER LAYOUT (inside each console profile)
Saves/<user-id>/<PPSA##### or CUSA#####>/<encrypted-save-files>
Transfer-Metadata/metadata.db
Transfer-Metadata/manifest.json
Transfer-Metadata/<entry-id>/manifest.json
Transfer-Metadata/generated-metadata.db
Transfer-Metadata/generated-upload-manifest.json
Transfer-Metadata/dt-source.log
Other Needed Data/<entry-id>/<non-save-files>
Other Needed Data/Backups/<entry-id>/<editor-backups>
Other Needed Data/external-save-<timestamp>/<external-upload-staging>

New downloaded save folders contain payloads only, without manifests.
My Saves, Import/Export, uploads, external folder uploads, FTP and editor paths
retain organized and legacy support. Nested console save directories are preserved.
Full-save staging, completion tracking and startup cancellation changes are
separate work and are not included in this cleanup.

VALIDATION
89 Python tests passed; 19 Node tests passed.
JavaScript syntax checks and git diff whitespace checks passed.
Focused tests cover stale/corrupt indexes, legacy/new profiles, missing payloads,
Windows folder paths, renderer helper loading, and upload/editor workflows.
No live Windows/PS5 test has been performed for Test2.

CONTENTS
Windows-Update/: app.asar plus the matching backend modules and resources.
Source/: full modified source and tests.
Changes.patch: complete source patch against the upstream commit listed above.
