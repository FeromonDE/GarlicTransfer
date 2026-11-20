import json
import os
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import zipfile
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo

from poc.dt_save_editor import extract_archive, pack_workspace, pack_local_workspace, pack_local_inputs


class SaveEditorZipTests(unittest.TestCase):
    def make_archive(self, root):
        archive = root / "input.zip"
        with ZipFile(archive, "w") as output:
            output.writestr("DATA/sce_sys/param.sfo", b"sfo")
            output.writestr("DATA/empty.dat", b"")
            output.writestr("DATA/save.dat", b"payload")
            output.writestr("chives.json", json.dumps({"title_id": "PPSA12345"}))
            output.writestr("DATA/empty-folder/", b"")
        return archive

    def test_extract_and_pack_preserve_workspace(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = extract_archive(self.make_archive(root), root / "workspace")
            self.assertEqual((workspace / "DATA" / "save.dat").read_bytes(), b"payload")
            self.assertEqual((workspace / "DATA" / "empty.dat").read_bytes(), b"")
            self.assertTrue((workspace / "DATA" / "empty-folder").is_dir())
            packed = pack_workspace(workspace, root / "packed.zip")
            with ZipFile(packed) as archive:
                self.assertEqual(archive.read("DATA/save.dat"), b"payload")
                self.assertEqual(archive.read("DATA/empty.dat"), b"")
                self.assertIn("DATA/empty-folder/", archive.namelist())
                self.assertEqual(json.loads(archive.read("chives.json"))["title_id"], "PPSA12345")

    def test_extract_rejects_traversal_absolute_paths_and_links(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for index, name in enumerate(("../outside", "/absolute", "C:/drive")):
                archive = root / f"bad-{index}.zip"
                with ZipFile(archive, "w") as output:
                    output.writestr(name, b"bad")
                with self.assertRaisesRegex(ValueError, "unsafe archive path"):
                    extract_archive(archive, root / f"workspace-{index}")
            archive = root / "link.zip"
            info = ZipInfo("DATA/link")
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            with ZipFile(archive, "w") as output:
                output.writestr(info, b"target")
            with self.assertRaisesRegex(ValueError, "links are not supported"):
                extract_archive(archive, root / "link-workspace")

    def test_extract_does_not_overwrite_existing_workspace(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = root / "workspace"
            workspace.mkdir()
            (workspace / "keep").write_bytes(b"keep")
            with self.assertRaisesRegex(ValueError, "not empty"):
                extract_archive(self.make_archive(root), workspace)
            self.assertEqual((workspace / "keep").read_bytes(), b"keep")

    @unittest.skipIf(os.name == "nt", "POSIX symlink check")
    def test_pack_rejects_workspace_links(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = root / "workspace"
            workspace.mkdir()
            (root / "target").write_bytes(b"target")
            (workspace / "link").symlink_to(root / "target")
            with self.assertRaisesRegex(ValueError, "links are not supported"):
                pack_workspace(workspace, root / "packed.zip")



class LocalWorkerZipTests(unittest.TestCase):
    def assert_stored_classic(self, archive):
        raw = archive.read_bytes()
        self.assertNotIn(b"PK\x06\x06", raw)
        with ZipFile(archive) as result:
            self.assertIsNone(result.testzip())
            for item in result.infolist():
                self.assertEqual(item.compress_type, ZIP_STORED)
                self.assertFalse(item.flag_bits & 8, "data descriptors are unsupported by the worker")
                self.assertLess(item.extract_version, 45, "ZIP64 is unsupported by the worker")
                offset = item.header_offset
                self.assertEqual(struct.unpack_from("<I", raw, offset + 14)[0], item.CRC)
                self.assertEqual(struct.unpack_from("<I", raw, offset + 18)[0], item.file_size)
                self.assertEqual(struct.unpack_from("<I", raw, offset + 22)[0], item.file_size)

    def test_workspace_preserves_geometry_metadata_files_and_empty_folders(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = root / "workspace"
            (workspace / "DATA" / "sce_sys").mkdir(parents=True)
            (workspace / "DATA" / "empty").mkdir()
            (workspace / "DATA" / "sce_sys" / "param.sfo").write_bytes(b"sfo")
            (workspace / "DATA" / "save.dat").write_bytes(b"game" * 100)
            (workspace / "chives.json").write_text('{"block_size_bytes":65536}')
            (workspace / "PS5KEY").write_bytes(b"original key")
            archive = pack_local_workspace(workspace, root / "stored.zip")
            self.assert_stored_classic(archive)
            with ZipFile(archive) as result:
                self.assertEqual(result.read("chives.json"), b'{"block_size_bytes":65536}')
                self.assertEqual(result.read("PS5KEY"), b"original key")
                self.assertEqual(result.read("DATA/save.dat"), b"game" * 100)
                self.assertIn("DATA/empty/", result.namelist())
            remote_archive = pack_workspace(workspace, root / "remote.zip")
            with ZipFile(remote_archive) as result:
                self.assertEqual(result.getinfo("DATA/save.dat").compress_type, ZIP_DEFLATED)

    def test_raw_save_inputs_keep_container_and_companion_names(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "inputs"
            source.mkdir()
            save = source / "sdimg_SLOT01"
            companion = source / "sdimg_SLOT01.bin"
            save.write_bytes(b"GFP5encrypted save")
            companion.write_bytes(b"sealed key")
            archive = pack_local_inputs(root / "stored.zip", [save, companion])
            self.assert_stored_classic(archive)
            with ZipFile(archive) as result:
                self.assertEqual(set(result.namelist()), {save.name, companion.name})
                self.assertEqual(result.read(save.name), save.read_bytes())
                self.assertEqual(result.read(companion.name), companion.read_bytes())

    def test_compressed_zip_inputs_are_repacked_stored_without_changing_layout(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "input.zip"
            with ZipFile(source, "w", compression=ZIP_DEFLATED) as archive:
                archive.writestr("SLOT01/", b"")
                archive.writestr("SLOT01/sdimg_SLOT01", b"GFP5encrypted")
                archive.writestr("SLOT01/sdimg_SLOT01.bin", b"key")
            result_path = pack_local_inputs(root / "stored.zip", [source])
            self.assert_stored_classic(result_path)
            with ZipFile(result_path) as result:
                self.assertEqual(result.read("SLOT01/sdimg_SLOT01"), b"GFP5encrypted")
                self.assertEqual(result.read("SLOT01/sdimg_SLOT01.bin"), b"key")

    def test_zip64_input_headers_are_normalized_to_classic_headers(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "input.zip"
            with ZipFile(source, "w") as archive:
                with archive.open("save", "w", force_zip64=True) as data:
                    data.write(b"GFP5encrypted")
            result = pack_local_inputs(root / "stored.zip", [source])
            self.assert_stored_classic(result)

    def test_conservative_python_threshold_does_not_force_zip64(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            save = root / "save"
            save.write_bytes(b"x" * 500)
            with patch.object(zipfile, "ZIP64_LIMIT", 32):
                result = pack_local_inputs(root / "stored.zip", [save])
                self.assertEqual(zipfile.ZIP64_LIMIT, 32)
            self.assert_stored_classic(result)

    def test_unsafe_zip_paths_are_rejected_before_output_is_replaced(self):
        names = ["../outside", "/absolute", "C:/outside", "C:outside", "\\\\host\\outside", "safe/../../outside"]
        for name in names:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                source = root / "input.zip"
                with ZipFile(source, "w") as archive:
                    archive.writestr(name, b"payload")
                output = root / "stored.zip"
                output.write_bytes(b"previous output")
                with self.assertRaisesRegex(ValueError, "unsafe archive path"):
                    pack_local_inputs(output, [source])
                self.assertEqual(output.read_bytes(), b"previous output")
                self.assertEqual(list(root.glob("*.tmp")), [])

    def test_zip_symlinks_and_special_files_are_rejected(self):
        for kind in [stat.S_IFLNK, stat.S_IFIFO]:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                source = root / "input.zip"
                item = ZipInfo("link")
                item.create_system = 3
                item.external_attr = (kind | 0o777) << 16
                with ZipFile(source, "w") as archive:
                    archive.writestr(item, b"outside")
                with self.assertRaisesRegex(ValueError, "links or special files"):
                    pack_local_inputs(root / "stored.zip", [source])

    @unittest.skipIf(os.name == "nt", "creating symlinks requires Windows privileges")
    def test_workspace_directory_and_file_links_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = root / "workspace"
            workspace.mkdir()
            outside = root / "outside"
            outside.mkdir()
            (outside / "secret").write_bytes(b"outside")
            (workspace / "linked").symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "links"):
                pack_local_workspace(workspace, root / "stored.zip")
            (workspace / "linked").unlink()
            (workspace / "linked").symlink_to(outside / "secret")
            with self.assertRaisesRegex(ValueError, "links or special files"):
                pack_local_workspace(workspace, root / "stored.zip")

    def test_duplicate_raw_names_and_shadowed_zip_paths_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            sources = []
            for name in ["one", "two"]:
                parent = root / name
                parent.mkdir()
                save = parent / "save"
                save.write_bytes(name.encode())
                sources.append(save)
            with self.assertRaisesRegex(ValueError, "duplicate|conflicting"):
                pack_local_inputs(root / "stored.zip", sources)
            source = root / "shadowed.zip"
            with ZipFile(source, "w") as archive:
                archive.writestr("folder", b"file")
                archive.writestr("folder/save", b"payload")
            with self.assertRaisesRegex(ValueError, "conflicting|collide"):
                pack_local_inputs(root / "stored.zip", [source])

    def test_empty_archives_workspaces_and_in_place_input_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = root / "empty"
            workspace.mkdir()
            with self.assertRaisesRegex(ValueError, "at least one"):
                pack_local_workspace(workspace, root / "stored.zip")
            source = root / "empty.zip"
            with ZipFile(source, "w"):
                pass
            with self.assertRaisesRegex(ValueError, "contains no save files"):
                pack_local_inputs(root / "stored.zip", [source])
            with self.assertRaisesRegex(ValueError, "separately"):
                pack_local_inputs(source, [source])
            (workspace / "save").write_bytes(b"payload")
            with self.assertRaisesRegex(ValueError, "outside the decrypted workspace"):
                pack_local_workspace(workspace, workspace / "stored.zip")

    def test_invalid_entry_size_and_entry_count_never_publish_partial_zip(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "huge.zip"
            with ZipFile(source, "w") as archive:
                archive.writestr("save", b"x")
            raw = bytearray(source.read_bytes())
            central = raw.index(b"PK\x01\x02")
            struct.pack_into("<I", raw, central + 24, 0xFFFFFFFF)
            source.write_bytes(raw)
            output = root / "stored.zip"
            output.write_bytes(b"previous output")
            with self.assertRaisesRegex(ValueError, "classic ZIP"):
                pack_local_inputs(output, [source])
            self.assertEqual(output.read_bytes(), b"previous output")
            source = root / "many.zip"
            with ZipFile(source, "w") as archive:
                archive.writestr("one", b"1")
                archive.writestr("two", b"2")
            with patch("poc.dt_save_editor.CLASSIC_ZIP_ENTRIES", 1):
                with self.assertRaisesRegex(ValueError, "classic ZIP"):
                    pack_local_inputs(output, [source])
            self.assertEqual(output.read_bytes(), b"previous output")
            self.assertEqual(list(root.glob("*.tmp")), [])

    def test_failed_zip_read_cleans_temporary_and_preserves_previous_output(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "bad.zip"
            with ZipFile(source, "w", compression=ZIP_STORED) as archive:
                archive.writestr("save", b"payload")
            raw = bytearray(source.read_bytes())
            raw[30 + len("save")] ^= 1
            source.write_bytes(raw)
            output = root / "stored.zip"
            output.write_bytes(b"previous output")
            with self.assertRaises(zipfile.BadZipFile):
                pack_local_inputs(output, [source])
            self.assertEqual(output.read_bytes(), b"previous output")
            self.assertEqual(list(root.glob("*.tmp")), [])

    def test_both_local_cli_commands_report_archive_and_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = root / "workspace"
            workspace.mkdir()
            save = workspace / "save"
            save.write_bytes(b"GFP5encrypted")
            for command, args in [
                ("local-pack", [str(workspace), str(root / "workspace.zip")]),
                ("local-inputs", [str(root / "inputs.zip"), str(save)]),
            ]:
                with self.subTest(command=command):
                    result = subprocess.run([sys.executable, "-m", "poc.dt_save_editor", command, *args],
                                            check=True, capture_output=True, text=True)
                    data = json.loads(result.stdout)
                    archive = Path(data["archive"])
                    self.assertEqual(data["bytes"], archive.stat().st_size)
                    self.assert_stored_classic(archive)


if __name__ == "__main__":
    unittest.main()
