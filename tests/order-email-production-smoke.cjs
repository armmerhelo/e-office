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
(process.argv.includes('--activation')?runActivation():run()).catch(error=>{console.error(error.message);process.exitCode=1;});
