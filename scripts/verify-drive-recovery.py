"""Real dated Drive checkpoint recovery into private local scratch, then cleanup."""
import argparse,hashlib,importlib.util,json,os,secrets,shutil,subprocess,re,base64
from pathlib import Path
spec=importlib.util.spec_from_file_location('restore',Path(__file__).with_name('restore-backup.py'))
restore=importlib.util.module_from_spec(spec);spec.loader.exec_module(restore)
ROOT=restore.ROOT
spec=importlib.util.spec_from_file_location('production',Path(__file__).with_name('production-hosting.py'))
production=importlib.util.module_from_spec(spec);spec.loader.exec_module(production)
def host_call(ftp,code):
    key=secrets.token_hex(32)
    return production.invoke(ftp,production.php(key)+"ini_set('zend.exception_ignore_args','1');set_time_limit(180);require __DIR__.'/config/drive-archive.php';"+code,key)
def host_recovery(date,directory,env):
    directory.mkdir(mode=0o700);cache=directory/'objects';cache.mkdir(mode=0o700)
    account,_=production.credentials()
    with production.hosting.connect(account,'ftp.siya.ac.th') as ftp:
        production.hosting.webroot(ftp)
        run=host_call(ftp,"echo json_encode(app_drive_archive_call(['action'=>'run','date'=>"+production.hosting.php_value(date)+"]));")
        def get(object_id):
            if not re.fullmatch(r'[a-f0-9]{64}',object_id):raise RuntimeError('Invalid cloud object identity')
            target=cache/(object_id+'.ebak')
            if target.exists():return target
            name='recovery-'+secrets.token_hex(16)+'.ebak'
            code="$bytes=app_drive_archive_get("+production.hosting.php_value(object_id)+");$path=app_drive_archive_directory('spool').'/"+name+"';if(file_put_contents($path,$bytes)!==strlen($bytes))throw new RuntimeException('Recovery staging failed');chmod($path,0600);echo json_encode(['staged'=>true]);"
            host_call(ftp,code);remote='/private/drive-archive/spool/'+name
            try:data=production.hosting.retrieve(ftp,remote)
            finally:ftp.delete(remote)
            if hashlib.sha256(data).hexdigest()!=object_id:raise RuntimeError('Cloud ciphertext checksum mismatch')
            target.write_bytes(data);return target
        descriptor=json.loads(get(run['descriptor']).read_text(encoding='utf-8'))
        if descriptor['date']!=date:raise RuntimeError('Checkpoint date mismatch')
        for label in ['database','manifest']:
            info=descriptor['archives'][label];target=directory/(label+'.ebak')
            with open(target,'xb') as output:
                for object_id in info['parts']:
                    with open(get(object_id),'rb') as incoming:shutil.copyfileobj(incoming,output,1048576)
            if target.stat().st_size!=info['bytes'] or hashlib.sha256(target.read_bytes()).hexdigest()!=info['sha256']:raise RuntimeError('Cloud archive assembly mismatch')
        plain=directory/'manifest.private.json'
        result=subprocess.run([restore.PHP,str(ROOT/'scripts/encrypted-file.php'),'decrypt',str(directory/'manifest.ebak'),str(plain)],env=env,capture_output=True,check=True)
        manifest=json.loads(plain.read_text(encoding='utf-8'));count=0
        key_id=hashlib.sha256(base64.b64decode(env['EOFFICE_BACKUP_KEY'])).hexdigest()[:16]
        for document in manifest['documents']:
            version=manifest['versions'][document['version']]
            if version['key_id']!=key_id:raise RuntimeError('Historical recovery key required')
            name=document['name'];year=document['year'];variant=document['variant']
            if Path(name).name!=name or '\\' in name or ':' in name or not re.fullmatch(r'\d{4}',year) or variant not in ['original','signed']:raise RuntimeError('Unsafe recovery path')
            relative=Path('e-sign' if variant=='signed' else 'original')/year/(('signed_'+str(document['doc_id'])+'_')+name if variant=='signed' else name)
            target=directory/'file_document'/relative;target.parent.mkdir(parents=True,exist_ok=True)
            if target.exists():
                if hashlib.sha256(target.read_bytes()).hexdigest()!=version['revision']:raise RuntimeError('Conflicting cloud recovery identity')
                continue
            digest=hashlib.sha256();size=0
            with open(target,'xb') as output:
                for part in json.loads(version['parts']):
                    if part['offset']!=size:raise RuntimeError('Cloud part ordering mismatch')
                    part_plain=directory/'part.plain'
                    result=subprocess.run([restore.PHP,str(ROOT/'scripts/encrypted-file.php'),'decrypt',str(get(part['object'])),str(part_plain)],env=env,capture_output=True,check=True)
                    checked=json.loads(result.stdout)
                    if checked['bytes']!=part['bytes'] or checked['sha256']!=part['sha256']:raise RuntimeError('Cloud part plaintext mismatch')
                    with open(part_plain,'rb') as incoming:
                        for chunk in iter(lambda:incoming.read(1048576),b''):digest.update(chunk);size+=len(chunk);output.write(chunk)
                    part_plain.unlink()
            if size!=int(version['bytes']) or digest.hexdigest()!=version['revision']:raise RuntimeError('Cloud file recovery mismatch')
            count+=1
        return {'files':count,'complete_recovery_set':manifest.get('complete_recovery_set',True),'pending_files':manifest.get('pending_files',0)}
def main():
    parser=argparse.ArgumentParser();parser.add_argument('date');args=parser.parse_args()
    setup=json.loads(ROOT.joinpath('backups/keys/drive-appscript-setup.private.json').read_text(encoding='utf-8'))
    keys=json.loads(ROOT.joinpath('backups/keys/eoffice-operations-keys.private.json').read_text(encoding='utf-8'))
    env={**os.environ,'EOFFICE_DRIVE_ARCHIVE_URL':setup['url'],'EOFFICE_DRIVE_ARCHIVE_SECRET':setup['script_properties']['EOFFICE_ARCHIVE_SECRET'],'EOFFICE_BACKUP_KEY':keys['backup_key']}
    directory=ROOT/'backups'/('drive-recovery-drill-'+secrets.token_hex(8))
    try:
        recovered=host_recovery(args.date,directory,env)
        database=restore.unpack_database(directory/'database.ebak',ROOT/'backups/keys/eoffice-operations-keys.private.json',directory/'db-verified')
        report={'cloud_checkpoint_recovered':True,'date':args.date,'files_recovered':recovered['files'],'complete_recovery_set':recovered['complete_recovery_set'],'pending_files':recovered['pending_files'],'database_tables':database['tables'],'database_rows':database['rows'],'plaintext_removed':True}
    finally:
        if directory.exists():shutil.rmtree(directory)
    ROOT.joinpath('backups/drive-checkpoint-recovery.private.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))
if __name__=='__main__':
    try:main()
    except Exception as error:
        detail=str(error) if isinstance(error,RuntimeError) and str(error).startswith('Actual checkpoint recovery failed') else type(error).__name__
        raise SystemExit('Drive checkpoint drill failed ('+detail+'); secrets/plaintext not printed') from None
