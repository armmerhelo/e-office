// Controlled production verification. Fixtures belong only to the temporary user.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const state=JSON.parse(fs.readFileSync(path.join(os.homedir(),'AppData/Local/Temp/opencode/eoffice-production-smoke.private.json'),'utf8'));
let cookie='',passed=0;
async function call(route,{method='GET',data,form,status=200,auth=true}={}){
    await new Promise(r=>setTimeout(r,1800));
    const r=await fetch(state.url+route,{method,redirect:'manual',headers:{...(auth&&cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:form||(data?JSON.stringify(data):undefined)});
    const text=await r.text();if(text.includes('One moment, please...'))throw Error('Host challenge: '+route);assert.equal(r.status,status,route+' '+text.slice(0,200));
    let body;try{body=JSON.parse(text);}catch{body=text;}return {r,body,text};
}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
function form(values,bytes,name){const f=new FormData();for(const[k,v]of Object.entries(values)){if(Array.isArray(v))v.forEach(x=>f.append(k+'[]',String(x)));else f.append(k,String(v));}if(bytes)f.append(name||'doc_upload[]',new Blob([bytes],{type:'application/pdf'}),name?'filename.pdf':'fixture.pdf');return f;}
async function run(){let doc,filename,revision;
 await check('public document listing works without internal recipient metadata',async()=>{const r=await call('/api/get_data_public.php',{method:'POST',data:{Year:'2569',limit:1},auth:false});assert.ok(r.body[0].doc_id>0);for(const key of ['user_send_to','department_id','status_read','date','send_from','doc_action','doc_other'])assert.equal(Object.hasOwn(r.body[0],key),false,key);});
 await check('boolean password rejected',async()=>call('/api/auth_login.php',{method:'POST',data:{username:state.email,password:true},status:400,auth:false}));
 await check('production login sets Secure/HttpOnly cookie',async()=>{const r=await call('/api/auth_login.php',{method:'POST',data:{username:state.email,password:state.password},auth:false});const cookies=r.r.headers.getSetCookie();assert.ok(/httponly/i.test(cookies.join(';')),'HttpOnly missing');assert.ok(/secure/i.test(cookies.join(';')),'Secure missing');cookie=cookies.map(s=>s.split(';')[0]).join('; ');});
 await check('identity and role API works',async()=>{const r=await call('/api/me.php');assert.equal(r.body.user.id,state.user_id);assert.equal(r.body.user.status,'Admin');});
 await check('temporary document upload and Thai date',async()=>{const f=form({doc_number:'DEPLOY-'+state.nonce,doc_name:'Temporary deployment verification',doc_type:'หนังสือ',doc_date_receive:'7 ต.ค.2569',doc_receive_from:'Deployment verification',doc_file_name:['Temporary PDF'],file_id:['']},Buffer.from(state.pdf,'base64'));const r=await call('/api/create_document.php',{method:'POST',form:f});doc=r.body.doc_id;assert.ok(doc>0);const list=await call('/api/get_data_send.php',{method:'POST',data:{Year:'2569',search_txt:'DEPLOY-'+state.nonce}});assert.equal(list.body[0].doc_id,doc);filename=list.body[0].doc_upload_path[0].path;});
 await check('private document requires authentication',async()=>call(`/api/view_file.php?Doc_Id=${doc}&File_Path=${filename}`,{auth:false,status:401}));
 await check('authorized PDF read has a revision',async()=>{const r=await call(`/api/view_file.php?Doc_Id=${doc}&File_Path=${filename}&Type=signed`);assert.match(r.text,/^%PDF/);revision=r.r.headers.get('X-Document-Revision');assert.match(revision,/^[a-f0-9]{64}$/);});
 await check('sign temporary PDF and prevent stale overwrite',async()=>{const upload=()=>{const f=form({Doc_Id:doc,year:'2569',revision});f.append('file',new Blob([Buffer.concat([Buffer.from(state.pdf,'base64'),Buffer.from('\n% smoke signed\n')])],{type:'application/pdf'}),filename);return f;};await call('/e-sign/upload_pdf.php',{method:'POST',form:upload()});await call('/e-sign/upload_pdf.php',{method:'POST',form:upload(),status:409});});
 await check('personal email dashboard SQL works',async()=>{const r=await call('/email_send/api_get_my_docs.php?year=all');assert.equal(r.body.status,'success');});
 await check('booking history API works',async()=>{const r=await call('/room_booking/api/my_bookings.php');assert.equal(r.body.status,'success');});
 await check('maintenance admin API works',async()=>{const r=await call('/maintenance_requests/api/get_maintenance.php?limit=1');assert.equal(r.body.status,'success');});
 await check('logout revokes temporary session',async()=>{await call('/api/logout.php',{method:'POST',data:{}});await call('/api/get_data_send.php',{method:'POST',data:{Year:'2569'},status:401});});
 state.doc_id=doc;state.file_name=filename;fs.writeFileSync(path.join(os.homedir(),'AppData/Local/Temp/opencode/eoffice-production-smoke.private.json'),JSON.stringify(state));
 console.log(`Production smoke: ${passed} passed; no notifications were created or sent`);
}
run().catch(e=>{console.error(e);process.exitCode=1;});
