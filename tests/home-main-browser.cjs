// Opt-in browser QA for the public/personal E-Office home against serve:test.
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const base=process.env.EOFFICE_QA_BROWSER_URL||'http://localhost:8198';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw Error('Home browser checks are local QA only');
const chromePath=process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port=Number(process.env.HOME_CDP_PORT||9230),folder=path.join(os.tmpdir(),'opencode');
if(!fs.existsSync(folder))throw Error('QA temporary parent missing');
const profile=fs.mkdtempSync(path.join(folder,'eoffice-home-browser-'));
const browser=cp.spawn(chromePath,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});

let socket,sequence=0,passed=0;
const pending=new Map();
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
    throw Error('Home UI condition timed out: '+expression);
}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
async function screenshot(name){
    if(!process.env.HOME_SCREENSHOT)return;
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    const target=path.join(folder,`home-${name}.png`);
    fs.writeFileSync(target,Buffer.from(shot.data,'base64'));
    console.log('SCREENSHOT '+target);
}

function fixtures(){
    return `(()=>{
        const original=window.fetch.bind(window);
        window.__qaHomeOriginalFetch=original;
        const json=value=>Promise.resolve(new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}}));
        const today=new Date();
        const day=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
        const month=day.slice(0,7);
        window.__qaHomeRequests=[];
        window.fetch=(input,init={})=>{
            const url=new URL(typeof input==='string'?input:input.url,location.href),method=(init.method||'GET').toUpperCase();
            if(url.pathname.endsWith('/api/get_data_public.php')){
                let body={};try{body=JSON.parse(init.body||'{}')}catch{}
                window.__qaHomeRequests.push({kind:'public',body});
                return json([
                    {doc_id:301,external_number:'12/2569',doc_number:'ศธ 123',doc_name:'ประกาศทดสอบหน้าแรก',doc_date:'27 พ.ย. 2569',doc_type:'External',doc_url:'',doc_url_name:'',doc_upload_path:[],Pagination:1,Total_Records:2},
                    {doc_id:300,external_number:'11/2569',doc_number:'ศธ 122',doc_name:'คำสั่งทดสอบระบบ',doc_date:'26 พ.ย. 2569',doc_type:'External',doc_url:'',doc_url_name:'',doc_upload_path:[],Pagination:1,Total_Records:2}
                ]);
            }
            if(url.pathname.endsWith('/api/official-travel.php')){
                return json({status:'success',today:day,month,
                    executives:[
                        {id:1,name:'ผู้อำนวยการ ทดสอบ',position:'director',photo_url:null},
                        {id:2,name:'รองผู้อำนวยการ ทดสอบ',position:'deputy_director',photo_url:null}
                    ],
                    entries:[{id:9,executive_id:2,status:'scheduled',start_date:day,end_date:day,start_time:'09:00',end_time:'16:00',subject:'ประชุมทดสอบ',place:'หน่วยงานทดสอบ'}],
                    today_entries:[{id:9,executive_id:2,status:'scheduled',start_date:day,end_date:day,start_time:'09:00',end_time:'16:00'}]});
            }
            if(url.pathname.endsWith('/api/inbox_summary.php')){
                let body={};try{body=JSON.parse(init.body||'{}')}catch{}
                window.__qaHomeRequests.push({kind:'summary',body});
                return json({status:'success',year:body.Year,counts:{total:8,pending:5,urgent:2,completed:3}});
            }
            if(url.pathname.endsWith('/api/get_data_received.php')){
                let body={};try{body=JSON.parse(init.body||'{}')}catch{}
                window.__qaHomeRequests.push({kind:'received',body});
                return json([
                    {doc_id:401,doc_number:'ศธ 200',doc_number_receive:'รับ 44/2569',doc_name:'หนังสือด่วนทดสอบหน้าแรก',doc_date:'27/11/2569 09:30',doc_date_receive:'27 พ.ย. 2569',doc_receive_from:'สำนักงานทดสอบ',send_from:'ผู้ส่งทดสอบ',status:'NotRead',status_urgent:'Urgent',requires_signature:true,is_signed:false,is_completed:false,doc_upload_path:[],doc_url:'',doc_url_name:''},
                    {doc_id:400,doc_number:'ศธ 199',doc_number_receive:'รับ 43/2569',doc_name:'หนังสือทั่วไปทดสอบหน้าแรก',doc_date:'26/11/2569 14:00',doc_date_receive:'26 พ.ย. 2569',doc_receive_from:'ฝ่ายทดสอบ',send_from:'ผู้ส่งทดสอบ',status:'NotRead',status_urgent:'Nomal',requires_signature:false,is_signed:false,is_completed:false,doc_upload_path:[],doc_url:'',doc_url_name:''}
                ]);
            }
            if(url.pathname.endsWith('/api/update_read_status.php'))return json({status:'success'});
            return original(input,init);
        };
    })()`;
}

async function run(){
    let targets;
    for(let i=0;i<100;i++){try{targets=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());break;}catch{await sleep(100);}}
    assert.ok(targets,'Home QA Chrome must start');
    socket=new WebSocket(targets.find(item=>item.type==='page').webSocketDebuggerUrl);
    await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
    socket.addEventListener('message',event=>{
        const message=JSON.parse(event.data);
        if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}
        if(message.method==='Page.javascriptDialogOpening')send('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});
    });
    await send('Page.enable');await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:fixtures()});
    await send('Page.navigate',{url:base+'/index.php'});
    await until("window.eofficeSessionState?.status==='guest' && document.getElementById('home-public-list').children.length===2");
    await until("document.getElementById('home-presence-list').children.length===2");

    await check('guest main is the default public landing without a forced login dialog',async()=>{
        assert.equal(await evaluate("location.search"),'?view=main');
        assert.equal(await evaluate("document.getElementById('home-guest').checkVisibility()"),true);
        assert.equal(await evaluate("document.getElementById('home-member').checkVisibility()"),false);
        assert.equal(await evaluate("document.getElementById('modalOverlay').classList.contains('active')"),false);
        assert.equal(await evaluate("document.getElementById('home-public-list').children.length"),2);
        assert.equal(await evaluate("document.getElementById('home-feedback').textContent"),'');
        const guestStatus=await evaluate("window.__qaHomeOriginalFetch('/api/inbox_summary.php',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({Year:'2569'})}).then(response=>response.status)");
        assert.equal(guestStatus,401,'guests must not read personal inbox totals');
    });

    await check('public orders and current-year request are rendered as safe actionable cards',async()=>{
        const request=await evaluate("window.__qaHomeRequests.find(item=>item.kind==='public').body");
        assert.ok(Number(request.Year)>=2566);
        assert.equal(request.limit,5);
        assert.equal(await evaluate("document.querySelector('#home-public-list .home-doc-card__title').textContent"),'ประกาศทดสอบหน้าแรก');
        await click('#home-public-list .home-doc-card');
        await until("document.getElementById('doc_detail').classList.contains('active')");
        assert.equal(await evaluate("document.getElementById('doc_row_2').textContent"),'ประกาศทดสอบหน้าแรก');
        await click('#closeDocDetail');
        await until("!document.getElementById('doc_detail').classList.contains('active')");
    });

    await check('executive presence uses scheduled travel for today',async()=>{
        assert.equal(await evaluate("document.getElementById('home-presence-summary').textContent"),'อยู่ 1 · ไม่อยู่ 1');
        assert.equal(await evaluate("document.querySelector('#home-presence-list .home-presence-person').dataset.presence"),'present');
        assert.equal(await evaluate("document.querySelector('#home-presence-list .home-presence-person:last-child').dataset.presence"),'away');
        assert.ok((await evaluate("document.querySelector('#home-presence-list .home-presence-person:last-child .home-presence-role').textContent")).includes('รอง'));
    });

    await check('guest receive action asks for login and remembers the pending action',async()=>{
        await click('#home-receive');
        await until("document.getElementById('modalOverlay').classList.contains('active')");
        assert.equal(await evaluate("sessionStorage.getItem('eoffice-post-login-action')"),'receive_document');
        await click('#closeIcon');
        await until("!document.getElementById('modalOverlay').classList.contains('active')");
        assert.equal(await evaluate("sessionStorage.getItem('eoffice-post-login-action')"),null);
    });

    await check('guest main fits desktop and mobile viewports without horizontal scrolling',async()=>{
        for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568}]){
            await send('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:viewport.width<700});
            await sleep(80);
            assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${viewport.width}px home must not overflow`);
        }
        await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await sleep(100);
        await screenshot('guest-mobile');
    });

    await check('guest who signs in from the receive action lands in the document form',async()=>{
        await click('#home-receive');
        await until("document.getElementById('modalOverlay').classList.contains('active')");
        assert.equal(await evaluate("sessionStorage.getItem('eoffice-post-login-action')"),'receive_document');
        const login=await evaluate(`fetch('/api/auth_login.php',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:'qa-recipient@siya.ac.th',password:'Review-Test-2026!'})}).then(response=>response.json())`);
        assert.equal(login.status,'success','Home QA login must succeed');
        await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
        await send('Page.reload',{ignoreCache:true});
        await until("window.eofficeSessionState?.status==='authenticated' && !document.getElementById('document-modal').classList.contains('hidden')");
        assert.equal(await evaluate("sessionStorage.getItem('eoffice-post-login-action')"),null,'post-login action must be consumed once');
        assert.equal(await evaluate("document.getElementById('home-member').checkVisibility()"),true,'member dashboard must render behind the receive form');
        await click('#close-modal-btn');
        await until("document.getElementById('document-modal').classList.contains('hidden')");
    });
    await until("document.getElementById('home-pending-list').children.length===2");
    await until("document.getElementById('home-stat-total').textContent==='8'");

    await check('authenticated main switches to personal summary and pending documents',async()=>{
        assert.equal(await evaluate("document.getElementById('home-guest').checkVisibility()"),false);
        assert.equal(await evaluate("document.getElementById('home-stat-pending').textContent"),'5');
        assert.equal(await evaluate("document.getElementById('home-stat-urgent').textContent"),'2');
        assert.equal(await evaluate("document.getElementById('home-stat-completed').textContent"),'3');
        assert.equal(await evaluate("document.querySelector('#home-pending-list .home-badge--urgent').textContent"),'ด่วน');
        const received=await evaluate("window.__qaHomeRequests.find(item=>item.kind==='received').body");
        assert.equal(received.Read_Status_find,'NotRead');
        assert.equal(received.limit,5);
        await screenshot('member-desktop');
    });

    await check('real summary API matches the existing inbox scope and completion counts',async()=>{
        const result=await evaluate(`(async()=>{
            const summary=await window.__qaHomeOriginalFetch('/api/inbox_summary.php',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({Year:'2569'})}).then(response=>response.json());
            const total=async filter=>{
                const rows=await window.__qaHomeOriginalFetch('/api/get_data_received.php',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({Year:'2569',Page_number:1,Read_Status_find:filter,limit:5})}).then(response=>response.json());
                return Array.isArray(rows)&&rows[0]?Number(rows[0].Total_Records):0;
            };
            return {summary,all:await total(''),pending:await total('NotRead'),completed:await total('Readed')};
        })()`);
        assert.equal(result.summary.status,'success');
        assert.equal(result.summary.counts.total,result.all);
        assert.equal(result.summary.counts.pending,result.pending);
        assert.equal(result.summary.counts.completed,result.completed);
        assert.equal(result.summary.counts.total,result.summary.counts.pending+result.summary.counts.completed);
    });

    await check('summary cards open the existing filtered inbox',async()=>{
        await click('[data-home-received="NotRead"]');
        await until("location.search==='?view=received' && document.getElementById('document-view').checkVisibility()");
        assert.equal(await evaluate("localStorage.getItem('read_status_change')"),'NotRead');
        await evaluate("showView('main','load')");
        await until("location.search==='?view=main' && document.getElementById('home-member').checkVisibility()");
    });

    await check('personal pending document opens the existing secure detail flow',async()=>{
        await until("document.getElementById('home-pending-list').children.length===2");
        await click('#home-pending-list .home-doc-card');
        await until("document.getElementById('doc_detail').classList.contains('active')");
        assert.equal(await evaluate("document.getElementById('doc_row_2').textContent"),'หนังสือด่วนทดสอบหน้าแรก');
        await click('#closeDocDetail');
        await until("!document.getElementById('doc_detail').classList.contains('active')");
    });

    await check('authenticated receive opens the existing document form without a login detour',async()=>{
        await click('#home-receive-card');
        await until("!document.getElementById('document-modal').classList.contains('hidden')");
        assert.equal(await evaluate("document.getElementById('modalOverlay').classList.contains('active')"),false);
        assert.equal(await evaluate("sessionStorage.getItem('eoffice-post-login-action')"),null);
        await click('#close-modal-btn');
        await until("document.getElementById('document-modal').classList.contains('hidden')");
    });

    await check('authenticated main fits desktop and mobile viewports',async()=>{
        for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568}]){
            await send('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:viewport.width<700});
            await sleep(80);
            assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${viewport.width}px member home must not overflow`);
        }
    });

    console.log(`Home browser checks: ${passed} passed`);
}

run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    socket?.close();
    browser.kill();
    await new Promise(resolve=>browser.exitCode===null?browser.once('exit',resolve):resolve());
    try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:2});}catch{}
});
