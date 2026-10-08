const assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const port=Number(process.env.SIGN_RACE_TEST_PORT||8097),base=`http://localhost:${port}`;
const storage=path.join(os.tmpdir(),'opencode',`eoffice-sign-races-${process.pid}`);
const env={...process.env,DB_DATABASE:`eoffice_members_${process.pid}_test`,APP_URL:base,EOFFICE_MOCK_SERVICES:'true',EOFFICE_STORAGE:storage,EOFFICE_MEMBER_VERSION_KEY:crypto.randomBytes(32).toString('base64'),EOFFICE_SIGN_ROUTES:'{"2":1}'};
const helpers=new Set();let servers=[],users,created=false,passed=0;
function cli(action,file='tests/sign-concurrency-helper.php'){
    const result=cp.spawnSync(php,[file,action],{env,encoding:'utf8'});
    if(result.status!==0)throw Error(result.stdout+result.stderr);
    return result.stdout;
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function hold(action,marker){
    const child=cp.spawn(php,['tests/sign-concurrency-helper.php',action],{env,stdio:['pipe','pipe','pipe']});helpers.add(child);
    let output='',errors='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
    const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>{helpers.delete(child);code===0?resolve(output):reject(Error(output+errors));});});done.catch(()=>{});
    await Promise.race([done.then(()=>{throw Error('Helper exited before lock stage');}),new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Helper lock timeout: '+output+errors)),10000);
        child.stdout.on('data',()=>{if(output.includes(marker)){clearTimeout(timer);resolve();}});
    })]);
    return async()=>{child.stdin.write('release\n');return done;};
}
async function waitFor(action){
    for(let i=0;i<60;i++){if(Number(cli(action))>0)return;await sleep(50);}
    throw Error('Writer did not reach expected database gate: '+action);
}
async function request(route,{as='manager',data,body,status=200,worker=0,raw=false}={}){
    const response=await fetch(`http://localhost:${port+worker}`+route,{method:data||body?'POST':'GET',headers:{Cookie:users[as].cookie,...(data?{'Content-Type':'application/json'}:{})},body:body||(data?JSON.stringify(data):undefined)});
    if(raw){assert.equal(response.status,status);return {bytes:Buffer.from(await response.arrayBuffer()),revision:response.headers.get('X-Document-Revision')};}
    const text=await response.text();assert.equal(response.status,status,route+': '+text);return JSON.parse(text);
}
const view=(worker=0)=>request('/api/view_file.php?Doc_Id=1&File_Path=routing.pdf&Type=signed',{worker,raw:true});
function upload(bytes,revision,department){
    const body=new FormData();body.append('file',new Blob([bytes],{type:'application/pdf'}),'routing.pdf');body.append('Doc_Id','1');body.append('year','2569');body.append('revision',revision);
    if(department){body.append('receipt_departments',JSON.stringify([department]));body.append('confirm_receipt','1');}return body;
}
async function signed({worker=0,department,status=200,version,suffix='signed'}={}){
    const snapshot=version||await view(worker);const bytes=Buffer.concat([snapshot.bytes,Buffer.from(`\n% ${suffix}\n`)]);
    const result=await request('/e-sign/upload_pdf.php',{body:upload(bytes,snapshot.revision,department),worker,status});return {result,bytes};
}
async function routes(department='กลุ่มบริหารวิชาการ'){
    const current=await request('/management/get_sign_routes_api.php',{as:'admin'});
    return {routes:[{secretary_id:users.manager.id,department,deputy_id:users.admin.id}],route_version:current.route_version};
}
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
async function run(){
    users=JSON.parse(cli('seed','tests/sign-routing-fixture.php'));created=true;
    servers=[0,1,2].map(worker=>cp.spawn(php,['-S',`localhost:${port+worker}`,'scripts/router.php'],{env:{...env,APP_URL:`http://localhost:${port+worker}`},stdio:'ignore'}));
    for(let i=0;i<60;i++){try{await fetch(base+'/api/me.php');break;}catch{await sleep(50);}}
    await signed();const department='กลุ่มบริหารวิชาการ';
    await request('/management/save_sign_routes_api.php',{as:'admin',data:await routes()});
    await test('new Admin deputy FK and concurrent route save use gate -> users -> routes, without a deadlock',async()=>{
        const update=await routes();const release=await hold('receipt-before-admin','RECEIPT_GATE_HELD');
        const pending=request('/management/save_sign_routes_api.php',{as:'admin',data:update});
        await waitFor('gate-waits');const output=await release();await pending;
        assert.deepEqual(JSON.parse(output.trim().split('\n').at(-1)).added,[users.admin.id]);
    });
    await test('signing waits before user/document locks when Admin already holds the routing gate',async()=>{
        const snapshot=await view();const release=await hold('admin-before-receipt','ADMIN_GATE_HELD');
        const pending=signed({department,version:snapshot});await waitFor('gate-waits');await release();
        const result=await pending;assert.deepEqual(result.result.registered_receipt_departments,[department]);assert.deepEqual(result.result.auto_sent_user_ids,[]);
    });
    await test('DB auto-rollback cannot expose uncommitted bytes or let compensation overwrite a concurrent successful signature',async()=>{
        const snapshot=await view();const release=await hold('install-then-auto-rollback','DB_RELEASED_FILE_LOCK_HELD');
        let readCompleted=false;const reading=view(1).then(value=>{readCompleted=true;return value;});
        const writing=signed({worker:2,version:snapshot,suffix:'concurrent-success'});
        await sleep(150);assert.equal(readCompleted,false,'reader must wait for compensation, not return uncommitted PDF bytes');
        await release();const read=await reading;assert.ok(!read.bytes.includes(Buffer.from('UNCOMMITTED-FAILED')));
        const success=await writing;const final=await view();assert.deepEqual(final.bytes,success.bytes);
        assert.equal(final.revision,success.result.revision);
        const data=JSON.parse(cli('inspect','tests/sign-routing-fixture.php'));
        assert.equal(data.access.find(row=>row.User_Id===users.manager.id).Is_Signed,'true');
        assert.equal(data.signed_files[0].revision,final.revision);
        assert.equal(crypto.createHash('sha256').update(final.bytes).digest('hex'),data.signed_files[0].revision);
    });
    await test('real HTTP post-install SQL failure restores PDF and leaves receipt/outbox history unchanged',async()=>{
        const snapshot=await view(),before=JSON.parse(cli('inspect','tests/sign-routing-fixture.php'));
        cli('fail-next-signed-row');
        try{await signed({department,version:snapshot,status:500,suffix:'must-rollback'});}finally{cli('clear-failure');}
        const after=await view();assert.deepEqual(after.bytes,snapshot.bytes);assert.equal(after.revision,snapshot.revision);
        assert.deepEqual(JSON.parse(cli('inspect','tests/sign-routing-fixture.php')),before);
        const success=await signed({department,version:snapshot,suffix:'retry-after-restore'});assert.deepEqual((await view()).bytes,success.bytes);
    });
    await test('an actual InnoDB deadlock after PDF installation restores bytes and returns a retryable conflict',async()=>{
        const snapshot=await view(),before=JSON.parse(cli('inspect','tests/sign-routing-fixture.php'));
        cli('arm-deadlock');const release=await hold('deadlock-after-install','DEADLOCK_PARENT_HELD');
        try {
            const pending=signed({department,version:snapshot,status:409,suffix:'deadlock-victim'});
            await waitFor('gate-waits');await release();const failure=await pending;
            assert.match(failure.result.message,/ใช้งานพร้อมกัน/);
            const after=await view();assert.deepEqual(after.bytes,snapshot.bytes);assert.equal(after.revision,snapshot.revision);
            assert.deepEqual(JSON.parse(cli('inspect','tests/sign-routing-fixture.php')),before);
        }finally{cli('clear-failure');}
    });
    await test('receipt revocation is rejected before PDF publication',async()=>{
        const current=await request('/management/get_sign_routes_api.php',{as:'admin'});
        await request('/management/save_sign_routes_api.php',{as:'admin',data:{routes:[],route_version:current.route_version}});
        const snapshot=await view();await signed({department,version:snapshot,status:403,suffix:'unauthorized'});
        assert.deepEqual((await view()).bytes,snapshot.bytes);
    });
    console.log(`Signing concurrency: ${passed} passed`);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
    for(const child of helpers)child.kill();for(const server of servers)server.kill();
    if(created)cli('drop','tests/member-fixture.php');fs.rmSync(storage,{recursive:true,force:true});
});
