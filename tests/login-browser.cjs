// Opt-in browser QA for guest sign-in and registration against serve:test.
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const base=process.env.EOFFICE_QA_BROWSER_URL||'http://localhost:8198';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw Error('Login browser checks are local QA only');
const chromePath=process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port=Number(process.env.LOGIN_CDP_PORT||9228),folder=path.join(os.tmpdir(),'opencode');
if(!fs.existsSync(folder))throw Error('QA temporary parent missing');
const profile=fs.mkdtempSync(path.join(folder,'eoffice-login-browser-'));
const browser=cp.spawn(chromePath,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});

let socket,sequence=0,passed=0;
const pending=new Map(),observed=[];
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
    throw Error('Login UI condition timed out: '+expression);
}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
function note(ok,message){if(!ok){observed.push(message);console.log('OBSERVED '+message);}}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);}

async function run(){
    let targets;
    for(let i=0;i<100;i++){try{targets=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());break;}catch{await sleep(100);}}
    assert.ok(targets,'Login QA Chrome must start');
    socket=new WebSocket(targets.find(item=>item.type==='page').webSocketDebuggerUrl);
    await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
    socket.addEventListener('message',event=>{
        const message=JSON.parse(event.data);
        if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}
        if(message.method==='Page.javascriptDialogOpening')send('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});
    });
    await send('Page.enable');await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
        const original=window.fetch.bind(window);
        window.__qaLoginRequests=[];window.__qaRegisterRequests=[];
        window.fetch=(input,init={})=>{
            const url=new URL(typeof input==='string'?input:input.url,location.href),method=(init.method||'GET').toUpperCase();
            if(url.pathname==='/api/auth_login.php'&&method==='POST'){
                let data={};try{data=JSON.parse(init.body||'{}')}catch{}
                window.__qaLoginRequests.push(data);
                return Promise.resolve(new Response(JSON.stringify({message:'synthetic <img src=x onerror=window.__qaInjected=true>'}),{status:401,headers:{'Content-Type':'application/json'}}));
            }
            if(url.pathname==='/api/register.php'&&method==='POST'){
                const data=Object.fromEntries(init.body.entries());window.__qaRegisterRequests.push(data);
                return Promise.resolve(new Response(JSON.stringify({status:'success'}),{status:200,headers:{'Content-Type':'application/json'}}));
            }
            return original(input,init);
        };
    })()`});
    await send('Page.navigate',{url:base+'/index.php?view=public'});
    await until("window.eofficeSessionState?.status==='guest'&&typeof window.eofficeSessionState==='object'&&document.getElementById('openModal')?.checkVisibility()");
    assert.equal(await evaluate('window.EOFFICE_MOCK_SERVICES'),true,'Login browser checks require serve:test mock services');

    await check('guest can open sign-in and empty credentials are blocked by native validation',async()=>{
        await click('#openModal');
        await until("document.getElementById('modalOverlay').classList.contains('active')");
        assert.equal(await evaluate("document.body.style.overflow"),'hidden','opening sign-in should lock background scrolling');
        await click('#loginForm button[type=\"submit\"]');
        assert.equal(await evaluate('window.__qaLoginRequests.length'),0,'empty sign-in must not call the server');
        assert.equal(await evaluate("document.getElementById('Username').validity.valueMissing"),true);
    });

    await check('failed sign-in displays server text safely without injecting markup',async()=>{
        await evaluate(`document.getElementById('Username').value='synthetic-user@siya.ac.th';document.getElementById('user_password').value='synthetic-password';document.getElementById('loginForm').requestSubmit()`);
        await until("document.getElementById('login_status').textContent.includes('synthetic <img')");
        assert.deepEqual(await evaluate('window.__qaLoginRequests'),[{username:'synthetic-user@siya.ac.th',password:'synthetic-password'}]);
        assert.equal(await evaluate("document.getElementById('login_status').querySelector('img')===null&&window.__qaInjected!==true"),true);
    });

    await check('Escape closes the sign-in dialog and restores background scrolling',async()=>{
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await sleep(150);
        const state=await evaluate("({active:document.getElementById('modalOverlay').classList.contains('active'),overflow:document.body.style.overflow})");
        note(!state.active,'Escape leaves the sign-in dialog open');
        note(state.overflow!=='hidden','Escape leaves background scrolling locked');
        if(state.active)await click('#closeIcon');
        assert.equal(await evaluate("document.getElementById('modalOverlay').classList.contains('active')"),false,'close control should recover the browser after the Escape check');
    });

    await check('registration validates consent and renders the synthetic success state',async()=>{
        await click('#openModal');await until("document.getElementById('modalOverlay').classList.contains('active')");
        await click('#register_btn');
        assert.equal(await evaluate("document.getElementById('login_part').style.display"),'none');
        assert.equal(await evaluate("document.getElementById('register_part').checkVisibility()"),true);
        await evaluate(`document.getElementById('register_email').value='synthetic-registration';document.getElementById('register_name').value='Synthetic QA'`);
        await click('#btn_submit_register');
        assert.equal(await evaluate('window.__qaRegisterRequests.length'),0,'registration without consent must not submit');
        await evaluate("document.getElementById('checkbox_agreement').checked=true;document.getElementById('registerForm').requestSubmit()");
        await until("document.getElementById('register_part_text').textContent.includes('สมัครสมาชิกสำเร็จ')");
        const request=await evaluate('window.__qaRegisterRequests[0]');
        assert.equal(request.register_email,'synthetic-registration@siya.ac.th','registration should normalize the school email suffix');
        assert.equal(request.register_name,'Synthetic QA');
        await click('#closeIcon');
        assert.equal(await evaluate("document.getElementById('modalOverlay').classList.contains('active')"),false);
    });

    for(const viewport of [
        {name:'desktop',width:1440,height:900},
        {name:'tablet',width:768,height:1024},
        {name:'mobile',width:390,height:844},
        {name:'small mobile',width:320,height:568},
    ]){
        await check(`${viewport.name} sign-in and registration controls stay within the viewport`,async()=>{
            await send('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:viewport.width<700});
            await until(`innerWidth===${viewport.width}&&matchMedia('(min-width: 64rem)').matches===${viewport.width>=1024}`);
            await sleep(100);
            if(viewport.width<1024){
                if(await evaluate("document.getElementById('sidebar').dataset.sidebarOpen!=='true'"))await click('#menu-toggle');
                await until("document.getElementById('sidebar').dataset.sidebarOpen==='true'");
            }
            await click('#openModal');await until("document.getElementById('modalOverlay').classList.contains('active')");
            const signIn=await evaluate(`(()=>{const c=document.querySelector('#modalOverlay > div').getBoundingClientRect();return {left:c.left,right:c.right,bottom:c.bottom,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
            assert.ok(signIn.left>=0&&signIn.right<=viewport.width,`${viewport.name} sign-in box should fit horizontally: ${JSON.stringify(signIn)}`);
            assert.equal(signIn.overflow,false,`${viewport.name} sign-in must not introduce horizontal scrolling`);
            await click('#register_btn');
            const registration=await evaluate(`(()=>{const c=document.querySelector('#modalOverlay > div'),r=c.getBoundingClientRect(),submit=document.getElementById('btn_submit_register').getBoundingClientRect();return {top:r.top,bottom:r.bottom,clientHeight:c.clientHeight,scrollHeight:c.scrollHeight,submitBottom:submit.bottom,viewport:innerHeight};})()`);
            note(registration.top>=0&&registration.bottom<=viewport.height&&registration.submitBottom<=viewport.height,`${viewport.name} registration content is clipped: ${JSON.stringify(registration)}`);
            if(viewport.width===390){
                await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
                await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
                await until("!document.getElementById('modalOverlay').classList.contains('active')");
                assert.equal(await evaluate("document.getElementById('sidebar').dataset.sidebarOpen==='true'&&document.body.style.overflow==='hidden'"),true,'Escape should close the dialog before the still-open mobile drawer');
                await click('#openModal');await until("document.getElementById('modalOverlay').classList.contains('active')");
                await click('#closeIcon');
            }else await click('#closeIcon');
            if(viewport.width<1024)note(await evaluate("document.body.style.overflow==='hidden'"),`${viewport.name} closing sign-in unlocks the still-open navigation drawer`);
            if(viewport.width<1024&&await evaluate("document.getElementById('sidebar').dataset.sidebarOpen==='true'"))await click('#menu-toggle');
        });
    }
    console.log(`Login browser checks: ${passed} passed`);
    if(observed.length)throw Error(`Confirmed login UI regressions: ${observed.join('; ')}`);
}

run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    socket?.close();
    browser.kill();
    await new Promise(resolve=>browser.exitCode===null?browser.once('exit',resolve):resolve());
    try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:2});}catch{}
});
