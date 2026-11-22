import unittest
from pathlib import Path


class MacOSPrivilegeTests(unittest.TestCase):
    def test_pairing_and_upload_run_without_an_admin_wrapper(self):
        source = Path(__file__).resolve().parent.parent.joinpath("electron", "main.cjs").read_text()
        self.assertNotIn("macOSAdminCommand", source)
        self.assertNotIn("with administrator privileges", source)
        self.assertNotIn("/usr/bin/osascript", source)
        self.assertNotIn("sudo ", source)
        self.assertIn("args = ['-u', '-m', 'poc.dt_pair', '-']", source)
        self.assertIn("args = ['-u', '-m', 'poc.dt_source']", source)
        self.assertIn("const needsRoot = process.platform === 'linux'", source)

    def test_macos_selects_a_compatible_python_with_cryptography(self):
        source = Path(__file__).resolve().parent.parent.joinpath("electron", "paths.cjs").read_text()
        self.assertIn("spawnSync(python", source)
        self.assertIn("sys.version_info >= (3, 10)", source)
        self.assertIn("import cryptography", source)
        self.assertIn("'/opt/homebrew/bin/python3'", source)
        self.assertIn("'/usr/local/bin/python3'", source)

    def test_pairing_reuses_sockets_and_only_binds_all_interfaces_on_macos(self):
        source = Path(__file__).resolve().parent.parent.joinpath("poc", "dt_pair.py").read_text()
        self.assertIn('listen_ip = "0.0.0.0" if sys.platform == "darwin" else advertise_ip', source)
        self.assertEqual(source.count("setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)"), 2)
        self.assertIn("discovery_reply(packet.split(b\" \", 1)[0], advertise_ip", source)
        self.assertEqual(source.count("address[0] != ps5_ip"), 2)


if __name__ == "__main__":
    unittest.main()
