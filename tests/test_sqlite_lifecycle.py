import io
import sqlite3
import struct
import tempfile
import unittest
from contextlib import closing, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from poc import dt_backend, dt_download, dt_ftp_server, dt_source


class SqliteLifecycleTests(unittest.TestCase):
    def check_closed(self, operation, fails):
        """Check database cleanup."""
        connect = sqlite3.connect
        opened = []

        def track(*args, **kwargs):
            db = connect(*args, **kwargs)
            opened.append(db)
            return db

        try:
            with patch("sqlite3.connect", side_effect=track):
                if fails:
                    with self.assertRaises(sqlite3.Error):
                        operation()
                else:
                    operation()
            self.assertEqual(len(opened), 1)
            for db in opened:
                with self.assertRaises(sqlite3.ProgrammingError):
                    db.execute("SELECT 1")
        finally:
            for db in opened:
                db.close()

    def check_readers(self, fails):
        """Check metadata readers."""
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            metadata = root / "metadata.db"
            with closing(sqlite3.connect(metadata)) as db, db:
                if fails:
                    db.execute("CREATE TABLE dir_entry_info_tbl (id)")
                    db.execute("CREATE TABLE user_info_tbl (user_id)")
                else:
                    db.execute("CREATE TABLE dir_entry_info_tbl (id, path, actual_size, target_type)")
                    db.execute("INSERT INTO dir_entry_info_tbl VALUES (1, '/user/app/PPSA12345/', 16, 1)")
                    db.execute("CREATE TABLE user_info_tbl (user_id, user_name, login_id, online_id)")
                    db.execute("INSERT INTO user_info_tbl VALUES (1, 'tester', 'test-login', 'tester')")

            def download():
                with patch.object(dt_backend, "launch_console", return_value=b"system-version:13600000\n"), \
                     patch.object(dt_backend, "DtChannel") as channel, \
                     patch.object(dt_backend, "download_metadata"), \
                     patch.object(dt_backend, "metadata_file", return_value=metadata):
                    try:
                        dt_backend.download({
                            "oracleHost": "127.0.0.1", "clientHost": "127.0.0.1",
                            "interface": 1, "output": folder, "skipPower": True,
                            "metadataOnly": True,
                        })
                    finally:
                        channel.return_value.close.assert_called_once_with()

            readers = [
                ("catalog", lambda: dt_ftp_server.Catalog(metadata, root)),
                ("users", lambda: dt_backend.list_users(metadata)),
                ("inventory", lambda: dt_backend.list_inventory(metadata)),
                ("browser", lambda: dt_download.browse_entries(metadata)),
                ("registry", lambda: dt_source.user_registry_value(struct.pack("<IIIIQ", 1, 0x101, 1, 0, 16))),
                ("download", download),
            ]
            with patch.object(dt_backend, "emit"), \
                 patch.object(dt_backend, "index_downloaded_manifests", return_value=set()), \
                 patch.object(dt_source, "METADATA_PATH", metadata), \
                 patch("builtins.input", return_value="q"), redirect_stdout(io.StringIO()):
                for name, operation in readers:
                    with self.subTest(reader=name):
                        self.check_closed(operation, fails)

    def test_metadata_readers_close_before_returning(self):
        self.check_readers(fails=False)

    def test_metadata_readers_close_when_queries_fail(self):
        self.check_readers(fails=True)


if __name__ == "__main__":
    unittest.main()
