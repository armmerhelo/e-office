// Real Chromium: stamp a PDF, save it, then return to the pending inbox with Back.
const cp=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const temp=path.join(os.tmpdir(),'opencode'),port=Number(process.env.SIGN_BROWSER_PORT||8223),cdp=Number(process.env.SIGN_CDP_PORT||9253),base=`http://localhost:${port}`;
const database=process.env.TEST_DATABASE||'eoffice_review_test';
if(!database.endsWith('_test'))throw Error('Only test databases may be used');
const env={...process.env,DB_DATABASE:database,APP_URL:base,EOFFICE_MOCK_SERVICES:'true',EOFFICE_MEMBER_VERSION_KEY:crypto.randomBytes(32).toString('base64'),EOFFICE_STORAGE:path.join(temp,'eoffice-test-storage')};
const seed=JSON.parse(cp.execFileSync(php,['tests/seed.php'],{env,encoding:'utf8'}));
const server=cp.spawn(php,['-S',`localhost:${port}`,'scripts/router.php'],{env,stdio:'ignore'});
const profile=fs.mkdtempSync(path.join(temp,'stamp-inbox-browser-'));let chrome,socket,id=0,doc,cookie,attachment;const waiting=new Map(),exceptions=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function send(method,params={}){const n=++id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(n);reject(Error('CDP timeout '+method));},30000);waiting.set(n,{resolve:x=>{clearTimeout(timer);resolve(x);},reject});socket.send(JSON.stringify({id:n,method,params}));});}
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function until(expression){for(let i=0;i<300;i++){try{if(await evaluate(expression))return;}catch{}await sleep(100);}throw Error('Condition timeout '+expression);}
async function request(route,body,auth=''){
 const response=await fetch(base+route,{method:body?'POST':'GET',headers:{...(auth?{Cookie:auth}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
 const text=await response.text();assert.ok(response.ok,route+': '+text);return {response,body:JSON.parse(text)};
}
(async()=>{
 for(let i=0;i<100;i++){try{await fetch(base+'/api/me.php');break;}catch{await sleep(100);}}
 async function login(name){const {response}=await request('/api/auth_login.php',{username:`qa-${name}@siya.ac.th`,password:'Review-Test-2026!'});return response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');}
 const owner=await login('owner');cookie=await login('recipient');
 const form=new FormData();for(const [k,v]of Object.entries({doc_number:'STAMP-BROWSER-'+Date.now(),doc_name:'Synthetic stamp inbox regression',doc_type:'หนังสือ',doc_date_receive:'2026-10-30','doc_file_name[]':'Synthetic PDF','file_id[]':'','send_to[]':seed.users.recipient}))form.append(k,v);
 form.append('doc_upload[]',new Blob([Buffer.from(seed.pdf,'base64')],{type:'application/pdf'}),'regression.pdf');
 const created=(await request('/api/create_document.php',form,owner)).body;doc=created.doc_id;
 attachment={name:created.files.entries[0].path,year:created.files.year};
 chrome=cp.spawn(process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new',`--remote-debugging-port=${cdp}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
 let pages;for(let i=0;i<100;i++){try{pages=await fetch(`http://127.0.0.1:${cdp}/json`).then(r=>r.json());break;}catch{await sleep(100);}}
 assert.ok(pages,'Chromium must start');
 socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
 socket.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.id&&waiting.has(msg.id)){const call=waiting.get(msg.id);waiting.delete(msg.id);msg.error?call.reject(Error(JSON.stringify(msg.error))):call.resolve(msg.result);}if(msg.method==='Runtime.exceptionThrown')exceptions.push(msg.params.exceptionDetails);});
 await send('Page.enable');await send('Runtime.enable');await send('Network.setCookie',{name:'User_Token',value:cookie.split(';')[0].split('=')[1],url:base,httpOnly:true});
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
 await send('Page.navigate',{url:base+'/index.php?view=received'});
 const ready="document.readyState==='complete'&&window.eofficeSessionState?.status==='authenticated'&&document.getElementById('load_data')?.style.display==='none'";
 await until(ready);
 assert.equal(await evaluate("localStorage.getItem('read_status_change')"),'NotRead','new users start in pending');
 await evaluate("document.getElementById('received-pending-filter').click();document.getElementById('received-pending-filter').click()");
 await until("document.getElementById('sub_head')?.textContent==='รอดำเนินการ'&&document.getElementById('load_data')?.style.display==='none'");
 assert.equal(await evaluate("document.getElementById('received-pending-filter').getAttribute('aria-pressed')"),'true');
 await evaluate(`view_doc_detail(${doc},'received')`);await evaluate("document.querySelector('#Sign_File_API a').click()");
 await until("typeof window.saveToServer==='function'&&document.querySelector('.drawing-canvas')&&document.querySelector('#btn-hand')?.classList.contains('active')");
 await evaluate("setTool('stamp');document.querySelector('.drawing-canvas').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:150,clientY:400}))");
 const saved=await evaluate("(async()=>{let saved=null;const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).includes('upload_pdf'))saved=await response.clone().json();return response;};await saveToServer();return saved;})()");
 assert.equal(saved?.status,'success','real stamp-only save must succeed');
 assert.equal((await request('/api/get_data_received.php',{Year:'2569',Doc_Id:doc},cookie)).body[0].is_signed,true);
 await evaluate('history.back()');await until("location.pathname==='/index.php'&&"+ready);
 assert.equal(await evaluate("localStorage.getItem('read_status_change')"),'NotRead','Back preserves pending category');
 assert.equal(await evaluate(`data_save.some(row=>Number(row.doc_id)===${doc})`),false,'saved stamp leaves pending inbox');
 assert.equal(await evaluate("document.getElementById('received-pending-filter').getAttribute('aria-pressed')"),'true');
 for(const [button,filter,present]of [['received-all-filter','',true],['received-signed-filter','Readed',true],['received-pending-filter','NotRead',false]]){
  await evaluate(`document.getElementById('${button}').click()`);await until(ready);
  assert.equal(await evaluate("localStorage.getItem('read_status_change')"),filter);
  assert.equal(await evaluate(`data_save.some(row=>Number(row.doc_id)===${doc})`),present,button);
 }
 await send('Page.navigate',{url:base+'/index.php?view=received&id='+doc});
 await until(ready+"&&document.getElementById('doc_detail').classList.contains('active')");
 assert.equal(await evaluate("localStorage.getItem('read_status_change')"),'NotRead','a direct signed link preserves the pending category');
 assert.equal(await evaluate(`data_save.some(row=>Number(row.doc_id)===${doc})`),false,'the background list remains pending');
 await evaluate('closeModal()');
 for(const width of [390,320]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'no mobile overflow '+width);}
 assert.equal(exceptions.length,0,JSON.stringify(exceptions));
 console.log('PASS real stamp-only PDF save, browser Back, persisted pending filter, explicit categories, active states and mobile 390/320px');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 if(socket)socket.close();if(chrome){const done=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await done;}server.kill();
 if(doc)cp.execFileSync(php,['-r',`require 'config/bootstrap.php';$p=app_pdo();$q=$p->prepare('DELETE FROM t_document_upload WHERE Doc_File_Link=?');$q->execute([(string)${doc}]);$q=$p->prepare('DELETE FROM t_document WHERE Doc_Id=?');$q->execute([${doc}]);`],{env,stdio:'ignore'});
 if(attachment&&path.basename(attachment.name)===attachment.name&&/^\d{4}$/.test(String(attachment.year))){
  for(const file of [path.join(env.EOFFICE_STORAGE,'original',String(attachment.year),attachment.name),path.join(env.EOFFICE_STORAGE,'e-sign',String(attachment.year),`signed_${doc}_${attachment.name}`)])fs.rmSync(file,{force:true});
 }
 try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}catch{}
});
