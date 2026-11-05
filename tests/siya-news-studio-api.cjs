// Opt-in isolated local mock API test for SIYA NEWS Studio.
const assert=require('node:assert/strict'),cp=require('node:child_process');
const base=process.env.EOFFICE_QA_BROWSER_URL||'http://127.0.0.1:8188',php=process.env.PHP_BIN||'php',fixture='tests/siya-news-role-fixture.php';
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname));
async function run(){
 assert.match(await fetch(base+'/index.php?view=public').then(r=>r.text()),/EOFFICE_MOCK_SERVICES\s*=\s*true/);
 const accounts=JSON.parse(cp.execFileSync(php,[fixture,'studio'],{encoding:'utf8'}));
 try{
  const sessions={};
  for(const [role,email] of Object.entries(accounts)){
   const response=await fetch(base+'/api/auth_login.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:email,password:process.env.EOFFICE_QA_PASSWORD})});assert.equal(response.status,200);
   const cookie=response.headers.getSetCookie().map(s=>s.split(';')[0]).join('; '),me=await fetch(base+'/api/me.php',{headers:{Cookie:cookie}}).then(r=>r.json());sessions[role]={cookie,id:me.user.id};
  }
  async function request(role,path,payload){const session=sessions[role];const response=await fetch(base+path,{method:payload?'POST':'GET',headers:{...(session?{Cookie:session.cookie}:{}),...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify({...session?{_expected_owner:session.id}:{},...payload})}:{})});const type=response.headers.get('content-type')||'';return {code:response.status,data:type.includes('application/json')?await response.json():null};}
  const post=(role,payload)=>request(role,'/api/siya-news-studio.php',payload),get=(role,path)=>request(role,'/api/siya-news-studio.php'+path);
  const apiNews=(role,payload)=>request(role,'/api/siya-news.php',payload);
  const editor=(role,id,version)=>apiNews(role,{action:'approve',id,version,review_note:'ตรวจสังเคราะห์สำหรับ Studio'});
  const submit=(role,id,version)=>apiNews(role,{action:'submit',id,version});
  const upload=async(role,id,version,name)=>{const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),form=new FormData();form.set('action','upload');form.set('id',id);form.set('version',version);form.set('image',new Blob([png],{type:'image/png'}),name);const response=await fetch(base+'/api/siya-news.php',{method:'POST',headers:{Cookie:sessions[role].cookie},body:form});assert.equal(response.status,200);return {png,data:await response.json()};};
  const draft=await apiNews('submit',{action:'create',title:'Studio source draft',body:'สังเคราะห์'});assert.equal(draft.code,200);
  const firstUpload=await upload('submit',draft.data.id,draft.data.version,'studio-one.png');
  let first=(await submit('submit',draft.data.id,firstUpload.data.version)).data;
  first=await editor('editor',draft.data.id,first.version);
  const pooled=await get('producer','?action=pool');assert.equal(pooled.code,200);const firstPool=pooled.data.data.find(row=>row.id===draft.data.id);assert.ok(firstPool);assert.equal(firstPool.images[0].id,firstUpload.data.image_id);
  const secondDraft=await apiNews('submit',{action:'create',title:'Studio second draft',body:'ยังไม่ผ่านตรวจ'});const secondId=secondDraft.data.id;
  const secondUpload=await upload('submit',secondId,secondDraft.data.version,'studio-two.png');
  const second=(await submit('submit',secondId,secondUpload.data.version)).data;await editor('editor',secondId,second.version);
  const draftOnly=(await apiNews('submit',{action:'create',title:'Studio unapproved',body:'ร่างที่ยังไม่ส่งตรวจ'})).data;
  assert.ok(!(await get('producer','?action=pool')).data.data.some(row=>row.id===draftOnly.id));
  const search=await get('producer','?action=pool&q='+encodeURIComponent('Studio source draft'));assert.equal(search.code,200);assert.ok(search.data.data.length>=1);
  const byIds=await get('producer','?action=pool&ids='+draft.data.id+','+draftOnly.id);assert.equal(byIds.code,200);assert.ok(byIds.data.data.some(row=>row.id===draft.data.id));assert.equal(byIds.data.data.some(row=>row.id===draftOnly.id),false);
  assert.equal((await get('guest','?action=pool')).code,401);
  for(const role of ['none','editor','submit'])assert.equal((await get(role,'?action=pool')).code,403,'pool denied: '+role);
  assert.equal((await post('editor',{action:'create',title:'denied'})).code,403);
  assert.equal((await post('producer2',{action:'create',title:'allowed'})).code,200);
  const created=await post('producer',{action:'create',title:'ชุดสังเคราะห์ Studio'});assert.equal(created.code,200);assert.equal(created.data.document.schema,'siya-studio/2');assert.equal(created.data.document.pages[0].format,'a4_portrait');
  const id=created.data.id;
  const baseElement=(id,type,extra={})=>({id,type,x:40,y:40,rotation:0,opacity:1,scaleX:1,scaleY:1,visible:true,name:type,...extra});
  const text=baseElement('t1','Text',{width:400,height:100,text:'หัวข้อสังเคราะห์',fontFamily:'Sarabun',fontSize:34,fontStyle:'bold',align:'left',fill:'#1e293b',lineHeight:1.65,letterSpacing:1.5,textDecoration:'underline',locked:true});
  const image=baseElement('i1','Image',{newsId:draft.data.id,imageId:firstUpload.data.image_id,width:500,height:300,cropView:{x:.25,y:.6,zoom:2},stroke:'#ef4444',strokeWidth:6,cornerRadius:24});
  const document={schema:'siya-studio/2',pages:[{id:'p1',format:'a4_portrait',bg:'#ffffff',elements:[text,image]},{id:'p2',format:'a4_landscape',bg:'#f8fafc',elements:[baseElement('c1','Circle',{radius:80,fill:'#4f46e5',stroke:null,strokeWidth:0})]}]};
  let saved=await post('producer',{action:'save',id,version:created.data.version,title:'ชุดสังเคราะห์ Studio',document});assert.equal(saved.code,200);assert.equal(saved.data.version,2);
  assert.equal((await post('producer',{action:'save',id,version:created.data.version,title:'stale',document})).code,409);
  const invalidDraft=JSON.parse(JSON.stringify(document));invalidDraft.pages[0].elements[1].newsId=draftOnly.id;
  assert.equal((await post('producer',{action:'save',id,version:saved.data.version,title:'x',document:invalidDraft})).code,400);
  const wrongImage=JSON.parse(JSON.stringify(document));wrongImage.pages[0].elements[1].imageId=secondUpload.data.image_id;
  assert.equal((await post('producer',{action:'save',id,version:saved.data.version,title:'x',document:wrongImage})).code,400);
  assert.equal((await post('producer',{action:'save',id,version:saved.data.version,title:'x',document:{schema:'siya-studio/2',pages:[]}})).code,400);
  assert.equal((await post('producer',{action:'save',id,version:saved.data.version,title:'x',document:{schema:'other',pages:document.pages}})).code,400);
  const duplicateIds=JSON.parse(JSON.stringify(document));duplicateIds.pages[1].elements[0].id=duplicateIds.pages[0].elements[0].id;
  assert.equal((await post('producer',{action:'save',id,version:saved.data.version,title:'x',document:duplicateIds})).code,400);
  const detail=await get('producer','?action=detail&id='+id);assert.equal(detail.code,200);assert.equal(detail.data.data.document.pages.length,2);assert.equal(detail.data.data.document.pages[0].elements[1].imageId,firstUpload.data.image_id);assert.ok(detail.data.data.history.length>=2);
  assert.equal(detail.data.data.document.pages[0].elements[0].fontFamily,'Sarabun');
  assert.equal(detail.data.data.document.pages[0].elements[0].locked,true);assert.equal(detail.data.data.document.pages[0].elements[0].textDecoration,'underline');
  assert.deepEqual(detail.data.data.document.pages[0].elements[1].cropView,{x:.25,y:.6,zoom:2});assert.equal(detail.data.data.document.pages[0].elements[1].cornerRadius,24);
  assert.equal((await get('producer2','?action=detail&id='+id)).code,403);
  assert.equal((await get('editor','?action=detail&id='+id)).code,403);
  assert.equal((await get('producer','?action=detail&id=999999999')).code,404);
  assert.equal((await get('producer2','?action=list')).data.data.some(row=>row.id===id),false);
  assert.equal((await post('producer',{action:'save',id,version:saved.data.version,title:'x',document,_expected_owner:undefined})).code,409);
  assert.equal((await post('producer',{action:'save',id,version:saved.data.version,title:'x',document,_expected_owner:sessions.producer2.id})).code,409);
  assert.equal((await post('producer',{action:'restore',id,version:saved.data.version-1,revision:1})).code,409);
  assert.equal((await post('producer2',{action:'restore',id,version:saved.data.version,revision:1})).code,403);
  const restored=await post('producer',{action:'restore',id,version:saved.data.version,revision:1});assert.equal(restored.code,200);assert.equal(restored.data.version,3);assert.equal(restored.data.document.schema,'siya-studio/2');assert.equal(restored.data.document.pages.length,1);assert.equal(restored.data.document.pages[0].format,'a4_portrait');
  assert.equal((await post('producer',{action:'delete',id,version:saved.data.version})).code,409);
  assert.equal((await post('producer2',{action:'delete',id,version:restored.data.version})).code,403);
  assert.equal((await post('producer',{action:'delete',id,version:restored.data.version})).code,200);
  assert.equal((await get('producer','?action=detail&id='+id)).code,404);
  assert.equal((await get('producer','?action=list')).data.data.some(row=>row.id===id),false);
  console.log('PASS studio API: producer-only access, pool approval, layout create/save, refs, version conflicts, ownership, history restore, delete and owner binding');
 }finally{cp.execFileSync(php,[fixture,'cleanup'],{input:JSON.stringify(Object.values(accounts)),encoding:'utf8'});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
