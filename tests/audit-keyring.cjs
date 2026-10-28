const assert=require('node:assert/strict'),cp=require('node:child_process'),crypto=require('node:crypto');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const port=Number(process.env.AUDIT_KEYRING_PORT||8212),base=`http://localhost:${port}`;
const env={...process.env,DB_DATABASE:`eoffice_orders_${process.pid}_test`,APP_URL:base,EOFFICE_MOCK_SERVICES:'true',EOFFICE_SETTINGS_KEY:crypto.randomBytes(32).toString('base64'),GEMINI_API_KEY:'synthetic-server-key-for-audit-tests'};
let server,created=false,users,passed=0;
function fixture(action){return cp.execFileSync(php,['tests/order-email-fixture.php',action],{env,encoding:'utf8'});}
function sql(source){return JSON.parse(cp.execFileSync(php,['-r',`require 'config/bootstrap.php'; if(!preg_match('/^eoffice_orders_\\d+_test$/D',app_settings()['database'])||!app_settings()['mock'])throw new RuntimeException('Disposable mock database required'); ${source}`],{env,encoding:'utf8'}));}
const logs=()=>sql("echo json_encode(app_pdo()->query('SELECT * FROM eoffice_audit_log ORDER BY id')->fetchAll());");
async function request(data,{as='admin',status=200}={}){const response=await fetch(base+'/email_send/ai_settings.php',{method:data?'POST':'GET',headers:{Cookie:users[as].cookie,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;}
async function action(name,data={}){const current=await request();return request({action:name,revision:current.settings.revision,...data});}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
async function run(){
    users=JSON.parse(fixture('seed')).users;created=true;
    server=cp.spawn(php,['-S',`localhost:${port}`,'scripts/router.php'],{env,stdio:'ignore'});
    let ready=false;for(let i=0;i<50;i++){try{await fetch(base+'/api/me.php');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready);
    let entry;
    const secret='synthetic-vault-key-for-audit-tests';
    await check('key add/test/activate/server/update/delete each appear in the Admin audit feed without secrets',async()=>{
        const added=await action('key_add',{label:'Synthetic audit reserve',api_key:secret,remind_days:30});entry=added.settings.keyring.keys.find(key=>key.label==='Synthetic audit reserve');assert.ok(entry);
        await action('key_test',{key_id:entry.id,model:'gemini-test'});
        await action('key_activate',{key_id:entry.id,model:'gemini-test',confirmed:true});
        await action('key_server',{model:'gemini-test',confirmed:true});
        await action('key_update',{key_id:entry.id,label:'Synthetic retired key',remind_days:60,key_enabled:false});
        await action('key_delete',{key_id:entry.id,confirmed:true});
        const history=logs();assert.deepEqual(history.map(row=>row.event),['email.key_add','email.key_test','email.key_activate','email.key_server','email.key_update','email.key_delete']);
        assert.ok(history.every(row=>row.actor_id===users.admin.id&&row.target_type==='api_key'&&row.outcome==='success'));
        assert.ok(history.filter(row=>row.event!=='email.key_server').every(row=>Number(row.target_id)===entry.id&&JSON.parse(row.metadata).reference===entry.reference));
        assert.equal(JSON.parse(history[3].metadata).reference,'server');
        const response=await fetch(base+'/management/get_audit_logs_api.php?category=email',{headers:{Cookie:users.admin.cookie}});const feed=await response.json();assert.equal(response.status,200);assert.equal(feed.total,6);assert.match(feed.data[0].label,/API Key/);
        for(const forbidden of [secret,env.GEMINI_API_KEY,'cipher','fingerprint','api_key_cipher'])assert.ok(!JSON.stringify(feed).includes(forbidden));
    });
    await check('rejected and unauthorized Key mutations never create successful audit events',async()=>{
        const before=logs(),current=await request();
        await request({action:'key_add',revision:current.settings.revision,api_key:secret,label:'Denied',remind_days:30},{as:'staff',status:403});
        await request({action:'key_add',revision:current.settings.revision-1,api_key:secret,label:'Stale',remind_days:30},{status:409});
        assert.deepEqual(logs(),before);
    });
    await check('audit failure rolls back vault changes and revision atomically',async()=>{
        const before=logs(),current=await request();
        sql("app_pdo()->exec(\"CREATE TRIGGER audit_reject BEFORE INSERT ON eoffice_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic audit failure'\");echo '{}';");
        try {await request({action:'key_add',revision:current.settings.revision,label:'Must rollback',api_key:secret,remind_days:30},{status:500});}
        finally {sql("app_pdo()->exec('DROP TRIGGER audit_reject');echo '{}';");}
        const after=await request();assert.equal(after.settings.revision,current.settings.revision);assert.deepEqual(after.settings.keyring,current.settings.keyring);assert.deepEqual(logs(),before);
    });
    console.log(`Audit Key vault: ${passed} groups passed`);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{server?.kill();if(created)try{fixture('drop');}catch(error){console.error(error);process.exitCode=1;}});
