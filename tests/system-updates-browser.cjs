// Opt-in browser QA for the authenticated system-updates module with a synthetic release feed.
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const base=process.env.EOFFICE_QA_BROWSER_URL||'http://localhost:8198';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw Error('System-updates browser checks are local QA only');
const chromePath=process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port=Number(process.env.SYSTEM_UPDATES_CDP_PORT||9232),folder=path.join(os.tmpdir(),'opencode');
if(!fs.existsSync(folder))throw Error('QA temporary parent missing');
const profile=fs.mkdtempSync(path.join(folder,'eoffice-system-updates-browser-'));
const browser=cp.spawn(chromePath,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});

let socket,sequence=0,passed=0;
const pending=new Map(),exceptions=[];
let feedRequests=0,failNextFeedRequest=false;
const feed=[
    {id:'qa-release-current',date:'2026-11-19',version:'QA.1',title:'Synthetic release <img src=x>',summary:'Release summary <script>window.__qaInjected=true</script>',added:['Added: <b>synthetic</b>'],improved:['Improved: responsive notice'],fixed:['Fixed: QA-only issue'],commits:[{hash:'a'.repeat(40),category:'fixed',summary:'Synthetic commit <img src=x onerror=window.__qaInjected=true>'}]},
    {id:'qa-release-older',date:'2026-11-18',title:'Older synthetic release',summary:'Earlier notes',added:[],improved:['Older improvement'],fixed:[],commits:[]}
];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function send(method,params={}) {
    const id=++sequence;
    return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},30000);
        pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});
        socket.send(JSON.stringify({id,method,params}));
    });
}
async function evaluate(expression) {
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
}
async function until(expression) {
    for(let i=0;i<150;i++){if(await evaluate(`(()=>{try{return (${expression});}catch{return false;}})()`))return;await sleep(100);}
    throw Error('System-updates UI condition timed out: '+expression);
}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
const root="document.querySelector('.eoffice-module-host:not([hidden])').shadowRoot";

async function run(){
    let targets;
    for(let i=0;i<100;i++){try{targets=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());break;}catch{await sleep(100);}}
    assert.ok(targets,'System-updates QA Chrome must start');
    socket=new WebSocket(targets.find(item=>item.type==='page').webSocketDebuggerUrl);
    await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
    socket.addEventListener('message',event=>{
        const message=JSON.parse(event.data);
        if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}
        if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails);
        if(message.method==='Fetch.requestPaused'){
            const request=message.params,url=new URL(request.request.url),isFeed=url.pathname.endsWith('/data/system-updates.json');
            let params={requestId:request.requestId},method='Fetch.continueRequest';
            if(isFeed){
                feedRequests++;
                const failed=failNextFeedRequest;
                failNextFeedRequest=false;
                method='Fetch.fulfillRequest';
                params={...params,responseCode:failed?503:200,
                    responseHeaders:[{name:'Content-Type',value:'application/json; charset=utf-8'}],
                    body:Buffer.from(failed?'{}':JSON.stringify(feed)).toString('base64')};
            }
            send(method,params).catch(error=>console.error('CDP intercepted request failed:',error.message));
        }
    });
    await send('Page.enable');await send('Runtime.enable');
    await send('Fetch.enable',{patterns:[{urlPattern:'*system-updates.json*',requestStage:'Request'}]});
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:base+'/index.php?view=public'});
    await until("window.eofficeSessionState?.status==='guest'&&typeof showView==='function'&&!!window.eofficeModuleRouter");
    assert.equal(await evaluate('window.EOFFICE_MOCK_SERVICES'),true,'Updates browser checks require serve:test mock services');
    assert.equal(await evaluate(`fetch('/api/auth_login.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'qa-admin@siya.ac.th',password:'Review-Test-2026!'})}).then(r=>r.status)`),200,'synthetic admin session must be created in the isolated test schema');
    await evaluate("window.dispatchEvent(new Event('eoffice:permissions-changed'))");
    await until("window.eofficeSessionState?.status==='authenticated'");
    await evaluate("showView('updates')");
    await until("location.search==='?view=updates'&&!!document.querySelector('.eoffice-module-host:not([hidden])')");
    try{await until(`${root}?.getElementById('updates-list')?.children.length===2 && ${root}.getElementById('updates-list').getAttribute('aria-busy')==='false'`);}
    catch(error){
        const diagnostic=await evaluate(`(()=>{const host=document.querySelector('.eoffice-module-host:not([hidden])'),s=host?.shadowRoot,list=s?.getElementById('updates-list'),feedback=s?.getElementById('updates-feedback');return {url:location.href,host:!!host,moduleStatus:document.querySelector('.eoffice-module-status')?.textContent||'',list:!!list,count:list?.children.length,busy:list?.getAttribute('aria-busy'),feedback:feedback?.textContent,feedRequests:${feedRequests},hasService:!!window.eofficeSystemUpdates,exceptions:${JSON.stringify(exceptions)}};})()`);
        throw Error(error.message+' diagnostic='+JSON.stringify(diagnostic));
    }

    await check('latest and older releases render as safe text with expandable commit details and a read marker',async()=>{
        const rendered=await evaluate(`(()=>{const s=${root},list=s.getElementById('updates-list'),cards=[...list.children],latest=cards[0],details=latest.querySelector('details');return {
            titles:cards.map(card=>card.querySelector('h2').textContent),
            summary:latest.querySelector('.update-summary').textContent,
            hasInjected:!!latest.querySelector('img,script,b'),
            date:latest.querySelector('time').dateTime,
            latest:!!latest.querySelector('.update-latest'),
            busy:list.getAttribute('aria-busy'),
            detailsOpen:details.open,
            detailsSummary:details.querySelector('summary').textContent,
            read:localStorage.getItem('eoffice:system-updates:read:'+window.eofficeUser.id+':'+JSON.stringify('qa-release-current')),
            badgeHidden:document.getElementById('system-updates-badge')?.hidden,
            documentHidden:document.hidden,userId:window.eofficeUser?.id,
            sessionStatus:window.eofficeSessionState?.status,hasReadService:typeof window.eofficeSystemUpdates?.markRead==='function'
        };})()`);
        const {badgeHidden,documentHidden,userId,sessionStatus,hasReadService,...visibleContent}=rendered;
        assert.deepEqual(visibleContent,{
            titles:['Synthetic release <img src=x>','Older synthetic release'],
            summary:'Release summary <script>window.__qaInjected=true</script>',
            hasInjected:false,date:'2026-11-19',latest:true,busy:'false',detailsOpen:false,
            detailsSummary:'รายละเอียดแต่ละ commit (1 รายการ)',read:'1'
        });
        assert.equal(documentHidden,false,'updates are visible when the page marks its latest release read');
        assert.ok(Number(userId)>0&&sessionStatus==='authenticated');
        assert.equal(hasReadService,true);
        assert.equal(badgeHidden,true,'reading updates in the module should also clear the shell sidebar badge');
        await evaluate(`${root}.querySelector('.update-card details summary').click()`);
        assert.equal(await evaluate(`${root}.querySelector('.update-card details').open`),true);
        assert.equal(await evaluate(`${root}.querySelector('.update-card details code').title`),'a'.repeat(40));
        assert.equal(await evaluate(`${root}.querySelector('.update-card details li span').textContent`),' — Synthetic commit <img src=x onerror=window.__qaInjected=true>');
        assert.equal(await evaluate('window.__qaInjected===true'),false,'release text must never execute as markup');
    });

    await check('feed failure preserves existing releases and explicit retry recovers',async()=>{
        failNextFeedRequest=true;
        await evaluate(`${root}.getElementById('updates-retry').click()`);
        await until(`${root}.getElementById('updates-feedback').textContent.includes('โหลดประวัติอัปเดตไม่สำเร็จ')&&${root}.getElementById('updates-retry').hidden===false`);
        assert.equal(await evaluate(`${root}.getElementById('updates-list').children.length`),2,'failed refresh should retain the last rendered feed');
        assert.equal(await evaluate(`${root}.getElementById('updates-list').getAttribute('aria-busy')`),'false');
        await evaluate(`${root}.getElementById('updates-retry').click()`);
        await until(`${root}.getElementById('updates-retry').hidden===true&&${root}.getElementById('updates-feedback').hidden===true&&${root}.getElementById('updates-list').getAttribute('aria-busy')==='false'`);
        assert.equal(await evaluate(`${root}.getElementById('updates-list').children.length`),2);
        assert.ok(feedRequests>=3,'initial feed load and both explicit refresh attempts should reach the synthetic endpoint');
    });

    for(const viewport of [
        {name:'desktop',width:1440,height:900},
        {name:'tablet',width:768,height:1024},
        {name:'mobile',width:390,height:844},
        {name:'small mobile',width:320,height:568},
    ]){
        await check(`${viewport.name} updates list fits without horizontal overflow`,async()=>{
            await send('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:viewport.width<700});
            await until(`innerWidth===${viewport.width}`);await sleep(100);
            const layout=await evaluate(`(()=>{const s=${root},page=s.querySelector('.updates-page'),card=s.querySelector('.update-card'),p=page.getBoundingClientRect(),c=card.getBoundingClientRect();return {pageLeft:p.left,pageRight:p.right,cardLeft:c.left,cardRight:c.right,viewport:innerWidth,verticalDocumentOverflow:document.documentElement.scrollWidth>innerWidth,cardScrollWidth:card.scrollWidth,cardClientWidth:card.clientWidth};})()`);
            assert.ok(layout.pageLeft>=0&&layout.pageRight<=viewport.width,`${viewport.name} page bounds: ${JSON.stringify(layout)}`);
            assert.ok(layout.cardLeft>=0&&layout.cardRight<=viewport.width,`${viewport.name} card bounds: ${JSON.stringify(layout)}`);
            assert.equal(layout.verticalDocumentOverflow,false,`${viewport.name} updates page must not scroll horizontally`);
            assert.equal(layout.cardScrollWidth<=layout.cardClientWidth,true,`${viewport.name} card content must wrap within its card`);
        });
    }
    console.log(`System-updates browser checks: ${passed} passed`);
}

run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    socket?.close();
    browser.kill();
    await new Promise(resolve=>browser.exitCode===null?browser.once('exit',resolve):resolve());
    try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:2});}catch{}
});
