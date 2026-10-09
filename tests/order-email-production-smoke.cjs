// A controlled production smoke account is created/removed by the release tool.
// Delivery stays disabled. Never creates recipient grants or sends staff mail.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const state=JSON.parse(fs.readFileSync(path.join(os.homedir(),'AppData/Local/Temp/opencode/eoffice-production-smoke.private.json'),'utf8'));
assert.equal(state.url,'https://e-office.siya.ac.th');
let cookie='',passed=0;
async function request(route,{data,form,status=200,auth=true,headers={}}={}){
    const response=await fetch(state.url+route,{method:data||form?'POST':'GET',headers:{...headers,...(auth&&cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:form||(data?JSON.stringify(data):undefined),redirect:'manual'});
    const text=await response.text();assert.equal(response.status,status,route+' HTTP mismatch');
    let result;try{result=JSON.parse(text);}catch{result=text;}
    return {response,result,text};
}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
async function run(){
    await check('guest cannot inspect AI settings or recipient queue',async()=>{await request('/email_send/ai_settings.php',{auth:false,status:401});await request('/email_send/order_jobs.php',{auth:false,status:401});});
    await check('temporary Admin uses production authentication',async()=>{const r=await request('/api/auth_login.php',{data:{username:state.email,password:state.password},auth:false});cookie=r.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');assert.ok(cookie.includes('User_Token='));});
    await check('Admin settings show encryption and original Gemini model, without secrets',async()=>{const {result}=await request('/email_send/ai_settings.php');assert.equal(result.settings.enabled,false);assert.equal(result.settings.activated_at,null);assert.equal(result.settings.encryption_ready,true);assert.equal(result.settings.key_configured,true);assert.equal(result.settings.model,'gemini-3.6-flash');assert.equal(Object.hasOwn(result.settings,'api_key_cipher'),false);});
    await check('Admin can load real Gemini model list',async()=>{const {result}=await request('/email_send/ai_settings.php',{data:{action:'models'}});assert.ok(result.models.some(m=>m.id==='gemini-3.6-flash'));});
    await check('AI settings reject cross-origin writes',async()=>{await request('/email_send/ai_settings.php',{data:{action:'save',enabled:false,model:'gemini-3.6-flash'},headers:{Origin:'https://foreign.example'},status:403});});
    await check('invalid model change is rejected without mutation',async()=>{await request('/email_send/ai_settings.php',{data:{action:'save',enabled:false,model:'../../invalid'},status:400});});
    await check('tracking list loads on production MariaDB while paused',async()=>{const {result}=await request('/email_send/order_jobs.php?year=all');assert.equal(result.status,'success');assert.equal(result.worker.enabled,false);assert.ok(result.total>0);assert.equal(result.is_admin,true);});
    await check('saving a synthetic offline-signed order with two PDFs remains fast and does not enroll before activation',async()=>{
        const form=new FormData();for(const [key,value] of Object.entries({doc_number:'RELEASE-ORDER-'+state.nonce,doc_name:'Synthetic order email release verification',doc_type:'คำสั่ง',doc_date_receive:'2026-10-08'}))form.append(key,value);
        for(let i=0;i<2;i++){form.append('doc_file_name[]','Synthetic PDF '+(i+1));form.append('file_id[]','0');form.append('doc_upload[]',new Blob([Buffer.from(state.pdf,'base64')],{type:'application/pdf'}),'synthetic-'+i+'.pdf');}
        const {result}=await request('/api/create_document.php',{form});assert.ok(result.doc_id);const detail=await request('/email_send/order_jobs.php?doc_id='+result.doc_id);assert.equal(detail.result.job,null);
    });
    await check('all new UI assets are served and worker URLs are blocked',async()=>{
        for(const route of ['/email_send/doc_send_email.html','/email_send/ai_settings.html','/email_send/order-dashboard.js','/email_send/ai-settings.js','/email_send/order-email.css']){const r=await request(route);assert.ok(r.text.length>0);}
        for(const route of ['/scripts/order-emails.php','/scripts/order-cron.sh']){const r=await fetch(state.url+route,{redirect:'manual'});assert.ok([403,404,302].includes(r.status));}
    });
    await request('/api/logout.php',{data:{}});console.log(`Order production smoke: ${passed} passed`);
}
async function runActivation(){
    await check('production delivery is enabled after a real cron heartbeat',async()=>{const r=await request('/api/auth_login.php',{data:{username:state.email,password:state.password},auth:false});cookie=r.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');const settings=(await request('/email_send/ai_settings.php')).result.settings;assert.equal(settings.enabled,true);assert.ok(settings.activated_at);assert.ok(settings.worker_at);});
    await check('new offline-signed order enrolls automatically and waits safely for PDFs',async()=>{
        const form=new FormData();for(const [key,value] of Object.entries({doc_number:'AUTO-CHECK-'+state.nonce,doc_name:'Synthetic activation verification without attachments',doc_type:'คำสั่ง',doc_date_receive:'2026-10-08'}))form.append(key,value);
        const {result}=await request('/api/create_document.php',{form});assert.ok(result.doc_id);
        const detail=(await request('/email_send/order_jobs.php?doc_id='+result.doc_id)).result;assert.equal(detail.job.source,'automatic');assert.equal(detail.job.status,'waiting_files');assert.equal(detail.recipients.length,0);assert.equal(detail.files.length,0);
    });
    await request('/api/logout.php',{data:{}});console.log(`Order activation smoke: ${passed} passed`);
}
async function runReview(){
    let settings,docId,recipientId;
    await check('review patch exposes revision while preserving the original activation boundary',async()=>{
        const login=await request('/api/auth_login.php',{data:{username:state.email,password:state.password},auth:false});cookie=login.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
        settings=(await request('/email_send/ai_settings.php')).result.settings;assert.equal(settings.enabled,false);assert.equal(settings.activated_at,'2026-10-08 14:20:51');assert.ok(Number.isInteger(settings.revision));
    });
    await check('missing or stale settings revisions cannot change production pause',async()=>{
        for(const extra of [{},{revision:settings.revision+1}])await request('/email_send/ai_settings.php',{data:{action:'save',enabled:true,model:settings.model,...extra},status:409});
        const after=(await request('/email_send/ai_settings.php')).result.settings;assert.equal(after.enabled,false);assert.equal(after.revision,settings.revision);
    });
    await check('explicit recipient joins the order queue before any AI or delivery',async()=>{
        const form=new FormData();for(const [key,value]of Object.entries({doc_number:'REVIEW-'+state.nonce,doc_name:'Synthetic review check without PDFs',doc_type:'คำสั่ง',doc_date_receive:'2026-10-08'}))form.append(key,value);
        form.append('send_to[]',state.user_id);const created=(await request('/api/create_document.php',{form})).result;docId=created.doc_id;assert.ok(docId);
        const detail=(await request('/email_send/order_jobs.php?doc_id='+docId)).result;assert.equal(detail.job.status,'waiting_files');assert.equal(detail.recipients.length,1);assert.equal(detail.recipients[0].source,'document');assert.equal(detail.recipients[0].status,'pending');recipientId=detail.recipients[0].id;
    });
    await check('explicit manual selection preserves an existing queued recipient',async()=>{
        await request('/email_send/order_jobs.php',{data:{doc_id:docId,action:'add_recipient',email:state.email}});
        const detail=(await request('/email_send/order_jobs.php?doc_id='+docId)).result;assert.equal(detail.recipients.length,1);assert.equal(detail.recipients[0].source,'manual');assert.equal(detail.recipients[0].status,'pending');
    });
    await check('cancelled production job cannot resume through add or recipient retry',async()=>{
        await request('/email_send/order_jobs.php',{data:{doc_id:docId,action:'cancel_job'}});
        await request('/email_send/order_jobs.php',{data:{doc_id:docId,action:'add_recipient',email:state.email},status:409});
        await request('/email_send/order_jobs.php',{data:{doc_id:docId,action:'retry_recipient',recipient_id:recipientId,confirmed:true},status:409});
        const detail=(await request('/email_send/order_jobs.php?doc_id='+docId)).result;assert.equal(detail.job.status,'cancelled');assert.equal(detail.recipients[0].status,'cancelled');
    });
    await check('updated Admin page loads the revision-aware script and styles',async()=>{
        const page=await request('/email_send/ai_settings.html');assert.ok(page.text.includes('ai-settings.js?v=20261008-review1'));
        for(const route of ['/email_send/ai-settings.js?v=20261008-review1','/email_send/ai-settings.css','/email_send/order-dashboard.css'])assert.ok((await request(route)).text.length>0);
    });
    await request('/api/logout.php',{data:{}});console.log(`Order review production smoke: ${passed} passed`);
}
async function runReview2(){
    let docId,recipientId;
    await check('second review patch preserves the activation boundary while paused',async()=>{
        const login=await request('/api/auth_login.php',{data:{username:state.email,password:state.password},auth:false});cookie=login.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
        const settings=(await request('/email_send/ai_settings.php')).result.settings;assert.equal(settings.enabled,false);assert.equal(settings.activated_at,'2026-10-08 14:20:51');
    });
    await check('synthetic explicit recipient is queued without contacting AI or SMTP',async()=>{
        const form=new FormData();for(const [key,value]of Object.entries({doc_number:'REVIEW2-'+state.nonce,doc_name:'Synthetic second review check',doc_type:'คำสั่ง',doc_date_receive:'2026-10-08'}))form.append(key,value);
        form.append('send_to[]',state.user_id);docId=(await request('/api/create_document.php',{form})).result.doc_id;assert.ok(docId);
        const detail=(await request('/email_send/order_jobs.php?doc_id='+docId)).result;assert.equal(detail.recipients[0].source,'document');assert.equal(detail.recipients[0].status,'pending');recipientId=detail.recipients[0].id;
    });
    await check('production readiness check cancels a revoked sending marker without SMTP',async()=>{
        const r=require('node:child_process').spawnSync('python',['scripts/order-review-release.py','smoke_review2'],{encoding:'utf8'});assert.equal(r.status,0,'Controlled readiness helper failed');const result=JSON.parse(r.stdout);
        assert.equal(result.smtp_called,false);assert.equal(result.revoked_recipient_ready,false);assert.equal(result.recipient.status,'cancelled');assert.equal(result.recipient.error_code,'recipient_revoked');assert.equal(result.job,'review');assert.equal(result.job_error,'no_pending_recipients');
    });
    await check('job without pending recipients accepts a deliberate individual retry',async()=>{
        await request('/email_send/order_jobs.php',{data:{doc_id:docId,action:'retry_recipient',recipient_id:recipientId,confirmed:true}});
        const detail=(await request('/email_send/order_jobs.php?doc_id='+docId)).result;assert.equal(detail.job.status,'queued');assert.equal(detail.recipients[0].status,'pending');await request('/email_send/order_jobs.php',{data:{doc_id:docId,action:'cancel_job'}});
    });
    await check('tracking UI includes the new revocation and no-pending status messages',async()=>{
        const ui=(await request('/email_send/order-ui.js')).text;assert.ok(ui.includes('no_pending_recipients'));assert.ok(ui.includes('recipient_revoked'));assert.ok(ui.includes('pdf_cache_not_ready'));
    });
    await request('/api/logout.php',{data:{}});console.log(`Order second review production smoke: ${passed} passed`);
}
async function runReview3(){
    let docId,prepared;
    function helper(mode){const r=require('node:child_process').spawnSync('python',['scripts/order-review-release.py','smoke_review3','--mode',mode],{encoding:'utf8'});assert.equal(r.status,0,'Controlled review helper failed');return JSON.parse(r.stdout);}
    await check('third review migration preserves paused settings and exposes retry fields',async()=>{
        const login=await request('/api/auth_login.php',{data:{username:state.email,password:state.password},auth:false});cookie=login.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
        const settings=(await request('/email_send/ai_settings.php')).result.settings;assert.equal(settings.enabled,false);assert.equal(settings.activated_at,'2026-10-08 14:20:51');
        const existing=(await request('/email_send/order_jobs.php?search='+encodeURIComponent('REVIEW3-'+state.nonce))).result.data.find(doc=>doc.doc_number==='REVIEW3-'+state.nonce);
        if(existing)docId=existing.doc_id;
        else{const form=new FormData();for(const [key,value]of Object.entries({doc_number:'REVIEW3-'+state.nonce,doc_name:'Synthetic third review verification',doc_type:'คำสั่ง',doc_date_receive:'2026-10-08'}))form.append(key,value);form.append('send_to[]',state.user_id);docId=(await request('/api/create_document.php',{form})).result.doc_id;}
        assert.ok(docId);
        const detail=(await request('/email_send/order_jobs.php?doc_id='+docId)).result;assert.equal(detail.job.retry_attempts,0);assert.equal(detail.job.retry_at,null);
    });
    await check('padded synthetic legacy year produces a valid snapshot and canonical PDF link',async()=>{
        prepared=helper('prepare');assert.equal(prepared.snapshot_files,1);
        const route='/api/view_file.php?Doc_Id='+docId+'&File_Path='+encodeURIComponent(prepared.file_name);
        assert.match((await request(route+'&Year=2569',{auth:false})).text,/^%PDF/);await request(route+'&Year=2568',{auth:false,status:403});
    });
    await check('adding a new synthetic recipient resumes no-pending review and retains cancellations',async()=>{
        await request('/email_send/order_jobs.php',{data:{doc_id:docId,action:'cancel_job'}});await request('/email_send/order_jobs.php',{data:{doc_id:docId,action:'reanalyze',confirmed:true}});
        const finished=helper('no-pending');assert.equal(finished.status,'review');assert.equal(finished.error,'no_pending_recipients');
        await request('/email_send/order_jobs.php',{data:{doc_id:docId,action:'add_recipient',email:prepared.extra_email}});
        const detail=(await request('/email_send/order_jobs.php?doc_id='+docId)).result;assert.equal(detail.job.status,'queued');assert.equal(detail.recipients.find(r=>r.user_id===state.user_id).status,'cancelled');assert.equal(detail.recipients.find(r=>r.recipient_email===prepared.extra_email).status,'pending');
    });
    await check('production MariaDB persists bounded retry metadata without SMTP or Drive calls',async()=>{
        const retry=helper('retry');assert.equal(retry.status,'queued');assert.equal(retry.attempts,1);assert.equal(retry.scheduled,true);await request('/email_send/order_jobs.php',{data:{doc_id:docId,action:'cancel_job'}});
    });
    await request('/api/logout.php',{data:{}});console.log(`Order third review production smoke: ${passed} passed`);
}
(process.argv.includes('--review3')?runReview3():process.argv.includes('--review2')?runReview2():process.argv.includes('--review')?runReview():process.argv.includes('--activation')?runActivation():run()).catch(error=>{console.error(error.message);process.exitCode=1;});
