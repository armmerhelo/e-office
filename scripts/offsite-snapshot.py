"""Resumable encrypted, off-host copy of the deployment's immutable snapshot."""
import argparse,base64,hashlib,importlib.util,json,os,secrets,subprocess,time,ftplib,shutil,traceback
from contextlib import contextmanager
from pathlib import Path
spec=importlib.util.spec_from_file_location('production',Path(__file__).with_name('production-hosting.py'))
production=importlib.util.module_from_spec(spec);spec.loader.exec_module(production)
TEMP=production.TEMP;STATE=TEMP/'eoffice-offsite-resumable.private.json';PHP=os.environ.get('PHP_BIN','C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe');CHUNK=32*1024*1024
def write_json(path,data):
    tmp=path.with_suffix('.writing');tmp.write_text(json.dumps(data),encoding='utf-8');publish(tmp,path)
    if path==STATE and Path(data['directory']).is_dir():
        progress=Path(data['directory'])/'progress.private.json'
        pending=progress.with_suffix('.writing');pending.write_text(json.dumps({k:v for k,v in data.items() if k!='key_b64'}),encoding='utf-8');publish(pending,progress)
def publish(source,target):
    for attempt in range(20):
        try:source.replace(target);return
        except PermissionError:
            if attempt==19:raise
            time.sleep(0.1)
def digest(path):
    result=hashlib.sha256()
    with open(path,'rb') as source:
        for part in iter(lambda:source.read(1024*1024),b''):result.update(part)
    return result.hexdigest()
def entries(ftp,prefix):
    for name,facts in ftp.mlsd(prefix):
        if name in ['.','..']:continue
        if any(c in name for c in ['/', '\\','\n','\r']):raise RuntimeError('Unsafe snapshot filename')
        path=prefix+'/'+name
        if facts.get('type')=='dir':yield from entries(ftp,path)
        elif facts.get('type')=='file':yield {'remote':path,'size':int(facts['size']),'parts':[]}
def env(state):return {**os.environ,'EOFFICE_BACKUP_KEY':state['key_b64'],'EOFFICE_BACKUP_ENCODING':'document-slice'}
def verify(path,state):
    result=subprocess.run([PHP,str(production.hosting.ROOT/'scripts/encrypted-file.php'),'verify',str(path)],env=env(state),capture_output=True,check=True)
    return json.loads(result.stdout)
def saved_offset(entry,index,folder,state):
    size=entry['size'];offset=0
    if type(size) is not int or size<0:raise RuntimeError('Invalid saved file size')
    for part in entry['parts']:
        length=part['length']
        if type(length) is not int or type(part['offset']) is not int or part['offset']!=offset or length<0 or (length==0 and (size!=0 or len(entry['parts'])!=1)) or offset+length>size:raise RuntimeError('Invalid saved part offsets')
        if part['archive']!=f'{index:06d}-{offset:012d}.ebak':raise RuntimeError('Invalid saved part filename')
        path=folder/part['archive']
        if digest(path)!=part['archive_sha256']:raise RuntimeError('Saved part integrity mismatch')
        result=verify(path,state)
        if result['bytes']!=length or result['sha256']!=part['plaintext_sha256']:raise RuntimeError('Saved part authentication mismatch')
        offset+=length
    return offset
def encrypt_part(ftp,entry,offset,length,path,state):
    partial=Path(str(path)+'.partial')
    if partial.exists():partial.unlink()
    proc=subprocess.Popen([PHP,str(production.hosting.ROOT/'scripts/encrypted-file.php'),'encrypt','-',str(path)],env=env(state),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    connection=None
    try:
        ftp.voidcmd('TYPE I');connection=ftp.transfercmd('RETR '+entry['remote'],rest=offset if offset else None);connection.settimeout(90)
        remaining=length;last=0
        with connection.makefile('rb') as source:
            while remaining:
                data=source.read(min(65536,remaining))
                if not data:raise RuntimeError('Short snapshot transfer')
                proc.stdin.write(data);remaining-=len(data)
                if time.monotonic()-last>5:
                    last=time.monotonic();state['active_part_bytes']=length-remaining;write_json(STATE,state)
            if offset+length==entry['size'] and source.read(1):raise RuntimeError('Snapshot file size changed')
        if offset+length==entry['size']:
            # Complete RETR: finish TLS and consume 226 before reusing control.
            plain=connection.unwrap();plain.close();connection=None;ftp.voidresp()
        else:
            # A bounded slice intentionally ends RETR early. Discard both
            # connections so pending FTP responses cannot poison the next file.
            connection.close();connection=None;ftp.close()
        proc.stdin.close();proc.stdin=None;output,errors=proc.communicate(timeout=120)
        if proc.returncode!=0:raise RuntimeError('Part encryption failed')
        result=verify(path,state)
        if result['bytes']!=length:raise RuntimeError('Part length mismatch')
        return {'offset':offset,'length':length,'archive':path.name,'archive_sha256':digest(path),'plaintext_sha256':result['sha256']}
    except Exception:
        if proc.poll() is None:proc.kill();proc.communicate()
        if partial.exists():partial.unlink()
        if path.exists():path.unlink()
        raise
    finally:
        if connection:connection.close()
@contextmanager
def exclusive_lock(path):
    with open(path,'a+b') as lock:
        if lock.tell()==0:lock.write(b'0');lock.flush()
        lock.seek(0)
        if os.name=='nt':
            import msvcrt
            msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield
def run(seconds=None):
    with exclusive_lock(STATE.with_suffix('.lock')):
        state=json.loads(STATE.read_text());folder=Path(state['directory'])
        with exclusive_lock(folder/'.worker.lock'):
            _run(time.monotonic()+seconds if seconds else None,state)
def _run(deadline=None,state=None):
    state=state if state is not None else json.loads(STATE.read_text());folder=Path(state['directory']);manifest_path=folder/'snapshot-manifest.private.json'
    state.update(status='running',pid=os.getpid(),error_class=None);write_json(STATE,state)
    ftp=None
    try:
        account,_=production.credentials()
        for orphan in folder.glob('*.partial'):orphan.unlink()
        if manifest_path.exists():manifest=json.loads(manifest_path.read_text())
        else:
            with production.hosting.connect(account,'ftp.siya.ac.th') as listing:
                manifest={'version':1,'snapshot':state['snapshot'],'ftp_snapshot':state['ftp_snapshot'],'entries':list(entries(listing,state['ftp_snapshot']))}
            write_json(manifest_path,manifest)
        state['files_total']=len(manifest['entries']);state['bytes_total']=sum(e['size'] for e in manifest['entries']);write_json(STATE,state)
        for index,entry in enumerate(manifest['entries']):
            offset=saved_offset(entry,index,folder,state)
            if offset==entry['size'] and entry['parts']:continue
            while offset<entry['size'] or (entry['size']==0 and not entry['parts']):
                if deadline and time.monotonic()>=deadline:
                    state.update(status='paused',active_part_bytes=0);write_json(STATE,state);return
                length=min(CHUNK,entry['size']-offset);path=folder/(f'{index:06d}-{offset:012d}.ebak');state['active_part_bytes']=0;state['active_file_index']=index;write_json(STATE,state)
                if path.exists():path.unlink()  # A complete-but-uncommitted part from a stopped worker.
                success=False
                for attempt in range(3):
                    try:
                        if ftp is None:ftp=production.hosting.connect(account,'ftp.siya.ac.th')
                        part=encrypt_part(ftp,entry,offset,length,path,state)
                        if ftp.sock is None:ftp=None
                        success=True;break
                    except (OSError,EOFError,RuntimeError,ftplib.Error):
                        if ftp:ftp.close()
                        ftp=None;time.sleep(2*(attempt+1))
                if not success:raise RuntimeError('Snapshot transfer failed after retries')
                entry['parts'].append(part);offset+=length;write_json(manifest_path,manifest)
                state['verified_bytes']=sum(p['length'] for e in manifest['entries'] for p in e['parts']);state['files_copied']=sum(bool(e['parts']) and sum(p['length'] for p in e['parts'])==e['size'] for e in manifest['entries']);write_json(STATE,state)
                if length==0:break
        # Encrypt metadata and the small schema/data/application backups too.
        for label,meta_name in [('database','eoffice-production-db-backup.private.json'),('application','eoffice-production-app-backup.private.json')]:
            meta=json.loads((TEMP/meta_name).read_text());source=Path(meta['path']);destination=folder/(label+'.ebak')
            if digest(source)!=meta['sha256']:raise RuntimeError('Deployment backup integrity mismatch')
            if not destination.exists():subprocess.run([PHP,str(production.hosting.ROOT/'scripts/encrypted-file.php'),'encrypt',str(source),str(destination)],env=env(state),capture_output=True,check=True)
            result=verify(destination,state)
            if result['sha256']!=meta['sha256']:raise RuntimeError('Encrypted deployment backup content mismatch')
        encrypted_manifest=folder/'manifest.ebak'
        if encrypted_manifest.exists():encrypted_manifest.unlink()
        subprocess.run([PHP,str(production.hosting.ROOT/'scripts/encrypted-file.php'),'encrypt',str(manifest_path),str(encrypted_manifest)],env=env(state),capture_output=True,check=True)
        verify(encrypted_manifest,state);state.update(status='completed',completed_at=time.strftime('%Y-%m-%dT%H:%M:%S'),active_part_bytes=0);write_json(STATE,state)
    except Exception as error:
        frame=traceback.extract_tb(error.__traceback__)[-1]
        state.update(status='failed',error_class=type(error).__name__,error_location={'function':frame.name,'line':frame.lineno},error_errno=getattr(error,'errno',None));write_json(STATE,state);raise RuntimeError('Resumable offsite backup stopped; verified parts retained') from None
    finally:
        if ftp:ftp.close()
def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['start','run','status','resume','relocate','stop']);parser.add_argument('--foreground',action='store_true');parser.add_argument('--seconds',type=int);args=parser.parse_args()
    if args.seconds is not None and args.seconds<1:raise RuntimeError('Positive run budget required')
    if args.action=='status':print(json.dumps({k:v for k,v in json.loads(STATE.read_text()).items() if k!='key_b64'},indent=2));return
    if args.action=='run':run(args.seconds);return
    if args.action=='stop':
        if os.name!='nt':raise RuntimeError('Managed stop currently supports this Windows workstation only')
        state=json.loads(STATE.read_text());pid=int(state.get('pid',0))
        if state['status'] in ['completed','failed','paused']:
            print(json.dumps({'stopped':True,'already_stopped':True,'status':state['status']}));return
        if pid<=0:raise RuntimeError('Worker PID unavailable')
        command=f"$worker=Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}'; if ($worker) {{ if ($worker.CommandLine -notmatch 'offsite-snapshot.py.*(?:run|(?:start|resume).*--foreground)') {{ throw 'Worker identity mismatch' }}; $children=Get-CimInstance Win32_Process -Filter 'ParentProcessId = {pid}'; Stop-Process -Id {pid} -ErrorAction Stop; foreach ($child in $children) {{ Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue }} }}"
        subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',command],capture_output=True,check=True)
        state=json.loads(STATE.read_text());state.update(status='failed',error_class='StoppedByOwner');write_json(STATE,state)
        print(json.dumps({'stopped':True,'verified_parts_retained':True}));return
    if args.action=='relocate':
        with exclusive_lock(STATE.with_suffix('.lock')):
            state=json.loads(STATE.read_text())
            if state['status'] not in ['failed','paused','completed']:raise RuntimeError('Stop the worker before relocating')
            destination=production.hosting.ROOT/'backups'/Path(state['directory']).name
            if destination.exists():raise RuntimeError('Backup destination already exists')
            shutil.move(state['directory'],destination);state['directory']=str(destination)
            vault=production.hosting.ROOT/'backups'/'keys'/Path(state['key_vault']).name;vault.parent.mkdir(exist_ok=True)
            shutil.move(state['key_vault'],vault);state['key_vault']=str(vault)
            vault.write_text(json.dumps({'key_b64':state['key_b64'],'directory':str(destination)},indent=2),encoding='utf-8');write_json(STATE,state)
            print(json.dumps({'relocated':True,'directory':str(destination),'key_vault':str(vault)}));return
    with exclusive_lock(STATE.with_suffix('.lock')):
        prepare_job(args.action)
    if args.foreground:
        run(args.seconds);print(json.dumps({k:v for k,v in json.loads(STATE.read_text()).items() if k!='key_b64'}));return
    command=[os.sys.executable,str(Path(__file__).resolve()),'run']
    if args.seconds is not None:command.extend(['--seconds',str(args.seconds)])
    state=json.loads(STATE.read_text())
    log=open(TEMP/'eoffice-offsite-resumable.log','ab');kwargs={'stdin':subprocess.DEVNULL,'stdout':log,'stderr':log,'close_fds':True}
    if os.name=='nt':kwargs['creationflags']=subprocess.DETACHED_PROCESS|subprocess.CREATE_NEW_PROCESS_GROUP
    else:kwargs['start_new_session']=True
    process=subprocess.Popen(command,**kwargs);log.close();print(json.dumps({'started':True,'pid':process.pid,'directory':state['directory']}))
def prepare_job(action):
    if action=='start':
        if STATE.exists() and json.loads(STATE.read_text())['status'] in ['starting','running']:raise RuntimeError('Backup already running')
        snapshot=json.loads((TEMP/'eoffice-production-storage-snapshot.private.json').read_text())['snapshot'];prefix='/home/siyaacth/domains/e-office.siya.ac.th/'
        if not snapshot.startswith(prefix):raise RuntimeError('Unexpected snapshot root')
        folder=production.hosting.ROOT/'backups'/('snapshot-'+time.strftime('%Y%m%d-%H%M%S')+'-'+secrets.token_hex(4));folder.mkdir(parents=True)
        vault=production.hosting.ROOT/'backups'/'keys';vault.mkdir(exist_ok=True)
        state={'status':'starting','snapshot':snapshot,'ftp_snapshot':'/'+snapshot[len(prefix):],'directory':str(folder),'key_b64':base64.b64encode(secrets.token_bytes(32)).decode(),'key_vault':str(vault/(folder.name+'.key.private.json')),'verified_bytes':0,'files_copied':0}
        Path(state['key_vault']).write_text(json.dumps({'key_b64':state['key_b64'],'directory':str(folder)},indent=2),encoding='utf-8')
        write_json(STATE,state)
    else:
        state=json.loads(STATE.read_text())
        if state['status'] not in ['failed','paused']:raise RuntimeError('Only a stopped backup may resume')
        state['status']='starting';write_json(STATE,state)
if __name__=='__main__':main()
