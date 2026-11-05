// Opt-in browser regression against an isolated local, mock-services preview.
// Credentials are supplied via EOFFICE_QA_EMAIL / EOFFICE_QA_PASSWORD.
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const base=process.env.EOFFICE_QA_BROWSER_URL||'http://127.0.0.1:8188';
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname));
assert.ok(process.env.EOFFICE_QA_EMAIL&&process.env.EOFFICE_QA_PASSWORD,'Local QA credentials required');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'opencode','siya-ux-'));
const port=Number(process.env.QA_CDP_PORT||9237);
const browser=cp.spawn(process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','about:blank'],{stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,sequence=0;const pending=new Map(),errors=[];
function send(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},30000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression){for(let i=0;i<120;i++){if(await evaluate(`(()=>{try{return (${expression});}catch{return false;}})()`))return;await pause(100);}throw Error('Timed out: '+expression);}
const root="document.querySelector('.eoffice-module-host:not([hidden])').shadowRoot";
const el=id=>`${root}.getElementById(${JSON.stringify(id)})`;
const click=id=>evaluate(`${el(id)}.click()`);
const fill=(id,value)=>evaluate(`(()=>{const e=${el(id)};e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
async function check(name,fn){await fn();console.log('PASS '+name);}
async function run(){
 let targets;for(let i=0;i<100;i++){try{targets=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());break;}catch{await pause(100);}}
 assert.ok(targets,'Chrome started');socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
 socket.addEventListener('message',event=>{const r=JSON.parse(event.data);if(pending.has(r.id)){const p=pending.get(r.id);pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails);});
 await send('Page.enable');await send('Runtime.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base+'/index.php?view=public'});
 await until("typeof window.EOFFICE_MOCK_SERVICES==='boolean'");assert.equal(await evaluate('window.EOFFICE_MOCK_SERVICES'),true);
 assert.equal(await evaluate(`fetch('/api/auth_login.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({username:process.env.EOFFICE_QA_EMAIL,password:process.env.EOFFICE_QA_PASSWORD})})}).then(r=>r.status)`),200);
 await send('Page.navigate',{url:base+'/index.php?view=siya_news'});
  await until(`${el('news-tabs')}?.children.length>0`);
  await check('compact header keeps policy visible without a separate banner',async()=>{
   for(const width of [1440,940,680,390,320]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=680});
    const layout=await evaluate(`(()=>{const header=${root}.querySelector('.news-brand');return {height:header.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth,notice:!!${root}.querySelector('.news-notice'),text:header.textContent};})()`);
    assert.ok(layout.height<=110,JSON.stringify({width,...layout}));assert.equal(layout.overflow,false);assert.equal(layout.notice,false);
    assert.match(layout.text,/ดาวน์โหลดเมื่อผ่านตรวจ/);assert.match(layout.text,/ไม่เผยแพร่สาธารณะ/);assert.match(layout.text,/ใช้งานภายใน/);
   }
   await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  });
 // Confirm prompts are controlled in-page so cancellation is exercised, not auto-accepted.
 await evaluate('window.__qaConfirm=true;window.confirm=()=>window.__qaConfirm');
  const title='UX browser regression '+Date.now();let newsId;
  await check('proofread suggests without saving, applies explicitly and invalidates stale results',async()=>{
   await click('create-news');await fill('news-title','ขออนุญาติ');await fill('news-body','ข้อความทดสอบคำผิด');
   await evaluate(`(()=>{window.__proofreadFetch=window.fetch;window.__proofreadWrites=0;window.fetch=(url,options)=>{if(String(url).includes('siya-news-proofread.php'))return Promise.resolve(new Response(JSON.stringify({status:'success',suggestions:[{field:'title',original:'อนุญาติ',replacement:'อนุญาต',reason:'คำสะกดที่ถูกต้อง'}]}),{headers:{'Content-Type':'application/json'}}));if(options?.method==='POST')window.__proofreadWrites++;return window.__proofreadFetch(url,options);};})()`);
   await click('check-news-spelling');await until(`${el('news-proofread-results')}.querySelector('[data-proofread-index]')&&!${el('siya-news-app')}.hasAttribute('aria-busy')`);
   assert.equal(await evaluate(`${el('news-title')}.value`),'ขออนุญาติ');assert.equal(await evaluate('window.__proofreadWrites'),0);
   await evaluate(`${el('news-proofread-results')}.querySelector('[data-proofread-index]').click()`);assert.equal(await evaluate(`${el('news-title')}.value`),'ขออนุญาต');
   await fill('news-title','ขออนุญาติ');await click('check-news-spelling');await until(`${el('news-proofread-results')}.querySelector('[data-proofread-index]')&&!${el('siya-news-app')}.hasAttribute('aria-busy')`);
   await fill('news-body','แก้เนื้อหาแล้ว');assert.equal(await evaluate(`${el('news-proofread-results')}.querySelectorAll('[data-proofread-index]').length`),0);
    await evaluate('window.fetch=window.__proofreadFetch');
    await fill('news-title','พัฒนา อนุญาติ');
    await evaluate(`window.fetch=(url,options)=>String(url).includes('siya-news-proofread.php')?Promise.resolve(new Response(JSON.stringify({status:'success',suggestions:[{field:'title',original:'พัฒนา',replacement:'การพัฒนา',reason:'ทดสอบคำแก้ที่มีคำเดิม'},{field:'title',original:'อนุญาติ',replacement:'อนุญาต',reason:'สะกดผิด'}]}),{headers:{'Content-Type':'application/json'}})):window.__proofreadFetch(url,options)`);
    await click('check-news-spelling');await until(`${el('news-proofread-results')}.querySelector('[data-proofread-index]')&&!${el('siya-news-app')}.hasAttribute('aria-busy')`);
    await evaluate(`${el('news-proofread-results')}.querySelector('[data-proofread-index]').click()`);
    assert.equal(await evaluate(`${el('news-title')}.value`),'การพัฒนา อนุญาติ');
    assert.equal(await evaluate(`${el('news-proofread-results')}.querySelectorAll('[data-proofread-index]').length`),1);
    await evaluate(`${el('news-proofread-results')}.querySelector('[data-proofread-index]').click()`);
    assert.equal(await evaluate(`${el('news-title')}.value`),'การพัฒนา อนุญาต');
    assert.equal(await evaluate(`${el('news-proofread-results')}.querySelectorAll('[data-proofread-index]').length`),0);
    await evaluate('window.fetch=window.__proofreadFetch');
    const backend=await evaluate(`fetch('/api/siya-news-proofread.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'ขออนุญาติ',body:'ข่าวสังเคราะห์',consent:true,_expected_owner:window.eofficeUser.id})}).then(r=>r.json())`);
   assert.equal(backend.status,'success');assert.equal(backend.mock,true);assert.equal(backend.suggestions[0].replacement,'อนุญาต');
    const cooldown=await evaluate(`fetch('/api/siya-news-proofread.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'ทดสอบ',body:'ข่าวสังเคราะห์',consent:true,_expected_owner:window.eofficeUser.id})}).then(r=>r.status)`);assert.equal(cooldown,429);
   await click('news-tab-mine');
  });
  await check('proofread overlap, repeated text, Unicode offsets, XSS, invalid output, failure and cancelled consent',async()=>{
   await click('create-news');await fill('news-title','😀 อนุญาติ อนุญาติ');await fill('news-body','อนุญาติ');
   await evaluate(`(()=>{window.__proofreadEdgeFetch=window.fetch;window.__proofreadCalls=0;window.fetch=(url,options)=>{if(!String(url).includes('siya-news-proofread.php'))return window.__proofreadEdgeFetch(url,options);window.__proofreadCalls++;window.__proofreadPayload=JSON.parse(options.body);return Promise.resolve(new Response(JSON.stringify(window.__proofreadReply),{status:window.__proofreadStatus||200,headers:{'Content-Type':'application/json'}}));};})()`);
   const reply=async(suggestions,status=200)=>evaluate(`window.__proofreadReply=${JSON.stringify(status===200?{status:'success',suggestions}:{status:'error',message:'QA proofread offline'})};window.__proofreadStatus=${status}`);
   const suggestion=(field,original,replacement,reason='ทดสอบ')=>({field,original,replacement,reason});
   await reply([suggestion('title','อนุญาติ','อนุญาต','<img src=x onerror="window.__proofreadXSS=1">'),suggestion('title','อนุญาติ อนุญาติ','คำแนะนำทับซ้อน'),suggestion('body','อนุญาติ','อนุญาต')]);
   await evaluate('window.__qaConfirm=false');await click('check-news-spelling');assert.equal(await evaluate('window.__proofreadCalls'),0);await evaluate('window.__qaConfirm=true');
   await click('check-news-spelling');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-proofread-results')}.querySelectorAll('[data-proofread-index]').length===3`);
   assert.equal(await evaluate('window.__proofreadPayload._expected_owner'),await evaluate('window.eofficeUser.id'));
   assert.equal(await evaluate(`${el('news-proofread-results')}.querySelectorAll('img').length`),0);
   assert.doesNotMatch(await evaluate(`${el('news-detail')}.textContent`),/gemini/i);
   await send('Emulation.setDeviceMetricsOverride',{width:320,height:844,deviceScaleFactor:1,mobile:true});assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
   const proofreadingCapture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(profile,'mobile-proofread.png'),Buffer.from(proofreadingCapture.data,'base64'));
   await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
   await evaluate(`${el('news-proofread-results')}.querySelector('[data-proofread-index]').click()`);
   assert.equal(await evaluate(`${el('news-title')}.value`),'😀 อนุญาต อนุญาติ');assert.equal(await evaluate(`${el('news-proofread-results')}.querySelectorAll('[data-proofread-index]').length`),1);
   await evaluate(`${el('news-proofread-results')}.querySelector('[data-proofread-index]').click()`);
   assert.equal(await evaluate(`${el('news-body')}.value`),'อนุญาต');assert.match(await evaluate(`${el('news-proofread-results')}.textContent`),/คำซ้ำหรือคำแนะนำทับซ้อน/);
   for(const invalid of [[suggestion('title','อนุญาติ','อนุญาติ')],[suggestion('title','อนุญาติ','หัวข้อ\r\nหลายบรรทัด')],[suggestion('title','อนุญาติ','x'.repeat(501))],[suggestion('secret','อนุญาติ','แก้')],Array.from({length:61},()=>suggestion('title','อนุญาติ','อนุญาต'))]){
    await reply(invalid);await click('check-news-spelling');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);
    assert.match(await evaluate(`${el('news-proofread-results')}.textContent`),/ไม่สมบูรณ์/);assert.equal(await evaluate(`${el('news-title')}.value`),'😀 อนุญาต อนุญาติ');
   }
   await reply([],503);await click('check-news-spelling');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);assert.match(await evaluate(`${el('news-proofread-results')}.textContent`),/QA proofread offline/);assert.equal(await evaluate(`${el('news-title')}.disabled`),false);
   await reply([]);await click('check-news-spelling');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);assert.match(await evaluate(`${el('news-proofread-results')}.textContent`),/ตัวช่วยไม่พบ/);
   await fill('news-title','ก'.repeat(254)+'ข');await reply([suggestion('title','ข','เพิ่ม')]);
   await click('check-news-spelling');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-proofread-results')}.querySelector('[data-proofread-index]')`);
   await evaluate(`${el('news-proofread-results')}.querySelector('[data-proofread-index]').click()`);assert.equal(await evaluate(`${el('news-title')}.value`),'ก'.repeat(254)+'ข');assert.match(await evaluate(`${el('news-message-content')}.textContent`),/ยาวเกินกำหนด/);
   await fill('news-body','คำแรก คำถัดไป');await reply([suggestion('body','คำแรก','แก้\r\nสองบรรทัด'),suggestion('body','คำถัดไป','แก้ถัดไป')]);
   await click('check-news-spelling');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-proofread-results')}.querySelectorAll('[data-proofread-index]').length===2`);
   await evaluate(`${el('news-proofread-results')}.querySelector('[data-proofread-index]').click()`);await evaluate(`${el('news-proofread-results')}.querySelector('[data-proofread-index]').click()`);
   assert.equal(await evaluate(`${el('news-body')}.value`),'แก้\nสองบรรทัด แก้ถัดไป');
   await fill('news-body','อนุญาติ');await reply([suggestion('body','อนุญาติ','อนุญาต')]);
   await click('check-news-spelling');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-proofread-results')}.querySelectorAll('[data-proofread-index]').length===1`);
   await evaluate('window.__proofreadOwner=window.eofficeUser.id;window.eofficeUser.id=Number(window.__proofreadOwner)+1000000');
   try{
    await evaluate(`${el('news-proofread-results')}.querySelector('[data-proofread-index]').click()`);
    assert.match(await evaluate(`${el('news-proofread-results')}.textContent`),/บัญชีเปลี่ยน/);assert.equal(await evaluate(`${el('news-body')}.value`),'อนุญาติ');
   }finally{await evaluate('window.eofficeUser.id=window.__proofreadOwner');}
   await evaluate(`window.fetch=(url,options)=>String(url).includes('siya-news-proofread.php')?Promise.reject(new TypeError('QA proofread network failure')):window.__proofreadEdgeFetch(url,options)`);
   await click('check-news-spelling');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);assert.match(await evaluate(`${el('news-proofread-results')}.textContent`),/QA proofread network failure/);assert.equal(await evaluate(`${el('save-news-content')}.disabled`),false);
   await reply([suggestion('body','อนุญาติ','อนุญาต')]);
   await evaluate(`window.fetch=(url,options)=>String(url).includes('siya-news-proofread.php')?new Promise(resolve=>window.__proofreadResolve=()=>resolve(new Response(JSON.stringify(window.__proofreadReply),{headers:{'Content-Type':'application/json'}}))):window.__proofreadEdgeFetch(url,options)`);
   await click('check-news-spelling');await until('!!window.__proofreadResolve');assert.equal(await evaluate(`${el('news-body')}.disabled`),true);
   await evaluate('window.__proofreadOwner=window.eofficeUser.id;window.eofficeUser.id=Number(window.__proofreadOwner)+1000000;window.__proofreadResolve()');
   try{await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);assert.match(await evaluate(`${el('news-proofread-results')}.textContent`),/บัญชีเปลี่ยน/);assert.equal(await evaluate(`${el('news-proofread-results')}.querySelectorAll('[data-proofread-index]').length`),0);}finally{await evaluate('window.eofficeUser.id=window.__proofreadOwner');}
   await evaluate(`window.__proofreadTimer=window.setTimeout;window.setTimeout=(fn,delay,...args)=>window.__proofreadTimer(fn,delay===120000?40:delay,...args);window.fetch=(url,options)=>String(url).includes('siya-news-proofread.php')?new Promise(()=>{}):window.__proofreadEdgeFetch(url,options)`);
   await click('check-news-spelling');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);assert.match(await evaluate(`${el('news-proofread-results')}.textContent`),/หมดเวลา/);assert.equal(await evaluate(`${el('news-body')}.disabled`),false);
   await evaluate('window.setTimeout=window.__proofreadTimer');
   await evaluate(`window.__proofreadResolve=null;window.fetch=(url,options)=>String(url).includes('siya-news-proofread.php')?new Promise(resolve=>window.__proofreadResolve=()=>resolve(new Response(JSON.stringify(window.__proofreadReply),{headers:{'Content-Type':'application/json'}}))):window.__proofreadEdgeFetch(url,options)`);
   await click('check-news-spelling');await until('!!window.__proofreadResolve');await fill('news-body','ข้อความใหม่ต้องไม่ถูกแทนที่');await evaluate('window.__proofreadResolve()');
   await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);assert.match(await evaluate(`${el('news-proofread-results')}.textContent`),/ข้อความเปลี่ยนแล้ว/);assert.equal(await evaluate(`${el('news-body')}.value`),'ข้อความใหม่ต้องไม่ถูกแทนที่');
   await evaluate('window.fetch=window.__proofreadEdgeFetch');await click('news-tab-mine');
  });
  await check('draft changes survive cancelled navigation',async()=>{
  await click('create-news');await fill('news-title',title);await fill('news-body','ข้อความก่อนตรวจ');
  await evaluate('window.__qaConfirm=false');await click('news-tab-mine');
  assert.equal(await evaluate(`${el('news-title')}.value`),title);
  assert.match(await evaluate(`${el('news-save-state')}.textContent`),/ยังไม่บันทึก/);
  await evaluate('window.__qaConfirm=true');
 });
 await check('save and submit creates a review-ready story',async()=>{
  await click('submit-news');await until(`${el('news-message')}.textContent.includes('ส่งข่าวให้บรรณาธิการ')&&!${el('siya-news-app')}.hasAttribute('aria-busy')`);
  newsId=await evaluate(`${el('news-detail')}.querySelector('.eyebrow').textContent.match(/#([0-9]+)/)[1]`);
  assert.equal(await evaluate(`${el('news-detail')}.querySelector('.status-badge').dataset.status`),'review');
 });
  await check('reviewer saves corrections directly without returning to author',async()=>{
   assert.equal(await evaluate(`!!${el('return-news')}`),false);
   await click('edit-news');await fill('news-body','ผู้ตรวจแก้เนื้อหาโดยตรง');await click('save-news-content');
   await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);
   const news=await evaluate(`fetch('/api/siya-news.php?action=detail&id='+${JSON.stringify(newsId)}).then(r=>r.json()).then(r=>r.data)`);
   assert.equal(news.body,'ผู้ตรวจแก้เนื้อหาโดยตรง');assert.equal(news.status,'review');
  });
 await check('approval saves the latest visible content and review note',async()=>{
    if(await evaluate(`!!${el('edit-news')}`))await click('edit-news');await fill('news-body','ข้อความที่ผู้ตรวจแก้และต้องผ่านตรวจ');await fill('news-review-note','ตรวจแล้วจาก browser regression');
  assert.equal(await evaluate(`${el('news-review-form')}.querySelectorAll('.eo-btn--primary').length`),1);
  assert.equal(await evaluate(`${el('news-review-form')}.querySelector('.eo-btn--primary').id`),'approve-news');
  assert.equal(await evaluate(`Boolean(${el('news-images-section')}.compareDocumentPosition(${el('news-review-form')})&Node.DOCUMENT_POSITION_FOLLOWING)`),true);
   assert.equal(await evaluate(`!!${el('return-news')}`),false);
  assert.equal(await evaluate(`getComputedStyle(${el('save-news')}).backgroundColor`),'rgb(255, 255, 255)');
  await click('approve-news');await until(`${el('news-message')}.textContent.includes('ผ่านตรวจคำแล้ว')&&!${el('siya-news-app')}.hasAttribute('aria-busy')`);
  const news=await evaluate(`fetch('/api/siya-news.php?action=detail&id='+${JSON.stringify(newsId)}).then(r=>r.json()).then(r=>r.data)`);
  assert.equal(news.status,'approved');assert.equal(news.body,'ข้อความที่ผู้ตรวจแก้และต้องผ่านตรวจ');assert.equal(news.review_note,'ตรวจแล้วจาก browser regression');
  assert.equal(await evaluate(`${el('news-body')}.checkVisibility()`),false);
  assert.ok(await evaluate(`${el('news-detail')}.querySelector('.detail-toolbar a').getBoundingClientRect().top<900`));
  assert.equal(await evaluate(`${el('news-back')}.checkVisibility()`),false);
  assert.equal(await evaluate(`${el('news-detail')}.querySelector('.news-history').open`),false);
  await evaluate(`${el('news-detail')}.querySelector('.news-history>summary').click()`);
  assert.equal(await evaluate(`${el('news-detail')}.querySelector('.news-history .history-row').checkVisibility()`),true);
  await evaluate(`${el('news-detail')}.querySelector('.news-history>summary').click()`);
  assert.deepEqual(await evaluate(`(()=>{const button=${el('news-detail')}.querySelector('.detail-toolbar a'),heading=${el('siya-news-app')}.querySelector('h1');return {primary:getComputedStyle(button).backgroundColor,radius:getComputedStyle(button).borderRadius,headerBackground:getComputedStyle(heading.closest('header')).backgroundImage,font:getComputedStyle(heading).fontFamily.includes('Prompt')};})()`),{primary:'rgb(79, 70, 229)',radius:'8px',headerBackground:'none',font:true});
  const capture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(profile,'desktop.png'),Buffer.from(capture.data,'base64'));
 });
 await check('unchanged approved save does not revoke approval',async()=>{
  await click('edit-news');assert.match(await evaluate(`${el('news-detail')}.textContent`),/พักการดาวน์โหลด/);await click('save-news');
  await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);
  assert.equal(await evaluate(`fetch('/api/siya-news.php?action=detail&id='+${JSON.stringify(newsId)}).then(r=>r.json()).then(r=>r.data.status)`),'approved');
 });
 await check('editing approved content returns the story to review',async()=>{
  if(await evaluate(`!!${el('edit-news')}`))await click('edit-news');await fill('news-body','แก้ไขหลังอนุมัติ ต้องตรวจใหม่');
  assert.equal(await evaluate(`Boolean(${el('save-news-content')}.compareDocumentPosition(${el('news-images-section')})&Node.DOCUMENT_POSITION_FOLLOWING)`),true);
  assert.equal(await evaluate(`${el('save-news-content')}.classList.contains('eo-btn--primary')`),false);
  await click('save-news-content');
  await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-detail')}.querySelector('.status-badge').dataset.status==='review'`);
  assert.equal(await evaluate(`${el('news-message-content')}.hidden`),false);
 });
 await check('upload and approval save both caption edits and article edits',async()=>{
  await evaluate(`(async()=>{const sample=await fetch('/api/siya-news.php?action=detail&id=1').then(r=>r.json());const blob=await fetch('/'+sample.data.images[0].url).then(r=>r.blob());const files=new DataTransfer();files.items.add(new File([blob],'ux-fixture.png',{type:'image/png'}));const input=${el('news-image-files')};input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&!!${el('news-detail')}.querySelector('[data-caption]')`);
  await check('invalid image metadata blocks all writes before saving article changes',async()=>{
   await fill('news-body','เนื้อหาที่ห้ามบันทึกบางส่วนเมื่อคำบรรยายไม่ถูกต้อง');
   await evaluate(`(()=>{window.__qaMetadataFetch=window.fetch;window.__qaMetadataWrites=0;window.fetch=(url,options)=>{if(options?.method==='POST')window.__qaMetadataWrites++;return window.__qaMetadataFetch(url,options);};${el('news-detail')}.querySelector('[data-caption]').value='x'.repeat(501);})()`);
   await click('save-news-content');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-message-content')}.textContent.includes('500')`);
   assert.equal(await evaluate('window.__qaMetadataWrites'),0);await evaluate('window.fetch=window.__qaMetadataFetch');
  });
  await fill('news-body','เนื้อหาและภาพผ่านตรวจพร้อมกัน');
  await evaluate(`(()=>{const input=${el('news-detail')}.querySelector('[data-caption]');input.value='คำบรรยายล่าสุด';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(`(()=>{const input=${el('news-detail')}.querySelector('[data-credit]');input.value='เครดิตล่าสุด';input.dispatchEvent(new Event('input',{bubbles:true}));${el('news-detail')}.querySelector('.news-open-image').click();})()`);
  await until(`${el('news-image-viewer')}.open`);
  assert.match(await evaluate(`${el('news-viewer-caption')}.textContent`),/คำบรรยายล่าสุด.*เครดิตล่าสุด.*ยังไม่บันทึก/);
  assert.equal(await evaluate(`${el('news-full-image')}.alt`),'คำบรรยายล่าสุด');
  await click('close-news-viewer');await until(`!${el('news-image-viewer')}.open`);
  await fill('news-review-note','อนุมัติรวมภาพ');await click('approve-news');
  await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-detail')}.querySelector('.status-badge').dataset.status==='approved'`);
  const news=await evaluate(`fetch('/api/siya-news.php?action=detail&id='+${JSON.stringify(newsId)}).then(r=>r.json()).then(r=>r.data)`);
  assert.equal(news.body,'เนื้อหาและภาพผ่านตรวจพร้อมกัน');assert.equal(news.images[0].caption,'คำบรรยายล่าสุด');assert.equal(news.review_note,'อนุมัติรวมภาพ');
  assert.equal(await evaluate(`${el('news-detail')}.querySelectorAll('.news-image-info input').length`),0);
  assert.equal(await evaluate(`${el('news-detail')}.querySelector('.image-caption').textContent`),'คำบรรยายล่าสุด');
 });
 await check('toolbar feedback appears beside the toolbar without scrolling',async()=>{
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{}}})`);
  await click('copy-news');await until(`${el('news-message-toolbar')}.textContent.includes('คัดลอกข้อความข่าวแล้ว')`);
  assert.equal(await evaluate(`${el('news-message-toolbar')}.hidden`),false);
  assert.equal(await evaluate(`${el('news-detail-message')}.hidden`),true);
  assert.equal(await evaluate(`Boolean(${el('news-message-toolbar')}.compareDocumentPosition(${el('news-images-section')})&Node.DOCUMENT_POSITION_FOLLOWING)`),true);
 });
 await check('full image viewer loads uncropped image, traps focus, closes with Escape and restores focus',async()=>{
  // First native keyboard input focuses headless Chrome and triggers the shell's
  // session recheck, which intentionally closes modals. Settle that before opening.
  await send('Page.bringToFront');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await until(`window.eofficeSessionState.status==='authenticated'&&!${el('siya-news-app')}.closest('.eoffice-runtime-body').inert`);
  await evaluate(`${el('news-detail')}.querySelector('.news-open-image').click()`);
  await until(`${el('news-image-viewer')}.open&&${el('news-full-image')}.naturalWidth>0&&!${el('news-full-image')}.hidden`);
  assert.equal(await evaluate(`getComputedStyle(${el('news-full-image')}).objectFit`),'contain');
  assert.equal(await evaluate(`${root}.activeElement.id`),'close-news-viewer');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert.equal(await evaluate(`${el('news-image-viewer')}.contains(${root}.activeElement)`),true);
  const capture=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(profile,'image-viewer.png'),Buffer.from(capture.data,'base64'));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await until(`!${el('news-image-viewer')}.open`);
  assert.equal(await evaluate(`${root}.activeElement.classList.contains('news-open-image')`),true);
  await evaluate(`${el('news-detail')}.querySelector('.news-open-image').click()`);await click('close-news-viewer');await until(`!${el('news-image-viewer')}.open`);
 });
 await check('failed approval preserves visible edits and review notes',async()=>{
  await click('edit-news');await fill('news-body','ส่งตรวจรอบใหม่');await click('save-news');
  await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&!!${el('approve-news')}`);
  await fill('news-body','ข้อความต้องยังอยู่เมื่ออนุมัติล้มเหลว');await fill('news-review-note','หมายเหตุต้องไม่หาย');
  await evaluate(`(()=>{const original=window.fetch;window.__qaFetch=original;window.fetch=(url,options)=>String(url).includes('siya-news.php')&&options?.body&&JSON.parse(options.body).action==='approve'?Promise.resolve(new Response(JSON.stringify({status:'error',message:'QA simulated approval failure'}),{status:503,headers:{'Content-Type':'application/json'}})):original(url,options);})()`);
  await click('approve-news');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-message')}.textContent.includes('QA simulated')`);
  assert.equal(await evaluate(`${el('news-detail-message')}.hidden`),false);
  assert.equal(await evaluate(`${el('news-message')}.hidden`),true);
  assert.equal(await evaluate(`${el('news-body')}.value`),'ข้อความต้องยังอยู่เมื่ออนุมัติล้มเหลว');assert.equal(await evaluate(`${el('news-review-note')}.value`),'หมายเหตุต้องไม่หาย');
  await evaluate('window.fetch=window.__qaFetch');
  // A 5xx receipt is ambiguous: require an explicit latest-state review before retry.
  await click('approve-news');
  assert.match(await evaluate(`${el('news-detail-message')}.textContent`),/ยังยืนยันผลคำสั่งก่อนหน้าไม่ได้/);
  await click('cancel-edit');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&!!${el('edit-news')}`);
  await click('edit-news');await fill('news-review-note','หมายเหตุต้องไม่หาย');
 });
 await check('mobile detail has back navigation, single-column layout, and no overflow',async()=>{
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate(`${el('news-back')}.checkVisibility()`),true);
  assert.equal(await evaluate(`${el('siya-news-app')}.querySelector('.news-list-panel').checkVisibility()`),false);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  assert.equal(await evaluate(`${el('news-detail')}.querySelector('.news-history').open`),false);
  assert.equal(await evaluate(`(()=>{const images=${el('news-images-section')}.getBoundingClientRect(),review=${el('news-review-form')}.getBoundingClientRect();return review.top>=images.bottom;})()`),true);
  const reviewCapture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(profile,'mobile-review.png'),Buffer.from(reviewCapture.data,'base64'));
  await evaluate(`(()=>{window.__qaScrollCalls=0;${el('news-message')}.scrollIntoView=()=>window.__qaScrollCalls++;${el('news-detail-message')}.scrollIntoView=()=>window.__qaScrollCalls++;})()`);
  await click('approve-news');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-detail')}.querySelector('.status-badge').dataset.status==='approved'`);
  assert.equal(await evaluate('window.__qaScrollCalls'),0);
  assert.equal(await evaluate(`${el('news-detail')}.querySelectorAll('.news-image-info input').length`),0);
  await evaluate(`${el('news-detail')}.querySelector('.news-open-image').click()`);
  await until(`${el('news-image-viewer')}.open&&!${el('news-full-image')}.hidden`);
  assert.ok(await evaluate(`${el('news-image-viewer')}.getBoundingClientRect().width<=innerWidth`));
  await click('close-news-viewer');await until(`!${el('news-image-viewer')}.open`);
  const capture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(profile,'mobile.png'),Buffer.from(capture.data,'base64'));
 });
 await check('image removal failure and success both report inside the image section',async()=>{
  await click('edit-news');
  await evaluate(`(()=>{const original=window.fetch;window.__qaRemovalFetch=original;window.fetch=(url,options)=>String(url).includes('siya-news.php')&&options?.body&&typeof options.body==='string'&&JSON.parse(options.body).action==='image_remove'?Promise.resolve(new Response(JSON.stringify({status:'error',message:'QA simulated removal failure'}),{status:503,headers:{'Content-Type':'application/json'}})):original(url,options);})()`);
  await evaluate(`${el('news-detail')}.querySelector('[data-remove]').click()`);
  await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-message-images')}.textContent.includes('QA simulated removal failure')`);
  assert.equal(await evaluate(`${el('news-message-images')}.hidden`),false);
  assert.equal(await evaluate(`${el('news-detail-message')}.hidden`),true);
  assert.equal(await evaluate(`${el('news-detail')}.querySelectorAll('.news-image-card').length`),1);
  await evaluate('window.fetch=window.__qaRemovalFetch');
  await click('cancel-edit');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&!!${el('edit-news')}`);await click('edit-news');
  await evaluate(`${el('news-detail')}.querySelector('[data-remove]').click()`);
  await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-message-images')}.textContent.includes('นำภาพออกจากข่าวแล้ว')`);
  assert.equal(await evaluate(`${el('news-message-images')}.hidden`),false);
  assert.equal(await evaluate(`${el('news-detail-message')}.hidden`),true);
  assert.equal(await evaluate(`${el('news-detail')}.querySelectorAll('.news-image-card').length`),0);
  await click('news-back');assert.equal(await evaluate(`${el('siya-news-app')}.querySelector('.news-list-panel').checkVisibility()`),true);
 });
 await check('keyboard tabs have one tab stop and support End/Home',async()=>{
  await evaluate(`${el('news-tabs')}.querySelector('[aria-selected=true]').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`);
  assert.equal(await evaluate(`${el('news-tabs')}.lastElementChild.getAttribute('aria-selected')`),'true');
  await evaluate(`${el('news-tabs')}.lastElementChild.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`);
  assert.equal(await evaluate(`${el('news-tabs')}.firstElementChild.getAttribute('aria-selected')`),'true');
  assert.equal(await evaluate(`[...${el('news-tabs')}.children].filter(e=>e.tabIndex===0).length`),1);
 });
 await check('ambiguous create receipt preserves text, blocks duplicate POST, and recovers by exact latest article',async()=>{
  const recoveryTitle='Receipt recovery QA '+Date.now();await click('create-news');await fill('news-title',recoveryTitle);await fill('news-body','ข้อความต้องคงอยู่เมื่อคำตอบถูกแทนที่');
  await evaluate(`(()=>{const original=window.fetch;window.__qaReceiptFetch=original;window.__qaCreateCalls=0;window.fetch=async(url,options)=>{if(options?.body&&typeof options.body==='string'&&JSON.parse(options.body).action==='create'){window.__qaCreateCalls++;const response=await original(url,options);window.__qaCreated=(await response.json()).id;return new Response('<html>proxy page</html>',{status:408,headers:{'Content-Type':'text/html'}});}return original(url,options);};})()`);
  await click('save-news-content');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-message-content')}.textContent.includes('ยังยืนยันผล')`);
  assert.equal(await evaluate(`${el('news-title')}.value`),recoveryTitle);await click('save-news-content');assert.equal(await evaluate('window.__qaCreateCalls'),1);
   await evaluate(`window.fetch=(url,options)=>String(url).includes('action=list')?Promise.reject(new TypeError('QA recovery list offline')):window.__qaReceiptFetch(url,options)`);
   await click('refresh-news-list');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-detail-message')}.textContent.includes('QA recovery list offline')`);
   assert.equal(await evaluate(`${el('siya-news-app')}.classList.contains('show-detail')`),true);
   assert.equal(await evaluate(`${el('news-title')}.value`),recoveryTitle);
   assert.equal(await evaluate(`${el('news-body')}.value`),'ข้อความต้องคงอยู่เมื่อคำตอบถูกแทนที่');
   assert.equal(await evaluate(`${el('refresh-news-list')}.hidden`),false);
   assert.equal(await evaluate(`${el('refresh-news-list')}.disabled`),false);
   assert.equal(await evaluate(`${el('news-message')}.textContent.includes('โหลดรายการล่าสุดแล้ว')`),false);
   await evaluate('window.fetch=window.__qaReceiptFetch');await click('refresh-news-list');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);
  const id=await evaluate('window.__qaCreated');await evaluate(`${el('news-list')}.querySelector('[data-news-id="${id}"]').click()`);await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&!!${el('edit-news')}`);
  assert.equal(await evaluate(`${el('news-detail')}.querySelector('h2').textContent`),recoveryTitle);await click('news-back');
 });
 await check('incomplete detail response preserves the existing edited form',async()=>{
  await click('create-news');await fill('news-title','Detail recovery QA');await fill('news-body','ไม่ทิ้งฟอร์มเมื่อรายละเอียดตอบไม่ครบ');await click('save-news-content');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);
  await fill('news-body','ยังต้องอยู่ในฟอร์ม');
  await evaluate(`(()=>{window.__qaDetailFetch=window.fetch;window.fetch=(url,options)=>String(url).includes('action=detail')?Promise.resolve(new Response(JSON.stringify({status:'success',data:{id:0}}),{headers:{'Content-Type':'application/json'}})):window.__qaDetailFetch(url,options);})()`);
  await click('cancel-edit');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-detail-message')}.textContent.includes('ข้อมูลรายละเอียดข่าวไม่ครบ')`);
  assert.equal(await evaluate(`${el('news-body')}.value`),'ยังต้องอยู่ในฟอร์ม');
  await evaluate('window.fetch=window.__qaDetailFetch');await click('news-back');
 });
 await check('list pagination exposes older rows and resets offset when searching',async()=>{
  await evaluate(`(()=>{const original=window.fetch;window.__qaPaginationFetch=original;window.fetch=(url,options)=>{const parsed=new URL(String(url),location.href);if(parsed.pathname.endsWith('/siya-news.php')&&parsed.searchParams.get('action')==='list'){const offset=Number(parsed.searchParams.get('offset')||0),query=parsed.searchParams.get('q'),rows=Array.from({length:query?1:offset?1:100},(_,i)=>({id:900000+offset+i,title:query?'Search result':'Pagination row '+(offset+i),status:'draft',image_count:0}));return Promise.resolve(new Response(JSON.stringify({status:'success',data:rows}),{headers:{'Content-Type':'application/json'}}));}return original(url,options);};})()`);
  await click('news-tab-review');await until(`${el('news-list')}.children.length===100&&!${el('news-load-more')}.hidden`);
  await click('news-load-more');await until(`${el('news-list')}.children.length===101`);assert.equal(await evaluate(`${el('news-load-more')}.hidden`),true);
  await fill('news-search','unique');await until(`${el('news-list')}.textContent.includes('Search result')`);assert.equal(await evaluate(`${el('news-list')}.children.length`),1);
  await evaluate('window.fetch=window.__qaPaginationFetch');await fill('news-search','');await click('news-tab-mine');await until(`!${el('news-load-more')}.disabled`);
 });
 await check('a response body that never finishes times out and releases the UI',async()=>{
  await evaluate(`(()=>{window.__qaDeadlineTimer=window.setTimeout;window.__qaDeadlineFetch=window.fetch;window.setTimeout=(fn,delay,...args)=>window.__qaDeadlineTimer(fn,delay===120000?40:delay,...args);window.fetch=(url,options)=>String(url).includes('action=list')?Promise.resolve({ok:true,status:200,headers:new Headers({'Content-Type':'application/json'}),json:()=>new Promise(()=>{})}):window.__qaDeadlineFetch(url,options);})()`);
  await click('news-tab-review');await until(`${el('news-message')}.textContent.includes('หมดเวลา')&&!${el('news-load-more')}.disabled`);
  assert.equal(await evaluate(`${el('news-load-more')}.disabled`),false);
  await evaluate('window.fetch=window.__qaDeadlineFetch;window.setTimeout=window.__qaDeadlineTimer');await click('news-tab-mine');
 });
 if(process.env.EOFFICE_QA_ROLES==='1'){
  const fixture=cp.spawnSync(process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe',['tests/siya-news-role-fixture.php'],{encoding:'utf8',env:process.env});
  assert.equal(fixture.status,0,fixture.stdout+fixture.stderr);const accounts=JSON.parse(fixture.stdout);
  async function login(role){
   assert.equal(await evaluate(`fetch('/api/auth_login.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({username:accounts[role],password:process.env.EOFFICE_QA_PASSWORD})})}).then(r=>r.status)`),200);
   await send('Page.navigate',{url:base+'/index.php?view=siya_news'});
   if(role!=='none')await until(`${el('news-tabs')}?.children.length>0`);
   else await until("window.eofficeSessionState?.status==='authenticated'");
   await evaluate('window.__qaConfirm=true;window.confirm=()=>window.__qaConfirm');
  }
  const detail=()=>evaluate(`fetch('/api/siya-news.php?action=detail&id='+${JSON.stringify(newsId)}).then(async r=>({status:r.status,body:await r.json()}))`);
   const selectNews=async()=>{const selector='.news-list-item[data-news-id="'+newsId+'"]';await until(`!!${el('news-list')}.querySelector(${JSON.stringify(selector)})`);await evaluate(`${el('news-list')}.querySelector(${JSON.stringify(selector)}).click()`);await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&(${el('news-detail')}.querySelector('.eyebrow')?.textContent.includes(${JSON.stringify('#'+newsId+' ·')}))`);assert.match(await evaluate(`${el('news-detail')}.querySelector('.eyebrow').textContent`),new RegExp('#'+newsId+' ·'));};
  await check('submit-only role creates long copy but cannot access editor or producer endpoints',async()=>{
   await login('submit');assert.equal(await evaluate(`${el('news-tabs')}.children.length`),1);
   await click('create-news');await fill('news-title','Role and upload QA '+Date.now());await fill('news-body','ข่าวทดสอบเนื้อหายาวสำหรับตรวจบนมือถือ\n'.repeat(200));await click('save-news-content');
   await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-detail')}.querySelector('.eyebrow').textContent.includes('#')`);
   newsId=await evaluate(`${el('news-detail')}.querySelector('.eyebrow').textContent.match(/#([0-9]+)/)[1]`);
   assert.equal(await evaluate(`fetch('/api/siya-news.php?action=list&scope=review').then(r=>r.status)`),403);
   assert.equal(await evaluate(`fetch('/api/siya-news-export.php?id='+${JSON.stringify(newsId)}).then(r=>r.status)`),403);
  });
  await check('slow batch, rejected upload, and lost response keep per-file state without duplicating committed files',async()=>{
   await evaluate(`(()=>{const original=window.fetch;window.__qaBatchFetch=original;window.__qaUploadCalls=[];window.__qaRejected=false;window.__qaLost=false;window.fetch=async(url,options)=>{if(options?.body instanceof FormData&&options.body.get('action')==='upload'){const name=options.body.get('image').name;window.__qaUploadCalls.push(name);if(name==='batch-1.png'&&!window.__qaReleased)await new Promise(resolve=>window.__qaReleaseUpload=()=>{window.__qaReleased=true;resolve();});if(name==='batch-2.png'&&!window.__qaRejected){window.__qaRejected=true;return new Response(JSON.stringify({status:'error',message:'QA rejected upload'}),{status:400,headers:{'Content-Type':'application/json'}});}const result=await original(url,options);if(name==='batch-3.png'&&!window.__qaLost){window.__qaLost=true;await result.text();throw new TypeError('QA lost response after commit');}return result;}return original(url,options);};})()`);
    await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=900;canvas.height=600;canvas.getContext('2d').fillRect(0,0,900,600);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));window.__qaBatchBlob=blob;const data=new DataTransfer();for(let i=1;i<=10;i++)data.items.add(new File([blob],'batch-'+i+'.png',{type:'image/png'}));const input=${el('news-image-files')};window.__qaBatchInput=input;input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
   await until('!!window.__qaReleaseUpload');
   assert.equal(await evaluate(`${el('siya-news-app')}.getAttribute('aria-busy')`),'true');
   assert.match(await evaluate(`${el('news-upload-progress')}.textContent`),/batch-1.png.*กำลังส่ง/);
   await evaluate('window.__qaReleaseUpload()');
   await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-message-images')}.textContent.includes('QA rejected upload')`);
    assert.equal((await detail()).body.data.images.length,1);
    assert.equal(await evaluate('window.__qaBatchInput.files.length'),0,'failed batch clears even the original file input');
    await evaluate(`(()=>{window.__qaConfirm=false;const data=new DataTransfer();data.items.add(new File([window.__qaBatchBlob],'replacement.png',{type:'image/png'}));const input=${el('news-image-files')};window.__qaReplacementInput=input;input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);
    assert.equal(await evaluate('window.__qaReplacementInput.files.length'),0,'cancelled replacement also clears input');
    assert.equal(await evaluate(`window.__qaUploadCalls.includes('replacement.png')`),false);
    assert.match(await evaluate(`${el('news-upload-progress')}.textContent`),/batch-10.png/);
    assert.equal(await evaluate(`${el('news-upload-progress')}.textContent.includes('replacement.png')`),false);
    await click('news-back');assert.equal(await evaluate(`${el('siya-news-app')}.classList.contains('show-detail')`),true,'cancel departure keeps pending queue');
    await evaluate('window.__qaConfirm=true');
   await click('retry-news-upload');
   await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-message-images')}.textContent.includes('QA lost response')`);
   assert.match(await evaluate(`${el('news-upload-progress')}.textContent`),/batch-3.png.*ยังยืนยันผลไม่ได้/);
   assert.equal((await detail()).body.data.images.length,3);
   await click('retry-news-upload');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-detail')}.querySelectorAll('.news-image-card').length===10`);
   const counts=await evaluate(`window.__qaUploadCalls.reduce((out,name)=>(out[name]=(out[name]||0)+1,out),{})`);
   assert.equal(counts['batch-1.png'],1);assert.equal(counts['batch-2.png'],2);assert.equal(counts['batch-3.png'],1);
     assert.equal(new Set((await detail()).body.data.images.map(i=>i.id)).size,10);
     const pendingVersion=(await detail()).body.data.version;await click('submit-news');
     assert.match(await evaluate(`${el('news-message-images')}.textContent`),/ให้ครบก่อนเปลี่ยนสถานะ/);
     assert.equal((await detail()).body.data.status,'draft');assert.equal((await detail()).body.data.version,pendingVersion);
    assert.equal(await evaluate(`(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})()`),true,'ambiguous receipt still needs resolution');
    await evaluate(`window.__qaConfirm=false;${el('news-upload-progress')}.querySelector('[data-resolve-upload=confirmed]').click()`);
    assert.equal(await evaluate(`${el('news-upload-progress')}.querySelectorAll('[data-upload-state=uncertain]').length`),1);
    await evaluate(`window.__qaConfirm=true;${el('news-upload-progress')}.querySelector('[data-resolve-upload=confirmed]').click()`);
    assert.equal(await evaluate(`${el('news-upload-progress')}.querySelectorAll('[data-upload-state=uncertain]').length`),0);
    assert.equal(await evaluate(`${el('news-upload-progress')}.querySelectorAll('[data-upload-state=confirmed]').length`),1);
    assert.equal(await evaluate(`(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})()`),false,'resolved batch no longer warns');
   await evaluate('window.fetch=window.__qaBatchFetch');
   assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
   await click('submit-news');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-detail')}.querySelector('.status-badge').dataset.status==='review'`);
  });
   await check('accepted queue replacement, per-file cancellation and confirmed departure clear only the intended queue',async()=>{
    await click('create-news');await fill('news-title','Queue resolution QA '+Date.now());await fill('news-body','ข้อมูลสังเคราะห์สำหรับตรวจคิว');await click('save-news-content');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);
    await evaluate(`(()=>{const original=window.fetch;window.__qaQueueFetch=original;window.__qaQueueCalls=0;window.fetch=(url,options)=>{if(options?.body instanceof FormData){window.__qaQueueCalls++;return Promise.resolve(new Response(JSON.stringify({status:'error',message:'QA queue rejection'}),{status:400,headers:{'Content-Type':'application/json'}}));}return original(url,options);};window.__qaSelectQueue=(names)=>{const data=new DataTransfer();names.forEach(name=>data.items.add(new File([window.__qaBatchBlob],name,{type:'image/png'})));const input=${el('news-image-files')};window.__qaQueueInput=input;input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));};window.__qaSelectQueue(['same.png','not-sent.png']);})()`);
    await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&!!${el('retry-news-upload')}`);
    assert.equal(await evaluate('window.__qaQueueInput.files.length'),0);
    await evaluate(`window.__qaSelectQueue(['same.png'])`);
    await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&window.__qaQueueCalls===2`);
    assert.equal(await evaluate(`${el('news-upload-progress')}.textContent.includes('not-sent.png')`),false,'confirmed replacement removes old queue');
    assert.equal(await evaluate('window.__qaQueueInput.files.length'),0,'same file can be selected again after failure');
    await evaluate(`${el('news-upload-progress')}.querySelector('[data-resolve-upload=cancelled]').click()`);
    assert.equal(await evaluate(`${el('news-upload-progress')}.querySelectorAll('[data-upload-state=cancelled]').length`),1);
    assert.equal(await evaluate(`(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})()`),false);
    await evaluate(`window.__qaSelectQueue(['leave-pending.png'])`);await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&window.__qaQueueCalls===3`);
    await click('news-back');
    assert.equal(await evaluate(`${el('siya-news-app')}.classList.contains('show-detail')`),false);
    assert.equal(await evaluate(`(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})()`),false,'confirmed departure discards queue without a lingering warning');
    await evaluate('window.fetch=window.__qaQueueFetch');
   });
   await check('rerendered controls stay locked until a multi-image upload finishes',async()=>{
    await click('create-news');await fill('news-title','Busy controls QA '+Date.now());await fill('news-body','ข้อความต้องไม่เปิดให้แก้ระหว่างบันทึกภาพ');await click('save-news-content');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);
    await evaluate(`(()=>{const original=window.fetch;window.__qaBusyFetch=original;window.fetch=async(url,options)=>{if(options?.body instanceof FormData&&options.body.get('image')?.name==='busy-2.png')await new Promise(resolve=>window.__qaReleaseBusy=resolve);return original(url,options);};const data=new DataTransfer();['busy-1.png','busy-2.png'].forEach(name=>data.items.add(new File([window.__qaBatchBlob],name,{type:'image/png'})));const input=${el('news-image-files')};input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until('!!window.__qaReleaseBusy');
    assert.equal(await evaluate(`${el('news-title')}.disabled`),true);assert.equal(await evaluate(`${el('save-news-content')}.disabled`),true);assert.equal(await evaluate(`${el('submit-news')}.disabled`),true);
    assert.equal(await evaluate('window.eofficeModuleHasChanges()'),true,'shared shell guards pending uploads');
    await evaluate('window.__qaReleaseBusy()');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-detail')}.querySelectorAll('.news-image-card').length===2`);
    assert.equal(await evaluate(`${el('news-title')}.disabled`),false);await evaluate('window.fetch=window.__qaBusyFetch');await click('news-back');
   });
   await check('editor-only role reviews ten images and approves but cannot create or export',async()=>{
   await login('editor');await selectNews();
   assert.equal(await evaluate(`${el('create-news')}.hidden`),true);
    assert.equal(await evaluate(`${el('news-detail')}.querySelectorAll('.news-image-card').length`),10);
    const version=(await detail()).body.data.version;
    assert.equal(await evaluate(`fetch('/api/siya-news.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve',id:${JSON.stringify(newsId)},version:${Number(0)}})}).then(r=>r.status)`),400);
    assert.equal(await evaluate(`fetch('/api/siya-news.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',id:${JSON.stringify(newsId)},version:${version},title:'Role and upload QA exact conflict',body:'Concurrent edit'})}).then(r=>r.status)`),200);
    await click('approve-news');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-detail-message')}.textContent.includes('ข่าวถูกแก้ไขแล้ว')`);
    assert.equal((await detail()).body.data.status,'review');
    await click('refresh-news-list');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);await selectNews();
   assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
   assert.equal(await evaluate(`fetch('/api/siya-news-export.php?id='+${JSON.stringify(newsId)}).then(r=>r.status)`),403);
   assert.equal(await evaluate(`fetch('/api/siya-news.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create',title:'denied',body:'denied'})}).then(r=>r.status)`),403);
   const capture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(profile,'mobile-ten-images.png'),Buffer.from(capture.data,'base64'));
   await click('approve-news');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-detail')}.querySelector('.status-badge').dataset.status==='approved'`);
  });
  await check('producer-only role reads approved copy, image and ZIP without editing rights',async()=>{
   await login('producer');await selectNews();
   assert.equal(await evaluate(`!!${el('edit-news')}`),false);assert.equal(await evaluate(`${el('news-tabs')}.children.length`),1);
   const news=(await detail()).body.data;assert.equal(news.images.length,10);assert.equal(news.approved_snapshot,true);
   assert.equal(await evaluate(`fetch('/'+${JSON.stringify(news.images[0].url)}).then(r=>r.status)`),200);
   assert.equal(await evaluate(`fetch('/api/siya-news-export.php?id='+${JSON.stringify(newsId)}).then(r=>r.status)`),200);
   assert.equal(await evaluate(`fetch('/api/siya-news.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',id:${JSON.stringify(newsId)},version:${news.version},title:'denied',body:'denied'})}).then(r=>r.status)`),403);
  });
   await check('another submitter cannot access or modify a story owned by someone else',async()=>{
    const news=(await detail()).body.data;await login('submit2');assert.equal((await detail()).status,403);
    assert.equal(await evaluate(`fetch('/'+${JSON.stringify(news.images[0].url)}).then(r=>r.status)`),403);
    assert.equal(await evaluate(`fetch('/api/siya-news.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',id:${JSON.stringify(newsId)},version:${news.version},title:'denied',body:'denied'})}).then(r=>r.status)`),403);
   });
    await check('editing approved metadata revokes producer access until direct reviewer correction and reapproval',async()=>{
    await login('submit');await selectNews();await click('edit-news');
    await evaluate(`(()=>{const input=${el('news-detail')}.querySelector('[data-caption]');input.value='แก้ไขภาพหลังผ่านตรวจ';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('save-news-content');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-detail')}.querySelector('.status-badge').dataset.status==='review'`);
    const news=(await detail()).body.data;await login('producer');assert.equal((await detail()).status,403);
    assert.equal(await evaluate(`fetch('/'+${JSON.stringify(news.images[0].url)}).then(r=>r.status)`),403);
    assert.equal(await evaluate(`fetch('/api/siya-news-export.php?id='+${JSON.stringify(newsId)}).then(r=>r.status)`),404);
     await login('editor');await selectNews();assert.equal(await evaluate(`!!${el('return-news')}`),false);
     await click('edit-news');await fill('news-body','ผู้ตรวจแก้เนื้อหาหลังผู้ส่งแก้ภาพ');await click('save-news-content');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')`);
     assert.equal((await detail()).body.data.body,'ผู้ตรวจแก้เนื้อหาหลังผู้ส่งแก้ภาพ');assert.equal((await detail()).body.data.status,'review');
     await click('approve-news');await until(`!${el('siya-news-app')}.hasAttribute('aria-busy')&&${el('news-detail')}.querySelector('.status-badge').dataset.status==='approved'`);
    await login('producer');assert.equal((await detail()).status,200);
   });
   await check('unassigned role cannot read stories, images or export',async()=>{
   const news=(await detail()).body.data;await login('none');assert.equal((await detail()).status,403);
   assert.equal(await evaluate(`fetch('/'+${JSON.stringify(news.images[0].url)}).then(r=>r.status)`),403);
   assert.equal(await evaluate(`fetch('/api/siya-news-export.php?id='+${JSON.stringify(newsId)}).then(r=>r.status)`),403);
  });
 }
 assert.deepEqual(errors,[]);console.log('Screenshots: '+profile);console.log('Synthetic regression story: #'+newsId);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}socket.close();}else browser.kill();});
