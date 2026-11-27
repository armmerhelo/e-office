const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

module.exports=async({url,cookies})=>{
    const bin=process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const port=Number(process.env.DRIVE_ARCHIVE_CDP_PORT||9249);
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'opencode','drive-archive-browser-'));
    const chrome=spawn(bin,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','about:blank'],{stdio:'ignore'});
    let socket,id=0;
    const pending=new Map();
    const send=(method,params={})=>new Promise((resolve,reject)=>{
        const request=++id,timer=setTimeout(()=>{pending.delete(request);reject(Error('CDP timeout: '+method));},20000);
        pending.set(request,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});
        socket.send(JSON.stringify({id:request,method,params}));
    });
    const evaluate=async expression=>{
        const {result,exceptionDetails}=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
        if(exceptionDetails)throw Error(JSON.stringify(exceptionDetails));
        return result.value;
    };
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const until=async expression=>{
        for(let i=0;i<150;i++){if(await evaluate(expression))return;await pause(100);}
        throw Error('Drive archive UI did not reach state: '+expression);
    };
    try{
        let target;
        for(let i=0;i<100;i++){
            try{target=(await fetch(`http://127.0.0.1:${port}/json/list`).then(response=>response.json())).find(item=>item.type==='page');}catch{}
            if(target)break;await pause(100);
        }
        assert.ok(target,'Chrome did not start');
        socket=new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
        socket.onmessage=event=>{
            const message=JSON.parse(event.data),callback=pending.get(message.id);
            if(!callback)return;
            pending.delete(message.id);
            if(message.error)callback.reject(Error(JSON.stringify(message.error)));
            else callback.resolve(message.result);
        };
        await send('Page.enable');
        await send('Runtime.enable');
        await send('Network.enable');
        await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
        const cookie=await send('Network.setCookie',{name:'User_Token',value:cookies.admin.slice('User_Token='.length),url,httpOnly:true,sameSite:'Strict'});
        assert.equal(cookie.success,true,'Admin test session cookie must be installed');
        await send('Page.navigate',{url:url+'/management/drive_archive.html'});
        await until("document.readyState==='complete'&&document.getElementById('message')?.textContent==='ตรวจสถานะแล้ว'");
        const initial=await evaluate(`(()=>({
            enabled:document.getElementById('status').textContent.includes('ระบบสำรอง: เปิด'),
            runs:[...document.getElementById('runs').children].map(item=>item.tagName),
            refresh:document.getElementById('refresh').textContent.trim(),
            noOverflow:document.documentElement.scrollWidth<=innerWidth
        }))()`);
        assert.equal(initial.enabled,true,'Admin should see the enabled archive state');
        assert.ok(initial.runs.length>0,'synthetic fixture should render at least one backup run');
        assert.ok(initial.runs.every(tag=>tag==='LI'),`backup runs must be semantic list items, got ${initial.runs.join(',')}`);
        assert.equal(initial.refresh,'ตรวจสถานะ');
        console.log('PASS admin sees archive status and semantic backup run list');

        const mocked={
            status:'success',enabled:true,configured:true,eviction_enabled:true,
            state:{worker_at:'2026-11-19 08:15:00',full_scan_at:'2026-11-19 08:00:00',error_code:'verification_review_required'},
            counts:[{status:'verified',files:12,bytes:'1234567'},{status:'pending',files:1,bytes:'128'}],
            retry:{deferred:'2',next_retry:'2026-11-20 09:00:00'},
            backups:[
                {backup_date:'2026-11-19',status:'database_only',error_code:'cloud_retry_pending'},
                {backup_date:'2026-11-18',status:'complete',error_code:null}
            ]
        };
        await evaluate(`(()=>{
            const original=window.fetch,mock=${JSON.stringify(mocked)};
            window.fetch=(resource,options)=>{
                if(new URL(String(resource),location.href).pathname!=='/api/drive_archive_status.php')return original(resource,options);
                return new Promise(resolve=>{window.__qaDriveArchiveRelease=()=>resolve(new Response(JSON.stringify(mock),{status:200,headers:{'Content-Type':'application/json'}}));});
            };
            document.getElementById('refresh').click();
        })()`);
        await until("typeof window.__qaDriveArchiveRelease==='function'&&document.getElementById('message').textContent==='กำลังตรวจสถานะ…'");
        const loading=await evaluate("document.getElementById('status').children.length===0&&document.getElementById('runs').children.length===0");
        assert.equal(loading,true,'refresh clears stale results while pending');
        await evaluate('window.__qaDriveArchiveRelease()');
        await until("document.getElementById('message').textContent==='ตรวจสถานะแล้ว'&&document.getElementById('runs').children.length===2");
        const rendered=await evaluate(`(()=>{
            const status=document.getElementById('status').textContent,runs=document.getElementById('runs').textContent;
            return {status,runs,images:document.querySelectorAll('#status img,#runs img').length,runTags:[...document.getElementById('runs').children].map(item=>item.tagName)};
        })()`);
        for(const text of ['ตั้งค่าแล้ว','นำไฟล์เก่าออกจากเซิร์ฟเวอร์: เปิดตามเงื่อนไขตรวจสอบ','Worker ล่าสุด: 2026-11-19 08:15:00','verified: 12 เวอร์ชัน / 1,234,567 bytes','รอ retry 2 เวอร์ชัน','พบไฟล์ที่ตรวจสอบไม่ผ่าน'])assert.ok(rendered.status.includes(text),`status should display ${text}`);
        assert.ok(rendered.runs.includes('สำรองฐานข้อมูลแล้ว / เอกสารยังซิงก์ไม่ครบ'));
        assert.ok(rendered.runs.includes('cloud_retry_pending'));
        assert.deepEqual(rendered.runTags,['LI','LI']);
        assert.equal(rendered.images,0,'status data must remain text, not injected markup');
        console.log('PASS refresh loading, retry, backup and recovery-warning states render safely');

        for(const viewport of [{name:'desktop',width:1440,height:900},{name:'tablet',width:768,height:1024},{name:'mobile',width:390,height:844},{name:'small mobile',width:320,height:568}]){
            await send('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:viewport.width<700});
            const layout=await evaluate(`(()=>{
                const main=document.querySelector('main'),box=main.getBoundingClientRect();
                return {overflow:document.documentElement.scrollWidth>innerWidth,mainFits:box.left>=0&&box.right<=innerWidth,refreshVisible:document.getElementById('refresh').getBoundingClientRect().width>0,statusVisible:document.getElementById('status').getBoundingClientRect().width>0};
            })()`);
            assert.equal(layout.overflow,false,`${viewport.name} must not scroll horizontally`);
            assert.equal(layout.mainFits,true,`${viewport.name} main content stays within the viewport`);
            assert.equal(layout.refreshVisible,true,`${viewport.name} refresh action stays visible`);
            assert.equal(layout.statusVisible,true,`${viewport.name} status stays visible`);
        }
        console.log('PASS archive status dashboard at desktop, tablet and two mobile widths without horizontal overflow');

        const readerCookie=await send('Network.setCookie',{name:'User_Token',value:cookies.reader.slice('User_Token='.length),url,httpOnly:true,sameSite:'Strict'});
        assert.equal(readerCookie.success,true);
        await send('Page.navigate',{url:url+'/management/drive_archive.html'});
        await until("document.readyState==='complete'&&document.getElementById('message')?.textContent==='คุณไม่มีสิทธิ์ทำรายการนี้'");
        const denied=await evaluate("document.getElementById('status').children.length===0&&document.getElementById('runs').children.length===0");
        assert.equal(denied,true,'non-admin browser session must not render archive status or backup dates');
        console.log('PASS non-admin browser session receives no archive status or backup details');
    }finally{
        socket?.close();
        chrome.kill();
        await new Promise(resolve=>chrome.exitCode===null?chrome.once('exit',resolve):resolve());
        try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:2});}catch{}
    }
};
