// Isolated localhost/mock database only; never contacts an external AI service.
const assert=require('node:assert/strict'),cp=require('node:child_process');
const base=process.env.EOFFICE_QA_BROWSER_URL||'http://127.0.0.1:8188';
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname));
const php=process.env.PHP_BIN||'php',fixture='tests/siya-news-role-fixture.php';
async function run(){
 const probe=await fetch(base+'/index.php?view=public').then(r=>r.text());assert.match(probe,/EOFFICE_MOCK_SERVICES\s*=\s*true/);
 const emails=JSON.parse(cp.execFileSync(php,[fixture],{encoding:'utf8'}));
 try{
  const sessions={};
  for(const [role,email] of Object.entries(emails)){
   const response=await fetch(base+'/api/auth_login.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:email,password:process.env.EOFFICE_QA_PASSWORD})});assert.equal(response.status,200);
   const cookie=response.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
   const me=await fetch(base+'/api/me.php',{headers:{Cookie:cookie}}).then(r=>r.json());sessions[role]={cookie,id:me.user.id};
  }
  async function post(role,payload,path='/api/siya-news-proofread.php'){
   const session=sessions[role];const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(session?{Cookie:session.cookie}:{})},body:JSON.stringify({...session?{_expected_owner:session.id}:{},...payload})});
   return {code:response.status,data:await response.json()};
  }
  const input={title:'ขออนุญาติ',body:'ข่าวสังเคราะห์',consent:true};
  assert.equal((await post('guest',input)).code,401);
  for(const role of ['none','producer'])assert.equal((await post(role,input)).code,403);
  assert.equal((await post('submit',{...input,_expected_owner:undefined})).code,409);
  assert.equal((await post('submit',{...input,_expected_owner:null})).code,400);
  assert.equal((await post('submit',{...input,_expected_owner:sessions.submit2.id})).code,409);
  assert.equal((await post('submit',{...input,consent:false})).code,400);
  assert.equal((await post('submit',{...input,title:'x'.repeat(256)})).code,400);
  assert.equal((await post('submit',{...input,body:'x'.repeat(30001)})).code,400);
  assert.equal((await post('submit',{...input,title:'',body:'   '})).code,400);
  assert.equal((await post('submit',{...input,id:-1})).code,400);
  for(const id of [0,'',[],false])assert.equal((await post('submit',{...input,id})).code,400);
  const created=await post('submit',{action:'create',...input},'/api/siya-news.php');assert.equal(created.code,200);const id=created.data.id;
  assert.equal((await post('submit2',{...input,id})).code,403);
  assert.equal((await post('editor',{...input,id})).code,403);
  const own=await post('submit',{...input,id});assert.equal(own.code,200);assert.equal(own.data.mock,true);assert.equal(own.data.suggestions[0].replacement,'อนุญาต');
  const unchanged=await fetch(base+'/api/siya-news.php?action=detail&id='+id,{headers:{Cookie:sessions.submit.cookie}}).then(r=>r.json());assert.equal(unchanged.data.version,created.data.version);assert.equal(unchanged.data.title,input.title);
  assert.equal((await post('submit',{...input,id})).code,429);
  const submitted=await post('submit',{action:'submit',id,version:created.data.version},'/api/siya-news.php');assert.equal(submitted.code,200);
  assert.equal((await post('submit',{...input,id})).code,403);
  const reviewed=await post('editor',{...input,id});assert.equal(reviewed.code,200);assert.equal(reviewed.data.mock,true);
  const approved=await post('editor',{action:'approve',id,version:submitted.data.version},'/api/siya-news.php');assert.equal(approved.code,200);
  assert.equal((await post('producer',{...input,id})).code,403);
  const approvedOwner=await post('submit2',{...input,id});assert.equal(approvedOwner.code,403);
  console.log('PASS proofread API: guest, roles, account binding, consent, ownership, workflow permissions, mock output and cooldown');
 }finally{cp.execFileSync(php,[fixture,'cleanup'],{input:JSON.stringify(Object.values(emails)),encoding:'utf8'});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
