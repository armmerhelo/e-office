const assert=require('node:assert/strict');
const cp=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const base='http://localhost:'+Number(process.env.GOOGLE_SIGNUP_TEST_PORT||8097);
const database=process.env.TEST_DATABASE||'eoffice_review_test';
if(!database.endsWith('_test'))throw Error('Only *_test databases allowed');
const parent=path.join(os.tmpdir(),'opencode'); fs.mkdirSync(parent,{recursive:true});
const sessions=fs.mkdtempSync(path.join(parent,'eoffice-google-sessions-'));
const env={...process.env,DB_DATABASE:database,APP_URL:base,EOFFICE_MOCK_SERVICES:'true',GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret'};
const stamp=Date.now();
const school=`qa-google-${stamp}-school@siya.ac.th`,external=`qa-google-${stamp}-external@example.org`;
const args=['-d','session.save_path='+sessions];
function cli(file,extra=[]){const r=cp.spawnSync(php,[...args,file,...extra],{env,encoding:'utf8'});if(r.status!==0)throw Error(r.stdout+r.stderr);return r.stdout;}
function fixture(action,email,mode='signup',ttl='600'){return JSON.parse(cli('tests/google-signup-fixture.php',[action,email,mode,ttl]));}
cli('scripts/migrate.php');
const server=cp.spawn(php,[...args,'-S',new URL(base).host,'scripts/router.php'],{env,stdio:['ignore','ignore','pipe']});
let errors=''; server.stderr.on('data',s=>errors+=s);
async function request(route,{cookie='',data,status=200}={}){const r=await fetch(base+route,{method:data?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});const body=await r.json();assert.equal(r.status,status,JSON.stringify(body));return {r,body};}
async function run(){
    for(let i=0;i<50;i++){try{await fetch(base+'/api/me.php');break;}catch{await new Promise(r=>setTimeout(r,100));}}
    await request('/api/auth_google_signup.php',{status:401});
    const flow=fixture('pending',school);
    const profile=await request('/api/auth_google_signup.php',{cookie:flow.cookie});
    assert.equal(profile.body.name,'Google QA Name'); assert.equal(profile.body.email,school); assert.equal(profile.body.mode,'signup');
    await request('/api/auth_google_signup.php',{cookie:flow.cookie,data:{csrf:'wrong',name:'QA',consent:true},status:403});
    await request('/api/auth_google_signup.php',{cookie:flow.cookie,data:{csrf:flow.csrf,name:'QA',consent:false},status:400});
    await request('/api/auth_google_signup.php',{cookie:flow.cookie,data:{csrf:flow.csrf,name:'   ',consent:true},status:400});
    const signup=await request('/api/auth_google_signup.php',{cookie:flow.cookie,data:{csrf:flow.csrf,name:'Edited QA name',consent:true,email:'attacker@example.org',User_Status:'Admin',sub:'forged'}});
    assert.equal(signup.body.redirect_url,base+'/?id=123');
    assert.match(signup.r.headers.getSetCookie().join(';'),/HttpOnly/);
    const cookie=signup.r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
    const me=await request('/api/me.php',{cookie}); assert.equal(me.body.user.name,'Edited QA name');assert.equal(me.body.user.status,'User');
    await request('/api/auth_google_signup.php',{cookie:flow.cookie,data:{csrf:flow.csrf,name:'Replay',consent:true},status:401});
    const expired=fixture('pending',school,'signup','-1'); await request('/api/auth_google_signup.php',{cookie:expired.cookie,status:401});
    const deniedExternal=fixture('pending',external,'signup'); await request('/api/auth_google_signup.php',{cookie:deniedExternal.cookie,status:401});
    await request('/api/logout.php',{cookie,data:{}}); assert.equal((await request('/api/me.php',{cookie})).body.user,null);
    console.log('PASS school onboarding profile, CSRF, consent, required name, role/email/sub injection rejection, session, replay/expiry and logout');
    fixture('external',external); const link=fixture('pending',external,'link');
    assert.equal((await request('/api/auth_google_signup.php',{cookie:link.cookie})).body.mode,'link');
    for(let i=0;i<10;i++)await request('/api/auth_google_signup.php',{cookie:link.cookie,data:{csrf:link.csrf,password:'wrong'},status:401});
    await request('/api/auth_google_signup.php',{cookie:link.cookie,data:{csrf:link.csrf,password:'Google-Link-Test-2026!'},status:429});
    fixture('reset-attempts',external);
    const linked=await request('/api/auth_google_signup.php',{cookie:link.cookie,data:{csrf:link.csrf,password:'Google-Link-Test-2026!',User_Status:'Admin'}});
    const linkedCookie=linked.r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
    assert.equal((await request('/api/me.php',{cookie:linkedCookie})).body.user.status,'Editor');
    await request('/api/logout.php',{cookie:linkedCookie,data:{}});
    console.log('PASS external signup denial, third-party first-link password confirmation/rate limit and existing role/session preservation');
}
run().catch(e=>{console.error(e);console.error(errors);process.exitCode=1;}).finally(()=>{
    server.kill();
    for(const email of [school,external]){try{fixture('cleanup',email);}catch(e){console.error(e);process.exitCode=1;}}
    fs.rmSync(sessions,{recursive:true,force:true});
});
