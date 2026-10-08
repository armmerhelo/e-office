"""Targeted member-permissions release with private backup and synthetic HTTP QA."""
import argparse
import hashlib
import http.cookiejar
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
ROOT, TEMP = production.hosting.ROOT, production.TEMP
STATE = TEMP / 'eoffice-members-release.private.json'
SMOKE = TEMP / 'eoffice-members-smoke.private.json'
SOURCE_COMMIT = None
FILES = [
    'config/permissions.php', 'config/member-management.php', 'management/save_user_status_api.php', 'config/bootstrap.php',
    'api/me.php', 'management/get_users_api.php', 'management/get_user_departments_api.php',
    'management/new_user_api.php', 'management/update_user_api.php', 'management/delete_user_api.php',
    'management/get_departments_api.php', 'management/save_department_api.php',
    'management/delete_department_api.php', 'management/save_user_permissions_api.php',
    'assets/member-management.js', 'assets/main.js', 'room_booking/edit_room_booking.html',
    'management/user_manage.html',
]


def digest(content):
    return hashlib.sha256(content).hexdigest()


def release_content(name):
    if SOURCE_COMMIT:
        return subprocess.run(['git','show',SOURCE_COMMIT+':'+name],cwd=ROOT,capture_output=True,check=True).stdout
    return (ROOT/name).read_bytes()


def invoke(ftp, body):
    return invoke_raw("""
require __DIR__.'/config/bootstrap.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock'])throw new RuntimeException('Unexpected production target');
""" + body)


def invoke_raw(body):
    key = secrets.token_hex(32)
    account, _ = production.credentials()
    with production.hosting.connect(account, 'ftp.siya.ac.th') as fresh:
        production.hosting.webroot(fresh)
        return production.invoke(fresh, production.php(key) + '\n' + body, key)


def upload(name, content):
    account, _ = production.credentials()
    temporary = name + '.upload-' + secrets.token_hex(6)
    for attempt in range(3):
        try:
            with production.hosting.connect(account, 'ftp.siya.ac.th') as fresh:
                production.hosting.webroot(fresh)
                existing = retrieve_optional(fresh, temporary)
                if existing != content:
                    fresh.storbinary('STOR ' + temporary, io.BytesIO(content))
                    if production.hosting.retrieve(fresh, temporary) != content:
                        raise RuntimeError('Staged checksum mismatch: ' + name)
                fresh.rename(temporary, name)
                if production.hosting.retrieve(fresh, name) != content:
                    raise RuntimeError('Published checksum mismatch: ' + name)
                return
        except (OSError, EOFError, production.hosting.ftplib.error_temp) as error:
            print(json.dumps({'path': name, 'retry': attempt + 1, 'error_class': type(error).__name__}), flush=True)
            if attempt == 2:
                raise
            time.sleep(1)


def retrieve_optional(ftp, name):
    try:
        return production.hosting.retrieve(ftp, name)
    except production.hosting.ftplib.error_perm as error:
        if not str(error).startswith('550'):
            raise
        return None


def inspect(ftp):
    result = invoke(ftp, """
$pdo=app_pdo();$result=['php'=>PHP_VERSION,'database'=>app_settings()['database'],'permissions_table'=>(bool)$pdo->query("SHOW TABLES LIKE 'eoffice_permissions'")->fetchColumn(),
'admin_count'=>(int)$pdo->query("SELECT COUNT(*) FROM t_user WHERE User_Status='Admin'")->fetchColumn(),'counts'=>[]];
foreach(['t_user','t_document','eoffice_permissions','t_department','room_bookings','maintenance_requests'] as $table)$result['counts'][$table]=(int)$pdo->query('SELECT COUNT(*) FROM '.$table)->fetchColumn();
$result['registry_present']=function_exists('app_permission_catalog');echo json_encode($result);
""")
    paths = []
    for name in FILES:
        content = retrieve_optional(ftp, name)
        local = release_content(name)
        head = subprocess.run(['git', 'show', 'HEAD:' + name], cwd=ROOT, capture_output=True)
        normalize = lambda data: data.replace(b'\r\n', b'\n')
        previous = json.loads(STATE.read_text()).get('release', {}) if STATE.exists() else {}
        kind = 'new' if content is None else 'current' if normalize(content) == normalize(local) else 'previous_release' if digest(content) == previous.get(name) else 'head' if head.returncode == 0 and normalize(content) == normalize(head.stdout) else 'different'
        paths.append({'path': name, 'status': kind, 'remote_sha256': digest(content) if content is not None else None})
        if kind == 'different':
            folder = TEMP / 'eoffice-members-inspected' / Path(name).parent
            folder.mkdir(parents=True, exist_ok=True)
            (folder / Path(name).name).write_bytes(content)
    result['paths'] = paths
    return result


def backup(ftp):
    inspection = inspect(ftp)
    if not inspection['permissions_table'] or not inspection['admin_count']:
        raise RuntimeError('Existing permissions and Admin required')
    different = [item['path'] for item in inspection['paths'] if item['status'] == 'different']
    if different:
        raise RuntimeError('Inspect production differences before publishing: ' + ', '.join(different))
    destination = TEMP / ('eoffice-members-before-' + time.strftime('%Y%m%d-%H%M%S') + '.tar.gz')
    remote = {}
    with tarfile.open(destination, 'w:gz') as archive:
        for name in FILES:
            content = retrieve_optional(ftp, name)
            remote[name] = digest(content) if content is not None else None
            if content is None:
                continue
            entry = tarfile.TarInfo(name)
            entry.size = len(content)
            archive.addfile(entry, io.BytesIO(content))
    manifest=json.loads(production.hosting.retrieve(ftp,'config/production-manifest.json'))
    state = {'backup': str(destination), 'backup_sha256': digest(destination.read_bytes()), 'before': remote,'before_member_release_commit':manifest.get('member_release_commit'),
             'release': {name: digest(release_content(name)) for name in FILES}, 'inspection': inspection,'source_commit':SOURCE_COMMIT}
    STATE.write_text(json.dumps(state, indent=2), encoding='utf-8')
    return {'backup': str(destination), 'sha256': state['backup_sha256'], 'existing_files': sum(value is not None for value in remote.values()), 'new_files': sum(value is None for value in remote.values())}


def state_checked():
    state = json.loads(STATE.read_text())
    if digest(Path(state['backup']).read_bytes()) != state['backup_sha256']:
        raise RuntimeError('Rollback archive integrity mismatch')
    return state


def deploy(ftp):
    state = state_checked()
    if state.get('source_commit') != SOURCE_COMMIT:
        raise RuntimeError('Release source does not match the backup plan')
    for name in FILES:
        if digest(release_content(name)) != state['release'][name]:
            raise RuntimeError('Local source changed since backup: ' + name)
        content = retrieve_optional(ftp, name)
        if (digest(content) if content is not None else None) != state['before'][name]:
            raise RuntimeError('Production changed since backup: ' + name)
    for name in FILES:
        upload(name, release_content(name))
        print(json.dumps({'published': name}), flush=True)
    runtime = invoke_raw("""
foreach(__FILES__ as $name)if(function_exists('opcache_invalidate'))opcache_invalidate(__DIR__.'/'.$name,true);
require __DIR__.'/config/bootstrap.php';
if(app_settings()['database']!=='siyaacth_eoffice'||app_settings()['mock'])throw new RuntimeException('Unexpected production target');
echo json_encode(['permissions'=>array_keys(app_permission_catalog()),'schema_changed'=>false]);
""".replace('__FILES__', production.hosting.php_value(FILES)))
    manifest = json.loads(production.hosting.retrieve(ftp, 'config/production-manifest.json'))
    manifest['files'].update(state['release'])
    manifest['updated_at'] = time.strftime('%Y-%m-%dT%H:%M:%S')
    manifest['member_release_commit'] = SOURCE_COMMIT
    upload('config/production-manifest.json', json.dumps(manifest).encode())
    (TEMP / 'eoffice-production-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    state['deployed_at'] = manifest['updated_at']
    STATE.write_text(json.dumps(state, indent=2), encoding='utf-8')
    return {'published_files': len(FILES),'source_commit':SOURCE_COMMIT, **runtime}


def verify(ftp):
    state = state_checked()
    if SOURCE_COMMIT and (state.get('source_commit')!=SOURCE_COMMIT or any(digest(release_content(name))!=state['release'][name] for name in FILES)):
        raise RuntimeError('Verification source differs from the published commit')
    mismatches = [name for name in FILES if digest(production.hosting.retrieve(ftp, name)) != state['release'][name]]
    leftovers = []
    for directory in ['config', 'api', 'management', 'assets', 'room_booking']:
        targets = {Path(name).name for name in FILES if Path(name).parent.as_posix() == directory}
        leftovers += [directory + '/' + name for name, facts in ftp.mlsd(directory) if '.upload-' in name and name.split('.upload-', 1)[0] in targets]
    if mismatches or leftovers:
        raise RuntimeError('Release verification failed: ' + repr({'mismatches': mismatches, 'staged': leftovers}))
    helpers = [name for name, facts in ftp.mlsd() if name.startswith('.release-')]
    if helpers:
        raise RuntimeError('Temporary deployment helpers remain')
    return {'checked_files': len(FILES),'source_commit':state.get('source_commit'), 'mismatches': mismatches, 'staged_files_remaining': len(leftovers), 'temporary_helpers_remaining': len(helpers)}


def smoke_seed(ftp):
    if SMOKE.exists():
        raise RuntimeError('Clean up the previous member smoke fixture first')
    nonce = secrets.token_hex(12)
    state = {'prefix': 'member-smoke-' + nonce, 'password': secrets.token_urlsafe(32)}
    # Write the cleanup identity before insertion, so a interrupted response can
    # still be recovered by the random prefix and cannot touch real accounts.
    SMOKE.write_text(json.dumps(state), encoding='utf-8')
    data = invoke(ftp, """
$pdo=app_pdo();$prefix=__PREFIX__;$password=__PASSWORD__;
$baseline=['users'=>(int)$pdo->query('SELECT COUNT(*) FROM t_user')->fetchColumn(),'documents'=>(int)$pdo->query('SELECT COUNT(*) FROM t_document')->fetchColumn(),
'permissions_sha256'=>hash('sha256',json_encode($pdo->query('SELECT User_Id,permission FROM eoffice_permissions ORDER BY User_Id,permission')->fetchAll())),
'roles_sha256'=>hash('sha256',json_encode($pdo->query('SELECT User_Id,User_Status FROM t_user ORDER BY User_Id')->fetchAll()))];
$pdo->beginTransaction();$users=[];$q=$pdo->prepare('INSERT INTO t_user (User_Name,User_Email,User_Password,User_Status,User_Token) VALUES (?,?,?,?,?)');
foreach(['admin'=>'Admin','manager'=>'User','basic'=>'User'] as $name=>$role){$email=$prefix.'-'.$name.'@example.invalid';$q->execute([$prefix.' '.$name,$email,password_hash($password,PASSWORD_DEFAULT),$role,bin2hex(random_bytes(32))]);$users[$name]=['id'=>(int)$pdo->lastInsertId(),'email'=>$email];}
$pdo->commit();echo json_encode(['users'=>$users,'baseline'=>$baseline]);
""".replace('__PREFIX__', production.hosting.php_value(state['prefix'])).replace('__PASSWORD__', production.hosting.php_value(state['password'])))
    state.update(data)
    SMOKE.write_text(json.dumps(state), encoding='utf-8')
    return {'synthetic_accounts_created': len(data['users']), 'original_counts': {key: value for key, value in data['baseline'].items() if key.endswith('s')}}


def request(client, route, values=None, data=None, expected=200):
    headers = {'Accept': 'application/json', 'Cache-Control': 'no-cache'}
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers['Content-Type'] = 'application/json'
    elif values is not None:
        body = urllib.parse.urlencode(values, doseq=True).encode()
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    req = urllib.request.Request(production.URL + route, data=body, headers=headers)
    try:
        with client.open(req, timeout=45) as response:
            status, content = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, content = error.code, error.read()
    if status != expected:
        raise RuntimeError('Unexpected HTTP status for ' + route.split('?')[0] + ': ' + str(status))
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        raise RuntimeError('Non-JSON application response for ' + route.split('?')[0]) from None


def smoke(ftp):
    state = json.loads(SMOKE.read_text())
    users = state['users']
    clients = {}
    for name, user in users.items():
        client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        request(client, '/api/auth_login.php', data={'username': user['email'], 'password': state['password']})
        clients[name] = client
    admin, manager, basic = (clients[name] for name in ['admin', 'manager', 'basic'])
    guest = urllib.request.build_opener()
    passed = []

    def check(name, fn):
        fn()
        passed.append(name)
        print(json.dumps({'pass': name}), flush=True)

    def grant(user, permissions, client=admin, expected=200):
        version=request(admin,'/management/get_user_departments_api.php?User_Id='+str(users[user]['id']))['permission_version']
        return request(client, '/management/save_user_permissions_api.php', data={'user_id': users[user]['id'], 'permissions': permissions,'permission_version':version}, expected=expected)

    def profile(user, status='User'):
        snapshot=request(admin,'/management/get_user_departments_api.php?User_Id='+str(users[user]['id']))
        return {'User_Id': users[user]['id'], 'User_name': state['prefix'] + ' ' + user, 'User_Email': users[user]['email'], 'User_Status': status,'member_version':snapshot['member_version']}

    def require(condition):
        if not condition:
            raise RuntimeError('Member production assertion failed')

    check('guest and ordinary member denied', lambda: (
        request(guest, '/management/get_users_api.php', expected=401),
        request(basic, '/management/get_users_api.php', expected=403),
        grant('basic', ['members'], basic, 403)))
    check('Admin receives six permissions', lambda: require(len(request(admin, '/api/me.php')['user']['permissions']) == 6))
    check('grant multiple rights to an existing session', lambda: (
        grant('manager', ['members', 'departments']),
        require(request(manager, '/api/me.php')['user']['permissions'] == ['members', 'departments'])))
    check('delegated member list and permission filter', lambda: (
        require(request(manager, '/management/get_users_api.php?search=' + state['prefix'])['can_manage_permissions'] is False),
        require(request(manager, '/management/get_users_api.php?search=' + state['prefix'] + '&permission=members')['total'] == 2)))
    check('delegated profile edit and group membership lookup', lambda: (
        request(manager, '/management/update_user_api.php', values=profile('basic')),
        request(manager, '/management/get_user_departments_api.php?User_Id=' + str(users['basic']['id']))))
    check('delegated member manager cannot promote or modify Admin', lambda: (
        request(manager, '/management/update_user_api.php', values=profile('basic', 'Admin'), expected=403),
        request(manager, '/management/update_user_api.php', values=profile('admin', 'Admin'), expected=403),
        request(manager, '/management/delete_user_api.php', values={'User_Id': users['admin']['id']}, expected=403),
        grant('basic', ['email'], manager, 403)))

    def group_flow():
        name = state['prefix'] + ' group'
        request(manager, '/management/save_department_api.php', values={'Department_Name': name, 'Department_Detail': 'Synthetic verification'})
        rows = request(manager, '/management/get_departments_api.php?search=' + urllib.parse.quote(name))['data']
        require(len(rows) == 1)
        request(manager, '/management/delete_department_api.php', values={'Department_Id': rows[0]['Department_Id']})
    check('delegated group creation and deletion', group_flow)
    check('profile editing keeps grants; invalid registry key rejected', lambda: (
        request(admin, '/management/update_user_api.php', values=profile('manager')),
        require(request(manager, '/api/me.php')['user']['permissions'] == ['members', 'departments']),
        grant('manager', ['invalid'], admin, 400)))
    check('revoke all rights without ending the session', lambda: (
        grant('manager', []), require(request(manager, '/api/me.php')['user']['permissions'] == []),
        request(manager, '/management/get_users_api.php', expected=403),
        request(manager, '/management/save_department_api.php', values={'Department_Name': state['prefix']}, expected=403)))
    check('registry protects all work permissions', lambda: (
        grant('basic', ['external_numbers', 'email', 'room_booking', 'maintenance']),
        require(set(request(basic, '/api/me.php')['user']['permissions']) == {'external_numbers', 'email', 'room_booking', 'maintenance'}),
        grant('basic', []),
        request(basic, '/room_booking/api/update_status.php', data={'id': 0, 'status': 'confirmed'}, expected=403),
        request(basic, '/maintenance_requests/api/update_maintenance.php', data={'id': 0}, expected=403),
        request(basic, '/email_send/check_email_logs.php', expected=403)))
    check('Admin role cannot be changed through permission grant', lambda: grant('admin', [], admin, 409))
    def stale_role_flow():
        user=users['basic'];route='/management/get_user_departments_api.php?User_Id='+str(user['id'])
        version=request(admin,route)['member_version']
        request(admin,'/management/save_user_status_api.php',data={'user_id':user['id'],'status':'Admin','member_version':version})
        stale=profile('basic','Admin')
        version=request(admin,route)['member_version']
        request(admin,'/management/save_user_status_api.php',data={'user_id':user['id'],'status':'User','member_version':version})
        request(admin,'/management/update_user_api.php',values=stale,expected=409)
        del stale['User_Status']
        request(admin,'/management/update_user_api.php',values=stale,expected=409)
        require(request(basic,'/api/me.php')['user']['status']=='User')
    check('a stale profile cannot restore a revoked Admin role',stale_role_flow)
    def stale_profile_flow():
        old=profile('basic');changed=dict(old);changed['User_name']+=' changed'
        request(admin,'/management/update_user_api.php',values=changed)
        request(admin,'/management/update_user_api.php',values=old,expected=409)
        request(admin,'/management/save_user_status_api.php',data={'user_id':users['basic']['id'],'status':'Admin','member_version':old['member_version']},expected=409)
        request(basic,'/management/save_user_status_api.php',data={'user_id':users['basic']['id'],'status':'Admin','member_version':old['member_version']},expected=403)
    check('snapshot versions reject stale updates and delegated role changes',stale_profile_flow)
    def stale_permissions_flow():
        grant('basic',['email'])
        old=request(admin,'/management/get_user_departments_api.php?User_Id='+str(users['basic']['id']))
        grant('basic',[])
        request(admin,'/management/save_user_permissions_api.php',data={'user_id':users['basic']['id'],'permissions':['email','room_booking'],'permission_version':old['permission_version']},expected=409)
        require(request(basic,'/api/me.php')['user']['permissions']==[])
    check('a stale permission form cannot restore revoked work rights',stale_permissions_flow)
    for client in clients.values():
        request(client, '/api/logout.php', data={})
    state['smoke_passed'] = passed
    SMOKE.write_text(json.dumps(state), encoding='utf-8')
    return {'production_member_checks_passed': len(passed)}


def cleanup_smoke(ftp):
    state = json.loads(SMOKE.read_text())
    result = invoke(ftp, """
$pdo=app_pdo();$prefix=__PREFIX__;
if(!preg_match('/^member-smoke-[a-f0-9]{24}$/D',$prefix))throw new RuntimeException('Invalid cleanup identity');
$q=$pdo->prepare('SELECT User_Id,User_Name,User_Email FROM t_user WHERE User_Email LIKE ?');$q->execute([$prefix.'-%@example.invalid']);$users=$q->fetchAll();
$pdo->beginTransaction();foreach($users as $user){
if(!str_starts_with($user['User_Name'],$prefix.' '))throw new RuntimeException('Cleanup user mismatch');
$q=$pdo->prepare('SELECT COUNT(*) FROM t_document WHERE User_Id=?');$q->execute([$user['User_Id']]);if($q->fetchColumn())throw new RuntimeException('Smoke account unexpectedly owns documents');
$pdo->prepare('DELETE FROM t_user_department WHERE User_Id=?')->execute([$user['User_Id']]);
$pdo->prepare('DELETE FROM t_user WHERE User_Id=?')->execute([$user['User_Id']]);
}
$pdo->prepare('DELETE FROM t_department WHERE Department_Name=?')->execute([$prefix.' group']);$pdo->commit();
echo json_encode(['synthetic_users_removed'=>count($users),'users'=>(int)$pdo->query('SELECT COUNT(*) FROM t_user')->fetchColumn(),'documents'=>(int)$pdo->query('SELECT COUNT(*) FROM t_document')->fetchColumn(),
'permissions_sha256'=>hash('sha256',json_encode($pdo->query('SELECT User_Id,permission FROM eoffice_permissions ORDER BY User_Id,permission')->fetchAll())),
'roles_sha256'=>hash('sha256',json_encode($pdo->query('SELECT User_Id,User_Status FROM t_user ORDER BY User_Id')->fetchAll()))]);
""".replace('__PREFIX__', production.hosting.php_value(state['prefix'])))
    baseline = state.get('baseline', {})
    result['original_permissions_unchanged'] = result['permissions_sha256'] == baseline.get('permissions_sha256')
    result['original_roles_unchanged'] = result['roles_sha256'] == baseline.get('roles_sha256')
    (TEMP / 'eoffice-members-smoke-results.private.json').write_text(json.dumps({'passed': state.get('smoke_passed', []), 'cleanup': result}, indent=2), encoding='utf-8')
    SMOKE.unlink()
    return {key: value for key, value in result.items() if not key.endswith('sha256')}


def rollback(ftp):
    state = state_checked()
    # Restore bootstrap before removing its new registry dependency.
    with tarfile.open(state['backup'], 'r:gz') as archive:
        names = [name for name in FILES if state['before'][name] is not None]
        names.sort(key=lambda name: (name != 'config/bootstrap.php', name))
        for name in names:
            content = archive.extractfile(name).read()
            upload(name, content)
        for name in FILES:
            if state['before'][name] is None:
                try:
                    ftp.delete(name)
                except production.hosting.ftplib.error_perm as error:
                    if not str(error).startswith('550'):
                        raise
    mismatches = []
    for name in FILES:
        content = retrieve_optional(ftp, name)
        if (digest(content) if content is not None else None) != state['before'][name]:
            mismatches.append(name)
    if mismatches:
        raise RuntimeError('Rollback verification failed')
    invoke_raw("""
foreach(__FILES__ as $name)if(function_exists('opcache_invalidate'))opcache_invalidate(__DIR__.'/'.$name,true);
echo json_encode(['opcache_invalidated'=>true]);
""".replace('__FILES__', production.hosting.php_value(FILES)))
    manifest = json.loads(production.hosting.retrieve(ftp, 'config/production-manifest.json'))
    for name, before in state['before'].items():
        if before is None:
            manifest['files'].pop(name, None)
        else:
            manifest['files'][name] = before
    if state.get('before_member_release_commit'):
        manifest['member_release_commit']=state['before_member_release_commit']
    else:
        manifest.pop('member_release_commit',None)
    manifest['updated_at'] = time.strftime('%Y-%m-%dT%H:%M:%S')
    upload('config/production-manifest.json', json.dumps(manifest).encode())
    (TEMP / 'eoffice-production-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return {'rolled_back': True}


def main():
    global SOURCE_COMMIT
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['inspect', 'backup', 'deploy', 'verify', 'smoke-seed', 'smoke', 'cleanup-smoke', 'rollback'])
    parser.add_argument('--commit',help='Publish/verify Git blobs from this commit instead of the working tree')
    args = parser.parse_args()
    if args.commit:
        SOURCE_COMMIT=subprocess.run(['git','rev-parse','--verify',args.commit+'^{commit}'],cwd=ROOT,capture_output=True,check=True,text=True).stdout.strip()
    account, _ = production.credentials()
    with production.hosting.connect(account, 'ftp.siya.ac.th') as ftp:
        production.hosting.webroot(ftp)
        action = {'inspect': inspect, 'backup': backup, 'deploy': deploy, 'verify': verify,
                  'smoke-seed': smoke_seed, 'smoke': smoke, 'cleanup-smoke': cleanup_smoke, 'rollback': rollback}[args.action]
        print(json.dumps(action(ftp), ensure_ascii=True, indent=2), flush=True)


if __name__ == '__main__':
    main()
