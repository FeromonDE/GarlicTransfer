import json
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from poc.dt_export_zip import export_entry, extract_for_upload


class ExportZipTests(unittest.TestCase):
    def make_library(self, root):
        entry_id = 137
        title_id = "PPSA01547"
        user_id = "18c60ea2"
        source_path = f"/user/home/{user_id}/savedata_prospero/{title_id}/sdimg_TEST"
        payload = root / "Saves" / user_id / title_id / "sdimg_TEST"
        payload.parent.mkdir(parents=True)
        payload.write_bytes(b"encrypted-save-data")
        header = bytearray(1304)
        struct.pack_into("<I", header, 0, 0x35504647)
        struct.pack_into("<I", header, 4, entry_id)
        struct.pack_into("<Q", header, 240, payload.stat().st_size)
        header[276:276 + len(source_path)] = source_path.encode()
        final = bytearray(1304)
        struct.pack_into("<I", final, 0, 0x35504647)
        struct.pack_into("<I", final, 4, entry_id)
        final[274] = 1
        item = {"path": source_path, "file": payload.name, "size": payload.stat().st_size, "header": header.hex()}
        entry = {"files": [item], "final_header": final.hex()}
        manifest_dir = root / "Transfer-Metadata" / str(entry_id)
        manifest_dir.mkdir(parents=True)
        manifest = {"entry_id": entry_id, "files": [item], str(entry_id): entry}
        (manifest_dir / "manifest.json").write_text(json.dumps(manifest))
        (root / "Transfer-Metadata" / "manifest.json").write_text(json.dumps({str(entry_id): entry}))
        return entry_id, payload

    def test_export_and_extract_preserve_payload_and_title(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            entry_id, payload = self.make_library(root)
            archive, title_id, count = export_entry(root, entry_id, root / "export.zip")
            self.assertEqual((title_id, count), ("PPSA01547", 1))
            title = extract_for_upload(archive, root / "extracted")
            self.assertEqual(title, "PPSA01547")
            self.assertEqual((root / "extracted" / payload.name).read_bytes(), payload.read_bytes())

    def test_plain_zip_is_accepted(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with zipfile.ZipFile(root / "plain.zip", "w") as archive:
                archive.writestr("sdimg_TEST", b"save")
            self.assertEqual(extract_for_upload(root / "plain.zip", root / "out"), "")
            self.assertEqual((root / "out" / "sdimg_TEST").read_bytes(), b"save")

    def test_unsafe_and_duplicate_paths_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ("../escape", "nested/save", "payload/../escape"):
                with zipfile.ZipFile(root / "bad.zip", "w") as archive:
                    archive.writestr(name, b"bad")
                with self.assertRaisesRegex(ValueError, "unsafe archive path"):
                    extract_for_upload(root / "bad.zip", root / "out")
            with zipfile.ZipFile(root / "duplicate.zip", "w") as archive:
                archive.writestr("payload/sdimg_TEST", b"one")
                archive.writestr("payload/sdimg_TEST", b"two")
            with self.assertRaisesRegex(ValueError, "duplicate archive path"):
                extract_for_upload(root / "duplicate.zip", root / "out")

    def test_expansion_limit_is_enforced(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with zipfile.ZipFile(root / "large.zip", "w", zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("sdimg_TEST", b"0" * 1024)
            with patch("poc.dt_export_zip.MAX_EXTRACT_BYTES", 16):
                with self.assertRaisesRegex(ValueError, "extraction limit"):
                    extract_for_upload(root / "large.zip", root / "out")


if __name__ == "__main__":
    unittest.main()
