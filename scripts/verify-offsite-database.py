"""Local-only production archive recovery drill; never connects to the host DB."""
import importlib.util
import argparse
import json
import os
import secrets
import shutil
import subprocess
from pathlib import Path

spec=importlib.util.spec_from_file_location('restore',Path(__file__).with_name('restore-backup.py'))
restore=importlib.util.module_from_spec(spec);spec.loader.exec_module(restore)
root=restore.ROOT/'backups'
parser=argparse.ArgumentParser();parser.add_argument('--cleanup-stale',action='store_true');args=parser.parse_args()
metadata=next(root.glob('database-*.metadata.private.json'))
info=json.loads(metadata.read_text(encoding='utf-8'))
database='eoffice_offsite_restore_'+secrets.token_hex(6)+'_test'
directory=root/('recovery-drill-'+secrets.token_hex(6))
env={**os.environ,'DB_HOST':'127.0.0.1','DB_PORT':os.environ.get('LOCAL_TEST_DB_PORT','3307'),'DB_DATABASE':database,'DB_USERNAME':'root','DB_PASSWORD':''}
def sql(statement):
    # Database name is generated locally and restricted to alphanumerics.
    code='require "config/bootstrap.php";app_pdo()->exec('+json.dumps(statement)+');'
    process=subprocess.run([restore.PHP,'-r',code],cwd=restore.ROOT,env={**env,'DB_DATABASE':'mysql'},capture_output=True)
    if process.returncode:raise RuntimeError('Local recovery database command failed')
created=False
if args.cleanup_stale:
    code='require "config/bootstrap.php";echo json_encode(app_pdo()->query("SHOW DATABASES")->fetchAll(PDO::FETCH_COLUMN));'
    process=subprocess.run([restore.PHP,'-r',code],cwd=restore.ROOT,env={**env,'DB_DATABASE':'mysql'},capture_output=True,check=True)
    import re
    for name in json.loads(process.stdout):
        if re.fullmatch(r'eoffice_offsite_restore_[a-f0-9]{12}_test',name):sql('DROP DATABASE `'+name+'`')
    for stale in root.glob('recovery-drill-*'):
        if stale.is_dir():shutil.rmtree(stale)
try:
    sql('CREATE DATABASE `'+database+'` CHARACTER SET utf8mb4');created=True
    process=subprocess.run([os.sys.executable,str(restore.ROOT/'scripts/restore-backup.py'),info['path'],'--key-file',info['key_vault'],'--output',str(directory),'--database',database],env=env,capture_output=True)
    if process.returncode:raise RuntimeError('Private local recovery drill failed')
    result=json.loads(process.stdout)
    if result['tables']!=info['tables'] or result['rows']!=info['rows']:raise RuntimeError('Restored counts mismatch')
    report={**result,'database_target':'isolated local test database','archive_sha256':info['archive_sha256'],'plaintext_removed':True,'test_database_removed':True}
finally:
    if created:sql('DROP DATABASE `'+database+'`')
    if directory.exists():shutil.rmtree(directory)
if created:
    (root/'database-recovery-drill.private.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))
