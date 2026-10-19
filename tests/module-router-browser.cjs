// Opt-in real-browser QA against an already-running isolated serve:test server.
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const base=process.env.EOFFICE_QA_BROWSER_URL||'http://localhost:8198';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw Error('Browser write checks are local QA only');
const chromePath=process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port=Number(process.env.QA_CDP_PORT||9224),folder=path.join(os.tmpdir(),'opencode');
if(!fs.existsSync(folder))throw Error('QA temporary parent missing');
const profile=fs.mkdtempSync(path.join(folder,'eoffice-spa-browser-'));
const browser=cp.spawn(chromePath,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
let socket,sequence=0,passed=0;const pending=new Map(),exceptions=[];
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
    throw Error('Condition timed out: '+expression+' status='+await evaluate("document.querySelector('.eoffice-module-status')?.textContent"));
}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
async function moduleView(view) {
    await evaluate(`showView(${JSON.stringify(view)})`);
    await until(`location.search==='?view=${view}' && !!document.querySelector('.eoffice-module-host:not([hidden])') && !document.querySelector('.eoffice-module-status')`);
    assert.equal(await evaluate('window.__qaDocument===document && window.__qaSidebar===document.getElementById("sidebar")'),true);
    assert.equal(await evaluate("document.querySelectorAll('iframe').length"),0);
    assert.deepEqual(await evaluate(`['main-content-area','page_header','doc_type_div','read_icon_show','search_menu','pagination_html','btn_report'].filter(id=>document.getElementById(id)?.checkVisibility())`),[],`${view}: document-only UI must not appear above modules`);
}
    const root="document.querySelector('.eoffice-module-host:not([hidden])').shadowRoot";
async function run() {
    let targets;
    for(let i=0;i<100;i++){try{targets=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());break;}catch{await sleep(100);}}
    assert.ok(targets,'QA Chrome must start');
    socket=new WebSocket(targets.find(item=>item.type==='page').webSocketDebuggerUrl);
    await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
    socket.addEventListener('message',event=>{
        const message=JSON.parse(event.data);
        if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}
        if(message.method==='Page.javascriptDialogOpening')send('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});
        if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails);
    });
    await send('Page.enable');await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    const guestBootstrap=await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const transport=window.fetch;window.__qaGuestReads=[];window.fetch=(url,opts)=>new URL(String(url),location.href).pathname==='/api/get_data_public.php'?new Promise(resolve=>window.__qaGuestReads.push(()=>resolve(transport(url,opts)))):transport(url,opts);})()`});
    await send('Page.navigate',{url:base+'/index.php?view=public'});
    await until("typeof showView==='function' && !!window.eofficeSessionState");
    assert.equal(await evaluate('window.EOFFICE_MOCK_SERVICES'),true,'browser writes require serve:test with mock services');
    await check('guest public navigation keeps the table skeleton visible until data arrives',async()=>{
        await until("window.eofficeSessionState.status==='guest' && window.__qaGuestReads.length>0");
        await evaluate('closeModal()');
        assert.equal(await evaluate("document.querySelector('#load_data .eoffice-skeleton').checkVisibility()"),true);
        assert.equal(await evaluate("document.getElementById('doc-list').getAttribute('aria-busy')"),'true');
        await evaluate('window.__qaGuestReads.forEach(release=>release())');
        await until("document.getElementById('doc-list').getAttribute('aria-busy')==='false'");
        await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:guestBootstrap.identifier});
    });
    assert.equal(await evaluate(`fetch('/api/auth_login.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'qa-admin@siya.ac.th',password:'Review-Test-2026!'})}).then(r=>r.status)`),200);
    await send('Page.navigate',{url:base+'/index.php?view=public'});
    await until("window.eofficeSessionState?.status==='authenticated' && !!window.eofficeModuleRouter");
    await evaluate('window.__qaDocument=document;window.__qaSidebar=document.getElementById("sidebar")');
    await evaluate(`window.__qaWrites=[];window.__qaFetch=window.fetch;window.fetch=(url,opts)=>{if(opts?.method==='POST')window.__qaWrites.push(String(url));return window.__qaFetch(url,opts);};`);
    await evaluate("showView('send_table')");
    await until("document.getElementById('doc_type_div').checkVisibility()");
    await check('cold module navigation shows an accessible skeleton inside the persistent shell',async()=>{
        await evaluate(`window.__qaSkeletonTransport=window.fetch;window.__qaReleaseHtml=null;window.fetch=(url,opts)=>new URL(String(url),location.href).pathname==='/management/user_manage.html'?new Promise(resolve=>window.__qaReleaseHtml=()=>resolve(window.__qaSkeletonTransport(url,opts))):window.__qaSkeletonTransport(url,opts);showView('members');`);
        await until("typeof window.__qaReleaseHtml==='function' && !!document.querySelector('#module-viewport .eoffice-skeleton')");
        assert.equal(await evaluate("document.querySelector('#module-viewport .eoffice-skeleton').checkVisibility()"),true);
        assert.equal(await evaluate("document.getElementById('module-viewport').getAttribute('aria-busy')"),'true');
        assert.equal(await evaluate('document===window.__qaDocument && document.getElementById("sidebar")===window.__qaSidebar'),true);
        assert.equal(await evaluate("document.querySelector('#module-viewport .eoffice-skeleton__decoration').getAttribute('aria-hidden')"),'true');
        assert.equal(await evaluate("document.querySelector('#module-viewport .eoffice-skeleton__label').textContent"),'กำลังโหลดเนื้อหา');
        if(process.env.EOFFICE_QA_SCREENSHOTS==='1') {
            const image=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(folder,'eoffice-page-skeleton.png'),Buffer.from(image.data,'base64'));
        }
        await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
        assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true,'mobile skeleton must not introduce horizontal overflow');
        assert.equal(await evaluate("getComputedStyle(document.querySelector('#module-viewport .eoffice-skeleton__cards')).gridTemplateColumns.split(' ').length"),1);
        await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
        await evaluate('window.__qaReleaseHtml();window.fetch=window.__qaSkeletonTransport');
        await until("!!document.querySelector('.eoffice-module-host:not([hidden])') && !document.querySelector('.eoffice-module-status')");
        assert.equal(await evaluate("document.getElementById('module-viewport').hasAttribute('aria-busy')"),false);
    });
    for(const view of ['members','groups','book','my_public','send_email','ai_settings','room_booking','room_booking2','edit_room_booking','maintenance','maintenance_admin'])
        await check(view+' mounts with persistent document/sidebar and no iframe',async()=>{
            await moduleView(view);
            if(view==='book')assert.ok(await evaluate(`getComputedStyle(${root}.getElementById('bookingForm').parentElement).paddingTop.replace('px','')>=24`),'module reset must not suppress Tailwind card spacing');
            if(process.env.EOFFICE_QA_SCREENSHOTS==='1' && ['book','room_booking'].includes(view)) {
                await sleep(300);const image=await send('Page.captureScreenshot',{format:'png'});
                fs.writeFileSync(path.join(folder,`eoffice-spa-${view}.png`),Buffer.from(image.data,'base64'));
            }
        });
    await check('shared button variants override email defaults in both dashboards',async()=>{
        const variants=['primary','secondary','soft','ghost','danger','danger-text'];
        const expected=['rgb(79, 70, 229)','rgb(255, 255, 255)','rgb(238, 242, 255)','rgba(0, 0, 0, 0)','rgb(220, 38, 38)','rgba(0, 0, 0, 0)'];
        for(const view of ['send_email','ai_settings']) {
            await moduleView(view);
            const result=await evaluate(`(()=>{const s=${root},holder=document.createElement('div');holder.style.cssText='position:fixed;top:0;left:0;pointer-events:none';s.querySelector('.order-dashboard').append(holder);try{return ${JSON.stringify(variants)}.map(variant=>{const b=document.createElement('button');b.type='button';b.className='eo-btn eo-btn--'+variant;b.textContent=variant;holder.append(b);const style=getComputedStyle(b);return {background:style.backgroundColor,color:style.color};});}finally{holder.remove();}})()`);
            assert.deepEqual(result.map(item=>item.background),expected,view+': explicit variants must beat legacy primary defaults');
            assert.equal(result[4].color,'rgb(255, 255, 255)');
            assert.equal(result[5].color,'rgb(185, 28, 28)');
            assert.equal(await evaluate(`getComputedStyle(${root}.getElementById(${JSON.stringify(view==='send_email'?'search-button':'save')})).backgroundColor`),expected[0],'existing primary buttons must stay purple');
        }
    });
    await check('shared icon dimensions and booking close typography override base styles',async()=>{
        await moduleView('book');
        const result=await evaluate(`(()=>{const s=${root},holder=document.createElement('div');holder.style.cssText='position:fixed;top:0;left:0;pointer-events:none';s.querySelector('.number-booking').append(holder);try{return ['eo-btn eo-btn--ghost eo-btn--icon','booking-close'].map(className=>{const b=document.createElement('button');b.type='button';b.className=className;b.textContent='×';holder.append(b);const style=getComputedStyle(b);return {width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,padding:style.padding,font:style.fontSize};});}finally{holder.remove();}})()`);
        for(const button of result){assert.equal(button.width,44);assert.equal(button.height,44);assert.equal(button.padding,'10px');}
        assert.equal(result[1].font,'24px');
    });
    await check('calendar month controls stay on one line at narrow viewport and container widths',async()=>{
        await moduleView('room_booking');
        for(const width of [320,390,1440]) {
            await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
            if(width===1440)await evaluate(`${root}.querySelector('.eoffice-module-content').style.width='320px'`);
            try {
                const layout=await evaluate(`(()=>{const s=${root},heading=s.querySelector('.calendar-heading'),group=s.querySelector('.calendar-heading__actions'),today=group.querySelectorAll('button')[1],h=heading.getBoundingClientRect(),g=group.getBoundingClientRect(),t=today.getBoundingClientRect();return {height:t.height,nowrap:getComputedStyle(group).whiteSpace,shrink:getComputedStyle(today).flexShrink,contained:g.left>=h.left&&g.right<=h.right,secondRow:g.top>=s.getElementById('current-month-display').getBoundingClientRect().bottom,pageFits:document.documentElement.scrollWidth<=innerWidth};})()`);
                assert.equal(layout.height,44,'Today must remain a single-line 44px control');
                assert.equal(layout.nowrap,'nowrap');assert.equal(layout.shrink,'0');
                assert.equal(layout.contained,true);assert.equal(layout.secondRow,true);assert.equal(layout.pageFits,true);
            } finally {await evaluate(`${root}.querySelector('.eoffice-module-content').style.removeProperty('width')`);}
        }
        await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    });
    await check('booking management actions and request-form icons have local visible SVGs',async()=>{
        await moduleView('edit_room_booking');
        await until(root+".querySelectorAll('#tableBody button[title=\"แก้ไข\"]').length>0");
        const actions=await evaluate(`(()=>{const s=${root};return [...s.querySelectorAll('#tableBody button[title="แก้ไข"],#tableBody button[title="พิมพ์ใบจอง"]')].map(button=>{const svg=button.querySelector('svg');return {title:button.title,svg:!!svg,width:svg?.getBoundingClientRect().width||0,height:svg?.getBoundingClientRect().height||0,accessible:button.getAttribute('aria-label')||button.title};});})()`);
        assert.ok(actions.length>=2);
        assert.ok(actions.every(action=>action.svg&&action.width>0&&action.height>0&&action.accessible),'edit/print action buttons must not be empty colored squares');
        await evaluate(root+".querySelector('#tableBody button[title=\"แก้ไข\"]').click()");
        await until(root+".getElementById('editModal').classList.contains('hidden')===false");
        await evaluate(`(()=>{const s=${root};[...s.getElementById('editModal').querySelectorAll('button')].find(n=>n.textContent.trim()==='ยกเลิก').click();const icon=s.getElementById('toast').querySelector('i');icon.className='ph ph-warning-circle text-2xl';})()`);
        await until(root+".getElementById('toast').querySelector('i').dataset.bookingIcon==='warning'");
        if(process.env.EOFFICE_QA_SCREENSHOTS==='1') {
            await evaluate(`const table=${root}.getElementById('tableBody').closest('table');table.parentElement.scrollLeft=table.parentElement.scrollWidth`);
            const image=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(folder,'eoffice-booking-action-icons.png'),Buffer.from(image.data,'base64'));
        }
        await moduleView('room_booking2');
        assert.equal(await evaluate(`(()=>{const s=${root};return [...s.querySelectorAll('i[class*="fa-"]')].every(icon=>!!icon.querySelector('svg'));})()`),true);
        for(const [room,building]of [['ห้องสารภี','อาคาร 3'],['ห้องกันเกรา','อาคาร 3'],['ห้องโสตทัศนศึกษา','อาคาร 5']]) {
            await evaluate(`(()=>{const n=${root}.getElementById('roomSelect');n.value=${JSON.stringify(room)};n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
            assert.equal(await evaluate(root+".getElementById('previewLocation').textContent"),building);
        }
        if(process.env.EOFFICE_QA_SCREENSHOTS==='1') {
            const image=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(folder,'eoffice-booking-room-icons.png'),Buffer.from(image.data,'base64'));
        }
        await evaluate(`const room=${root}.getElementById('roomSelect');room.value='';room.dispatchEvent(new Event('change',{bubbles:true}));`);
    });
    await check('room booking filters, pagination, mobile cards and explicit status cancellation',async()=>{
        await moduleView('edit_room_booking');
        await until(root+".getElementById('bookingResults').getAttribute('aria-busy')==='false'");
        assert.ok(await evaluate(root+".querySelectorAll('#tableBody tr').length<=10"));
        await evaluate(`(()=>{const s=${root};s.getElementById('searchInput').value='qa-no-match-987654321';s.getElementById('searchInput').dispatchEvent(new Event('input',{bubbles:true}));})()`);
        assert.equal(await evaluate(root+".getElementById('emptyTitle').textContent"),'ไม่พบรายการที่ตรงกับตัวกรอง');
        await evaluate(root+".getElementById('resetFilters').click()");
        assert.equal(await evaluate(root+".getElementById('emptyState').classList.contains('hidden')"),true);
        await evaluate(`(()=>{const s=${root};s.getElementById('searchInput').value=s.querySelector('#tableBody tr').cells[1].textContent.trim();s.getElementById('searchInput').dispatchEvent(new Event('input',{bubbles:true}));})()`);
        assert.equal(await evaluate(root+".getElementById('resetFilters').checkVisibility()"),true,'clear filters is available with matching results');
        await evaluate(`(()=>{const s=${root};s.getElementById('sortFilter').value='soonest';s.getElementById('sortFilter').dispatchEvent(new Event('change'));s.getElementById('resetFilters').click();})()`);
        assert.equal(await evaluate(root+".getElementById('sortFilter').value"),'latest');
        assert.equal(await evaluate(root+".getElementById('resetFilters').hidden"),true);
        await evaluate(`(()=>{const s=${root},select=s.querySelector('#tableBody select'),previous=select.value,confirm=window.confirm;window.confirm=()=>false;select.value=previous==='confirmed'?'pending':'confirmed';select.dispatchEvent(new Event('change'));window.__qaStatusPrevious=previous;setTimeout(()=>window.confirm=confirm,20);})()`);
        await sleep(50);
        assert.equal(await evaluate(root+".querySelector('#tableBody select').value"),await evaluate('window.__qaStatusPrevious'));
        await evaluate(`(()=>{const s=${root};window.__qaBookingTransport=window.fetch;window.fetch=(url,opts)=>new URL(String(url),location.href).pathname==='/room_booking/api/my_bookings.php'?Promise.reject(new Error('QA offline')):window.__qaBookingTransport(url,opts);s.getElementById('refreshBookings').click();})()`);
        await until(root+".getElementById('bookingFeedback').hidden===false && "+root+".getElementById('bookingResults').getAttribute('aria-busy')==='false'");
        assert.ok(await evaluate(root+".querySelectorAll('#tableBody button[title=\"แก้ไข\"]').length>0"),'failed refresh retains actions');
        await evaluate('window.fetch=window.__qaBookingTransport');
        await evaluate(root+".getElementById('refreshBookings').click()");
        await until(root+".getElementById('bookingResults').getAttribute('aria-busy')==='false'");
        await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
        assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
        assert.equal(await evaluate(`getComputedStyle(${root}.querySelector('#tableBody tr')).display`),'block');
        await evaluate(root+".querySelector('#tableBody button[title=\"แก้ไข\"]').click()");
        await sleep(30);
        assert.equal(await evaluate(root+".activeElement.id"),'edit_room_name');
        await evaluate(root+".getElementById('editModal').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
        await sleep(350);
        assert.equal(await evaluate(root+".getElementById('editModal').classList.contains('hidden')"),true);
        await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    });
    await check('late booking edit success preserves newer fields across cached navigation',async()=>{
        await moduleView('edit_room_booking');
        await until(root+".querySelector('#tableBody button[title=\"แก้ไข\"]')!==null");
        await evaluate(`${root}.querySelector('#tableBody button[title="แก้ไข"]').click()`);
        await evaluate(`window.__qaEditTransport=window.fetch;window.__qaEditPosts=0;window.__qaReleaseEdit=null;window.fetch=(url,opts)=>new URL(String(url),location.href).pathname==='/room_booking/api/update_booking.php'&&opts?.method==='POST'?new Promise(resolve=>{window.__qaEditPosts++;window.__qaReleaseEdit=()=>resolve(new Response(JSON.stringify({status:'success',message:'QA edit saved'}),{headers:{'Content-Type':'application/json'}}));}):window.__qaEditTransport(url,opts);${root}.getElementById('save-booking-changes').click();${root}.getElementById('save-booking-changes').click();`);
        await until("typeof window.__qaReleaseEdit==='function'");
        assert.equal(await evaluate('window.__qaEditPosts'),1);
        await evaluate(`window.__qaEditHost=document.querySelector('.eoffice-module-host:not([hidden])');const topic=${root}.getElementById('edit_topic');topic.value='QA newer booking edit';topic.dispatchEvent(new Event('input',{bubbles:true}));`);
        await moduleView('book');await evaluate('window.__qaReleaseEdit()');
        await until("window.__qaEditHost.shadowRoot.getElementById('save-booking-changes').disabled===false");
        await moduleView('edit_room_booking');await sleep(350);
        assert.equal(await evaluate(root+".getElementById('edit_topic').value"),'QA newer booking edit');
        assert.equal(await evaluate(root+".getElementById('editModal').classList.contains('hidden')"),false);
        assert.equal(await evaluate('window.eofficeModuleHasChanges()'),true);
        await evaluate(`window.fetch=window.__qaEditTransport;[...${root}.getElementById('editModal').querySelectorAll('button')].find(n=>n.textContent.trim()==='ยกเลิก').click()`);
        await until(root+".getElementById('editModal').classList.contains('hidden')");
    });
    await check('cached forms keep independent values and the same nodes',async()=>{
        await moduleView('room_booking2');await until(root+".getElementById('bookingForm').dataset.eofficeDraftInitialized==='true'");
        await evaluate(`window.__qaBooking=${root}.getElementById('topic');window.__qaBooking.value='QA kept booking';window.__qaBooking.dispatchEvent(new Event('input',{bubbles:true}));`);
        await moduleView('maintenance');await until(root+".getElementById('maintenanceForm').dataset.eofficeDraftInitialized==='true'");
        await evaluate(`${root}.getElementById('department').value='QA separate repair';${root}.getElementById('department').dispatchEvent(new Event('input',{bubbles:true}));`);
        await moduleView('room_booking2');
        assert.equal(await evaluate(`${root}.getElementById('topic')===window.__qaBooking && window.__qaBooking.value==='QA kept booking'`),true);
    });
    await check('booking inline handlers, midnight suggestion and actual POST work',async()=>{
        await evaluate(`(()=>{const s=${root};const set=(id,v)=>{const n=s.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));};for(const [id,v]of Object.entries({requesterName:'QA SPA',department:'QA',topic:'QA SPA '+Date.now(),attendees:'3',startTime:'23:30'}))set(id,v);set('roomSelect',[...s.getElementById('roomSelect').options].find(o=>o.value&&o.value!=='อื่นๆ').value);s.getElementById('agreement').checked=true;s.getElementById('agreement').dispatchEvent(new Event('change',{bubbles:true}));if(!s.getElementById('bookingForm').checkValidity())throw Error('Invalid QA booking');s.getElementById('bookingForm').requestSubmit();})()`);
        await until(root+".getElementById('successModal').classList.contains('hidden')===false");
        assert.equal(await evaluate("document.getElementById('doc_id').value"),'','module IDs must never bind main-document controls');
    });
    await check('maintenance POST uses its own lifecycle, fetch base and owner',async()=>{
        await moduleView('maintenance');
        await evaluate(`(()=>{const s=${root};for(const [id,v]of Object.entries({requesterName:'QA SPA',position:'QA',department:'QA',phone:'0123456789',building:'QA',room:'1',damageDetails:'QA SPA '+Date.now()})){const n=s.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}const c=s.querySelector('input[type=checkbox]');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));if(!s.getElementById('maintenanceForm').checkValidity())throw Error('Invalid QA repair');s.getElementById('maintenanceForm').requestSubmit();})()`);
        await until(root+".getElementById('damageDetails').value===''");
    });
    await check('member form association and API save remain inside the module',async()=>{
        await moduleView('members');await until(root+".getElementById('add-member').disabled===false");
        assert.equal(await evaluate(`(()=>{const s=${root};s.getElementById('add-member').click();const nodes=[...s.getElementById('modal_user_manage').querySelectorAll('button,input,select')].filter(n=>!n.disabled&&n.getClientRects().length);nodes[0].focus();nodes[0].dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,composed:true,cancelable:true}));return s.activeElement===nodes.at(-1);})()`),true,'module modal focus trap must see the shadow active element');
        await evaluate(`(()=>{const s=${root};for(const [id,v]of Object.entries({edit_name:'QA SPA member',edit_email:'qa-spa-'+Date.now()+'@siya.ac.th',password_1:'Review-Test-2026!',password_2:'Review-Test-2026!'})){const n=s.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}s.getElementById('save-member').click();})()`);
        await until(root+".getElementById('modal_user_manage').hidden===true");
    });
    await check('department inline save uses its own form and closeModal',async()=>{
        await moduleView('groups');
        await evaluate(`(()=>{const s=${root};s.querySelector('button').click();s.getElementById('edit_name').value='QA SPA department '+Date.now();s.getElementById('edit_name').dispatchEvent(new Event('input',{bubbles:true}));[...s.getElementById('modal_dept').querySelectorAll('button')].find(n=>n.textContent.includes('บันทึกข้อมูล')).click();})()`);
        await until(root+".getElementById('modal_dept').classList.contains('hidden')");
    });
    await check('number booking still submits once after repeated cached visits',async()=>{
        await moduleView('book');await moduleView('maintenance');await moduleView('book');
        await evaluate(`(()=>{const s=${root};s.getElementById('openBooking').click();s.getElementById('docDetail').value='QA SPA number '+Date.now();s.getElementById('docDetail').dispatchEvent(new Event('input',{bubbles:true}));s.getElementById('bookingForm').requestSubmit();})()`);
        await until("window.__qaWrites.some(url=>url.includes('external_number_booking.php'))");await sleep(300);
        assert.equal(await evaluate(root+".getElementById('bookingModal').open"),false,'saved booking closes its modal');
        assert.equal(await evaluate("window.__qaWrites.filter(url=>url.includes('external_number_booking.php')).length"),1);
        assert.equal(await evaluate("document.getElementById('document-form').querySelector('[name=doc_name]').value"),'');
    });
    await check('expired number-booking drafts block logout before its API and clear after cancel/save',async()=>{
        await moduleView('book');
        await until(root+".getElementById('reserveButton').disabled===false");
        await evaluate(`window.__qaNumberGuardTransport=window.fetch;window.__qaNumberGuardExpired=false;window.__qaNumberGuardLogoutCalls=0;window.fetch=(url,options={})=>{const path=new URL(String(url),location.href).pathname;if(path==='/api/logout.php'){window.__qaNumberGuardLogoutCalls++;return Promise.resolve(new Response(JSON.stringify({status:'error',message:'QA must not log out'})));}if(path!=='/external_number_booking/external_number_booking.php')return window.__qaNumberGuardTransport(url,options);const expired=window.__qaNumberGuardExpired;return Promise.resolve(new Response(JSON.stringify({status:expired?'error':'success',isAdmin:true,data:[{id:77777,External_Number:'777/2569',Doc_Year:2569,Doc_Detail:'QA guard original',User_Name:'QA'}]}),{status:expired?401:200,headers:{'Content-Type':'application/json'}}));};${root}.getElementById('refreshBookings').click();`);
        await until(root+".getElementById('registerContent').getAttribute('aria-busy')==='false'");
        for(const kind of ['edit','booking']) {
            await evaluate(`(()=>{const s=${root};window.__qaNumberGuardExpired=true;if(${JSON.stringify(kind)}==='edit'){s.querySelector('.booking-text-button').click();s.getElementById('editDocDetail').value='QA retained number edit';s.getElementById('editDocDetail').dispatchEvent(new Event('input',{bubbles:true}));s.getElementById('editForm').requestSubmit();}else{s.getElementById('openBooking').click();s.getElementById('docDetail').value='QA retained number booking';s.getElementById('docDetail').dispatchEvent(new Event('input',{bubbles:true}));s.getElementById('bookingForm').requestSubmit();}})()`);
            await until(root+".getElementById('mainApp').hidden && !"+root+".getElementById('saveEdit').disabled && !"+root+".getElementById('reserveButton').disabled");
            assert.equal(await evaluate('window.eofficeModuleHasChanges()'),true,kind+': central guard retains hidden drafts');
            const logout=await evaluate(`(async()=>{const original=window.confirm;let confirmations=0;window.confirm=()=>{confirmations++;return false;};try{window.eofficeCancelDocumentLeaving();await logOut();return {confirmations,calls:window.__qaNumberGuardLogoutCalls};}finally{window.confirm=original;}})()`);
            assert.deepEqual(logout,{confirmations:1,calls:0},kind+': cancel must stop logout before the server is called');
            await moduleView('maintenance');
            assert.equal(await evaluate('window.eofficeModuleHasChanges()'),true,'navigation retains the expired draft');
            await evaluate('window.__qaNumberGuardExpired=false');await moduleView('book');
            if(kind==='edit') {
                assert.equal(await evaluate(root+".getElementById('editModal').open"),true);
                assert.equal(await evaluate(root+".getElementById('editDocDetail').value"),'QA retained number edit');
                await evaluate(root+".getElementById('cancelEdit').click()");
            } else {
                assert.equal(await evaluate(root+".getElementById('bookingModal').open"),true);
                assert.equal(await evaluate(root+".getElementById('docDetail').value"),'QA retained number booking');
                await evaluate(`${root}.getElementById('bookingForm').reset();${root}.getElementById('cancelBooking').click()`);
            }
            assert.equal(await evaluate('window.eofficeModuleHasChanges()'),false,'cancel/reset releases the central guard');
        }
        await evaluate(`${root}.querySelector('.booking-text-button').click();${root}.getElementById('editDocDetail').value='QA saved number edit';${root}.getElementById('editDocDetail').dispatchEvent(new Event('input',{bubbles:true}));${root}.getElementById('editForm').requestSubmit();`);
        await until(root+".getElementById('saveEdit').disabled===false && !"+root+".getElementById('editModal').open");
        assert.equal(await evaluate('window.eofficeModuleHasChanges()'),false,'successful save releases the central guard');
        await evaluate('window.fetch=window.__qaNumberGuardTransport');
    });
    await check('dynamic inline calendar handlers remain scoped',async()=>{
        await moduleView('room_booking');
        const before=await evaluate(root+".getElementById('current-month-display').textContent");
        // Original inline attributes are compiled into scoped properties.
        await evaluate(root+".querySelector('button').click()");
        await until(root+`.getElementById('current-month-display').textContent!==${JSON.stringify(before)}`);
    });
    await check('cached view skeleton waits for fresh data and stale completion cannot cover a newer route',async()=>{
        await moduleView('room_booking');await evaluate("window.__qaCalendarHost=document.querySelector('.eoffice-module-host:not([hidden])')");
        await moduleView('book');
        const hold=()=>evaluate(`window.__qaRefreshTransport=window.fetch;window.__qaReleaseRead=null;window.fetch=(url,opts)=>new URL(String(url),location.href).pathname==='/room_booking/api/get_bookings.php'?new Promise(resolve=>window.__qaReleaseRead=()=>resolve(window.__qaRefreshTransport(url,opts))):window.__qaRefreshTransport(url,opts);showView('room_booking');`);
        await hold();await until("typeof window.__qaReleaseRead==='function' && !!document.querySelector('#module-viewport .eoffice-skeleton')");
        assert.equal(await evaluate('window.__qaCalendarHost.hidden'),true,'keep old content behind skeleton until data is ready');
        await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
        assert.equal(await evaluate("getComputedStyle(document.querySelector('#module-viewport .eoffice-skeleton__bar'),'::after').animationName"),'none');
        await send('Emulation.setEmulatedMedia',{features:[]});
        await evaluate('window.__qaReleaseRead();window.fetch=window.__qaRefreshTransport');
        await until("!document.querySelector('.eoffice-module-status') && window.__qaCalendarHost.hidden===false");
        await moduleView('book');await hold();await until("typeof window.__qaReleaseRead==='function'");
        await moduleView('maintenance');
        await evaluate('window.__qaReleaseRead();window.fetch=window.__qaRefreshTransport');await sleep(200);
        assert.equal(await evaluate('location.search'),'?view=maintenance');
        assert.equal(await evaluate("document.querySelector('#module-viewport .eoffice-skeleton')===null && document.querySelector('.eoffice-module-status')===null"),true);
        assert.equal(await evaluate(root+".getElementById('maintenanceForm')!==null"),true);
    });
    await check('document tabs show a table skeleton until the current list request completes',async()=>{
        await evaluate(`window.__qaDocumentTransport=window.fetch;window.__qaReleaseList=null;window.fetch=(url,opts)=>new URL(String(url),location.href).pathname==='/api/get_data_public.php'?new Promise(resolve=>window.__qaReleaseList=()=>resolve(window.__qaDocumentTransport(url,opts))):window.__qaDocumentTransport(url,opts);showView('public');`);
        await until("typeof window.__qaReleaseList==='function'");
        assert.equal(await evaluate("document.querySelector('#load_data .eoffice-skeleton--table').checkVisibility()"),true);
        assert.equal(await evaluate("document.getElementById('doc-list').getAttribute('aria-busy')"),'true');
        await evaluate('window.__qaReleaseList();window.fetch=window.__qaDocumentTransport');
        await until("document.getElementById('load_data').checkVisibility()===false");
        assert.equal(await evaluate("document.getElementById('doc-list').getAttribute('aria-busy')"),'false');
    });
    await check('document tabs, Back/Forward and rapid route changes stay same-document',async()=>{
        await evaluate("showView('received');showView('public');history.back()");await until("location.search==='?view=received'");
        await evaluate('history.forward()');await until("location.search==='?view=public'");
        assert.equal(await evaluate("document.getElementById('main-content-area').checkVisibility() && !document.getElementById('main-content-area').inert"),true);
        assert.equal(await evaluate("document.getElementById('doc_type_div').checkVisibility()"),false,'public orders must not inherit registry-type controls');
        await evaluate("showView('send_table')");
        assert.equal(await evaluate("document.getElementById('doc_type_div').checkVisibility() && document.getElementById('search_menu').checkVisibility()"),true,'registry controls must be restored on document routes');
        await evaluate("showView('received')");
        assert.equal(await evaluate("document.getElementById('doc_type_div').checkVisibility()"),false);
        assert.equal(await evaluate('document===window.__qaDocument'),true);
        assert.equal(await evaluate("document.querySelectorAll('#sidebar .bg-indigo-700').length"),1,'returning from modules must leave one active document menu');
        await evaluate("showView('members');showView('maintenance');showView('room_booking2')");
        await until("location.search==='?view=room_booking2' && !!document.querySelector('.eoffice-module-host:not([hidden])')");
        assert.equal(await evaluate(root+".querySelectorAll('#bookingForm').length"),1);
    });
    await check('document export overlay closes when Back returns to a module',async()=>{
        await moduleView('book');await evaluate("showView('public');toggleExportModal()");
        assert.equal(await evaluate("document.getElementById('exportModal').checkVisibility()"),true);
        await evaluate('history.back()');
        await until("location.search==='?view=book' && !!document.querySelector('.eoffice-module-host:not([hidden])')");
        assert.equal(await evaluate("document.getElementById('exportModal').checkVisibility()"),false);
        assert.equal(await evaluate("document.getElementById('exportModal').classList.contains('hidden')"),true);
    });
    await check('main document creation still uses original main globals after all modules mount',async()=>{
        await evaluate("showView('send_table');open_create_doc()");
        await evaluate(`(()=>{for(const [id,v]of Object.entries({doc_number_receive:'QA-SPA-'+Date.now(),doc_number:'QA-SPA-'+Date.now(),doc_date:'2026-10-14',doc_receive_from:'QA',doc_name:'QA original main document'})){const n=document.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}if(!document.getElementById('document-form').checkValidity())throw Error('Invalid QA main form');document.getElementById('document-form').requestSubmit();})()`);
        await until("document.getElementById('formtype').value==='edit_document' && Number(document.getElementById('doc_id').value)>0 && document.getElementById('document-modal').classList.contains('hidden')");
        assert.equal(await evaluate('document===window.__qaDocument'),true);
        assert.equal(await evaluate('window.eofficeModuleHasChanges()'),false,'closed/saved module dialogs must not leave stale warnings');
    });
    await check('dirty cached forms are retained internally but warn before leaving the application',async()=>{
        await moduleView('maintenance');
        await evaluate(`const n=${root}.getElementById('damageDetails');n.value='QA unsaved cached form';n.dispatchEvent(new Event('input',{bubbles:true}));showView('public');`);
        assert.equal(await evaluate("(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})()"),true);
        assert.equal(await evaluate("(()=>{const original=window.confirm;window.confirm=()=>false;try{return window.eofficeApproveDocumentLeaving();}finally{window.confirm=original;}})()"),false);
        await moduleView('maintenance');assert.equal(await evaluate(root+".getElementById('damageDetails').value"),'QA unsaved cached form');
        await evaluate(root+".getElementById('maintenanceForm').reset()");
    });
    await check('mobile navigation closes drawer without reloading',async()=>{
        await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
        await evaluate("toggleSidebar();document.getElementById('menu-bookdocnumber').click()");
        await until("location.search==='?view=book' && !!document.querySelector('.eoffice-module-host:not([hidden])')");
        assert.equal(await evaluate("document.getElementById('sidebar').dataset.sidebarOpen"),'false');
        assert.equal(await evaluate("document.getElementById('main_div').inert"),false);
        assert.equal(await evaluate('document===window.__qaDocument'),true);
    });
    await check('session refresh keeps module geometry visible while disabling interaction',async()=>{
        const pendingState=await evaluate("(()=>{const host=document.querySelector('.eoffice-module-host:not([hidden])');window.dispatchEvent(new Event('eoffice:permissions-changed'));return {sameHost:host===document.querySelector('.eoffice-module-host:not([hidden])'),inert:host.inert};})()");
        assert.deepEqual(pendingState,{sameHost:true,inert:true});
        await until("window.eofficeSessionState.status==='authenticated' && document.querySelector('.eoffice-module-host:not([hidden])')?.inert===false");
    });
    await check('cached module unlocks after navigating away during pending verification',async()=>{
        await moduleView('book');
        await evaluate(`window.__qaSessionTransport=window.fetch;window.__qaHoldMe=true;window.__qaReleaseMe=null;window.fetch=(url,opts)=>{const result=window.__qaSessionTransport(url,opts);if(window.__qaHoldMe&&new URL(String(url),location.href).pathname==='/api/me.php'){window.__qaHoldMe=false;return result.then(response=>new Promise(resolve=>window.__qaReleaseMe=()=>resolve(response)));}return result;};window.dispatchEvent(new Event('eoffice:permissions-changed'));`);
        await until("window.eofficeSessionState.status==='pending' && typeof window.__qaReleaseMe==='function'");
        await evaluate("showView('maintenance');window.__qaReleaseMe()");
        await until("window.eofficeSessionState.status==='authenticated' && location.search==='?view=maintenance' && !!document.querySelector('.eoffice-module-host:not([hidden])')");
        await evaluate('window.fetch=window.__qaSessionTransport');
        await moduleView('book');
        assert.equal(await evaluate("document.querySelector('.eoffice-module-host:not([hidden])').inert"),false);
        assert.equal(await evaluate(`(()=>{const s=${root};s.getElementById('openBooking').click();const n=s.getElementById('docDetail');return n===s.activeElement;})()`),true);
        await moduleView('maintenance');await moduleView('book');
        assert.equal(await evaluate(root+".getElementById('bookingModal').open"),true,'cached navigation restores the open booking modal');
        await evaluate(root+".getElementById('cancelBooking').click()");
    });
    await check('cached calendar, booking history and repair dashboard fetch fresh records on return',async()=>{
        await evaluate(`window.__qaReadTransport=window.fetch;window.__qaReadCalls={};window.fetch=async(url,opts)=>{const response=await window.__qaReadTransport(url,opts);const p=new URL(String(url),location.href).pathname;if(!['/room_booking/api/get_bookings.php','/room_booking/api/my_bookings.php','/maintenance_requests/api/get_maintenance.php'].includes(p)||!response.ok)return response;window.__qaReadCalls[p]=(window.__qaReadCalls[p]||0)+1;const data=await response.json();const date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'});const record=p.includes('maintenance')?{id:99999992,requester_name:'QA refresh marker',request_date:date,repair_types:'ไฟฟ้า',building:'QA',room:'1',damage_details:'QA refresh',consideration_status:'pending',action_result:'pending',materials:[],images:[]}:{id:99999991,User_Id:window.eofficeUser.id,room_name:'QA refresh',topic:'QA refresh marker',requester_name:'QA',department:'QA',attendees:3,start_datetime:date+' 09:00:00',end_datetime:date+' 10:00:00',created_at:date,status:'pending'};data.data.push(record);return new Response(JSON.stringify(data),{status:response.status,headers:{'Content-Type':'application/json'}});};`);
        for(const [view,endpoint]of [['room_booking','/room_booking/api/get_bookings.php'],['edit_room_booking','/room_booking/api/my_bookings.php'],['maintenance_admin','/maintenance_requests/api/get_maintenance.php']]) {
            await moduleView(view);
            if(view==='edit_room_booking') await evaluate(`const search=${root}.getElementById('searchInput');search.value='QA refresh marker';search.dispatchEvent(new Event('input',{bubbles:true}));`);
            await until(`(window.__qaReadCalls[${JSON.stringify(endpoint)}]||0)>0 && ${root}.textContent.includes('QA refresh marker')`);
            if(view==='edit_room_booking') await evaluate(`${root}.getElementById('resetFilters').click()`);
        }
        await evaluate('window.fetch=window.__qaReadTransport');
    });
    await check('late successful save refreshes the currently visible dashboard',async()=>{
        await moduleView('maintenance');
        await evaluate(`window.__qaLateTransport=window.fetch;window.__qaLateWritten=false;window.__qaLateReads=0;window.__qaReleaseSave=null;window.fetch=async(url,opts)=>{const u=new URL(String(url),location.href);if(u.pathname==='/maintenance_requests/api/submit_maintenance.php'&&opts?.method==='POST')return new Promise(resolve=>window.__qaReleaseSave=()=>{window.__qaLateWritten=true;resolve(new Response(JSON.stringify({status:'success',id:99999998}),{headers:{'Content-Type':'application/json'}}));});const response=await window.__qaLateTransport(url,opts);if(u.pathname==='/maintenance_requests/api/get_maintenance.php'&&response.ok){if(window.__qaLateWritten){const data=await response.json();data.data.push({id:99999998,requester_name:'QA late visible marker',request_date:'2026-10-14',repair_types:'ไฟฟ้า',building:'QA',room:'1',damage_details:'QA late refresh',consideration_status:'pending',action_result:'pending',materials:[],images:[]});window.__qaLateReads++;return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});}window.__qaLateReads++;}return response;};`);
        await evaluate(`(()=>{const s=${root};for(const [id,v]of Object.entries({requesterName:'QA late',position:'QA',department:'QA',phone:'0123456789',building:'QA',room:'1',damageDetails:'QA held response'})){const n=s.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));}const c=s.querySelector('input[type=checkbox]');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));s.getElementById('maintenanceForm').requestSubmit();})()`);
        await until("typeof window.__qaReleaseSave==='function'");
        await moduleView('maintenance_admin');
        await until('window.__qaLateReads>0');
        assert.equal(await evaluate(root+".textContent.includes('QA late visible marker')"),false);
        await evaluate('window.__qaReleaseSave()');
        await until(root+".textContent.includes('QA late visible marker')");
        await evaluate('window.fetch=window.__qaLateTransport');
    });
    await check('native module dialog closes on Back and before session suspension',async()=>{
        await moduleView('send_email');
        await evaluate(`window.__qaDialog=${root}.getElementById('detail');window.__qaDialog.showModal();history.back()`);
        await until("location.search!=='?view=send_email'");
        assert.equal(await evaluate("window.__qaDialog.open || window.__qaDialog.matches(':modal')"),false);
        assert.equal(await evaluate("(()=>{const n=document.getElementById('menu-toggle');n.focus();return document.activeElement===n;})()"),true);
        await moduleView('send_email');
        const pending=await evaluate(`(()=>{const s=${root};s.getElementById('detail').showModal();const input=s.getElementById('recipient-email');input.value='qa-unsaved@example.test';input.dispatchEvent(new Event('input',{bubbles:true}));window.dispatchEvent(new Event('eoffice:permissions-changed'));return {open:s.getElementById('detail').open,modal:s.getElementById('detail').matches(':modal'),dirty:window.eofficeModuleHasChanges()};})()`);
        assert.deepEqual(pending,{open:false,modal:false,dirty:true});
        await until("window.eofficeSessionState.status==='authenticated'");
        await evaluate(`${root}.getElementById('add-recipient').dispatchEvent(new Event('eoffice:form-saved',{bubbles:true}))`);
    });
    await check('older failed personal-order refresh cannot overwrite the latest result',async()=>{
        await moduleView('my_public');
        await evaluate(`window.__qaIdentityTransport=window.fetch;window.__qaIdentityReads=[];window.fetch=(url,opts)=>new URL(String(url),location.href).pathname==='/email_send/api_get_my_docs.php'?new Promise((resolve,reject)=>window.__qaIdentityReads.push({resolve,reject})):window.__qaIdentityTransport(url,opts);${root}.querySelector('.header-actions button').click();${root}.querySelector('.header-actions button').click();`);
        await until('window.__qaIdentityReads.length===2');
        await evaluate(`window.__qaIdentityReads[1].resolve(new Response(JSON.stringify({status:'success',years:[],data:[{doc_id:99100,doc_year:'2569',external_number:100,doc_name:'QA latest order',files:[]}]}),{headers:{'Content-Type':'application/json'}}))`);
        await until(root+".getElementById('myDocTableBody').textContent.includes('QA latest order')");
        await evaluate("window.__qaIdentityReads[0].reject(new Error('QA obsolete failure'))");
        await sleep(100);
        assert.equal(await evaluate(root+".getElementById('myDocTableBody').textContent.includes('QA latest order')"),true);
        assert.equal(await evaluate(root+".getElementById('myDocTableBody').textContent.includes('QA obsolete failure')"),false);
        await evaluate('window.fetch=window.__qaIdentityTransport');
    });
    await check('personal orders search, files, pagination, retained filters and mobile layout',async()=>{
        await moduleView('my_public');
        await evaluate(`window.__qaOrdersTransport=window.fetch;window.__qaOrdersCalls=[];window.__qaOrdersFail=false;window.__qaOrdersHold=false;window.__qaOrdersDeferred=[];
            window.fetch=(url,opts)=>{const u=new URL(String(url),location.href);if(u.pathname!=='/email_send/api_get_my_docs.php')return window.__qaOrdersTransport(url,opts);
            window.__qaOrdersCalls.push(Object.fromEntries(u.searchParams));if(window.__qaOrdersFail)return Promise.reject(Error('QA offline'));
            const page=Number(u.searchParams.get('page')||1),search=u.searchParams.get('search')||'';
            const data=search==='missing'?[]:[{doc_id:99101,external_number:125,doc_year:'2569',doc_name:'แต่งตั้งคณะกรรมการ <img src=x onerror=alert(1)>',files:['คำสั่งฉบับหลัก.pdf','เอกสารแนบท้ายชื่อยาวสำหรับทดสอบการตัดบรรทัด.pdf']},
                {doc_id:99102,external_number:118,doc_year:'2569',doc_name:'มอบหมายหน้าที่ปฏิบัติงาน',files:['test & # 1.pdf']},
                {doc_id:99103,external_number:117,doc_year:'2569',doc_name:'ไฟล์เดิมไม่พร้อม',files:[]}];
            data.forEach(row=>{row.doc_id+=(page-1)*10;row.doc_name+=' · หน้า '+page;});
            const reply=()=>new Response(JSON.stringify({status:'success',user_email:'qa-orders@example.test',years:['2569','2568'],data,pagination:{total_items:search==='missing'?0:24,current_page:page}}),{headers:{'Content-Type':'application/json'}});
            return window.__qaOrdersHold?new Promise((resolve,reject)=>window.__qaOrdersDeferred.push({resolve:()=>resolve(reply()),reject,query:Object.fromEntries(u.searchParams)})):Promise.resolve(reply());};
            ${root}.getElementById('refreshOrders').click();`);
        try {
            await until(root+".getElementById('resultCount').textContent==='24 รายการ'");
            assert.equal(await evaluate(root+".querySelectorAll('.doc-name img').length"),0,'document titles render as text');
            assert.equal(await evaluate(root+".querySelector('.file-unavailable').textContent"),'ไฟล์เดิมไม่พร้อมใช้งาน');
            await evaluate(`${root}.querySelector('summary').click()`);
            assert.equal(await evaluate(root+".querySelector('details').open"),true);
            const links=await evaluate(`[...${root}.querySelectorAll('.file-link')].map(n=>({url:n.href,rel:n.rel,target:n.target,label:n.getAttribute('aria-label')}))`);
            assert.equal(links.length,3);assert.ok(links.every(n=>new URL(n.url).pathname==='/api/view_file.php'&&n.target==='_blank'&&n.rel==='noopener'));
            assert.equal(new URL(links[2].url).searchParams.get('File_Path'),'test & # 1.pdf');
            await evaluate(`${root}.getElementById('orderSearch').value='แต่งตั้ง';${root}.getElementById('yearSelect').value='2569';${root}.getElementById('filters').requestSubmit()`);
            await until("window.__qaOrdersCalls.at(-1).search==='แต่งตั้ง' && "+root+".getElementById('listContent').getAttribute('aria-busy')==='false'");
            assert.equal(await evaluate('window.__qaOrdersCalls.at(-1).year'),'2569');
            await evaluate(`window.__qaOrdersHold=true;${root}.querySelectorAll('.btn-page')[2].click();${root}.getElementById('refreshOrders').click()`);
            await until('window.__qaOrdersDeferred.length===2');
            assert.deepEqual(await evaluate('window.__qaOrdersDeferred.map(read=>read.query.page)'),['2','2'],'refresh must follow the page selected before the previous request completed');
            await evaluate('window.__qaOrdersDeferred[1].resolve()');
            await until("window.__qaOrdersCalls.at(-1).page==='2' && "+root+".getElementById('pageInfo').textContent.includes('11–20')");
            assert.equal(await evaluate(root+".querySelector('.doc-name').textContent.endsWith(' · หน้า 2')"),true);
            assert.equal(await evaluate(`new URL(${root}.querySelector('.file-link').href).searchParams.get('Doc_Id')`),'99111');
            await evaluate("window.__qaOrdersDeferred[0].reject(Error('obsolete pagination failure'));window.__qaOrdersHold=false");
            await sleep(100);
            assert.equal(await evaluate(root+".getElementById('listFeedback').hidden"),true);
            // A new search from page 3 must stay on page 1 when refreshed mid-load.
            await evaluate(`${root}.querySelector('[aria-label="หน้าถัดไป"]').click()`);
            await until(root+".getElementById('pageInfo').textContent.includes('21–24')");
            await evaluate(`window.__qaOrdersDeferred=[];window.__qaOrdersHold=true;${root}.getElementById('orderSearch').value='คำค้นใหม่';${root}.getElementById('filters').requestSubmit();${root}.getElementById('refreshOrders').click()`);
            await until('window.__qaOrdersDeferred.length===2');
            assert.deepEqual(await evaluate('window.__qaOrdersDeferred.map(read=>({page:read.query.page,search:read.query.search,year:read.query.year}))'),[
                {page:'1',search:'คำค้นใหม่',year:'2569'},{page:'1',search:'คำค้นใหม่',year:'2569'}
            ]);
            await evaluate('window.__qaOrdersDeferred[1].resolve()');
            await until(root+".getElementById('pageInfo').textContent.includes('1–10') && "+root+".getElementById('listContent').getAttribute('aria-busy')==='false'");
            await evaluate('window.__qaOrdersDeferred[0].resolve();window.__qaOrdersHold=false');
            await sleep(100);
            assert.equal(await evaluate(root+".querySelector('.doc-name').textContent.endsWith(' · หน้า 1')"),true);
            assert.equal(await evaluate(`new URL(${root}.querySelector('.file-link').href).searchParams.get('Doc_Id')`),'99101');
            await evaluate(`${root}.getElementById('orderSearch').value='แต่งตั้ง';${root}.getElementById('filters').requestSubmit()`);
            await until(root+".getElementById('listContent').getAttribute('aria-busy')==='false'");
            await evaluate(`${root}.querySelector('[aria-label="หน้าถัดไป"]').click()`);
            await until(root+".getElementById('pageInfo').textContent.includes('11–20')");
            await evaluate(`${root}.getElementById('orderSearch').value='unfinished draft'`);
            await moduleView('book');await moduleView('my_public');
            assert.equal(await evaluate(root+".getElementById('orderSearch').value"),'unfinished draft');
            assert.equal(await evaluate('window.__qaOrdersCalls.at(-1).search'),'แต่งตั้ง');
            assert.equal(await evaluate('window.__qaOrdersCalls.at(-1).page'),'2');
            await evaluate(`window.__qaOrdersFail=true;${root}.getElementById('refreshOrders').click()`);
            await until(root+".getElementById('listFeedback').hidden===false");
            assert.equal(await evaluate(root+".querySelectorAll('.document-row').length"),3,'refresh failure retains the last loaded rows');
            await evaluate(`window.__qaOrdersFail=false;${root}.getElementById('resetFilters').click()`);
            await until(root+".getElementById('resultCount').textContent==='24 รายการ'");
            assert.equal(await evaluate('window.__qaOrdersCalls.at(-1).search'),'');
            assert.equal(await evaluate('window.__qaOrdersCalls.at(-1).year'),'all');
            for(const width of [390,375]) {
                await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});
                assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
                assert.equal(await evaluate(`getComputedStyle(${root}.querySelector('.document-row')).display`),'block');
                assert.equal(await evaluate(`${root}.querySelector('.orders-panel').scrollWidth<=${root}.querySelector('.orders-panel').clientWidth+1`),true);
            }
            await evaluate(`${root}.getElementById('orderSearch').value='missing';${root}.getElementById('filters').requestSubmit()`);
            await until(root+".getElementById('myDocTableBody').textContent.includes('ไม่พบคำสั่งตามเงื่อนไข')");
            assert.equal(await evaluate(root+".getElementById('ordersPagination').hidden"),true);
            assert.equal(await evaluate(root+".getElementById('ordersTableHead').hidden"),true);
            await evaluate(`window.__qaOrdersFail=true;${root}.getElementById('resetFilters').click()`);
            await until(root+".getElementById('myDocTableBody').textContent.includes('โหลดรายการไม่สำเร็จ')");
        } finally {
            await evaluate('window.fetch=window.__qaOrdersTransport');
            await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
            await evaluate(`${root}.getElementById('resetFilters').click()`);
            await until(root+".getElementById('listContent').getAttribute('aria-busy')==='false'");
        }
    });
    await check('real email detail modal resumes its unsaved recipient after internal navigation',async()=>{
        await evaluate(`window.__qaModalTransport=window.fetch;window.fetch=(url,opts)=>{const u=new URL(String(url),location.href);if(u.pathname==='/email_send/order_jobs.php'&&(!opts?.method||opts.method==='GET')){const data=u.searchParams.has('doc_id')?{status:'success',job:{status:'queued'},files:[],recipients:[]}:{status:'success',total:1,years:[],is_admin:true,worker:{enabled:false},data:[{doc_id:99999994,doc_number:'QA modal',doc_year:'2569',doc_name:'QA modal fixture',status:'queued'}]};return Promise.resolve(new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}));}return window.__qaModalTransport(url,opts);};`);
        await moduleView('send_email');await until(root+".getElementById('rows').textContent.includes('QA modal fixture')");
        await evaluate(`${root}.getElementById('rows').querySelector('button').click()`);
        await until(root+".getElementById('recipient-email').disabled===false");
        await evaluate(`window.__qaResumeDialog=${root}.getElementById('detail');const input=${root}.getElementById('recipient-email');input.value='qa-resume@example.test';input.dispatchEvent(new Event('input',{bubbles:true}));`);
        await moduleView('book');assert.equal(await evaluate('window.__qaResumeDialog.open'),false);
        await moduleView('send_email');
        await until(root+".getElementById('detail').open && "+root+".getElementById('recipient-email').disabled===false");
        assert.equal(await evaluate(root+".getElementById('recipient-email').value"),'qa-resume@example.test');
        await evaluate(`window.__qaRecipientTransport=window.fetch;window.__qaReleaseRecipient=null;window.fetch=(url,opts)=>new URL(String(url),location.href).pathname==='/email_send/order_jobs.php'&&opts?.method==='POST'?new Promise(resolve=>window.__qaReleaseRecipient=(ok=true)=>resolve(new Response(JSON.stringify({status:ok?'success':'error',message:ok?'QA recipient saved':'QA recipient rejected'}),{status:ok?200:400,headers:{'Content-Type':'application/json'}}))):window.__qaRecipientTransport(url,opts);${root}.getElementById('add-recipient').requestSubmit();`);
        await until("typeof window.__qaReleaseRecipient==='function'");
        await moduleView('book');await evaluate('window.__qaReleaseRecipient()');
        await until("window.__qaResumeDialog.querySelector('#recipient-email').value===''");
        await moduleView('send_email');
        await until(root+".getElementById('detail').open && "+root+".getElementById('recipient-email').disabled===false");
        assert.equal(await evaluate(root+".getElementById('recipient-email').value"),'','completed recipient must not be resurrected from a suspended snapshot');
        for(const outcome of ['failed','newer-edit']) {
            await evaluate(`(()=>{const input=${root}.getElementById('recipient-email');input.value='qa-submitted@example.test';input.dispatchEvent(new Event('input',{bubbles:true}));window.__qaReleaseRecipient=null;${root}.getElementById('add-recipient').requestSubmit();})()`);
            await until("typeof window.__qaReleaseRecipient==='function'");
            if(outcome==='newer-edit')await evaluate(`(()=>{const input=${root}.getElementById('recipient-email');input.value='qa-newer@example.test';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
            await moduleView('book');
            await evaluate(`window.__qaReleaseRecipient(${outcome!=='failed'})`);
            await moduleView('send_email');
            await until(root+".getElementById('detail').open && "+root+".getElementById('recipient-email').disabled===false");
            assert.equal(await evaluate(root+".getElementById('recipient-email').value"),outcome==='newer-edit'?'qa-newer@example.test':'qa-submitted@example.test');
            assert.equal(await evaluate('window.eofficeModuleHasChanges()'),true);
        }
        await evaluate('window.fetch=window.__qaRecipientTransport');
        await evaluate(`${root}.getElementById('close-detail').click();window.fetch=window.__qaModalTransport`);
        await until('!window.eofficeModuleHasChanges()');
        assert.equal(await evaluate('window.eofficeModuleHasChanges()'),false,'explicit modal close discards its dirty warning: '+JSON.stringify(await evaluate(`(()=>{const s=${root},d=s.getElementById('detail');return {open:d.open,display:getComputedStyle(d).display,visibility:getComputedStyle(d).visibility,returnValue:d.returnValue};})()`)));
    });
    await check('same-account permission reduction invalidates privileged caches but preserves create drafts',async()=>{
        await moduleView('room_booking2');
        await until(root+".getElementById('bookingForm').dataset.eofficeDraftInitialized==='true'");
        await evaluate(`window.__qaDraftNode=${root}.getElementById('topic');window.__qaDraftNode.value='QA retained across permission change';window.__qaDraftNode.dispatchEvent(new Event('input',{bubbles:true}));`);
        await moduleView('edit_room_booking');
        await until(root+".getElementById('bookingListTitle').textContent==='รายการจองทั้งหมด'");
        await evaluate(`(()=>{const s=${root};s.getElementById('editModal').classList.remove('hidden');s.getElementById('editForm').dispatchEvent(new Event('eoffice:form-dirty',{bubbles:true}));})()`);
        await evaluate(`window.__qaPrivilegedNode=document.querySelector('.eoffice-module-host:not([hidden])');window.__qaRoleTransport=window.fetch;window.__qaRoleReads=0;window.fetch=async(url,opts)=>{const response=await window.__qaRoleTransport(url,opts);const p=new URL(String(url),location.href).pathname;if(!response.ok)return response;if(p==='/api/me.php'){const data=await response.json();data.user.status='User';data.user.permissions=data.user.permissions.filter(p=>p!=='room_booking');return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});}if(p==='/room_booking/api/my_bookings.php'){window.__qaRoleReads++;const data=await response.json();data.is_admin=false;data.data=[];return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});}return response;};window.dispatchEvent(new Event('eoffice:permissions-changed'));`);
        await until("window.eofficeSessionState.status==='authenticated' && window.eofficeUser.status==='User'");
        await until("!!document.querySelector('.eoffice-module-status button')");
        assert.equal(await evaluate('window.__qaRoleReads'),0,'old privileged context must not refresh or write after scope changed');
        assert.equal(await evaluate("document.querySelectorAll('.eoffice-module-host:not([hidden])').length"),0);
        await evaluate("window.__qaConfirm=window.confirm;window.confirm=()=>false;document.querySelector('.eoffice-module-status button').click()");await sleep(100);
        assert.equal(await evaluate('window.__qaPrivilegedNode.isConnected'),true,'cancel must retain the stale draft without displaying it');
        await evaluate("window.confirm=()=>true;document.querySelector('.eoffice-module-status button').click()");
        await until(`window.__qaRoleReads>0 && !!document.querySelector('.eoffice-module-host:not([hidden])') && ${root}.getElementById('bookingListTitle').textContent==='รายการจองของฉัน'`);
        assert.equal(await evaluate("window.__qaPrivilegedNode.isConnected"),false,'privileged DOM/context must be disposed');
        await evaluate('window.confirm=window.__qaConfirm');
        await moduleView('room_booking2');
        assert.equal(await evaluate(`${root}.getElementById('topic')===window.__qaDraftNode && window.__qaDraftNode.value==='QA retained across permission change'`),true);
        await evaluate(`${root}.getElementById('bookingForm').reset();window.fetch=window.__qaRoleTransport;window.dispatchEvent(new Event('eoffice:permissions-changed'))`);
        await until("window.eofficeSessionState.status==='authenticated' && window.eofficeUser.status==='Admin'");
    });
    await check('direct module bookmark joins the application shell',async()=>{
        await send('Page.navigate',{url:base+'/room_booking/new_room.html'});
        await until("location.pathname==='/index.php' && location.search==='?view=room_booking2' && !!document.querySelector('.eoffice-module-host:not([hidden])')");
        await evaluate('window.__qaDocument=document;window.__qaSidebar=document.getElementById("sidebar")');
    });
    await check('failed module fetch can retry without replacing the shell',async()=>{
        await evaluate(`window.__qaTransport=window.fetch;window.__qaFailed=false;window.fetch=(url,opts)=>{if(String(url).endsWith('/maintenance_requests/admin.html')&&!window.__qaFailed){window.__qaFailed=true;return Promise.resolve(new Response('QA unavailable',{status:503}));}return window.__qaTransport(url,opts);};showView('maintenance_admin');`);
        await until("!!document.querySelector('.eoffice-module-status button')");
        assert.equal(await evaluate("document.querySelector('#module-viewport .eoffice-skeleton')===null && document.getElementById('module-viewport').hasAttribute('aria-busy')===false"),true,'failure replaces loading with error/retry, not an endless skeleton');
        assert.equal(await evaluate('document===window.__qaDocument'),true);
        await evaluate("document.querySelector('.eoffice-module-status button').click()");
        await until("location.search==='?view=maintenance_admin' && !!document.querySelector('.eoffice-module-host:not([hidden])') && !document.querySelector('.eoffice-module-status')");
        await moduleView('room_booking2');
    });
    await check('account switch hides cached private modules and blocks old-owner form submission',async()=>{
        await until(root+".getElementById('bookingForm').dataset.eofficeDraftInitialized==='true'");
        await evaluate(`(()=>{const s=${root},set=(id,v)=>{const n=s.getElementById(id);n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));};for(const [id,v]of Object.entries({requesterName:'QA owner boundary',department:'QA',topic:'QA must not send',attendees:'3',startTime:'09:00'}))set(id,v);set('roomSelect',[...s.getElementById('roomSelect').options].find(o=>o.value&&o.value!=='อื่นๆ').value);s.getElementById('agreement').checked=true;})()`);
        assert.equal(await evaluate(root+".getElementById('bookingForm').checkValidity()"),true);
        await evaluate(`window.__qaOldForm=${root}.getElementById('bookingForm');window.__qaNativeFetch=window.fetch;window.__qaCreatePosts=0;window.fetch=(url,opts)=>{if(String(url).includes('/room_booking.php') && opts?.method==='POST')window.__qaCreatePosts++;return window.__qaNativeFetch(url,opts);};`);
        await evaluate(`fetch('/api/auth_login.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'qa-outsider@siya.ac.th',password:'Review-Test-2026!'})}).then(r=>r.json()).then(()=>window.dispatchEvent(new Event('eoffice:permissions-changed')))`);
        await until("window.eofficeSessionState.status==='authenticated' && window.eofficeFormOwner.hasConflict()");
        assert.equal(await evaluate("document.querySelectorAll('.eoffice-module-host:not([hidden])').length"),0);
        await evaluate("window.__qaOldForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");await sleep(300);
        assert.equal(await evaluate('window.__qaCreatePosts'),0);
        await evaluate(`fetch('/api/auth_login.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'qa-admin@siya.ac.th',password:'Review-Test-2026!'})}).then(r=>r.json()).then(()=>window.dispatchEvent(new Event('eoffice:permissions-changed')))`);
        await until("window.eofficeSessionState.status==='authenticated' && window.eofficeUser.status==='Admin'");
        assert.equal(await evaluate('window.eofficeFormOwner.hasConflict()'),true);
        assert.equal(await evaluate("document.querySelectorAll('.eoffice-module-host:not([hidden])').length"),0);
    });
    assert.deepEqual(exceptions,[],'module scripts must not emit uncaught exceptions');
    console.log(`Same-document browser QA: ${passed} passed`);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    try{if(socket?.readyState===1)await send('Browser.close');}catch{}socket?.close();browser.kill();
    await sleep(300);try{fs.rmSync(profile,{recursive:true,force:true});}catch{}
});
