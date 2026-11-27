// Real Chromium order dashboard and push-registration flows on a disposable
// mock database. Push SDK calls are replaced before page scripts execute.
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const chromePath=process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const temp=path.join(os.tmpdir(),'opencode');
const port=Number(process.env.ORDER_BROWSER_PORT||8296);
const cdp=Number(process.env.ORDER_BROWSER_CDP_PORT||9266);
const host='e-office.example';
const localBase=`http://127.0.0.1:${port}`;
const browserBase=`http://${host}:${port}`;
const database=`eoffice_orders_${process.pid}_test`;
if(!database.endsWith('_test'))throw Error('Only disposable test databases may be used');
const env={
    ...process.env,DB_DATABASE:database,APP_URL:browserBase,EOFFICE_MOCK_SERVICES:'true',
    ONESIGNAL_APP_ID:'synthetic-browser-app-id',
    EOFFICE_SETTINGS_KEY:crypto.randomBytes(32).toString('base64'),
    EOFFICE_STORAGE:path.join(temp,`eoffice-order-browser-${process.pid}`,'storage')
};

let server,chrome,socket,profile,users,pdf,databaseCreated=false,passed=0,sequence=0;
const pending=new Map(),exceptions=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function phpRun(args){
    const result=cp.spawnSync(php,args,{env,encoding:'utf8'});
    if(result.status!==0)throw Error(result.stdout+result.stderr);
    return result.stdout;
}
function fixture(action){return phpRun(['tests/order-email-fixture.php',action]);}
function pushTargets(userId){
    return JSON.parse(phpRun(['-r',`require 'config/push-subscriptions.php';echo json_encode(app_push_targets(${Number(userId)}));`]));
}
async function request(route,{as='staff',data,form,status=200}={}){
    const headers={};
    if(as)headers.Cookie=users[as].cookie;
    if(data)headers['Content-Type']='application/json';
    const response=await fetch(localBase+route,{
        method:data||form?'POST':'GET',headers,
        body:form||(data?JSON.stringify(data):undefined)
    });
    const text=await response.text();
    assert.equal(response.status,status,`${route}: ${text}`);
    return text?JSON.parse(text):null;
}
function send(method,params={}){
    const id=++sequence;
    return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},30000);
        pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});
        socket.send(JSON.stringify({id,method,params}));
    });
}
async function evaluate(expression){
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
}
async function until(expression){
    for(let i=0;i<200;i++){
        try{if(await evaluate(`(()=>{try{return (${expression});}catch{return false;}})()`))return;}
        catch{}
        await sleep(100);
    }
    throw Error(`Condition timed out: ${expression}`);
}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
async function startBrowser(){
    profile=fs.mkdtempSync(path.join(temp,'order-notification-browser-'));
    chrome=cp.spawn(chromePath,[
        '--headless=new',`--remote-debugging-port=${cdp}`,`--user-data-dir=${profile}`,
        '--no-first-run','--no-default-browser-check',
        `--host-resolver-rules=MAP ${host} 127.0.0.1,EXCLUDE localhost`,'about:blank'
    ],{stdio:'ignore'});
    let pages;
    for(let i=0;i<120;i++){
        try{pages=await fetch(`http://127.0.0.1:${cdp}/json`).then(response=>response.json());break;}
        catch{await sleep(100);}
    }
    assert.ok(pages,'Chromium must start');
    socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{
        socket.addEventListener('open',resolve,{once:true});
        socket.addEventListener('error',reject,{once:true});
    });
    socket.addEventListener('message',event=>{
        const message=JSON.parse(event.data);
        if(message.id&&pending.has(message.id)){
            const call=pending.get(message.id);pending.delete(message.id);
            message.error?call.reject(Error(JSON.stringify(message.error))):call.resolve(message.result);
        }
        if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails);
    });
    await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
        const listeners=new Map();let subscriptionId='qa-browser-subscription-01',optedIn=true;
        const subscription={
            get id(){return subscriptionId;},get optedIn(){return optedIn;},
            addEventListener(name,callback){listeners.set(name,callback);}
        };
        Object.defineProperty(window,'EOFFICE_MOCK_SERVICES',{
            configurable:true,enumerable:true,get(){return false;},set(value){window.__qaBackendMock=value;}
        });
        const deferred=[];
        deferred.push=function(callback){
            Array.prototype.push.call(this,callback);
            Promise.resolve().then(()=>callback({
                init:async options=>{window.__qaOneSignalInit=options;},
                User:{PushSubscription:subscription}
            })).catch(error=>{window.__qaOneSignalError=String(error?.message||error);});
            return this.length;
        };
        window.OneSignalDeferred=deferred;
        window.__qaRegistrationBodies=[];
        const nativeFetch=window.fetch.bind(window);
        window.fetch=(input,options={})=>{
            const url=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url,location.href);
            if(url.pathname==='/api/create_user_notification.php'&&options.body){
                try{window.__qaRegistrationBodies.push(JSON.parse(options.body));}catch{}
            }
            return nativeFetch(input,options);
        };
        window.__qaPush={
            subscription,
            setId(value){subscriptionId=value;listeners.get('change')?.();},
            setOptedIn(value){optedIn=value;listeners.get('change')?.();}
        };
    })();`});
    await send('Network.setCookie',{
        name:'User_Token',value:users.staff.cookie.split('=')[1].split(';')[0],
        url:browserBase,httpOnly:true
    });
}
async function run(){
    const seeded=JSON.parse(fixture('seed'));databaseCreated=true;users=seeded.users;pdf=Buffer.from(seeded.pdf,'base64');
    phpRun(['-r',"require 'config/push-subscriptions.php';app_push_subscriptions_migrate(app_pdo());"]);
    server=cp.spawn(php,['-S',`127.0.0.1:${port}`,'scripts/router.php'],{env,stdio:'ignore'});
    let ready=false;
    for(let i=0;i<100;i++){
        try{await fetch(localBase+'/api/me.php');ready=true;break;}
        catch{await sleep(100);}
    }
    assert.ok(ready,'mock PHP test server must start');

    const form=new FormData();
    for(const [key,value] of Object.entries({
        doc_number:`ORDER-BROWSER-${Date.now()}`,doc_name:'Synthetic browser order flow',
        doc_type:'คำสั่ง',doc_date_receive:'2026-11-20',
        'doc_file_name[]':'Synthetic PDF','file_id[]':'0'
    }))form.append(key,value);
    form.append('doc_upload[]',new Blob([pdf],{type:'application/pdf'}),'synthetic-order.pdf');
    const created=await request('/api/create_document.php',{as:'owner',form});
    const docId=created.doc_id;
    await request('/email_send/order_jobs.php',{as:'staff',data:{doc_id:docId,action:'enqueue'}});

    await startBrowser();
    await send('Page.navigate',{url:browserBase+'/index.php?view=send_email'});
    const moduleRoot="document.querySelector('.eoffice-module-host:not([hidden])')?.shadowRoot";
    await until(`window.eofficeSessionState?.status==='authenticated'&&${moduleRoot}?.getElementById('list-content')?.getAttribute('aria-busy')==='false'`);
    assert.equal(await evaluate('window.__qaBackendMock'),true,'PHP remains in mock mode while browser-only push code is exercised');
    assert.equal(await evaluate('window.EOFFICE_MOCK_SERVICES'),false,'push test override is confined to this browser page');

    await check('order dashboard loads a queued synthetic order and applies the status filter',async()=>{
        const state=await evaluate(`(()=>{const s=${moduleRoot},row=[...s.querySelectorAll('#rows tr')].find(row=>row.textContent.includes(${JSON.stringify(`ORDER-BROWSER-`)}));return {found:!!row,text:row?.textContent||'',busy:s.getElementById('list-content').getAttribute('aria-busy')};})()`);
        assert.equal(state.found,true,`synthetic order should appear: ${state.text}`);
        await evaluate(`(()=>{
            const s=${moduleRoot},filter=s.getElementById('state');
            filter.value='queued';filter.dispatchEvent(new Event('change',{bubbles:true}));
        })()`);
        await until(`${moduleRoot}.getElementById('state').value==='queued'&&${moduleRoot}.getElementById('list-content').getAttribute('aria-busy')==='false'`);
        assert.equal(await evaluate(`${moduleRoot}.getElementById('state').value`),'queued');
        assert.ok(await evaluate(`${moduleRoot}.getElementById('rows').textContent.includes('ORDER-BROWSER-')`));
    });

    await check('order detail accepts a registered recipient and reflects the saved result',async()=>{
        await evaluate(`${moduleRoot}.querySelector('#rows button[aria-label*="ORDER-BROWSER-"]').click()`);
        await until(`${moduleRoot}.getElementById('detail').open&&${moduleRoot}.getElementById('recipient-email').disabled===false`);
        await evaluate(`(()=>{
            const s=${moduleRoot},input=s.getElementById('recipient-email');
            input.value='alice@example.test';input.dispatchEvent(new Event('input',{bubbles:true}));
            s.getElementById('add-recipient').requestSubmit();
        })()`);
        await until(`${moduleRoot}.getElementById('recipient-rows').textContent.includes('alice@example.test')&&${moduleRoot}.getElementById('detail-message').textContent.length>0`);
        assert.equal(await evaluate(`${moduleRoot}.getElementById('recipient-rows').textContent.includes('alice@example.test')`),true);
        assert.equal(await evaluate(`${moduleRoot}.getElementById('recipient-email').value`),'','successful recipient write clears the form');
        await evaluate(`${moduleRoot}.getElementById('close-detail').click()`);
        await until(`${moduleRoot}.getElementById('detail').open===false`);
    });

    await check('push registration binds the synthetic subscription to the authenticated session and opt-out removes it',async()=>{
        await until('window.__qaOneSignalInit?.appId==="synthetic-browser-app-id"&&window.__qaRegistrationBodies.length===1');
        const first=await evaluate('window.__qaRegistrationBodies[0]');
        assert.deepEqual(first,{target_Id:'qa-browser-subscription-01',active:true,_expected_owner:users.staff.id});
        assert.deepEqual(pushTargets(users.staff.id),['qa-browser-subscription-01']);
        await evaluate('window.__qaPush.setOptedIn(false)');
        await until('window.__qaRegistrationBodies.length===2&&window.__qaRegistrationBodies[1].active===false');
        assert.deepEqual(pushTargets(users.staff.id),[],'opt-out removes only the session-bound synthetic target');
        await evaluate('window.__qaPush.setOptedIn(true)');
        await until('window.__qaRegistrationBodies.length===3&&window.__qaRegistrationBodies[2].active===true');
        assert.deepEqual(pushTargets(users.staff.id),['qa-browser-subscription-01']);
    });

    for(const width of [1440,768,390,320]){
        await check(`order dashboard fits ${width}px viewport`,async()=>{
            await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<700});
            const layout=await evaluate(`(()=>{const s=${moduleRoot}.querySelector('.order-dashboard'),r=s.getBoundingClientRect();return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,left:r.left,right:r.right};})()`);
            assert.ok(layout.left>=0&&layout.right<=width,JSON.stringify(layout));
            assert.ok(layout.scrollWidth<=layout.viewport,JSON.stringify(layout));
        });
    }
    assert.deepEqual(exceptions,[],'browser page must not throw uncaught JavaScript exceptions');
    console.log(`Order/notification browser: ${passed} checks passed`);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
    try{socket?.close();}catch{}
    chrome?.kill();server?.kill();
    if(databaseCreated){try{fixture('drop');}catch(error){console.error('QA database cleanup failed:',error.message);process.exitCode=1;}}
    try{fs.rmSync(path.dirname(env.EOFFICE_STORAGE),{recursive:true,force:true});}catch{}
    if(profile)try{fs.rmSync(profile,{recursive:true,force:true});}catch{}
});
