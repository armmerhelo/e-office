"""Staging-only FTP inspection/deployment. Credentials stay in the user's private file.

No production login or production upload is performed by this tool.
"""
import argparse
import ftplib
import io
import json
import posixpath
import re
import ssl
import tempfile
import hashlib
import secrets
import urllib.request
import urllib.error
import tarfile
import time
import gzip
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CREDENTIALS = ROOT.parent / 'e-office ftp and db.txt'


def credentials(path):
    text = Path(path).read_text(encoding='utf-8-sig')
    def section(kind):
        blocks = re.findall(r'(?ms)^(FTP|Database)([^\n]*)\n(.*?)(?=^(?:FTP|Database)|\Z)', text)
        body = next((body for category, title, body in blocks if category == kind and 'Production' not in title), None)
        if body is None:
            raise RuntimeError('Missing staging credential section')
        host_match = re.search(r'Host\s*:?\s*([^\s]+)(?:\s+port\s*:?\s*(\d+))?', body, re.I)
        if not host_match:
            raise RuntimeError('No host field in staging section')
        user = re.search(r'username\s*:\s*([^\s]+)', body).group(1)
        password = re.search(r'password\s*:\s*([^\s]+)', body).group(1)
        db_match = re.search(r'database\s*:\s*([^\s]+)', body)
        host, port = host_match.groups()
        port = port or ('3306' if kind == 'Database' else '2121')
        database = db_match.group(1) if db_match else None
        return dict(host=host, port=int(port), user=user, password=password, database=database)
    return section('FTP'), section('Database')


def connect(account, hostname=None):
    ftp = ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=30)
    ftp.connect(hostname or account['host'], account['port'])
    ftp.login(account['user'], account['password'])
    ftp.prot_p()
    ftp.set_pasv(True)
    return ftp


def retrieve(ftp, name):
    output = io.BytesIO()
    ftp.retrbinary('RETR ' + name, output.write)
    return output.getvalue()


def webroot(ftp):
    entries = list(ftp.mlsd())
    if any(name == 'public_html' and facts.get('type') == 'dir' for name, facts in entries):
        ftp.cwd('public_html')


def php_value(value):
    encoded = json.dumps(value).replace('\\', '\\\\').replace("'", "\\'")
    return "json_decode('" + encoded + "', true)"


def protected_php(key):
    return "<?php\n" + f"if (($_SERVER['HTTP_HOST'] ?? '') !== 'e-office-test.siya.ac.th' || !hash_equals('{hashlib.sha256(key.encode()).hexdigest()}', hash('sha256', $_SERVER['HTTP_X_EOFFICE_DEPLOY_TOKEN'] ?? ''))) {{ http_response_code(404); exit; }}\nheader('Content-Type: application/json'); header('Cache-Control: no-store');\n"


def invoke_probe(ftp, source, key):
    name = '.deploy-' + secrets.token_hex(16) + '.php'
    ftp.storbinary('STOR ' + name, io.BytesIO(source.encode('utf-8')))
    try:
        request = urllib.request.Request('https://e-office-test.siya.ac.th/' + name, headers={'X-Eoffice-Deploy-Token': key}, method='POST', data=b'')
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read())
    finally:
        ftp.delete(name)


def probe(ftp, database):
    key = secrets.token_hex(32)
    user = php_value(database['user'])
    password = php_value(database['password'])
    name = php_value(database['database'])
    source = protected_php(key) + f"""
$result=['php'=>PHP_VERSION,'document_root'=>$_SERVER['DOCUMENT_ROOT'],'extensions'=>array_values(array_intersect(['pdo_mysql','mysqli','mbstring','fileinfo','gd','curl','openssl'],get_loaded_extensions()))];
try {{
 $pdo=new PDO('mysql:host=localhost;port=3306;dbname='.{name}.';charset=utf8mb4',{user},{password},[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
 $result['database_host']='localhost';$result['database_port']=3306;$result['database']=$pdo->query('SELECT DATABASE()')->fetchColumn();
 $result['server']=$pdo->query('SELECT VERSION()')->fetchColumn();$result['tables']=$pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);$result['schema']=[];$result['counts']=[];
 foreach($result['tables'] as $table) $result['counts'][$table]=(int)$pdo->query('SELECT COUNT(*) FROM `'.str_replace('`','``',$table).'`')->fetchColumn();
 foreach(['t_user','t_document','t_access_rights','room_bookings','maintenance_requests','email_logs'] as $table) if(in_array($table,$result['tables'],true)) $result['schema'][$table]=$pdo->query('SHOW CREATE TABLE '.$table)->fetch(PDO::FETCH_NUM)[1];
}} catch(Throwable $e) {{ $result['db_error_code']=$e->getCode();$result['db_connected']=false; }}
echo json_encode($result);
"""
    return invoke_probe(ftp, source, key)


def backup(ftp):
    folder = Path.home() / 'AppData/Local/Temp/opencode'
    destination = folder / ('eoffice-staging-before-' + time.strftime('%Y%m%d-%H%M%S') + '.tar.gz')
    count = 0
    with tarfile.open(destination, 'w:gz') as archive:
        def walk(prefix=''):
            nonlocal count
            for name, facts in ftp.mlsd(prefix or '.'):
                if name in ['.', '..']:
                    continue
                remote = (prefix + '/' if prefix else '') + name
                if facts.get('type') == 'dir':
                    walk(remote)
                elif facts.get('type') == 'file':
                    content = retrieve(ftp, remote)
                    entry = tarfile.TarInfo(remote)
                    entry.size = len(content)
                    archive.addfile(entry, io.BytesIO(content))
                    count += 1
        walk()
    return dict(backup=str(destination), files=count)


def database_backup(ftp, database):
    key=secrets.token_hex(32)
    source=protected_php(key)+f"""
$pdo=new PDO('mysql:host=localhost;port=3306;dbname='.{php_value(database['database'])}.';charset=utf8mb4',{php_value(database['user'])},{php_value(database['password'])},[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
if($pdo->query('SELECT DATABASE()')->fetchColumn()!=='siyaacth_eoffice_test'){{http_response_code(403);exit;}}
$pdo->beginTransaction();$tables=$pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);$backup=[];
foreach($tables as $table){{$safe='`'.str_replace('`','``',$table).'`';$backup[$table]=['schema'=>$pdo->query('SHOW CREATE TABLE '.$safe)->fetch(PDO::FETCH_NUM)[1],'rows'=>$pdo->query('SELECT * FROM '.$safe)->fetchAll(PDO::FETCH_ASSOC)];}}
$pdo->commit();echo json_encode($backup,JSON_INVALID_UTF8_SUBSTITUTE);
"""
    result=invoke_probe(ftp,source,key)
    destination=Path.home()/'AppData/Local/Temp/opencode'/('eoffice-staging-db-before-'+time.strftime('%Y%m%d-%H%M%S')+'.json.gz')
    with gzip.open(destination,'wt',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False)
    return dict(database_backup=str(destination),tables=len(result))


def ensure_dir(ftp, directory):
    path=''
    for component in directory.split('/'):
        if not component:continue
        path+=(('/' if path else '')+component)
        try:ftp.mkd(path)
        except ftplib.error_perm as exc:
            if not str(exc).startswith('550'):raise


def deployment_files():
    excluded={'node_modules','tests','test-results','.git','__pycache__','file_document','Boardcast','backups'}
    for path in ROOT.rglob('*'):
        if not path.is_file():continue
        relative=path.relative_to(ROOT)
        if any(part in excluded for part in relative.parts):continue
        name=relative.as_posix()
        if name.startswith('email_send/backup/') or name.startswith('email_send/User_Data') or name in ['config/local.php','config/production.example.php','email_send/process_pdf_bup.php','assets/php_function.php']:continue
        if name.startswith('e-sign/e-sign') and name.endswith('.php') and name!='e-sign/e-sign.php':continue
        if name.endswith('.php') or path.suffix.lower() in {'.html','.js','.css','.png','.jpg','.jpeg','.gif','.webp','.svg','.ico'} or name in ['manifest.json','.htaccess','config/.htaccess','e-sign/generated_images/.htaccess']:
            yield name,path.read_bytes()


_STATIC_PHP_INCLUDE=re.compile(r"\b(?:require|include)(?:_once)?\s*(?:\(\s*)?__DIR__\s*\.\s*(['\"])([^'\"]+)\1")


def sync_dependency_plan(ftp, selected, available):
    """Return PHP inputs dependency-first, rejecting missing dependencies before writes."""
    order=[];visited=set();active=[];sources={}

    def visit(name):
        if name in visited:return
        if name in active:raise RuntimeError('PHP include cycle in staging update: '+' -> '.join(active+[name]))
        active.append(name)
        content=available.get(name)
        if content is None:
            # Some runtime files are intentionally not shipped by the source
            # filter. Include their contents in the closure check as well.
            try:content=retrieve(ftp,name)
            except ftplib.error_perm as error:
                if str(error).startswith('550'):
                    raise RuntimeError('Staging sync is missing required PHP dependency: '+name) from None
                raise
        sources[name]=content
        for match in (_STATIC_PHP_INCLUDE.finditer(content.decode('utf-8',errors='replace')) if name.endswith('.php') else []):
            # PHP commonly spells a __DIR__-relative path as __DIR__ . '/file';
            # the leading slash is a separator here, not an absolute path root.
            relative=match.group(2).lstrip('/')
            dependency=posixpath.normpath(posixpath.join(posixpath.dirname(name),relative))
            if dependency in ('.','..') or dependency.startswith('../') or dependency.startswith('/'):
                raise RuntimeError('Invalid PHP dependency path in staging update: '+name)
            visit(dependency)
        active.pop();visited.add(name);order.append(name)

    for name in sorted(selected):visit(name)
    return [(name,sources[name]) for name in order if name in available]


def configure_staging(ftp, database, metadata, *, key_only=False):
    """Provision the private key before publishing code; preserve it on redeploy."""
    if metadata.get('database')!='siyaacth_eoffice_test' or metadata.get('database_host')!='localhost':
        raise RuntimeError('Staging database verification failed')
    private_dir=metadata['document_root'].rsplit('/',1)[0]+'/private/file_document'
    settings={'DB_HOST':'localhost','DB_PORT':'3306','DB_DATABASE':database['database'],'DB_USERNAME':database['user'],'DB_PASSWORD':database['password'],'APP_URL':'https://e-office-test.siya.ac.th','EOFFICE_MOCK_SERVICES':'true','EOFFICE_REMOTE_FILES':'false','EOFFICE_SIGN_ROUTES':'{}','EOFFICE_STORAGE':private_dir}
    ensure_dir(ftp,'config')
    key=secrets.token_hex(32)
    source=protected_php(key)+"""
ini_set('display_errors','0');
$path=__DIR__.'/config/local.php';
$lock=fopen($path.'.member-key.lock','c');
if(!$lock||!chmod($path.'.member-key.lock',0600)||!flock($lock,LOCK_EX))throw new RuntimeException('Staging member-key setup lock unavailable');
try{
if(function_exists('opcache_invalidate'))opcache_invalidate($path,true);
$before=is_file($path)?require $path:[];
if(!is_array($before))throw new RuntimeException('Invalid existing staging configuration');
if(!empty($before['DB_DATABASE'])&&$before['DB_DATABASE']!=='siyaacth_eoffice_test')throw new RuntimeException('Unexpected existing staging database');
$keyOnly=__KEY_ONLY__;
$overrides=__SETTINGS__;$settings=$keyOnly?$before:array_replace($before,$overrides);
// Keep both configured keys, including an existing encryption key. The runtime
// environment has the same precedence as app_env, even when explicitly empty.
$resolve=static function($name)use($settings){$value=getenv($name);return $value!==false?$value:($settings[$name]??'');};
if($keyOnly&&($resolve('DB_DATABASE')!=='siyaacth_eoffice_test'||!filter_var($resolve('EOFFICE_MOCK_SERVICES'),FILTER_VALIDATE_BOOLEAN)))throw new RuntimeException('Targeted sync requires an existing isolated staging configuration; run deploy first');
$encoded=$resolve('EOFFICE_MEMBER_VERSION_KEY');
if($encoded==='')$encoded=$resolve('EOFFICE_SETTINGS_KEY');
$generated=false;
if($encoded===''){
    // An empty dedicated environment override would mask the private file.
    if(getenv('EOFFICE_MEMBER_VERSION_KEY')!==false)throw new RuntimeException('Empty member key environment override masks staging config');
    $settings['EOFFICE_MEMBER_VERSION_KEY']=base64_encode(random_bytes(32));$encoded=$settings['EOFFICE_MEMBER_VERSION_KEY'];$generated=true;
}
if(!is_string($encoded)||($bytes=base64_decode($encoded,true))===false||strlen($bytes)!==32)throw new RuntimeException('Invalid staging member-version key');
$code="<?php\nreturn ".var_export($settings,true).";\n";
$temporary=$path.'.upload-'.bin2hex(random_bytes(12));
try{
    if(file_put_contents($temporary,$code,LOCK_EX)!==strlen($code)||!chmod($temporary,0600))throw new RuntimeException('Private staging config write failed');
    if(!rename($temporary,$path))throw new RuntimeException('Private staging config publication failed');
    if(function_exists('opcache_invalidate'))opcache_invalidate($path,true);
}finally{if(is_file($temporary))unlink($temporary);}
echo json_encode(['member_version_key_ready'=>true,'member_version_key_generated'=>$generated,'existing_private_settings_preserved'=>true]);
}finally{flock($lock,LOCK_UN);fclose($lock);}
""".replace('__SETTINGS__',php_value(settings)).replace('__KEY_ONLY__','true' if key_only else 'false')
    result=invoke_probe(ftp,source,key)
    if result.get('member_version_key_ready') is not True:
        raise RuntimeError('Staging member-version key provisioning failed')
    return result


def verify_member_key(ftp, *, require_runtime=True):
    key=secrets.token_hex(32)
    source=protected_php(key)+"""
ini_set('display_errors','0');
$path=__DIR__.'/config/local.php';
if(function_exists('opcache_invalidate'))opcache_invalidate($path,true);
$settings=is_file($path)?require $path:[];
if(!is_array($settings))throw new RuntimeException('Invalid staging configuration');
$resolve=static function($name)use($settings){$value=getenv($name);return $value!==false?$value:($settings[$name]??'');};
if($resolve('DB_DATABASE')!=='siyaacth_eoffice_test'||!filter_var($resolve('EOFFICE_MOCK_SERVICES'),FILTER_VALIDATE_BOOLEAN))throw new RuntimeException('Unexpected member-key verification target');
$encoded=$resolve('EOFFICE_MEMBER_VERSION_KEY');if($encoded==='')$encoded=$resolve('EOFFICE_SETTINGS_KEY');
if(!is_string($encoded)||($master=base64_decode($encoded,true))===false||strlen($master)!==32)throw new RuntimeException('Invalid staging member-version key');
// Older staging runtimes can safely sync unrelated assets without a member
// upgrade. Do not call a function that has not been deployed yet.
$helper=__DIR__.'/config/member-management.php';
if(is_file($helper)){
    if(function_exists('opcache_invalidate')){
        opcache_invalidate(__DIR__.'/config/bootstrap.php',true);
        opcache_invalidate($helper,true);
    }
    require_once $helper;
}
$available=function_exists('app_member_version_key');
if($available){
    $derived=hash_hmac('sha256','eoffice:member-version:v1',$master,true);
    if(!hash_equals($derived,app_member_version_key()))throw new RuntimeException('Member runtime key does not match private configuration');
}
echo json_encode(['member_version_key_ready'=>true,'member_hmac_runtime_available'=>$available]);
"""
    result=invoke_probe(ftp,source,key)
    if result.get('member_version_key_ready') is not True:raise RuntimeError('Staging member-version runtime check failed')
    if require_runtime and result.get('member_hmac_runtime_available') is not True:
        raise RuntimeError('Staging member HMAC runtime is missing; include config/member-management.php and its dependencies before publishing')
    return result


def deploy(ftp, database):
    metadata=probe(ftp,database)
    if metadata.get('database')!='siyaacth_eoffice_test' or metadata.get('database_host')!='localhost':raise RuntimeError('Staging database verification failed')
    print(json.dumps(backup(ftp)))
    print(json.dumps(database_backup(ftp,database)))
    print(json.dumps(configure_staging(ftp,database,metadata)))
    print(json.dumps(verify_member_key(ftp,require_runtime=False)))
    files=list(deployment_files())
    # Upload application first, root rules last. Each file is renamed atomically.
    files.sort(key=lambda item:(item[0]=='.htaccess',item[0]))
    for index,(name,content) in enumerate(files):
        parent=name.rsplit('/',1)[0] if '/' in name else ''
        if parent:ensure_dir(ftp,parent)
        temporary=name+'.upload-'+secrets.token_hex(6)
        ftp.storbinary('STOR '+temporary,io.BytesIO(content))
        ftp.rename(temporary,name)
        if (index+1)%30==0:print(json.dumps({'uploaded':index+1,'total':len(files)}),flush=True)
    private_dir=metadata['document_root'].rsplit('/',1)[0]+'/private/file_document'
    print(json.dumps(verify_member_key(ftp)))
    print(json.dumps({'uploaded':len(files),'storage':private_dir,'mock_services':True,'config':'config/local.php'}),flush=True)
    key=secrets.token_hex(32)
    source=protected_php(key)+"""
require __DIR__.'/config/bootstrap.php';require __DIR__.'/config/migrations.php';
if(app_settings()['database']!=='siyaacth_eoffice_test'||!app_settings()['mock']){http_response_code(403);exit;}
app_migrate(app_pdo());$dir=app_settings()['storage'];if(!is_dir($dir)&&!mkdir($dir,0750,true))throw new RuntimeException('Private storage unavailable');
echo json_encode(['migrated'=>true,'database'=>app_settings()['database'],'storage_writable'=>is_writable($dir)]);
"""
    print(json.dumps(invoke_probe(ftp,source,key)),flush=True)
    # Keep the old placeholder only in the local backup.
    try:ftp.delete('index.html')
    except ftplib.error_perm:pass
    manifest={'deployed_at':time.strftime('%Y-%m-%dT%H:%M:%S'),'files':{name:hashlib.sha256(content).hexdigest() for name,content in files}}
    ftp.storbinary('STOR config/staging-manifest.json',io.BytesIO(json.dumps(manifest).encode()))
    folder=Path.home()/'AppData/Local/Temp/opencode'
    (folder/'eoffice-staging-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps({'deployed':True,'url':'https://e-office-test.siya.ac.th'}))


def prepare_tests(ftp):
    private_file=Path.home()/'AppData/Local/Temp/opencode/eoffice-staging-qa.private.json'
    if private_file.exists():raise RuntimeError('Finish the existing temporary test helper before creating another')
    key=secrets.token_hex(32)
    password=secrets.token_urlsafe(24)
    name='.qa-'+secrets.token_hex(16)+'.php'
    seed=(ROOT/'tests/seed.php').read_text(encoding='utf-8')
    seed=seed.replace('<?php','',1).replace("if(PHP_SAPI!=='cli')exit;",'').replace("require __DIR__.'/../config/bootstrap.php';",'')
    seed=seed.replace("password_hash('Review-Test-2026!',PASSWORD_DEFAULT)","password_hash("+php_value(password)+",PASSWORD_DEFAULT)")
    rotate="$q=$pdo->prepare('SELECT User_Password FROM t_user WHERE User_Id=?');$q->execute([$id]);if(!password_verify("+php_value(password)+",$q->fetchColumn())){$pdo->prepare('UPDATE t_user SET User_Password=? WHERE User_Id=?')->execute([password_hash("+php_value(password)+",PASSWORD_DEFAULT),$id]);$pdo->prepare('DELETE FROM eoffice_sessions WHERE User_Id=?')->execute([$id]);}\n"
    seed=seed.replace("$ids[$name]=(int)$id;",rotate+"$ids[$name]=(int)$id;")
    inspect=(ROOT/'tests/inspect.php').read_text(encoding='utf-8')
    inspect=inspect.replace('<?php','',1).replace("if(PHP_SAPI!=='cli')exit;",'').replace("require __DIR__.'/../config/bootstrap.php';",'').replace("__DIR__.'/../e-sign/generated_images/'","__DIR__.'/e-sign/generated_images/'")
    worker=(ROOT/'scripts/notifications.php').read_text(encoding='utf-8')
    worker=worker.replace('<?php','',1).replace("if(PHP_SAPI!=='cli'){http_response_code(404);exit;}",'').replace("require __DIR__.'/../config/services.php';",'')
    notifications=(ROOT/'tests/notification-queue.php').read_text(encoding='utf-8').replace('<?php','',1).replace("if(PHP_SAPI!=='cli')exit;",'').replace("require __DIR__.'/../config/services.php';",'')
    source=protected_php(key)+"""
require __DIR__.'/config/services.php';
if(app_settings()['database']!=='siyaacth_eoffice_test'||!app_settings()['mock']){http_response_code(403);exit;}
$request=json_decode(file_get_contents('php://input'),true);$operation=$request['operation']??'';
"""+"if($operation==='seed'){\n"+seed+"\nexit;}\n"+"if($operation==='inspect'){$argv=[null,$request['action']??'', $request['value']??''];\n"+inspect+"\nexit;}\n"+"if($operation==='worker'){\n"+worker+"\nexit;}\n"+"if($operation==='notifications'){\n"+notifications+"\nexit;}\nhttp_response_code(400);"
    ftp.storbinary('STOR '+name,io.BytesIO(source.encode('utf-8')))
    details={'url':'https://e-office-test.siya.ac.th/'+name,'key':key,'remote_file':name,'password':password}
    folder=Path.home()/'AppData/Local/Temp/opencode'
    (folder/'eoffice-staging-qa.private.json').write_text(json.dumps(details),encoding='utf-8')
    (folder/'eoffice-staging-accounts.private.json').write_text(json.dumps({'url':'https://e-office-test.siya.ac.th','admin_email':'qa-admin@siya.ac.th','password':password},indent=2),encoding='utf-8')
    users=helper_request({'operation':'seed'})['users']
    local=retrieve(ftp,'config/local.php').decode('utf-8')
    # Append a mock-only setting without touching DB credentials or environment isolation.
    local=local.rstrip().removesuffix(';')+" + ['EOFFICE_TEST_AI_RECIPIENTS' => '"+json.dumps([users['recipient'],999999])+"'];\n"
    ftp.storbinary('STOR config/local.php',io.BytesIO(local.encode('utf-8')))
    print(json.dumps({'test_accounts_ready':True,'users':users,'temporary_helper_created':True}))


def helper_request(payload):
    details=json.loads((Path.home()/'AppData/Local/Temp/opencode/eoffice-staging-qa.private.json').read_text())
    request=urllib.request.Request(details['url'],data=json.dumps(payload).encode(),headers={'X-Eoffice-Deploy-Token':details['key'],'Content-Type':'application/json'},method='POST')
    with urllib.request.urlopen(request,timeout=90) as response:
        output=response.read().decode('utf-8')
        try:return json.loads(output)
        except json.JSONDecodeError:return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['inspect', 'certificate', 'probe', 'backup', 'deploy', 'prepare-tests', 'test-helper', 'finish-tests', 'sync', 'verify', 'migrate'])
    parser.add_argument('--credentials', default=str(DEFAULT_CREDENTIALS))
    parser.add_argument('--ftp-host', default='ftp.siya.ac.th')
    parser.add_argument('--files', nargs='+', help='Application-relative paths for a targeted staging sync')
    parser.add_argument('helper_action',nargs='?')
    parser.add_argument('helper_value',nargs='?',default='')
    args = parser.parse_args()
    if args.action=='test-helper':
        action=args.helper_action
        payload={'operation':action} if action in ['seed','worker','notifications'] else {'operation':'inspect','action':action,'value':args.helper_value}
        print(json.dumps(helper_request(payload),ensure_ascii=True))
        return
    account, database = credentials(args.credentials)
    if args.action == 'certificate':
        # Diagnostic only: no USER/PASS is sent over this unverified connection.
        ftp = ftplib.FTP_TLS(context=ssl._create_unverified_context(), timeout=20)
        ftp.connect(args.ftp_host or account['host'], account['port'])
        ftp.auth()
        der = ftp.sock.getpeercert(binary_form=True)
        folder = Path.home() / 'AppData/Local/Temp/opencode'
        with tempfile.NamedTemporaryFile(mode='w', suffix='.pem', dir=folder, delete=False) as f:
            f.write(ssl.DER_cert_to_PEM_cert(der))
            filename = f.name
        try:
            decoded = ssl._ssl._test_decode_cert(filename)
            print(json.dumps({'subject': decoded.get('subject'), 'issuer': decoded.get('issuer'), 'SAN': decoded.get('subjectAltName'), 'expires': decoded.get('notAfter'), 'sha256': hashlib.sha256(der).hexdigest()}, indent=2))
        finally:
            Path(filename).unlink()
            ftp.close()
        return
    with connect(account, args.ftp_host) as ftp:
        webroot(ftp)
        if args.action=='verify':
            mismatches=[];count=0
            for name,content in deployment_files():
                if args.files and name not in args.files:continue
                try:actual=retrieve(ftp,name)
                except ftplib.error_perm:mismatches.append(name);continue
                count+=1
                if hashlib.sha256(actual).digest()!=hashlib.sha256(content).digest():mismatches.append(name)
            print(json.dumps({'files_checked':count,'mismatches':mismatches}))
            if mismatches:raise RuntimeError('Deployed release differs from local manifest')
            return
        if args.action=='prepare-tests':
            prepare_tests(ftp)
            return
        if args.action=='finish-tests':
            folder=Path.home()/'AppData/Local/Temp/opencode'
            file=folder/'eoffice-staging-qa.private.json'
            details=json.loads(file.read_text());ftp.delete(details['remote_file']);file.unlink()
            manifest=json.loads(retrieve(ftp,'config/staging-manifest.json').decode('utf-8'))
            manifest['verified_at']=time.strftime('%Y-%m-%dT%H:%M:%S')
            manifest['files']={name:hashlib.sha256(retrieve(ftp,name)).hexdigest() for name in manifest['files']}
            ftp.storbinary('STOR config/staging-manifest.json',io.BytesIO(json.dumps(manifest).encode()))
            (folder/'eoffice-staging-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
            unexpected=[name for name,facts in ftp.mlsd() if name.startswith(('.qa-','.deploy-'))]
            if unexpected:raise RuntimeError('Temporary deployment files remain')
            print(json.dumps({'temporary_helper_removed':True,'temporary_files_remaining':0,'release_manifest_updated':True}))
            return
        if args.action=='sync':
            selected=set(args.files or [])
            files=dict(deployment_files())
            available=set(files)
            if selected-available:raise RuntimeError('Unknown deployment file paths')
            publish=selected or available
            # Complete and validate the dependency closure before modifying the
            # private config, application files, or release manifest.
            plan=sync_dependency_plan(ftp,publish,files)
            # Sync is an application-code update, even without --files. Only a
            # full deploy may replace the site's standard runtime settings.
            print(json.dumps(configure_staging(ftp,database,probe(ftp,database),key_only=True)))
            before=verify_member_key(ftp,require_runtime=False)
            print(json.dumps(before))
            require_runtime=not selected or 'config/member-management.php' in {name for name,_ in plan} or before.get('member_hmac_runtime_available') is True
            for name,content in plan:
                if '/' in name:ensure_dir(ftp,name.rsplit('/',1)[0])
                temporary=name+'.upload-'+secrets.token_hex(6)
                ftp.storbinary('STOR '+temporary,io.BytesIO(content))
                ftp.rename(temporary,name)
            print(json.dumps(verify_member_key(ftp,require_runtime=require_runtime)))
            if selected:
                manifest=json.loads(retrieve(ftp,'config/staging-manifest.json').decode('utf-8'))
                manifest['updated_at']=time.strftime('%Y-%m-%dT%H:%M:%S')
                for name,_ in plan:manifest['files'][name]=hashlib.sha256(retrieve(ftp,name)).hexdigest()
            else:
                manifest={'deployed_at':time.strftime('%Y-%m-%dT%H:%M:%S'),'files':{name:hashlib.sha256(retrieve(ftp,name)).hexdigest() for name,_ in deployment_files()}}
            ftp.storbinary('STOR config/staging-manifest.json',io.BytesIO(json.dumps(manifest).encode()))
            folder=Path.home()/'AppData/Local/Temp/opencode'
            (folder/'eoffice-staging-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
            print(json.dumps({'application_synced':True}))
            return
        if args.action=='migrate':
            key=secrets.token_hex(32)
            source=protected_php(key)+"require __DIR__.'/config/bootstrap.php';require __DIR__.'/config/migrations.php';if(app_settings()['database']!=='siyaacth_eoffice_test'||!app_settings()['mock']){http_response_code(403);exit;}app_migrate(app_pdo());echo json_encode(['migrated'=>true,'database'=>app_settings()['database']]);"
            print(json.dumps(invoke_probe(ftp,source,key)))
            return
        if args.action=='deploy':
            deploy(ftp,database)
            return
        if args.action == 'probe':
            result = probe(ftp, database)
            print(json.dumps({k: v for k, v in result.items() if k != 'schema'}, ensure_ascii=True, indent=2))
            return
        if args.action == 'backup':
            print(json.dumps(backup(ftp), indent=2))
            return
        entries = list(ftp.mlsd())
        if any(name == 'public_html' and facts.get('type') == 'dir' for name, facts in entries):
            ftp.cwd('public_html')
            entries = list(ftp.mlsd())
        print(json.dumps({'transport': 'FTPS', 'directory': ftp.pwd(), 'entries': [{'name': name, 'type': facts.get('type'), 'size': facts.get('size')} for name, facts in entries if name not in ['.', '..']], 'staging_database': database['database']}, ensure_ascii=True, indent=2))
        for filename in ['config/config.php', 'config/local.php', 'room_booking/api/config_roombooking.php']:
            try:
                source = retrieve(ftp, filename).decode('utf-8-sig', errors='replace')
                # Report host/database/port only. Never print source or passwords.
                hosts = re.findall(r"\$(?:host|serverName)\s*=\s*['\"]([^'\"]+)['\"]", source)
                databases = re.findall(r"\$(?:database|dbName)\s*=\s*['\"]([^'\"]+)['\"]", source)
                print(json.dumps({'file': filename, 'hosts': hosts, 'databases': databases, 'bytes': len(source)}, ensure_ascii=True))
            except ftplib.error_perm:
                print(json.dumps({'file': filename, 'exists': False}))


if __name__ == '__main__':
    main()
