"""Production deployment operations with verified FTPS and private local backups."""
import argparse
import importlib.util
import io
import json
import re
import secrets
import hashlib
import urllib.request
import gzip
import tarfile
import time
from pathlib import Path

spec=importlib.util.spec_from_file_location('hosting',Path(__file__).with_name('staging-hosting.py'))
hosting=importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosting)
TEMP=Path.home()/'AppData/Local/Temp/opencode'
URL='https://e-office.siya.ac.th'


def credentials():
    text=hosting.DEFAULT_CREDENTIALS.read_text(encoding='utf-8-sig')
    blocks=re.findall(r'(?ms)^(FTP|Database)([^\n]*)\n(.*?)(?=^(?:FTP|Database)|\Z)',text)
    accounts=[]
    for kind in ['FTP','Database']:
        body=next(body for category,title,body in blocks if category==kind and 'Production' in title)
        host=re.search(r'Host\s*:?\s*([^\s]+)',body,re.I).group(1)
        user=re.search(r'username\s*:\s*(\S+)',body).group(1)
        password=re.search(r'password\s*:\s*(\S+)',body).group(1)
        database=re.search(r'database\s*:\s*(\S+)',body)
        accounts.append(dict(host=host,port=2121 if kind=='FTP' else 3306,user=user,password=password,database=database.group(1) if database else None))
    if accounts[1]['database']!='siyaacth_eoffice':raise RuntimeError('Unexpected production database')
    return accounts


def php(key):
    digest=hashlib.sha256(key.encode()).hexdigest()
    return f"""<?php
if(!in_array($_SERVER['HTTP_HOST']??'', ['e-office.siya.ac.th','www.e-office.siya.ac.th'],true)||!hash_equals('{digest}',hash('sha256',$_SERVER['HTTP_X_EOFFICE_DEPLOY_TOKEN']??''))){{http_response_code(404);exit;}}
ini_set('display_errors','0');header('Content-Type: application/json');header('Cache-Control: no-store');
"""


def invoke(ftp,source,key):
    name='.release-'+secrets.token_hex(16)+'.php'
    ftp.storbinary('STOR '+name,io.BytesIO(source.encode()))
    try:
        request=urllib.request.Request(URL+'/'+name,data=b'',method='POST',headers={'X-Eoffice-Deploy-Token':key})
        with urllib.request.urlopen(request,timeout=360) as response:
            return json.loads(response.read())
    finally:
        try:ftp.delete(name)
        except Exception:
            account,_=credentials()
            with hosting.connect(account,'ftp.siya.ac.th') as fresh:
                hosting.webroot(fresh)
                try:fresh.delete(name)
                except Exception:pass


def inspect(ftp,database):
    key=secrets.token_hex(32)
    source=php(key)+f"""
$result=['php'=>PHP_VERSION,'document_root'=>$_SERVER['DOCUMENT_ROOT'],'extensions'=>array_intersect(['pdo_mysql','mysqli','mbstring','fileinfo','gd','curl','openssl'],get_loaded_extensions()),'memory_limit'=>ini_get('memory_limit')];
try{{
 $pdo=new PDO('mysql:host=localhost;port=3306;dbname='.{hosting.php_value(database['database'])}.';charset=utf8mb4',{hosting.php_value(database['user'])},{hosting.php_value(database['password'])},[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
 if($pdo->query('SELECT DATABASE()')->fetchColumn()!=='siyaacth_eoffice')throw new RuntimeException('Wrong database');
 $result['database']=$pdo->query('SELECT DATABASE()')->fetchColumn();$result['server']=$pdo->query('SELECT VERSION()')->fetchColumn();$result['tables']=$pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);$result['counts']=[];$result['schema']=[];
 foreach($result['tables'] as $table){{$safe='`'.str_replace('`','``',$table).'`';$result['counts'][$table]=(int)$pdo->query('SELECT COUNT(*) FROM '.$safe)->fetchColumn();$result['schema'][$table]=$pdo->query('SHOW CREATE TABLE '.$safe)->fetch(PDO::FETCH_NUM)[1];}}
 $result['duplicate_access_pairs']=(int)$pdo->query('SELECT COUNT(*) FROM (SELECT User_Id,Doc_Id FROM t_access_rights GROUP BY User_Id,Doc_Id HAVING COUNT(*)>1) a')->fetchColumn();
 $result['duplicate_external_numbers']=(int)$pdo->query('SELECT COUNT(*) FROM (SELECT Doc_Year,External_Number FROM t_external_number_booking GROUP BY Doc_Year,External_Number HAVING COUNT(*)>1) a')->fetchColumn();
 $result['storage']=[];foreach(['file_document','file_document/original','file_document/e-sign'] as $folder)$result['storage'][$folder]=is_dir(__DIR__.'/'.$folder);
}}catch(Throwable $e){{$result['database_error_code']=$e->getCode();}}
echo json_encode($result);
"""
    data=invoke(ftp,source,key)
    (TEMP/'eoffice-production-inspection.private.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    entries=[{'name':name,'type':facts.get('type'),'size':facts.get('size')} for name,facts in ftp.mlsd() if name not in ['.','..']]
    result={k:v for k,v in data.items() if k!='schema'}
    result['ftp_root']=ftp.pwd();result['entries']=entries
    # Sources downloaded privately for service config extraction and rollback planning.
    folder=TEMP/'eoffice-production-original-private'
    folder.mkdir(exist_ok=True)
    for name in ['.htaccess','config/config.php','config/local.php','index.php','api/create_document.php','api/register.php','email_send/process_pdf.php','maintenance_requests/api/drive.php']:
        try:content=hosting.retrieve(ftp,name)
        except Exception:continue
        target=folder/name;target.parent.mkdir(parents=True,exist_ok=True)
        if not target.exists():target.write_bytes(content)
    print(json.dumps(result,ensure_ascii=True,indent=2))


def storage_inspect(ftp,database):
    key=secrets.token_hex(32)
    source=php(key)+"""
$root=__DIR__.'/file_document';$stats=['files'=>0,'bytes'=>0,'folders'=>[]];
if(is_dir($root))foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS)) as $f){if($f->isFile()){$stats['files']++;$stats['bytes']+=$f->getSize();}}
foreach(['original','e-sign'] as $folder){$stats['folders'][$folder]=[];if(is_dir($root.'/'.$folder))foreach(new DirectoryIterator($root.'/'.$folder) as $d)if($d->isDir()&&!$d->isDot())$stats['folders'][$folder][]=$d->getFilename();}
$stats['disabled_functions']=ini_get('disable_functions');$stats['archive_supported']=class_exists('PharData');echo json_encode($stats);
"""
    print(json.dumps(invoke(ftp,source,key),indent=2))


def extract_settings():
    folder=TEMP/'eoffice-production-original-private'
    sources={p.as_posix():p.read_text(encoding='utf-8-sig',errors='replace') for p in folder.rglob('*.php')}
    def find(file,pattern):
        source=next((text for name,text in sources.items() if name.endswith(file)), '')
        match=re.search(pattern,source,re.M)
        return match.group(1) if match else ''
    settings={
        'SMTP_HOST':find('api/create_document.php',r"\$mail->Host\s*=\s*['\"]([^'\"]+)['\"]"),
        'SMTP_USERNAME':find('api/create_document.php',r"\$mail->Username\s*=\s*['\"]([^'\"]+)['\"]"),
        'SMTP_PASSWORD':find('api/create_document.php',r"\$mail->Password\s*=\s*['\"]([^'\"]+)['\"]"),
        'SMTP_PORT':'587',
        'ONESIGNAL_REST_API_KEY':find('api/create_document.php',r"^\s*\$restApiKey\s*=\s*['\"]([^'\"]+)['\"]"),
        'ONESIGNAL_APP_ID':find('api/create_document.php',r"^\s*\$appId\s*=\s*['\"]([^'\"]+)['\"]"),
        'DRIVE_APPS_SCRIPT_URL':find('maintenance_requests/api/drive.php',r"['\"](https://script\.google\.com/[^'\"]+)['\"]"),
        'GEMINI_API_KEY':find('email_send/process_pdf.php',r"['\"]((?:AIza|AQ\.)[A-Za-z0-9_-]{20,})['\"]"),
        'GEMINI_MODEL':find('email_send/process_pdf.php',r'/models/([A-Za-z0-9.-]+):generateContent') or 'gemini-2.5-flash',
    }
    text=next((text for name,text in sources.items() if name.endswith('email_send/process_pdf.php')),'')
    block=re.search(r'\$api_keys\s*=\s*\[([\s\S]*?)\];',text)
    if block:
        keys=re.findall(r"['\"]((?:AIza|AQ\.)[A-Za-z0-9_-]{20,})['\"]",block.group(1))
        if keys:settings['GEMINI_API_KEY']=keys[0]
    settings['SMTP_FROM']=settings['SMTP_USERNAME']
    (TEMP/'eoffice-production-service-settings.private.json').write_text(json.dumps(settings),encoding='utf-8')
    print(json.dumps({'service_settings_found':{key:bool(value) for key,value in settings.items()}}))


def database_backup(ftp,database):
    key=secrets.token_hex(32)
    source=php(key)+f"""
set_time_limit(120);
$pdo=new PDO('mysql:host=localhost;port=3306;dbname='.{hosting.php_value(database['database'])}.';charset=utf8mb4',{hosting.php_value(database['user'])},{hosting.php_value(database['password'])},[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
if($pdo->query('SELECT DATABASE()')->fetchColumn()!=='siyaacth_eoffice'){{http_response_code(403);exit;}}
$pdo->beginTransaction();$result=[];
foreach($pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $table){{$safe='`'.str_replace('`','``',$table).'`';$result[$table]=['schema'=>$pdo->query('SHOW CREATE TABLE '.$safe)->fetch(PDO::FETCH_NUM)[1],'rows'=>$pdo->query('SELECT * FROM '.$safe)->fetchAll(PDO::FETCH_ASSOC)];}}
$pdo->commit();echo json_encode($result,JSON_THROW_ON_ERROR);
"""
    result=invoke(ftp,source,key)
    path=TEMP/('eoffice-production-db-before-'+time.strftime('%Y%m%d-%H%M%S')+'.json.gz')
    with gzip.open(path,'wt',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False)
    metadata={'path':str(path),'tables':len(result),'rows':{table:len(info['rows']) for table,info in result.items()},'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    (TEMP/'eoffice-production-db-backup.private.json').write_text(json.dumps(metadata),encoding='utf-8')
    print(json.dumps(metadata),flush=True)


def application_backup(ftp):
    path=TEMP/('eoffice-production-app-before-'+time.strftime('%Y%m%d-%H%M%S')+'.tar.gz')
    count=0
    excluded={'file_document','node_modules','.git'}
    with tarfile.open(path,'w:gz') as archive:
        def walk(prefix=''):
            nonlocal count
            for name,facts in ftp.mlsd(prefix or '.'):
                if name in ['.','..'] or name in excluded or name.startswith('.release-'):continue
                remote=(prefix+'/' if prefix else '')+name
                if facts.get('type')=='dir':walk(remote)
                elif facts.get('type')=='file':
                    content=hosting.retrieve(ftp,remote);entry=tarfile.TarInfo(remote);entry.size=len(content);archive.addfile(entry,io.BytesIO(content));count+=1
        walk()
    metadata={'path':str(path),'files':count,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'document_storage':'preserved in place; excluded from application archive'}
    (TEMP/'eoffice-production-app-backup.private.json').write_text(json.dumps(metadata),encoding='utf-8')
    print(json.dumps(metadata),flush=True)


def service_check(ftp,database):
    services=json.loads((TEMP/'eoffice-production-service-settings.private.json').read_text())
    services={key:value for key,value in services.items() if not key.startswith('BOARDCAST_')}
    key=secrets.token_hex(32)
    source=php(key)+f"""
require __DIR__.'/src/Exception.php';require __DIR__.'/src/PHPMailer.php';require __DIR__.'/src/SMTP.php';
$settings={hosting.php_value(services)};$results=[];
try{{$mail=new PHPMailer\\PHPMailer\\PHPMailer(true);$mail->isSMTP();$mail->Host=$settings['SMTP_HOST'];$mail->SMTPAuth=true;$mail->Username=$settings['SMTP_USERNAME'];$mail->Password=$settings['SMTP_PASSWORD'];$mail->SMTPSecure=PHPMailer\\PHPMailer\\PHPMailer::ENCRYPTION_STARTTLS;$mail->Port=587;$mail->Timeout=15;$results['smtp_auth']=$mail->smtpConnect();$mail->smtpClose();}}catch(Throwable $e){{$results['smtp_auth']=false;$results['smtp_error_class']=get_class($e);}}
function check_get($url,$headers){{$ch=curl_init($url);curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>20,CURLOPT_HTTPHEADER=>$headers]);$body=curl_exec($ch);$code=curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);return [$code,json_decode($body?:'',true)];}}
[$code,$body]=check_get('https://api.onesignal.com/apps/'.$settings['ONESIGNAL_APP_ID'],['Authorization: Key '.$settings['ONESIGNAL_REST_API_KEY']]);$results['onesignal_status']=$code;
[$code,$body]=check_get('https://generativelanguage.googleapis.com/v1beta/models',['x-goog-api-key: '.$settings['GEMINI_API_KEY']]);$results['gemini_status']=$code;$results['gemini_model_available']=false;
foreach($body['models']??[] as $model)if(($model['name']??'')==='models/'.$settings['GEMINI_MODEL'])$results['gemini_model_available']=true;
[$code,$body]=check_get($settings['DRIVE_APPS_SCRIPT_URL'],['Accept: application/json']);$results['drive_http_status']=$code;
echo json_encode($results);
"""
    results=invoke(ftp,source,key)
    (TEMP/'eoffice-production-service-check.private.json').write_text(json.dumps(results),encoding='utf-8')
    print(json.dumps(results),flush=True)


def compatibility(ftp,database):
    key=secrets.token_hex(32)
    source=php(key)+f"""
$pdo=new PDO('mysql:host=localhost;dbname='.{hosting.php_value(database['database'])}.';charset=utf8mb4',{hosting.php_value(database['user'])},{hosting.php_value(database['password'])},[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$result=['date_samples'=>$pdo->query('SELECT DISTINCT Doc_Date_Receive FROM t_document ORDER BY Doc_Id DESC LIMIT 12')->fetchAll(PDO::FETCH_COLUMN),'admin_roles'=>$pdo->query("SELECT User_Status,COUNT(*) n FROM t_user GROUP BY User_Status")->fetchAll(PDO::FETCH_ASSOC)];
$result['file_bindings']=$pdo->query("SELECT d.Doc_Id,d.Doc_Year,u.Doc_Upload_Path FROM t_document d JOIN t_document_upload u ON u.Doc_File_Link=d.Doc_File_Link WHERE d.Is_Delete='active' ORDER BY d.Doc_Id DESC LIMIT 100")->fetchAll(PDO::FETCH_ASSOC);
$samples=[];foreach($result['file_bindings'] as $file){{$path=__DIR__.'/file_document/original/'.$file['Doc_Year'].'/'.basename($file['Doc_Upload_Path']);$samples[]=['id'=>$file['Doc_Id'],'year'=>$file['Doc_Year'],'exists'=>is_file($path)];}}
$result['local_files']=$samples;unset($result['file_bindings']);
echo json_encode($result);
"""
    print(json.dumps(invoke(ftp,source,key),ensure_ascii=True,indent=2))


def maintenance(ftp):
    rules=b'''<IfModule mod_rewrite.c>
RewriteEngine On
RewriteCond %{REQUEST_URI} !^/\\.release-[a-f0-9]{32}\\.php$
RewriteCond %{REQUEST_URI} !^/Boardcast(?:/|$)
RewriteRule ^ - [R=503,L]
</IfModule>
ErrorDocument 503 "E-Office update in progress. Please retry in 2 minutes."
<IfModule mod_headers.c>
Header always set Retry-After "120"
</IfModule>
'''
    ftp.storbinary('STOR .htaccess',io.BytesIO(rules))


def prepare(ftp,database):
    for name in ['eoffice-production-db-backup.private.json','eoffice-production-app-backup.private.json']:
        metadata=json.loads((TEMP/name).read_text())
        if hashlib.sha256(Path(metadata['path']).read_bytes()).hexdigest()!=metadata['sha256']:raise RuntimeError('Backup integrity mismatch')
    key=secrets.token_hex(32)
    version=time.strftime('%Y%m%d-%H%M%S')
    source=php(key)+f"""
set_time_limit(120);
$source=__DIR__.'/file_document';$private=dirname(__DIR__).'/private';$snapshot=$private.'/rollback-{version}/file_document';
if(!is_dir($source.'/original'))throw new RuntimeException('Storage already migrated; use targeted sync for this release');
if(!is_dir($snapshot)&&!mkdir($snapshot,0750,true))throw new RuntimeException('Snapshot directory unavailable');
$manifest=[];$bytes=0;
foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source,FilesystemIterator::SKIP_DOTS)) as $file){{
 if(!$file->isFile())continue;$relative=substr($file->getPathname(),strlen($source)+1);$target=$snapshot.'/'.$relative;
 if(!is_dir(dirname($target))&&!mkdir(dirname($target),0750,true))throw new RuntimeException('Snapshot directory unavailable');
 if(!link($file->getPathname(),$target))throw new RuntimeException('Snapshot link failed');
 $before=stat($file->getPathname());$after=stat($target);
 if($before['ino']!==$after['ino']||$before['dev']!==$after['dev']||$before['size']!==$after['size'])throw new RuntimeException('Snapshot integrity mismatch');
 $manifest[$relative]=['inode'=>$before['ino'],'device'=>$before['dev'],'bytes'=>$before['size'],'mtime'=>$before['mtime']];$bytes+=$before['size'];
}}
file_put_contents(dirname($snapshot).'/documents-manifest.json',json_encode($manifest,JSON_THROW_ON_ERROR));
echo json_encode(['snapshot'=>$snapshot,'kind'=>'hard-link snapshot; release writes replace files atomically','files'=>count($manifest),'bytes'=>$bytes,'private_storage'=>$private.'/file_document']);
"""
    result=invoke(ftp,source,key)
    (TEMP/'eoffice-production-storage-snapshot.private.json').write_text(json.dumps(result),encoding='utf-8')
    print(json.dumps(result),flush=True)


def recover_original_sources():
    metadata=json.loads((TEMP/'eoffice-production-app-backup.private.json').read_text())
    with tarfile.open(metadata['path'],'r:gz') as archive:
        for name in ['.htaccess','config/config.php','index.php','api/create_document.php','api/register.php','email_send/process_pdf.php','maintenance_requests/api/drive.php']:
            source=archive.extractfile(name)
            if source:
                target=TEMP/'eoffice-production-original-private'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(source.read())
    print(json.dumps({'rollback_sources_recovered_from_verified_archive':True}))


def create_smoke(ftp):
    key=secrets.token_hex(32);nonce=secrets.token_hex(8);password=secrets.token_urlsafe(32);email='release-smoke-'+nonce+'@example.invalid'
    source=php(key)+f"""
require __DIR__.'/config/bootstrap.php';if(app_settings()['database']!=='siyaacth_eoffice'){{http_response_code(403);exit;}}
$pdo=app_pdo();$pdo->prepare("INSERT INTO t_user (User_Name,User_Email,User_Password,User_Status,User_Token) VALUES (?,?,?,'Admin',?)")->execute(['Deployment smoke test',{hosting.php_value(email)},password_hash({hosting.php_value(password)},PASSWORD_DEFAULT),bin2hex(random_bytes(32))]);
echo json_encode(['user_id'=>(int)$pdo->lastInsertId()]);
"""
    user=invoke(ftp,source,key)
    seed_source=(hosting.ROOT/'tests/seed.php').read_text(encoding='utf-8')
    # Generate the same public, non-sensitive vector fixture locally (no DB access).
    php_fixture=seed_source[seed_source.index("$objects="):seed_source.index("$image=")]+"echo base64_encode($pdf);"
    import subprocess
    fixture=subprocess.run(['C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe'],input='<?php '+php_fixture,text=True,capture_output=True,check=True).stdout
    state={'url':URL,'email':email,'password':password,'user_id':user['user_id'],'nonce':nonce,'pdf':fixture}
    (TEMP/'eoffice-production-smoke.private.json').write_text(json.dumps(state),encoding='utf-8')
    print(json.dumps({'temporary_smoke_account_created':True,'user_id':user['user_id']}))


def cleanup_smoke(ftp):
    state=json.loads((TEMP/'eoffice-production-smoke.private.json').read_text())
    key=secrets.token_hex(32)
    source=php(key)+f"""
require __DIR__.'/config/bootstrap.php';if(app_settings()['database']!=='siyaacth_eoffice'){{http_response_code(403);exit;}}
$pdo=app_pdo();$id={int(state['user_id'])};$q=$pdo->prepare('SELECT User_Email FROM t_user WHERE User_Id=?');$q->execute([$id]);if($q->fetchColumn()!=={hosting.php_value(state['email'])}){{http_response_code(403);exit;}}
$q=$pdo->prepare('SELECT * FROM t_document WHERE User_Id=?');$q->execute([$id]);$docs=$q->fetchAll();$files=[];
foreach($docs as $doc){{$q=$pdo->prepare('SELECT * FROM t_document_upload WHERE Doc_File_Link=?');$q->execute([$doc['Doc_File_Link']]);foreach($q as $f){{$files[]=app_storage('original',$doc['Doc_Year'],basename($f['Doc_Upload_Path']));$files[]=app_storage('e-sign',$doc['Doc_Year'],'signed_'.$doc['Doc_Id'].'_'.basename($f['Doc_Upload_Path']));}}}}
$pdo->beginTransaction();foreach($docs as $doc){{$pdo->prepare('DELETE FROM t_document_upload WHERE Doc_File_Link=? AND User_Id=?')->execute([$doc['Doc_File_Link'],$id]);$pdo->prepare('DELETE FROM t_document WHERE Doc_Id=? AND User_Id=?')->execute([$doc['Doc_Id'],$id]);}}
$pdo->prepare('DELETE FROM t_user WHERE User_Id=?')->execute([$id]);$pdo->commit();foreach($files as $file)if(is_file($file))unlink($file);
echo json_encode(['temporary_user_removed'=>true,'temporary_documents_removed'=>count($docs),'original_users'=>(int)$pdo->query('SELECT COUNT(*) FROM t_user')->fetchColumn(),'original_documents'=>(int)$pdo->query('SELECT COUNT(*) FROM t_document')->fetchColumn()]);
"""
    print(json.dumps(invoke(ftp,source,key)),flush=True)
    (TEMP/'eoffice-production-smoke.private.json').unlink()


def verify_storage(ftp):
    snapshot=json.loads((TEMP/'eoffice-production-storage-snapshot.private.json').read_text());key=secrets.token_hex(32)
    source=php(key)+f"""
require __DIR__.'/config/bootstrap.php';$manifest=json_decode(file_get_contents({hosting.php_value(str(Path(snapshot['snapshot']).parent).replace('\\','/')+'/documents-manifest.json')}),true);$checked=0;$missing=0;$changed=0;
foreach($manifest as $name=>$info){{$file=app_settings()['storage'].'/'.$name;if(!is_file($file)){{$missing++;continue;}}$stats=stat($file);if($stats['ino']!==$info['inode']||$stats['dev']!==$info['device']||$stats['size']!==$info['bytes'])$changed++;$checked++;}}
echo json_encode(['original_files_checked'=>$checked,'missing'=>$missing,'changed'=>$changed,'temporary_helpers_remaining'=>count(glob(__DIR__.'/.release-*.php'))-1]);
"""
    result=invoke(ftp,source,key);print(json.dumps(result))
    if result['missing'] or result['changed']:raise RuntimeError('Original document storage changed')


def final_check(ftp):
    key=secrets.token_hex(32)
    source=php(key)+"""
require __DIR__.'/config/services.php';
$pdo=app_pdo();$counts=[];foreach(['t_user','t_document','t_document_upload','t_access_rights','room_bookings','maintenance_requests','email_logs','t_target_id'] as $table)$counts[$table]=(int)$pdo->query('SELECT COUNT(*) FROM '.$table)->fetchColumn();
$q=$pdo->query("SELECT d.Doc_Id,d.Doc_Year,f.Doc_Upload_Path FROM t_document d JOIN t_document_upload f ON f.Doc_File_Link=d.Doc_File_Link WHERE d.Doc_Year='2568' AND d.Doc_Type='External' AND d.Is_Delete='active' ORDER BY d.Doc_Id DESC LIMIT 100");
$historical=[];foreach($q as $f){$path=app_storage('original',$f['Doc_Year'],basename($f['Doc_Upload_Path']));if(is_file($path)){$historical[]=['id'=>$f['Doc_Id'],'exists'=>true,'year'=>$f['Doc_Year']];if(count($historical)>=3)break;}}
$ch=curl_init(app_env('DRIVE_APPS_SCRIPT_URL'));curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>true,CURLOPT_TIMEOUT=>20]);$body=curl_exec($ch);$drive=curl_getinfo($ch,CURLINFO_RESPONSE_CODE);$url=curl_getinfo($ch,CURLINFO_EFFECTIVE_URL);curl_close($ch);
$pending=(int)$pdo->query("SELECT COUNT(*) FROM eoffice_outbox WHERE status='pending'")->fetchColumn();
echo json_encode(['original_counts'=>$counts,'historical_local_documents'=>$historical,'drive_final_status'=>$drive,'drive_response_is_json'=>is_array(json_decode($body?:'',true)),'drive_final_host'=>parse_url($url,PHP_URL_HOST),'mock_services'=>app_settings()['mock'],'outbox_pending'=>$pending,'temporary_helpers_remaining'=>count(glob(__DIR__.'/.release-*.php'))-1]);
"""
    result=invoke(ftp,source,key)
    (TEMP/'eoffice-production-final-check.private.json').write_text(json.dumps(result),encoding='utf-8')
    print(json.dumps(result),flush=True)


def verify_release(ftp):
    manifest=json.loads((TEMP/'eoffice-production-manifest.json').read_text());mismatches=[]
    for name,digest in manifest['files'].items():
        if name.startswith('Boardcast/'):raise RuntimeError('Unrelated directory in production release')
        if hashlib.sha256(hosting.retrieve(ftp,name)).hexdigest()!=digest:mismatches.append(name)
    temporary=[name for name,facts in ftp.mlsd() if name.startswith('.release-')]
    print(json.dumps({'production_files_checked':len(manifest['files']),'mismatches':mismatches,'temporary_helpers_remaining':len(temporary)}))
    if mismatches or temporary:raise RuntimeError('Production verification failed')


def sync_files(ftp,names):
    available={name:content for name,content in hosting.deployment_files() if not name.startswith('Boardcast/')}
    if set(names)-set(available):raise RuntimeError('Unknown production release paths')
    for name in names:
        temporary=name+'.upload-'+secrets.token_hex(6);ftp.storbinary('STOR '+temporary,io.BytesIO(available[name]));ftp.rename(temporary,name)
    path=TEMP/'eoffice-production-manifest.json';manifest=json.loads(path.read_text())
    manifest['updated_at']=time.strftime('%Y-%m-%dT%H:%M:%S')
    for name in names:manifest['files'][name]=hashlib.sha256(available[name]).hexdigest()
    path.write_text(json.dumps(manifest,indent=2),encoding='utf-8');ftp.storbinary('STOR config/production-manifest.json',io.BytesIO(json.dumps(manifest).encode()))
    print(json.dumps({'production_files_updated':names}))


def migrate_patch(ftp):
    key=secrets.token_hex(32)
    source=php(key)+"""
require __DIR__.'/config/bootstrap.php';require __DIR__.'/config/migrations.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock']){http_response_code(403);exit;}
app_migrate(app_pdo());
echo json_encode(['migrated'=>true,'database'=>app_settings()['database'],'outbox_status_index'=>(bool)app_pdo()->query("SHOW INDEX FROM eoffice_outbox WHERE Key_name='idx_eoffice_outbox_status'")->fetch()]);
"""
    print(json.dumps(invoke(ftp,source,key)))


def backup_patch(ftp,names):
    if any(name.startswith('Boardcast/') or name.startswith('/') or '..' in name.split('/') for name in names):raise RuntimeError('Invalid patch paths')
    destination=TEMP/('eoffice-production-patch-before-'+time.strftime('%Y%m%d-%H%M%S')+'.tar.gz');count=0
    with tarfile.open(destination,'w:gz') as archive:
        for name in names:
            try:content=hosting.retrieve(ftp,name)
            except Exception:continue
            entry=tarfile.TarInfo(name);entry.size=len(content);archive.addfile(entry,io.BytesIO(content));count+=1
    print(json.dumps({'patch_backup':str(destination),'files':count,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()}))


def live_service_smoke(ftp,ai_only=False):
    key=secrets.token_hex(32)
    source=php(key)+"""
require __DIR__.'/config/services.php';if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock']){http_response_code(403);exit;}
$results=[];
// Send one service self-test to the authenticated service mailbox, never staff.
try{$results['smtp_self_test_accepted']=app_mail('E-Office production deployment self-test',app_env('SMTP_USERNAME'),'<p>Production deployment verification. This test was sent only to the service mailbox.</p>');}catch(Throwable $e){$results['smtp_self_test_accepted']=false;$results['smtp_error_class']=get_class($e);}
$payload=['contents'=>[['parts'=>[['text'=>'Connectivity self-test only. Return the JSON array [1,2]. No other content.']]]],'generationConfig'=>['responseMimeType'=>'application/json','responseSchema'=>['type'=>'ARRAY','items'=>['type'=>'INTEGER']],'maxOutputTokens'=>256,'thinkingConfig'=>['thinkingBudget'=>0]]];
$ch=curl_init('https://generativelanguage.googleapis.com/v1beta/models/'.rawurlencode(app_env('GEMINI_MODEL','gemini-2.5-flash')).':generateContent');curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_POST=>true,CURLOPT_TIMEOUT=>45,CURLOPT_HTTPHEADER=>['Content-Type: application/json','x-goog-api-key: '.app_env('GEMINI_API_KEY')],CURLOPT_POSTFIELDS=>json_encode($payload)]);$body=curl_exec($ch);$results['gemini_generate_status']=curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);$response=json_decode($body?:'',true);$targets=json_decode($response['candidates'][0]['content']['parts'][0]['text']??'',true);$results['gemini_json_array']=is_array($targets)&&$targets===[1,2];
echo json_encode($results);
"""
    if ai_only:
        start=source.index('try{$results[\'smtp_self_test_accepted\']')
        end=source.index('\n$payload=',start)
        source=source[:start]+"$results['smtp_self_test_skipped']=true;"+source[end:]
    result=invoke(ftp,source,key)
    (TEMP/'eoffice-production-live-service-smoke.private.json').write_text(json.dumps(result),encoding='utf-8')
    print(json.dumps(result),flush=True)


def ai_models(ftp):
    key=secrets.token_hex(32)
    source=php(key)+"""
require __DIR__.'/config/bootstrap.php';$ch=curl_init('https://generativelanguage.googleapis.com/v1beta/models');curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>20,CURLOPT_HTTPHEADER=>['x-goog-api-key: '.app_env('GEMINI_API_KEY')]]);$body=curl_exec($ch);curl_close($ch);$models=json_decode($body?:'',true);$supported=[];
foreach($models['models']??[] as $model)if(in_array('generateContent',$model['supportedGenerationMethods']??[],true))$supported[]=$model['name'];
echo json_encode(['configured_model'=>app_env('GEMINI_MODEL'),'generate_models'=>$supported]);
"""
    print(json.dumps(invoke(ftp,source,key)),flush=True)


def configure_ai(ftp):
    settings=json.loads((TEMP/'eoffice-production-runtime-settings.private.json').read_text())
    services=json.loads((TEMP/'eoffice-production-service-settings.private.json').read_text())
    settings['GEMINI_MODEL']=services['GEMINI_MODEL']
    temporary='config/local.php.upload-'+secrets.token_hex(6)
    ftp.storbinary('STOR '+temporary,io.BytesIO(('<?php\nreturn '+hosting.php_value(settings)+';\n').encode()))
    ftp.sendcmd('SITE CHMOD 600 '+temporary);ftp.rename(temporary,'config/local.php')
    (TEMP/'eoffice-production-runtime-settings.private.json').write_text(json.dumps(settings),encoding='utf-8')
    print(json.dumps({'original_production_ai_model_restored':settings['GEMINI_MODEL']}))


def deploy(ftp,database):
    snapshot=json.loads((TEMP/'eoffice-production-storage-snapshot.private.json').read_text())
    if (TEMP/'eoffice-production-manifest.json').exists():raise RuntimeError('Production already migrated; use targeted sync')
    services=json.loads((TEMP/'eoffice-production-service-settings.private.json').read_text())
    checked=json.loads((TEMP/'eoffice-production-service-check.private.json').read_text())
    if not checked.get('smtp_auth') or checked.get('onesignal_status')!=200 or checked.get('gemini_status')!=200:raise RuntimeError('Service verification required before deployment')
    maintenance(ftp)
    time.sleep(5)
    database_backup(ftp,database)
    key=secrets.token_hex(32)
    refresh=php(key)+f"""
$source=__DIR__.'/file_document';$snapshot={hosting.php_value(snapshot['snapshot'])};$manifest=[];$bytes=0;
foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source,FilesystemIterator::SKIP_DOTS)) as $file){{
 if(!$file->isFile())continue;$relative=substr($file->getPathname(),strlen($source)+1);$target=$snapshot.'/'.$relative;
 if(!is_dir(dirname($target)))mkdir(dirname($target),0750,true);$before=stat($file->getPathname());
 if(is_file($target)){{$after=stat($target);if($before['ino']!==$after['ino']||$before['dev']!==$after['dev']){{unlink($target);if(!link($file->getPathname(),$target))throw new RuntimeException('Snapshot refresh failed');}}}}
 elseif(!link($file->getPathname(),$target))throw new RuntimeException('Snapshot refresh failed');
 $after=stat($target);if($before['ino']!==$after['ino']||$before['size']!==$after['size'])throw new RuntimeException('Snapshot validation failed');
 $manifest[$relative]=['inode'=>$before['ino'],'device'=>$before['dev'],'bytes'=>$before['size'],'mtime'=>$before['mtime']];$bytes+=$before['size'];
}}
file_put_contents(dirname($snapshot).'/documents-manifest.json',json_encode($manifest));echo json_encode(['snapshot_updated'=>true,'files'=>count($manifest),'bytes'=>$bytes]);
"""
    frozen=invoke(ftp,refresh,key)
    snapshot.update(frozen)
    (TEMP/'eoffice-production-storage-snapshot.private.json').write_text(json.dumps(snapshot),encoding='utf-8')
    print(json.dumps(frozen),flush=True)
    files=list(hosting.deployment_files())
    # Never touch stored documents, runtime/generated images, or private settings.
    files=[(name,content) for name,content in files if not name.startswith('Boardcast/') and (not name.startswith('e-sign/generated_images/') or name.endswith('.htaccess'))]
    for index,(name,content) in enumerate(files):
        if name=='.htaccess':continue
        if '/' in name:hosting.ensure_dir(ftp,name.rsplit('/',1)[0])
        temporary=name+'.upload-'+secrets.token_hex(6)
        ftp.storbinary('STOR '+temporary,io.BytesIO(content));ftp.rename(temporary,name)
        if(index+1)%30==0:print(json.dumps({'uploaded':index+1,'total':len(files)}),flush=True)
    settings={'DB_HOST':'localhost','DB_PORT':'3306','DB_DATABASE':database['database'],'DB_USERNAME':database['user'],'DB_PASSWORD':database['password'],'APP_URL':URL,'EOFFICE_MOCK_SERVICES':'false','EOFFICE_REMOTE_FILES':'true','EOFFICE_STORAGE':snapshot['private_storage'],**{key:value for key,value in services.items() if not key.startswith('BOARDCAST_')}}
    config='<?php\nreturn '+hosting.php_value(settings)+';\n'
    ftp.storbinary('STOR config/local.php',io.BytesIO(config.encode()));ftp.sendcmd('SITE CHMOD 600 config/local.php')
    (TEMP/'eoffice-production-runtime-settings.private.json').write_text(json.dumps(settings),encoding='utf-8')
    key=secrets.token_hex(32)
    source=php(key)+"""
require __DIR__.'/config/bootstrap.php';require __DIR__.'/config/migrations.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock']){http_response_code(403);exit;}
app_migrate(app_pdo());$source=__DIR__.'/file_document';$target=app_settings()['storage'];
if(is_dir($target))throw new RuntimeException('Private destination already exists');
if(!rename($source,$target))throw new RuntimeException('Private storage move failed');
mkdir($source,0750,true);file_put_contents($source.'/.htaccess',"Require all denied\n");
echo json_encode(['migrated'=>true,'storage_moved'=>true,'storage_writable'=>is_writable($target),'database'=>app_settings()['database']]);
"""
    result=invoke(ftp,source,key)
    if not result.get('storage_writable'):raise RuntimeError('Document storage not writable')
    print(json.dumps(result),flush=True)
    # Verify every application byte before reopening the site.
    mismatches=[]
    for name,content in files:
        if name=='.htaccess':continue
        if hashlib.sha256(hosting.retrieve(ftp,name)).digest()!=hashlib.sha256(content).digest():mismatches.append(name)
    if mismatches:raise RuntimeError('Release verification failed: '+str(mismatches))
    ftp.storbinary('STOR .htaccess',io.BytesIO((hosting.ROOT/'.htaccess').read_bytes()))
    manifest={'deployed_at':time.strftime('%Y-%m-%dT%H:%M:%S'),'files':{name:hashlib.sha256(content).hexdigest() for name,content in files},'storage':snapshot['private_storage'],'database':database['database']}
    ftp.storbinary('STOR config/production-manifest.json',io.BytesIO(json.dumps(manifest).encode()))
    (TEMP/'eoffice-production-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps({'deployed':True,'url':URL,'files_verified':len(files),'mock_services':False}))


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['inspect','storage','services','backup-db','backup-app','check-services','compatibility','prepare','deploy','restore-access','recover-sources','create-smoke','cleanup-smoke','verify-storage','final-check','live-service-smoke','ai-models','configure-ai','verify-release','sync','migrate-patch','backup-patch'])
    parser.add_argument('--ai-only',action='store_true')
    parser.add_argument('--files',nargs='+')
    args=parser.parse_args()
    if args.action=='services':extract_settings();return
    if args.action=='recover-sources':recover_original_sources();return
    account,database=credentials()
    with hosting.connect(account,'ftp.siya.ac.th') as ftp:
        hosting.webroot(ftp)
        if args.action=='inspect':inspect(ftp,database)
        elif args.action=='restore-access':
            ftp.storbinary('STOR .htaccess',io.BytesIO((TEMP/'eoffice-production-original-private/.htaccess').read_bytes()))
            for name,facts in ftp.mlsd():
                if name.startswith('.release-'):ftp.delete(name)
            print(json.dumps({'original_site_access_restored':True}))
        elif args.action=='storage':storage_inspect(ftp,database)
        elif args.action=='backup-db':database_backup(ftp,database)
        elif args.action=='backup-app':application_backup(ftp)
        elif args.action=='check-services':service_check(ftp,database)
        elif args.action=='compatibility':compatibility(ftp,database)
        elif args.action=='prepare':prepare(ftp,database)
        elif args.action=='deploy':deploy(ftp,database)
        elif args.action=='create-smoke':create_smoke(ftp)
        elif args.action=='cleanup-smoke':cleanup_smoke(ftp)
        elif args.action=='verify-storage':verify_storage(ftp)
        elif args.action=='final-check':final_check(ftp)
        elif args.action=='live-service-smoke':live_service_smoke(ftp,args.ai_only)
        elif args.action=='ai-models':ai_models(ftp)
        elif args.action=='configure-ai':configure_ai(ftp)
        elif args.action=='verify-release':verify_release(ftp)
        elif args.action=='sync':sync_files(ftp,args.files or [])
        elif args.action=='migrate-patch':migrate_patch(ftp)
        elif args.action=='backup-patch':backup_patch(ftp,args.files or [])


if __name__=='__main__':main()
