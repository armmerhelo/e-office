"""Targeted five-finding order-email hotfix, with a version-guarded queue pause."""
import argparse
import hashlib
import importlib.util
import io
import json
import subprocess
import tarfile
import time
from pathlib import Path

spec=importlib.util.spec_from_file_location('orders',Path(__file__).with_name('order-email-release.py'))
orders=importlib.util.module_from_spec(spec);spec.loader.exec_module(orders)
production=orders.production;ROOT=orders.ROOT;TEMP=orders.TEMP
STATE=TEMP/'eoffice-order-review-release.private.json'
REVIEWED={}
FILES=['config/order-email-schema.php','config/order-emails.php','email_send/ai_settings.php','email_send/order_jobs.php','email_send/order-ui.js','email_send/ai-settings.css','email_send/order-dashboard.css','email_send/ai-settings.js','email_send/ai_settings.html','api/view_file.php','config/drive-archive.php']

def release_bytes(name,remote):
    # These shared files have concurrent lock-related work in the checkout.
    # Publish ONLY year normalization over the inspected production bytes.
    if name=='config/drive-archive.php':
        old=b"$year=(string)$doc['Doc_Year'];";new=b"$year=trim((string)$doc['Doc_Year']);"
        if old in remote:return remote.replace(old,new)
        if new in remote:return remote
        raise RuntimeError('Unexpected production archive year helper')
    if name=='api/view_file.php':
        result=remote.replace(b"$year=(string)$doc['Doc_Year'];",b"$year=trim((string)$doc['Doc_Year']);")
        result=result.replace(b"(string)$_GET['Year']!==$year",b"trim((string)$_GET['Year'])!==$year")
        result=result.replace(b"(string)$doc['Doc_Year']!==$year",b"trim((string)$doc['Doc_Year'])!==$year")
        result=result.replace(b"(string)$latest['Doc_Year']!==$year",b"trim((string)$latest['Doc_Year'])!==$year")
        if b"$year=trim((string)$doc['Doc_Year']);" not in result:raise RuntimeError('Unexpected production file-view year logic')
        return result
    return (ROOT/name).read_bytes()

def digest(data):return hashlib.sha256(data).hexdigest()

def inspect(ftp):
    result=orders.invoke(ftp,"""
require __DIR__.'/config/order-emails.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock'])throw new RuntimeException('Wrong target');
$pdo=app_pdo();$revision=(bool)$pdo->query("SHOW COLUMNS FROM eoffice_order_settings LIKE 'revision'")->fetch();
$fields='enabled,activated_at,worker_at'.($revision?',revision':'');
echo json_encode(['settings'=>$pdo->query('SELECT '.$fields.' FROM eoffice_order_settings WHERE id=1')->fetch(),
'jobs'=>$pdo->query('SELECT status,COUNT(*) total FROM eoffice_order_jobs GROUP BY status')->fetchAll(),
'counts'=>['users'=>(int)$pdo->query('SELECT COUNT(*) FROM t_user')->fetchColumn(),'documents'=>(int)$pdo->query('SELECT COUNT(*) FROM t_document')->fetchColumn()]]);
""")
    result['files']=[];release_hashes=json.loads(STATE.read_text()).get('release',{}) if STATE.exists() else {}
    for name in FILES:
        try:remote=production.hosting.retrieve(ftp,name)
        except production.hosting.ftplib.error_perm as error:
            if not str(error).startswith('550'):raise
            result['files'].append({'path':name,'state':'new','sha256':None});continue
        head=subprocess.check_output(['git','cat-file','blob','HEAD:'+name],cwd=ROOT)
        normalize=lambda value:value.replace(b'\r\n',b'\n')
        kind='current' if normalize(remote)==normalize(release_bytes(name,remote)) else 'head' if normalize(remote)==normalize(head) else 'previous_release' if digest(remote)==release_hashes.get(name) else 'reviewed' if digest(remote)==REVIEWED.get(name) else 'different'
        if kind=='different':
            folder=TEMP/'eoffice-order-review-inspected'/Path(name).parent;folder.mkdir(parents=True,exist_ok=True);(folder/Path(name).name).write_bytes(remote)
            for commit in subprocess.check_output(['git','log','--format=%H','-10','--',name],cwd=ROOT).decode().splitlines():
                previous=subprocess.check_output(['git','cat-file','blob',commit+':'+name],cwd=ROOT)
                if normalize(remote)==normalize(previous):kind='previous';break
        result['files'].append({'path':name,'state':kind,'sha256':digest(remote)})
    return result

def prepare(ftp):
    inspection=inspect(ftp)
    if any(row['state']=='different' for row in inspection['files']):raise RuntimeError('Production changed: inspect differences before deploying')
    destination=TEMP/('eoffice-order-review-before-'+time.strftime('%Y%m%d-%H%M%S')+'.tar.gz')
    release={};overrides={};before_hashes={}
    with tarfile.open(destination,'w:gz') as archive:
        for name in FILES:
            if next(row['state'] for row in inspection['files'] if row['path']==name)=='new':continue
            data=production.hosting.retrieve(ftp,name);entry=tarfile.TarInfo(name);entry.size=len(data);archive.addfile(entry,io.BytesIO(data))
            before_hashes[name]=digest(data);content=release_bytes(name,data);release[name]=digest(content)
            if name in ['api/view_file.php','config/drive-archive.php']:
                folder=TEMP/'eoffice-order-year-normalization'/Path(name).parent;folder.mkdir(parents=True,exist_ok=True);target=folder/Path(name).name;target.write_bytes(content);overrides[name]=str(target)
    for name in FILES:
        if name not in release:release[name]=digest((ROOT/name).read_bytes())
    state={'backup':str(destination),'backup_sha256':digest(destination.read_bytes()),'before':inspection,'before_hashes':before_hashes,'release':release,'overrides':overrides}
    STATE.write_text(json.dumps(state,indent=2),encoding='utf-8')
    return {'backup':str(destination),'files':len(FILES),'sha256':state['backup_sha256']}

def pause(ftp):
    state=json.loads(STATE.read_text());result=orders.invoke(ftp,"""
require __DIR__.'/config/order-emails.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock'])throw new RuntimeException('Wrong target');
$pdo=app_pdo();$hasRevision=(bool)$pdo->query("SHOW COLUMNS FROM eoffice_order_settings LIKE 'revision'")->fetch();$pdo->beginTransaction();
$row=$pdo->query('SELECT * FROM eoffice_order_settings WHERE id=1 FOR UPDATE')->fetch();
$wasEnabled=(bool)$row['enabled'];
if($wasEnabled){$pdo->exec('UPDATE eoffice_order_settings SET enabled=0,updated_at=NOW()'.($hasRevision?',revision=revision+1':'').' WHERE id=1');app_order_audit('review_patch_paused');}
$row=$pdo->query('SELECT * FROM eoffice_order_settings WHERE id=1')->fetch();$pdo->commit();
unset($row['worker_at']);echo json_encode(['was_enabled'=>$wasEnabled,'fingerprint'=>hash('sha256',json_encode($row)),'activated_at'=>$row['activated_at']]);
""")
    state['pause']=result;STATE.write_text(json.dumps(state,indent=2),encoding='utf-8')
    drained=orders.invoke(ftp,"""
require __DIR__.'/config/order-emails.php';set_time_limit(180);
if(app_order_settings()['enabled'])throw new RuntimeException('Queue was re-enabled by an Admin');
$q=app_pdo()->query("SELECT GET_LOCK('eoffice:orders',120)");if(!$q->fetchColumn())throw new RuntimeException('Worker did not drain before patch');
try{if(app_order_settings()['enabled'])throw new RuntimeException('Queue was re-enabled by an Admin');echo json_encode(['worker_drained'=>true]);}
finally{app_pdo()->query("SELECT RELEASE_LOCK('eoffice:orders')");}
""")
    state['worker_drained']=drained['worker_drained'];STATE.write_text(json.dumps(state,indent=2),encoding='utf-8')
    result.update(drained)
    return result

def deploy(ftp):
    state=json.loads(STATE.read_text())
    if digest(Path(state['backup']).read_bytes())!=state['backup_sha256']:raise RuntimeError('Backup checksum mismatch')
    if not state.get('pause') or not state.get('worker_drained'):raise RuntimeError('Pause and drain the queue before publishing')
    # Schema first, before the revision-aware API/worker can be loaded.
    if 'config/order-email-schema.php' in FILES:orders.upload(ftp,'config/order-email-schema.php')
    migrated=orders.invoke(ftp,"""
require __DIR__.'/config/bootstrap.php';require __DIR__.'/config/order-email-schema.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock'])throw new RuntimeException('Wrong target');
app_order_email_migrate(app_pdo());echo json_encode(['revision_column_ready'=>true]);
""")
    for name in FILES:
        if name=='config/order-email-schema.php':continue
        if name in state.get('overrides',{}):
            current=production.hosting.retrieve(ftp,name)
            if digest(current)!=state['before_hashes'][name]:raise RuntimeError('Shared production source changed during rollout')
            data=Path(state['overrides'][name]).read_bytes();temporary=name+'.upload-'+orders.secrets.token_hex(6)
            ftp.storbinary('STOR '+temporary,io.BytesIO(data));ftp.rename(temporary,name)
            if production.hosting.retrieve(ftp,name)!=data:raise RuntimeError('Shared year normalization checksum mismatch')
        else:orders.upload(ftp,name)
    manifest=json.loads(production.hosting.retrieve(ftp,'config/production-manifest.json'))
    manifest['files'].update(state['release']);manifest['updated_at']=time.strftime('%Y-%m-%dT%H:%M:%S');orders.save_manifest(manifest)
    (TEMP/'eoffice-production-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    # ALTER added revision=0 to an older table; account for that one expected
    # field without accepting any concurrent Admin key/model/enabled changes.
    fingerprint=orders.invoke(ftp,"""
require __DIR__.'/config/order-emails.php';$row=app_order_settings();unset($row['worker_at']);$without=$row;unset($without['revision']);
echo json_encode(['current'=>hash('sha256',json_encode($row)),'before_revision_column'=>hash('sha256',json_encode($without))]);
""")
    if state['pause']['fingerprint'] not in fingerprint.values():raise RuntimeError('Admin settings changed while paused; do not resume automatically')
    state['resume_fingerprint']=fingerprint['current'];state['deployed']=True;STATE.write_text(json.dumps(state,indent=2),encoding='utf-8')
    return {'files_updated':len(FILES),**migrated}

def repair(ftp):
    result=orders.invoke(ftp,"""
require __DIR__.'/config/order-emails.php';$pdo=app_pdo();
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock']||app_order_settings()['enabled'])throw new RuntimeException('Paused production required');
if(!$pdo->query("SELECT GET_LOCK('eoffice:orders',0)")->fetchColumn())throw new RuntimeException('Existing worker is still running');
$cancelled=0;$requeued=0;$added=0;
try{
$cancelled=$pdo->exec("UPDATE eoffice_order_recipients r JOIN eoffice_order_jobs j ON j.id=r.job_id SET r.status='cancelled',r.error_code='operator_cancelled' WHERE j.status='cancelled' AND r.status='pending'");
$jobs=$pdo->query("SELECT j.* FROM eoffice_order_jobs j JOIN t_document d ON d.Doc_Id=j.doc_id WHERE j.status<>'cancelled' AND d.Doc_Type='External' AND d.Is_Delete='active' ORDER BY j.id")->fetchAll();
foreach($jobs as $job){$lock='email:'.$job['doc_id'];$q=$pdo->prepare('SELECT GET_LOCK(?,0)');$q->execute([$lock]);if(!$q->fetchColumn())throw new RuntimeException('Operator is editing a job');
try{$pdo->beginTransaction();$q=$pdo->prepare('SELECT Doc_Id FROM t_document WHERE Doc_Id=? FOR UPDATE');$q->execute([$job['doc_id']]);
$q=$pdo->prepare('SELECT COUNT(*) FROM eoffice_order_recipients WHERE job_id=?');$q->execute([$job['id']]);$before=(int)$q->fetchColumn();app_order_document_recipients($job);$q->execute([$job['id']]);$added+=max(0,(int)$q->fetchColumn()-$before);
$q=$pdo->prepare("SELECT COUNT(*) FROM eoffice_order_recipients WHERE job_id=? AND status='pending'");$q->execute([$job['id']]);
if($q->fetchColumn()&&(in_array($job['status'],['success','partial'],true)||($job['status']==='review'&&$job['error_code']==='no_recipients'))){app_order_update((int)$job['id'],'queued');$requeued++;}
if($job['status']==='review'&&$job['error_code']==='files_changed'){
$q=$pdo->prepare("SELECT COUNT(*) FROM eoffice_order_recipients WHERE job_id=? AND status IN ('success','sending','uncertain')");$q->execute([$job['id']]);
if(!$q->fetchColumn()){$pdo->prepare("UPDATE eoffice_order_files SET status='pending',attempts=0,retry_at=NULL,error_code=NULL WHERE job_id=? AND status='failed' AND error_code='files_changed'")->execute([$job['id']]);app_order_update((int)$job['id'],'analyzing','files_changed');$requeued++;}}
$pdo->commit();}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}finally{$pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([$lock]);}}
app_order_audit('review_patch_repaired');
echo json_encode(['cancelled_pending_repaired'=>$cancelled,'explicit_recipients_added'=>$added,'jobs_requeued'=>$requeued]);
}finally{$pdo->query("SELECT RELEASE_LOCK('eoffice:orders')");}
""")
    return result

def resume(ftp):
    state=json.loads(STATE.read_text());expected=state['resume_fingerprint'];enable=state['pause']['was_enabled']
    return orders.invoke(ftp,"""
require __DIR__.'/config/order-emails.php';$pdo=app_pdo();$pdo->beginTransaction();$row=$pdo->query('SELECT * FROM eoffice_order_settings WHERE id=1 FOR UPDATE')->fetch();$compare=$row;unset($compare['worker_at']);
if(!hash_equals(__EXPECTED__,hash('sha256',json_encode($compare)))){$pdo->rollBack();throw new RuntimeException('Admin settings changed: queue stays under Admin control');}
if(__ENABLE__){$pdo->exec('UPDATE eoffice_order_settings SET enabled=1,revision=revision+1,updated_at=NOW() WHERE id=1');app_order_audit('review_patch_resumed');}
$pdo->commit();echo json_encode(['enabled'=>(bool)app_order_settings()['enabled'],'activated_at'=>app_order_settings()['activated_at']]);
""".replace('__EXPECTED__',production.hosting.php_value(expected)).replace('__ENABLE__','true' if enable else 'false'))

def verify(ftp):
    result=inspect(ftp);expected=json.loads(STATE.read_text())['release'];result['mismatches']=[row['path'] for row in result['files'] if row['sha256']!=expected[row['path']]];result['temporary_helpers']=[name for name,facts in ftp.mlsd() if name.startswith('.release-')]
    return result

def sync_year_overrides(ftp):
    state=json.loads(STATE.read_text());changed=[]
    for name in ['api/view_file.php','config/drive-archive.php']:
        remote=production.hosting.retrieve(ftp,name)
        if digest(remote)!=state['release'][name]:
            if digest(remote)!=REVIEWED.get(name):raise RuntimeError('Year source changed since the inspected release: '+name)
            backup=TEMP/('eoffice-year-normalization-extra-'+time.strftime('%Y%m%d-%H%M%S')+'-'+Path(name).name+'.tar.gz')
            with tarfile.open(backup,'w:gz') as archive:
                entry=tarfile.TarInfo(name);entry.size=len(remote);archive.addfile(entry,io.BytesIO(remote))
            state.setdefault('additional_backups',[]).append({'path':str(backup),'sha256':digest(backup.read_bytes())})
        data=release_bytes(name,remote)
        if data==remote:
            state['release'][name]=digest(remote);STATE.write_text(json.dumps(state,indent=2),encoding='utf-8');continue
        temporary=name+'.upload-'+orders.secrets.token_hex(6);ftp.storbinary('STOR '+temporary,io.BytesIO(data));ftp.rename(temporary,name)
        if production.hosting.retrieve(ftp,name)!=data:raise RuntimeError('Year override checksum mismatch')
        state['release'][name]=digest(data);Path(state['overrides'][name]).write_bytes(data);changed.append(name);STATE.write_text(json.dumps(state,indent=2),encoding='utf-8')
    manifest=json.loads(production.hosting.retrieve(ftp,'config/production-manifest.json'));manifest['files'].update(state['release']);orders.save_manifest(manifest)
    (TEMP/'eoffice-production-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8');STATE.write_text(json.dumps(state,indent=2),encoding='utf-8')
    return {'year_overrides_updated':changed}

def smoke_review2(ftp):
    account=json.loads((TEMP/'eoffice-production-smoke.private.json').read_text())
    return orders.invoke(ftp,"""
require __DIR__.'/config/order-emails.php';$pdo=app_pdo();
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock']||app_order_settings()['enabled'])throw new RuntimeException('Paused production required');
$user=__USER__;$q=$pdo->prepare('SELECT User_Email FROM t_user WHERE User_Id=?');$q->execute([$user]);if($q->fetchColumn()!==__EMAIL__)throw new RuntimeException('Unexpected test user');
$q=$pdo->prepare("SELECT d.* FROM t_document d JOIN eoffice_order_jobs j ON j.doc_id=d.Doc_Id WHERE d.User_Id=? AND d.Doc_Number LIKE 'REVIEW2-%' AND d.Doc_Type='External'");$q->execute([$user]);$doc=$q->fetch();if(!$doc)throw new RuntimeException('Expected synthetic review order');
$job=app_order_job((int)$doc['Doc_Id']);$pdo->beginTransaction();$q=$pdo->prepare('SELECT * FROM t_document WHERE Doc_Id=? FOR UPDATE');$q->execute([$doc['Doc_Id']]);
$pdo->prepare("UPDATE eoffice_order_recipients SET status='sending' WHERE job_id=? AND user_id=? AND status='pending'")->execute([$job['id'],$user]);
$q=$pdo->prepare('SELECT id FROM eoffice_order_recipients WHERE job_id=? AND user_id=?');$q->execute([$job['id'],$user]);$recipientId=(int)$q->fetchColumn();
$pdo->prepare('DELETE FROM t_access_rights WHERE Doc_Id=? AND User_Id=?')->execute([$doc['Doc_Id'],$user]);app_order_saved((int)$doc['Doc_Id'],false,'External',app_order_settings());
$ready=app_order_recipient_ready($doc,$recipientId,'sending');$pdo->commit();app_order_finish($job);
$q=$pdo->prepare('SELECT status,error_code FROM eoffice_order_recipients WHERE id=?');$q->execute([$recipientId]);$recipient=$q->fetch();
echo json_encode(['smtp_called'=>false,'revoked_recipient_ready'=>$ready!==null,'recipient'=>$recipient,'job'=>app_order_job((int)$doc['Doc_Id'])['status'],'job_error'=>app_order_job((int)$doc['Doc_Id'])['error_code']]);
""".replace('__USER__',str(int(account['user_id']))).replace('__EMAIL__',production.hosting.php_value(account['email'])))

def smoke_review3(ftp,mode):
    account=json.loads((TEMP/'eoffice-production-smoke.private.json').read_text());extra='order-review-extra-'+account['nonce']+'@example.invalid'
    result=orders.invoke(ftp,"""
require __DIR__.'/config/order-emails.php';$pdo=app_pdo();
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock']||app_order_settings()['enabled'])throw new RuntimeException('Paused production required');
$user=__USER__;$q=$pdo->prepare('SELECT User_Email FROM t_user WHERE User_Id=?');$q->execute([$user]);if($q->fetchColumn()!==__EMAIL__)throw new RuntimeException('Unexpected test user');
$q=$pdo->prepare("SELECT * FROM t_document WHERE User_Id=? AND Doc_Number LIKE 'REVIEW3-%' AND Doc_Type='External'");$q->execute([$user]);$doc=$q->fetch();if(!$doc)throw new RuntimeException('Expected synthetic review order');$job=app_order_job((int)$doc['Doc_Id']);
$mode=__MODE__;
if($mode==='prepare'){
$q=$pdo->prepare('SELECT Doc_Upload_Path FROM t_document_upload WHERE Doc_File_Link=? LIMIT 1');$q->execute([$doc['Doc_File_Link']]);$name=$q->fetchColumn();
if(!$name){$name=bin2hex(random_bytes(16)).'.pdf';$path=app_storage('original','2569',$name);$pdf=base64_decode(__PDF__,true);if(file_put_contents($path,$pdf)!==strlen($pdf))throw new RuntimeException('Synthetic file failed');
$pdo->prepare('INSERT INTO t_document_upload (Doc_Upload_Detail,Doc_Upload_Path,Doc_File_Link,User_Id) VALUES (?,?,?,?)')->execute(['Synthetic legacy-year PDF',$name,$doc['Doc_File_Link'],$user]);}
$pdo->prepare('UPDATE t_document SET Doc_Year=? WHERE Doc_Id=?')->execute(['2569 ',$doc['Doc_Id']]);$snapshot=app_order_snapshot($job);
$extra=__EXTRA__;$q=$pdo->prepare('SELECT User_Id FROM t_user WHERE User_Email=?');$q->execute([$extra]);$extraId=$q->fetchColumn();
if(!$extraId){$pdo->prepare("INSERT INTO t_user (User_Name,User_Email,User_Password,User_Status,User_Token) VALUES (?,?,?,'User',?)")->execute(['Synthetic order review recipient',$extra,password_hash(bin2hex(random_bytes(32)),PASSWORD_DEFAULT),bin2hex(random_bytes(32))]);$extraId=(int)$pdo->lastInsertId();}
echo json_encode(['file_name'=>$name,'snapshot_files'=>count($snapshot['files']),'extra_email'=>$extra]);
}elseif($mode==='no-pending'){
app_order_finish($job);$current=app_order_job((int)$doc['Doc_Id']);echo json_encode(['status'=>$current['status'],'error'=>$current['error_code']]);
}elseif($mode==='retry'){
app_order_retry_io($job,'drive_temporary_failure');$current=app_order_job((int)$doc['Doc_Id']);echo json_encode(['status'=>$current['status'],'attempts'=>(int)$current['retry_attempts'],'scheduled'=>$current['retry_at']!==null]);
}else throw new RuntimeException('Unknown smoke mode');
""".replace('__USER__',str(int(account['user_id']))).replace('__EMAIL__',production.hosting.php_value(account['email'])).replace('__MODE__',production.hosting.php_value(mode)).replace('__EXTRA__',production.hosting.php_value(extra)).replace('__PDF__',production.hosting.php_value(account['pdf'])))
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['inspect','prepare','pause','deploy','repair','resume','verify','sync_year_overrides','smoke_review2','smoke_review3']);parser.add_argument('--mode',choices=['prepare','no-pending','retry']);parser.add_argument('--files',nargs='+',choices=FILES);parser.add_argument('--reviewed-sha',action='append',default=[]);args=parser.parse_args();account,_=production.credentials()
    for entry in args.reviewed_sha:
        name,sha=entry.split('=',1)
        if name not in FILES or len(sha)!=64 or any(c not in '0123456789abcdef' for c in sha):raise RuntimeError('Invalid reviewed source hash')
        REVIEWED[name]=sha
    if args.files:FILES[:]=args.files
    with production.hosting.connect(account,'ftp.siya.ac.th') as ftp:
        production.hosting.webroot(ftp);result=smoke_review3(ftp,args.mode) if args.action=='smoke_review3' else globals()[args.action](ftp)
        (TEMP/('eoffice-order-review-'+args.action+'.private.json')).write_text(json.dumps(result),encoding='utf-8');print(json.dumps(result,indent=2))

if __name__=='__main__':main()
