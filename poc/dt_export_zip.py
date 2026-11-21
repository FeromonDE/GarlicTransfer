#!/usr/bin/env python3
"""Bundle an already-downloaded library entry's save files into one portable
ZIP archive, and the reverse: unpack one of these archives (or any plain ZIP
of save files) back into a flat folder ready to use with GarlicTransfer's
existing "Add save folder..." external-upload path.

Today, getting a downloaded, multi-file save (e.g. a GTA V/VI save with 4+
files) off this machine -- to back it up, or to hand it to someone else for
upload to a different account -- means copying the files out one at a time.
This adds the missing "whole save, one zip" step on both ends:

  export  an already-downloaded entry  -> one .zip (all its files, together)
  extract that .zip (or any zip of save files) -> a folder GarlicTransfer's
          existing "Add save folder..." upload path already understands

No changes to the upload pipeline itself: extract() hands back a plain
folder of files, exactly what a user would get from manually unzipping
something and pointing "Add save folder..." at it today -- this only
automates that step and (when the zip carries our marker file) saves
re-typing the PPSA title ID.
"""
import argparse
import json
import zipfile
from pathlib import Path

from poc.dt_layout import profile_root, read_manifest_entry, existing_payload
from poc.dt_metadata import infer_title_id

MARKER_NAME = "_export_info.json"
MANIFEST_NAME = "_export_manifest.json"
PAYLOAD_PREFIX = "payload/"
MAX_EXTRACT_BYTES = 8 * 1024 * 1024 * 1024


def export_entry(root, entry_id, archive_path):
    """Zip every file in a downloaded entry into one archive at archive_path.
    Returns (archive_path, title_id, file_count)."""
    root = profile_root(root)
    archive_path = Path(archive_path).expanduser()
    archive_path.parent.mkdir(parents=True, exist_ok=True)

    _, entry = read_manifest_entry(root, entry_id)
    files = entry.get("files") or []
    if not files:
        raise ValueError(f"entry {entry_id} has no files on disk")

    title_id = infer_title_id(None, files)

    temp = archive_path.with_name(archive_path.name + ".tmp")
    try:
        with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
            # Our own save files are already encrypted/compressed containers,
            # so ZIP_STORED (no further compression) avoids burning CPU for
            # no size benefit.
            zf.writestr(MARKER_NAME, json.dumps({
                "title_id": title_id,
                "entry_id": entry_id,
                "file_count": len(files),
            }, indent=2) + "\n")
            zf.writestr(MANIFEST_NAME, json.dumps(entry, indent=2) + "\n")
            for item in files:
                source = existing_payload(root, entry_id, item)
                if source is None:
                    raise ValueError(f"save file missing on disk: {item['file']}")
                zf.write(source, arcname=PAYLOAD_PREFIX + item["file"])
        temp.replace(archive_path)
    finally:
        temp.unlink(missing_ok=True)
    return archive_path, title_id, len(files)


def _safe_relative_name(name):
    """Strip our payload/ prefix and reject anything that isn't a single,
    unnested file name -- defends extraction against a crafted zip that
    tries to write outside the destination folder."""
    relative = name[len(PAYLOAD_PREFIX):] if name.startswith(PAYLOAD_PREFIX) else name
    if not relative or relative in (".", "..") or "/" in relative or "\\" in relative or "\x00" in relative:
        raise ValueError(f"unsafe archive path: {name!r}")
    return relative


def extract_for_upload(archive_path, workspace):
    """Extract archive_path into workspace as a flat folder of save files.
    Recognizes our own export layout (payload/<file> + marker) but also
    accepts a plain zip of files with no subfolders. Returns the detected
    title ID, or '' if none could be determined."""
    archive_path = Path(archive_path).expanduser()
    workspace = Path(workspace).expanduser()
    workspace.mkdir(parents=True, exist_ok=True)
    if any(workspace.iterdir()):
        raise ValueError("the extraction folder is not empty")

    title_id = ""
    with zipfile.ZipFile(archive_path) as zf:
        names = zf.namelist()
        has_payload_prefix = any(name.startswith(PAYLOAD_PREFIX) for name in names)
        if MARKER_NAME in names:
            try:
                title_id = json.loads(zf.read(MARKER_NAME)).get("title_id", "") or ""
            except (json.JSONDecodeError, AttributeError):
                title_id = ""

        extracted = 0
        total_size = 0
        output_names = set()
        for info in zf.infolist():
            name = info.filename
            if name in (MARKER_NAME, MANIFEST_NAME) or name.endswith("/"):
                continue
            if has_payload_prefix and not name.startswith(PAYLOAD_PREFIX):
                continue  # ignore anything outside payload/ once our own layout is present
            relative = _safe_relative_name(name)
            if relative in output_names:
                raise ValueError(f"duplicate archive path: {relative!r}")
            output_names.add(relative)
            total_size += info.file_size
            if total_size > MAX_EXTRACT_BYTES:
                raise ValueError("the ZIP expands beyond the 8 GiB extraction limit")
            destination = workspace / relative
            with zf.open(info) as source, destination.open("xb") as output:
                while chunk := source.read(0x200000):
                    output.write(chunk)
            extracted += 1

    if not extracted:
        raise ValueError("the ZIP contained no save files")
    return title_id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    export = subparsers.add_parser("export", help="bundle a downloaded entry into one zip")
    export.add_argument("--library", required=True, help="SaveLibrary/<console-id> folder")
    export.add_argument("--entry-id", required=True, type=int)
    export.add_argument("--out", required=True, help="destination .zip path")

    extract = subparsers.add_parser("extract", help="unpack a zip into a plain save folder")
    extract.add_argument("--archive", required=True)
    extract.add_argument("--out", required=True, help="destination folder (must not already exist/be non-empty)")

    args = parser.parse_args()
    if args.command == "export":
        path, title_id, count = export_entry(args.library, args.entry_id, args.out)
        print(json.dumps({"archive": str(path), "title_id": title_id, "file_count": count}))
    else:
        title_id = extract_for_upload(args.archive, args.out)
        print(json.dumps({"folder": str(Path(args.out).expanduser()), "title_id": title_id}))


if __name__ == "__main__":
    main()
