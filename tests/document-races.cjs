const assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path'),os=require('node:os');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const port=Number(process.env.RACE_TEST_PORT||8091),base=`http://localhost:${port}`;
const env={...process.env,DB_DATABASE:process.env.TEST_DATABASE||'eoffice_review_test',EOFFICE_MOCK_SERVICES:'true',APP_URL:base,EOFFICE_STORAGE:path.join(os.tmpdir(),'opencode','eoffice-test-storage')};
if(!env.DB_DATABASE.endsWith('_test'))throw Error('Only test databases allowed');
const seed=JSON.parse(cp.execFileSync(php,['tests/seed.php'],{env,encoding:'utf8'}));
const server=cp.spawn(php,['-S',`localhost:${port}`,'scripts/router.php'],{env,stdio:['ignore','ignore','pipe']});const lockers=new Set();let errors='',passed=0;
server.stderr.on('data',s=>errors+=s);const pdf=Buffer.from(seed.pdf,'base64'),stamp=Date.now();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function inspect(action,id,user=0){return JSON.parse(cp.execFileSync(php,['tests/inspect.php',action,String(id)],{env,encoding:'utf8'}));}
async function request(route,{cookie='',data,form,status=200}={}){
    const r=await fetch(base+route,{method:data||form?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:form||(data?JSON.stringify(data):undefined)});
    const text=await r.text();assert.equal(r.status,status,route+' '+text.slice(0,300));let body;try{body=JSON.parse(text);}catch{body=text;}return {r,body,text};
}
function form(values,upload=false){const f=new FormData();if(values.Doc_Id)f.set('confirm_signature','1');for(const[k,v]of Object.entries(values)){if(Array.isArray(v))v.forEach(x=>f.append(k+'[]',String(x)));else f.set(k,String(v));}if(upload)f.append('doc_upload[]',new Blob([pdf],{type:'application/pdf'}),'fixture.pdf');return f;}
async function login(who){const {r}=await request('/api/auth_login.php',{data:{username:`qa-${who}@siya.ac.th`,password:'Review-Test-2026!'}});return r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');}
async function create(owner,suffix){const values={doc_number:'RACE-'+stamp+'-'+suffix,doc_name:'Document race regression',doc_type:'หนังสือ',doc_date_receive:'2026-10-07',doc_file_name:['Fixture'],file_id:[''],send_to:[seed.users.recipient]};const result=await request('/api/create_document.php',{cookie:owner,form:form(values,true)});const list=await request('/api/get_data_send.php',{cookie:owner,data:{Year:'2569',search_txt:values.doc_number}});return {values,id:result.body.doc_id,file:list.body[0].doc_upload_path[0]};}
async function hold(doc,dept=0){const child=cp.spawn(php,['tests/document-race-helper.php','lock',String(doc.id),String(seed.users.recipient),String(dept)],{env,stdio:['pipe','pipe','pipe']});lockers.add(child);let output='';child.stdout.on('data',s=>output+=s);await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Row lock unavailable')),5000);child.stdout.on('data',()=>{if(output.includes('LOCKED')){clearTimeout(timeout);resolve();}});});return async command=>{const done=new Promise((resolve,reject)=>child.on('exit',code=>{lockers.delete(child);code===0?resolve(output):reject(Error('Fixture lock failed'));}));child.stdin.end(command+'\n');return done;};}
async function blocked(doc){for(let i=0;i<50;i++){const count=Number(cp.execFileSync(php,['tests/document-race-helper.php','waits',String(doc.id)],{env,encoding:'utf8'}));if(count)return;await sleep(100);}throw Error('HTTP writer did not reach row lock');}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
async function holdCreateTable(table){
 const child=cp.spawn(php,['tests/create-save-race-helper.php','lock',table],{env,stdio:['pipe','pipe','pipe']});lockers.add(child);
 let output='',stderr='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Create table lock unavailable: '+stderr)),5000);child.stdout.on('data',()=>{if(output.includes('LOCKED')){clearTimeout(timeout);resolve();}});});
 return async()=>{const done=new Promise((resolve,reject)=>child.on('exit',code=>{lockers.delete(child);code===0?resolve():reject(Error('Fixture table unlock failed: '+stderr));}));child.stdin.end('release\n');await done;};
}
async function startRevocation(table,id){
 const child=cp.spawn(php,['tests/create-save-race-helper.php','revoke',table,String(id)],{env,stdio:['ignore','pipe','pipe']});lockers.add(child);let error='';child.stderr.on('data',data=>error+=data);
 const done=new Promise((resolve,reject)=>child.on('exit',code=>{lockers.delete(child);code===0?resolve():reject(Error('Fixture revoke failed: '+error));}));done.catch(()=>{});return done;
}
function createFixture(action,table,value=''){return cp.execFileSync(php,['tests/create-save-race-helper.php',action,table,String(value)],{env,encoding:'utf8'}).trim();}
async function run(){for(let i=0;i<50;i++){try{await fetch(base+'/api/me.php');break;}catch{await sleep(100);}}const owner=await login('owner'),recipient=await login('recipient');
    await check('revoked signer cannot regain access after a lock wait',async()=>{const doc=await create(owner,'sign');const view=await request(`/api/view_file.php?Doc_Id=${doc.id}&File_Path=${doc.file.path}`,{cookie:recipient});const f=form({Doc_Id:doc.id,year:'2569',revision:view.r.headers.get('X-Document-Revision')});f.append('file',new Blob([pdf],{type:'application/pdf'}),doc.file.path);const release=await hold(doc);const pending=request('/e-sign/upload_pdf.php',{cookie:recipient,form:f,status:403});await blocked(doc);await release('revoke');await pending;assert.equal(inspect('access',doc.id).some(a=>a.User_Id===seed.users.recipient),false);});
    await check('revoked recipient cannot recreate rights through receipt editing',async()=>{const doc=await create(owner,'receipt');const release=await hold(doc);const pending=request('/api/create_document.php',{cookie:recipient,form:form({formtype:'edit_document',doc_id:doc.id,doc_number_receive_stamp:'123'}),status:403});await blocked(doc);await release('revoke');await pending;assert.equal(inspect('access',doc.id).length,0);});
    await check('revoked reader cannot recreate rights through read status',async()=>{const doc=await create(owner,'read');const release=await hold(doc);const pending=request('/api/update_read_status.php',{cookie:recipient,data:{doc_id:doc.id},status:403});await blocked(doc);await release('revoke');await pending;assert.equal(inspect('access',doc.id).length,0);});
    await check('caption update after concurrent replacement keeps the current PDF',async()=>{const doc=await create(owner,'caption');const release=await hold(doc);const pending=request('/api/create_document.php',{cookie:owner,form:form({...doc.values,formtype:'edit_document',doc_id:doc.id,file_id:[doc.file.file_id],doc_file_name:['Updated caption']})});await blocked(doc);const output=await release('replace');const name=JSON.parse(output.trim().split('\n').at(-1)).new_file;await pending;const list=await request('/api/get_data_send.php',{cookie:owner,data:{Year:'2569',search_txt:doc.values.doc_number}});assert.equal(list.body[0].doc_upload_path[0].path,name);await request(`/api/view_file.php?Doc_Id=${doc.id}&File_Path=${name}`,{cookie:owner});});
    await check('stale frontend file version returns conflict instead of overwriting',async()=>{const doc=await create(owner,'version');const release=await hold(doc);const pending=request('/api/create_document.php',{cookie:owner,form:form({...doc.values,formtype:'edit_document',doc_id:doc.id,file_id:[doc.file.file_id],file_version:[doc.file.path],doc_file_name:['Stale caption']}),status:409});await blocked(doc);await release('replace');await pending;});
    await check('group membership revocation is rechecked after the document lock',async()=>{const admin=await login('admin');await request('/management/save_department_api.php',{cookie:admin,form:form({Department_Name:'RACE-GROUP-'+stamp})});const groups=await request('/management/get_departments_api.php?search='+encodeURIComponent('RACE-GROUP-'+stamp),{cookie:admin});const dept=groups.body.data[0].Department_Id;cp.execFileSync(php,['tests/document-race-helper.php','join-group','0',String(seed.users.recipient),String(dept)],{env});const doc=await create(owner,'group');await request('/api/create_document.php',{cookie:owner,form:form({...doc.values,formtype:'edit_document',doc_id:doc.id,doc_file_name:[],file_id:[],send_to:[],send_to_group:[dept],replace_recipients:1})});const view=await request(`/api/view_file.php?Doc_Id=${doc.id}&File_Path=${doc.file.path}`,{cookie:recipient});const f=form({Doc_Id:doc.id,year:'2569',revision:view.r.headers.get('X-Document-Revision')});f.append('file',new Blob([pdf],{type:'application/pdf'}),doc.file.path);const release=await hold(doc,dept);const pending=request('/e-sign/upload_pdf.php',{cookie:recipient,form:f,status:403});await blocked(doc);await release('revoke-group');await pending;assert.equal(inspect('access',doc.id).length,0);});
    await check('logged-out session cannot finish a queued signing request',async()=>{const doc=await create(owner,'session');const view=await request(`/api/view_file.php?Doc_Id=${doc.id}&File_Path=${doc.file.path}`,{cookie:recipient});const f=form({Doc_Id:doc.id,year:'2569',revision:view.r.headers.get('X-Document-Revision')});f.append('file',new Blob([pdf],{type:'application/pdf'}),doc.file.path);const release=await hold(doc);const pending=request('/e-sign/upload_pdf.php',{cookie:recipient,form:f,status:401});await blocked(doc);await release('logout');await pending;assert.equal(inspect('access',doc.id).find(a=>a.User_Id===seed.users.recipient).Is_Signed,'false');});
    for(const table of ['maintenance_requests','room_bookings'])for(const guarded of [true,false])await check('logged-out session cannot finish a queued '+table+' creation'+(guarded?'':' (legacy authenticated client)'),async()=>{
      const active=await login('owner'),title='RACE-CREATE-'+table+'-'+stamp;
      const data=table==='room_bookings'?{_expected_owner:seed.users.owner,requesterName:'QA',roomSelect:title,topic:title,department:'QA',attendees:3,startDate:'2027-01-01',endDate:'2027-01-01',startTime:'10:00',endTime:'11:00',equipment:{}}:
        {_expected_owner:seed.users.owner,requesterName:'QA',requestDate:'2026-10-07',phone:'0123456789',repairTypes:['ไฟฟ้า'],building:'1',room:'1',damageDetails:title};
      if(!guarded)delete data._expected_owner;
      const release=await holdCreateTable(table);
      const pending=request(table==='room_bookings'?'/room_booking/api/room_booking.php':'/maintenance_requests/api/submit_maintenance.php',{cookie:active,data,status:401});
      pending.catch(()=>{});
      for(let i=0;i<50;i++){if(Number(createFixture('waits',table)))break;if(i===49)throw Error('Create writer never reached the table wait');await sleep(100);}
      const revokeDone=startRevocation(table,seed.users.owner);
      const revocation=await Promise.race([revokeDone.then(()=>true),sleep(3000).then(()=>false)]);
      try {assert.equal(revocation,true,'a blocked table must not hold the session alive');assert.equal(Number(createFixture('session-live',table,seed.users.owner)),0);}
      finally {await release();}
      await revokeDone;await pending;
      assert.equal(Number(createFixture('count',table,title)),0,'revoked requests must not create records');
    });
    await check('migration CLI cannot mistake TEST_DATABASE for a production database selection',async()=>{
      const environment={...env,TEST_DATABASE:env.DB_DATABASE};delete environment.DB_DATABASE;
      const refused=cp.spawnSync(php,['scripts/migrate.php'],{env:environment,encoding:'utf8'});assert.equal(refused.status,1);assert.match(refused.stderr,/DB_DATABASE is missing/);
      const explicit=cp.spawnSync(php,['scripts/migrate.php','--test'],{env:environment,encoding:'utf8'});assert.equal(explicit.status,0,explicit.stdout+explicit.stderr);assert.ok(explicit.stdout.includes(env.DB_DATABASE));
    });
    console.log(`Document race regression: ${passed} passed`);
}
run().catch(e=>{console.error(e);console.error(errors);process.exitCode=1;}).finally(()=>{for(const child of lockers)child.kill();server.kill();});
