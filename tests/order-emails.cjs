const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const port=Number(process.env.ORDER_TEST_PORT||8094),base=`http://localhost:${port}`;
const env={...process.env,DB_DATABASE:`eoffice_orders_${process.pid}_test`,APP_URL:base,EOFFICE_MOCK_SERVICES:'true',EOFFICE_SETTINGS_KEY:crypto.randomBytes(32).toString('base64'),EOFFICE_STORAGE:path.join(os.tmpdir(),'opencode',`eoffice-orders-${process.pid}`,'storage')};
let servers=[],created=false,users,pdf,passed=0;
function fixture(action){const r=cp.spawnSync(php,['tests/order-email-fixture.php',action],{env,encoding:'utf8'});if(r.status!==0)throw Error(r.stdout+r.stderr);return r.stdout;}
function snapshot(){return JSON.parse(fixture('snapshot'));}
async function request(route,{as='admin',data,form,status=200,headers={}}={}){const r=await fetch(base+route,{method:data||form?'POST':'GET',headers:{...headers,...(as?{Cookie:users[as].cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:form||(data?JSON.stringify(data):undefined)});const text=await r.text();assert.equal(r.status,status,`${route}: ${text}`);return JSON.parse(text);}
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
function race(action){const r=cp.spawnSync(php,['tests/order-email-races.php',action],{env,encoding:'utf8'});if(r.status!==0)throw Error(r.stdout+r.stderr);return r.stdout;}
function raceProcess(...args){return cp.spawn(php,['tests/order-email-races.php',...args],{env,stdio:['pipe','pipe','pipe']});}
function processOutput(process){return new Promise((resolve,reject)=>{let out='',err='';process.stdout.on('data',data=>out+=data);process.stderr.on('data',data=>err+=data);process.once('error',reject);process.once('exit',code=>code===0?resolve(out):reject(Error(err+out)));});}
async function waitRaceBlocked(phase){for(let i=0;i<40;i++){if(Number(race('blocked-'+phase))>0)return;await new Promise(r=>setTimeout(r,100));}throw Error('Could not establish '+phase+' race');}
function form(values,files=[]){const f=new FormData();for(const [key,value] of Object.entries(values)){if(Array.isArray(value))value.forEach(v=>f.append(key+'[]',String(v)));else f.append(key,String(value));}files.forEach((file,i)=>{f.append('doc_file_name[]','PDF '+(i+1));f.append('file_id[]','0');f.append('doc_upload[]',new Blob([file],{type:'application/pdf'}),'order-'+i+'.pdf');});return f;}
let number=0;
async function create(files=[],extra={}){return request('/api/create_document.php',{as:'owner',form:form({doc_number:'ORDER-QA-'+(++number),doc_name:'Synthetic order',doc_type:'คำสั่ง',doc_date_receive:'2026-10-08',...extra},files)});}
const setting=async extra=>{const current=await request('/email_send/ai_settings.php');return request('/email_send/ai_settings.php',{data:{action:'save',model:'gemini-test',enabled:true,revision:current.settings.revision,...extra}});};
async function run(){
    const seed=JSON.parse(fixture('seed'));created=true;users=seed.users;pdf=Buffer.from(seed.pdf,'base64');env.EOFFICE_TEST_AI_RECIPIENTS=JSON.stringify([users.alice.id,users.bob.id]);
    servers=[cp.spawn(php,['-S',`localhost:${port}`,'scripts/router.php'],{env,stdio:'ignore'})];let ready=false;
    for(let i=0;i<50;i++){try{await fetch(base+'/api/me.php');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready);
    let old,newDoc,waitingDoc;
    await test('only highest Admin can read or change AI settings',async()=>{await request('/email_send/ai_settings.php',{as:null,status:401});await request('/email_send/ai_settings.php',{as:'staff',status:403});await request('/email_send/ai_settings.php',{as:'owner',status:403});await request('/email_send/ai_settings.php',{as:'staff',data:{action:'save',model:'gemini-test',enabled:true},status:403});});
    await test('same-origin protection applies to AI settings',async()=>{await request('/email_send/ai_settings.php',{data:{action:'save',model:'gemini-test',enabled:true},headers:{Origin:'https://foreign.example'},status:403});});
    await test('order before first activation never auto-queues',async()=>{old=await create([pdf]);assert.equal(snapshot().eoffice_order_jobs.length,0);});
    const testKey='synthetic-test-key-not-a-real-credential';
    await test('Admin stores encrypted key and public API never returns it',async()=>{const result=await setting({api_key:testKey});assert.ok(result.settings.activated_at);assert.equal(result.settings.key_configured,true);assert.ok(!JSON.stringify(result).includes(testKey));const cipher=snapshot().eoffice_order_settings[0].api_key_cipher;assert.ok(cipher&&!cipher.includes(testKey));const get=await request('/email_send/ai_settings.php');assert.ok(!JSON.stringify(get).includes(cipher));});
    await test('model list and test use protected Admin endpoints',async()=>{assert.equal((await request('/email_send/ai_settings.php',{data:{action:'models'}})).models[0].id,'gemini-test');await request('/email_send/ai_settings.php',{data:{action:'test',model:'gemini-test'}});await request('/email_send/ai_settings.php',{data:{action:'save',model:'../../bad',enabled:true},status:400});});
    await test('new order queues explicit recipients without sending from web request',async()=>{newDoc=await create([pdf,pdf],{send_to:[users.alice.id]});const s=snapshot();assert.equal(s.eoffice_order_jobs.length,1);assert.equal(s.eoffice_order_jobs[0].doc_id,newDoc.doc_id);assert.equal(s.eoffice_order_recipients.length,1);assert.equal(s.eoffice_order_recipients[0].source,'document');assert.equal(s.eoffice_order_recipients[0].status,'pending');const notification=s.eoffice_outbox.map(row=>JSON.parse(row.payload)).find(p=>p.type==='document_notification');assert.equal(notification.delivery.mail.status,'skipped');});
    await test('old order edit does not enroll it automatically',async()=>{await create([],{formtype:'edit_document',doc_id:old.doc_id,doc_file_name:[],file_id:[]});assert.equal((await request('/email_send/order_jobs.php?doc_id='+old.doc_id)).job,null);});
    await test('new order without PDF waits and later upload activates it',async()=>{waitingDoc=await create();assert.equal((await request('/email_send/order_jobs.php?doc_id='+waitingDoc.doc_id)).job.status,'waiting_files');await create([pdf],{formtype:'edit_document',doc_id:waitingDoc.doc_id});assert.equal((await request('/email_send/order_jobs.php?doc_id='+waitingDoc.doc_id)).job.status,'analyzing');});
    await test('cron processes every PDF and my orders exposes all PDF links',async()=>{fixture('worker');const detail=await request('/email_send/order_jobs.php?doc_id='+newDoc.doc_id);assert.equal(detail.files.length,2);assert.equal(detail.recipients.filter(r=>r.status==='success').length,2);const mine=await request('/email_send/api_get_my_docs.php?year=all',{as:'alice'});assert.equal(mine.data.find(d=>d.doc_id===newDoc.doc_id).files.length,2);const s=snapshot();assert.equal(s.eoffice_outbox.map(row=>JSON.parse(row.payload)).filter(p=>p.type==='mail').length,4);fixture('worker');assert.equal(snapshot().eoffice_outbox.length,s.eoffice_outbox.length);});
    await test('pause/resume retains activation and captures new waiting jobs',async()=>{const first=(await request('/email_send/ai_settings.php')).settings.activated_at;await setting({enabled:false});const paused=await create([pdf]);fixture('worker');assert.equal((await request('/email_send/order_jobs.php?doc_id='+paused.doc_id)).recipients.length,0);await setting();assert.equal((await request('/email_send/ai_settings.php')).settings.activated_at,first);});
    await test('staff can import old orders idempotently but basic users cannot',async()=>{await request('/email_send/order_jobs.php',{as:'owner',data:{doc_id:old.doc_id,action:'enqueue'},status:403});await request('/email_send/order_jobs.php',{as:'staff',data:{doc_id:old.doc_id,action:'enqueue'}});const first=(await request('/email_send/order_jobs.php?doc_id='+old.doc_id)).job;await request('/email_send/order_jobs.php',{as:'staff',data:{doc_id:old.doc_id,action:'enqueue'}});assert.equal((await request('/email_send/order_jobs.php?doc_id='+old.doc_id)).job.id,first.id);});
    await test('manual addition and cancellation persist through analysis',async()=>{await request('/email_send/order_jobs.php',{data:{doc_id:old.doc_id,action:'add_recipient',email:'bob@example.test'}});const detail=await request('/email_send/order_jobs.php?doc_id='+old.doc_id);const bob=detail.recipients.find(r=>r.user_id===users.bob.id);await request('/email_send/order_jobs.php',{data:{doc_id:old.doc_id,action:'cancel_recipient',recipient_id:bob.id}});fixture('worker');const after=await request('/email_send/order_jobs.php?doc_id='+old.doc_id);assert.equal(after.recipients.find(r=>r.user_id===users.bob.id).status,'cancelled');});
    await test('successful recipients cannot be resent and reanalysis requires confirmation',async()=>{const detail=await request('/email_send/order_jobs.php?doc_id='+newDoc.doc_id);await request('/email_send/order_jobs.php',{data:{doc_id:newDoc.doc_id,action:'retry_recipient',recipient_id:detail.recipients[0].id,confirmed:true},status:409});await request('/email_send/order_jobs.php',{data:{doc_id:newDoc.doc_id,action:'reanalyze'},status:409});});
    await test('job filtering and protected detail endpoints work',async()=>{await request('/email_send/order_jobs.php?doc_id='+old.doc_id,{as:'owner',status:403});const list=await request('/email_send/order_jobs.php?year=2569&search=ORDER-QA');assert.ok(list.data.length>0);assert.equal(list.is_admin,true);});
    await test('clear stored key is masked and heartbeat remains visible',async()=>{const result=await setting({clear_key:true,enabled:false});assert.equal(result.settings.key_configured,false);assert.ok(result.settings.worker_at);});
    await test('Admin can pause or replace credentials even when old cipher is unreadable',async()=>{fixture('corrupt-key');await setting({enabled:false});await setting({api_key:testKey});assert.equal((await request('/email_send/ai_settings.php')).settings.key_configured,true);});
    await test('stale settings cannot undo a pause even after same-second updates',async()=>{
        const before=(await request('/email_send/ai_settings.php')).settings;await setting({enabled:false});
        await request('/email_send/ai_settings.php',{data:{action:'save',model:'gemini-test',enabled:true,revision:before.revision},status:409});
        assert.equal((await request('/email_send/ai_settings.php')).settings.enabled,false);
        const paused=(await request('/email_send/ai_settings.php')).settings;await setting({enabled:false});
        await request('/email_send/ai_settings.php',{data:{action:'save',model:'gemini-test',enabled:true,revision:paused.revision},status:409});
        await request('/email_send/ai_settings.php',{data:{action:'save',model:'gemini-test',enabled:true},status:409});
        await setting();
    });
    await test('settings pause committed during save returns conflict instead of restarting delivery',async()=>{
        const before=(await request('/email_send/ai_settings.php')).settings;
        const blocker=cp.spawn(php,['tests/order-email-fixture.php','pause-lock'],{env,stdio:['pipe','pipe','pipe']});
        let save;
        try{
            await new Promise((resolve,reject)=>{blocker.stdout.once('data',resolve);blocker.once('error',reject);});
            save=request('/email_send/ai_settings.php',{data:{action:'save',model:'gemini-test',enabled:true,revision:before.revision},status:409});
            let blocked=false;for(let i=0;i<30;i++){if(fixture('blocked-save').trim()==='1'){blocked=true;break;}await new Promise(r=>setTimeout(r,100));}
            assert.ok(blocked,'save is waiting for settings row lock');blocker.stdin.end('pause\n');await save;
            assert.equal((await request('/email_send/ai_settings.php')).settings.enabled,false);
        }finally{blocker.stdin.end();blocker.kill();if(save)await save.catch(()=>{});}
        await setting();
    });
    await test('explicit document recipient is delivered even when AI finds nobody',async()=>{
        const doc=await create([pdf],{send_to:[users.bob.id]});fixture('worker-empty');
        const detail=await request('/email_send/order_jobs.php?doc_id='+doc.doc_id);
        assert.equal(detail.job.status,'success');assert.equal(detail.recipients.length,1);assert.equal(detail.recipients[0].user_id,users.bob.id);assert.equal(detail.recipients[0].status,'success');
    });
    await test('cancelled jobs cannot be restarted by adding one recipient',async()=>{
        const doc=await create([pdf],{send_to:[users.alice.id]});await request('/email_send/order_jobs.php',{data:{doc_id:doc.doc_id,action:'cancel_job'}});
        await request('/email_send/order_jobs.php',{data:{doc_id:doc.doc_id,action:'add_recipient',email:'bob@example.test'},status:409});fixture('worker');
        const detail=await request('/email_send/order_jobs.php?doc_id='+doc.doc_id);assert.equal(detail.job.status,'cancelled');assert.equal(detail.recipients[0].status,'cancelled');
        await request('/email_send/order_jobs.php',{data:{doc_id:doc.doc_id,action:'retry_recipient',recipient_id:detail.recipients[0].id,confirmed:true},status:409});
        await request('/email_send/order_jobs.php',{data:{doc_id:doc.doc_id,action:'reanalyze',confirmed:true}});fixture('worker-empty');
        const after=await request('/email_send/order_jobs.php?doc_id='+doc.doc_id);assert.equal(after.recipients.find(r=>r.user_id===users.alice.id).status,'cancelled');
        assert.equal(after.job.status,'review');assert.equal(after.job.error_code,'no_pending_recipients');
        await request('/email_send/order_jobs.php',{data:{doc_id:doc.doc_id,action:'retry_recipient',recipient_id:detail.recipients[0].id,confirmed:true}});fixture('worker-empty');
        assert.equal((await request('/email_send/order_jobs.php?doc_id='+doc.doc_id)).recipients.find(r=>r.user_id===users.alice.id).status,'success');
    });
    await test('explicit selection of existing AI recipient survives new AI results',async()=>{
        const doc=await create([pdf]);fixture('prepare-ai:'+doc.doc_id);const detail=await request('/email_send/order_jobs.php?doc_id='+doc.doc_id);
        assert.equal(detail.recipients[0].source,'ai');
        await request('/email_send/order_jobs.php',{data:{doc_id:doc.doc_id,action:'add_recipient',email:'alice@example.test'}});
        await request('/email_send/order_jobs.php',{data:{doc_id:doc.doc_id,action:'reanalyze',confirmed:true}});
        const promoted=await request('/email_send/order_jobs.php?doc_id='+doc.doc_id);assert.equal(promoted.recipients.find(r=>r.user_id===users.alice.id).source,'manual');
        fixture('worker-empty');const after=await request('/email_send/order_jobs.php?doc_id='+doc.doc_id);assert.equal(after.recipients.find(r=>r.user_id===users.alice.id).status,'success');
    });
    await test('adding a new recipient resumes no-pending review without reviving cancelled recipients',async()=>{
        const doc=await create([pdf],{send_to:[users.alice.id]});await request('/email_send/order_jobs.php',{data:{doc_id:doc.doc_id,action:'cancel_job'}});
        await request('/email_send/order_jobs.php',{data:{doc_id:doc.doc_id,action:'reanalyze',confirmed:true}});fixture('worker-empty');
        const before=await request('/email_send/order_jobs.php?doc_id='+doc.doc_id);assert.equal(before.job.error_code,'no_pending_recipients');
        await request('/email_send/order_jobs.php',{data:{doc_id:doc.doc_id,action:'add_recipient',email:'bob@example.test'}});
        assert.equal((await request('/email_send/order_jobs.php?doc_id='+doc.doc_id)).job.status,'queued');fixture('worker-empty');
        const after=await request('/email_send/order_jobs.php?doc_id='+doc.doc_id);assert.equal(after.job.status,'success');assert.equal(after.recipients.find(r=>r.user_id===users.bob.id).status,'success');assert.equal(after.recipients.find(r=>r.user_id===users.alice.id).status,'cancelled');
    });
    await test('document save also resumes no-pending review for newly selected recipients',async()=>{
        const doc=await create([pdf],{send_to:[users.alice.id]});await request('/email_send/order_jobs.php',{data:{doc_id:doc.doc_id,action:'cancel_job'}});
        await request('/email_send/order_jobs.php',{data:{doc_id:doc.doc_id,action:'reanalyze',confirmed:true}});fixture('worker-empty');
        await create([],{formtype:'edit_document',doc_id:doc.doc_id,send_to:[users.alice.id,users.bob.id]});fixture('worker-empty');
        const after=await request('/email_send/order_jobs.php?doc_id='+doc.doc_id);assert.equal(after.recipients.find(r=>r.user_id===users.bob.id).status,'success');assert.equal(after.recipients.find(r=>r.user_id===users.alice.id).status,'cancelled');
    });
    await test('email PDF links for padded legacy years open with the canonical year',async()=>{
        const doc=await create([pdf]);const {file_name}=JSON.parse(fixture('pad-year:'+doc.doc_id));
        const path=`/api/view_file.php?Doc_Id=${doc.doc_id}&File_Path=${encodeURIComponent(file_name)}`;
        const response=await fetch(base+path+'&Year=2569');assert.equal(response.status,200);assert.match(await response.text(),/^%PDF/);
        assert.equal((await fetch(base+path+'&Year=2568')).status,403);
    });
    await test('removing an explicit recipient after the sending marker prevents SMTP',async()=>{
        fixture('worker');const doc=await create([pdf],{send_to:[users.bob.id]});race('setup');
        const gate=raceProcess('gate');let worker,revoker;const outcomes=[];
        try{
            await new Promise((resolve,reject)=>{gate.stdout.once('data',resolve);gate.once('error',reject);});
            worker=raceProcess('worker');const workerResult=processOutput(worker);outcomes.push(workerResult);await waitRaceBlocked('marker');
            revoker=raceProcess('revoke',String(doc.doc_id));const revokeResult=processOutput(revoker);outcomes.push(revokeResult);await waitRaceBlocked('document');
            gate.stdin.end('release\n');const revoked=JSON.parse(await revokeResult);assert.equal(revoked.status_at_revoke,'sending');
            assert.deepEqual(JSON.parse(await workerResult).sent,[]);
            const detail=await request('/email_send/order_jobs.php?doc_id='+doc.doc_id);assert.equal(detail.recipients[0].status,'cancelled');assert.equal(detail.recipients[0].error_code,'recipient_revoked');
        }finally{gate.kill();worker?.kill();revoker?.kill();await Promise.all(outcomes.map(p=>p.catch(()=>{})));race('cleanup');}
    });
    console.log(fixture('behavior').trim());console.log(`Order HTTP: ${passed} passed`);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{servers.forEach(server=>server.kill());if(created)fixture('drop');require('node:fs').rmSync(path.dirname(env.EOFFICE_STORAGE),{recursive:true,force:true});});
