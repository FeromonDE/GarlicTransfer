#!/usr/bin/env python3
import argparse
from contextlib import ExitStack
import json
import os
import stat
import tempfile
import threading
from pathlib import Path, PurePosixPath, PureWindowsPath
import zipfile
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo


def archive_parts(name):
    normalized = name.replace("\\", "/")
    parts = PurePosixPath(normalized).parts
    if (
        not normalized
        or normalized.startswith("/")
        or "\x00" in normalized
        or ".." in parts
        or (parts and parts[0].endswith(":"))
    ):
        raise ValueError(f"unsafe archive path: {name!r}")
    return parts


def extract_archive(archive, workspace):
    archive = Path(archive).expanduser()
    workspace = Path(workspace).expanduser()
    if workspace.exists() and any(workspace.iterdir()):
        raise ValueError("the decrypted workspace is not empty")
    workspace.mkdir(parents=True, exist_ok=True)
    root = workspace.resolve()
    with ZipFile(archive) as source:
        for item in source.infolist():
            parts = archive_parts(item.filename)
            if stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError(f"archive links are not supported: {item.filename}")
            destination = root.joinpath(*parts)
            destination.resolve().relative_to(root)
            if item.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            with source.open(item) as input_stream, destination.open("xb") as output_stream:
                while chunk := input_stream.read(0x200000):
                    output_stream.write(chunk)
    return workspace


def pack_workspace(workspace, archive):
    workspace = Path(workspace).expanduser()
    archive = Path(archive).expanduser()
    if not workspace.is_dir():
        raise ValueError("select an existing decrypted workspace")
    archive.parent.mkdir(parents=True, exist_ok=True)
    temporary = archive.with_name(archive.name + ".tmp")
    root = workspace.resolve()
    try:
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED, compresslevel=6) as output:
            for current, directories, files in os.walk(root):
                directories.sort()
                files.sort()
                current_path = Path(current)
                relative_directory = current_path.relative_to(root).as_posix()
                if not files and current_path != root:
                    output.writestr(relative_directory + "/", "")
                for name in files:
                    path = current_path / name
                    if path.is_symlink() or not path.is_file():
                        raise ValueError(f"workspace links are not supported: {path}")
                    output.write(path, path.relative_to(root).as_posix())
        os.replace(temporary, archive)
    finally:
        if temporary.exists():
            temporary.unlink()
    return archive


CLASSIC_ZIP_SIZE = 0xFFFFFFFF
CLASSIC_ZIP_ENTRIES = 0xFFFF
_local_zip_lock = threading.RLock()


# Function Local Paths
def local_archive_name(name, directory=False):
    parts = archive_parts(name)
    if not parts or PureWindowsPath(name).drive or any(":" in part for part in parts):
        raise ValueError(f"unsafe archive path: {name!r}")
    normalized = "/".join(parts) + ("/" if directory else "")
    if len(normalized.encode("utf-8")) >= 512:
        raise ValueError(f"archive path is too long for the local worker: {name!r}")
    return normalized


# Function Local Entries
class LocalEntries:
    def __init__(self):
        self.entries = []
        self.files = set()
        self.directories = set()
        self.explicit_directories = set()
        self.bytes = 22

    def add(self, name, size, directory, opener=None, mode=0):
        name = local_archive_name(name, directory)
        if size < 0 or size > CLASSIC_ZIP_SIZE or (directory and size):
            raise ValueError(f"invalid local archive file size: {name!r}")
        parts = PurePosixPath(name).parts
        key = name.rstrip("/").casefold()
        if size < 0 or size > CLASSIC_ZIP_SIZE:
            raise ValueError(f"file is too large for the local worker: {name}")
        if directory and size:
            raise ValueError(f"archive directory contains file data: {name}")
        if key in self.files or (not directory and key in self.directories) or key in self.explicit_directories:
            raise ValueError(f"duplicate archive path or file collision: {name}")
        for count in range(1, len(parts)):
            parent = "/".join(parts[:count]).casefold()
            if parent in self.files:
                raise ValueError(f"archive file and directory collide: {name}")
            self.directories.add(parent)
        if directory:
            self.directories.add(key)
            self.explicit_directories.add(key)
        else:
            self.files.add(key)
        self.bytes += size + 76 + 2 * len(name.encode("utf-8"))
        if len(self.entries) >= CLASSIC_ZIP_ENTRIES or self.bytes > CLASSIC_ZIP_SIZE:
            raise ValueError("the local worker requires a classic ZIP smaller than 4 GiB with at most 65535 entries")
        self.entries.append((name, size, directory, opener, mode))


# Function Local Reading
def open_local_file(path, expected_size):
    if path.is_symlink():
        raise ValueError(f"save links are not supported: {path}")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0))
    try:
        details = os.fstat(descriptor)
        if not stat.S_ISREG(details.st_mode) or details.st_size != expected_size:
            raise ValueError(f"save file changed while preparing it: {path}")
        return os.fdopen(descriptor, "rb")
    except BaseException:
        os.close(descriptor)
        raise


# Function Local Packing
def write_local_archive(entries, archive):
    if not entries.files:
        raise ValueError("choose at least one save file for the local worker")
    archive.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=archive.name + ".", suffix=".tmp", dir=archive.parent)
    os.close(descriptor)
    temporary = Path(name)
    try:
        # The helper runs in its own Python process. Prechecked classic limits
        # replace zipfile's conservative 2 GiB threshold and 5% size reserve.
        with _local_zip_lock:
            previous_limit = zipfile.ZIP64_LIMIT
            zipfile.ZIP64_LIMIT = CLASSIC_ZIP_SIZE * 2
            try:
                with ZipFile(temporary, "w", compression=ZIP_STORED, allowZip64=False) as output:
                    for name, size, directory, opener, mode in entries.entries:
                        item = ZipInfo(name)
                        item.compress_type = ZIP_STORED
                        item.file_size = size
                        item.external_attr = (mode or (stat.S_IFDIR | 0o755 if directory else stat.S_IFREG | 0o644)) << 16
                        if directory:
                            item.external_attr |= 0x10
                            output.writestr(item, b"")
                            continue
                        with opener() as source, output.open(item, "w", force_zip64=False) as destination:
                            copied = 0
                            while chunk := source.read(0x200000):
                                copied += len(chunk)
                                if copied > size:
                                    raise ValueError(f"save file changed while preparing it: {name}")
                                destination.write(chunk)
                            if copied != size:
                                raise ValueError(f"save file is truncated: {name}")
            finally:
                zipfile.ZIP64_LIMIT = previous_limit
        if temporary.stat().st_size > CLASSIC_ZIP_SIZE:
            raise ValueError("the local worker requires a classic ZIP smaller than 4 GiB")
        os.replace(temporary, archive)
    finally:
        temporary.unlink(missing_ok=True)
    return archive


# Function Local Workspace
def pack_local_workspace(workspace, archive):
    workspace = Path(workspace).expanduser()
    archive = Path(archive).expanduser()
    if workspace.is_symlink() or not workspace.is_dir():
        raise ValueError("select an existing decrypted workspace without links")
    root = workspace.resolve()
    if archive.resolve().is_relative_to(root):
        raise ValueError("save the local archive outside the decrypted workspace")
    entries = LocalEntries()
    for current, directories, files in os.walk(root):
        directories.sort()
        files.sort()
        current = Path(current)
        for name in directories:
            path = current / name
            if path.is_symlink() or not stat.S_ISDIR(path.lstat().st_mode):
                raise ValueError(f"workspace links are not supported: {path}")
            entries.add(path.relative_to(root).as_posix(), 0, True)
        for name in files:
            path = current / name
            details = path.lstat()
            if not stat.S_ISREG(details.st_mode):
                raise ValueError(f"workspace links or special files are not supported: {path}")
            size = details.st_size
            entries.add(path.relative_to(root).as_posix(), size, False,
                        lambda path=path, size=size: open_local_file(path, size), details.st_mode)
    return write_local_archive(entries, archive)


# Function Local Inputs
def pack_local_inputs(archive, inputs):
    archive = Path(archive).expanduser()
    entries = LocalEntries()
    with ExitStack() as stack:
        for selected in inputs:
            selected = Path(selected).expanduser()
            details = selected.lstat()
            if not stat.S_ISREG(details.st_mode):
                raise ValueError(f"save links or special files are not supported: {selected}")
            if selected.resolve() == archive.resolve():
                raise ValueError("save the local archive separately from its input files")
            if selected.suffix.lower() == ".zip" or zipfile.is_zipfile(selected):
                source = stack.enter_context(ZipFile(selected))
                file_count = 0
                for item in source.infolist():
                    mode = item.external_attr >> 16
                    kind = stat.S_IFMT(mode)
                    if kind not in (0, stat.S_IFREG, stat.S_IFDIR):
                        raise ValueError(f"archive links or special files are not supported: {item.filename}")
                    directory = item.is_dir() or kind == stat.S_IFDIR
                    file_count += not directory
                    entries.add(item.filename, item.file_size, directory,
                                lambda source=source, item=item: source.open(item), mode)
                if not file_count:
                    raise ValueError(f"ZIP input contains no save files: {selected.name}")
            else:
                size = details.st_size
                entries.add(selected.name, size, False,
                            lambda selected=selected, size=size: open_local_file(selected, size), details.st_mode)
        return write_local_archive(entries, archive)


def main():
    parser = argparse.ArgumentParser(description="Safely unpack and repack GarlicTransfer save workspaces")
    subparsers = parser.add_subparsers(dest="command", required=True)
    extract = subparsers.add_parser("extract")
    extract.add_argument("archive")
    extract.add_argument("workspace")
    pack = subparsers.add_parser("pack")
    pack.add_argument("workspace")
    pack.add_argument("archive")
    local_pack = subparsers.add_parser("local-pack")
    local_pack.add_argument("workspace")
    local_pack.add_argument("archive")
    local_inputs = subparsers.add_parser("local-inputs")
    local_inputs.add_argument("archive")
    local_inputs.add_argument("inputs", nargs="+")
    args = parser.parse_args()
    try:
        if args.command == "extract":
            result = extract_archive(args.archive, args.workspace)
            output = {"workspace": str(result)}
        elif args.command == "pack":
            result = pack_workspace(args.workspace, args.archive)
            output = {"archive": str(result), "bytes": result.stat().st_size}
        else:
            result = (pack_local_workspace(args.workspace, args.archive)
                      if args.command == "local-pack" else pack_local_inputs(args.archive, args.inputs))
            output = {"archive": str(result), "bytes": result.stat().st_size}
        print(json.dumps(output), flush=True)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError) as exc:
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    main()
