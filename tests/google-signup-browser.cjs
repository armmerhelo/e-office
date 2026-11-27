// Opt-in browser QA for Google signup/link screens with synthetic profile and API responses.
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const base=process.env.EOFFICE_QA_BROWSER_URL||'http://localhost:8198';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw Error('Google signup browser checks are local QA only');
const chromePath=process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port=Number(process.env.GOOGLE_SIGNUP_CDP_PORT||9231),folder=path.join(os.tmpdir(),'opencode');
if(!fs.existsSync(folder))throw Error('QA temporary parent missing');
const profile=fs.mkdtempSync(path.join(folder,'eoffice-google-signup-browser-'));
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
    throw Error('Google signup UI condition timed out: '+expression);
}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}

async function run(){
    let targets;
    for(let i=0;i<100;i++){try{targets=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());break;}catch{await sleep(100);}}
    assert.ok(targets,'Google signup QA Chrome must start');
    socket=new WebSocket(targets.find(item=>item.type==='page').webSocketDebuggerUrl);
    await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
    socket.addEventListener('message',event=>{
        const message=JSON.parse(event.data);
        if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}
    });
    await send('Page.enable');await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
        const original=window.fetch.bind(window);
        window.__qaGoogleProfileReads=[];window.__qaGoogleSubmissions=[];
        window.__qaGoogleNext={status:400,body:{message:'synthetic <img src=x onerror=window.__qaGoogleInjected=true>'}};
        window.__qaGoogleRelease=null;
        window.fetch=(input,init={})=>{
            const url=new URL(typeof input==='string'?input:input.url,location.href),method=(init.method||'GET').toUpperCase();
            if(url.pathname==='/api/auth_google_signup.php'&&method==='GET'){
                const mode=new URLSearchParams(location.search).get('qa_mode')==='link'?'link':'signup';
                window.__qaGoogleProfileReads.push(mode);
                return Promise.resolve(new Response(JSON.stringify({
                    mode,email:mode==='link'?'qa-google-existing@example.org':'qa-google-user@siya.ac.th',
                    name:'Synthetic Google User',csrf:'synthetic-google-csrf'
                }),{status:200,headers:{'Content-Type':'application/json'}}));
            }
            if(url.pathname==='/api/auth_google_signup.php'&&method==='POST'){
                let body={};try{body=JSON.parse(init.body||'{}')}catch{}
                const mode=new URLSearchParams(location.search).get('qa_mode')==='link'?'link':'signup';
                window.__qaGoogleSubmissions.push({mode,body});
                return new Promise(resolve=>{window.__qaGoogleRelease=()=>resolve(new Response(JSON.stringify(window.__qaGoogleNext.body),{status:window.__qaGoogleNext.status,headers:{'Content-Type':'application/json'}}));});
            }
            return original(input,init);
        };
    })()`});
    await send('Page.navigate',{url:base+'/index.php?google_login=signup&qa_mode=signup'});
    await until("document.getElementById('google_signup_part')?.hidden===false&&document.getElementById('head_login')?.textContent==='ลงทะเบียนด้วย Google'");
    assert.equal(await evaluate('window.EOFFICE_MOCK_SERVICES'),true,'Google signup browser checks require serve:test mock services');

    await check('school signup requires name and consent, posts the synthetic profile, and safely shows API errors',async()=>{
        assert.equal(await evaluate("document.getElementById('google_signup_email').textContent"),'qa-google-user@siya.ac.th');
        await evaluate("document.getElementById('google_signup_name').value=''");
        await evaluate("document.getElementById('google_signup_form').requestSubmit()");
        assert.equal(await evaluate('window.__qaGoogleSubmissions.length'),0,'missing name must be blocked before POST');
        await evaluate("document.getElementById('google_signup_name').value='Synthetic QA User';document.getElementById('google_signup_form').requestSubmit()");
        assert.equal(await evaluate('window.__qaGoogleSubmissions.length'),0,'missing consent must be blocked before POST');
        await evaluate("document.getElementById('google_signup_consent').checked=true;document.getElementById('google_signup_form').requestSubmit()");
        await until("typeof window.__qaGoogleRelease==='function'");
        assert.equal(await evaluate("document.getElementById('google_signup_submit').disabled"),true,'submit is locked while the response is pending');
        await evaluate('window.__qaGoogleRelease()');
        await until("document.getElementById('google_signup_status').textContent.includes('synthetic <img')");
        const submission=await evaluate('window.__qaGoogleSubmissions[0]');
        assert.deepEqual(submission,{mode:'signup',body:{name:'Synthetic QA User',consent:true,csrf:'synthetic-google-csrf'}});
        assert.equal(await evaluate("document.getElementById('google_signup_status').querySelector('img')===null&&window.__qaGoogleInjected!==true"),true,'API error must be rendered as text');
        assert.equal(await evaluate("document.getElementById('google_signup_submit').disabled"),false,'failed request can be retried');
    });

    await check('signup rejects an off-origin redirect without navigating away',async()=>{
        await evaluate("window.__qaGoogleNext={status:200,body:{redirect_url:'https://attacker.example/steal-session'}};document.getElementById('google_signup_form').requestSubmit()");
        await until("typeof window.__qaGoogleRelease==='function'");
        await evaluate('window.__qaGoogleRelease()');
        await until("document.getElementById('google_signup_status').textContent==='URL ปลายทางไม่ถูกต้อง'");
        assert.equal(new URL(await evaluate('location.href')).origin,new URL(base).origin);
        assert.equal(await evaluate("document.getElementById('google_signup_submit').disabled"),false);
    });

    for(const viewport of [
        {name:'desktop',width:1440,height:900},
        {name:'tablet',width:768,height:1024},
        {name:'mobile',width:390,height:844},
        {name:'small mobile',width:320,height:568},
    ]){
        await check(`${viewport.name} school signup remains visible and scrollable`,async()=>{
            await send('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:viewport.width<700});
            await until(`innerWidth===${viewport.width}`);
            await sleep(100);
            const layout=await evaluate(`(()=>{const card=document.querySelector('#modalOverlay > div'),box=card.getBoundingClientRect(),button=document.getElementById('google_signup_submit'),old=card.scrollTop;card.scrollTop=card.scrollHeight;const submit=button.getBoundingClientRect(),canReach=card.scrollHeight<=card.clientHeight||(getComputedStyle(card).overflowY==='auto'&&submit.bottom<=box.bottom);card.scrollTop=old;return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,scrollHeight:card.scrollHeight,clientHeight:card.clientHeight,overflow:getComputedStyle(card).overflowY,canReach,documentOverflow:document.documentElement.scrollWidth>innerWidth};})()`);
            assert.ok(layout.left>=0&&layout.right<=viewport.width,`${viewport.name} modal width: ${JSON.stringify(layout)}`);
            assert.ok(layout.top>=0&&layout.bottom<=viewport.height,`${viewport.name} modal height: ${JSON.stringify(layout)}`);
            assert.equal(layout.documentOverflow,false,`${viewport.name} page must not scroll horizontally`);
            assert.equal(layout.canReach,true,`${viewport.name} signup submit must remain reachable: ${JSON.stringify(layout)}`);
        });
    }

    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:base+'/index.php?google_login=signup&qa_mode=link'});
    await until("document.getElementById('google_signup_part')?.hidden===false&&document.getElementById('head_login')?.textContent==='ผูกบัญชี Google'");
    await check('existing-account link mode asks only for the E-Office password and recovers from a rejected attempt',async()=>{
        const mode=await evaluate(`(()=>({nameHidden:document.getElementById('google_signup_name_part').hidden,nameRequired:document.getElementById('google_signup_name').required,consentDisplay:getComputedStyle(document.getElementById('google_signup_consent_part')).display,consentRequired:document.getElementById('google_signup_consent').required,passwordHidden:document.getElementById('google_link_password_part').hidden,passwordRequired:document.getElementById('google_link_password').required,email:document.getElementById('google_signup_email').textContent}))()`);
        assert.deepEqual(mode,{nameHidden:true,nameRequired:false,consentDisplay:'none',consentRequired:false,passwordHidden:false,passwordRequired:true,email:'qa-google-existing@example.org'});
        await evaluate("document.getElementById('google_signup_form').requestSubmit()");
        assert.equal(await evaluate('window.__qaGoogleSubmissions.length'),0,'link mode requires a password');
        await evaluate("document.getElementById('google_link_password').value='Synthetic-Link-Password';document.getElementById('google_signup_form').requestSubmit()");
        await until("typeof window.__qaGoogleRelease==='function'");
        await evaluate('window.__qaGoogleRelease()');
        await until("document.getElementById('google_signup_status').textContent.includes('synthetic <img')");
        const submission=await evaluate('window.__qaGoogleSubmissions[0]');
        assert.deepEqual(submission,{mode:'link',body:{name:'Synthetic Google User',consent:false,password:'Synthetic-Link-Password',csrf:'synthetic-google-csrf'}});
        assert.equal(await evaluate("document.getElementById('google_signup_status').querySelector('img')===null"),true);
    });
    for(const viewport of [{name:'tablet',width:768,height:1024},{name:'mobile',width:390,height:844}]){
        await check(`${viewport.name} account-link dialog fits the viewport`,async()=>{
            await send('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:false});
            await until(`innerWidth===${viewport.width}`);await sleep(100);
            const layout=await evaluate("(()=>{const r=document.querySelector('#modalOverlay > div').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:document.documentElement.scrollWidth>innerWidth};})()");
            assert.ok(layout.left>=0&&layout.right<=viewport.width&&layout.top>=0&&layout.bottom<=viewport.height,`${viewport.name} account-link box: ${JSON.stringify(layout)}`);
            assert.equal(layout.overflow,false);
        });
    }
    console.log(`Google signup browser checks: ${passed} passed`);
}

run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    socket?.close();
    browser.kill();
    await new Promise(resolve=>browser.exitCode===null?browser.once('exit',resolve):resolve());
    try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:2});}catch{}
});
