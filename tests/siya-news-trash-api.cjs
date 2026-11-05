// Opt-in isolated local mock production-like permissions and trash lifecycle.
const assert=require('node:assert/strict'),cp=require('node:child_process');
const base=process.env.EOFFICE_QA_BROWSER_URL||'http://127.0.0.1:8188',php=process.env.PHP_BIN||'php',fixture='tests/siya-news-role-fixture.php';
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname));
async function run(){
 assert.match(await fetch(base+'/index.php?view=public').then(r=>r.text()),/EOFFICE_MOCK_SERVICES\s*=\s*true/);
 const accounts=JSON.parse(cp.execFileSync(php,[fixture,'with-admin'],{encoding:'utf8'}));let imageId;
 try{
  const sessions={};for(const [role,email] of Object.entries(accounts)){
   const r=await fetch(base+'/api/auth_login.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:email,password:process.env.EOFFICE_QA_PASSWORD})});assert.equal(r.status,200);
   const cookie=r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; '),me=await fetch(base+'/api/me.php',{headers:{Cookie:cookie}}).then(r=>r.json());sessions[role]={cookie,id:me.user.id};
  }
  async function request(role,path,payload){const s=sessions[role];const r=await fetch(base+path,{method:payload?'POST':'GET',headers:{...(s?{Cookie:s.cookie}:{}),...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify({_expected_owner:s?.id,...payload})}:{})});const type=r.headers.get('content-type')||'';return {code:r.status,data:type.includes('application/json')?await r.json():null};}
  const post=(role,payload)=>request(role,'/api/siya-news.php',payload),get=(role,id,trash=false)=>request(role,`/api/siya-news.php?action=detail&id=${id}${trash?'&scope=trash':''}`),list=(role,scope)=>request(role,'/api/siya-news.php?action=list&scope='+scope);
  const create=async()=>{const r=await post('submit',{action:'create',title:'Synthetic trash regression',body:'ข่าวสังเคราะห์สำหรับทดสอบถังขยะ'});assert.equal(r.code,200);return r.data;};
  let news=await create(),id=news.id;
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),form=new FormData();
  form.set('action','upload');form.set('id',id);form.set('version',news.version);form.set('image',new Blob([png],{type:'image/png'}),'synthetic-trash.png');
  const uploaded=await fetch(base+'/api/siya-news.php',{method:'POST',headers:{Cookie:sessions.submit.cookie},body:form});assert.equal(uploaded.status,200);const upload=await uploaded.json();imageId=upload.image_id;news.version=upload.version;
  assert.equal((await request('submit','/api/siya-news-image.php?id='+imageId)).code,200);
  for(const role of ['guest','none','producer','submit2','editor'])assert.equal((await post(role,{action:'trash',id,version:news.version})).code,role==='guest'?401:403);
  assert.equal((await post('submit',{action:'trash',id,version:news.version,_expected_owner:undefined})).code,409);
  assert.equal((await post('submit',{action:'trash',id,version:news.version,_expected_owner:sessions.submit2.id})).code,409);
  assert.equal((await post('submit',{action:'trash',id,version:99})).code,409);
  let r=await post('submit',{action:'trash',id,version:news.version});assert.equal(r.code,200);news=r.data;assert.equal(news.status_value,'deleted');
  assert.equal((await get('submit',id)).code,403);assert.equal((await get('submit',id,true)).code,200);assert.equal((await get('editor',id,true)).code,403);
  for(const role of ['submit','editor','admin','producer'])assert.equal((await request(role,'/api/siya-news-image.php?id='+imageId)).code,403);
  assert.equal((await get('submit',id,true)).data.data.image_count,1);assert.deepEqual((await get('submit',id,true)).data.data.images,[]);
  assert.equal((await request('submit','/api/siya-news-proofread.php',{title:'ข่าว',body:'อนุญาติ',id,consent:true})).code,403);
  assert.ok(!(await list('submit','mine')).data.data.some(row=>row.id===id));assert.ok((await list('submit','trash')).data.data.some(row=>row.id===id));assert.ok(!(await list('submit2','trash')).data.data.some(row=>row.id===id));
  assert.equal((await post('submit',{action:'save',id,version:news.version,title:'forbidden',body:'forbidden'})).code,403);
  assert.equal((await post('submit',{action:'trash',id,version:news.version})).code,409);
  assert.equal((await post('submit',{action:'restore',id,version:news.version-1})).code,409);
  r=await post('submit',{action:'restore',id,version:news.version});assert.equal(r.code,200);assert.equal(r.data.status_value,'draft');news=r.data;
   assert.ok((await list('submit','mine')).data.data.some(row=>row.id===id));assert.equal((await get('submit',id)).data.data.deleted_at,null);
   assert.equal((await request('submit','/api/siya-news-image.php?id='+imageId)).code,200);
   const restoredBytes=Buffer.from(await fetch(base+'/api/siya-news-image.php?id='+imageId,{headers:{Cookie:sessions.submit.cookie}}).then(r=>r.arrayBuffer()));assert.deepEqual(restoredBytes,png);
  console.log('PASS draft trash/restore: roles, owner binding, stale/double actions, list isolation and mutation denial');
  r=await post('submit',{action:'submit',id,version:news.version});news=r.data;assert.equal(r.code,200);
  assert.equal((await post('submit',{action:'trash',id,version:news.version})).code,403);
  r=await post('editor',{action:'trash',id,version:news.version});assert.equal(r.code,200);news=r.data;
  assert.equal((await get('submit',id,true)).code,403);assert.ok(!(await list('submit','trash')).data.data.some(row=>row.id===id));
  assert.ok((await list('editor','trash')).data.data.some(row=>row.id===id));
  r=await post('editor',{action:'restore',id,version:news.version});assert.equal(r.code,200);news=r.data;assert.equal(news.status_value,'review');
  r=await post('editor',{action:'approve',id,version:news.version});assert.equal(r.code,200);news=r.data;
  r=await post('editor',{action:'trash',id,version:news.version});assert.equal(r.code,200);news=r.data;
  assert.equal((await get('producer',id)).code,403);assert.equal((await list('producer','trash')).code,403);assert.equal((await request('producer','/api/siya-news-export.php?id='+id)).code,404);
  assert.equal((await post('producer',{action:'restore',id,version:news.version})).code,403);
  r=await post('admin',{action:'restore',id,version:news.version});assert.equal(r.code,200);news=r.data;assert.equal(news.status_value,'review');assert.equal((await get('producer',id)).code,403);
  const restored=(await get('editor',id)).data.data;assert.equal(restored.approved_version,null);assert.ok(restored.history.some(v=>v.snapshot.status==='deleted'));
  r=await post('editor',{action:'approve',id,version:news.version});assert.equal(r.code,200);assert.equal((await get('producer',id)).code,200);
  console.log('PASS submitted/approved news: reviewer/admin trash, restricted trash access and required reapproval after restore');
  const draft=await create();r=await post('admin',{action:'trash',id:draft.id,version:draft.version});assert.equal(r.code,200);assert.equal((await get('admin',draft.id,true)).code,200);
  assert.equal((await post('admin',{action:'restore',id:draft.id,version:r.data.version})).data.status_value,'draft');
  console.log('PASS Admin can trash and restore drafts belonging to another account');
  const racing=await create(),results=await Promise.all(['submit','admin'].map(role=>post(role,{action:'trash',id:racing.id,version:racing.version})));
  assert.deepEqual(results.map(row=>row.code).sort(),[200,409]);
  const trashed=(await get('admin',racing.id,true)).data.data;assert.equal(trashed.version,racing.version+1);
  assert.equal((await post('admin',{action:'restore',id:racing.id,version:trashed.version})).code,200);
  console.log('PASS concurrent trash requests create a single versioned transition');
 }finally{cp.execFileSync(php,[fixture,'cleanup'],{input:JSON.stringify(Object.values(accounts)),encoding:'utf8'});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
