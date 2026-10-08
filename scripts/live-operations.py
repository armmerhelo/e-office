"""Limited live checks. Never broadcasts Push or prints service secrets."""
import argparse
import importlib.util
import io
import json
import secrets
from pathlib import Path

spec=importlib.util.spec_from_file_location('production',Path(__file__).with_name('production-hosting.py'))
production=importlib.util.module_from_spec(spec);spec.loader.exec_module(production)
TEMP=production.TEMP

def inspect(ftp):
    key=secrets.token_hex(32)
    source=production.php(key)+"""
require __DIR__.'/config/services.php';require __DIR__.'/config/google-auth.php';
$pdo=app_pdo();$cli=PHP_BINDIR.'/php';
$queue=$pdo->query('SELECT status,COUNT(*) total FROM eoffice_outbox GROUP BY status')->fetchAll();
echo json_encode(['php_binary'=>PHP_BINARY,'cli_candidate'=>$cli,'cli_executable'=>is_executable($cli),'php_sapi'=>PHP_SAPI,
 'project_root'=>__DIR__,'private_root'=>dirname(app_settings()['storage']),'google_configured'=>app_google_enabled(),
 'google_bindings'=>(int)$pdo->query('SELECT COUNT(*) FROM eoffice_google_accounts')->fetchColumn(),'queue'=>$queue,
 'openssl_available'=>function_exists('openssl_encrypt'),'gzip_available'=>function_exists('gzopen'),
 'backup_key_configured'=>strlen((string)app_env('EOFFICE_BACKUP_KEY'))>0]);
"""
    data=production.invoke(ftp,source,key)
    (TEMP/'eoffice-live-operations-inspection.private.json').write_text(json.dumps(data),encoding='utf-8')
    print(json.dumps(data,indent=2))

def drive_check(ftp):
    key=secrets.token_hex(32)
    source=production.php(key)+"""
require __DIR__.'/config/bootstrap.php';require __DIR__.'/maintenance_requests/api/drive.php';
$result=[];
foreach(['help','list'] as $action){
 $separator=str_contains(drive_api_url(),'?')?'&':'?';$ch=curl_init(drive_api_url().$separator.http_build_query(['action'=>$action]));
 curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>true,CURLOPT_TIMEOUT=>15,CURLOPT_HTTPHEADER=>['Accept: application/json']]);
 $body=curl_exec($ch);$status=curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);$data=json_decode($body?:'',true);
 $result[$action]=['http'=>$status,'json'=>is_array($data),'keys'=>is_array($data)?array_keys($data):[],
 'api_status'=>$data['status']??null,'message'=>$data['message']??$data['error']??null];
}
echo json_encode($result);
"""
    print(json.dumps(production.invoke(ftp,source,key),ensure_ascii=True,indent=2))

def drive_smoke(ftp):
    key=secrets.token_hex(32);name='eoffice-service-test-'+secrets.token_hex(8)+'.png'
    source=production.php(key)+f"""
require __DIR__.'/config/bootstrap.php';require __DIR__.'/maintenance_requests/api/drive.php';
if(app_settings()['mock'])throw new RuntimeException('Production adapter required');
$image=imagecreatetruecolor(10,10);ob_start();imagepng($image);$bytes=ob_get_clean();imagedestroy($image);
$folder=drive_api_request(['action'=>'create_folder','folderName'=>{production.hosting.php_value(name+'.folder')}]);
$folderId=(string)($folder['folderId']??'');if(!preg_match('/^[A-Za-z0-9_-]{{10,200}}$/',$folderId))throw new RuntimeException('Invalid test folder ID');
$result=drive_api_request(['action'=>'create','filename'=>{production.hosting.php_value(name)},'mimeType'=>validate_maintenance_image(base64_encode($bytes)),'base64Data'=>base64_encode($bytes),'folderId'=>$folderId]);
$fileId=(string)($result['fileId']??$result['id']??'');$url=(string)($result['fileUrl']??$result['url']??'');
if(!preg_match('/^[A-Za-z0-9_-]{{10,200}}$/',$fileId))throw new RuntimeException('No test file ID');
echo json_encode(['created'=>true,'file_id'=>$fileId,'folder_id'=>$folderId,'file_url'=>$url,'test_name'=>{production.hosting.php_value(name)}]);
"""
    data=production.invoke(ftp,source,key)
    (TEMP/'eoffice-drive-live-test.private.json').write_text(json.dumps(data),encoding='utf-8')
    print(json.dumps({'drive_image_created':bool(data.get('created')),'test_file_recorded_privately':True,'bytes_are_synthetic':True}))

def drive_cleanup(ftp):
    data=json.loads((TEMP/'eoffice-drive-live-test.private.json').read_text())
    key=secrets.token_hex(32)
    source=production.php(key)+f"""
require __DIR__.'/config/bootstrap.php';require __DIR__.'/maintenance_requests/api/drive.php';
$ids={production.hosting.php_value([data['file_id'],data['folder_id']])};$result=[];
foreach($ids as $id){{
 try{{$response=drive_api_request(['action'=>'delete','fileId'=>$id,'id'=>$id]);$result[]=['deleted'=>($response['status']??'')==='success'&&($response['action']??'')==='delete','keys'=>array_keys($response),'status'=>$response['status']??null,'message'=>$response['message']??null];}}
 catch(Throwable $e){{$result[]=['deleted'=>false,'reason'=>$e->getMessage()];}}
}}
echo json_encode($result);
"""
    results=production.invoke(ftp,source,key)
    (TEMP/'eoffice-drive-cleanup-results.private.json').write_text(json.dumps(results),encoding='utf-8')
    print(json.dumps(results,ensure_ascii=True))

def push_smoke(ftp,subscription):
    import re
    if not subscription or not re.fullmatch(r'[a-f0-9-]{36}',subscription):raise RuntimeError('One explicit subscription UUID is required')
    key=secrets.token_hex(32)
    source=production.php(key)+f"""
require __DIR__.'/config/services.php';
if(app_settings()['mock'])throw new RuntimeException('Real Push service required');
$id={production.hosting.php_value(subscription)};$request=['app_id'=>app_env('ONESIGNAL_APP_ID'),'include_subscription_ids'=>[$id],
 'headings'=>['en'=>'E-Office device test','th'=>'ทดสอบอุปกรณ์ E-Office'],
 'contents'=>['en'=>'This test was sent only to the selected browser.','th'=>'ข้อความทดสอบส่งเฉพาะ browser ที่คุณอนุญาต'],
 'url'=>app_settings()['base_url'],'idempotency_key'=>app_notification_key()];
$ch=curl_init('https://api.onesignal.com/notifications');curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_POST=>true,CURLOPT_TIMEOUT=>30,
 CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: Key '.app_env('ONESIGNAL_REST_API_KEY')],CURLOPT_POSTFIELDS=>json_encode($request)]);
$body=curl_exec($ch);$status=curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);$data=json_decode($body?:'',true);
echo json_encode(['http_status'=>$status,'accepted'=>$status>=200&&$status<300&&!empty($data['id']),'notification_id'=>$data['id']??null,'explicit_targets'=>1,'errors'=>$data['errors']??null]);
"""
    data=production.invoke(ftp,source,key)
    (TEMP/'eoffice-push-live-test.private.json').write_text(json.dumps(data),encoding='utf-8')
    print(json.dumps(data,ensure_ascii=True))

def runtime_paths(ftp):
    key=secrets.token_hex(32)
    source=production.php(key)+"""
require __DIR__.'/config/bootstrap.php';$paths=[];
foreach(['/usr/local/bin/php','/usr/bin/php','/opt/alt/php83/usr/bin/php','/opt/alt/php83/usr/bin/lsphp'] as $path)$paths[$path]=is_executable($path);
echo json_encode(['executables'=>$paths,'open_basedir'=>ini_get('open_basedir'),'timezone'=>date_default_timezone_get(),'project'=>__DIR__,'private'=>dirname(app_settings()['storage'])]);
"""
    print(json.dumps(production.invoke(ftp,source,key),indent=2))

def configure_operations(ftp):
    key=secrets.token_hex(32)
    source=production.php(key)+"""
require __DIR__.'/config/bootstrap.php';$path=__DIR__.'/config/local.php';$settings=require $path;
if(!is_array($settings)||app_settings()['database']!=='siyaacth_eoffice')throw new RuntimeException('Unexpected production config');
$before=$settings;
if(!isset($settings['EOFFICE_CRON_TOKEN']))$settings['EOFFICE_CRON_TOKEN']=bin2hex(random_bytes(32));
if(!isset($settings['EOFFICE_BACKUP_KEY']))$settings['EOFFICE_BACKUP_KEY']=base64_encode(random_bytes(32));
if(!preg_match('/^[a-f0-9]{64}$/',$settings['EOFFICE_CRON_TOKEN'])||strlen(base64_decode($settings['EOFFICE_BACKUP_KEY'],true))!==32)throw new RuntimeException('Existing operations keys invalid');
$private=dirname(app_settings()['storage']);$directory=$private.'/operations';if(!is_dir($directory)&&!mkdir($directory,0750,true))throw new RuntimeException('Operations directory unavailable');
$temporary=$path.'.operations-'.bin2hex(random_bytes(8));$code="<?php\nreturn ".var_export($settings,true).";\n";
if(file_put_contents($temporary,$code)!==strlen($code))throw new RuntimeException('Config write failed');chmod($temporary,0600);if(!rename($temporary,$path))throw new RuntimeException('Config publication failed');
if(function_exists('opcache_invalidate'))opcache_invalidate($path,true);
foreach(['notifications','database-backup','health'] as $action){
 $filename=$directory.'/cron-'.$action.'.curl';
 $curl='url = "'.app_settings()['base_url'].'/api/cron.php"'."\n".'request = "POST"'."\n".'header = "Authorization: Bearer '.$settings['EOFFICE_CRON_TOKEN'].'"'."\n".'header = "Content-Type: application/json"'."\n".'data = "{\\\"action\\\":\\\"'.$action.'\\\"}"'."\n".'proto = "=https"'."\n".'connect-timeout = 10'."\n".'max-time = 240'."\n".'fail'."\n".'silent'."\n".'show-error'."\n";
 file_put_contents($filename,$curl);chmod($filename,0600);
}
$unchanged=true;foreach($before as $name=>$value)if($settings[$name]!==$value)$unchanged=false;
echo json_encode(['existing_settings_preserved'=>$unchanged,'private_operations_directory'=>$directory,'cron_token'=>$settings['EOFFICE_CRON_TOKEN'],'backup_key'=>$settings['EOFFICE_BACKUP_KEY']]);
"""
    data=production.invoke(ftp,source,key)
    (TEMP/'eoffice-operations-keys.private.json').write_text(json.dumps(data),encoding='utf-8')
    print(json.dumps({k:v for k,v in data.items() if k not in ['cron_token','backup_key']}))

def call_cron(action):
    import urllib.request
    keys=json.loads((TEMP/'eoffice-operations-keys.private.json').read_text())
    request=urllib.request.Request(production.URL+'/api/cron.php',data=json.dumps({'action':action}).encode(),headers={'Authorization':'Bearer '+keys['cron_token'],'Content-Type':'application/json'},method='POST')
    with urllib.request.urlopen(request,timeout=240) as response:data=json.loads(response.read())
    if action=='database-backup':(TEMP/'eoffice-encrypted-database-backup.private.json').write_text(json.dumps(data),encoding='utf-8')
    print(json.dumps(data,ensure_ascii=True))

def fetch_database_backup(ftp):
    import os,subprocess
    data=json.loads((TEMP/'eoffice-encrypted-database-backup.private.json').read_text())['backup'];name=data['filename']
    if '/' in name or not name.endswith('.ebak'):raise RuntimeError('Invalid encrypted backup name')
    folder=TEMP/'eoffice-offsite-backups';folder.mkdir(exist_ok=True);target=folder/name
    ftp.cwd('/');content=production.hosting.retrieve(ftp,'private/backups/'+name)
    import hashlib
    if hashlib.sha256(content).hexdigest()!=data['archive_sha256']:raise RuntimeError('Downloaded backup integrity mismatch')
    target.write_bytes(content)
    keys=json.loads((TEMP/'eoffice-operations-keys.private.json').read_text());env={**os.environ,'EOFFICE_BACKUP_KEY':keys['backup_key']}
    result=subprocess.run([os.environ.get('PHP_BIN','C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe'),str(production.hosting.ROOT/'scripts/encrypted-file.php'),'verify',str(target)],env=env,capture_output=True,check=True)
    verified=json.loads(result.stdout)
    print(json.dumps({'database_backup_downloaded':str(target),'verified':verified['verified'],'stream_sha256':verified['sha256']}))

def check_curl_config(ftp):
    import subprocess,threading,http.server,os
    ftp.cwd('/');config=production.hosting.retrieve(ftp,'private/operations/cron-health.curl').decode('utf-8')
    received={}
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            data=self.rfile.read(int(self.headers.get('Content-Length','0')))
            received['body']=json.loads(data);received['auth']=self.headers.get('Authorization')=='Bearer test-config-token';self.send_response(200);self.end_headers();self.wfile.write(b'{"status":"success"}')
        def log_message(self,*args):pass
    server=http.server.HTTPServer(('127.0.0.1',0),Handler)
    import re
    config=re.sub(r'^url = .*$',f'url = "http://127.0.0.1:{server.server_port}/api/cron.php"',config,flags=re.M)
    config=re.sub(r'^header = "Authorization:.*$', 'header = "Authorization: Bearer test-config-token"',config,flags=re.M).replace('proto = "=https"','proto = "=http"')
    file=TEMP/'cron-config-test.private.curl';file.write_text(config,encoding='utf-8');thread=threading.Thread(target=server.handle_request,daemon=True);thread.start()
    try:
        result=subprocess.run(['curl.exe','--config',str(file)],capture_output=True,timeout=15)
        if result.returncode or received.get('body')!={'action':'health'} or not received.get('auth'):raise RuntimeError('Generated curl cron config failed validation')
        print(json.dumps({'private_curl_config_validated':True,'live_secrets_used_in_test':False}))
    finally:server.server_close();file.unlink()

def store_backups():
    import hashlib,os,shutil,subprocess
    root=production.hosting.ROOT/'backups';vault=root/'keys';vault.mkdir(parents=True,exist_ok=True)
    metadata=json.loads((TEMP/'eoffice-encrypted-database-backup.private.json').read_text())['backup']
    name=metadata['filename']
    if Path(name).name!=name or not name.endswith('.ebak'):raise RuntimeError('Invalid database backup name')
    source=TEMP/'eoffice-offsite-backups'/name;target=root/name
    def checksum(path):
        value=hashlib.sha256()
        with open(path,'rb') as handle:
            for chunk in iter(lambda:handle.read(1048576),b''):value.update(chunk)
        return value.hexdigest()
    if checksum(source)!=metadata['archive_sha256']:raise RuntimeError('Backup checksum mismatch')
    if target.exists():
        if checksum(target)!=metadata['archive_sha256']:raise RuntimeError('Existing backup differs')
    else:
        with open(source,'rb') as incoming,open(target,'xb') as output:shutil.copyfileobj(incoming,output,1048576)
    keys=json.loads((TEMP/'eoffice-operations-keys.private.json').read_text())
    key_path=vault/'eoffice-operations-keys.private.json'
    if key_path.exists() and json.loads(key_path.read_text())!=keys:raise RuntimeError('Preserve the previous key vault before replacing it')
    key_path.write_text(json.dumps(keys),encoding='utf-8');os.chmod(key_path,0o600)
    php=os.environ.get('PHP_BIN','C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe')
    process=subprocess.run([php,str(production.hosting.ROOT/'scripts/encrypted-file.php'),'verify',str(target)],env={**os.environ,'EOFFICE_BACKUP_KEY':keys['backup_key']},capture_output=True,check=True)
    verified=json.loads(process.stdout)
    if verified['sha256']!=metadata['stream_sha256']:raise RuntimeError('Backup plaintext checksum mismatch')
    (root/(name+'.metadata.private.json')).write_text(json.dumps({**metadata,**verified,'path':str(target),'key_vault':str(key_path)},indent=2),encoding='utf-8')
    state_path=TEMP/'eoffice-offsite-resumable.private.json'
    if state_path.exists():
        state=json.loads(state_path.read_text());folder=Path(state['directory'])
        (folder/'progress.private.json').write_text(json.dumps({k:v for k,v in state.items() if k!='key_b64'},indent=2),encoding='utf-8')
    print(json.dumps({'database_backup':str(target),'verified':True,'tables':metadata['tables'],'rows':metadata['rows'],'private_key_vault':str(key_path)}))

def verify_operations(ftp):
    import hashlib
    names=['.htaccess','api/cron.php','config/backup-stream.php','config/database-backup.php','scripts/encrypted-file.php','scripts/backup.php','scripts/cron-health.php']
    mismatches=[]
    for name in names:
        if hashlib.sha256(production.hosting.retrieve(ftp,name)).digest()!=hashlib.sha256((production.hosting.ROOT/name).read_bytes()).digest():mismatches.append(name)
    print(json.dumps({'operations_files_verified':len(names),'mismatches':mismatches}))
    if mismatches:raise RuntimeError('Operations deployment mismatch')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['inspect','drive-check','drive-smoke','drive-cleanup','push-smoke','runtime-paths','configure-operations','cron-health','cron-notifications','cron-backup','fetch-database-backup','check-curl-config','store-backups','verify-operations']);parser.add_argument('--subscription');args=parser.parse_args()
    if args.action=='store-backups':store_backups();return
    if args.action.startswith('cron-'):
        call_cron({'cron-health':'health','cron-notifications':'notifications','cron-backup':'database-backup'}[args.action]);return
    account,_=production.credentials()
    with production.hosting.connect(account,'ftp.siya.ac.th') as ftp:
        production.hosting.webroot(ftp)
        if args.action=='inspect':inspect(ftp)
        elif args.action=='drive-check':drive_check(ftp)
        elif args.action=='drive-smoke':drive_smoke(ftp)
        elif args.action=='drive-cleanup':drive_cleanup(ftp)
        elif args.action=='push-smoke':push_smoke(ftp,args.subscription)
        elif args.action=='runtime-paths':runtime_paths(ftp)
        elif args.action=='configure-operations':configure_operations(ftp)
        elif args.action=='fetch-database-backup':fetch_database_backup(ftp)
        elif args.action=='check-curl-config':check_curl_config(ftp)
        elif args.action=='verify-operations':verify_operations(ftp)

if __name__=='__main__':main()
