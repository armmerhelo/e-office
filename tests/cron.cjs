const assert=require('node:assert/strict'),cp=require('node:child_process'),crypto=require('node:crypto'),path=require('node:path'),os=require('node:os');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe',port=Number(process.env.CRON_TEST_PORT||8096),base=`http://localhost:${port}`;
const token=crypto.randomBytes(32).toString('hex');
const env={...process.env,DB_DATABASE:process.env.TEST_DATABASE||'eoffice_review_test',APP_URL:base,EOFFICE_MOCK_SERVICES:'true',EOFFICE_CRON_TOKEN:token,EOFFICE_BACKUP_KEY:crypto.randomBytes(32).toString('base64'),EOFFICE_STORAGE:path.join(os.tmpdir(),'opencode','eoffice-test-storage')};
if(!env.DB_DATABASE.endsWith('_test'))throw Error('Only test DB allowed');
const server=cp.spawn(php,['-S',`localhost:${port}`,'scripts/router.php'],{env,stdio:['ignore','ignore','pipe']});let errors='';server.stderr.on('data',s=>errors+=s);
async function call(headers={},action='health'){return fetch(base+'/api/cron.php',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({action})});}
async function run(){for(let i=0;i<40;i++){try{await fetch(base+'/api/me.php');break;}catch{await new Promise(r=>setTimeout(r,100));}}
assert.equal((await call()).status,404);assert.equal((await call({Authorization:'Bearer wrong'})).status,404);assert.equal((await call({Authorization:'Bearer '+token,'Sec-Fetch-Site':'cross-site'})).status,403);
assert.equal((await fetch(base+'/backups/README.md')).status,403);
const health=await call({Authorization:'Bearer '+token});assert.equal(health.status,200);assert.equal((await health.json()).database_reachable,true);
assert.equal((await call({Authorization:'Bearer '+token},'invalid')).status,400);const queue=await call({Authorization:'Bearer '+token},'notifications');assert.equal(queue.status,200);assert.equal((await queue.json()).status,'success');
console.log('PASS cron token protection, cross-site rejection, health, dispatch and action whitelist');}
run().catch(e=>{console.error(e);console.error(errors);process.exitCode=1;}).finally(()=>server.kill());
