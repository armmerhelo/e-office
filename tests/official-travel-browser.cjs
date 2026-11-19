const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

module.exports = async ({base,tokens,month}) => {
    const bin = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const port = Number(process.env.OFFICIAL_TRAVEL_CDP_PORT || 9237);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(),'opencode','travel-browser-'));
    const chrome = spawn(bin,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','about:blank'],{stdio:'ignore'});
    let socket, id = 0;
    const pending = new Map(), failures = [];
    const delay = () => new Promise(resolve => setTimeout(resolve,100));
    const send = (method, params={}) => new Promise((resolve,reject) => {
        const request = ++id;
        const timer = setTimeout(() => { pending.delete(request); reject(Error('CDP timeout: '+method)); },15000);
        pending.set(request,{resolve,reject,timer});
        socket.send(JSON.stringify({id:request,method,params}));
    });
    const evalPage = async expression => {
        const {result,exceptionDetails} = await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
        if (exceptionDetails) throw Error(JSON.stringify(exceptionDetails));
        return result.value;
    };
    const until = async expression => {
        for (let i=0; i<100; i++) {
            if (await evalPage(expression)) return;
            await delay();
        }
        throw Error('UI did not reach expected state: '+expression+' / '+await evalPage("document.querySelector('.eoffice-module-status')?.textContent"));
    };
    const root = `document.querySelector('.eoffice-module-host:not([hidden])')?.shadowRoot`;
    const el = name => `${root}?.getElementById('travel-${name}')`;
    const session = name => send('Network.setCookie',{name:'User_Token',value:tokens[name],url:base,httpOnly:true,sameSite:'Strict'});
    try {
        let target;
        for (let i=0; i<100; i++) {
            try { target = (await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(item=>item.type==='page'); } catch {}
            if (target) break;
            await delay();
        }
        assert.ok(target,'Chrome did not start');
        socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve,reject) => { socket.onopen=resolve;socket.onerror=reject; });
        socket.onmessage = event => {
            const msg = JSON.parse(event.data);
            const callback = pending.get(msg.id);
            if (callback) {
                clearTimeout(callback.timer);
                pending.delete(msg.id);
                if (msg.error) callback.reject(Error(JSON.stringify(msg.error)));
                else callback.resolve(msg.result);
            }
            if (msg.method === 'Runtime.exceptionThrown') failures.push(msg.params.exceptionDetails);
        };
        await send('Page.enable');
        await send('Runtime.enable');
        await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
        await send('Page.navigate',{url:base+'/index.php?view=official_travel'});
        await until("window.eofficeSessionState?.status === 'guest' && location.search === '?view=public'");
        assert.equal(await evalPage("document.querySelector('#group_menu_official_travel').hidden"),true);
        await session('secretary');
        await send('Page.navigate',{url:base+'/index.php?view=official_travel'});
        await until(`${el('new')}?.checkVisibility() && !${el('new')}.disabled`);
        assert.equal(await evalPage(`${el('grid')}.checkVisibility()`),true);
        await evalPage(`${el('today-items')}.querySelector('button').click()`);
        assert.equal(await evalPage(`${el('detail-title')}.textContent`),'<img src=x> ทดสอบ');
        assert.equal(await evalPage(`${el('detail-title')}.querySelector('img') === null`),true);
        assert.match(await evalPage(`${el('detail-items')}.textContent`),/ข้อความภายใน/);
        await evalPage(`${el('close-detail')}.click(); ${el('new')}.click()`);
        await evalPage(`(() => {
            const f=${el('form')};
            const person=f.elements.namedItem('executive_id');
            person.value='1'; person.dispatchEvent(new Event('change',{bubbles:true}));
            if (f.elements.namedItem('department').value !== 'director') throw Error('Director department not selected');
            f.elements.namedItem('subject').value='ทดสอบบันทึกจากหน้าเว็บ';
            f.elements.namedItem('place').value='ห้องทดสอบ';
            f.requestSubmit();
        })()`);
        await until(`${el('feedback')}?.textContent === 'บันทึกกำหนดการแล้ว'`);
        assert.match(await evalPage(`${el('today-items')}.textContent`),/ทดสอบบันทึกจากหน้าเว็บ/);
        await evalPage(`(() => {const filter=${el('department')}; filter.value='academic'; filter.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        assert.equal(await evalPage(`${el('grid')}.querySelectorAll('button[data-department=director]').length`),0);
        assert.ok(await evalPage(`${el('grid')}.querySelectorAll('button[data-department=academic]').length`));
        await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
        assert.equal(await evalPage(`${el('grid')}.checkVisibility()`),false);
        assert.equal(await evalPage(`${el('agenda')}.checkVisibility() && document.documentElement.scrollWidth<=innerWidth`),true);
        await session('reader');
        await send('Page.navigate',{url:base+'/official_travel/index.html'});
        await until(`window.eofficeUser?.id === 4 && location.search === '?view=official_travel' && !!${el('today-items')}?.querySelector('button')`);
        assert.equal(await evalPage(`${el('new')}.hidden`),true);
        await evalPage(`${el('today-items')}.querySelector('button[data-department=academic]').click()`);
        assert.doesNotMatch(await evalPage(`${el('detail-items')}.textContent`),/ข้อความภายใน|เลขภายใน/);
        assert.equal(await evalPage(`${el('edit')}.hidden`),true);
        assert.equal(await evalPage(`fetch('/api/official-travel.php?month=${month}').then(r=>r.ok)`),true);
        assert.deepEqual(failures,[]);
    } finally {
        socket?.close();
        chrome.kill();
        await new Promise(resolve=>chrome.exitCode===null ? chrome.once('exit',resolve) : resolve());
        try { fs.rmSync(profile,{recursive:true,force:true,maxRetries:2}); } catch {}
    }
};
