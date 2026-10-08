const assert = require('node:assert/strict');
const cp = require('node:child_process');
const php = process.env.PHP_BIN || 'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const port = Number(process.env.MEMBER_TEST_PORT || 8091);
const base = `http://localhost:${port}`;
const env = {...process.env, DB_DATABASE:`eoffice_members_${process.pid}_test`, APP_URL:base, EOFFICE_MOCK_SERVICES:'true'};
let servers = [], users, passed = 0, created = false;
const lockers = new Set();
function fixture(action) {
    const result = cp.spawnSync(php, ['tests/member-fixture.php', action], {env, encoding:'utf8'});
    if (result.status !== 0) throw new Error(result.stdout + result.stderr);
    return result.stdout;
}
function form(values) {
    const body = new FormData();
    for (const [key,value] of Object.entries(values)) {
        if (Array.isArray(value)) value.forEach(item => body.append(key+'[]', item));
        else body.append(key, value);
    }
    return body;
}
async function request(path, {as='admin', data, body, status=200, worker=0, method=data || body ? 'POST' : 'GET'} = {}) {
    const response = await fetch(`http://localhost:${port+worker}${path}`, {
        method,
        headers:{...(as ? {Cookie:users[as].cookie} : {}), ...(data ? {'Content-Type':'application/json'} : {})},
        body:body || (data ? JSON.stringify(data) : undefined)
    });
    const text = await response.text();
    assert.equal(response.status, status, `${path}: ${text}`);
    return JSON.parse(text);
}
const grant = async (name, permissions, extra={}) => {
    const as=extra.as??'admin';
    const version=as==='admin'?(await request('/management/get_user_departments_api.php?User_Id='+users[name].id)).permission_version:undefined;
    return request('/management/save_user_permissions_api.php', {data:{user_id:users[name].id,permissions,permission_version:version},...extra});
};
const values = (name, User_Status='User') => ({User_Id:users[name].id, User_name:name, User_Email:name+'@example.test', User_Status});
async function profile(name, extra={}) {
    const snapshot=await request('/management/get_user_departments_api.php?User_Id='+users[name].id);
    return {...values(name,snapshot.user.User_Status),member_version:snapshot.member_version,...extra};
}
async function changeStatus(name,status,as='admin',expected=200,version) {
    version ??= (await request('/management/get_user_departments_api.php?User_Id='+users[name].id,{as})).member_version;
    return request('/management/save_user_status_api.php',{as,data:{user_id:users[name].id,status,member_version:version},status:expected});
}
function helper(action, id=0) {
    const r=cp.spawnSync(php,['tests/member-lock-helper.php',action,String(id)],{env,encoding:'utf8'});
    if(r.status!==0)throw Error(r.stdout+r.stderr);
    return r.stdout;
}
async function holdRoster() {
    const child=cp.spawn(php,['tests/member-lock-helper.php','lock'],{env,stdio:['pipe','pipe','pipe']});lockers.add(child);
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Member roster lock unavailable')),5000);child.stdout.on('data',data=>{if(String(data).includes('LOCKED')){clearTimeout(timeout);resolve();}});child.on('error',reject);});
    return async()=>{const done=new Promise(resolve=>child.once('exit',resolve));child.stdin.end('release\n');await done;lockers.delete(child);};
}
async function waitForRoster() {
    for(let i=0;i<50;i++){if(Number(helper('waits'))>0)return;await new Promise(resolve=>setTimeout(resolve,100));}
    throw Error('HTTP mutation did not reach member roster lock');
}
async function test(name, fn) { await fn(); passed++; console.log('PASS '+name); }
async function run() {
    users = JSON.parse(fixture('seed')); created = true;
    servers = [0,1].map(i => cp.spawn(php, ['-S', `localhost:${port+i}`, 'scripts/router.php'], {env:{...env,APP_URL:`http://localhost:${port+i}`},stdio:'ignore'}));
    let ready=false;
    for (let i=0;i<50;i++) { try { await fetch(base+'/api/me.php');ready=true;break; } catch { await new Promise(resolve=>setTimeout(resolve,100)); } }
    assert.ok(ready,'PHP test server ready');
    await test('guest and basic member cannot manage members or permissions', async()=>{
        await request('/management/get_users_api.php',{as:null,status:401});
        await request('/management/get_users_api.php',{as:'basic',status:403});
        await grant('basic',['members'],{as:'basic',status:403});
    });
    await test('Admin gets the complete permission catalog', async()=>{
        const me=await request('/api/me.php');
        assert.deepEqual(new Set(me.user.permissions),new Set(['members','departments','external_numbers','email','room_booking','maintenance']));
    });
    await test('multiple grants immediately affect the existing session', async()=>{
        await grant('manager',['members','departments','members']);
        const me=await request('/api/me.php',{as:'manager'});
        assert.deepEqual(me.user.permissions,['members','departments']);
        const list=await request('/management/get_users_api.php?permission=members',{as:'manager'});
        assert.equal(list.can_manage_permissions,false);
        assert.equal(list.data.find(u=>u.User_Id===users.admin.id).can_edit,false);
        assert.equal(list.data.find(u=>u.User_Id===users.manager.id).can_edit,true);
        assert.equal(list.data.length,2);
    });
    await test('delegated group management supports save/list/delete',async()=>{
        await request('/management/save_department_api.php',{as:'manager',body:form({Department_Name:'Members QA',Department_Detail:'Test'})});
        const list=await request('/management/get_departments_api.php',{as:'manager'});
        const dept=list.data[0].Department_Id;
        await request('/management/delete_department_api.php',{as:'manager',body:form({Department_Id:dept})});
        assert.equal((await request('/management/get_departments_api.php',{as:'manager'})).total,0);
    });
    await test('delegated member manager creates and edits basic users',async()=>{
        const data=await request('/management/new_user_api.php',{as:'manager',body:form({User_name:'new',User_Email:'new@example.test',User_Status:'User',User_password1:'Member-Test-2026!',User_password2:'Member-Test-2026!'})});
        assert.ok(data.user_id);
        await request('/management/update_user_api.php',{as:'manager',body:form(await profile('basic'))});
        await request('/management/get_user_departments_api.php?User_Id='+users.basic.id,{as:'manager'});
        await request('/management/delete_user_api.php',{as:'manager',body:form({User_Id:data.user_id})});
    });
    await test('member manager cannot grant or promote any account',async()=>{
        await grant('basic',['email'],{as:'manager',status:403});
        await request('/management/update_user_api.php',{as:'manager',body:form(values('basic','Admin')),status:403});
        await request('/management/new_user_api.php',{as:'manager',body:form({User_name:'rogue',User_Email:'rogue@example.test',User_Status:'Admin',User_password1:'Member-Test-2026!',User_password2:'Member-Test-2026!'}),status:403});
        await request('/management/update_user_api.php',{as:'manager',body:form({...values('basic'),permissions:['email']}),status:403});
    });
    await test('member manager cannot change or delete Admin/staff accounts',async()=>{
        await grant('staff',['email','room_booking','maintenance','external_numbers']);
        for (const name of ['admin','staff']) {
            await request('/management/update_user_api.php',{as:'manager',body:form({...values(name,name==='admin'?'Admin':'User'),User_password1:'Hijack-Test-2026!',User_password2:'Hijack-Test-2026!'}),status:403});
            await request('/management/delete_user_api.php',{as:'manager',body:form({User_Id:users[name].id}),status:403});
        }
    });
    await test('invalid permission submissions preserve existing grants',async()=>{
        for (const permissions of [['not_a_permission'],['Admin'],[true],{},null]) await grant('staff',permissions,{status:400});
        assert.deepEqual((await request('/api/me.php',{as:'staff'})).user.permissions,['external_numbers','email','room_booking','maintenance']);
        await grant('admin',[],{status:409});
    });
    await test('stale permission form cannot restore revoked rights',async()=>{
        await grant('basic',['email']);
        const old=await request('/management/get_user_departments_api.php?User_Id='+users.basic.id);
        await grant('basic',[]);
        await request('/management/save_user_permissions_api.php',{data:{user_id:users.basic.id,permissions:['email','room_booking'],permission_version:old.permission_version},status:409});
        await request('/management/save_user_permissions_api.php',{data:{user_id:users.basic.id,permissions:['members']},status:409});
        assert.deepEqual((await request('/api/me.php',{as:'basic'})).user.permissions,[]);
    });
    await test('basic profile save preserves grants and permission save preserves profile',async()=>{
        await request('/management/update_user_api.php',{body:form(await profile('staff',{User_name:'Staff renamed'}))});
        await grant('staff',['email']);
        const list=await request('/management/get_users_api.php?search=Staff');
        assert.equal(list.data[0].User_Name,'Staff renamed');
        assert.deepEqual(list.data[0].permissions,['email']);
    });
    await test('revoking all grants blocks existing sessions on the next request',async()=>{
        await grant('manager',[]);
        assert.deepEqual((await request('/api/me.php',{as:'manager'})).user.permissions,[]);
        await request('/management/get_users_api.php',{as:'manager',status:403});
        await request('/management/save_department_api.php',{as:'manager',body:form({Department_Name:'Denied'}),status:403});
        await grant('staff',[]);
        await request('/email_send/check_email_logs.php',{as:'staff',status:403});
        await request('/room_booking/api/update_status.php',{as:'staff',data:{id:1,status:'confirmed'},status:403});
        await request('/maintenance_requests/api/update_maintenance.php',{as:'staff',data:{id:1},status:403});
        await request('/external_number_booking/external_number_booking.php',{as:'staff',method:'PUT',data:{id:1,docDetail:'Denied'},status:403});
    });
    await test('last Admin cannot be demoted or deleted',async()=>{
        await changeStatus('admin','User','admin',409);
        await request('/management/delete_user_api.php',{body:form({User_Id:users.admin.id}),status:409});
        assert.equal((await request('/api/me.php')).user.status,'Admin');
    });
    await test('concurrent cross-demotions retain an Admin and stale authority is denied',async()=>{
        await grant('manager',['members']);
        await changeStatus('manager','Admin');
        const managerSnapshot=await request('/management/get_user_departments_api.php?User_Id='+users.manager.id);
        const adminSnapshot=await request('/management/get_user_departments_api.php?User_Id='+users.admin.id);
        const responses=await Promise.all([
            fetch(base+'/management/save_user_status_api.php',{method:'POST',headers:{Cookie:users.admin.cookie,'Content-Type':'application/json'},body:JSON.stringify({user_id:users.manager.id,status:'User',member_version:managerSnapshot.member_version})}),
            fetch(`http://localhost:${port+1}/management/save_user_status_api.php`,{method:'POST',headers:{Cookie:users.manager.cookie,'Content-Type':'application/json'},body:JSON.stringify({user_id:users.admin.id,status:'User',member_version:adminSnapshot.member_version})})
        ]);
        assert.deepEqual(responses.map(r=>r.status).sort(),[200,403]);
        const accounts=await Promise.all(['admin','manager'].map(as=>request('/api/me.php',{as})));
        assert.equal(accounts.filter(account=>account.user.status==='Admin').length,1);
        assert.deepEqual(accounts.find(account=>account.user.status!=='Admin').user.permissions,[]);
    });
    // Normalize the synthetic Admin after the concurrent cross-demotion test.
    const adminNow=(await request('/api/me.php')).user;
    if(adminNow.status!=='Admin'){
        await changeStatus('admin','Admin','manager');
        await changeStatus('manager','User');
    }
    await test('stale profile cannot restore a revoked Admin role',async()=>{
        await changeStatus('staff','Admin');
        const stale=await profile('staff');
        await changeStatus('staff','User');
        await request('/management/update_user_api.php',{body:form({...stale,User_name:'Stale name'}),status:409});
        assert.equal((await request('/api/me.php',{as:'staff'})).user.status,'User');
        delete stale.User_Status;
        await request('/management/update_user_api.php',{body:form({...stale,User_name:'Stale name'}),status:409});
    });
    await test('old and missing versions cannot change a role; profile editing never promotes',async()=>{
        const old=await profile('basic');
        await request('/management/update_user_api.php',{body:form({...old,User_name:'Updated name'})});
        await changeStatus('basic','Admin','admin',409,old.member_version);
        await request('/management/save_user_status_api.php',{data:{user_id:users.basic.id,status:'Admin'},status:400});
        await request('/management/update_user_api.php',{body:form(values('basic')),status:409});
        await request('/management/save_user_status_api.php',{as:'basic',data:{user_id:users.basic.id,status:'Admin',member_version:old.member_version},status:403});
        assert.equal((await request('/api/me.php',{as:'basic'})).user.status,'User');
    });
    await test('member group version prevents a stale form overwriting newer assignments',async()=>{
        await request('/management/save_department_api.php',{body:form({Department_Name:'Version group'})});
        const dept=(await request('/management/get_departments_api.php')).data[0].Department_Id;
        const old=await profile('basic');
        await request('/management/update_user_api.php',{body:form({...old,Department_Id_Acc:[dept]})});
        await request('/management/update_user_api.php',{body:form({...old,User_name:'Stale group edit'}),status:409});
        assert.equal((await request('/management/get_user_departments_api.php?User_Id='+users.basic.id)).data.length,1);
    });
    await test('logout while queued blocks member creation without writing data',async()=>{
        await grant('manager',['members']);const release=await holdRoster();
        const pending=request('/management/new_user_api.php',{as:'manager',body:form({User_name:'Queued create',User_Email:'queued-create@example.test',User_Status:'User',User_password1:'Member-Test-2026!',User_password2:'Member-Test-2026!'}),status:401});
        await waitForRoster();await request('/api/logout.php',{as:'manager',data:{},worker:1});await release();await pending;
        assert.equal((await request('/management/get_users_api.php?search=Queued')).total,0);
    });
    await test('expired session while queued blocks member update',async()=>{
        const basic=await profile('basic');const release=await holdRoster();
        const pending=request('/management/update_user_api.php',{as:'admin',body:form({...basic,User_name:'Expired write'}),status:401});
        await waitForRoster();helper('expire',users.admin.id);await release();await pending;
        helper('renew',users.admin.id);
        assert.equal((await request('/management/get_users_api.php?search=Expired')).total,0);
    });
    await test('logout while queued blocks permission grant and deletion',async()=>{
        const release=await holdRoster();
        const pending=request('/management/save_user_permissions_api.php',{data:{user_id:users.basic.id,permissions:['members']},status:401});
        await waitForRoster();await request('/api/logout.php',{data:{},worker:1});await release();await pending;
        helper('session',users.admin.id);
        users.admin.cookie=helper('session-cookie',users.admin.id).trim();
        assert.deepEqual((await request('/api/me.php',{as:'basic'})).user.permissions,[]);
        const releaseDelete=await holdRoster();const deleted=request('/management/delete_user_api.php',{body:form({User_Id:users.staff.id}),status:401});
        await waitForRoster();await request('/api/logout.php',{data:{},worker:1});await releaseDelete();await deleted;
        helper('session',users.admin.id);users.admin.cookie=helper('session-cookie',users.admin.id).trim();
        assert.equal((await request('/management/get_users_api.php?search=staff')).total,1);
    });
    await test('logout while queued blocks role promotion',async()=>{
        const version=(await profile('staff')).member_version;const release=await holdRoster();
        const pending=request('/management/save_user_status_api.php',{data:{user_id:users.staff.id,status:'Admin',member_version:version},status:401});
        await waitForRoster();await request('/api/logout.php',{data:{},worker:1});await release();await pending;
        assert.equal((await request('/api/me.php',{as:'staff'})).user.status,'User');
    });
    console.log(`Member permissions: ${passed} passed`);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    for(const child of lockers)child.kill();
    await Promise.all(servers.map(server=>new Promise(resolve=>{if(server.exitCode!==null) return resolve();server.once('exit',resolve);server.kill();})));
    if (created) try { fixture('drop'); } catch(error) { console.error(error);process.exitCode=1; }
});
