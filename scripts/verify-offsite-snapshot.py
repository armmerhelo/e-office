"""Reconstruct the completed local snapshot, verify counts, then remove plaintext."""
import argparse
import importlib.util
import json
import os
import secrets
import shutil
import subprocess
from pathlib import Path

spec=importlib.util.spec_from_file_location('restore',Path(__file__).with_name('restore-snapshot.py'))
restore=importlib.util.module_from_spec(spec);spec.loader.exec_module(restore)
parser=argparse.ArgumentParser();parser.add_argument('folder');parser.add_argument('--key-file',required=True);args=parser.parse_args()
folder=Path(args.folder);progress=json.loads((folder/'progress.private.json').read_text(encoding='utf-8'))
if progress['status']!='completed':raise RuntimeError('Completed snapshot required')
if shutil.disk_usage(folder).free<progress['bytes_total']+134217728:raise RuntimeError('Insufficient free space for recovery drill')
destination=restore.ROOT/'backups'/('snapshot-recovery-drill-'+secrets.token_hex(6))
try:
    result=restore.restore_snapshot(folder,args.key_file,destination)
    if result['files']!=progress['files_total'] or result['bytes']!=progress['bytes_total']:raise RuntimeError('Snapshot recovery counts mismatch')
    key=json.loads(Path(args.key_file).read_text(encoding='utf-8'))['key_b64']
    env={**os.environ,'EOFFICE_BACKUP_KEY':key}
    archives={}
    for name in ['database.ebak','application.ebak','manifest.ebak']:
        process=subprocess.run([restore.PHP,str(restore.ROOT/'scripts/encrypted-file.php'),'verify',str(folder/name)],env=env,capture_output=True,check=True)
        archives[name]={**json.loads(process.stdout),'archive_sha256':restore.digest(folder/name)}
    report={**result,'archive_verification':archives,'plaintext_removed':True,'snapshot':progress['snapshot']}
finally:
    if destination.exists():shutil.rmtree(destination)
(folder/'recovery-drill.private.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({'snapshot_recovery_verified':True,'files':result['files'],'bytes':result['bytes'],'plaintext_removed':True,'supporting_archives_verified':len(archives)}))
