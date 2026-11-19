import json
import os
import sqlite3
import struct
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from poc import dt_source
from poc.dt_metadata import create_external_save


class ExternalSaveTests(unittest.TestCase):
    def test_folder_groups_multiple_files_and_streams_each(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            images = root / "PPSA12345"
            images.mkdir()
            (images / "sdimg_one").write_bytes(b"first")
            (images / "sdimg_two").write_bytes(b"second")
            assets = root / "cache"
            output = root / "metadata.db"
            manifest_path = root / "upload.json"
            create_external_save(output, "18c60ea2", "PPSA12345", images, assets,
                                 manifest_output=manifest_path)
            manifest = json.loads(manifest_path.read_text())
            files = manifest[str(0x10000)]["files"]
            self.assertEqual([item["file"] for item in files], ["sdimg_one", "sdimg_two"])
            with closing(sqlite3.connect(output)) as db:
                self.assertEqual(db.execute("SELECT actual_size FROM dir_entry_info_tbl").fetchall(), [(11,)])
            with patch.dict(os.environ, {"DT_ASSETS": str(assets), "DT_METADATA": str(output),
                                        "DT_MANIFEST": str(manifest_path), "DT_UPLOAD_KIND": "save"}), patch.object(dt_source, "send_record") as send:
                dt_source.send_save_chunks(None, None, None, 0, 2, 0x10000)
            self.assertEqual(send.call_count, 5)
            self.assertEqual(send.call_args_list[1].args[4], b"first")
            self.assertEqual(send.call_args_list[3].args[4], b"second")
            self.assertEqual((images / "sdimg_one").read_bytes(), b"first")

    def test_folder_rejects_empty_or_nested_input(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            images = root / "input"
            images.mkdir()
            with self.assertRaisesRegex(ValueError, "missing or empty"):
                create_external_save(root / "out.db", "18c60ea2", "PPSA12345", images, root / "cache")
            (images / "nested").mkdir()
            with self.assertRaisesRegex(ValueError, "without subfolders"):
                create_external_save(root / "out.db", "18c60ea2", "PPSA12345", images, root / "cache")

    def test_new_container_creates_uploadable_library_entry(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            image = root / "sdimg_external"
            image.write_bytes(b"encrypted-save")
            assets = root / "cache"
            output = root / "metadata.db"
            manifest_output = root / "manifest.json"
            source = root / "source.db"
            template = Path(__file__).resolve().parent.parent / "poc" / "templates" / "single-save.db"
            import shutil
            shutil.copyfile(template, source)
            with closing(sqlite3.connect(source)) as db, db:
                db.execute("UPDATE user_info_tbl SET user_id = ?", (int("18c60ea2", 16),))
            create_external_save(
                output, "18c60ea2", "PPSA12345", image, assets,
                user_name="tester", manifest_output=manifest_output, source_metadata=source,
            )
            entry_id = 0x10000
            with closing(sqlite3.connect(output)) as db:
                directory = db.execute(
                    "SELECT path, actual_size, transfer_size, required_size FROM dir_entry_info_tbl"
                ).fetchone()
                title = db.execute("SELECT title_id, size FROM users_savedata_tbl").fetchone()
            expected_path = "/user/home/18c60ea2/savedata_prospero/PPSA12345/"
            self.assertEqual(directory, (expected_path, len(b"encrypted-save"), len(b"encrypted-save"), len(b"encrypted-save")))
            self.assertEqual(title, ("PPSA12345", len(b"encrypted-save")))
            manifest = json.loads(manifest_output.read_text())
            item = manifest[str(entry_id)]["files"][0]
            self.assertEqual(item["path"], expected_path + "sdimg_external")
            self.assertEqual(struct.unpack_from("<I", bytes.fromhex(item["header"]), 4)[0], entry_id)
            self.assertEqual((assets / str(entry_id) / "sdimg_external").read_bytes(), b"encrypted-save")

            with patch.dict(os.environ, {
                "DT_ASSETS": str(assets),
                "DT_METADATA": str(output),
                "DT_MANIFEST": str(manifest_output),
                "DT_UPLOAD_KIND": "save",
            }), patch.object(dt_source, "send_record") as send_record:
                dt_source.send_save_chunks(None, None, None, 0, 2, entry_id)
            self.assertEqual(send_record.call_count, 3)
            self.assertEqual(send_record.call_args_list[0].args[4], bytes.fromhex(item["header"]))

    def test_external_save_allows_user_without_prior_download(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            image = root / "sdimg_external"
            image.write_bytes(b"encrypted-save")
            output = root / "metadata.db"
            create_external_save(
                output, "18c60ea2", "PPSA12345", image,
                root / "cache", user_name="tester",
            )
            self.assertTrue(output.is_file())
            with closing(sqlite3.connect(output)) as db:
                owner = db.execute("SELECT user_id FROM user_info_tbl").fetchone()[0]
            self.assertEqual(owner, int("18c60ea2", 16))


if __name__ == "__main__":
    unittest.main()
