const assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
cp.execFileSync(php,['tests/amss-links.php'],{stdio:'inherit'});
// Opt-in live checks exercise the actual AMSS TLS download through the save API.
if(!process.argv.includes('--live'))process.exit(0);
const port=Number(process.env.AMSS_TEST_PORT||8097),base=`http://localhost:${port}`;
const storage=path.join(os.tmpdir(),'opencode',`eoffice-amss-${process.pid}`);
const env={...process.env,DB_DATABASE:`eoffice_amss_${process.pid}_test`,EOFFICE_MOCK_SERVICES:'true',APP_URL:base,EOFFICE_STORAGE:storage};
let server,created=false,users,pdf,passed=0;
function fixture(action,...args){return cp.execFileSync(php,['tests/amss-fixture.php',action,...args.map(String)],{env,encoding:'utf8'});}
function rows(){return JSON.parse(cp.execFileSync(php,['-r',`require 'config/bootstrap.php'; echo json_encode(['docs'=>app_pdo()->query('SELECT * FROM t_document')->fetchAll(),'files'=>app_pdo()->query('SELECT * FROM t_document_upload')->fetchAll(),'outbox'=>app_pdo()->query('SELECT * FROM eoffice_outbox')->fetchAll()]);`],{env,encoding:'utf8'}));}
function form(extra={},upload=false){const f=new FormData();const values={doc_number:'AMSS-'+Date.now(),doc_name:'AMSS import regression',doc_type:'หนังสือ',doc_date_receive:'2026-10-08',...extra};for(const[k,v]of Object.entries(values)){if(Array.isArray(v))v.forEach(x=>f.append(k+'[]',String(x)));else f.append(k,String(v));}if(upload){f.append('doc_file_name[]','Local PDF');f.append('file_id[]','0');f.append('doc_upload[]',new Blob([pdf],{type:'application/pdf'}),'local.pdf');}return f;}
async function request(route,{as='owner',body,status=200}={}){const r=await fetch(base+route,{method:body?'POST':'GET',headers:as?{Cookie:users[as].cookie}:{},body});const text=await r.text();assert.equal(r.status,status,text);return {r,text};}
function documentFiles(id){const state=rows(),doc=state.docs.find(d=>d.Doc_Id===id);return state.files.filter(f=>f.Doc_File_Link===doc.Doc_File_Link);}
function editFiles(id,extra={}){const files=documentFiles(id);return {formtype:'edit_document',doc_id:id,replace_files:'1',file_id:files.map(f=>f.Doc_Upload_Id),file_version:files.map(f=>f.Doc_Upload_Path),doc_file_name:files.map(f=>f.Doc_Upload_Detail),...extra};}
let counter=0;
async function localDocument(){return JSON.parse((await request('/api/create_document.php',{body:form({doc_number:'AMSS-BOUNDARY-'+(++counter)},true)})).text).doc_id;}
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
async function run(){
 const seed=JSON.parse(fixture('seed'));created=true;users=seed.users;pdf=Buffer.from(seed.pdf,'base64');
 server=cp.spawn(php,['-S',`localhost:${port}`,'tests/amss-router.php'],{env,stdio:'ignore'});
 for(let i=0;i<50;i++){try{await fetch(base+'/api/me.php');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 const url='https://amss.sesact.go.th/modules/bookregister/upload_files2/1769410561x2033142038_1.pdf';let doc,file;
 await test('guest cannot import AMSS PDF',()=>request('/api/create_document.php',{as:null,body:form({doc_url:[url],doc_url_name:['AMSS']}),status:401}));
 await test('AMSS link becomes a stored, authorized PDF alongside local uploads',async()=>{
  const result=JSON.parse((await request('/api/create_document.php',{body:form({doc_url:[url,'https://example.com/reference'],doc_url_name:['AMSS PDF','Reference'],send_to:[users.alice.id]},true)})).text);doc=result.doc_id;
  const s=rows();assert.equal(s.files.length,2);assert.deepEqual(JSON.parse(s.docs[0].Doc_Url),[{'Reference':'https://example.com/reference'}]);file=s.files.find(f=>f.Doc_Upload_Detail==='AMSS PDF');assert.match(file.Doc_Upload_Path,/^[a-f0-9]{32}\.pdf$/);
  const response=await request(`/api/view_file.php?Doc_Id=${doc}&File_Path=${file.Doc_Upload_Path}`,{as:'alice'});assert.match(response.text,/^%PDF-/);assert.ok(response.r.headers.get('X-Document-Revision'));
  await request(`/api/view_file.php?Doc_Id=${doc}&File_Path=${file.Doc_Upload_Path}`,{as:'bob',status:403});
 });
 await test('editing saved document does not duplicate imported PDFs',async()=>{
  await request('/api/create_document.php',{body:form({formtype:'edit_document',doc_id:doc,doc_url:['https://example.com/reference'],doc_url_name:['Reference']})});assert.equal(rows().files.length,2);
 });
 await test('link-only document imports multiple AMSS PDFs and retains the homepage link',async()=>{
  const result=JSON.parse((await request('/api/create_document.php',{body:form({doc_url:[url,url+'?download=1','https://amss.sesact.go.th/'],doc_url_name:['First PDF','Second PDF','AMSS homepage']})})).text);
  const s=rows(),saved=s.docs.find(d=>d.Doc_Id===result.doc_id),files=s.files.filter(f=>f.Doc_File_Link===saved.Doc_File_Link);
  assert.equal(files.length,2);assert.deepEqual(files.map(f=>f.Doc_Upload_Detail),['First PDF','Second PDF']);assert.deepEqual(JSON.parse(saved.Doc_Url),[{'AMSS homepage':'https://amss.sesact.go.th/'}]);
 });
 await test('failed import rolls back document, uploaded files and notifications',async()=>{
  const before=rows(),files=fs.readdirSync(path.join(storage,'original','2569')).sort();
  await request('/api/create_document.php',{body:form({doc_url:[url,'https://amss.sesact.go.th/modules/bookregister/upload_files2/eoffice-nonexistent-test.pdf'],doc_url_name:['Downloaded before failure','Missing PDF'],send_to:[users.alice.id]},true),status:422});
  assert.deepEqual(rows(),before);assert.deepEqual(fs.readdirSync(path.join(storage,'original','2569')).sort(),files);
 });
 await test('failed import on edit preserves existing document and attachments',async()=>{
  const before=rows();await request('/api/create_document.php',{body:form({formtype:'edit_document',doc_id:doc,doc_name:'Must roll back',replace_files:'1',doc_url:['https://amss.sesact.go.th/modules/bookregister/upload_files2/eoffice-nonexistent-test.pdf'],doc_url_name:['Missing PDF']}),status:422});assert.deepEqual(rows(),before);
  await request(`/api/view_file.php?Doc_Id=${doc}&File_Path=${file.Doc_Upload_Path}`);
 });
 await test('AMSS PDF imported on edit is retained with replace_files enabled',async()=>{
  const existing=rows().files.filter(f=>f.Doc_File_Link===String(doc));await request('/api/create_document.php',{body:form({formtype:'edit_document',doc_id:doc,replace_files:'1',file_id:existing.map(f=>f.Doc_Upload_Id),doc_file_name:existing.map(f=>f.Doc_Upload_Detail),doc_url:[url],doc_url_name:['Second import']})});assert.equal(rows().files.filter(f=>f.Doc_File_Link===String(doc)).length,3);
 });
 await test('uppercase scheme and pasted whitespace import through the save API',async()=>{
  const result=JSON.parse((await request('/api/create_document.php',{body:form({doc_number:'AMSS-NORMALIZED',doc_url:[' '+url.replace('https:','HTTPS:')+' '],doc_url_name:['Normalized PDF']})})).text);assert.equal(documentFiles(result.doc_id).length,1);
 });
 await test('total attachment limit rejects the 21st AMSS PDF without changing the document',async()=>{
  const id=await localDocument();fixture('fill-attachments',id,20);const before=rows();await request('/api/create_document.php',{body:form(editFiles(id,{doc_url:[url],doc_url_name:['Too many PDFs']})),status:400});assert.deepEqual(rows(),before);
  await request('/api/create_document.php',{body:form(editFiles(id,{doc_name:'Twenty PDFs remain editable'}))});assert.equal(documentFiles(id).length,20);
 });
 await test('new document counts normal uploads and AMSS links together',async()=>{
  const before=rows();await request('/api/create_document.php',{body:form({doc_number:'AMSS-OVER-LIMIT',doc_url:Array(20).fill(url),doc_url_name:Array(20).fill('AMSS PDF')},true),status:400});assert.deepEqual(rows(),before);
 });
 await test('legacy 21-file document can be edited but cannot grow further',async()=>{
  const id=await localDocument();fixture('fill-attachments',id,21);await request('/api/create_document.php',{body:form(editFiles(id,{doc_name:'Legacy document editable'}))});const before=rows();await request('/api/create_document.php',{body:form(editFiles(id,{doc_url:[url],doc_url_name:['Extra PDF']})),status:400});assert.deepEqual(rows(),before);
 });
 await test('attachment count is rechecked after a concurrent writer during download',async()=>{
  const id=await localDocument();await request('/api/create_document.php',{body:form({formtype:'edit_document',doc_id:id,doc_url:[url],doc_url_name:['Extra PDF'],amss_test_action:'grow_attachments'}),status:400});assert.equal(documentFiles(id).length,20);
 });
 await test('stale complete attachment list never deletes files added during download',async()=>{
  const id=await localDocument();await request('/api/create_document.php',{body:form(editFiles(id,{doc_url:[url],doc_url_name:['Extra PDF'],amss_test_action:'grow_attachments'})),status:409});assert.equal(documentFiles(id).length,20);
 });
 await test('replacement during download returns a revision conflict and preserves current file',async()=>{
  const id=await localDocument(),before=documentFiles(id)[0];await request('/api/create_document.php',{body:form(editFiles(id,{doc_url:[url],doc_url_name:['Extra PDF'],amss_test_action:'replace_file'})),status:409});const files=documentFiles(id);assert.equal(files.length,1);assert.notEqual(files[0].Doc_Upload_Path,before.Doc_Upload_Path);await request(`/api/view_file.php?Doc_Id=${id}&File_Path=${files[0].Doc_Upload_Path}`);
 });
 await test('session revoked during AMSS download cannot create a document',async()=>{
  const before=rows();await request('/api/create_document.php',{as:'bob',body:form({doc_url:[url],doc_url_name:['Not authorized'],amss_test_action:'expire_session'}),status:401});assert.deepEqual(rows(),before);
 });
 if(seed.order_support)await test('AMSS-only order enters the AI queue with its imported PDF',async()=>{
  await request('/email_send/ai_settings.php',{as:'admin',body:JSON.stringify({action:'save',model:'gemini-test',enabled:true})});
  const result=JSON.parse((await request('/api/create_document.php',{body:form({doc_type:'คำสั่ง',doc_url:[url],doc_url_name:['AMSS order']})})).text);
  const job=JSON.parse((await request('/email_send/order_jobs.php?doc_id='+result.doc_id,{as:'admin'})).text).job;assert.equal(job.status,'analyzing');
 });
 console.log(`AMSS live HTTP: ${passed} passed`);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{if(server)server.kill();if(created)fixture('drop');fs.rmSync(storage,{recursive:true,force:true});});
