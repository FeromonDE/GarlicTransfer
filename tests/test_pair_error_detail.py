import io
import unittest
from unittest.mock import patch

from poc import dt_pair


class PairErrorDetailTests(unittest.TestCase):
    def test_os_error_detail_is_preserved_for_diagnostics(self):
        error = PermissionError(13, "Permission denied")
        with patch.object(dt_pair, "pair", side_effect=error), \
             patch.object(dt_pair.sys, "argv", ["dt_pair", "-"]), \
             patch.object(dt_pair.sys, "stdin", io.StringIO('{}\n')), \
             patch.object(dt_pair, "emit") as emit:
            with self.assertRaises(SystemExit):
                dt_pair.main()
        emit.assert_called_once()
        message = emit.call_args.kwargs["message"]
        self.assertIn("PermissionError", message)
        self.assertIn("Permission denied", message)


if __name__ == "__main__":
    unittest.main()
