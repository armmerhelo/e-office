"""Prepare a private Apps Script handoff; configure only after signed health."""
import argparse,importlib.util,json,os,re,secrets
from pathlib import Path
spec=importlib.util.spec_from_file_location('production',Path(__file__).with_name('production-hosting.py'))
production=importlib.util.module_from_spec(spec);spec.loader.exec_module(production)
STATE=production.hosting.ROOT/'backups'/'keys'/'drive-appscript-setup.private.json'
def prepare(ftp,legacy_root_id=None):
    original=production.hosting.ROOT/'appscript.gs'
    saved=json.loads(STATE.read_text(encoding='utf-8')) if STATE.exists() else None
    match=re.search(r'CUSTOM_ROOT_FOLDER_ID\s*=.*?["\']([A-Za-z0-9_-]{20,})["\']\s*;',original.read_text(encoding='utf-8')) if original.exists() else None
    root=legacy_root_id or (match.group(1) if match else None) or (saved['script_properties']['EOFFICE_LEGACY_ROOT_ID'] if saved else None)
    if not root or not re.fullmatch(r'[A-Za-z0-9_-]{10,255}',root):raise RuntimeError('Original legacy folder ID required; supply --legacy-root-id')
    key=secrets.token_hex(32)
    source=production.php(key)+"require __DIR__.'/config/bootstrap.php';echo json_encode(['url'=>app_env('DRIVE_APPS_SCRIPT_URL'),'archive_secret'=>app_env('EOFFICE_DRIVE_ARCHIVE_SECRET')]);"
    current=production.invoke(ftp,source,key)
    if STATE.exists():
        data=json.loads(STATE.read_text(encoding='utf-8'))
        if data['url']!=current['url'] or data['script_properties']['EOFFICE_LEGACY_ROOT_ID']!=root:raise RuntimeError('Existing private setup does not match current site')
    else:
        secret=current['archive_secret'] or secrets.token_hex(32)
        if not re.fullmatch(r'[a-f0-9]{64}',secret):raise RuntimeError('Archive shared secret invalid')
        data={'url':current['url'],'script_properties':{'EOFFICE_LEGACY_ROOT_ID':root,'EOFFICE_ARCHIVE_ROOT_ID':'<private sibling archive folder ID>','EOFFICE_ARCHIVE_SECRET':secret},'encryption_key_shared_with_script':False}
        STATE.parent.mkdir(parents=True,exist_ok=True);STATE.write_text(json.dumps(data,indent=2),encoding='utf-8');os.chmod(STATE,0o600)
    print(json.dumps({'private_settings_file':str(STATE),'uses_existing_deployment':True,'encryption_key_shared_with_script':False,'production_enabled':False}))
def configure(ftp):
    data=json.loads(STATE.read_text(encoding='utf-8'));url=data['url'];secret=data['script_properties']['EOFFICE_ARCHIVE_SECRET'];key=secrets.token_hex(32)
    # Validate the candidate deployment while keeping all settings local to this
    # helper process. A failed health response never writes production config.
    source=production.php(key)+f"""
ini_set('zend.exception_ignore_args','1');putenv('EOFFICE_DRIVE_ARCHIVE_URL='.{production.hosting.php_value(url)});putenv('EOFFICE_DRIVE_ARCHIVE_SECRET='.{production.hosting.php_value(secret)});
require __DIR__.'/config/drive-archive-client.php';$health=app_drive_archive_call(['action'=>'health']);
if(($health['protocol']??null)!==1||($health['private_storage']??false)!==true)throw new RuntimeException('Compatible private archive bridge required');
$path=__DIR__.'/config/local.php';$before=file_get_contents($path);$settings=require $path;
if(app_settings()['database']!=='siyaacth_eoffice'||!is_array($settings))throw new RuntimeException('Unexpected production config');
if(filter_var($settings['EOFFICE_DRIVE_ARCHIVE_ENABLED']??'false',FILTER_VALIDATE_BOOLEAN)||filter_var($settings['EOFFICE_DRIVE_EVICT_ENABLED']??'false',FILTER_VALIDATE_BOOLEAN))throw new RuntimeException('Existing active configuration requires explicit review');
$settings['EOFFICE_DRIVE_ARCHIVE_URL']={production.hosting.php_value(url)};$settings['EOFFICE_DRIVE_ARCHIVE_SECRET']={production.hosting.php_value(secret)};
$settings['EOFFICE_DRIVE_ARCHIVE_ENABLED']='false';$settings['EOFFICE_DRIVE_EVICT_ENABLED']='false';
$temporary=$path.'.archive-'.bin2hex(random_bytes(8));$code="<?php\\nreturn ".var_export($settings,true).";\\n";umask(0077);
try{{if(file_put_contents($temporary,$code)!==strlen($code)||!chmod($temporary,0600))throw new RuntimeException('Configuration preparation failed');if(file_get_contents($path)!==$before)throw new RuntimeException('Configuration changed concurrently');if(!rename($temporary,$path))throw new RuntimeException('Config publication failed');if(function_exists('opcache_invalidate'))opcache_invalidate($path,true);}}finally{{if(is_file($temporary))unlink($temporary);}}
echo json_encode(['bridge_health'=>true,'configured'=>true,'enabled'=>false,'eviction_enabled'=>false]);
"""
    print(json.dumps(production.invoke(ftp,source,key)))
def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['prepare','configure']);parser.add_argument('--legacy-root-id');args=parser.parse_args()
    account,_=production.credentials()
    with production.hosting.connect(account,'ftp.siya.ac.th') as ftp:
        production.hosting.webroot(ftp)
        if args.action=='prepare':prepare(ftp,args.legacy_root_id)
        else:configure(ftp)
if __name__=='__main__':
    try:main()
    except Exception as error:raise SystemExit('Apps Script setup failed ('+type(error).__name__+'); private settings were not printed') from None
