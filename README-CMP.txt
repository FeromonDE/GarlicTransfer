GarlicTransfer 0.2.27 CMP Multi-file Upload

Windows update for an EXISTING upstream GarlicTransfer 0.2.26 or newer installation.
This is an app update, not a standalone EXE or an update for CMP Transfer.

INSTALL
1. Close GarlicTransfer.
2. Back up resources/app.asar and resources/poc/dt_backend.py and resources/poc/dt_metadata.py in your installation.
3. Copy the contents of Windows-Update/resources into your installation's resources folder, replacing those three files.
   Example: D:\Mods\GarlicTransfer\resources\
4. Start your existing GarlicTransfer.exe.
To undo, restore the three backed-up files.

USE
1. Browse console saves to obtain valid metadata and destination users.
2. Click Upload selected saves, then Add external save (single file) or Add save folder (multiple files).
3. Select an encrypted PS5 save file or a folder of encrypted save files for ONE PPSA title. Keep original filenames. No subfolders, links, or manifest.json.
4. Enter/verify PPSA title ID and destination user, then click Upload.
5. Follow the existing upload prompts.
Upload one external file or one folder at a time, separately from downloaded entries. All files in the folder form one save entry. Sizes and headers are generated per file. A fresh staging folder is used for every external upload.
This copies the container into staging and builds transfer headers, sizes and metadata.
It does not repair, decrypt, encrypt, or resign the container.
The save must already be compatible with the destination account.

Metadata inventory now opens read-only and rejects missing/empty/wrong-schema databases with an actionable error, without creating an empty database.

VALIDATION
JavaScript syntax checks passed.
External-save tests: 4 passed; inventory tests: 3 passed; metadata safety tests: 14 passed.
No live PS5 or Windows UI test performed.

SOURCE
Source/ contains the full modified upstream source snapshot.
Install Node.js 18+ and Python 3.10+, run npm install and pip install -r requirements.txt, then npm start.
See upstream README/build instructions for complete installers.
