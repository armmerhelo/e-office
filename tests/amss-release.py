"""Offline regression checks for targeted AMSS deployment merges."""
import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('amss_release', ROOT / 'scripts/amss-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class MergeTests(unittest.TestCase):
    def setUp(self):
        self.local = (ROOT / 'api/create_document.php').read_bytes()
        self.mock = patch.object(release, 'committed', return_value=self.local)
        self.mock.start()
        self.addCleanup(self.mock.stop)

    def test_current_api_is_idempotent(self):
        self.assertEqual(release.merged_api(self.local), self.local)

    def test_previous_importer_upgrades_with_order_integration_preserved(self):
        previous = subprocess.check_output(['git', 'show', '3b7a620:api/create_document.php'], cwd=ROOT)
        previous = release.without_order_feature(previous.decode())
        target = release.merged_api(previous.encode()).decode()
        self.assertEqual(target, release.without_order_feature(self.local.decode()))

    def test_known_deployed_order_api_upgrades(self):
        previous = subprocess.check_output(['git', 'show', 'HEAD:api/create_document.php'], cwd=ROOT)
        target = release.merged_api(previous)
        self.assertEqual(release.without_order_feature(target.decode()), release.without_order_feature(self.local.decode()))
        if b'config/order-emails.php' in previous:
            self.assertIn(b'config/order-emails.php', target)
            self.assertIn(b'app_order_saved($id,!$edit,$type,$orderSettings)', target)

    def test_unknown_concurrent_change_is_rejected(self):
        unknown = self.local.replace(b'$type=', b'$unexpectedType=', 1)
        with self.assertRaisesRegex(RuntimeError, 'differs beyond known'):
            release.merged_api(unknown)


if __name__ == '__main__':
    unittest.main()
