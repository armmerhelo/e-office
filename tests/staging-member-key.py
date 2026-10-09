"""Exercise the actual staging PHP provisioner on a disposable mock web root."""
import contextlib
import ftplib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import sys
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('staging',ROOT/'scripts/staging-hosting.py')
staging=importlib.util.module_from_spec(spec);spec.loader.exec_module(staging)
PHP=os.environ.get('PHP_BIN','C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe')


class FTP:
    def __init__(self,root):self.root=root
    def mkd(self,path): (self.root/path).mkdir(parents=True,exist_ok=True)
    def storbinary(self,command,stream):
        target=self.root/command.removeprefix('STOR ');target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(stream.read())
    def retrbinary(self,command,callback):
        source=self.root/command.removeprefix('RETR ')
        if not source.is_file():raise ftplib.error_perm('550 file not found')
        callback(source.read_bytes())
    def rename(self,source,target):os.replace(self.root/source,self.root/target)


class StagingKeys(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir())/'opencode',prefix='staging-key-')
        self.root=Path(self.temp.name);(self.root/'config').mkdir()
        for name in ['bootstrap.php','permissions.php','settings.php','member-management.php','sign-routing.php']:
            shutil.copyfile(ROOT/'config'/name,self.root/'config'/name)
        self.ftp=FTP(self.root)
        self.database={'database':'siyaacth_eoffice_test','user':'synthetic-user','password':'synthetic-password'}
        self.metadata={'database':'siyaacth_eoffice_test','database_host':'localhost','document_root':self.root.as_posix()}
        self.env={key:value for key,value in os.environ.items() if not key.startswith(('DB_','EOFFICE_')) and key!='APP_URL'}
        self.mock=patch.object(staging,'invoke_probe',self.invoke);self.mock.start()
    def tearDown(self):self.mock.stop();self.temp.cleanup()
    def invoke(self,_ftp,source,key):
        prelude='$_SERVER='+staging.php_value({'HTTP_HOST':'e-office-test.siya.ac.th','HTTP_X_EOFFICE_DEPLOY_TOKEN':key})+';'
        result=subprocess.run([PHP,'-d','display_errors=0','-r',prelude+source.removeprefix('<?php')],cwd=self.root,env=self.env,capture_output=True)
        if result.returncode:raise RuntimeError('Synthetic staging helper failed')
        return json.loads(result.stdout)
    def config(self):
        result=subprocess.run([PHP,'-r',"echo json_encode(require 'config/local.php');"],cwd=self.root,env=self.env,capture_output=True,check=True)
        return json.loads(result.stdout)
    def write_config(self,settings):
        (self.root/'config/local.php').write_text('<?php return '+staging.php_value(settings)+';',encoding='utf-8')
    def provision(self):return staging.configure_staging(self.ftp,self.database,self.metadata)
    def sync(self,files,*,targeted=True,selected=None):
        output=io.StringIO()
        (self.root/'AppData/Local/Temp/opencode').mkdir(parents=True,exist_ok=True)
        selected=selected if selected is not None else [name for name,_ in files]
        argv=['staging-hosting.py','sync']+(['--files',*selected] if targeted else [])
        with patch.object(staging,'credentials',return_value=({},self.database)),patch.object(staging,'connect',side_effect=lambda *_:contextlib.nullcontext(self.ftp)),patch.object(staging,'webroot'),patch.object(staging,'probe',return_value=self.metadata),patch.object(staging,'deployment_files',return_value=files),patch('pathlib.Path.home',return_value=self.root),patch.object(sys,'argv',argv),contextlib.redirect_stdout(output):
            staging.main()
        return [json.loads(line) for line in output.getvalue().splitlines()]
    def prior_settings(self):
        return {'DB_DATABASE':'siyaacth_eoffice_test','EOFFICE_MOCK_SERVICES':'true','EOFFICE_STORAGE':(self.root/'custom-private').as_posix(),'EOFFICE_SIGN_ROUTES':'{"8":13}','APP_URL':'https://e-office-test.siya.ac.th','EOFFICE_BACKUP_KEY':'private-fixture-value'}
    def legacy_runtime(self):
        (self.root/'config/member-management.php').write_text("<?php require_once __DIR__.'/bootstrap.php'; function app_member_version(array $user,array $departments): string { return hash('sha256',json_encode($user)); }",encoding='utf-8')
    def test_first_deploy_and_repeat_keep_one_valid_key(self):
        initial=self.provision();first=self.config()
        self.assertTrue(initial['member_version_key_generated'])
        self.assertTrue(staging.verify_member_key(self.ftp)['member_version_key_ready'])
        second=self.provision();self.assertFalse(second['member_version_key_generated'])
        self.assertEqual(self.config()['EOFFICE_MEMBER_VERSION_KEY'],first['EOFFICE_MEMBER_VERSION_KEY'])
        self.assertFalse(any('.upload-' in file.name for file in (self.root/'config').iterdir()))
        self.assertNotIn(first['EOFFICE_MEMBER_VERSION_KEY'],json.dumps(initial))
    def test_existing_settings_key_and_private_values_are_preserved(self):
        import base64,secrets
        key=base64.b64encode(secrets.token_bytes(32)).decode()
        self.write_config({'DB_DATABASE':'siyaacth_eoffice_test','EOFFICE_SETTINGS_KEY':key,'EOFFICE_BACKUP_KEY':'keep-synthetic-backup','custom_setting':'keep'})
        result=self.provision();self.assertFalse(result['member_version_key_generated'])
        settings=self.config();self.assertEqual(settings['EOFFICE_SETTINGS_KEY'],key)
        self.assertEqual(settings['EOFFICE_BACKUP_KEY'],'keep-synthetic-backup');self.assertEqual(settings['custom_setting'],'keep')
        self.assertTrue(staging.verify_member_key(self.ftp)['member_version_key_ready'])
    def test_concurrent_first_setups_generate_only_one_key(self):
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as executor:
            results=list(executor.map(lambda _:self.provision(),range(2)))
        self.assertEqual(sum(result['member_version_key_generated'] for result in results),1)
        self.assertTrue(staging.verify_member_key(self.ftp)['member_version_key_ready'])
        key=self.config()['EOFFICE_MEMBER_VERSION_KEY']
        self.provision();self.assertEqual(self.config()['EOFFICE_MEMBER_VERSION_KEY'],key)
    def test_dedicated_key_wins_and_is_preserved(self):
        import base64,secrets
        key=base64.b64encode(secrets.token_bytes(32)).decode()
        self.write_config({'DB_DATABASE':'siyaacth_eoffice_test','EOFFICE_MEMBER_VERSION_KEY':key})
        self.provision();self.provision();self.assertEqual(self.config()['EOFFICE_MEMBER_VERSION_KEY'],key)
    def test_invalid_key_fails_before_replacing_config(self):
        self.write_config({'DB_DATABASE':'siyaacth_eoffice_test','EOFFICE_MEMBER_VERSION_KEY':'corrupt'})
        before=(self.root/'config/local.php').read_bytes()
        with self.assertRaises(RuntimeError):self.provision()
        self.assertEqual((self.root/'config/local.php').read_bytes(),before)
    def test_wrong_database_and_masking_environment_fail_closed(self):
        self.write_config({'DB_DATABASE':'production'})
        with self.assertRaises(RuntimeError):self.provision()
        (self.root/'config/local.php').unlink();self.env['EOFFICE_MEMBER_VERSION_KEY']=''
        with self.assertRaises(RuntimeError):self.provision()
        self.assertFalse((self.root/'config/local.php').exists())
    def test_deploy_checks_key_before_first_application_upload(self):
        events=[]
        class ProbeFTP(FTP):
            def storbinary(inner,command,stream):events.append('upload');super().storbinary(command,stream)
        ftp=ProbeFTP(self.root)
        def configured(*args):events.append('configure');raise RuntimeError('stop after preflight')
        with patch.object(staging,'probe',return_value=self.metadata),patch.object(staging,'backup',return_value={}),patch.object(staging,'database_backup',return_value={}),patch.object(staging,'configure_staging',configured),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError,'stop after preflight'):staging.deploy(ftp,self.database)
        self.assertEqual(events,['configure'])
    def test_targeted_sync_provisions_and_preserves_key_before_runtime_check(self):
        files=[('config/member-management.php',(ROOT/'config/member-management.php').read_bytes())]
        (self.root/'config/staging-manifest.json').write_text(json.dumps({'files':{files[0][0]:'old'}}))
        self.write_config(self.prior_settings())
        first=self.sync(files);key=self.config()['EOFFICE_MEMBER_VERSION_KEY'];second=self.sync(files)
        self.assertTrue(first[0]['member_version_key_generated'])
        self.assertFalse(second[0]['member_version_key_generated'])
        self.assertEqual(self.config()['EOFFICE_MEMBER_VERSION_KEY'],key)
        self.assertNotIn(key,json.dumps(first+second))
    def test_targeted_asset_sync_succeeds_on_legacy_runtime_and_updates_manifest(self):
        import hashlib
        self.legacy_runtime();self.write_config(self.prior_settings());(self.root/'assets').mkdir()
        name='assets/main.js';(self.root/name).write_bytes(b'old-file')
        (self.root/'config/staging-manifest.json').write_text(json.dumps({'files':{name:'old-digest'}}))
        result=self.sync([(name,b'new-file')])
        self.assertFalse(result[1]['member_hmac_runtime_available']);self.assertFalse(result[2]['member_hmac_runtime_available'])
        self.assertEqual((self.root/name).read_bytes(),b'new-file')
        manifest=json.loads((self.root/'config/staging-manifest.json').read_text())
        self.assertEqual(manifest['files'][name],hashlib.sha256(b'new-file').hexdigest())
        self.assertTrue(result[-1]['application_synced'])
    def test_targeted_sync_changes_only_a_missing_key_preserving_storage_and_routes(self):
        self.legacy_runtime();before=self.prior_settings();self.write_config(before)
        (self.root/'config/staging-manifest.json').write_text(json.dumps({'files':{'asset.js':'old-digest'}}))
        self.sync([('asset.js',b'new-file')]);after=self.config()
        for key,value in before.items():self.assertEqual(after[key],value,key)
        self.assertEqual(set(after)-set(before),{'EOFFICE_MEMBER_VERSION_KEY'})
        content=(self.root/'config/local.php').read_bytes()
        self.sync([('asset.js',b'second-file')])
        self.assertEqual((self.root/'config/local.php').read_bytes(),content)
    def test_sync_without_file_filter_also_preserves_existing_runtime_settings(self):
        self.legacy_runtime();before=self.prior_settings();self.write_config(before)
        name='config/member-management.php'
        result=self.sync([(name,(ROOT/name).read_bytes())],targeted=False)
        for key,value in before.items():self.assertEqual(self.config()[key],value,key)
        self.assertTrue(result[2]['member_hmac_runtime_available'])
    def test_invalid_runtime_fails_preflight_before_publishing_asset(self):
        self.provision();(self.root/'asset.js').write_bytes(b'old-file')
        before={'files':{'asset.js':'old-digest'}}
        (self.root/'config/staging-manifest.json').write_text(json.dumps(before))
        (self.root/'config/member-management.php').write_text("<?php require_once __DIR__.'/bootstrap.php'; function app_member_version_key(): string { throw new RuntimeException('broken runtime'); }",encoding='utf-8')
        with self.assertRaises(RuntimeError):self.sync([('asset.js',b'new-file')])
        self.assertEqual((self.root/'asset.js').read_bytes(),b'old-file')
        self.assertEqual(json.loads((self.root/'config/staging-manifest.json').read_text()),before)
    def test_member_runtime_upgrade_requires_hmac_but_asset_only_sync_does_not(self):
        self.legacy_runtime();self.write_config(self.prior_settings())
        staging.configure_staging(self.ftp,self.database,self.metadata,key_only=True)
        with self.assertRaisesRegex(RuntimeError,'HMAC runtime is missing'):staging.verify_member_key(self.ftp)
        self.assertFalse(staging.verify_member_key(self.ftp,require_runtime=False)['member_hmac_runtime_available'])
        name='config/member-management.php';(self.root/'config/staging-manifest.json').write_text(json.dumps({'files':{name:'old-digest'}}))
        result=self.sync([(name,(ROOT/name).read_bytes())])
        self.assertFalse(result[1]['member_hmac_runtime_available']);self.assertTrue(result[2]['member_hmac_runtime_available'])
    def test_targeted_sync_missing_private_config_fails_before_application_changes(self):
        (self.root/'asset.js').write_bytes(b'old-file')
        with self.assertRaises(RuntimeError):self.sync([('asset.js',b'new-file')])
        self.assertEqual((self.root/'asset.js').read_bytes(),b'old-file')
        self.assertFalse((self.root/'config/local.php').exists())
    def test_member_helper_sync_publishes_its_dependency_closure_before_helper(self):
        self.write_config(self.prior_settings())
        self.legacy_runtime()
        missing=self.root/'config/sign-routing.php';missing.unlink()
        manifest=self.root/'config/staging-manifest.json';before_manifest={'files':{'config/member-management.php':'old-helper'}}
        manifest.write_text(json.dumps(before_manifest))
        names=['config/permissions.php','config/bootstrap.php','config/sign-routing.php','config/member-management.php']
        files=[(name,(ROOT/name).read_bytes()) for name in names]
        result=self.sync(files,selected=['config/member-management.php'])
        self.assertTrue(missing.is_file())
        self.assertTrue(result[2]['member_hmac_runtime_available'])
        updated=json.loads(manifest.read_text())['files']
        for name in ['config/permissions.php','config/bootstrap.php','config/sign-routing.php','config/member-management.php']:
            self.assertIn(name,updated)
    def test_remote_dependency_closure_is_checked_recursively_before_sync(self):
        self.write_config(self.prior_settings());(self.root/'api').mkdir()
        (self.root/'api/legacy.php').write_text("<?php require_once __DIR__.'/../missing-runtime.php';",encoding='utf-8')
        (self.root/'management').mkdir();name='management/new-api.php'
        staged=b"<?php require_once __DIR__.'/../api/legacy.php';"
        (self.root/name).write_bytes(b'original')
        before=(self.root/'config/local.php').read_bytes()
        with self.assertRaisesRegex(RuntimeError,'missing required PHP dependency: missing-runtime.php'):
            self.sync([(name,staged)])
        self.assertEqual((self.root/name).read_bytes(),b'original')
        self.assertEqual((self.root/'config/local.php').read_bytes(),before)


if __name__=='__main__':unittest.main()
