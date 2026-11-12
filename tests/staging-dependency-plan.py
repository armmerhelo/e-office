"""Ensure static PHP dependency scanning accepts the current deploy closure."""
import importlib.util
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('staging',ROOT/'scripts/staging-hosting.py')
staging=importlib.util.module_from_spec(spec);spec.loader.exec_module(staging)

class PresentFTP:
    def __init__(self,files):self.files=files
    def retrbinary(self,command,callback):
        name=command.removeprefix('RETR ')
        if name not in self.files:
            import ftplib
            raise ftplib.error_perm('550 file not found')
        callback(self.files[name])

class DependencyPlan(unittest.TestCase):
    def test_font_assets_and_licenses_are_deployable(self):
        files=dict(staging.deployment_files())
        required={
            'assets/fonts/sarabun/OFL.txt',
            'assets/fonts/sarabun/Sarabun-Regular.ttf',
            'assets/fonts/sarabun/Sarabun-Bold.ttf',
            'assets/fonts/sarabun/Sarabun-Italic.ttf',
            'assets/fonts/sarabun/Sarabun-BoldItalic.ttf',
            'assets/vendor/JSPDF-LICENSE.txt',
            'assets/vendor/KONVA-LICENSE.txt',
            'memorandum/assets/fonts/TH-Sarabun-PSK-LICENSE.txt',
            'memorandum/assets/fonts/TH-Sarabun-PSK.ttf',
            'memorandum/assets/fonts/TH-Sarabun-PSK-Bold.ttf',
            'docs/SIYA_NEWS_USER_GUIDE.pdf',
        }
        self.assertTrue(required.issubset(files))

    def test_full_deployment_static_php_closure_is_complete_and_ordered(self):
        files=dict(staging.deployment_files());remote={**files,'config/local.php':b'<?php return [];'}
        plan=staging.sync_dependency_plan(PresentFTP(remote),set(files),files)
        positions={name:index for index,(name,_) in enumerate(plan)}
        self.assertEqual(len(positions),len(plan))
        self.assertEqual(set(positions),set(files))
        for name,content in files.items():
            if not name.endswith('.php'):continue
            for match in staging._STATIC_PHP_INCLUDE.finditer(content.decode('utf-8',errors='replace')):
                dependency=staging.posixpath.normpath(staging.posixpath.join(staging.posixpath.dirname(name),match.group(2).lstrip('/')))
                if dependency in positions:self.assertLess(positions[dependency],positions[name],(name,dependency))

if __name__=='__main__':unittest.main()
