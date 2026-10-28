const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const port=Number(process.env.ORDER_TEST_PORT||8094),base=`http://localhost:${port}`;
const env={...process.env,DB_DATABASE:`eoffice_orders_${process.pid}_test`,APP_URL:base,EOFFICE_MOCK_SERVICES:'true',GEMINI_API_KEY:'synthetic-server-credential-for-tests',EOFFICE_SETTINGS_KEY:crypto.randomBytes(32).toString('base64'),EOFFICE_STORAGE:path.join(os.tmpdir(),'opencode',`eoffice-orders-${process.pid}`,'storage')};
let servers=[],created=false,users,pdf,passed=0;
function fixture(action){const r=cp.spawnSync(php,['tests/order-email-fixture.php',action],{env,encoding:'utf8'});if(r.status!==0)throw Error(r.stdout+r.stderr);return r.stdout;}
function snapshot(){return JSON.parse(fixture('snapshot'));}
async function request(route,{as='admin',data,form,status=200,headers={},raw=false}={}){const r=await fetch(base+route,{method:data||form?'POST':'GET',headers:{...headers,...(as?{Cookie:users[as].cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:form||(data?JSON.stringify(data):undefined)});const text=await r.text();assert.equal(r.status,status,`${route}: ${text}`);return raw?text:JSON.parse(text);}
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
    const historical=JSON.parse(fixture('history-seed'));
    await test('historical list deduplicates recipients across files and preserves last successful send time',async()=>{
        const list=await request('/email_send/order_jobs.php?year=2568&search=HISTORY-QA',{as:'staff'});
        assert.equal(list.total,3);
        const sent=list.data.find(row=>row.doc_id===historical.sent);
        assert.equal(sent.status,null);assert.equal(Number(sent.history_count),2);assert.equal(Number(sent.history_success_count),1);
        assert.equal(sent.history_sent_at,'2025-10-02 10:00:00');
        const review=list.data.find(row=>row.doc_id===historical.review);
        assert.equal(Number(review.history_count),1);assert.equal(Number(review.history_success_count),0);assert.equal(review.history_sent_at,null);
    });
    await test('historical filters exclude previous attempts from unqueued orders and respect year/search/page counts',async()=>{
        for(const [state,kind] of [['legacy_sent','sent'],['legacy_review','review'],['not_queued','empty']]){
            const list=await request('/email_send/order_jobs.php?year=2568&search=HISTORY-QA&state='+state);
            assert.equal(list.total,1);assert.equal(list.data[0].doc_id,historical[kind]);
            const next=await request('/email_send/order_jobs.php?year=2568&search=HISTORY-QA&state='+state+'&page=2');
            assert.equal(next.total,1);assert.deepEqual(next.data,[]);
        }
        assert.equal((await request('/email_send/order_jobs.php?year=2569&state=legacy_sent')).total,0);
    });
    await test('viewing historical recipients is authorized and read-only, with unknown results kept unconfirmed',async()=>{
        const before=snapshot();
        const sent=await request('/email_send/order_jobs.php?doc_id='+historical.sent,{as:'staff'});
        assert.equal(sent.job,null);assert.deepEqual(sent.recipients,[]);assert.equal(sent.history.length,2);
        const alice=sent.history.find(row=>row.recipient_email==='alice@example.test');
        assert.equal(Number(alice.sent),1);assert.equal(Number(alice.log_count),3);assert.equal(alice.sent_at,'2025-10-02 10:00:00');
        const review=await request('/email_send/order_jobs.php?doc_id='+historical.review);
        assert.equal(Number(review.history[0].sent),0);assert.equal(review.history[0].sent_at,null);
        assert.deepEqual(snapshot(),before,'GET history must not create jobs, recipients, audit events or mail');
        await request('/email_send/order_jobs.php?doc_id='+historical.sent,{as:'owner',status:403});
        await request('/email_send/order_jobs.php?doc_id='+historical.sent,{as:null,status:401});
    });
    await test('both enqueue routes require boolean confirmation for successful and unconfirmed history without writes',async()=>{
        const before=snapshot();
        for(const route of ['/email_send/order_jobs.php','/email_send/process_pdf.php'])for(const docId of [historical.sent,historical.review])for(const confirmed of [undefined,false,'true',1]){
            const result=await request(route,{as:'staff',data:{doc_id:docId,action:'enqueue',confirmed},status:409});
            assert.match(result.message,/มีประวัติส่งอีเมลแล้ว/);
        }
        assert.deepEqual(snapshot(),before,'rejected consent cannot enqueue, audit or send mail');
    });
    await test('historical enqueue requires explicit confirmation and retains current queue status with history',async()=>{
        await request('/email_send/order_jobs.php',{data:{doc_id:historical.sent,action:'enqueue'},status:409});
        assert.equal((await request('/email_send/order_jobs.php?doc_id='+historical.sent)).job,null);
        await request('/email_send/order_jobs.php',{data:{doc_id:historical.sent,action:'enqueue',confirmed:true}});
        const list=await request('/email_send/order_jobs.php?search=HISTORY-QA-sent');
        assert.equal(list.data[0].status,'queued');assert.equal(Number(list.data[0].history_success_count),1);
        assert.equal((await request('/email_send/order_jobs.php?state=legacy_sent&search=HISTORY-QA')).total,0);
        assert.equal((await request('/email_send/order_jobs.php?state=queued&search=HISTORY-QA')).total,1);
    });
    await test('compatibility enqueue accepts confirmed history, preserves SSE and is idempotent with the new route',async()=>{
        const beforeMail=snapshot().eoffice_outbox;
        for(const docId of [historical.sent,historical.review,historical.empty]){
            const text=await request('/email_send/process_pdf.php',{as:'staff',data:{doc_id:docId,...(docId===historical.empty?{}:{confirmed:true})},raw:true});
            const event=JSON.parse(text.trim().replace(/^data: /,''));assert.equal(event.summary.queued,true);assert.equal(event.summary.doc_id,docId);
            const first=(await request('/email_send/order_jobs.php?doc_id='+docId)).job;
            assert.equal(first.status,'queued');
            await request('/email_send/order_jobs.php',{data:{doc_id:docId,action:'enqueue'}});
            await request('/email_send/process_pdf.php',{data:{doc_id:docId},raw:true});
            assert.equal((await request('/email_send/order_jobs.php?doc_id='+docId)).job.id,first.id);
        }
        assert.deepEqual(snapshot().eoffice_outbox,beforeMail,'neither route submits SMTP from HTTP');
    });
    await test('compatibility enqueue cannot restart cancelled work and retains permission/origin checks',async()=>{
        await request('/email_send/order_jobs.php',{data:{doc_id:historical.review,action:'cancel_job'}});
        const before=snapshot();
        for(const route of ['/email_send/order_jobs.php','/email_send/process_pdf.php']){
            await request(route,{data:{doc_id:historical.review,action:'enqueue',confirmed:true},status:409});
            await request(route,{as:'owner',data:{doc_id:historical.sent,action:'enqueue',confirmed:true},status:403});
            await request(route,{as:null,data:{doc_id:historical.sent,action:'enqueue',confirmed:true},status:401});
            await request(route,{data:{doc_id:historical.sent,action:'enqueue',confirmed:true},headers:{Origin:'https://foreign.example'},status:403});
        }
        assert.deepEqual(snapshot(),before);
    });
    fixture('history-cleanup');
    const testKey='synthetic-test-key-not-a-real-credential';
    await test('extended settings protect secrets, validate templates and preview escaped content',async()=>{
        const r=await setting({enabled:false,options:{smtp_source:'admin',smtp_host:'smtp.example.test',smtp_port:465,smtp_security:'tls',smtp_username:'qa@example.test',smtp_from:'qa@example.test',intro:'<script>alert(1)</script> {doc_name}'},smtp_password:'synthetic-smtp-password'});
        assert.equal(r.settings.smtp_password_configured,true);assert.equal(r.settings.diagnostics.smtp.configured,true);
        assert.ok(!JSON.stringify(r).includes('synthetic-smtp-password'));assert.ok(!JSON.stringify(r).includes('smtp_password_cipher'));
        const preview=await request('/email_send/ai_settings.php',{data:{action:'preview'}});assert.ok(preview.body.includes('&lt;script&gt;'));
        const s=await request('/email_send/ai_settings.php');
        await request('/email_send/ai_settings.php',{data:{action:'save',model:'gemini-test',enabled:false,revision:s.settings.revision,options:{subject:'{unknown}'}},status:400});
        await request('/email_send/ai_settings.php',{data:{action:'save',model:'gemini-test',enabled:false,revision:s.settings.revision,options:{smtp_source:'admin',smtp_port:0}},status:400});
        await setting({enabled:false,options:{smtp_source:'server',intro:'เรียน {recipient_name}\nแจ้งคำสั่ง: {doc_name}'}});
    });
    await test('inactive Admin SMTP drafts cannot block server-mode saves or replace stored secrets',async()=>{
        const before=(await request('/email_send/ai_settings.php')).settings;
        const cipher=snapshot().eoffice_order_settings[0].smtp_password_cipher;
        const result=await setting({enabled:false,options:{smtp_source:'server',smtp_port:0,smtp_security:'invalid',smtp_from:'bad-email',smtp_host:'bad host'},smtp_password:'ignored-inactive-secret'});
        for(const key of ['smtp_host','smtp_port','smtp_security','smtp_username','smtp_from'])assert.equal(result.settings.options[key],before.options[key]);
        assert.equal(snapshot().eoffice_order_settings[0].smtp_password_cipher,cipher,'inactive draft cannot replace the encrypted password');
        assert.ok(!JSON.stringify(result).includes('ignored-inactive-secret'));
    });
    await test('Admin stores encrypted key and public API never returns it',async()=>{const result=await setting({api_key:testKey});assert.ok(result.settings.activated_at);assert.equal(result.settings.key_configured,true);assert.ok(!JSON.stringify(result).includes(testKey));const cipher=snapshot().eoffice_order_settings[0].api_key_cipher;assert.ok(cipher&&!cipher.includes(testKey));const get=await request('/email_send/ai_settings.php');assert.ok(!JSON.stringify(get).includes(cipher));});
    await test('model list and test use protected Admin endpoints',async()=>{assert.equal((await request('/email_send/ai_settings.php',{data:{action:'models'}})).models[0].id,'gemini-test');await request('/email_send/ai_settings.php',{data:{action:'test',model:'gemini-test'}});await request('/email_send/ai_settings.php',{data:{action:'save',model:'../../bad',enabled:true},status:400});});
    await test('SMTP and PDF diagnostics run separately without creating a document job',async()=>{
        const before=snapshot().eoffice_order_jobs.length;
        await request('/email_send/ai_settings.php',{data:{action:'smtp_test',test_email:'not-email'},status:400});
        const smtp=await request('/email_send/ai_settings.php',{data:{action:'smtp_test',test_email:'qa@example.test'}});assert.match(smtp.message,/จำลอง/);
        const cooldown=await request('/email_send/ai_settings.php',{data:{action:'smtp_check'},status:429});assert.ok(cooldown.retry_after>0&&cooldown.retry_after<=30);
        await request('/email_send/ai_settings.php',{data:{action:'pdf_test',model:'gemini-test',pdf_base64:Buffer.from('not PDF').toString('base64')},status:400});
        const result=await request('/email_send/ai_settings.php',{data:{action:'pdf_test',model:'gemini-test',pdf_base64:pdf.toString('base64')}});
        assert.equal(result.mentions[0].user_id,0);assert.equal(snapshot().eoffice_order_jobs.length,before);
        const get=await request('/email_send/ai_settings.php');assert.ok(get.settings.diagnostics.events.some(e=>e.event==='smtp_test'));
        assert.ok(get.settings.diagnostics.smtp_tested_at);assert.ok(Date.parse(get.settings.diagnostics.smtp_test_expires_at)>Date.now());
        assert.ok(!JSON.stringify(get).includes('fingerprint'));
    });
    await test('new order queues explicit recipients without sending from web request',async()=>{newDoc=await create([pdf,pdf],{send_to:[users.alice.id],doc_name:'Synthetic order แต่งตั้งคณะกรรมการ'});const s=snapshot();assert.equal(s.eoffice_order_jobs.length,1);assert.equal(s.eoffice_order_jobs[0].doc_id,newDoc.doc_id);assert.equal(s.eoffice_order_recipients.length,1);assert.equal(s.eoffice_order_recipients[0].source,'document');assert.equal(s.eoffice_order_recipients[0].status,'pending');const notification=s.eoffice_outbox.map(row=>JSON.parse(row.payload)).find(p=>p.type==='document_notification');assert.equal(notification.delivery.mail.status,'skipped');});
    await test('old order edit does not enroll it automatically',async()=>{await create([],{formtype:'edit_document',doc_id:old.doc_id,doc_file_name:[],file_id:[]});assert.equal((await request('/email_send/order_jobs.php?doc_id='+old.doc_id)).job,null);});
    await test('new order without PDF waits and later upload activates it',async()=>{waitingDoc=await create();assert.equal((await request('/email_send/order_jobs.php?doc_id='+waitingDoc.doc_id)).job.status,'waiting_files');await create([pdf],{formtype:'edit_document',doc_id:waitingDoc.doc_id});assert.equal((await request('/email_send/order_jobs.php?doc_id='+waitingDoc.doc_id)).job.status,'analyzing');});
    await test('cron processes every PDF and my orders exposes all PDF links',async()=>{fixture('worker');const detail=await request('/email_send/order_jobs.php?doc_id='+newDoc.doc_id);assert.equal(detail.files.length,2);assert.equal(detail.recipients.filter(r=>r.status==='success').length,2);const mine=await request('/email_send/api_get_my_docs.php?year=all',{as:'alice'});assert.equal(mine.data.find(d=>d.doc_id===newDoc.doc_id).files.length,2);const s=snapshot();assert.equal(s.eoffice_outbox.map(row=>JSON.parse(row.payload)).filter(p=>p.type==='mail').length,4);fixture('worker');assert.equal(snapshot().eoffice_outbox.length,s.eoffice_outbox.length);});
    await test('personal-order search filters all pages, escapes wildcards and stays recipient-scoped',async()=>{
        const all=await request('/email_send/api_get_my_docs.php?limit=200',{as:'alice'});
        const target=all.data.find(row=>row.doc_id===newDoc.doc_id);assert.ok(target);
        const search='Synthetic';
        const matches=all.data.filter(row=>row.doc_name.includes(search));assert.ok(matches.length>=2);
        const first=await request('/email_send/api_get_my_docs.php?limit=1&search='+search,{as:'alice'});
        const second=await request('/email_send/api_get_my_docs.php?limit=1&page=2&search='+search,{as:'alice'});
        assert.equal(first.pagination.total_items,matches.length);assert.equal(second.pagination.total_items,matches.length);
        assert.notEqual(first.data[0].doc_id,second.data[0].doc_id);
        const thai=await request('/email_send/api_get_my_docs.php?search='+encodeURIComponent('แต่งตั้งคณะกรรมการ'),{as:'alice'});
        assert.equal(thai.pagination.total_items,1);assert.equal(thai.data[0].doc_id,newDoc.doc_id);
        const numberSearch=encodeURIComponent(target.external_number+'/'+target.doc_year);
        const byNumber=await request('/email_send/api_get_my_docs.php?year='+target.doc_year+'&search='+numberSearch,{as:'alice'});
        assert.ok(byNumber.data.some(row=>row.doc_id===newDoc.doc_id));
        assert.equal((await request('/email_send/api_get_my_docs.php?year=1900&search='+search,{as:'alice'})).pagination.total_items,0);
        for(const text of ['no-such-personal-order','%','_','!',"' OR 1=1 --"]){
            const result=await request('/email_send/api_get_my_docs.php?search='+encodeURIComponent(text),{as:'alice'});
            assert.equal(result.pagination.total_items,0,text);assert.deepEqual(result.data,[]);
        }
        assert.equal((await request('/email_send/api_get_my_docs.php?search='+search,{as:'owner'})).pagination.total_items,0);
        await request('/email_send/api_get_my_docs.php?search='+search,{as:null,status:401});
    });
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
    await test('staff approval endpoint binds analyzed files and allows deliberate release',async()=>{
        fixture('worker');await setting({options:{require_approval:true}});
        const doc=await create([pdf]);fixture('worker');
        const detail=await request('/email_send/order_jobs.php?doc_id='+doc.doc_id);assert.equal(detail.job.status,'awaiting_approval');
        await request('/email_send/order_jobs.php',{as:'staff',data:{doc_id:doc.doc_id,action:'approve'},status:409});
        await request('/email_send/order_jobs.php',{as:'owner',data:{doc_id:doc.doc_id,action:'approve',confirmed:true},status:403});
        await request('/email_send/order_jobs.php',{as:'staff',data:{doc_id:doc.doc_id,action:'approve',confirmed:true,review_token:'stale-token'},status:409});
        await request('/email_send/order_jobs.php',{as:'staff',data:{doc_id:doc.doc_id,action:'approve',confirmed:true,review_token:detail.review_token}});
        fixture('worker');assert.equal((await request('/email_send/order_jobs.php?doc_id='+doc.doc_id)).job.status,'success');
        const paused=await create([pdf]);fixture('worker');
        await setting({options:{require_approval:false}});assert.equal((await request('/email_send/order_jobs.php?doc_id='+paused.doc_id)).job.status,'queued');fixture('worker');
    });
    await test('analysis-only jobs resume when sending is enabled and preserve activation',async()=>{
        const first=(await request('/email_send/ai_settings.php')).settings.activated_at;
        await setting({options:{analysis_only:true}});const doc=await create([pdf]);fixture('worker');
        assert.equal((await request('/email_send/order_jobs.php?doc_id='+doc.doc_id)).job.error_code,'analysis_only');
        await request('/email_send/order_jobs.php',{as:'staff',data:{doc_id:doc.doc_id,action:'approve',confirmed:true},status:409});
        await setting({options:{analysis_only:false}});assert.equal((await request('/email_send/order_jobs.php?doc_id='+doc.doc_id)).job.status,'queued');fixture('worker');
        assert.equal((await request('/email_send/order_jobs.php?doc_id='+doc.doc_id)).job.status,'success');assert.equal((await request('/email_send/ai_settings.php')).settings.activated_at,first);
    });
    await test('destination policy reconciles approval holds across analysis-only transitions',async()=>{
        await setting({options:{analysis_only:false,require_approval:true}});const doc=await create([pdf]);fixture('worker');
        assert.equal((await request('/email_send/order_jobs.php?doc_id='+doc.doc_id)).job.error_code,'approval_required');
        await setting({options:{analysis_only:true,require_approval:false}});
        assert.equal((await request('/email_send/order_jobs.php?doc_id='+doc.doc_id)).job.error_code,'analysis_only');
        await setting({options:{analysis_only:false,require_approval:true}});
        assert.equal((await request('/email_send/order_jobs.php?doc_id='+doc.doc_id)).job.error_code,'approval_required');
        await setting({options:{analysis_only:true,require_approval:false}});
        await setting({options:{analysis_only:false,require_approval:false}});
        assert.equal((await request('/email_send/order_jobs.php?doc_id='+doc.doc_id)).job.status,'queued');
        fixture('worker');assert.equal((await request('/email_send/order_jobs.php?doc_id='+doc.doc_id)).job.status,'success');
    });
    await test('an Admin policy save cannot miss a worker hold that is still being written',async()=>{
        await setting({options:{analysis_only:false,require_approval:true}});
        const doc=await create([pdf],{send_to:[users.alice.id]});race('setup-policy');
        const gate=raceProcess('gate');let worker,save;const outcomes=[];
        try{
            await new Promise((resolve,reject)=>{gate.stdout.once('data',resolve);gate.once('error',reject);});
            worker=raceProcess('worker');const workerResult=processOutput(worker);outcomes.push(workerResult);await waitRaceBlocked('marker');
            const current=(await request('/email_send/ai_settings.php')).settings;
            save=request('/email_send/ai_settings.php',{data:{action:'save',revision:current.revision,enabled:true,model:'gemini-test',options:{require_approval:false,analysis_only:false}}});
            outcomes.push(save);
            let blocked=false;for(let i=0;i<30;i++){if(fixture('blocked-save').trim()==='1'){blocked=true;break;}await new Promise(r=>setTimeout(r,100));}
            assert.ok(blocked,'settings save must wait for the worker policy transaction');
            gate.stdin.end('release\n');assert.deepEqual(JSON.parse(await workerResult).sent,[]);await save;
            assert.equal((await request('/email_send/order_jobs.php?doc_id='+doc.doc_id)).job.status,'queued');
            race('cleanup');fixture('worker');assert.equal((await request('/email_send/order_jobs.php?doc_id='+doc.doc_id)).job.status,'success');
        }finally{gate.kill();worker?.kill();await Promise.all(outcomes.map(p=>p.catch(()=>{})));race('cleanup');}
    });
    await test('approval preparation failures return a document error and release the advisory lock',async()=>{
        await setting({options:{require_approval:true,analysis_only:false}});const doc=await create([pdf],{send_to:[users.alice.id]});fixture('worker');
        const detail=await request('/email_send/order_jobs.php?doc_id='+doc.doc_id);assert.equal(detail.job.status,'awaiting_approval');
        fixture('remove-approval-pdf:'+doc.doc_id);
        const failed=await request('/email_send/order_jobs.php',{as:'staff',data:{action:'approve',doc_id:doc.doc_id,confirmed:true,review_token:detail.review_token},status:409});
        assert.equal(failed.code,'pdf_unavailable');
        assert.equal((await request('/email_send/order_jobs.php?doc_id='+doc.doc_id)).job.status,'awaiting_approval');
        await request('/email_send/order_jobs.php',{as:'staff',data:{action:'cancel_job',doc_id:doc.doc_id}});
        await setting({options:{require_approval:false}});
    });
    await test('named key vault supports safe activation, stale writes, pause, delete and explicit server return',async()=>{
        const current=(await request('/email_send/ai_settings.php')).settings;
        const secret='synthetic-keyring-credential-for-tests';
        const add=await request('/email_send/ai_settings.php',{data:{action:'key_add',revision:current.revision,label:'School backup',api_key:secret,remind_days:30}});
        const entry=add.settings.keyring.keys.find(k=>k.label==='School backup');assert.ok(entry);assert.match(entry.reference,/^key_[a-f0-9]{16}$/);assert.equal(entry.active,false);
        assert.ok(!JSON.stringify(add).includes(secret));assert.ok(!JSON.stringify(add).includes('cipher'));assert.ok(!JSON.stringify(add).includes('fingerprint'));
        await request('/email_send/ai_settings.php',{as:'staff',data:{action:'key_delete',revision:add.settings.revision,key_id:entry.id,confirmed:true},status:403});
        await request('/email_send/ai_settings.php',{data:{action:'key_test',revision:add.settings.revision,key_id:entry.id,model:'../../bad'},status:400});
        await request('/email_send/ai_settings.php',{data:{action:'key_activate',revision:current.revision,key_id:entry.id,model:'gemini-test',confirmed:true},status:409});
        let result=await request('/email_send/ai_settings.php',{data:{action:'key_test',revision:add.settings.revision,key_id:entry.id,model:'gemini-test'}});
        assert.ok(result.settings.keyring.keys.find(k=>k.id===entry.id).tested_at);
        result=await request('/email_send/ai_settings.php',{data:{action:'key_activate',revision:result.settings.revision,key_id:entry.id,model:'gemini-test',confirmed:true}});
        assert.equal(result.settings.keyring.keys.find(k=>k.id===entry.id).active,true);assert.equal(result.settings.enabled,true);
        await request('/email_send/ai_settings.php',{data:{action:'key_delete',revision:result.settings.revision,key_id:entry.id,confirmed:true},status:409});
        await request('/email_send/ai_settings.php',{data:{action:'key_update',revision:result.settings.revision,key_id:entry.id,label:'Paused',remind_days:30,key_enabled:false},status:409});
        const other=result.settings.keyring.keys.find(k=>!k.active&&k.enabled&&k.usable);assert.ok(other);
        result=await request('/email_send/ai_settings.php',{data:{action:'key_activate',revision:result.settings.revision,key_id:other.id,model:'gemini-test',confirmed:true}});
        result=await request('/email_send/ai_settings.php',{data:{action:'key_update',revision:result.settings.revision,key_id:entry.id,label:'Retired school backup',remind_days:60,key_enabled:false}});
        await request('/email_send/ai_settings.php',{data:{action:'key_activate',revision:result.settings.revision,key_id:entry.id,model:'gemini-test',confirmed:true},status:400});
        result=await request('/email_send/ai_settings.php',{data:{action:'key_delete',revision:result.settings.revision,key_id:entry.id,confirmed:true}});assert.ok(!result.settings.keyring.keys.some(k=>k.id===entry.id));
        result=await request('/email_send/ai_settings.php',{data:{action:'key_add',revision:result.settings.revision,label:'Never tested reserve',api_key:'synthetic-untested-reserve'}});
        const untouched=result.settings.keyring.keys.find(k=>k.label==='Never tested reserve');assert.equal(untouched.tested_at,null);
        result=await request('/email_send/ai_settings.php',{data:{action:'key_server',key_id:untouched.id,revision:result.settings.revision,model:'gemini-test',confirmed:true}});
        const after=result.settings.keyring.keys.find(k=>k.id===untouched.id);
        assert.equal(after.tested_at,null,'server test cannot attribute results to an unrelated vault ID supplied by the client');
        assert.equal(after.tested_model,null);assert.equal(after.test_code,null);
        assert.equal(result.settings.key_source,'server');assert.equal(result.settings.keyring.server.active,true);assert.ok(!result.settings.keyring.keys.some(k=>k.active));
        assert.ok(!JSON.stringify(result).includes(env.GEMINI_API_KEY));
    });
    await test('key activation cannot undo a concurrent Admin pause',async()=>{
        const before=(await request('/email_send/ai_settings.php')).settings;
        const entry=before.keyring.keys.find(k=>k.enabled&&k.usable);assert.ok(entry);
        const blocker=cp.spawn(php,['tests/order-email-fixture.php','pause-lock'],{env,stdio:['pipe','pipe','pipe']});let activation;
        try{
            await new Promise((resolve,reject)=>{blocker.stdout.once('data',resolve);blocker.once('error',reject);});
            activation=request('/email_send/ai_settings.php',{data:{action:'key_activate',revision:before.revision,key_id:entry.id,model:'gemini-test',confirmed:true},status:409});
            let blocked=false;for(let i=0;i<30;i++){if(fixture('blocked-save').trim()==='1'){blocked=true;break;}await new Promise(r=>setTimeout(r,100));}
            assert.ok(blocked);blocker.stdin.end('pause\n');await activation;
            const after=(await request('/email_send/ai_settings.php')).settings;assert.equal(after.enabled,false);assert.equal(after.keyring.server.active,true);
        }finally{blocker.stdin.end();blocker.kill();if(activation)await activation.catch(()=>{});}
    });
    console.log(fixture('behavior').trim());console.log(`Order HTTP: ${passed} passed`);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{servers.forEach(server=>server.kill());if(created)fixture('drop');require('node:fs').rmSync(path.dirname(env.EOFFICE_STORAGE),{recursive:true,force:true});});
