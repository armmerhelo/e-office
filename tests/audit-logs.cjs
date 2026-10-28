const assert=require('node:assert/strict');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const port=Number(process.env.AUDIT_TEST_PORT||8098),base=`http://localhost:${port}`;
const parent=path.join(os.tmpdir(),'opencode');if(!fs.existsSync(parent))throw Error('Missing temporary parent');
const sessions=fs.mkdtempSync(path.join(parent,'eoffice-audit-sessions-')),phpArgs=['-d','session.save_path='+sessions];
const env={...process.env,DB_DATABASE:`eoffice_members_${process.pid}_test`,APP_URL:base,EOFFICE_MOCK_SERVICES:'true',EOFFICE_MEMBER_VERSION_KEY:crypto.randomBytes(32).toString('base64'),GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'synthetic-test-secret'};
let users,server,created=false,passed=0;
function cli(file,...args){const r=cp.spawnSync(php,[...phpArgs,file,...args],{env,encoding:'utf8'});if(r.status!==0)throw Error(r.stdout+r.stderr);return r.stdout;}
const snapshot=()=>JSON.parse(cli('tests/audit-fixture.php','snapshot'));
function form(values){const body=new FormData();for(const [key,value] of Object.entries(values))body.append(key,String(value));return body;}
async function request(route,{as='admin',cookie,data,form,status=200,headers={},method=data||form?'POST':'GET'}={}){
    const response=await fetch(base+route,{method,headers:{...(cookie||as?{Cookie:cookie||users[as].cookie}:{}),...(data?{'Content-Type':'application/json'}:{}),...headers},body:form||(data?JSON.stringify(data):undefined)});
    const text=await response.text();assert.equal(response.status,status,`${route}: ${text}`);return {response,body:JSON.parse(text)};
}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
async function run(){
    users=JSON.parse(cli('tests/member-fixture.php','seed'));created=true;
    cli('tests/audit-fixture.php','setup');
    server=cp.spawn(php,[...phpArgs,'-S',`localhost:${port}`,'scripts/router.php'],{env,stdio:'ignore'});
    let ready=false;for(let i=0;i<50;i++){try{await fetch(base+'/api/me.php');ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}assert.ok(ready);
    await check('audit history is Admin-only and denied reads never write logs',async()=>{
        const before=snapshot().logs;
        await request('/management/get_audit_logs_api.php',{as:null,status:401});
        await request('/management/get_audit_logs_api.php',{as:'manager',status:403});
        await request('/management/get_audit_logs_api.php',{as:'admin',data:{},status:405});
        assert.deepEqual(snapshot().logs,before);
    });
    let cookie,newId;
    await check('failed and successful logins plus logout record server identity without credentials',async()=>{
        await request('/api/auth_login.php',{as:null,data:{username:'admin@example.test',password:'synthetic-wrong-password'},status:401});
        const login=await request('/api/auth_login.php',{as:null,data:{username:'admin@example.test',password:'Member-Test-2026!'}});
        cookie=login.response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
        await request('/api/logout.php',{cookie,data:{}});
        const logs=snapshot().logs;assert.deepEqual(logs.map(row=>row.event),['auth.login_failed','auth.login','auth.logout']);
        assert.equal(logs[0].actor_id,null);assert.equal(logs[0].outcome,'failure');
        assert.equal(logs[1].actor_id,users.admin.id);assert.equal(logs[1].actor_name,'admin');assert.ok(['127.0.0.1','::1'].includes(logs[1].ip_address));
        const text=JSON.stringify(logs);for(const secret of ['synthetic-wrong-password','Member-Test-2026!',cookie.split('User_Token=')[1]?.split(';')[0]])assert.ok(!text.includes(secret));
    });
    await check('member create/role/permissions/delete logs carry target and preserve history after deletion',async()=>{
        const createdUser=await request('/management/new_user_api.php',{form:form({User_name:'Audit temporary',User_Email:'audit@example.test',User_Status:'User',User_password1:'Synthetic-Test-2026!',User_password2:'Synthetic-Test-2026!'})});newId=createdUser.body.user_id;
        let detail=(await request('/management/get_user_departments_api.php?User_Id='+newId)).body;
        await request('/management/save_user_status_api.php',{data:{user_id:newId,status:'Editor',member_version:detail.member_version}});
        detail=(await request('/management/get_user_departments_api.php?User_Id='+newId)).body;
        await request('/management/save_user_permissions_api.php',{data:{user_id:newId,permissions:['email'],permission_version:detail.permission_version}});
        await request('/management/delete_user_api.php',{form:form({User_Id:newId})});
        const logs=snapshot().logs.filter(row=>Number(row.target_id)===newId&&row.category==='members');
        assert.deepEqual(logs.map(row=>row.event),['member.create','member.role','member.permissions','member.delete']);
        assert.deepEqual(JSON.parse(logs[1].metadata),{from:'User',to:'Editor'});assert.deepEqual(JSON.parse(logs[2].metadata),{permissions:['email']});
        assert.ok(logs.every(row=>row.actor_id===users.admin.id));assert.ok(!snapshot().users.some(user=>user.User_Id===newId));
    });
    await check('audit storage failure rolls back the business write rather than reporting a false success',async()=>{
        const before=snapshot();cli('tests/audit-fixture.php','reject-audit');
        try {await request('/management/new_user_api.php',{form:form({User_name:'Must rollback',User_Email:'rollback@example.test',User_Status:'User',User_password1:'Synthetic-Test-2026!',User_password2:'Synthetic-Test-2026!'}),status:500});}
        finally {cli('tests/audit-fixture.php','allow-audit');}
        assert.deepEqual(snapshot(),before);
    });
    await check('Admin history supports stable pagination, category/outcome/ID filters and read-only GET',async()=>{
        const before=snapshot();const first=(await request('/management/get_audit_logs_api.php?limit=2')).body;
        const second=(await request('/management/get_audit_logs_api.php?limit=2&page=2')).body;
        assert.equal(first.data.length,2);assert.equal(second.data.length,2);assert.ok(BigInt(first.data[1].id)>BigInt(second.data[0].id));
        assert.ok(first.data.every(row=>row.occurred_at.endsWith('+07:00')));assert.ok(first.categories.auth);
        const failed=(await request('/management/get_audit_logs_api.php?category=auth&outcome=failure')).body;assert.equal(failed.total,1);assert.equal(failed.data[0].event,'auth.login_failed');
        const target=(await request('/management/get_audit_logs_api.php?category=members&search='+newId)).body;assert.equal(target.total,4);
        assert.equal((await request('/management/get_audit_logs_api.php?page=999999')).body.page,1);
        assert.deepEqual(snapshot(),before);
    });
    await check('date boundaries, literal LIKE escaping and metadata allowlist work without losing unsafe-looking names',async()=>{
        cli('tests/audit-fixture.php','samples');
        const result=(await request('/management/get_audit_logs_api.php?from=2024-01-02&to=2024-01-02')).body;assert.equal(result.total,1);
        assert.equal(result.data[0].occurred_at,'2024-01-02T23:59:59+07:00');assert.deepEqual(result.data[0].metadata,{reset_password:true});
        assert.match(result.data[0].actor_name,/<img/);
        const literal=(await request('/management/get_audit_logs_api.php?search='+encodeURIComponent('100%_!'))).body;assert.equal(literal.total,2);
        assert.equal((await request('/management/get_audit_logs_api.php?search='+encodeURIComponent("' OR 1=1 --"))).body.total,0);
        assert.ok(!JSON.stringify(snapshot().logs).includes('DO-NOT-LOG'));
    });
    await check('malformed filters and dates return validation errors',async()=>{
        for(const query of ['from=2024-02-30','from=2024-01-03&to=2024-01-02','category=unknown','outcome=unknown','limit=101','page=0','page[]=1','search[]=x'])await request('/management/get_audit_logs_api.php?'+query,{status:400});
    });
    await check('room, maintenance and number changes record actual actors/targets and rejected requests produce no success logs',async()=>{
        const booking={requesterName:'Audit QA',roomSelect:'Audit room',topic:'Audit QA',department:'QA',attendees:2,startDate:'2027-01-01',endDate:'2027-01-01',startTime:'10:00',endTime:'11:00',equipment:{}};
        const created=(await request('/room_booking/api/room_booking.php',{as:'basic',data:booking})).body.id;
        await request('/room_booking/api/update_booking.php',{as:'basic',data:{id:created,room_name:'Audit room',topic:'Updated',requester_name:'QA',department:'QA',attendees:3,start_datetime:'2027-01-01 10:00:00',end_datetime:'2027-01-01 11:00:00'}});
        await request('/room_booking/api/update_status.php',{data:{id:created,status:'confirmed'}});
        let count=snapshot().logs.length;
        await request('/room_booking/api/room_booking.php',{as:'basic',data:booking,status:409});
        assert.equal(snapshot().logs.length,count);
        const repair=(await request('/maintenance_requests/api/submit_maintenance.php',{as:'basic',data:{requesterName:'QA',requestDate:'2026-10-28',phone:'0000000000',building:'QA',room:'QA',damageDetails:'Synthetic audit test',repairTypes:['ไฟฟ้า']}})).body.id;
        await request('/maintenance_requests/api/update_maintenance.php',{data:{id:repair,considerationStatus:'can_proceed',actionResult:'fixed'}});
        const number=(await request('/external_number_booking/external_number_booking.php',{as:'basic',data:{docDetail:'Synthetic audit test',docYear:2599}})).body.data.id;
        await request('/external_number_booking/external_number_booking.php',{method:'PUT',data:{id:number,docDetail:'Updated audit test'}});
        await request('/external_number_booking/external_number_booking.php',{method:'DELETE',data:{id:number}});
        const logs=snapshot().logs;
        assert.deepEqual(logs.filter(row=>row.category==='bookings').map(row=>[row.event,row.actor_id,Number(row.target_id)]),[['booking.create',users.basic.id,created],['booking.update',users.basic.id,created],['booking.status',users.admin.id,created]]);
        assert.deepEqual(logs.filter(row=>row.category==='maintenance').map(row=>row.event),['maintenance.create','maintenance.update']);
        assert.deepEqual(logs.filter(row=>row.category==='numbers').map(row=>row.event),['number.create','number.update','number.delete']);
        count=logs.length;cli('tests/audit-fixture.php','reject-audit');
        try {await request('/room_booking/api/update_status.php',{data:{id:created,status:'cancelled'},status:500});}
        finally {cli('tests/audit-fixture.php','allow-audit');}
        assert.equal(snapshot().logs.length,count);
        await request('/room_booking/api/room_booking.php',{as:'basic',data:booking,status:409});
    });
    await check('Bearer logout revokes the actual session and logs it without storing the token',async()=>{
        const login=await request('/api/auth_login.php',{as:null,data:{username:'admin@example.test',password:'Member-Test-2026!'}});
        const token=login.response.headers.getSetCookie().find(value=>value.startsWith('User_Token=')).split(';')[0].split('=')[1];
        await request('/api/logout.php',{as:null,headers:{Authorization:'Bearer '+token},data:{}});
        await request('/management/get_audit_logs_api.php',{as:null,headers:{Authorization:'Bearer '+token},status:401});
        assert.equal(snapshot().logs.at(-1).event,'auth.logout');assert.ok(!JSON.stringify(snapshot().logs).includes(token));
    });
    await check('logout revokes Cookie and Bearer sessions and clears cookies even if audit writes fail',async()=>{
        for(const bearer of [false,true]){
            const login=await request('/api/auth_login.php',{as:null,data:{username:'admin@example.test',password:'Member-Test-2026!'}});
            const token=login.response.headers.getSetCookie().find(value=>value.startsWith('User_Token=')).split(';')[0].split('=')[1];
            const auth=bearer?{as:null,headers:{Authorization:'Bearer '+token}}:{as:null,cookie:'User_Token='+token};
            cli('tests/audit-fixture.php','reject-audit');
            try {
                const result=await request('/api/logout.php',{...auth,data:{}});
                assert.equal(result.body.status,'success');
                assert.ok(result.response.headers.getSetCookie().some(value=>value.startsWith('User_Token=')&&/expires=/i.test(value)));
                await request('/management/get_audit_logs_api.php',{...auth,status:401});
            } finally {cli('tests/audit-fixture.php','allow-audit');}
        }
    });
    await check('Google first-link wrong passwords and throttled retries each record one anonymous failure without credentials',async()=>{
        const email=`qa-google-${Date.now()}-external@example.org`;
        cli('tests/google-signup-fixture.php','external',email);
        const flow=JSON.parse(cli('tests/google-signup-fixture.php','pending',email,'link'));
        const before=snapshot().logs.length;
        for(let i=0;i<10;i++)await request('/api/auth_google_signup.php',{as:null,cookie:flow.cookie,data:{csrf:flow.csrf,password:'synthetic-wrong-link-password'},status:401});
        await request('/api/auth_google_signup.php',{as:null,cookie:flow.cookie,data:{csrf:flow.csrf,password:'Google-Link-Test-2026!'},status:429});
        const logs=snapshot().logs.slice(before);assert.equal(logs.length,11);
        assert.ok(logs.every(row=>row.event==='auth.login_failed'&&row.actor_id===null&&row.outcome==='failure'&&JSON.parse(row.metadata).method==='google'));
        for(const secret of [email,flow.csrf,flow.cookie,'synthetic-wrong-link-password','Google-Link-Test-2026!'])assert.ok(!JSON.stringify(logs).includes(secret));
        cli('tests/audit-fixture.php','reject-audit');
        try {await request('/api/auth_login.php',{as:null,data:{username:'admin@example.test',password:'synthetic-wrong-password'},status:401});}
        finally {cli('tests/audit-fixture.php','allow-audit');}
    });
    console.log(`Audit logs: ${passed} groups passed`);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{server?.kill();if(created)try{cli('tests/member-fixture.php','drop');}catch(error){console.error(error);process.exitCode=1;}fs.rmSync(sessions,{recursive:true,force:true});});
