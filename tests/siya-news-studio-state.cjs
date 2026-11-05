// Deterministic async regression tests against the real Studio functions.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../siya_news/studio.js'),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function functionSource(name){
 const start=source.search(new RegExp('    (?:async )?function '+name+'\\('));
 assert.ok(start>=0,name);
 const firstLine=source.slice(start,source.indexOf('\n',start));
 if(firstLine.trimEnd().endsWith('}'))return firstLine;
 const end=source.indexOf('\n    }',start);assert.ok(end>=0,name+' closing brace');
 return source.slice(start,end+6);
}
function runtime(names,overrides={}){
 const elements=new Map();
 const context={
  state:{layout:{id:1,version:1,title:'A'},layouts:[{id:1},{id:2}],pages:[{id:'old',format:'a4_portrait',bg:'#fff',elements:[]}],active:0,dirty:false},
  api:'studio',FORMATS:{a4_portrait:{w:794,h:1123}},ownerId:()=>10,
  root:{inert:false,setAttribute(){},querySelector(){return {inert:false};}},$:id=>{if(!elements.has(id))elements.set(id,{value:'A',close(){}});return elements.get(id);},
  clearTimeout,confirm:()=>true,showMessage(){},renderLayouts(){},renderPages(){},renderPool(){},renderSave(){},
  fitPage(){},fitSettled(){},toast(){},paintPage:async()=>{},syncPage(){},prepareFonts:async()=>{},ensureFontFamily:async()=>{},
  setRenderError(value){context.state.renderError=value;},
  resumeAutosave(){},
  ...overrides,
 };
 vm.createContext(context);vm.runInContext(names.map(functionSource).join('\n'),context);return context;
}
async function run(){
 {
  const gate=deferred(),timers=new Map();let sequence=0,requests=0,payload;
  const pageA={id:'A',elements:[{id:'text-A',text:'old A'}],_hist:[],_hi:-1},pageB={id:'B',elements:[{id:'text-B',text:'B'}],_hist:[],_hi:-1};
  let nodes=[{id:'text-A',text:'edited A'}];
  const ctx=runtime(['markDirty','resumeAutosave','saveNow','pageData','syncPage','loadPage','paintPage'],{
   setTimeout(callback,delay){assert.equal(delay,1400);const id=++sequence;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),
   prepareFonts:async()=>gate.promise,rehydrate:async element=>({...element,destroy(){}}),serializeNode:node=>({...node}),
   dims:()=>({w:794,h:1123}),select(){},setZoom(){},pageSnapshot:()=> '{}',updatePageLabel(){},renderLayers(){},refreshProps(){},updateHistButtons(){},
   request:async(url,options)=>{requests++;payload=JSON.parse(options.body);return {version:2,title:'A'};},
  });
  ctx.state.pages=[pageA,pageB];ctx.state.canvasPage=pageA;ctx.state.owner=10;ctx.state.revision=0;ctx.state.restoreToken=0;ctx.state.stage={};ctx.state.imageFailures=new Set();
  ctx.curr=()=>ctx.state.pages[ctx.state.active];
  ctx.state.contentLayer={getChildren:()=>nodes,destroyChildren(){nodes=[];},add:node=>nodes.push(node),batchDraw(){}};
  ctx.state.bgRect={setAttrs(){}};ctx.state.bgLayer={batchDraw(){}};
  ctx.markDirty();const revision=ctx.state.revision;
  const loading=ctx.loadPage(1);assert.equal(ctx.state.restoring,true);
  let entry=[...timers.entries()][0];timers.delete(entry[0]);await entry[1]();
  assert.equal(requests,0);assert.equal(timers.size,0);
  gate.resolve();await loading;
  assert.equal(timers.size,1);assert.equal(ctx.state.revision,revision);
  entry=[...timers.entries()][0];timers.delete(entry[0]);await entry[1]();
  assert.equal(requests,1);assert.equal(payload.document.pages[0].elements[0].text,'edited A');
  assert.equal(ctx.state.dirty,false);assert.equal(timers.size,0);
  console.log('PASS autosave resumes after its debounce expires during a slow page render and saves the latest edits once');
 }
 for(const blocked of ['conflict','renderError','saving','restoring','loading','exporting','mutating','clean','wrong-page','wrong-owner']){
  let scheduled=0;const page={id:'A'};
  const ctx=runtime(['resumeAutosave'],{curr:()=>page,setTimeout(){scheduled++;},clearTimeout(){}});
  ctx.state.dirty=true;ctx.state.owner=10;ctx.state.canvasPage=page;
  if(blocked==='clean')ctx.state.dirty=false;
  else if(blocked==='wrong-page')ctx.state.canvasPage={id:'B'};
  else if(blocked==='wrong-owner')ctx.state.owner=11;
  else ctx.state[blocked]=true;
  ctx.resumeAutosave();assert.equal(scheduled,0,blocked);
 }
 console.log('PASS autosave resumption respects conflicts, errors, in-flight work, page and account boundaries');
 {
  const timers=new Map(),page={id:'A'};let sequence=0,requests=0;
  const ctx=runtime(['resumeAutosave','saveNow','pageData'],{
   curr:()=>page,setTimeout(callback){const id=++sequence;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),
   request:async()=>{requests++;throw Error('network offline');},
  });
  ctx.state.pages=[page];page.elements=[];ctx.state.canvasPage=page;ctx.state.owner=10;ctx.state.dirty=true;
  ctx.resumeAutosave();ctx.resumeAutosave();assert.equal(timers.size,1);
  const [id,callback]=[...timers.entries()][0];timers.delete(id);await callback();
  assert.equal(requests,1);assert.equal(timers.size,0);assert.equal(ctx.state.dirty,true);
  console.log('PASS autosave resumption replaces duplicate timers without creating a network-failure retry loop');
 }
 for(const renderError of [false,true]){
  let reloads=0,retries=0,confirmations=0;
  const ctx=runtime(['renderSave','recoverLayout'],{
   updateHistButtons(){},confirm(){confirmations++;return true;},
   openLayout:async(id,force)=>{assert.equal(id,1);assert.equal(force,true);reloads++;},
   retryRender:async()=>{retries++;},
  });
  ctx.state.conflict=true;ctx.state.renderError=renderError;ctx.state.imageFailures=new Set(['revoked-image']);
  ctx.$('saveState').dataset={};ctx.renderSave();
  assert.equal(ctx.$('reloadBtn').hidden,false);assert.equal(ctx.$('reloadBtn').textContent,'โหลดเวอร์ชันล่าสุด');assert.equal(ctx.$('saveState').textContent,'มีข้อมูลใหม่จากที่อื่น');
  await ctx.recoverLayout();assert.equal(reloads,1);assert.equal(retries,0);assert.equal(confirmations,1);
  console.log('PASS server conflict takes priority over image/render retry (render error '+renderError+')');
 }
 {
  let reloads=0,retries=0;
  const ctx=runtime(['recoverLayout'],{confirm:()=>false,openLayout:async()=>reloads++,retryRender:async()=>retries++});
  ctx.state.conflict=true;ctx.state.imageFailures=new Set(['missing']);ctx.state.dirty=true;
  await ctx.recoverLayout();assert.equal(reloads,0);assert.equal(retries,0);assert.equal(ctx.state.dirty,true);assert.equal(ctx.state.conflict,true);
  console.log('PASS cancelling conflict recovery preserves unsaved edits and never repaints');
 }
 for(const renderError of [false,true]){
  let reloads=0,retries=0;
  const ctx=runtime(['renderSave','recoverLayout'],{
   updateHistButtons(){},confirm(){throw Error('retry must not discard edits');},
   openLayout:async()=>reloads++,retryRender:async()=>retries++,
  });
  ctx.state.conflict=false;ctx.state.renderError=renderError;ctx.state.imageFailures=new Set(['missing']);ctx.$('saveState').dataset={};
  ctx.renderSave();assert.equal(ctx.$('reloadBtn').textContent,'ลองแสดงหน้าใหม่');
  await ctx.recoverLayout();assert.equal(reloads,0);assert.equal(retries,1);
  console.log('PASS image/render failure without conflict retains safe local retry (render error '+renderError+')');
 }
 {
  const page={id:'A',elements:[{text:'saved old text'}]};let canvas=[{text:'edited unsaved text'}],savedElements;
  const ctx=runtime(['setBusy','retryRender','syncPage'],{
   curr:()=>page,serializeNode:node=>({...node}),renderSave(){},
   resumeAutosave(){savedElements=page.elements.map(node=>({...node}));},
   setTimeout(){savedElements=page.elements.map(node=>({...node}));return 1;},clearTimeout(){},
  });
  ctx.state.pages=[page];ctx.state.canvasPage=page;ctx.state.dirty=true;ctx.state.imageFailures=new Set(['image-A']);
  ctx.state.contentLayer={getChildren:()=>canvas};
  ctx.paintPage=async()=>{canvas=page.elements.map(node=>({...node}));};
  await ctx.retryRender();
  assert.equal(canvas[0].text,'edited unsaved text');assert.equal(page.elements[0].text,'edited unsaved text');
  assert.equal(savedElements[0].text,'edited unsaved text');assert.equal(ctx.state.dirty,true);assert.equal(ctx.root.inert,false);
  console.log('PASS retry snapshots unsaved canvas edits before repaint and preserves them for autosave');
 }
 for(const scenario of ['wrong-page','failed-render']){
  const page={id:'A',elements:[{text:'correct A'}]};let canvas=[{text:'must not copy'}];
  const ctx=runtime(['setBusy','retryRender','syncPage'],{curr:()=>page,serializeNode:node=>node,renderSave(){}});
  ctx.state.canvasPage=scenario==='wrong-page'?{id:'B'}:page;ctx.state.renderError=scenario==='failed-render';
  ctx.state.contentLayer={getChildren:()=>canvas};ctx.state.imageFailures=new Set();
  ctx.paintPage=async()=>{canvas=page.elements;};
  await ctx.retryRender();assert.equal(page.elements[0].text,'correct A');assert.equal(canvas[0].text,'correct A');
  console.log('PASS retry never imports '+scenario+' canvas content into the document');
 }
 {
  let saved=false,painted=[];const images=[];
  const ctx=runtime(['setBusy','exportPdf'],{
   JsPDF:function(){this.addPage=()=>{};this.addImage=url=>images.push(url);this.save=()=>{saved=true;};},
   document:{fonts:{ready:Promise.resolve()}},checkReady:async()=>true,dims:()=>({w:794,h:1123}),safeName:()=> 'test',
   renderExport:()=> 'raster',
  });
  ctx.state.pages=[{id:'A'},{id:'B'}];ctx.state.imageFailures=new Set();ctx.curr=()=>ctx.state.pages[ctx.state.active];
  ctx.paintPage=async()=>{
   painted.push(ctx.state.active);
   if(ctx.state.active===0)ctx.state.imageFailures.add('shared-image');
   else ctx.state.imageFailures.delete('shared-image');
  };
  await ctx.exportPdf();
  assert.equal(saved,false);assert.equal(images.length,0);assert.equal(painted.includes(1),false);
  assert.equal(ctx.state.exporting,false);assert.equal(ctx.root.inert,false);
  console.log('PASS PDF aborts before adding a blank page even if a later page could recover its shared image');
 }
 {
  let saved=false,painted=[];const images=[];
  const ctx=runtime(['setBusy','exportPdf'],{
   JsPDF:function(){this.addPage=()=>{};this.addImage=url=>images.push(url);this.save=()=>{saved=true;};},
   document:{fonts:{ready:Promise.resolve()}},checkReady:async()=>true,dims:()=>({w:794,h:1123}),safeName:()=> 'test',
   renderExport:()=> 'valid-raster',
  });
  ctx.state.pages=[{id:'A'},{id:'B'},{id:'C'}];ctx.state.imageFailures=new Set();ctx.curr=()=>ctx.state.pages[ctx.state.active];
  ctx.paintPage=async()=>{painted.push(ctx.state.active);ctx.state.imageFailures.clear();if(ctx.state.active===1)ctx.state.imageFailures.add('image-B');};
  await ctx.exportPdf();
  assert.equal(saved,false);assert.equal(images.length,1);assert.equal(painted.includes(2),false);
  assert.equal(ctx.state.exporting,false);assert.equal(ctx.root.inert,false);
  console.log('PASS PDF never downloads a partial document when an intermediate page has missing images');
 }
 {
  let saved=false,count=0;
  const ctx=runtime(['setBusy','exportPdf'],{
   JsPDF:function(){this.addPage=()=>{};this.addImage=()=>count++;this.save=()=>{saved=true;};},
   document:{fonts:{ready:Promise.resolve()}},checkReady:async()=>true,dims:()=>({w:794,h:1123}),safeName:()=> 'test',renderExport:()=> 'valid-raster',
  });
  ctx.state.pages=[{id:'A'},{id:'B'}];ctx.state.imageFailures=new Set();ctx.curr=()=>ctx.state.pages[ctx.state.active];
  await ctx.exportPdf();assert.equal(saved,true);assert.equal(count,2);assert.equal(ctx.root.inert,false);
  console.log('PASS PDF still exports every page when all images are ready');
 }
 {
  const page={id:'A',elements:[{id:'text-A'}],_hist:[],_hi:-1};const loaded=[];
  const ctx=runtime(['paintPage'],{
   rehydrate:async element=>({id:element.id,destroy(){}}),dims:()=>({w:794,h:1123}),select(){},setZoom(){},
   pageSnapshot:()=>'{"id":"A"}',updatePageLabel(){},renderLayers(){},refreshProps(){},updateHistButtons(){},
  });
  ctx.state.pages=[page];ctx.curr=()=>page;ctx.state.restoreToken=0;ctx.state.stage={};ctx.state.renderError=true;ctx.state.imageFailures=new Set();
  ctx.state.bgRect={setAttrs(){}};ctx.state.bgLayer={batchDraw(){}};
  ctx.state.contentLayer={destroyChildren(){},add:node=>loaded.push(node),batchDraw(){}};
  await ctx.paintPage();assert.equal(ctx.state.canvasPage,page);assert.equal(ctx.state.renderError,false);assert.equal(loaded[0].id,'text-A');
  assert.equal(ctx.state.restoring,false);
  console.log('PASS successful render binds the new page only after replacing artwork and clears recovery state');
 }
 {
  const workspace={inert:false};let listening=true;
  const ctx=runtime(['setRenderError'],{root:{inert:false,querySelector:()=>workspace}});
  ctx.state.contentLayer={listening:value=>{listening=value;}};
  ctx.setRenderError(true);assert.equal(workspace.inert,true);assert.equal(listening,false);assert.equal(ctx.root.inert,false);
  ctx.setRenderError(false);assert.equal(workspace.inert,false);assert.equal(listening,true);
  console.log('PASS render error guards only artwork editing while keeping retry/navigation controls available');
 }
 {
  let canvas=[{id:'page-B-text'}];
  const ctx=runtime(['syncPage'],{serializeNode:node=>node});
  const pageA={elements:[{id:'page-A-text'}]},pageB={elements:canvas};
  ctx.state.pages=[pageA,pageB];ctx.state.active=0;ctx.state.canvasPage=pageB;
  ctx.curr=()=>ctx.state.pages[ctx.state.active];ctx.state.contentLayer={getChildren:()=>canvas};
  ctx.syncPage();assert.equal(pageA.elements[0].id,'page-A-text');
  ctx.state.canvasPage=pageA;canvas=[{id:'edited-A'}];ctx.syncPage();assert.equal(pageA.elements[0].id,'edited-A');
  console.log('PASS sync refuses a canvas bound to another page and resumes only after a matching render');
 }
 {
  const pageA={elements:[{id:'A'}]},pageB={elements:[{id:'B'}]};let displayed=pageA;
  const ctx=runtime(['setBusy','syncPage','exportPdf'],{
   JsPDF:function(){this.addPage=()=>{};this.addImage=()=>{};this.save=()=>{};},
   document:{fonts:{ready:Promise.resolve()}},checkReady:async()=>true,renderExport:()=>'',safeName:()=> 'test',serializeNode:node=>node,
   dims:()=>({w:794,h:1123}),
  });
  ctx.state.pages=[pageA,pageB];ctx.state.canvasPage=pageA;ctx.curr=()=>ctx.state.pages[ctx.state.active];
  ctx.state.contentLayer={getChildren:()=>displayed.elements};let first=true;
  ctx.paintPage=async()=>{
   if(ctx.state.active===0&&!first)throw Error('cannot restore A');
   first=false;displayed=ctx.curr();ctx.state.canvasPage=displayed;
  };
  await ctx.exportPdf();ctx.syncPage();
  assert.equal(pageA.elements[0].id,'A');assert.equal(ctx.state.renderError,true);assert.equal(ctx.state.exporting,false);assert.equal(ctx.root.inert,false);
  console.log('PASS PDF restore failure blocks edits and cannot overwrite page A with page B artwork');
 }
 {
  let timeout,image;const timers=new Set();
  const ctx=runtime(['loadImage'],{
   setTimeout(callback,delay){assert.equal(delay,15000);timeout=callback;timers.add(callback);return callback;},clearTimeout:timer=>timers.delete(timer),
   document:{createElement:()=>({width:0,height:0})},Image:class{constructor(){image=this;}removeAttribute(name){this.removed=name;}},
  });
  ctx.state.imageCache=new Map();ctx.state.imageFailures=new Set();
  const pending=ctx.loadImage('image-A'),late=image.onload;timeout();
  const placeholder=await pending;assert.equal(placeholder.width,1);assert.equal(ctx.state.imageFailures.has('image-A'),true);
  assert.equal(image.removed,'src');assert.equal(image.onload,null);assert.equal(timers.size,0);
  late();assert.equal(ctx.state.imageCache.has('image-A'),false);
  const retry=ctx.loadImage('image-A');image.onload();assert.equal(await retry,image);
  assert.equal(ctx.state.imageFailures.has('image-A'),false);assert.equal(ctx.state.imageCache.get('image-A'),image);assert.equal(timers.size,0);
  console.log('PASS stalled images time out, detach handlers, ignore late receipts and retry without caching placeholders');
 }
 {
  const ctx=runtime(['setBusy','retryRender'],{fitPage(){},renderSave(){},setTimeout:()=>1,clearTimeout});
  ctx.state.renderError=true;ctx.state.imageFailures=new Set(['image-A']);
  ctx.paintPage=async()=>{ctx.state.renderError=false;};
  await ctx.retryRender();assert.equal(ctx.state.renderError,false);assert.equal(ctx.root.inert,false);assert.equal(ctx.state.imageFailures.size,0);
  ctx.paintPage=async()=>{throw Error('still unavailable');};ctx.state.renderError=true;
  await ctx.retryRender();assert.equal(ctx.state.renderError,true);assert.equal(ctx.root.inert,false);
  console.log('PASS retry releases operation lock while preserving the edit guard on repeated failure');
 }
 {
  const handlers={};let recorded=0;
  const control={value:'4.5',addEventListener:(name,callback)=>{handlers[name]=callback;}};
  const node={getAttr:()=>false,getClassName:()=> 'Text'};
  const ctx=runtime(['updateAttr'],{$:()=>control,refreshPosition(){},markDirty(){ctx.state.dirty=true;},record(){recorded++;}});
  ctx.state.selected=node;ctx.state.contentLayer={batchDraw(){}};ctx.state.transformer={forceUpdate(){}};
  ctx.updateAttr('pLetterSpacing',(node,value)=>{node.spacing=Number(value);});
  handlers.input();assert.equal(node.spacing,4.5);assert.equal(ctx.state.dirty,true);assert.equal(recorded,0);
  handlers.change();assert.equal(recorded,1);
  console.log('PASS inspector input marks dirty immediately without needing blur or fragmenting undo history');
 }
 for(const ready of [false,true]){
  const messages=[];
  const ctx=runtime(['setBusy','exportPdf'],{
   JsPDF:function(){},document:{fonts:{ready:Promise.resolve()}},checkReady:async()=>ready,
   paintPage:async()=>{throw Error('render failed');},showMessage:text=>messages.push(text),
  });
  await ctx.exportPdf();assert.equal(ctx.state.exporting,false);assert.equal(ctx.root.inert,false);assert.equal(ctx.state.active,0);
  assert.ok(messages.some(text=>text.includes('render failed')));
  console.log('PASS PDF always unlocks when restoring the editor fails (readiness '+ready+')');
 }
 {
  const ctx=runtime(['cropBox']);
  for(const [iw,ih,ratio] of [[900,600,1],[600,900,16/9],[4000,100,3/4]])for(const zoom of [1,2,5])for(const position of [0,.5,1]){
   const box=ctx.cropBox(iw,ih,ratio,{x:position,y:position,zoom});
   assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=iw+.001&&box.y+box.height<=ih+.001);
   assert.ok(Math.abs(box.width/box.height-ratio)<.00001);
  }
  console.log('PASS normalized crop remains within source bounds across ratios, zoom and edge positions');
 }
 {
  const added=[];let fail=true,loaded=0;
  const ctx=runtime(['ensureFontFamily','prepareFonts'],{
   fontLoads:new Map(),document:{baseURI:'http://localhost/siya_news/studio.html'},URL,setTimeout,clearTimeout,
   browserWindow:{document:{fonts:{add:face=>added.push(face)}}},
   FontFace:class {constructor(family,url,style){this.family=family;this.url=url;this.style=style;}async load(){loaded++;if(fail&&this.style.weight==='700')throw Error('blocked');return this;}},
  });
  await assert.rejects(ctx.ensureFontFamily('Sarabun'),/โหลดฟอนต์/);assert.equal(added.length,0);
  fail=false;await ctx.prepareFonts([{elements:[{type:'Text',fontFamily:'Sarabun'}]}]);
  assert.equal(added.length,4);assert.equal(loaded,8);
  await ctx.ensureFontFamily('Sarabun');assert.equal(loaded,8);
  console.log('PASS local Sarabun registers all four styles atomically, retries failures, and caches success');
 }
 {
  let cleared=false,destroyed=0;
  const ctx=runtime(['paintPage'],{rehydrate:async element=>{if(element.id==='bad')throw Error('bad element');return {destroy(){destroyed++;}};}});
  ctx.state.pages[0].elements=[{id:'good'},{id:'bad'}];ctx.state.restoreToken=0;ctx.state.stage={};ctx.state.contentLayer={destroyChildren(){cleared=true;}};
  ctx.curr=()=>ctx.state.pages[0];
  await assert.rejects(ctx.paintPage(),/bad element/);
  assert.equal(cleared,false);assert.equal(destroyed,1);assert.equal(ctx.state.restoring,false);
  assert.equal(ctx.state.pages[0].elements.length,2);
  assert.equal(ctx.state.renderError,true);
  console.log('PASS render failure preserves the old canvas and never silently drops stored elements');
 }
 {
  const ctx=runtime(['setBusy','openLayout'],{
   request:async()=>({data:{id:2,title:'B',version:1,document:{pages:[{id:'new',format:'a4_portrait',bg:'#fff',elements:[]}]}}}),
   fetchPool:async()=>{throw Error('pool unavailable');},paintPage:async()=>{throw Error('must not repaint');},
  });
  await ctx.openLayout(2);
  assert.equal(ctx.state.layout.id,1);assert.equal(ctx.state.pages[0].id,'old');assert.equal(ctx.state.dirty,false);assert.equal(ctx.root.inert,false);
  console.log('PASS failed dependency loading preserves the old document/canvas binding');
 }
 {
  const gate=deferred();let requests=0;
  const ctx=runtime(['setBusy','deleteLayout','openLayout'],{request:()=>{requests++;return gate.promise;},createLayout:async()=>{}});
  const deletion=ctx.deleteLayout();assert.equal(ctx.state.mutating,true);assert.equal(ctx.root.inert,true);
  await ctx.openLayout(2);assert.equal(requests,1);assert.equal(ctx.state.layout.id,1);
  // Also verify late receipts bind to the captured ID even if state changes externally.
  ctx.state.layout={id:2,version:1,title:'B'};gate.resolve({status:'success'});await deletion;
  assert.equal(ctx.state.layout.id,2);assert.equal(ctx.state.layouts.length,1);assert.equal(ctx.state.layouts[0].id,2);
  assert.equal(ctx.root.inert,false);console.log('PASS delete locks navigation and applies its receipt only to the captured layout');
 }
 {
  const calls=[];
  const ctx=runtime(['fetchReferencedPool'],{request:async url=>{
   const ids=url.split('ids=')[1].split(',').map(Number);calls.push(ids);
   assert.ok(ids.length<=60);return {data:ids.map(id=>({id}))};
  }});
  const rows=await ctx.fetchReferencedPool(Array.from({length:181},(_,i)=>i+1));
  assert.equal(rows.length,181);assert.equal(calls.length,4);assert.equal(rows[180].id,181);
  console.log('PASS references above 80 load in bounded batches without dropping IDs');
 }
 {
  const gate=deferred();let painted=0,checked=false;
  const ctx=runtime(['setBusy','openLayout','exportPdf'],{
   JsPDF:function(){},checkReady:async()=>{checked=true;await gate.promise;return false;},
   paintPage:async()=>{painted++;},request:async()=>{throw Error('must not navigate');},
  });
  const exporting=ctx.exportPdf();assert.equal(checked,true);assert.equal(ctx.state.exporting,true);assert.equal(ctx.root.inert,true);
  await ctx.openLayout(2);assert.equal(ctx.state.layout.id,1);
  gate.resolve();await exporting;
  assert.equal(ctx.state.exporting,false);assert.equal(ctx.root.inert,false);assert.equal(painted,1);
  console.log('PASS PDF locks before readiness awaits and unlocks after failed checks');
 }
 {
  const gate=deferred();
  const ctx=runtime(['setBusy','openLayout','restoreRevision'],{
   request:()=>gate.promise,
   refreshPool:async()=>{throw Error('pool unavailable');},
  });
  const restore=ctx.restoreRevision(1);assert.equal(ctx.state.mutating,true);
  await ctx.openLayout(2);assert.equal(ctx.state.layout.id,1);
  gate.resolve({version:2,title:'restored',document:{pages:[{id:'restored-page',format:'a4_portrait',bg:'#fff',elements:[]}]}});
  await restore;assert.equal(ctx.state.layout.version,2);assert.equal(ctx.state.pages[0].id,'restored-page');assert.equal(ctx.root.inert,false);
  console.log('PASS restore locks navigation and remains consistent if the news pool fails');
 }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
