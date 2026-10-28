const assert=require('node:assert/strict');
const cp=require('node:child_process');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const port=Number(process.env.TEST_PORT||8091),base=`http://localhost:${port}`;
const env={...process.env,DB_DATABASE:process.env.TEST_DATABASE||'eoffice_review_test',EOFFICE_MOCK_SERVICES:'true',APP_URL:base};
if(!env.DB_DATABASE.endsWith('_test'))throw Error('Only test databases allowed');
function cli(args){const r=cp.spawnSync(php,args,{env,encoding:'utf8'});if(r.status!==0)throw Error(r.stdout+r.stderr);return r.stdout;}
cli(['scripts/migrate.php']);const seed=JSON.parse(cli(['tests/seed.php']));
function sql(code){return JSON.parse(cli(['-r',`require 'config/push-subscriptions.php';$pdo=app_pdo();${code}`]));}
const server=cp.spawn(php,['-S',`localhost:${port}`,'scripts/router.php'],{env,stdio:'ignore'});
const prefix='push-qa-'+Date.now()+'-';
async function call(path,cookie,data,status=200){
    const r=await fetch(base+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(data)});
    const body=await r.json();assert.equal(r.status,status,JSON.stringify(body));return {r,body};
}
async function login(name,cookie=''){
    const {r}=await call('/api/auth_login.php',cookie,{username:`qa-${name}@siya.ac.th`,password:'Review-Test-2026!'});
    return r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
}
async function register(cookie,id,owner,active=true,status=200){return call('/api/create_user_notification.php',cookie,{target_Id:prefix+id,_expected_owner:owner,active},status);}
const targets=id=>sql(`echo json_encode(app_push_targets(${Number(id)}));`).filter(v=>v.startsWith(prefix));
(async()=>{
    for(let i=0;i<50;i++){try{await fetch(base+'/api/me.php');break;}catch{await new Promise(r=>setTimeout(r,100));}}
    const owner=seed.users.owner,recipient=seed.users.recipient;
    const a=await login('owner'),other=await login('owner');
    await register('', 'guest',owner,true,401);
    await register(a,'wrong-owner',recipient,true,409);
    await call('/api/create_user_notification.php',a,{target_Id:prefix+'invalid-state',active:null},400);
    await register(a,'one',owner);await register(a,'one',owner);
    await register(other,'two',owner);
    assert.equal(targets(owner).length,2,'deduplicated subscriptions and independent devices');
    await register(a,'one',owner,false);assert.equal(targets(owner).length,1,'opt-out removes only current binding');
    await register(a,'one',owner);
    await call('/api/logout.php',a,{});
    assert.deepEqual(targets(owner),[prefix+'two'],'logout preserves other device only');
    await register(a,'one',owner,true,401);
    const next=await login('recipient',other);
    assert.equal(targets(owner).length,0,'account switch revokes previous browser session');
    await register(other,'two',owner,true,401);
    await register(next,'two',recipient);
    assert.deepEqual(targets(recipient),[prefix+'two']);
    await register(next,'two',recipient,false);assert.equal(targets(recipient).length,0);
    await register(next,'expired',recipient);
    const token=next.match(/User_Token=([a-f0-9]+)/)[1];
    sql(`$pdo->prepare('UPDATE eoffice_sessions SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE token_hash=?')->execute([hash('sha256','${token}')]);echo 'true';`);
    assert.equal(targets(recipient).length,0,'expired sessions never deliver');
    const racing=await login('owner'),racingToken=racing.match(/User_Token=([a-f0-9]+)/)[1];
    const blocker=cp.spawn(php,['-r',`require 'config/bootstrap.php';$pdo=app_pdo();$pdo->beginTransaction();$pdo->prepare('DELETE FROM eoffice_sessions WHERE token_hash=?')->execute([hash('sha256','${racingToken}')]);echo "locked\\n";flush();usleep(1500000);$pdo->commit();`],{env,stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{blocker.stdout.once('data',resolve);blocker.once('error',reject);});
    await register(racing,'revocation-race',owner,true,401);
    assert.equal(targets(owner).length,0,'revocation winning session lock rejects stale registration');
    console.log('PASS push registry: auth, owner guard, deduplication, opt-out, device isolation, logout, account replacement, expiry and concurrent revocation');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
    server.kill();sql(`$pdo->prepare('DELETE FROM eoffice_push_subscriptions WHERE subscription_id LIKE ?')->execute(['${prefix}%']);echo 'true';`);
});
