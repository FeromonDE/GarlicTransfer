import unittest
from pathlib import Path


class MacOSPrivilegeTests(unittest.TestCase):
    def test_pairing_and_upload_use_native_admin_helper(self):
        source = Path(__file__).resolve().parent.parent.joinpath("electron", "main.cjs").read_text()
        self.assertIn("function macOSAdminCommand(python, module", source)
        self.assertIn("macOSAdminCommand(python, 'poc.dt_pair'", source)
        self.assertIn("macOSAdminCommand(python, 'poc.dt_source', sourceEnvironment", source)
        self.assertIn("with administrator privileges", source)
        self.assertIn("/usr/bin/osascript", source)
        self.assertNotIn("sudo ", source)

    def test_admin_helper_preserves_file_ownership_and_resource_path(self):
        source = Path(__file__).resolve().parent.parent.joinpath("electron", "main.cjs").read_text()
        self.assertIn("DT_PAIRING_UID=${process.getuid()}", source)
        self.assertIn("DT_PAIRING_GID=${process.getgid()}", source)
        self.assertIn("sys.path.insert(0, ${JSON.stringify(resourceRoot)})", source)


if __name__ == "__main__":
    unittest.main()
