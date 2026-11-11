// Opt-in freeform Studio browser regression against the isolated local preview.
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const base=process.env.EOFFICE_QA_BROWSER_URL||'http://127.0.0.1:8188';
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname));
assert.ok(process.env.EOFFICE_QA_EMAIL&&process.env.EOFFICE_QA_PASSWORD,'Local QA credentials required');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'opencode','siya-studio-free-'));
const port=Number(process.env.QA_CDP_PORT||9257);
const browser=cp.spawn(process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','about:blank'],{stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,sequence=0;const pending=new Map(),errors=[];let layoutId=null,createdNewsId=null;const layoutTitle='Studio freeform '+Date.now();
function send(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},45000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression){for(let i=0;i<240;i++){if(await evaluate(`(()=>{try{return (${expression});}catch{return false;}})()`))return;await pause(100);}throw Error('Timed out: '+expression);}
const root="document.querySelector('.eoffice-module-host:not([hidden])').shadowRoot",el=id=>`${root}.getElementById(${JSON.stringify(id)})`,q=selector=>`${root}.querySelector(${JSON.stringify(selector)})`,qa=selector=>`${root}.querySelectorAll(${JSON.stringify(selector)})`;
const click=selector=>evaluate(`(()=>{const node=${q(selector)};if(!node)throw Error('Missing ${selector}');node.click();})()`);
const stageExpr=`window.Konva.stages.find(stage=>stage.container()===${el('stageContainer')})`;
async function input(id,value){await evaluate(`(()=>{const node=${el(id)};if(node.type==='checkbox')node.checked=${JSON.stringify(value)};else node.value=${JSON.stringify(String(value))};node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function check(name,fn){await fn();console.log('PASS '+name);}
async function login(){assert.equal(await evaluate(`fetch('/api/auth_login.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({username:process.env.EOFFICE_QA_EMAIL,password:process.env.EOFFICE_QA_PASSWORD})})}).then(r=>r.status)`),200);}
async function ensurePoolNews(){
 const pool=await evaluate(`fetch('/api/siya-news-studio.php?action=pool').then(r=>r.json()).then(r=>r.data)`);
 if(pool.some(item=>item.images.length))return;
 const created=await evaluate(`fetch('/api/siya-news.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create',title:'Freeform browser source '+Date.now(),body:'ข่าวสังเคราะห์สำหรับทดสอบ Studio แบบอิสระ'})}).then(r=>r.json())`);
 createdNewsId=created.id;
 const upload=await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=900;canvas.height=600;canvas.getContext('2d').fillRect(0,0,900,600);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const form=new FormData();form.set('action','upload');form.set('id',${created.id});form.set('version',${created.version});form.set('image',new File([blob],'freeform-browser.png',{type:'image/png'}));return fetch('/api/siya-news.php',{method:'POST',body:form}).then(r=>r.json());})()`);
 await evaluate(`fetch('/api/siya-news.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'submit',id:${created.id},version:${upload.version}})})`);
 await evaluate(`fetch('/api/siya-news.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve',id:${created.id},version:${upload.version+1},review_note:'Freeform browser source'})})`);
}
async function detail(){return evaluate(`fetch('/api/siya-news-studio.php?action=detail&id='+${JSON.stringify(layoutId)}).then(r=>r.json()).then(r=>r.data)`);}
async function waitSaved(){await until(`${el('saveState')}.textContent.includes('บันทึกแล้ว')`);}
async function run(){
 let targets;for(let i=0;i<100;i++){try{targets=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());break;}catch{await pause(100);}}
 assert.ok(targets);socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
 socket.addEventListener('message',event=>{const r=JSON.parse(event.data);if(pending.has(r.id)){const p=pending.get(r.id);pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails);if(r.method==='Runtime.consoleAPICalled'&&['error','warning'].includes(r.params.type))errors.push({console:r.params.args.map(arg=>arg.value||arg.description).join(' ')});});
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base+'/index.php?view=public'});await until("typeof window.EOFFICE_MOCK_SERVICES==='boolean'");assert.equal(await evaluate('window.EOFFICE_MOCK_SERVICES'),true);
 await login();await ensurePoolNews();
 const previousLayouts=await evaluate(`fetch('/api/siya-news-studio.php?action=list').then(r=>r.json()).then(r=>r.data)`);
 await send('Page.navigate',{url:base+'/index.php?view=siya_news_studio'});await until(`!!${el('studio-app')}`);
 await until(`!!${q('#stageContainer canvas')}&&!!${el('layoutSelect')}.value`);
 await until(`!!${q('#newsPool .st-news')}`);
 if(previousLayouts.length){
  const oldId=await evaluate(`${el('layoutSelect')}.value`);
  await click('#newLayout');await until(`${el('layoutSelect')}.value!==${JSON.stringify(oldId)}&&${el('studio-app')}.getAttribute('aria-busy')==='false'`);
 }
 layoutId=Number(await evaluate(`${el('layoutSelect')}.value`));assert.ok(layoutId>0);
 await evaluate('window.confirm=()=>true');
 await evaluate(`(()=>{const input=${el('docName')};input.value=${JSON.stringify(layoutTitle)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await waitSaved();

 await check('Studio collapses the main menu, can reopen it, and restores it on departure',async()=>{
  await until("document.body.dataset.studioFocus==='true'&&getComputedStyle(document.getElementById('sidebar')).display==='none'");
  assert.equal(await evaluate("document.getElementById('sidebar').inert"),true);
  await evaluate("window.toggleSidebar()");
  assert.equal(await evaluate("getComputedStyle(document.getElementById('sidebar')).display!=='none'&&!document.getElementById('sidebar').inert"),true);
  await evaluate("window.toggleSidebar()");
  await evaluate("window.showView('siya_news')");
  await until("document.body.dataset.studioFocus==='false'&&getComputedStyle(document.getElementById('sidebar')).display!=='none'");
  await evaluate("window.showView('siya_news_studio')");
  await until(`!!${el('studio-app')}&&document.body.dataset.studioFocus==='true'`);
 });
 await check('freeform workspace loads Konva with news pool and no horizontal overflow',async()=>{
  assert.equal(await evaluate(`typeof window.Konva`),'object');
  assert.equal(await evaluate(`${el('studio-app')}.checkVisibility()`),true);
  for(const width of [1440,1024,760,390,320]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<760});assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'overflow '+width);}
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 });
 await check('news pool refresh recovers from errors and shows newly approved items',async()=>{
  const before=await evaluate(`${qa('#newsPool .st-news')}.length`);assert.ok(before>0);
  await evaluate(`(()=>{window.__poolFetch=window.fetch;window.fetch=(input,options)=>String(input).includes('action=pool')?Promise.reject(new TypeError('QA pool offline')):window.__poolFetch(input,options);})()`);
  await click('#newsPoolRefresh');await until(`${el('newsPoolRefresh')}.disabled===false&&${el('newsPoolStatus')}.textContent.includes('QA pool offline')`);
  assert.equal(await evaluate(`${qa('#newsPool .st-news')}.length`),before,'failed refresh preserves the previously loaded news');
  await evaluate(`window.fetch=(input,options)=>String(input).includes('action=pool')?Promise.resolve(new Response(JSON.stringify({status:'success',data:[]}),{headers:{'Content-Type':'application/json'}})):window.__poolFetch(input,options)`);
  await click('#newsPoolRefresh');await until(`${el('newsPoolRefresh')}.disabled===false&&${qa('#newsPool .st-news')}.length===0`);
  assert.match(await evaluate(`${el('newsPool')}.textContent`),/ยังไม่มีข่าวที่ผ่านตรวจ.*รีเฟรชคลังข่าว/);
  assert.match(await evaluate(`${el('newsPoolStatus')}.textContent`),/คลังข่าวว่าง/);
  await evaluate('window.fetch=window.__poolFetch');await click('#newsPoolRefresh');await until(`${el('newsPoolRefresh')}.disabled===false&&${qa('#newsPool .st-news')}.length>0`);
  assert.equal(await evaluate(`${el('newsPoolStatus')}.textContent.includes('ผ่านตรวจ')`),true);
 });
 await check('compact bars preserve vertical canvas space on desktop and short screens',async()=>{
  for(const height of [900,600]){
   await send('Emulation.setDeviceMetricsOverride',{width:1440,height,deviceScaleFactor:1,mobile:false});
   await until(`${el('canvasScroll')}.clientHeight>${height}-170`);
   assert.ok(await evaluate(`document.getElementById('mobile-header').getBoundingClientRect().height<=36`));
   assert.ok(await evaluate(`${q('.st-top')}.getBoundingClientRect().height<=46`));
   assert.ok(await evaluate(`${el('pagesStrip')}.getBoundingClientRect().height<=42`));
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 });
 await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true}).then(r=>fs.writeFileSync(path.join(profile,'studio-desktop.png'),Buffer.from(r.data,'base64')));
 await check('add text and shape, autosave a versioned freeform document',async()=>{
  await click('[data-text="heading"]');await click('[data-shape="circle"]');
  await until(`${qa('#layerList .st-layer')}.length>=4`);await waitSaved();
  const doc=await detail();assert.equal(doc.document.schema,'siya-studio/2');assert.equal(doc.document.pages.length,1);
  assert.ok(doc.document.pages[0].elements.some(element=>element.type==='Text'));assert.ok(doc.document.pages[0].elements.some(element=>element.type==='Circle'));
 });
 await check('external version stops autosave until the latest layout is reloaded',async()=>{
  const detail=await evaluate(`fetch('/api/siya-news-studio.php?action=detail&id='+${JSON.stringify(layoutId)}).then(r=>r.json()).then(r=>r.data)`);
  const external=await evaluate(`fetch('/api/siya-news-studio.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',id:${Number(layoutId)},version:${Number(detail.version)},title:'Studio external version',document:${JSON.stringify(detail.document)},_expected_owner:window.eofficeUser.id})}).then(r=>r.json())`);
  assert.equal(external.status,'success');
  await evaluate(`(()=>{const input=${el('docName')};input.value='local title change';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until(`${el('saveState')}.textContent.includes('มีข้อมูลใหม่จากที่อื่น')`);assert.equal(await evaluate(`${el('reloadBtn')}.hidden`),false);
  await click('#reloadBtn');await until(`${el('saveState')}.textContent.includes('บันทึกแล้ว')`);assert.equal(await evaluate(`${el('docName')}.value`),'Studio external version');
 });
 await check('insert approved news text and image, then undo and redo',async()=>{
  const before=(await detail()).document.pages[0].elements.length;
  await evaluate(`${q('#newsPool .st-news-head')}.click()`);await until(`${qa('#layerList .st-layer')}.length>${before}`);await waitSaved();
  const after=(await detail()).document.pages[0].elements;assert.ok(after.some(element=>element.type==='Image'&&element.newsId&&element.imageId));assert.ok(after.some(element=>element.type==='Text'&&element.text.length>0));
  await click('#undoBtn');await waitSaved();assert.ok((await detail()).document.pages[0].elements.length<after.length);
  await click('#redoBtn');await waitSaved();assert.equal((await detail()).document.pages[0].elements.length,after.length);
  });
 await check('inspector text/font edits are stored in the layout document',async()=>{
  await click('[data-tab="layers"]');
  await evaluate(`${q('#pagesStrip .st-page-item')}.click()`);await until(`${qa('#layerList .st-layer')}.length>0`);
  await evaluate(`(()=>{const row=[...${qa('#layerList .st-layer')}].find(item=>item.textContent.trim().startsWith('T'));if(!row)throw Error('No text layer');const name=row.querySelector('.st-layer-name');if(!name||name.tagName!=='BUTTON'||name.tabIndex!==0||!name.getAttribute('aria-label'))throw Error('Layer name is not an accessible keyboard button');name.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await until(`${qa('#layerList .st-layer-name[aria-pressed="true"]')}.length===1`);
  await until(`!${el('pTextWrap')}.hidden`);
  assert.equal(await evaluate(`${qa('#layerList .st-layer-name[aria-pressed="true"]')}.length`),1,'keyboard selection is exposed accessibly');
  await evaluate(`(()=>{const text=${el('pText')};text.value='ข้อความแก้ไขจาก inspector';text.dispatchEvent(new Event('input',{bubbles:true}));text.dispatchEvent(new Event('change',{bubbles:true}));const size=${el('pFontSize')};size.value='28';size.dispatchEvent(new Event('input',{bubbles:true}));size.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitSaved();
  const doc=await detail();assert.ok(doc.document.pages[0].elements.some(element=>element.type==='Text'&&element.text==='ข้อความแก้ไขจาก inspector'&&Number(element.fontSize)===28));
 });
 await check('local Sarabun loads all styles, survives save/reload, and handles load failure',async()=>{
  await send('Network.enable');await send('Network.setBlockedURLs',{urls:['*Sarabun-*.ttf']});
  await evaluate(`(()=>{const font=${el('pFont')};font.value='Sarabun';font.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`${el('studio-message')}.textContent.includes('โหลดฟอนต์ Sarabun ไม่สำเร็จ')`);
  assert.equal(await evaluate(`${el('pFont')}.value`),'Prompt');
  await send('Network.setBlockedURLs',{urls:[]});
  await evaluate(`(()=>{const font=${el('pFont')};font.value='Sarabun';font.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`!${el('pFont')}.disabled&&${el('pFont')}.value==='Sarabun'`);await waitSaved();
  await evaluate(`(()=>{for(const [id,value] of [['pX','60'],['pY','210']]){const control=${root}.getElementById(id);control.value=value;control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));}})()`);await waitSaved();
  for(const [value,css] of [['normal','400'],['bold','700'],['italic','italic 400'],['italic bold','italic 700']]){
   await evaluate(`(()=>{const weight=${el('pFontWeight')};weight.value=${JSON.stringify(value)};weight.dispatchEvent(new Event('input',{bubbles:true}));weight.dispatchEvent(new Event('change',{bubbles:true}));})()`);
   await waitSaved();assert.equal(await evaluate(`document.fonts.check(${JSON.stringify(css+' 28px "Sarabun"')},'หนังสือราชการ โรงเรียนศรียานุสรณ์')`),true);
   const doc=await detail();assert.ok(doc.document.pages[0].elements.some(e=>e.fontFamily==='Sarabun'&&e.fontStyle===value));
  }
  await click('#reloadBtn');await until(`${el('studio-app')}.getAttribute('aria-busy')==='false'`);
  const doc=await detail();assert.ok(doc.document.pages[0].elements.some(e=>e.fontFamily==='Sarabun'&&e.fontStyle==='italic bold'));
  assert.equal(await evaluate(`window.Konva.stages.find(stage=>stage.container()===${el('stageContainer')}).find('Text').some(node=>node.fontFamily()==='Sarabun'&&node.fontStyle()==='italic bold')`),true);
  await send('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync(path.join(profile,'studio-sarabun.png'),Buffer.from(r.data,'base64')));
 });
 await check('text spacing and underline survive autosave and reload',async()=>{
  await evaluate(`(()=>{const stage=${stageExpr};const node=stage.find('Text').find(node=>node.fontFamily()==='Sarabun');node.fire('click',{evt:{}},true);})()`);
  await input('pLineHeight',1.65);await input('pLetterSpacing',1.5);await input('pUnderline',true);await waitSaved();
  let text=(await detail()).document.pages[0].elements.find(e=>e.fontFamily==='Sarabun');assert.equal(text.lineHeight,1.65);assert.equal(text.letterSpacing,1.5);assert.equal(text.textDecoration,'underline');
  await click('#reloadBtn');await until(`${el('studio-app')}.getAttribute('aria-busy')==='false'`);
  const actual=await evaluate(`(()=>{const n=${stageExpr}.find('Text').find(n=>n.fontFamily()==='Sarabun');return {lineHeight:n.lineHeight(),spacing:n.letterSpacing(),underline:n.textDecoration()};})()`);
  assert.deepEqual(actual,{lineHeight:1.65,spacing:1.5,underline:'underline'});
 });
 await check('inspector and layer-name input autosave before blur or change',async()=>{
  await evaluate(`(()=>{const node=${stageExpr}.find('Text').find(node=>node.fontFamily()==='Sarabun');node.fire('click',{evt:{}},true);})()`);
  for(const [id,value] of [['pLetterSpacing','2.5'],['pName','ชื่อเลเยอร์ทดสอบไม่รอ blur']]){
   await evaluate(`(()=>{const control=${root}.getElementById(${JSON.stringify(id)});control.focus();control.value=${JSON.stringify(value)};control.dispatchEvent(new Event('input',{bubbles:true}));})()`);
   assert.ok(await evaluate(`${el('saveState')}.textContent.includes('รอบันทึก')`));await waitSaved();
  }
  const saved=(await detail()).document.pages[0].elements.find(e=>e.fontFamily==='Sarabun');assert.equal(saved.letterSpacing,2.5);assert.equal(saved.name,'ชื่อเลเยอร์ทดสอบไม่รอ blur');
 });
 await check('crop presets, zoom, pointer panning, image borders and corners persist without changing source',async()=>{
  await send('Page.bringToFront');await send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
  await evaluate(`(()=>{const n=${stageExpr}.find('Image')[0];window.__cropSource={newsId:n.getAttr('newsId'),imageId:n.getAttr('imageId')};n.moveToTop();n.fire('click',{evt:{}},true);})()`);
  await until(`!${el('cropPanel')}.hidden`);
  for(const [id,value] of [['pX',100],['pY',350],['pW',300],['pH',200],['cropRatio','1'],['cropZoom',2],['cropX',.25],['cropY',.6],['pStroke','#ef4444'],['pStrokeWidth',6],['pCorner',24]])await input(id,value);
  await waitSaved();let image=(await detail()).document.pages[0].elements.find(e=>e.type==='Image');
  assert.equal(image.width,image.height);assert.deepEqual(image.cropView,{x:.25,y:.6,zoom:2});assert.equal(image.strokeWidth,6);assert.equal(image.cornerRadius,24);
  await evaluate(`(()=>{const control=${el('cropX')};control.value='.35';control.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert.ok(await evaluate(`${el('saveState')}.textContent.includes('รอบันทึก')`));await waitSaved();assert.equal((await detail()).document.pages[0].elements.find(e=>e.type==='Image').cropView.x,.35);
  await input('cropX',.25);await waitSaved();
  await input('cropMode',true);
  await evaluate(`void ${stageExpr}.draw()`);
  const pointer=await evaluate(`(()=>{const n=${stageExpr}.find('Image')[0],p=n.getAbsoluteTransform().point({x:n.width()/2,y:n.height()/2}),box=${el('stageContainer')}.getBoundingClientRect();return {x:box.left+p.x,y:box.top+p.y};})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pointer.x,y:pointer.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:pointer.x,y:pointer.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pointer.x+24,y:pointer.y+16,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pointer.x+24,y:pointer.y+16,button:'left',clickCount:1});
  await waitSaved();image=(await detail()).document.pages[0].elements.find(e=>e.type==='Image');
  assert.equal(image.x,100);assert.equal(image.y,350);assert.notEqual(image.cropView.x,.25);
  assert.deepEqual({newsId:image.newsId,imageId:image.imageId},await evaluate('window.__cropSource'));
  await input('cropMode',false);await click('#reloadBtn');await until(`${el('studio-app')}.getAttribute('aria-busy')==='false'`);
  const crop=await evaluate(`(()=>{const n=${stageExpr}.find('Image')[0];return {crop:n.getAttr('cropView'),width:n.cropWidth(),corner:n.cornerRadius(),stroke:n.strokeWidth()};})()`);
  assert.deepEqual(crop.crop,image.cropView);assert.ok(crop.width>0);assert.equal(crop.corner,24);assert.equal(crop.stroke,6);
  await evaluate(`(()=>{${stageExpr}.find('Image')[0].fire('click',{evt:{}},true);})()`);
  await click('#cropReset');await waitSaved();assert.equal((await detail()).document.pages[0].elements.find(e=>e.type==='Image').cropView,undefined);
  await click('#undoBtn');await waitSaved();assert.deepEqual((await detail()).document.pages[0].elements.find(e=>e.type==='Image').cropView,image.cropView);
  await evaluate(`(()=>{${stageExpr}.find('Image')[0].fire('click',{evt:{}},true);})()`);
  await input('cropMode',true);
  await evaluate(`(()=>{${stageExpr}.find('Circle')[0].fire('click',{evt:{}},true);})()`);
  assert.equal(await evaluate(`${stageExpr}.find('Image')[0].draggable()`),true,'leaving crop mode must restore normal dragging');
  await evaluate(`(()=>{${stageExpr}.find('Image')[0].fire('click',{evt:{}},true);})()`);
  await send('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync(path.join(profile,'studio-decoration.png'),Buffer.from(r.data,'base64')));
 });
 await check('mobile touch pans the image inside a fixed crop frame',async()=>{
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
  await until(`${q('#pageWrap')}.getBoundingClientRect().width<=innerWidth`);
  await evaluate(`(()=>{${stageExpr}.find('Image')[0].fire('click',{evt:{}},true);})()`);
  await input('cropX',.5);await input('cropY',.5);await input('cropMode',true);await waitSaved();
  const pointer=await evaluate(`(()=>{const n=${stageExpr}.find('Image')[0],p=n.getAbsoluteTransform().point({x:n.width()/2,y:n.height()/2}),box=${el('stageContainer')}.getBoundingClientRect();return {x:box.left+p.x,y:box.top+p.y};})()`);
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pointer.x,y:pointer.y,id:1}]});
  await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:pointer.x-12,y:pointer.y-8,id:1}]});
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await waitSaved();
  const image=(await detail()).document.pages[0].elements.find(e=>e.type==='Image');assert.notEqual(image.cropView.x,.5);assert.equal(image.x,100);assert.equal(image.y,350);
  await input('cropMode',false);await send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
 });
 await check('safe margins, page alignment, snapping and locks survive save/reload',async()=>{
  await input('safeMargin',48);await input('showSafeMargin',true);await input('snapToggle',true);await waitSaved();
  await evaluate(`(()=>{${stageExpr}.find('Image')[0].fire('click',{evt:{}},true);})()`);
  await input('pRotation',20);await click('[data-place="center"]');await click('[data-place="middle"]');await waitSaved();
  const rotated=await evaluate(`(()=>{const stage=${stageExpr},r=stage.find('Image')[0].getClientRect({relativeTo:stage.getLayers()[1]});return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  assert.ok(Math.abs(rotated.x-397)<.01);assert.ok(Math.abs(rotated.y-561.5)<.01);
  await evaluate(`(()=>{const n=${stageExpr}.find('Circle')[0];n.fire('click',{evt:{}},true);})()`);
  await input('pStroke','#0f172a');await input('pStrokeWidth',4);await click('[data-place="center"]');await click('[data-place="top"]');await waitSaved();
  const aligned=await evaluate(`(()=>{const stage=${stageExpr},n=stage.find('Circle')[0],r=n.getClientRect({relativeTo:stage.getLayers()[1]});return {center:r.x+r.width/2,top:r.y};})()`);
  assert.ok(Math.abs(aligned.center-794/2)<.01);assert.ok(Math.abs(aligned.top-48)<.01);
  await evaluate(`(()=>{const n=${stageExpr}.find('Circle')[0];n.x(n.x()+2);n.fire('dragmove',{evt:{}},true);n.fire('dragend',{evt:{}},true);})()`);await waitSaved();
  const snapped=await evaluate(`${stageExpr}.find('Circle')[0].x()`);assert.ok(Math.abs(snapped-397)<.01);
  await click('#lockBtn');await waitSaved();
  const before=(await detail()).document.pages[0].elements.find(e=>e.type==='Circle');assert.equal(before.locked,true);
  await evaluate(`${root}.activeElement?.blur()`);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight'});
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Delete',code:'Delete'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Delete',code:'Delete'});
  const locked=await evaluate(`(()=>{const n=${stageExpr}.find('Circle')[0];return {x:n.x(),drag:n.draggable()};})()`);assert.equal(locked.x,before.x);assert.equal(locked.drag,false);
  await click('#reloadBtn');await until(`${el('studio-app')}.getAttribute('aria-busy')==='false'`);
  assert.equal(await evaluate(`${stageExpr}.find('Circle')[0].draggable()`),false);
  const page=(await detail()).document.pages[0];assert.equal(page.safeMargin,48);assert.equal(page.showSafeMargin,true);assert.equal(page.snap,true);
  await evaluate(`(()=>{const row=[...${qa('#layerList .st-layer')}].find(row=>row.textContent.includes('วงกลม'));[...row.querySelectorAll('button')].find(b=>b.title==='ปลดล็อกวัตถุ').click();})()`);await waitSaved();
  assert.equal(await evaluate(`${stageExpr}.find('Circle')[0].draggable()`),true);
 });
 await check('add, duplicate and remove pages and change page format',async()=>{
  await click('#addPageBtn');await until(`${qa('#pagesStrip .st-page-item')}.length===2`);await waitSaved();
  await evaluate(`(()=>{const select=${el('formatSelect')};select.value='a4_landscape';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await waitSaved();
  await evaluate(`(()=>{const color=${el('bgColor')};color.value='#fef3c7';color.dispatchEvent(new Event('input',{bubbles:true}));color.dispatchEvent(new Event('change',{bubbles:true}));})()`);await waitSaved();
  await click('#duplicatePageBtn');await until(`${qa('#pagesStrip .st-page-item')}.length===3`);await waitSaved();
  const doc=await detail();assert.equal(doc.document.pages.length,3);assert.equal(doc.document.pages[1].format,'a4_landscape');assert.equal(doc.document.pages[1].bg,'#fef3c7');
  await click('#deletePageBtn');await until(`${qa('#pagesStrip .st-page-item')}.length===2`);await waitSaved();
 });
 await check('layer visibility is stored in the saved document',async()=>{
  await evaluate(`${q('#pagesStrip .st-page-item')}.click()`);await until(`${qa('#layerList .st-layer')}.length>0`);
  await evaluate(`(()=>{const row=[...${qa('#layerList .st-layer')}].find(item=>item.textContent.includes('วงกลม'));row.querySelector('button[aria-label^="ซ่อน "]').click();})()`);await waitSaved();
  const doc=await detail();assert.ok(doc.document.pages.some(page=>page.elements.some(element=>element.visible===false)));
 });
 await check('readiness check and PNG export produce a canvas image',async()=>{
  await click('#checkBtn');await until(`${el('studio-message')}.textContent.includes('พร้อมส่งออก')`);
  await evaluate(`(()=>{window.__downloads=[];window.__anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__downloads.push({href:this.href,download:this.download});};})()`);
  await click('#exportPngBtn');await until('window.__downloads.length===1');
  const download=await evaluate('window.__downloads[0]');assert.match(download.href,/^data:image\/png;base64,/);assert.match(download.download,/\.png$/);
  const png=Buffer.from(download.href.split(',')[1],'base64');assert.equal(png.readUInt32BE(16),1588);assert.equal(png.readUInt32BE(20),2246);
  await input('zoomRange',15);await click('#exportPngBtn');await until('window.__downloads.length===2');
  assert.equal(await evaluate('window.__downloads[1].href'),download.href,'zoom must not change pixels or resolution');
  await input('showSafeMargin',false);await waitSaved();await click('#exportPngBtn');await until('window.__downloads.length===3');
  assert.equal(await evaluate('window.__downloads[2].href'),download.href,'safe guides must not appear in exports');
  await click('#fitBtn');
  await evaluate('HTMLAnchorElement.prototype.click=window.__anchorClick');
 });
 await check('readiness rejects removed approval instead of trusting cached news',async()=>{
  await evaluate(`(()=>{window.__studioFetch=window.fetch;window.fetch=(input,options)=>String(input).includes('action=pool&ids=')?Promise.resolve(new Response(JSON.stringify({status:'success',data:[]}),{headers:{'Content-Type':'application/json'}})):window.__studioFetch(input,options);})()`);
  try{await click('#checkBtn');await until(`${el('studio-message')}.textContent.includes('ยังส่งออกไม่ได้')`);}
  finally{await evaluate('window.fetch=window.__studioFetch');}
  await click('#checkBtn');await until(`${el('studio-message')}.textContent.includes('พร้อมส่งออก')`);
 });
 await check('PDF export renders all pages with jsPDF',async()=>{
  await evaluate(`(()=>{const api=window.jspdf.jsPDF.API;window.__originalPdfSave=api.save;api.save=function(name){window.__pdf={name,pages:this.getNumberOfPages(),data:btoa(this.output())};};})()`);
  await evaluate(`(()=>{window.__exportFetch=window.fetch;window.__exportGate=new Promise(resolve=>{window.__releaseExport=resolve;});window.fetch=async(input,options)=>{if(String(input).includes('action=pool&ids='))await window.__exportGate;return window.__exportFetch(input,options);};})()`);
  await click('#exportPdfBtn');
  await until(`${el('studio-app')}.inert&&${el('studio-app')}.getAttribute('aria-busy')==='true'`);
  await click('#addPageBtn');assert.equal(await evaluate(`${qa('#pagesStrip .st-page-item')}.length`),2);
  await evaluate('window.fetch=window.__exportFetch;window.__releaseExport()');
  await until('!!window.__pdf');
  const pdf=await evaluate('window.__pdf');assert.match(pdf.name,/\.pdf$/);assert.equal(pdf.pages,2);
  const bytes=Buffer.from(pdf.data,'base64');assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.match(bytes.toString('latin1'),/\/Subtype \/Image/);assert.match(bytes.toString('latin1'),/\/Count 2\b/);
  assert.match(bytes.toString('latin1'),/\/Width 1588\b/);assert.match(bytes.toString('latin1'),/\/Height 2246\b/);
  fs.writeFileSync(path.join(profile,'studio-export.pdf'),bytes);
  await evaluate(`(()=>{const api=window.jspdf.jsPDF.API;if(window.__originalPdfSave===undefined)delete api.save;else api.save=window.__originalPdfSave;})()`);
  await until(`${el('studio-app')}.getAttribute('aria-busy')==='false'`);
 });
 await check('history dialog and restore keep the layout usable',async()=>{
  await click('#historyBtn');await until(`${el('historyDialog')}.open`);
  const revisions=await evaluate(`${qa('#historyList .st-history-row button')}.length`);assert.ok(revisions>=1);
  await evaluate(`(()=>{const buttons=[...${qa('#historyList .st-history-row button')}];buttons[buttons.length-1].click();})()`);
  await until(`!${el('historyDialog')}.open`);await waitSaved();
  assert.ok(await evaluate(`${q('#stageContainer canvas')}.width>0`));
 });
 await check('mobile canvas and inspector stay usable',async()=>{
  await send('Emulation.setDeviceMetricsOverride',{width:1024,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`${el('safeMargin')}.focus()`);
  await send('Emulation.setDeviceMetricsOverride',{width:1020,height:900,deviceScaleFactor:1,mobile:false});
  await until(`${el('inspector')}.inert&&${el('inspectorToggle')}.matches(':focus')`);
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  for(const width of [390,320]){await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await until(`document.documentElement.scrollWidth<=innerWidth`);await until(`${q('#pageWrap')}.getBoundingClientRect().width<=innerWidth`);
    await evaluate(`${q('[data-tab="news"]')}.click()`);await until(`${el('side')}.classList.contains('is-open')`);assert.equal(await evaluate(`${el('side')}.inert`),false);await evaluate(`${el('sideClose')}.click()`);await until(`!${el('side')}.classList.contains('is-open')`);assert.equal(await evaluate(`${el('side')}.inert`),true);assert.equal(await evaluate(`${q('[data-tab].is-active')}.matches(':focus')`),true);
    await evaluate(`${el('inspectorToggle')}.click()`);await until(`${el('inspector')}.classList.contains('is-open')`);assert.equal(await evaluate(`${el('inspector')}.inert`),false);await evaluate(`${el('inspectorClose')}.click()`);await until(`!${el('inspector')}.classList.contains('is-open')`);assert.equal(await evaluate(`${el('inspector')}.inert`),true);assert.equal(await evaluate(`${el('inspectorToggle')}.matches(':focus')`),true);await pause(250);await send('Page.captureScreenshot',{format:'png'}).then(r=>fs.writeFileSync(path.join(profile,'studio-'+width+'.png'),Buffer.from(r.data,'base64')));}
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 });
 assert.deepEqual(errors,[]);console.log('Screenshots: '+profile);console.log('Studio layout: #'+layoutId);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 try{
  const list=await evaluate(`fetch('/api/siya-news-studio.php?action=list').then(r=>r.json()).then(r=>r.data)`).catch(()=>[]);
  for(const row of list.filter(item=>Number(item.id)===Number(layoutId)))await evaluate(`fetch('/api/siya-news-studio.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',id:${Number(row.id)},version:${Number(row.version)},_expected_owner:window.eofficeUser.id})})`).catch(()=>{});
 }catch{}
 if(createdNewsId){try{cp.execFileSync(process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe',['tests/siya-news-cleanup.php',String(createdNewsId)],{cwd:path.resolve(__dirname,'..'),env:process.env,encoding:'utf8'});}catch(error){console.error('Cleanup failed',error.message);}}
 if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}socket.close();}else browser.kill();
});
