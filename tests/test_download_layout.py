import io
import json
import os
import sqlite3
import struct
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from poc.dt_download import download_entry
from poc.dt_layout import metadata_file, payload_directory
from poc.dt_backend import index_downloaded_manifests, list_inventory
from poc.dt_local_saves import local_inventory, local_profiles, import_save, export_save
from poc.dt_metadata import create_external_save, create_filtered_metadata, load_manifest
from poc.dt_source import send_save_chunks
from poc.dt_ftp_server import Catalog
from test_app_download import FakeChannel


class OrganizedLayoutTests(unittest.TestCase):
    def make_download(self, root, nested=False):
        profile = root / 'console-123'
        profile.mkdir()
        source_path = '/user/home/18c60ea2/savedata_prospero/PPSA12345/' + ('nested/' if nested else '') + 'sdimg_DATA'
        entry_id = 65536
        header = bytearray(1304)
        struct.pack_into('<II', header, 0, 0x35504647, entry_id)
        struct.pack_into('<Q', header, 0x20, 8)
        struct.pack_into('<Q', header, 0xF0, 8)
        encoded = source_path.encode()
        header[276:276+len(encoded)] = encoded
        final = bytearray(1304)
        struct.pack_into('<II', final, 0, 0x35504647, entry_id)
        final[274] = 1
        with patch('poc.dt_download.recv_record', side_effect=[bytes(header), b'original', bytes(final)]):
            download_entry(FakeChannel(), entry_id, profile)
        # Build a valid database independently, as the console supplies it before entries.
        image = root / 'sdimg_DATA'
        image.write_bytes(b'original')
        create_external_save(metadata_file(profile), '18c60ea2', 'PPSA12345', image, root / 'staging')
        return profile, entry_id

    def test_download_inventory_import_export_upload_and_ftp(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            profile, entry_id = self.make_download(root)
            savedir = profile / 'Saves' / '18c60ea2' / 'PPSA12345'
            self.assertEqual((savedir / 'sdimg_DATA').read_bytes(), b'original')
            self.assertFalse((savedir / 'manifest.json').exists())
            self.assertFalse((profile / str(entry_id)).exists())
            self.assertTrue((profile / 'Transfer-Metadata' / str(entry_id) / 'manifest.json').is_file())
            self.assertEqual(index_downloaded_manifests(profile), {('PPSA12345', '18c60ea2', '')})
            self.assertTrue((profile / 'Transfer-Metadata' / 'manifest.json').is_file())
            with redirect_stdout(io.StringIO()) as stdout:
                list_inventory(metadata_file(profile))
            self.assertTrue(json.loads(stdout.getvalue())['entries'][0]['downloaded'])
            self.assertEqual(local_inventory(profile)[0]['title'], 'PPSA12345')
            self.assertEqual(local_profiles(root)['profiles'][0]['save_count'], 1)
            self.assertEqual(local_profiles(profile)['profiles'][0]['id'], profile.name)
            exportdir = root / 'export'
            exportdir.mkdir()
            self.assertEqual(export_save(profile, entry_id, 'sdimg_DATA', exportdir).read_bytes(), b'original')
            replacement = root / 'replacement'
            replacement.write_bytes(b'new content')
            import_save(profile, entry_id, 'sdimg_DATA', replacement)
            self.assertEqual(load_manifest(profile, entry_id)[1]['files'][0]['size'], 11)
            metadata = root / 'upload.db'
            manifest = root / 'upload.json'
            create_filtered_metadata(metadata, metadata_file(profile), '18c60ea2', 'tester', [entry_id], profile, manifest)
            with patch.dict(os.environ, {'DT_ASSETS': str(profile), 'DT_METADATA': str(metadata), 'DT_MANIFEST': str(manifest)}), patch('poc.dt_source.send_record') as send:
                send_save_chunks(None, None, None, 0, 2, entry_id)
            self.assertEqual(send.call_args_list[1].args[4], b'new content')
            catalog = Catalog(metadata_file(profile), profile)
            name = next(name for category, name in catalog.entries if category == 'saves')
            self.assertEqual(catalog.file_path('/saves/' + name + '/sdimg_DATA'), savedir / 'sdimg_DATA')

    def test_nested_save_directory_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            profile, entry_id = self.make_download(Path(folder), nested=True)
            self.assertTrue((profile / 'Saves/18c60ea2/PPSA12345/nested/sdimg_DATA').is_file())
            self.assertEqual(load_manifest(profile, entry_id)[1]['files'][0]['size'], 8)

    def test_stale_and_corrupt_indexes_keep_individual_saves_readable(self):
        from poc.dt_metadata import load_selected_manifest
        with tempfile.TemporaryDirectory() as folder:
            profile, entry_id = self.make_download(Path(folder))
            index = profile / 'Transfer-Metadata' / 'manifest.json'
            index.write_text(json.dumps({'999': {'files': []}}))
            self.assertEqual(load_manifest(profile, entry_id)[1]['files'][0]['file'], 'sdimg_DATA')
            self.assertEqual(local_inventory(profile)[0]['id'], entry_id)
            self.assertEqual(load_selected_manifest(profile, entry_id, metadata_file(profile), '18c60ea2')[0], entry_id)
            index.write_text('{')
            self.assertEqual(load_manifest(profile, entry_id)[1]['files'][0]['file'], 'sdimg_DATA')
            result = local_inventory(profile, include_warnings=True)
            self.assertEqual(len(result['entries']), 1)
            self.assertTrue(result['warnings'])
            # Organized entry beats an outdated legacy index.
            (profile / 'manifest.json').write_text(json.dumps({str(entry_id): {'files': [{'file': 'OLD'}]}}))
            self.assertEqual(load_manifest(profile, entry_id)[1]['files'][0]['file'], 'sdimg_DATA')
            index.write_text('{}')
            (profile / 'Saves/18c60ea2/PPSA12345/sdimg_DATA').unlink()
            with self.assertRaisesRegex(ValueError, 'is missing'):
                load_manifest(profile, entry_id)

    def test_new_download_keeps_legacy_manifest_untouched(self):
        import shutil
        from poc.dt_layout import entry_manifest
        with tempfile.TemporaryDirectory() as folder:
            profile, entry_id = self.make_download(Path(folder))
            organized = profile / 'Transfer-Metadata' / str(entry_id) / 'manifest.json'
            legacy = profile / str(entry_id)
            legacy.mkdir()
            original = organized.read_bytes()
            shutil.move(organized, legacy / 'manifest.json')
            self.assertEqual(entry_manifest(profile, entry_id), legacy / 'manifest.json')
            self.assertEqual(entry_manifest(profile, entry_id, for_write=True), organized)
            final = bytearray(1304)
            struct.pack_into('<II', final, 0, 0x35504647, entry_id)
            final[274] = 1
            # A new empty-directory response still belongs to the organized layout.
            with patch('poc.dt_download.recv_record', return_value=bytes(final)):
                download_entry(FakeChannel(), entry_id, profile)
            self.assertTrue(organized.is_file())
            self.assertEqual((legacy / 'manifest.json').read_bytes(), original)
            self.assertEqual(json.loads(organized.read_text())[str(entry_id)]['files'], [])

    def test_other_content_and_path_validation(self):
        self.assertEqual(payload_directory(Path('/profile'), 12, '/user/app/PPSA12345/app.pkg'), Path('/profile/Other Needed Data/12'))
        with self.assertRaises(ValueError):
            payload_directory(Path('/profile'), 12, '/user/home/18c60ea2/savedata_prospero/PPSA12345/../../outside/file')
