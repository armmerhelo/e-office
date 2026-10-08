"""Targeted AMSS release: verified FTPS, backup, atomic upload and real API smoke."""
import argparse
import hashlib
import importlib.util
import io
import json
import secrets
import subprocess
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

spec = importlib.util.spec_from_file_location('production', Path(__file__).with_name('production-hosting.py'))
production = importlib.util.module_from_spec(spec)
spec.loader.exec_module(production)
ROOT = production.hosting.ROOT
TEMP = production.TEMP
FILES = ['config/amss-links.php', 'api/create_document.php']
META = TEMP / 'eoffice-amss-release.private.json'


def sha(content):
    return hashlib.sha256(content).hexdigest()


def committed(name):
    return subprocess.check_output(['git', 'show', 'HEAD:' + name], cwd=ROOT)


def invoke(ftp, body):
    key = secrets.token_hex(32)
    account, _ = production.credentials()
    with production.hosting.connect(account, 'ftp.siya.ac.th') as fresh:
        production.hosting.webroot(fresh)
        return production.invoke(fresh, production.php(key) + '\n' + body, key)


def optional(ftp, name):
    try:
        return production.hosting.retrieve(ftp, name)
    except production.hosting.ftplib.error_perm as error:
        if str(error).startswith('550'):
            return None
        raise


def atomic(name, content):
    account, _ = production.credentials()
    temporary = name + '.upload-' + secrets.token_hex(8)
    try:
        for attempt in range(3):
            try:
                with production.hosting.connect(account, 'ftp.siya.ac.th') as fresh:
                    production.hosting.webroot(fresh)
                    if optional(fresh, temporary) != content:
                        fresh.storbinary('STOR ' + temporary, io.BytesIO(content))
                    if production.hosting.retrieve(fresh, temporary) != content:
                        raise RuntimeError('Staged checksum mismatch: ' + name)
                    fresh.rename(temporary, name)
                    if production.hosting.retrieve(fresh, name) != content:
                        raise RuntimeError('Installed checksum mismatch: ' + name)
                    return
            except (OSError, EOFError, production.hosting.ftplib.error_temp):
                if attempt == 2:
                    raise
                time.sleep(1)
    finally:
        with production.hosting.connect(account, 'ftp.siya.ac.th') as fresh:
            production.hosting.webroot(fresh)
            try:
                fresh.delete(temporary)
            except production.hosting.ftplib.error_perm:
                pass


def without_order_feature(source):
    # Preserve the deployed order integration, but verify all other API bytes
    # against the committed base before merging this narrowly scoped patch.
    source = source.replace("require_once __DIR__.'/../config/order-emails.php';", "require_once __DIR__.'/../config/services.php';")
    source = source.replace(' $orderSettings=app_order_settings(!$edit);\n', '')
    source = source.replace(' app_order_saved($id,!$edit,$type,$orderSettings);\n', '')
    source = source.replace("  foreach($recipients as $recipient){$q->execute([$recipient,$id]);if($q->rowCount()===1){$payload=['type'=>'document_notification','user_id'=>$recipient,'doc_id'=>$id];if($type==='External'&&((!$edit&&$orderSettings['activated_at']!==null)||app_order_job($id)))$payload['delivery']=['mail'=>['status'=>'skipped','attempts'=>0]];app_queue($payload);}}",
        "  foreach($recipients as $recipient){$q->execute([$recipient,$id]);if($q->rowCount()===1)app_queue(['type'=>'document_notification','user_id'=>$recipient,'doc_id'=>$id]);}")
    return source


def merged_api(remote):
    local = committed('api/create_document.php').decode()
    remote = remote.decode().replace('\r\n', '\n')
    if 'config/amss-links.php' not in local:
        raise RuntimeError('AMSS API must be committed before deployment')
    base = without_order_feature(local)
    # Permit follow-up AMSS hotfixes only over an exact, known committed API.
    # The initial tool only handled first installation and rejected updates to
    # an API that already imported AMSS. Unknown production changes still stop.
    known = {base}
    revisions = subprocess.check_output(['git','log','-20','--format=%H','--','api/create_document.php'],cwd=ROOT,text=True).splitlines()
    for revision in revisions:
        previous = subprocess.check_output(['git','show',revision+':api/create_document.php'],cwd=ROOT).decode().replace('\r\n','\n')
        known.add(without_order_feature(previous))
    if without_order_feature(remote) not in known:
        raise RuntimeError('Production document API differs beyond known order integration')
    merged = base
    if 'config/order-emails.php' in remote:
        merged = merged.replace("require_once __DIR__.'/../config/services.php';", "require_once __DIR__.'/../config/order-emails.php';", 1)
        if merged.count(' $values=') != 1 or merged.count(' $pdo->commit();') != 1:
            raise RuntimeError('Unknown document save layout')
        merged = merged.replace(' $values=', ' $orderSettings=app_order_settings(!$edit);\n $values=', 1)
        merged = merged.replace(' $pdo->commit();', ' app_order_saved($id,!$edit,$type,$orderSettings);\n $pdo->commit();', 1)
        merged = merged.replace("  foreach($recipients as $recipient){$q->execute([$recipient,$id]);if($q->rowCount()===1)app_queue(['type'=>'document_notification','user_id'=>$recipient,'doc_id'=>$id]);}",
            "  foreach($recipients as $recipient){$q->execute([$recipient,$id]);if($q->rowCount()===1){$payload=['type'=>'document_notification','user_id'=>$recipient,'doc_id'=>$id];if($type==='External'&&((!$edit&&$orderSettings['activated_at']!==null)||app_order_job($id)))$payload['delivery']=['mail'=>['status'=>'skipped','attempts'=>0]];app_queue($payload);}}", 1)
    if without_order_feature(merged) != base:
        raise RuntimeError('Order integration merge failed')
    return merged.encode()


def inspect(ftp):
    api = production.hosting.retrieve(ftp, 'api/create_document.php')
    module = optional(ftp, 'config/amss-links.php')
    return {'url':production.URL, 'api_sha256':sha(api), 'amss_installed':b'config/amss-links.php' in api,
        'api_matches_worktree':api == (ROOT / 'api/create_document.php').read_bytes(),
        'module_matches_worktree':module == (ROOT / 'config/amss-links.php').read_bytes(),
        'order_integration_installed':b'config/order-emails.php' in api,
        'temporary_release_helpers':sum(name.startswith('.release-') for name, _ in ftp.mlsd())}


def deploy(ftp):
    api = production.hosting.retrieve(ftp, 'api/create_document.php')
    release = {'config/amss-links.php':committed('config/amss-links.php'), 'api/create_document.php':merged_api(api)}
    before = {name:optional(ftp, name) for name in FILES + ['config/production-manifest.json']}
    backup = TEMP / ('eoffice-amss-before-' + time.strftime('%Y%m%d-%H%M%S') + '.tar.gz')
    with tarfile.open(backup, 'w:gz') as archive:
        for name, content in before.items():
            if content is not None:
                entry = tarfile.TarInfo(name); entry.size = len(content)
                archive.addfile(entry, io.BytesIO(content))
    metadata = {'backup':str(backup), 'backup_sha256':sha(backup.read_bytes()),
        'new_paths':[name for name, content in before.items() if content is None],
        'commit':subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'files':{name:sha(content) for name, content in release.items()}}
    META.write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    if production.hosting.retrieve(ftp, 'api/create_document.php') != api:
        raise RuntimeError('Production API changed during backup')
    for name, content in release.items():
        atomic(name, content)
    result = invoke(ftp, """
require __DIR__.'/config/bootstrap.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock'])throw new RuntimeException('Wrong target');
foreach(['config/amss-links.php','api/create_document.php'] as $name)if(function_exists('opcache_invalidate'))opcache_invalidate(__DIR__.'/'.$name,true);
require __DIR__.'/config/amss-links.php';
$bytes=app_amss_download_pdf('https://amss.sesact.go.th/modules/bookregister/upload_files2/1769410561x2033142038_1.pdf');
echo json_encode(['production_download'=>true,'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes)]);
""")
    if not result.get('production_download'):
        raise RuntimeError('Production AMSS download failed')
    manifest = json.loads(before['config/production-manifest.json'] or b'{"files":{}}')
    manifest['files'].update(metadata['files']); manifest['updated_at'] = time.strftime('%Y-%m-%dT%H:%M:%S')
    atomic('config/production-manifest.json', json.dumps(manifest).encode())
    (TEMP / 'eoffice-production-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return {'deployed_files':len(release), **metadata, **result}


def verify(ftp):
    metadata = json.loads(META.read_text())
    mismatch = [name for name, digest in metadata['files'].items() if sha(production.hosting.retrieve(ftp, name)) != digest]
    if mismatch:
        raise RuntimeError('Production checksum mismatch: ' + ','.join(mismatch))
    return {'files_verified':len(metadata['files']), 'mismatches':mismatch, **inspect(ftp)}


def rollback(ftp):
    metadata = json.loads(META.read_text()); backup = Path(metadata['backup'])
    if sha(backup.read_bytes()) != metadata['backup_sha256']:
        raise RuntimeError('Backup integrity mismatch')
    with tarfile.open(backup, 'r:gz') as archive:
        for name in ['api/create_document.php', 'config/amss-links.php', 'config/production-manifest.json']:
            if name in metadata['new_paths']:
                try:
                    ftp.delete(name)
                except production.hosting.ftplib.error_perm:
                    pass
            else:
                atomic(name, archive.extractfile(name).read())
    invoke(ftp, "foreach(['api/create_document.php','config/amss-links.php'] as $name)if(function_exists('opcache_invalidate'))opcache_invalidate(__DIR__.'/'.$name,true);echo json_encode(['cache_invalidated'=>true]);")
    return {'rolled_back':True, 'backup':str(backup)}


def cleanup_smoke(ftp, record):
    return invoke(ftp, """
require __DIR__.'/config/bootstrap.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock'])throw new RuntimeException('Wrong target');
$record=__RECORD__;$pdo=app_pdo();$pdo->beginTransaction();$paths=[];
try{
$q=$pdo->prepare('SELECT User_Id FROM t_user WHERE User_Id=? AND User_Email=? FOR UPDATE');$q->execute([$record['user_id'],$record['email']]);
if($q->fetchColumn()){
$q=$pdo->prepare('SELECT * FROM t_document WHERE User_Id=? AND Doc_Number LIKE ? FOR UPDATE');$q->execute([$record['user_id'],$record['prefix'].'%']);
foreach($q->fetchAll() as $doc){
$files=$pdo->prepare('SELECT Doc_Upload_Path FROM t_document_upload WHERE Doc_File_Link=?');$files->execute([$doc['Doc_File_Link']]);foreach($files->fetchAll(PDO::FETCH_COLUMN) as $name)$paths[]=app_storage('original',$doc['Doc_Year'],$name);
$pdo->prepare('DELETE FROM t_document_upload WHERE Doc_File_Link=?')->execute([$doc['Doc_File_Link']]);
foreach(['t_access_rights','t_access_rights_department','eoffice_access_history'] as $table)$pdo->prepare('DELETE FROM '.$table.' WHERE Doc_Id=?')->execute([$doc['Doc_Id']]);
$pdo->prepare('DELETE FROM t_document WHERE Doc_Id=?')->execute([$doc['Doc_Id']]);
}
$pdo->prepare('DELETE FROM eoffice_sessions WHERE User_Id=?')->execute([$record['user_id']]);$pdo->prepare('DELETE FROM t_user WHERE User_Id=?')->execute([$record['user_id']]);
}
$pdo->commit();foreach($paths as $path)if(is_file($path)&&!unlink($path))throw new RuntimeException('Smoke file cleanup failed');
echo json_encode(['smoke_cleanup'=>true,'files_removed'=>count($paths)]);
}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
""".replace('__RECORD__', production.hosting.php_value(record)))


def smoke(ftp):
    prefix = 'AMSS-SMOKE-' + secrets.token_hex(10)
    record = invoke(ftp, """
require __DIR__.'/config/bootstrap.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock'])throw new RuntimeException('Wrong target');
$prefix=__PREFIX__;$email=strtolower($prefix).'@example.test';$pdo=app_pdo();$pdo->beginTransaction();
try{$pdo->prepare('INSERT INTO t_user (User_Name,User_Email,User_Password,User_Status,User_Token) VALUES (?,?,?,?,?)')->execute(['AMSS release smoke',$email,password_hash(bin2hex(random_bytes(32)),PASSWORD_DEFAULT),'User',bin2hex(random_bytes(32))]);$id=(int)$pdo->lastInsertId();$token=bin2hex(random_bytes(32));
$pdo->prepare('INSERT INTO eoffice_sessions (token_hash,User_Id,expires_at) VALUES (?,?,?)')->execute([hash('sha256',$token),$id,date('Y-m-d H:i:s',time()+900)]);$pdo->commit();
echo json_encode(['user_id'=>$id,'email'=>$email,'prefix'=>$prefix,'cookie'=>'User_Token='.$token]);}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
""".replace('__PREFIX__', production.hosting.php_value(prefix)))
    private = TEMP / 'eoffice-amss-smoke.private.json'; private.write_text(json.dumps(record), encoding='utf-8')
    url = 'https://amss.sesact.go.th/modules/bookregister/upload_files2/1769410561x2033142038_1.pdf'
    results = []

    def request(route, values=None, status=200, cookie=True):
        time.sleep(2)
        headers = {'Origin':production.URL, **({'Cookie':record['cookie']} if cookie else {})}
        data = urllib.parse.urlencode(values).encode() if values is not None else None
        req = urllib.request.Request(production.URL + route, data=data, headers=headers)
        try:
            response = urllib.request.urlopen(req, timeout=90)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read()
            if response.status != status:
                raise RuntimeError('Smoke HTTP status mismatch: ' + route + ' ' + str(response.status))
            if b'One moment, please' in body:
                raise RuntimeError('Hosting challenge blocked smoke check')
            return body, response.headers

    def snapshot():
        return invoke(ftp, """
require __DIR__.'/config/bootstrap.php';$q=app_pdo()->prepare('SELECT d.Doc_Id,d.Doc_Name,d.Doc_Url,u.Doc_Upload_Path,u.Doc_Upload_Detail FROM t_document d LEFT JOIN t_document_upload u ON u.Doc_File_Link=d.Doc_File_Link WHERE d.User_Id=? AND d.Doc_Number LIKE ? ORDER BY d.Doc_Id,u.Doc_Upload_Id');$q->execute(__VALUES__);echo json_encode(['rows'=>$q->fetchAll()]);
""".replace('__VALUES__', production.hosting.php_value([record['user_id'], prefix + '%'])))['rows']

    values = {'doc_number':prefix, 'doc_name':'AMSS release smoke', 'doc_type':'หนังสือ',
        'doc_date_receive':time.strftime('%Y-%m-%d'), 'doc_url[0]':url, 'doc_url_name[0]':'Imported AMSS PDF'}
    try:
        body, _ = request('/api/create_document.php', values); saved = json.loads(body)
        if saved.get('status') != 'success':
            raise RuntimeError('AMSS save failed')
        rows = snapshot()
        if len(rows) != 1 or json.loads(rows[0]['Doc_Url']) != [] or rows[0]['Doc_Upload_Detail'] != 'Imported AMSS PDF':
            raise RuntimeError('Imported file binding mismatch')
        doc = saved['doc_id']; name = rows[0]['Doc_Upload_Path']; results.append('AMSS link-only create/import')
        route = '/api/view_file.php?' + urllib.parse.urlencode({'Doc_Id':doc, 'File_Path':name})
        body, headers = request(route)
        if not body.startswith(b'%PDF-') or not headers.get('X-Document-Revision') or 'application/pdf' not in headers.get('Content-Type', ''):
            raise RuntimeError('Imported PDF response invalid')
        results.append('PDF bytes, MIME and revision')
        request(route, status=401, cookie=False); results.append('guest access denied')
        edit = {key:value for key, value in values.items() if not key.startswith('doc_url')}
        edit.update({'formtype':'edit_document', 'doc_id':doc, 'doc_name':'AMSS smoke edited'})
        request('/api/create_document.php', edit)
        before = snapshot()
        if len(before) != 1 or before[0]['Doc_Upload_Path'] != name:
            raise RuntimeError('Edit duplicated or removed imported PDF')
        results.append('edit preserves PDF without duplication')
        failed = {**edit, 'replace_files':'1', 'doc_name':'Must roll back',
            'doc_url[0]':'https://amss.sesact.go.th/modules/bookregister/upload_files2/eoffice-nonexistent-test.pdf', 'doc_url_name[0]':'Missing PDF'}
        request('/api/create_document.php', failed, status=422)
        if snapshot() != before:
            raise RuntimeError('Failed download changed saved document')
        request(route); results.append('failed download rolls back document and attachments')
        return {'production_smoke_passed':len(results), 'checks':results}
    finally:
        cleanup = cleanup_smoke(ftp, record)
        private.write_text(json.dumps({**record, **cleanup}), encoding='utf-8')
        if not cleanup.get('smoke_cleanup'):
            raise RuntimeError('Smoke cleanup failed')


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['inspect', 'deploy', 'verify', 'smoke', 'cleanup-smoke', 'rollback']); args = parser.parse_args()
    account, _ = production.credentials()
    with production.hosting.connect(account, 'ftp.siya.ac.th') as ftp:
        production.hosting.webroot(ftp)
        if args.action == 'cleanup-smoke':
            result = cleanup_smoke(ftp, json.loads((TEMP / 'eoffice-amss-smoke.private.json').read_text()))
        else:
            result = globals()[args.action](ftp)
        print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
