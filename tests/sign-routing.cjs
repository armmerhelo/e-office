const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const php = process.env.PHP_BIN || 'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const port = Number(process.env.SIGN_ROUTING_TEST_PORT || 8094), base = `http://localhost:${port}`;
const storage = path.join(os.tmpdir(), 'opencode', `eoffice-sign-routing-${process.pid}`);
const env = {...process.env, DB_DATABASE:`eoffice_members_${process.pid}_test`, APP_URL:base, EOFFICE_MOCK_SERVICES:'true', EOFFICE_STORAGE:storage, EOFFICE_SIGN_ROUTES:'{"2":3}'};
let server, users, created = false, passed = 0;
function fixture(action, file = 'tests/sign-routing-fixture.php') {
    const result = cp.spawnSync(php, [file, action], {env, encoding:'utf8'});
    if (result.status !== 0) throw Error(result.stdout + result.stderr);
    return result.stdout;
}
async function request(route, {as='admin', data, body, status=200} = {}) {
    const response = await fetch(base + route, {method:data || body ? 'POST' : 'GET', headers:{...(as ? {Cookie:users[as].cookie} : {}), ...(data ? {'Content-Type':'application/json'} : {})}, body:body || (data ? JSON.stringify(data) : undefined)});
    const text = await response.text(); assert.equal(response.status, status, `${route}: ${text}`);
    return JSON.parse(text);
}
const read = () => request('/management/get_sign_routes_api.php');
const route = (department, secretary='manager', deputy='staff') => ({department, secretary_id:users[secretary].id, deputy_id:users[deputy].id});
async function save(routes, extra={}) {
    const snapshot = await read();
    return request('/management/save_sign_routes_api.php', {data:{routes, route_version:snapshot.route_version}, ...extra});
}
async function sign(as='manager', departments, {status=200, revision, legacy=false, confirm=true}={}) {
    const view = await fetch(base + '/api/view_file.php?Doc_Id=1&File_Path=routing.pdf&Type=signed', {headers:{Cookie:users[as].cookie}});
    assert.equal(view.status,200); const pdf = await view.arrayBuffer();
    const body = new FormData(); body.append('file',new Blob([pdf, `\n% saved-${Date.now()}-${Math.random()}\n`],{type:'application/pdf'}),'routing.pdf');
    body.append('Doc_Id','1'); body.append('year','2569'); body.append('revision',revision || view.headers.get('X-Document-Revision'));
    if (departments !== undefined) body.append(legacy?'stamp_departments':'receipt_departments',JSON.stringify(departments));
    if (confirm && !legacy) body.append('confirm_receipt','1');
    return request('/e-sign/upload_pdf.php',{as,body,status});
}
const inspect = () => JSON.parse(fixture('inspect'));
async function test(name,fn) { await fn(); passed++; console.log('PASS ' + name); }
async function run() {
    users = JSON.parse(fixture('seed')); created = true;
    server = cp.spawn(php,['-S',`localhost:${port}`,'scripts/router.php'],{env,stdio:'ignore'});
    let ready=false;
    for (let i=0;i<50;i++) { try { await fetch(base+'/api/me.php'); ready=true; break; } catch { await new Promise(resolve=>setTimeout(resolve,100)); } }
    assert.ok(ready);
    await test('legacy routes migrate once; Admin receives member choices',async()=>{
        const data=await read(); assert.deepEqual(data.routes,[route('')]); assert.equal(data.users.length,4); assert.equal(data.departments.length,6);
    });
    await test('guests and delegated member managers cannot configure Auto send',async()=>{
        await request('/management/get_sign_routes_api.php',{as:null,status:401});
        const snapshot=await request('/management/get_user_departments_api.php?User_Id='+users.manager.id);
        await request('/management/save_user_permissions_api.php',{data:{user_id:users.manager.id,permissions:['members'],permission_version:snapshot.permission_version}});
        await request('/management/get_sign_routes_api.php',{as:'manager',status:403});
        await save([],{as:'manager',status:403});
    });
    const department='กลุ่มบริหารวิชาการ', other='กลุ่มบริหารทั่วไป';
    await test('Admin can assign the same secretary to separate departments',async()=>{
        await save([route(department),route(other,'manager','admin')]); assert.equal((await read()).routes.length,2);
    });
    await test('routing roles appear in member rights and delegated managers cannot reset deputies',async()=>{
        const list=await request('/management/get_users_api.php',{as:'manager'});
        const deputy=list.data.find(user=>user.User_Id===users.staff.id);
        assert.equal(deputy.can_edit,false); assert.ok(deputy.sign_roles.some(role=>role.includes('รองฝ่าย')));
        await request('/management/get_user_departments_api.php?User_Id='+users.staff.id,{as:'manager',status:403});
        const body=new FormData();body.append('User_Id',users.staff.id);
        await request('/management/delete_user_api.php',{as:'manager',body,status:403});
    });
    await test('invalid, duplicate, self and missing member routes preserve configuration',async()=>{
        const before=await read();
        for (const routes of [{},null,[route('unknown')],[route(department),route(department)],[route(department,'manager','manager')],[{...route(department),secretary_id:'2'}]]) await save(routes,{status:400});
        await save([{...route(department),deputy_id:999999}],{status:409});
        assert.deepEqual((await read()).routes,before.routes);
    });
    await test('stale Admin forms cannot overwrite a newer routing assignment',async()=>{
        const old=await read(); await save([route(department)]);
        await request('/management/save_sign_routes_api.php',{data:{routes:[],route_version:old.route_version},status:409});
        assert.deepEqual((await read()).routes,[route(department)]);
    });
    await test('ordinary signatures, wrong departments and non-secretaries never auto-send',async()=>{
        for (const departments of [undefined,[]]) assert.deepEqual((await sign('manager',departments)).auto_sent_user_ids,[]);
        const url=base+'/api/view_file.php?Doc_Id=1&File_Path=routing.pdf&Type=signed';
        const before=await fetch(url,{headers:{Cookie:users.manager.cookie}});const revision=before.headers.get('X-Document-Revision');await before.arrayBuffer();
        await sign('manager',[other],{status:403});await sign('basic',[department],{status:403});
        const after=await fetch(url,{headers:{Cookie:users.manager.cookie}});assert.equal(after.headers.get('X-Document-Revision'),revision);await after.arrayBuffer();
        assert.equal(inspect().receipts.length,0);
        assert.equal(inspect().access.some(row=>row.User_Id===users.staff.id),false);
    });
    await test('bad stamp metadata and stale PDF revisions cannot grant access',async()=>{
        for (const departments of [{},['unknown'],[true]]) await sign('manager',departments,{status:400});
        await sign('manager',[department],{revision:'0'.repeat(64),status:409});
        assert.equal(inspect().notifications.length,0);
    });
    await test('forged legacy stamp metadata and unconfirmed receipts cannot grant recipients or change the PDF',async()=>{
        const url=base+'/api/view_file.php?Doc_Id=1&File_Path=routing.pdf&Type=signed';
        const before=await fetch(url,{headers:{Cookie:users.manager.cookie}});
        const revision=before.headers.get('X-Document-Revision');await before.arrayBuffer();
        await sign('manager',[department],{legacy:true,status:400});
        await sign('manager',[department],{confirm:false,status:400});
        const after=await fetch(url,{headers:{Cookie:users.manager.cookie}});
        assert.equal(after.headers.get('X-Document-Revision'),revision);await after.arrayBuffer();
        assert.equal(inspect().notifications.length,0);
    });
    await test('matching secretary stamp adds deputy access and one notification atomically',async()=>{
        const result=await sign('manager',[department]);
        assert.deepEqual(result.auto_sent_user_ids,[users.staff.id]);
        assert.deepEqual(result.registered_receipt_departments,[department]);
        const data=inspect(); assert.equal(data.access.find(row=>row.User_Id===users.manager.id).Is_Signed,'true');
        assert.equal(data.access.find(row=>row.User_Id===users.staff.id).Status,'Unread');
        assert.equal(data.notifications.length,1); assert.equal(data.notifications[0].user_id,users.staff.id);
        assert.equal(data.receipts.at(-1).department,department);assert.equal(data.receipts.at(-1).secretary_id,users.manager.id);
    });
    await test('receipt scopes expose only assigned departments, and only to document readers',async()=>{
        const result=await request('/e-sign/receipt_scopes.php?Doc_Id=1',{as:'manager'});assert.deepEqual(result.departments,[department]);
        assert.deepEqual((await request('/e-sign/receipt_scopes.php?Doc_Id=1',{as:'basic'})).departments,[]);
        await request('/e-sign/receipt_scopes.php?Doc_Id=1',{as:null,status:401});
        await request('/e-sign/receipt_scopes.php?Doc_Id=999',{as:'manager',status:404});
    });
    await test('repeated stamps preserve deputy signed/read state and do not notify twice',async()=>{
        const plain=await sign('staff',[]);assert.deepEqual(plain.registered_receipt_departments,[]);
        const repeated=await sign('manager',[department]);assert.deepEqual(repeated.registered_receipt_departments,[department]);
        const data=inspect(); assert.equal(data.access.find(row=>row.User_Id===users.staff.id).Is_Signed,'true'); assert.equal(data.notifications.length,1);
    });
    await test('legacy wildcard works for any actual stamp, not pen-only saves',async()=>{
        await save([route('','manager','admin')]);
        assert.deepEqual((await sign()).auto_sent_user_ids,[]);
        assert.deepEqual((await sign('manager',[other])).auto_sent_user_ids,[users.admin.id]);
    });
    await test('multiple matching scopes deduplicate deputies',async()=>{
        await save([route(department),route(other)]);
        assert.deepEqual((await sign('manager',[department,other])).auto_sent_user_ids,[]);
        assert.equal(inspect().notifications.length,2);
    });
    await test('removing all routes stops future sends and migration never restores old pairs',async()=>{
        await save([]); fixture('migrate'); assert.deepEqual((await read()).routes,[]);
        await sign('manager',[department],{status:403});
        assert.equal(inspect().access.some(row=>row.User_Id===users.staff.id),true);
    });
    await test('migration upgrades the legacy receipt cascade without losing audit rows and remains idempotent',async()=>{
        const before=inspect().receipts;assert.ok(before.length);
        fixture('legacy-receipt-fk');fixture('migrate');fixture('migrate');
        assert.deepEqual(inspect().receipts,before);
        assert.equal(JSON.parse(fixture('delete-secretary-direct')).blocked,true);
        assert.deepEqual(inspect().receipts,before);
    });
    await test('Admin cannot delete a former secretary with receipt history even after removing their routes',async()=>{
        const before=inspect().receipts;const body=new FormData();body.append('User_Id',users.manager.id);
        const result=await request('/management/delete_user_api.php',{body,status:409});
        assert.match(result.message,/ประวัติรับเอกสาร/);assert.deepEqual(inspect().receipts,before);
        assert.equal((await request('/api/me.php',{as:'manager'})).user.id,users.manager.id);
    });
    await test('accounts without owned documents or receipts can still be deleted',async()=>{
        const body=new FormData();body.append('User_Id',users.basic.id);
        await request('/management/delete_user_api.php',{body});
        assert.equal((await request('/management/get_users_api.php?search=basic')).total,0);
    });
    console.log(`Sign routing: ${passed} passed`);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
    server?.kill();
    if (created) fixture('drop','tests/member-fixture.php');
    fs.rmSync(storage,{recursive:true,force:true});
});
