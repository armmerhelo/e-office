// Real Chromium: stamp a PDF, save it, then return to the pending inbox with Back.
const cp=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const temp=path.join(os.tmpdir(),'opencode'),port=Number(process.env.SIGN_BROWSER_PORT||8223),cdp=Number(process.env.SIGN_CDP_PORT||9253),base=`http://localhost:${port}`;
const database=process.env.TEST_DATABASE||'eoffice_review_test';
if(!database.endsWith('_test'))throw Error('Only test databases may be used');
const env={...process.env,DB_DATABASE:database,APP_URL:base,EOFFICE_MOCK_SERVICES:'true',EOFFICE_MEMBER_VERSION_KEY:crypto.randomBytes(32).toString('base64'),EOFFICE_STORAGE:path.join(temp,'eoffice-test-storage')};
const seed=JSON.parse(cp.execFileSync(php,['tests/seed.php'],{env,encoding:'utf8'}));
const server=cp.spawn(php,['-S',`localhost:${port}`,'scripts/router.php'],{env,stdio:'ignore'});
const profile=fs.mkdtempSync(path.join(temp,'stamp-inbox-browser-'));let chrome,socket,id=0,doc,legacy,cookie,attachment;const waiting=new Map(),exceptions=[];
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
  cp.execFileSync(php,['tests/inspect.php','inbox_after_cutoff',String(doc)],{env,encoding:'utf8'});
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
  await until("typeof window.saveToServer==='function'&&document.querySelector('.drawing-canvas')&&document.getElementById('loading').classList.contains('hidden')&&document.querySelector('#btn-hand')?.classList.contains('active')");
  await evaluate("setTool('stamp');{const canvas=document.querySelector('.drawing-canvas'),rect=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}));}");
 const saved=await evaluate("(async()=>{let saved=null;const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).includes('upload_pdf'))saved=await response.clone().json();return response;};await saveToServer();return saved;})()");
 assert.equal(saved?.status,'success','real stamp-only save must succeed');
  assert.equal((await request('/api/get_data_received.php',{Year:'2569',Doc_Id:doc},cookie)).body[0].is_signed,true);
  const penSaved=await evaluate(`(async()=>{
    setTool('pen');const canvas=document.querySelector('.drawing-canvas'),rect=canvas.getBoundingClientRect();
    const draw=()=>{canvas.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}));canvas.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:rect.left+rect.width/2+20,clientY:rect.top+rect.height/2+15}));canvas.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:rect.left+rect.width/2+40,clientY:rect.top+rect.height/2}));canvas.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));};
    draw();let result=null,declared=null;const original=window.fetch;
    window.fetch=async(url,options)=>{if(String(url).includes('upload_pdf'))declared=options.body.get('confirm_pen_signature');const response=await original(url,options);if(String(url).includes('upload_pdf'))result=await response.clone().json();return response;};
    try{await saveToServer();return {result,declared};}finally{window.fetch=original;}
  })()`);
  assert.equal(penSaved.declared,'1');assert.equal(penSaved.result?.status,'success','real pen save must declare pen forwarding');
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
 // A same-origin sibling document updates localStorage, producing an actual
 // cross-document storage event in the inbox rather than a synthetic event.
 await evaluate("(async()=>{const frame=document.createElement('iframe');frame.hidden=true;const loaded=new Promise(resolve=>frame.onload=resolve);frame.src='/offline.html';document.body.append(frame);await loaded;frame.contentWindow.localStorage.setItem('read_status_change','Readed');})()");
  await until(ready+"&&document.getElementById('sub_head').textContent==='ดำเนินการแล้ว'");
 assert.equal(await evaluate("document.getElementById('received-signed-filter').getAttribute('aria-pressed')"),'true');
 assert.equal(await evaluate(`data_save.some(row=>Number(row.doc_id)===${doc})`),true,'cross-document selection must match the loaded category');
 await evaluate("document.getElementById('received-pending-filter').click()");await until(ready);
 const injection=await send('Page.addScriptToEvaluateOnNewDocument',{source:`{
  const original=window.fetch;let fail=true;
  window.fetch=(url,options)=>{
   if(String(url).includes('get_data_received.php')&&!JSON.parse(options.body).Doc_Id&&fail){fail=false;return Promise.resolve(new Response('{}',{status:503}));}
   return original(url,options);
  };
 }`});
 await send('Page.navigate',{url:base+'/index.php?view=received&id='+doc});
 await until(ready+"&&document.getElementById('received-retry')");
 assert.equal(await evaluate("document.getElementById('doc_detail').classList.contains('active')"),true,'a background error must preserve details');
 assert.equal(await evaluate("document.getElementById('loop_receive').textContent.includes('โหลดรายการหนังสือไม่สำเร็จ')"),true,'the list must show an error rather than an empty result');
 assert.equal(await evaluate('data_save.length'),0,'a signed deep link is not pending-list data');
 await evaluate("closeModal();document.getElementById('received-retry').click()");
 await until(ready+"&&!document.getElementById('received-retry')");
 assert.equal(await evaluate(`data_save.some(row=>Number(row.doc_id)===${doc})`),false,'retry must restore pending work, not reopen the signed document');
  await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});
  const legacyForm=new FormData();
  for(const [k,v]of Object.entries({doc_number:'LEGACY-BROWSER-'+Date.now(),doc_name:'Synthetic legacy inbox regression',doc_type:'หนังสือ',doc_date_receive:'2026-10-30','send_to[]':seed.users.recipient}))legacyForm.append(k,v);
  legacy=(await request('/api/create_document.php',legacyForm,owner)).body.doc_id;
  cp.execFileSync(php,['tests/inspect.php','inbox_before_cutoff',String(legacy)],{env,encoding:'utf8'});
  await evaluate('get_data_api_received(1)');await until(ready+`&&data_save.some(row=>Number(row.doc_id)===${legacy})`);
  await evaluate(`view_doc_detail(${legacy},'received')`);
  await until(ready+`&&!data_save.some(row=>Number(row.doc_id)===${legacy})`);
  assert.equal(await evaluate("document.getElementById('doc_detail').classList.contains('active')"),true,'legacy read refreshes the list without closing details');
  await evaluate("closeModal();document.getElementById('received-signed-filter').click()");
  await until(ready+`&&data_save.some(row=>Number(row.doc_id)===${legacy})`);
  assert.equal(await evaluate(`data_save.find(row=>Number(row.doc_id)===${legacy}).is_signed`),false,'reading never invents a signature');
  assert.equal(await evaluate(`data_save.find(row=>Number(row.doc_id)===${legacy}).completion_reason`),'legacy_read');
  assert.equal(await evaluate("document.getElementById('loop_receive').textContent.includes('อ่านแล้วตามเกณฑ์เดิม')"),true);
  assert.equal(await evaluate(`!!document.getElementById('doc_status_${legacy}')`),false,'completed legacy document has no pending dot');
 for(const width of [390,320]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'no mobile overflow '+width);}
 assert.equal(exceptions.length,0,JSON.stringify(exceptions));
 console.log('PASS real stamp-only save/Back, legacy read completion without signature, categories, cross-document storage, failed background list/retry and mobile 390/320px');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 if(socket)socket.close();if(chrome){const done=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await done;}server.kill();
 if(doc)cp.execFileSync(php,['-r',`require 'config/bootstrap.php';$p=app_pdo();$q=$p->prepare('DELETE FROM t_document_upload WHERE Doc_File_Link=?');$q->execute([(string)${doc}]);$q=$p->prepare('DELETE FROM t_document WHERE Doc_Id=?');$q->execute([${doc}]);`],{env,stdio:'ignore'});
 if(legacy)cp.execFileSync(php,['-r',`require 'config/bootstrap.php';app_pdo()->prepare('DELETE FROM t_document WHERE Doc_Id=?')->execute([${legacy}]);`],{env,stdio:'ignore'});
 if(attachment&&path.basename(attachment.name)===attachment.name&&/^\d{4}$/.test(String(attachment.year))){
  for(const file of [path.join(env.EOFFICE_STORAGE,'original',String(attachment.year),attachment.name),path.join(env.EOFFICE_STORAGE,'e-sign',String(attachment.year),`signed_${doc}_${attachment.name}`)])fs.rmSync(file,{force:true});
 }
 try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}catch{}
});
