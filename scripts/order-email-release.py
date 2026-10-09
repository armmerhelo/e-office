"""Targeted order-email production release. Secret values never reach stdout."""
import argparse
import hashlib
import importlib.util
import io
import json
import secrets
import tarfile
import time
import urllib.request
import urllib.parse
import base64
import http.cookiejar
import re
from pathlib import Path

spec = importlib.util.spec_from_file_location('production', Path(__file__).with_name('production-hosting.py'))
production = importlib.util.module_from_spec(spec)
spec.loader.exec_module(production)
ROOT = production.hosting.ROOT
TEMP = production.TEMP
FILES = [
    'config/order-email-schema.php', 'config/order-ai.php', 'config/order-emails.php',
    'scripts/order-emails.php', 'email_send/ai_settings.php', 'email_send/order_jobs.php',
    'email_send/order-ui.js', 'email_send/order-email.css', 'email_send/order-dashboard.js',
    'email_send/ai-settings.js', 'email_send/ai_settings.html',
    'email_send/doc_send_email.html', 'email_send/my_dashboard.html',
    'email_send/api_get_my_docs.php', 'email_send/process_pdf.php',
    'config/migrations.php', 'api/create_document.php', 'scripts/order-cron.sh',
]


def invoke(ftp, body):
    key = secrets.token_hex(32)
    account,_=production.credentials()
    with production.hosting.connect(account,'ftp.siya.ac.th') as fresh:
        production.hosting.webroot(fresh)
        return production.invoke(fresh, production.php(key) + "\n" + body, key)


def inspect(ftp):
    return invoke(ftp, """
require __DIR__.'/config/bootstrap.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock'])throw new RuntimeException('Unexpected target');
$pdo=app_pdo();$paths=[];
foreach([PHP_BINDIR.'/php','/usr/local/php83/bin/php','/usr/local/php81/bin/php','/opt/alt/php83/usr/bin/php'] as $path)$paths[$path]=is_executable($path);
$settingsTable=(bool)$pdo->query("SHOW TABLES LIKE 'eoffice_order_settings'")->fetchColumn();
echo json_encode(['root'=>__DIR__,'private'=>dirname(app_settings()['storage']),'php'=>PHP_VERSION,'sapi'=>PHP_SAPI,'binary'=>PHP_BINARY,'cli_paths'=>$paths,
'disabled_functions'=>ini_get('disable_functions'),'open_basedir'=>ini_get('open_basedir'),
'gemini_configured'=>strlen((string)app_env('GEMINI_API_KEY'))>0,'model'=>app_env('GEMINI_MODEL'),
'settings_key_configured'=>strlen((string)app_env('EOFFICE_SETTINGS_KEY'))>0,'settings_table'=>$settingsTable,
'admin_count'=>(int)$pdo->query("SELECT COUNT(*) FROM t_user WHERE User_Status='Admin'")->fetchColumn(),
'counts'=>['users'=>(int)$pdo->query('SELECT COUNT(*) FROM t_user')->fetchColumn(),'documents'=>(int)$pdo->query('SELECT COUNT(*) FROM t_document')->fetchColumn(),'email_logs'=>(int)$pdo->query('SELECT COUNT(*) FROM email_logs')->fetchColumn()],
'settings'=>$settingsTable?$pdo->query('SELECT enabled,activated_at,worker_at FROM eoffice_order_settings WHERE id=1')->fetch():null]);
""")


def diagnose_smoke(ftp):
    state=json.loads((TEMP/'eoffice-production-smoke.private.json').read_text())
    return invoke(ftp,"""
require __DIR__.'/config/order-emails.php';$pdo=app_pdo();$names=[];
foreach(['app_document_date','app_document_transaction','app_locked_document','app_uploaded','app_order_saved'] as $name)$names[$name]=function_exists($name);
$columns=[];foreach($pdo->query('SHOW COLUMNS FROM t_document') as $column)$columns[]=['name'=>$column['Field'],'type'=>$column['Type'],'nullable'=>$column['Null']];
$id=__USER__;echo json_encode(['functions'=>$names,'columns'=>$columns,'storage_writable'=>is_writable(app_settings()['storage'].'/original/'.(date('Y')+543)),'settings'=>$pdo->query('SELECT enabled,activated_at,worker_at FROM eoffice_order_settings WHERE id=1')->fetch(),
'synthetic_doc_count'=>(int)$pdo->query('SELECT COUNT(*) FROM t_document WHERE User_Id='.$id)->fetchColumn()]);
""".replace('__USER__',str(int(state['user_id']))))


def diagnose_create(ftp):
    state=json.loads((TEMP/'eoffice-production-smoke.private.json').read_text())
    jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    login=urllib.request.Request(production.URL+'/api/auth_login.php',data=json.dumps({'username':state['email'],'password':state['password']}).encode(),headers={'Content-Type':'application/json'})
    with client.open(login,timeout=30) as response:json.loads(response.read())
    token=secrets.token_hex(32);name='.release-'+secrets.token_hex(16)+'.php'
    source=production.php(token)+"""
require __DIR__.'/config/bootstrap.php';
$user=app_user();if((int)$user['User_Id']!==__USER__){http_response_code(403);exit;}
set_exception_handler(static function(Throwable $error){if(app_pdo()->inTransaction())app_pdo()->rollBack();echo json_encode(['diagnostic_class'=>get_class($error),'diagnostic_code'=>$error->getCode(),'diagnostic_message'=>$error->getMessage()]);});
require __DIR__.'/api/create_document.php';
""".replace('__USER__',str(int(state['user_id'])))
    ftp.storbinary('STOR '+name,io.BytesIO(source.encode()))
    boundary='eoffice-'+secrets.token_hex(16);parts=[]
    values={'doc_number':'OC-'+state['nonce'],'doc_name':'Synthetic order email release verification','doc_type':'คำสั่ง','doc_date_receive':'2026-10-08'}
    for field,value in values.items():parts.append(('--'+boundary+'\r\nContent-Disposition: form-data; name="'+field+'"\r\n\r\n'+value+'\r\n').encode())
    for i in range(2):
        for field,value in [('doc_file_name[]','Synthetic PDF '+str(i+1)),('file_id[]','0')]:parts.append(('--'+boundary+'\r\nContent-Disposition: form-data; name="'+field+'"\r\n\r\n'+value+'\r\n').encode())
        parts.append(('--'+boundary+'\r\nContent-Disposition: form-data; name="doc_upload[]"; filename="synthetic-'+str(i)+'.pdf"\r\nContent-Type: application/pdf\r\n\r\n').encode()+base64.b64decode(state['pdf'])+b'\r\n')
    parts.append(('--'+boundary+'--\r\n').encode())
    try:
        request=urllib.request.Request(production.URL+'/'+name,data=b''.join(parts),headers={'Content-Type':'multipart/form-data; boundary='+boundary,'X-Eoffice-Deploy-Token':token})
        with client.open(request,timeout=60) as response:result=json.loads(response.read())
        (TEMP/'eoffice-orders-create-diagnostic.private.json').write_text(json.dumps(result),encoding='utf-8')
        return {'class':result.get('diagnostic_class'),'code':result.get('diagnostic_code'),'error_category':re.sub(r'[^a-zA-Z0-9_ :().\[\]-]','?',result.get('diagnostic_message',''))[:250],'success':result.get('status')=='success'}
    finally:ftp.delete(name)


def panel(account, path, values=None):
    # The same hosting account's explicit FTPS credentials are used only at its
    # TLS-verified control-panel origin. Do not follow authentication redirects.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    token = base64.b64encode((account['user'] + ':' + account['password']).encode()).decode()
    data = urllib.parse.urlencode(values).encode() if values is not None else None
    # Hostneverdie documents port 4229; hostname was verified from this site's
    # runtime (cs88.hostneverdie.com). Its panel certificate matches this host.
    request = urllib.request.Request('https://cs88.hostneverdie.com:4229/' + path,
        headers={'Authorization':'Basic ' + token, 'Accept':'application/json'}, data=data)
    with opener.open(request, timeout=30) as response:
        body = response.read().decode('utf-8', errors='replace')
        content_type = response.headers.get('Content-Type', '')
    if 'json' in content_type:
        result = json.loads(body)
    else:
        result = urllib.parse.parse_qs(body, keep_blank_values=True)
    if not result or body.lstrip().startswith('<'):
        raise RuntimeError('Control panel did not return an API response')
    return result


def backup(ftp):
    destination = TEMP / ('eoffice-orders-before-' + time.strftime('%Y%m%d-%H%M%S') + '.tar.gz')
    existing = []; missing = []
    with tarfile.open(destination, 'w:gz') as archive:
        for name in FILES + ['config/local.php']:
            try:
                content = production.hosting.retrieve(ftp, name)
            except production.hosting.ftplib.error_perm as error:
                if str(error).startswith('550'):
                    missing.append(name); continue
                raise
            entry = tarfile.TarInfo(name); entry.size = len(content)
            archive.addfile(entry, io.BytesIO(content)); existing.append(name)
    metadata = {'path':str(destination), 'sha256':hashlib.sha256(destination.read_bytes()).hexdigest(), 'existing':existing, 'new_paths':missing}
    (TEMP / 'eoffice-orders-rollback.private.json').write_text(json.dumps(metadata), encoding='utf-8')
    return {'backup':str(destination), 'files':len(existing), 'sha256':metadata['sha256']}


def upload(ftp, name):
    content = (ROOT / name).read_bytes()
    temporary = name + '.upload-' + secrets.token_hex(6)
    account,_=production.credentials()
    # Some shared FTPS servers reset the data connection during TLS shutdown
    # after accepting all bytes. Verify the staged bytes on a fresh connection
    # before the atomic rename instead of treating that reset as success.
    for attempt in range(3):
        try:
            with production.hosting.connect(account,'ftp.siya.ac.th') as fresh:
                production.hosting.webroot(fresh)
                staged=False
                try:staged=production.hosting.retrieve(fresh,temporary)==content
                except production.hosting.ftplib.error_perm:pass
                if not staged:
                    fresh.storbinary('STOR '+temporary,io.BytesIO(content))
                    if production.hosting.retrieve(fresh,temporary)!=content:raise RuntimeError('Staged checksum mismatch')
                fresh.rename(temporary,name)
                if production.hosting.retrieve(fresh,name)!=content:raise RuntimeError('Checksum mismatch: '+name)
                return
        except (OSError,EOFError,production.hosting.ftplib.error_temp) as error:
            print(json.dumps({'file':name,'transfer_retry':attempt+1,'error_class':type(error).__name__}),flush=True)
            if attempt==2:raise
            time.sleep(1)


def save_manifest(manifest):
    account,_=production.credentials()
    content=json.dumps(manifest).encode();temporary='config/production-manifest.json.upload-'+secrets.token_hex(6)
    with production.hosting.connect(account,'ftp.siya.ac.th') as fresh:
        production.hosting.webroot(fresh);fresh.storbinary('STOR '+temporary,io.BytesIO(content));fresh.rename(temporary,'config/production-manifest.json')


def sync_runner(ftp):
    upload(ftp,'scripts/order-cron.sh')
    path=TEMP/'eoffice-production-manifest.json';manifest=json.loads(path.read_text())
    manifest['files']['scripts/order-cron.sh']=hashlib.sha256((ROOT/'scripts/order-cron.sh').read_bytes()).hexdigest()
    manifest['updated_at']=time.strftime('%Y-%m-%dT%H:%M:%S');save_manifest(manifest)
    path.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    return {'runner_uploaded':True,'cron_command':'/bin/sh /home/siyaacth/domains/e-office.siya.ac.th/public_html/scripts/order-cron.sh >> /home/siyaacth/domains/e-office.siya.ac.th/private/order-emails.log 2>&1'}


def finish(ftp):
    removed=[]
    for directory in ['config','scripts','email_send','api']:
        expected={name.rsplit('/',1)[-1] for name in FILES if name.startswith(directory+'/')}
        for name,facts in list(ftp.mlsd(directory)):
            original=name.split('.upload-',1)[0]
            if '.upload-' in name and original in expected:
                ftp.delete(directory+'/'+name);removed.append(directory+'/'+name)
    content=production.hosting.retrieve(ftp,'config/local.php')
    destination=TEMP/'eoffice-orders-config-after.private.php';destination.write_bytes(content)
    state=inspect(ftp)
    return {'staged_files_removed':len(removed),'private_config_backup':str(destination),'private_config_sha256':hashlib.sha256(content).hexdigest(),'enabled':state['settings']['enabled'],'activated_at':state['settings']['activated_at'],'worker_at':state['settings']['worker_at'],'counts':state['counts']}


def deploy(ftp):
    backup_info = json.loads((TEMP / 'eoffice-orders-rollback.private.json').read_text())
    if hashlib.sha256(Path(backup_info['path']).read_bytes()).hexdigest() != backup_info['sha256']:
        raise RuntimeError('Backup checksum mismatch')
    # Existing production dependencies must match the current application. Do
    # not overwrite concurrent member-management work as part of this release.
    mismatch = []
    for name in ['config/bootstrap.php','config/services.php']:
        remote = production.hosting.retrieve(ftp,name)
        if remote != (ROOT/name).read_bytes():
            # Only bootstrap's permission-catalog validation differs in some
            # deployed member releases; check its capabilities separately.
            if name != 'config/bootstrap.php':
                mismatch.append(name)
    if mismatch:
        raise RuntimeError('Production dependency differs: ' + ','.join(mismatch))
    capabilities=invoke(ftp,"""
require __DIR__.'/config/bootstrap.php';$ok=true;
foreach(['app_env','app_settings','app_pdo','app_user','app_admin','app_can','app_permission','app_locked_document'] as $function)if(!function_exists($function))$ok=false;
echo json_encode(['compatible'=>$ok&&(new ReflectionFunction('app_user'))->getNumberOfParameters()>=2]);
""")
    if not capabilities['compatible']:
        raise RuntimeError('Production bootstrap lacks required authorization functions')
    for name in FILES[:4]:
        upload(ftp, name)
    migrated = invoke(ftp, """
require __DIR__.'/config/bootstrap.php';require __DIR__.'/config/order-email-schema.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock'])throw new RuntimeException('Wrong target');
app_order_email_migrate(app_pdo());
echo json_encode(['migrated'=>true,'enabled'=>(bool)app_pdo()->query('SELECT enabled FROM eoffice_order_settings WHERE id=1')->fetchColumn()]);
""")
    for name in FILES[4:]:
        if name not in ['config/migrations.php','api/create_document.php']:
            upload(ftp, name)
    upload(ftp, 'config/migrations.php'); upload(ftp, 'api/create_document.php')
    path = TEMP / 'eoffice-production-manifest.json'
    manifest = json.loads(path.read_text()) if path.exists() else {'files':{}}
    for name in FILES:
        manifest['files'][name] = hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
    manifest['updated_at'] = time.strftime('%Y-%m-%dT%H:%M:%S')
    path.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    save_manifest(manifest)
    return {'deployed_files':len(FILES), **migrated}


def configure(ftp):
    return invoke(ftp, """
require __DIR__.'/config/bootstrap.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock'])throw new RuntimeException('Wrong target');
$path=__DIR__.'/config/local.php';$settings=require $path;
if(!is_array($settings))throw new RuntimeException('Invalid local settings');
$new=false;
if(empty($settings['EOFFICE_SETTINGS_KEY'])){$settings['EOFFICE_SETTINGS_KEY']=base64_encode(random_bytes(32));$new=true;}
$key=base64_decode($settings['EOFFICE_SETTINGS_KEY'],true);if($key===false||strlen($key)!==32)throw new RuntimeException('Invalid encryption key');
if($new){$temporary=$path.'.upload-'.bin2hex(random_bytes(6));$bytes="<?php\nreturn ".var_export($settings,true).";\n";
if(file_put_contents($temporary,$bytes,LOCK_EX)!==strlen($bytes)||!chmod($temporary,0600)||!rename($temporary,$path))throw new RuntimeException('Atomic config update failed');
if(function_exists('opcache_invalidate'))opcache_invalidate($path,true);}
echo json_encode(['encryption_key_ready'=>true,'generated'=>$new,'config_mode'=>substr(sprintf('%o',fileperms($path)),-4)]);
""")


def check_ai(ftp):
    return invoke(ftp, """
require __DIR__.'/config/order-emails.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock'])throw new RuntimeException('Wrong target');
try{$config=app_order_ai_config();app_order_ai_test($config);$models=app_order_models($config['key']);
echo json_encode(['ai_pdf_json_test'=>true,'configured_model'=>$config['model'],'models_count'=>count($models),'encryption_ready'=>strlen(app_order_secret_key())===32]);}
catch(AppOrderAIException $e){echo json_encode(['ai_pdf_json_test'=>false,'code'=>$e->reason]);}
""")


def panel_local_check(ftp, account):
    # Try the same panel origin from the hosting server in case its firewall
    # limits outside access. TLS verification is never disabled.
    return invoke(ftp, """
require __DIR__.'/config/bootstrap.php';
$results=[];
foreach([false,true] as $loopback){
$ch=curl_init('https://ftp.siya.ac.th:2222/CMD_API_CRON_JOBS');
curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>10,CURLOPT_USERPWD=>__AUTH__]);
if($loopback)curl_setopt($ch,CURLOPT_RESOLVE,['ftp.siya.ac.th:2222:127.0.0.1']);
$body=curl_exec($ch);$status=curl_getinfo($ch,CURLINFO_RESPONSE_CODE);$errno=curl_errno($ch);curl_close($ch);
$results[]=['loopback'=>$loopback,'http'=>$status,'curl_errno'=>$errno,'api_response'=>is_string($body)&&!str_starts_with(ltrim($body),'<')&&str_contains($body,'=')];
}
echo json_encode(['server_hostname'=>gethostname(),'panel_checks'=>$results]);
""".replace('__AUTH__',production.hosting.php_value(account['user']+':'+account['password'])))


def panel_loopback(ftp, account, values=None):
    # The provider exposes its legacy panel over HTTP on 4229. Authentication
    # occurs ONLY on the hosting server's loopback interface, reached through
    # our TLS-protected deployment request. Credentials never cross external
    # plaintext HTTP, and redirects are not followed.
    return invoke(ftp,"""
$ch=curl_init('http://127.0.0.1:4229/CMD_API_CRON_JOBS?json=yes');
curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>20,CURLOPT_USERPWD=>__AUTH__,CURLOPT_FOLLOWLOCATION=>false]);
$values=__VALUES__;if($values!==null)curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>http_build_query($values)]);
$body=curl_exec($ch);$http=curl_getinfo($ch,CURLINFO_RESPONSE_CODE);$errno=curl_errno($ch);curl_close($ch);
$data=is_string($body)?json_decode($body,true):null;
if(!is_array($data)&&is_string($body)&&!str_starts_with(ltrim($body),'<'))parse_str($body,$data);
echo json_encode(['http'=>$http,'curl_errno'=>$errno,'api'=>is_array($data)?$data:null]);
""".replace('__AUTH__',production.hosting.php_value(account['user']+':'+account['password'])).replace('__VALUES__',production.hosting.php_value(values)))


def cli_probe(ftp, binary):
    return invoke(ftp, """
require __DIR__.'/config/bootstrap.php';
if(!function_exists('proc_open')){echo json_encode(['cli_test'=>false,'reason'=>'proc_open_disabled']);exit;}
$binary=__BINARY__;
$code='require '.var_export(__DIR__.'/config/order-emails.php',true).';echo json_encode(["sapi"=>PHP_SAPI,"php"=>PHP_VERSION,"database"=>app_settings()["database"],"pdo_mysql"=>extension_loaded("pdo_mysql"),"curl"=>extension_loaded("curl"),"fileinfo"=>extension_loaded("fileinfo"),"openssl"=>extension_loaded("openssl"),"config_ready"=>strlen(app_order_secret_key())===32]);';
$process=proc_open([$binary,'-r',$code],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,__DIR__);
if(!is_resource($process)){echo json_encode(['cli_test'=>false,'reason'=>'launch_failed']);exit;}
fclose($pipes[0]);$out=stream_get_contents($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);$exit=proc_close($process);$data=json_decode($out,true);
echo json_encode(['cli_test'=>$exit===0&&is_array($data)&&($data['sapi']??'')==='cli','exit'=>$exit,'runtime'=>$data,'stderr_present'=>$error!=='']);
""".replace('__BINARY__', production.hosting.php_value(binary)))


def activate(ftp):
    return invoke(ftp, """
require __DIR__.'/config/order-emails.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock'])throw new RuntimeException('Wrong target');
app_order_ai_test(app_order_ai_config());$pdo=app_pdo();$pdo->beginTransaction();
$settings=$pdo->query('SELECT * FROM eoffice_order_settings WHERE id=1 FOR UPDATE')->fetch();
if($settings['worker_at']===null||strtotime($settings['worker_at'])<time()-900){$pdo->rollBack();throw new RuntimeException('Recent cron heartbeat required before activation');}
if($settings['activated_at']===null&&(int)$pdo->query('SELECT COUNT(*) FROM eoffice_order_jobs')->fetchColumn()!==0)throw new RuntimeException('Unexpected old queued work');
$pdo->exec('UPDATE eoffice_order_settings SET enabled=1,activated_at=COALESCE(activated_at,NOW()),updated_at=NOW(),revision=revision+1 WHERE id=1');app_order_audit('production_activated');$pdo->commit();
echo json_encode(['enabled'=>true,'activated_at'=>app_order_settings()['activated_at'],'existing_orders_enrolled'=>0]);
""")


def cron_status(ftp):
    return invoke(ftp,"""
require __DIR__.'/config/order-emails.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock'])throw new RuntimeException('Wrong target');
$log=dirname(app_settings()['storage']).'/order-emails.log';$exists=is_file($log);$messages=[];$categories=[];
if($exists){$handle=fopen($log,'rb');if($handle){$size=filesize($log);if($size>16384)fseek($handle,-16384,SEEK_END);$text=stream_get_contents($handle);fclose($handle);
foreach(array_slice(explode("\n",trim($text)),-10) as $line){$line=trim($line);
if(preg_match('/^\\d+ order jobs processed$/D',$line)||str_starts_with($line,'Order cron: no compatible PHP')||preg_match('/^Order worker failed \\([A-Za-z0-9_\\\\]+\\)$/D',$line))$messages[]=$line;
else{foreach(['not found','Permission denied','Fatal error','No such file','parse error'] as $category)if(stripos($line,$category)!==false)$categories[]=$category;}
}}}
$pdo=app_pdo();$jobs=$pdo->query('SELECT status,COUNT(*) total FROM eoffice_order_jobs GROUP BY status')->fetchAll();
echo json_encode(['server_now'=>date('Y-m-d H:i:s'),'timezone'=>date_default_timezone_get(),'log_exists'=>$exists,'log_size'=>$exists?filesize($log):null,'log_updated_at'=>$exists?date('Y-m-d H:i:s',filemtime($log)):null,'messages'=>$messages,'error_categories'=>array_values(array_unique($categories)),
'settings'=>$pdo->query('SELECT enabled,activated_at,worker_at FROM eoffice_order_settings WHERE id=1')->fetch(),'jobs'=>$jobs]);
""")


def cleanup_smoke_jobs(ftp):
    state=json.loads((TEMP/'eoffice-production-smoke.private.json').read_text())
    return invoke(ftp,"""
require __DIR__.'/config/order-emails.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock'])throw new RuntimeException('Wrong target');
$id=__USER__;$email=__EMAIL__;$pdo=app_pdo();$pdo->beginTransaction();
$q=$pdo->prepare('SELECT User_Email FROM t_user WHERE User_Id=? FOR UPDATE');$q->execute([$id]);if($q->fetchColumn()!==$email)throw new RuntimeException('Unexpected smoke account');
$q=$pdo->prepare('SELECT Doc_Id FROM t_document WHERE User_Id=? FOR UPDATE');$q->execute([$id]);$docs=$q->fetchAll(PDO::FETCH_COLUMN);$deleted=0;
foreach($docs as $doc){$q=$pdo->prepare('DELETE FROM eoffice_order_jobs WHERE doc_id=?');$q->execute([$doc]);$deleted+=$q->rowCount();}
$pdo->prepare('UPDATE t_document SET Doc_Year=TRIM(Doc_Year) WHERE User_Id=?')->execute([$id]);
$pdo->prepare("DELETE FROM t_user WHERE User_Email=? AND User_Name='Synthetic order review recipient'")->execute([__EXTRA__]);
$pdo->commit();echo json_encode(['temporary_order_jobs_removed'=>$deleted]);
""".replace('__USER__',str(int(state['user_id']))).replace('__EMAIL__',production.hosting.php_value(state['email'])).replace('__EXTRA__',production.hosting.php_value('order-review-extra-'+state['nonce']+'@example.invalid')))


def verify(ftp):
    mismatch = [name for name in FILES if hashlib.sha256(production.hosting.retrieve(ftp,name)).digest()!=hashlib.sha256((ROOT/name).read_bytes()).digest()]
    result = inspect(ftp)
    result.update({'files_checked':len(FILES),'mismatches':mismatch,'temporary_helpers':[name for name,facts in ftp.mlsd() if name.startswith('.release-')]})
    return result


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['inspect','cron-status','cleanup-smoke-jobs','diagnose-smoke','diagnose-create','panel-check','panel-local-check','panel-loopback-check','backup','deploy','sync-runner','configure','check-ai','cli-probe','activate','verify','finish'])
    parser.add_argument('--binary')
    args=parser.parse_args();account,_=production.credentials()
    if args.action=='panel-check':
        try:
            result=panel(account,'CMD_API_CRON_JOBS')
            (TEMP/'eoffice-orders-panel.private.json').write_text(json.dumps(result),encoding='utf-8')
            print(json.dumps({'panel_access':True,'keys':list(result.keys()),'response_saved_privately':True}))
        except Exception as error:
            print(json.dumps({'panel_access':False,'error_class':type(error).__name__,'status':getattr(error,'code',None),'reason':str(getattr(error,'reason',''))}))
        return
    with production.hosting.connect(account,'ftp.siya.ac.th') as ftp:
        production.hosting.webroot(ftp)
        if args.action=='inspect':result=inspect(ftp)
        elif args.action=='cron-status':result=cron_status(ftp)
        elif args.action=='cleanup-smoke-jobs':result=cleanup_smoke_jobs(ftp)
        elif args.action=='diagnose-smoke':result=diagnose_smoke(ftp)
        elif args.action=='diagnose-create':result=diagnose_create(ftp)
        elif args.action=='backup':result=backup(ftp)
        elif args.action=='deploy':result=deploy(ftp)
        elif args.action=='sync-runner':result=sync_runner(ftp)
        elif args.action=='configure':result=configure(ftp)
        elif args.action=='check-ai':result=check_ai(ftp)
        elif args.action=='panel-local-check':result=panel_local_check(ftp,account)
        elif args.action=='panel-loopback-check':
            result=panel_loopback(ftp,account)
            (TEMP/'eoffice-orders-panel-loopback.private.json').write_text(json.dumps(result),encoding='utf-8')
            api=result.get('api') or {}
            result={'http':result['http'],'curl_errno':result['curl_errno'],'api_keys':list(api.keys()),'error':api.get('error'),'response_saved_privately':True}
        elif args.action=='cli-probe':result=cli_probe(ftp,args.binary)
        elif args.action=='activate':result=activate(ftp)
        elif args.action=='finish':result=finish(ftp)
        else:result=verify(ftp)
        (TEMP/('eoffice-orders-'+args.action+'.private.json')).write_text(json.dumps(result),encoding='utf-8')
        print(json.dumps(result,indent=2))


if __name__=='__main__':
    main()
