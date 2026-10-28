// Real Chromium checks against a disposable database and mock services.
const assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const port=Number(process.env.AUDIT_BROWSER_PORT||8208),cdpPort=Number(process.env.AUDIT_CDP_PORT||9238),base=`http://localhost:${port}`;
const env={...process.env,DB_DATABASE:`eoffice_members_${process.pid}_test`,APP_URL:base,EOFFICE_MOCK_SERVICES:'true',EOFFICE_MEMBER_VERSION_KEY:crypto.randomBytes(32).toString('base64')};
const parent=path.join(os.tmpdir(),'opencode');if(!fs.existsSync(parent))throw Error('Missing temporary parent');
let server,browser,socket,created=false,profile,users,id=0,passed=0;const pending=new Map(),exceptions=[];
function cli(file,action){return cp.execFileSync(php,[file,action],{env,encoding:'utf8'});}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function send(method,params={}){const key=++id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout '+method));},30000);pending.set(key,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});socket.send(JSON.stringify({id:key,method,params}));});}
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function until(expression){for(let i=0;i<150;i++){if(await evaluate(`(()=>{try{return (${expression});}catch{return false;}})()`))return;await sleep(100);}throw Error('Condition timeout '+expression);}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
const root="document.querySelector('.eoffice-module-host:not([hidden])').shadowRoot";
async function run(){
    users=JSON.parse(cli('tests/member-fixture.php','seed'));created=true;cli('tests/audit-fixture.php','setup');cli('tests/audit-fixture.php','samples');
    server=cp.spawn(php,['-S',`localhost:${port}`,'scripts/router.php'],{env,stdio:'ignore'});
    for(let i=0;i<50;i++){try{await fetch(base+'/api/me.php');break;}catch{await sleep(100);}}
    profile=fs.mkdtempSync(path.join(parent,'audit-browser-'));
    browser=cp.spawn(process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new',`--remote-debugging-port=${cdpPort}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
    let targets;for(let i=0;i<100;i++){try{targets=await fetch(`http://127.0.0.1:${cdpPort}/json`).then(r=>r.json());break;}catch{await sleep(100);}}assert.ok(targets);
    socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
    socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const item=pending.get(message.id);pending.delete(message.id);message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result);}if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails);});
    await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await send('Network.setCookie',{name:'User_Token',value:users.admin.cookie.split('=')[1],url:base,httpOnly:true});
    await send('Page.navigate',{url:base+'/index.php?view=audit_logs'});
    await until(`window.eofficeSessionState?.status==='authenticated' && ${root}.getElementById('audit-results').getAttribute('aria-busy')==='false' && !document.querySelector('.eoffice-module-status')`);
    await check('Admin opens audit module inside the persistent shell and unsafe-looking names stay text',async()=>{
        assert.equal(await evaluate(`!!${root}.querySelector('#audit-rows img')`),false);
        assert.match(await evaluate(`${root}.getElementById('audit-rows').textContent`),/<img src=x/);
        assert.equal(await evaluate("getComputedStyle(document.getElementById('group_audit_logs')).display"),'block');
        assert.equal(await evaluate("document.getElementById('menu-audit-logs').classList.contains('bg-indigo-700')"),true);
        assert.equal(await evaluate('window.eofficeModuleHasChanges()'),false);
        assert.equal(await evaluate(`${root}.querySelectorAll('#filters select[name=category] option').length`),9);
        await evaluate(`${root}.querySelector('details summary').click()`);assert.equal(await evaluate(`${root}.querySelector('details').open`),true);
    });
    await check('search/date filters and clearing work without marking the module dirty',async()=>{
        await evaluate(`(()=>{const f=${root}.getElementById('filters');f.elements.search.value='100%_!';f.elements.search.dispatchEvent(new Event('input',{bubbles:true}));f.elements.from.value='2024-01-02';f.elements.to.value='2024-01-02';f.requestSubmit();})()`);
        await until(`${root}.getElementById('audit-feedback').textContent.includes('พบ 1 รายการ')`);
        assert.equal(await evaluate('window.eofficeModuleHasChanges()'),false);
        await evaluate(`${root}.querySelector('#filters button[type=reset]').click()`);
        await until(`${root}.getElementById('audit-feedback').textContent.includes('พบ 2 รายการ')`);
    });
    await check('revisiting audit refreshes new activity while retaining the filter',async()=>{
        await evaluate(`(()=>{const f=${root}.getElementById('filters');f.elements.search.value='100%_!';f.requestSubmit();})()`);
        await until(`${root}.getElementById('audit-results').getAttribute('aria-busy')==='false'`);
        await evaluate("showView('groups')");await until("location.search==='?view=groups' && !document.querySelector('.eoffice-module-status')");
        cli('tests/audit-fixture.php','samples');
        await evaluate("showView('audit_logs')");await until(`${root}.getElementById('audit-feedback').textContent.includes('พบ 4 รายการ')`);
        assert.equal(await evaluate(`${root}.getElementById('filters').elements.search.value`),'100%_!');
    });
    await check('mobile layout keeps the page inside the viewport with a horizontally scrollable table',async()=>{
        for(const width of [390,320]){
            await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});
            assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
            assert.equal(await evaluate(`getComputedStyle(${root}.getElementById('audit-results')).overflowX`),'auto');
        }
        if(process.env.EOFFICE_QA_SCREENSHOTS==='1'){const image=await send('Page.captureScreenshot',{format:'png'});const file=path.join(parent,'eoffice-audit-mobile.png');fs.writeFileSync(file,Buffer.from(image.data,'base64'));console.log('Screenshot: '+file);}
    });
    await check('a stalled history request times out, releases loading state and permits refresh recovery',async()=>{
        await evaluate(`(()=>{window.__auditFetch=window.fetch;window.__auditTimeout=AbortSignal.timeout;AbortSignal.timeout=ms=>window.__auditTimeout.call(AbortSignal,ms===30000?50:ms);window.fetch=(input,options)=>String(input).includes('get_audit_logs_api.php')?new Promise((resolve,reject)=>{if(options.signal.aborted)reject(options.signal.reason);else options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});}):window.__auditFetch(input,options);${root}.getElementById('audit-refresh').click();})()`);
        await until(`${root}.getElementById('audit-feedback').textContent.includes('ใช้เวลานานเกินไป') && ${root}.getElementById('audit-results').getAttribute('aria-busy')==='false'`);
        await evaluate(`window.fetch=window.__auditFetch;AbortSignal.timeout=window.__auditTimeout;${root}.getElementById('audit-refresh').click()`);
        await until(`${root}.getElementById('audit-feedback').textContent.includes('พบ 4 รายการ')`);
    });
    await check('revoked Admin access hides cached audit content and its menu',async()=>{
        await send('Network.setCookie',{name:'User_Token',value:users.basic.cookie.split('=')[1],url:base,httpOnly:true});
        await evaluate("window.dispatchEvent(new Event('focus'))");
        await until("window.eofficeSessionState?.user?.id==="+users.basic.id);
        assert.equal(await evaluate("getComputedStyle(document.getElementById('group_audit_logs')).display"),'none');
        assert.equal(await evaluate("[...document.querySelectorAll('.eoffice-module-host:not([hidden])')].some(host=>!!host.shadowRoot?.getElementById('audit-title'))"),false);
        assert.equal(await evaluate("fetch('/management/get_audit_logs_api.php').then(r=>r.status)"),403);
    });
    assert.deepEqual(exceptions,[]);console.log(`Audit browser: ${passed} groups passed`);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    if(socket?.readyState===WebSocket.OPEN)try{await send('Browser.close');}catch{}socket?.close();browser?.kill();server?.kill();
    if(created)try{cli('tests/member-fixture.php','drop');}catch(error){console.error(error);process.exitCode=1;}
});
