"""Bounded live archive activation/checks; never prints keys or staff data."""
import argparse,hashlib,importlib.util,json,secrets,urllib.error,subprocess,io,tarfile,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('production',Path(__file__).with_name('production-hosting.py'))
production=importlib.util.module_from_spec(spec);spec.loader.exec_module(production)
REPORT=production.hosting.ROOT/'backups'/'drive-activation.private.json'
def invoke(ftp,body):
    key=secrets.token_hex(32)
    source=production.php(key)+"ini_set('zend.exception_ignore_args','1');set_time_limit(300);try{\n"+body+"\n}catch(Throwable $e){echo json_encode(['operation_error'=>get_class($e),'location'=>basename($e->getFile()).':'.$e->getLine(),'sql_state'=>$e instanceof PDOException?$e->getCode():null,'driver_code'=>$e instanceof PDOException?($e->errorInfo[1]??null):null]);}"
    result=production.invoke(ftp,source,key)
    if 'operation_error' in result:raise RuntimeError(json.dumps(result))
    return result
def check(ftp):
    data=invoke(ftp,"""
require __DIR__.'/config/drive-archive.php';$health=app_drive_archive_call(['action'=>'health']);
$directory=app_drive_archive_directory('spool');$file=$directory.'/live-check-'.bin2hex(random_bytes(16)).'.ebak';
$plain="E-Office synthetic encrypted Drive smoke\\n".random_bytes(1100000);$key=app_drive_archive_key();$objects=[];$verified=0;
try{
 for($offset=0;$offset<strlen($plain);$offset+=1048576){
  $slice=substr($plain,$offset,1048576);$writer=new AppBackupWriter($file,$key,'synthetic-live-check');$writer->write($slice);$writer->finish();unset($writer);
 $bytes=file_get_contents($file);$object=app_drive_archive_put($bytes);$objects[]=$object;
 try{$read=app_drive_archive_get($object);}catch(Throwable $e){echo json_encode(['operation_error'=>get_class($e),'location'=>basename($e->getFile()).':'.$e->getLine(),'phase'=>'encrypted_get']);return;}
  if($read!==$bytes||str_starts_with($read,'E-Office synthetic'))throw new RuntimeException('Encrypted cloud round-trip mismatch');
  unlink($file);file_put_contents($file,$read);$restored='';$result=app_backup_verify($file,$key,static function($part)use(&$restored){$restored.=$part;});
  if($restored!==$slice||$result['bytes']!==strlen($slice))throw new RuntimeException('Authenticated cloud recovery mismatch');$verified+=strlen($slice);unlink($file);
 }
 echo json_encode(['bridge_health'=>$health,'encrypted_parts_verified'=>count($objects),'plaintext_bytes_verified'=>$verified,'objects'=>$objects,'plaintext_removed'=>true,'site_enabled'=>app_drive_archive_enabled(),'eviction_enabled'=>filter_var(app_env('EOFFICE_DRIVE_EVICT_ENABLED','false'),FILTER_VALIDATE_BOOLEAN)]);
}finally{unset($writer);if(is_file($file))unlink($file);}
""")
    REPORT.write_text(json.dumps(data,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in data.items() if k!='objects'}))
def enable(ftp):
    if not REPORT.exists():raise RuntimeError('Real encrypted recovery check required first')
    before=json.loads(REPORT.read_text(encoding='utf-8'))
    if before.get('encrypted_parts_verified',0)<2:raise RuntimeError('Complete synthetic recovery check required')
    data=invoke(ftp,"""
require __DIR__.'/config/drive-archive.php';app_drive_archive_call(['action'=>'health']);
$path=__DIR__.'/config/local.php';$before=file_get_contents($path);$settings=require $path;
if(!is_array($settings)||app_settings()['database']!=='siyaacth_eoffice'||filter_var($settings['EOFFICE_DRIVE_EVICT_ENABLED']??'false',FILTER_VALIDATE_BOOLEAN))throw new RuntimeException('Unexpected archive config');
$settings['EOFFICE_DRIVE_ARCHIVE_ENABLED']='true';$settings['EOFFICE_DRIVE_EVICT_ENABLED']='false';$settings['EOFFICE_DRIVE_EVICT_GRACE_DAYS']='14';
$temporary=$path.'.archive-'.bin2hex(random_bytes(8));$code="<?php\\nreturn ".var_export($settings,true).";\\n";umask(0077);
try{if(file_put_contents($temporary,$code)!==strlen($code)||!chmod($temporary,0600))throw new RuntimeException('Config write failed');if(file_get_contents($path)!==$before)throw new RuntimeException('Concurrent config change');if(!rename($temporary,$path))throw new RuntimeException('Config publication failed');if(function_exists('opcache_invalidate'))opcache_invalidate($path,true);}finally{if(is_file($temporary))unlink($temporary);}
echo json_encode(['enabled'=>true,'eviction_enabled'=>false,'grace_days'=>14]);
""")
    print(json.dumps(data))
def status(ftp):
    data=invoke(ftp,"""
require __DIR__.'/config/drive-archive.php';$pdo=app_pdo();
$counts=$pdo->query('SELECT status,COUNT(*) versions,COALESCE(SUM(bytes),0) bytes,COALESCE(SUM(JSON_LENGTH(parts)),0) uploaded_parts FROM eoffice_drive_versions GROUP BY status')->fetchAll();
$totals=$pdo->query("SELECT COUNT(DISTINCT d.Doc_Id) docs,COUNT(u.Doc_Upload_Id) attachments FROM t_document d LEFT JOIN t_document_upload u ON u.Doc_File_Link=d.Doc_File_Link WHERE d.Is_Delete='active'")->fetch();
echo json_encode(['enabled'=>app_drive_archive_enabled(),'configured'=>app_drive_archive_configured(),'eviction_enabled'=>filter_var(app_env('EOFFICE_DRIVE_EVICT_ENABLED','false'),FILTER_VALIDATE_BOOLEAN),'state'=>$pdo->query('SELECT * FROM eoffice_drive_state WHERE id=1')->fetch(),'counts'=>$counts,'live_totals'=>$totals,'backups'=>$pdo->query('SELECT backup_date,status,completed_at,error_code FROM eoffice_drive_backups ORDER BY backup_date DESC LIMIT 3')->fetchAll()]);
""")
    production.hosting.ROOT.joinpath('backups/drive-live-status.private.json').write_text(json.dumps(data,indent=2),encoding='utf-8');print(json.dumps(data))
def worker(ftp,seconds):
    print(json.dumps(invoke(ftp,"require __DIR__.'/config/drive-archive-worker.php';echo json_encode(app_drive_archive_worker("+str(max(1,min(240,seconds)))+"));")))
def inventory(ftp):
    data=invoke(ftp,"""
require __DIR__.'/config/drive-archive.php';$pdo=app_pdo();$years=[];
$files=$pdo->query("SELECT d.Doc_Id,d.Doc_Year,u.Doc_Upload_Path FROM t_document d JOIN t_document_upload u ON u.Doc_File_Link=d.Doc_File_Link WHERE d.Is_Delete='active'")->fetchAll();
foreach($files as $file){$year=(string)$file['Doc_Year'];if(!isset($years[$year]))$years[$year]=['attachments'=>0,'original_local'=>0,'original_missing'=>0,'signed_local'=>0,'local_bytes'=>0,'invalid_identity'=>0];$years[$year]['attachments']++;
 try{foreach(['original','signed'] as $variant){$path=app_drive_archive_local($file,$file['Doc_Upload_Path'],$variant);if(is_file($path)){$years[$year][$variant.'_local']++;$years[$year]['local_bytes']+=filesize($path);}elseif($variant==='original')$years[$year]['original_missing']++;}}catch(Throwable $e){$years[$year]['invalid_identity']++;}
}ksort($years);echo json_encode(['years'=>$years]);
""")
    production.hosting.ROOT.joinpath('backups/drive-inventory.private.json').write_text(json.dumps(data,indent=2),encoding='utf-8');print(json.dumps(data))
def legacy_probe(ftp):
    print(json.dumps(invoke(ftp,"""
require __DIR__.'/config/drive-archive.php';$q=app_pdo()->query("SELECT d.Doc_Id,d.Doc_Year,u.Doc_Upload_Path FROM t_document d JOIN t_document_upload u ON u.Doc_File_Link=d.Doc_File_Link WHERE d.Is_Delete='active' AND d.Doc_Year IN ('2567','2568') ORDER BY d.Doc_Id,u.Doc_Upload_Id LIMIT 4");$results=[];
foreach($q->fetchAll() as $file){$path=app_storage('original',(string)$file['Doc_Year'],$file['Doc_Upload_Path']);if(is_file($path))continue;
 $ch=curl_init('https://eoffice.siya.ac.th/file_request.php?File_Path='.rawurlencode($file['Doc_Year'].'/'.$file['Doc_Upload_Path']).'&Type=');curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>20,CURLOPT_SSL_VERIFYPEER=>true]);$bytes=curl_exec($ch);$results[]=['year'=>$file['Doc_Year'],'http'=>(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE),'curl_errno'=>curl_errno($ch),'bytes'=>is_string($bytes)?strlen($bytes):0,'mime'=>is_string($bytes)?(new finfo(FILEINFO_MIME_TYPE))->buffer($bytes):null];curl_close($ch);
}echo json_encode($results);
""")))
def cron_status(ftp):
    print(json.dumps(invoke(ftp,"""
require __DIR__.'/config/bootstrap.php';$pdo=app_pdo();$order=$pdo->query('SELECT worker_at FROM eoffice_order_settings WHERE id=1')->fetchColumn();
$path=dirname(app_settings()['storage']).'/order-emails.log';$lines=[];
if(is_file($path)){$handle=fopen($path,'rb');fseek($handle,max(0,filesize($path)-8192));$text=stream_get_contents($handle);fclose($handle);foreach(explode("\\n",$text) as $line)if(str_contains($line,'drive_worker')||str_contains($line,'drive_daily')||preg_match('/^\\d+ order jobs processed$/',$line))$lines[]=trim($line);}
echo json_encode(['server_time'=>date('c'),'order_worker_at'=>$order,'database_wait_timeout'=>(int)$pdo->query('SELECT @@SESSION.wait_timeout')->fetchColumn(),'private_log_exists'=>is_file($path),'recent_scheduler_entries'=>array_slice($lines,-10),'drive_state'=>$pdo->query('SELECT * FROM eoffice_drive_state WHERE id=1')->fetch()]);
""")))
def daily_database_check(ftp):
    folder=production.hosting.ROOT/'backups';report=folder/'drive-database-check.private.json'
    if report.exists():data=json.loads(report.read_text(encoding='utf-8'))
    else:data=invoke(ftp,"""
require __DIR__.'/config/database-backup.php';require __DIR__.'/config/drive-archive.php';$backup=app_database_backup();if(!($backup['created']??false))throw new RuntimeException('Database snapshot was not created');
$objects=[];$handle=fopen($backup['path'],'rb');try{while(!feof($handle)){$bytes=fread($handle,1048576);if($bytes==='')continue;$object=app_drive_archive_put($bytes);if(app_drive_archive_get($object)!==$bytes)throw new RuntimeException('Database cloud checksum mismatch');$objects[]=$object;}}finally{fclose($handle);}
$result=$backup;unset($result['path']);echo json_encode(['database'=>$result,'objects'=>$objects,'full_document_backup_completed'=>false]);
""")
    report.write_text(json.dumps(data,indent=2),encoding='utf-8')
    # Reconstruct only encrypted data on the workstation; real SQL recovery is
    # performed by the existing isolated database drill afterwards.
    target=folder/data['database']['filename'];temporary=Path(str(target)+'.partial')
    if temporary.exists():temporary.unlink()
    with open(temporary,'xb') as output:
        for object_id in data['objects']:
            filename='cloud-check-'+secrets.token_hex(16)+'.ebak'
            body="require __DIR__.'/config/drive-archive.php';$bytes=app_drive_archive_get("+production.hosting.php_value(object_id)+");$path=app_drive_archive_directory('spool').'/"+filename+"';if(file_put_contents($path,$bytes)!==strlen($bytes))throw new RuntimeException('Cloud download staging failed');chmod($path,0600);echo json_encode(['bytes'=>strlen($bytes)]);"
            invoke(ftp,body)
            remote='/private/drive-archive/spool/'+filename
            try:bytes=production.hosting.retrieve(ftp,remote)
            finally:ftp.delete(remote)
            if hashlib.sha256(bytes).hexdigest()!=object_id:raise RuntimeError('Encrypted download checksum mismatch')
            output.write(bytes)
    if hashlib.sha256(temporary.read_bytes()).hexdigest()!=data['database']['archive_sha256']:raise RuntimeError('Cloud database archive checksum mismatch')
    if target.exists():
        if hashlib.sha256(target.read_bytes()).hexdigest()!=data['database']['archive_sha256']:raise RuntimeError('Existing recovery target differs')
        temporary.unlink()
    else:temporary.replace(target)
    metadata={**data['database'],'path':str(target),'key_vault':str(folder/'keys/eoffice-operations-keys.private.json'),'verified':True}
    folder.joinpath(target.name+'.metadata.private.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
    print(json.dumps({'cloud_database_uploaded_and_downloaded':True,'tables':metadata['tables'],'rows':metadata['rows'],'encrypted_bytes':metadata['encrypted_bytes'],'archive':str(target),'full_document_backup_completed':False}))
def deploy_runtime(ftp):
    root=production.hosting.ROOT;names=['config/drive-archive-client.php','config/drive-archive.php','config/drive-archive-worker.php','scripts/scheduled-jobs.php','scripts/order-cron.sh','scripts/restore-drive.php','assets/drive-archive-status.js']
    payload={name:subprocess.check_output(['git','show','HEAD:'+name],cwd=root) for name in names}
    archive=production.TEMP/('eoffice-drive-activation-before-'+time.strftime('%Y%m%d-%H%M%S')+'.tar.gz')
    with tarfile.open(archive,'w:gz') as out:
        for name in names:
            try:body=production.hosting.retrieve(ftp,name)
            except Exception:continue
            entry=tarfile.TarInfo(name);entry.size=len(body);out.addfile(entry,io.BytesIO(body))
    for name,body in payload.items():
        temporary=name+'.upload-'+secrets.token_hex(6);ftp.storbinary('STOR '+temporary,io.BytesIO(body));ftp.rename(temporary,name)
        if hashlib.sha256(production.hosting.retrieve(ftp,name)).digest()!=hashlib.sha256(body).digest():raise RuntimeError('Runtime checksum mismatch')
    print(json.dumps({'runtime_files_verified':len(names),'rollback_archive':str(archive),'rollback_sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}))
def probe(ftp):
    print(json.dumps(invoke(ftp,"""
require __DIR__.'/config/drive-archive.php';$result=[];
foreach([32,65536,1048576] as $size){
 $file=app_drive_archive_directory('spool').'/probe-'.bin2hex(random_bytes(8)).'.ebak';$writer=new AppBackupWriter($file,app_drive_archive_key(),'synthetic-probe');$writer->write(random_bytes($size));$writer->finish();unset($writer);$cipher=file_get_contents($file);unlink($file);
 $payload=['action'=>'put','object'=>hash('sha256',$cipher),'data'=>base64_encode($cipher)];$encoded=base64_encode(json_encode($payload));$timestamp=time();$nonce=bin2hex(random_bytes(16));$request=json_encode(['route'=>'eoffice-archive-v1','timestamp'=>$timestamp,'nonce'=>$nonce,'payload'=>$encoded,'signature'=>hash_hmac('sha256',$timestamp."\\n".$nonce."\\n".$encoded,app_env('EOFFICE_DRIVE_ARCHIVE_SECRET'))]);
 $location='';$ch=curl_init(app_env('EOFFICE_DRIVE_ARCHIVE_URL'));curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$request,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>90,CURLOPT_HTTPHEADER=>['Content-Type: application/json'],CURLOPT_HEADERFUNCTION=>static function($ch,$line)use(&$location){if(str_starts_with(strtolower($line),'location:'))$location=trim(substr($line,9));return strlen($line);}]);$body=curl_exec($ch);$entry=['plaintext_bytes'=>$size,'request_bytes'=>strlen($request),'http'=>(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE),'redirect_host'=>parse_url($location,PHP_URL_HOST),'curl_errno'=>curl_errno($ch),'response_bytes'=>is_string($body)?strlen($body):0];curl_close($ch);
 if(parse_url($location,PHP_URL_HOST)==='script.googleusercontent.com'){
  $next='';$ch=curl_init($location);curl_setopt_array($ch,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>90,CURLOPT_HTTPHEADER=>['Content-Type: application/json'],CURLOPT_HEADERFUNCTION=>static function($ch,$line)use(&$next){if(str_starts_with(strtolower($line),'location:'))$next=trim(substr($line,9));return strlen($line);}]);$body=curl_exec($ch);$decoded=json_decode($body?:'',true);$entry['get_http']=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);$entry['get_redirect_host']=parse_url($next,PHP_URL_HOST);$entry['json_status']=$decoded['status']??null;$entry['json_error_code']=$decoded['code']??null;curl_close($ch);
 }
 $payload=['action'=>'get','object'=>hash('sha256',$cipher)];$encoded=base64_encode(json_encode($payload));$timestamp=time();$nonce=bin2hex(random_bytes(16));$request=json_encode(['route'=>'eoffice-archive-v1','timestamp'=>$timestamp,'nonce'=>$nonce,'payload'=>$encoded,'signature'=>hash_hmac('sha256',$timestamp."\\n".$nonce."\\n".$encoded,app_env('EOFFICE_DRIVE_ARCHIVE_SECRET'))]);
 $location='';$ch=curl_init(app_env('EOFFICE_DRIVE_ARCHIVE_URL'));curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$request,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>90,CURLOPT_HTTPHEADER=>['Content-Type: application/json'],CURLOPT_HEADERFUNCTION=>static function($ch,$line)use(&$location){if(str_starts_with(strtolower($line),'location:'))$location=trim(substr($line,9));return strlen($line);}]);$body=curl_exec($ch);$entry['read_http']=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);$entry['read_redirect_host']=parse_url($location,PHP_URL_HOST);curl_close($ch);
 if(parse_url($location,PHP_URL_HOST)==='script.googleusercontent.com'){
  $next='';$ch=curl_init($location);curl_setopt_array($ch,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>90,CURLOPT_HTTPHEADER=>['Content-Type: application/json'],CURLOPT_HEADERFUNCTION=>static function($ch,$line)use(&$next){if(str_starts_with(strtolower($line),'location:'))$next=trim(substr($line,9));return strlen($line);}]);$body=curl_exec($ch);$entry['read_get_http']=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);$entry['read_get_redirect_host']=parse_url($next,PHP_URL_HOST);$entry['read_get_redirect_path']=parse_url($next,PHP_URL_PATH);$entry['read_response_bytes']=is_string($body)?strlen($body):0;curl_close($ch);
 }$result[]=$entry;
}echo json_encode($result);
""")))
def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['check','enable','status','worker','backup','probe','inventory','legacy-probe','cron-status','database-check','deploy-runtime']);parser.add_argument('--seconds',type=int,default=90);args=parser.parse_args()
    account,_=production.credentials()
    with production.hosting.connect(account,'ftp.siya.ac.th') as ftp:
        production.hosting.webroot(ftp)
        if args.action=='check':check(ftp)
        elif args.action=='enable':enable(ftp)
        elif args.action=='status':status(ftp)
        elif args.action=='worker':worker(ftp,args.seconds)
        elif args.action=='probe':probe(ftp)
        elif args.action=='inventory':inventory(ftp)
        elif args.action=='legacy-probe':legacy_probe(ftp)
        elif args.action=='cron-status':cron_status(ftp)
        elif args.action=='database-check':daily_database_check(ftp)
        elif args.action=='deploy-runtime':deploy_runtime(ftp)
        else:print(json.dumps(invoke(ftp,"require __DIR__.'/config/drive-archive-worker.php';echo json_encode(app_drive_archive_backup());")))
if __name__=='__main__':
    try:main()
    except Exception as error:
        detail=str(error) if isinstance(error,RuntimeError) and str(error).startswith('{"operation_error"') else ('HTTP '+str(error.code) if isinstance(error,urllib.error.HTTPError) else type(error).__name__)
        raise SystemExit('Drive live operation failed ('+detail+'); no secrets printed') from None
