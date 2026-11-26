const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

module.exports = async ({base,tokens,month,today}) => {
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
    const press = async (key, windowsVirtualKeyCode) => {
        const params = {key,code:key,windowsVirtualKeyCode,nativeVirtualKeyCode:windowsVirtualKeyCode};
        if (key === 'Enter') {
            params.text = '\r';
            params.unmodifiedText = '\r';
        }
        await send('Input.dispatchKeyEvent',{type:'keyDown',...params});
        await send('Input.dispatchKeyEvent',{type:'keyUp',...params});
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
        await until(`window.eofficeSessionState?.status === 'guest' && location.search === '?view=official_travel' && ${el('presence-list')}?.querySelectorAll('.travel-presence-person').length === 3`);
        await until(`[...${el('presence-list')}.querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0)`);
        assert.equal(await evalPage("document.querySelector('#group_menu_official_travel').hidden"),false,'guests see the public calendar link');
        assert.equal(await evalPage(`document.querySelector('#modalOverlay')?.classList.contains('active')`),false,'the login modal must stay closed on the public calendar');
        assert.equal(await evalPage(`${el('new')}.hidden`),true,'guests cannot add schedules');
        assert.equal(await evalPage(`${el('presence-list')}.querySelectorAll('.travel-presence-person').length`),3);
        await session('secretary');
        await send('Page.navigate',{url:base+'/index.php?view=official_travel'});
        await until(`${el('new')}?.checkVisibility() && !${el('new')}.disabled`);
        await send('Page.bringToFront');
        await press('Tab',9);
        await until("window.eofficeSessionState?.status === 'authenticated' && window.eofficeUser?.id === 2");
        await until(`${el('new')}?.checkVisibility() && !${el('new')}.disabled`);
        assert.equal(await evalPage("document.querySelector('#group_menu_official_travel').hidden"),false,'travel secretary sees the calendar link');
        assert.equal(await evalPage(`${el('grid')}.checkVisibility()`),true);
        assert.ok(await evalPage(`${el('presence-list')}.querySelector('.travel-presence-avatar-wrap').getBoundingClientRect().width`) >= 47,'desktop executive avatars are enlarged');
        const todayCell = `${el('grid')}.querySelector('[data-date="${today}"]')`;
        const todayCount = today === `${month}-01` ? 4 : 3;
        assert.equal(await evalPage(`${el('selected-date')}.dateTime`),today);
        assert.equal(await evalPage(`${el('selected-today')}.checkVisibility()`),true);
        assert.equal(await evalPage(`(() => {const count=${el('grid')}.querySelector('.travel-day-count[data-count="0"]');return !!count && getComputedStyle(count).visibility==='hidden';})()`),true);
        const selectedSummary = await evalPage(`${el('selected-items')}.textContent`);
        assert.match(selectedSummary,/QA timed venue.*09:00–16:30 น\./);
        assert.match(selectedSummary,/QA cancelled meeting.*ยกเลิก/);
        assert.equal(await evalPage(`${el('selected-count')}.textContent`),`${todayCount} กำหนดการ`);
        assert.equal(await evalPage(`${todayCell}.dataset.count`),String(todayCount));
        assert.equal(await evalPage(`${todayCell}.getAttribute('aria-pressed')`),'true');
        assert.equal(await evalPage(`!${el('day-dialog')}`),true,'date selection must not open an overflow dialog');
        await until(`[...${el('presence-list')}.querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0)`);
        const presence = await evalPage(`(() => {
            const items = [...${el('presence-list')}.querySelectorAll('.travel-presence-person')];
            return {
                count: items.length,
                summary: ${el('presence-summary')}.textContent,
                photos: items.filter(item => item.querySelector('img')?.naturalWidth > 0).length,
                away: items.filter(item => item.dataset.presence === 'away').map(item => item.querySelector('.travel-presence-name').textContent),
                awayFilter: getComputedStyle(${el('presence-list')}.querySelector('.travel-presence-person[data-presence=away] .travel-presence-avatar')).filter
            };
        })()`);
        assert.equal(presence.count,3);
        assert.equal(presence.summary,'อยู่ 1 · ไม่อยู่ 2');
        assert.equal(presence.photos,3);
        assert.deepEqual(presence.away.sort(),['รองทดสอบ','ผู้บริหารทดสอบ'].sort());
        assert.match(presence.awayFilter,/grayscale/);
        assert.equal(await evalPage(`${el('presence')}.checkVisibility() && ${el('presence')}.nextElementSibling.classList.contains('travel-selected-heading')`),true,'selected-day executives appear above the schedule heading');
        const firstDate = `${month}-01`;
        await evalPage(`${el('grid')}.querySelector('[data-date="${firstDate}"]').focus()`);
        await press('Enter',13);
        await until(`${el('selected-date')}.dateTime === '${firstDate}'`);
        assert.match(await evalPage(`${el('selected-items')}.textContent`),/QA continuation.*เดินทางต่อเนื่องจากวันก่อน/);
        assert.equal(await evalPage(`${el('grid')}.querySelector('[data-date="${firstDate}"]').getAttribute('aria-pressed')`),'true');
        assert.equal(await evalPage(`${root}.activeElement===${el('grid')}.querySelector('[data-date="${firstDate}"]')`),true,'selecting a date with the keyboard keeps focus on it');
        await evalPage(`${todayCell}.click()`);
        await until(`${el('selected-date')}.dateTime === '${today}'`);
        await evalPage(`${el('view-list')}.click()`);
        assert.equal(await evalPage(`${el('agenda')}.checkVisibility() && !${el('calendar-layout')}.checkVisibility()`),true);
        assert.match(await evalPage(`${el('agenda')}.querySelector('time[datetime="${month}-01"]').closest('section').textContent`),/QA continuation.*ต่อเนื่องจากเดือนก่อน/);
        assert.equal(await evalPage(`[...${el('agenda')}.querySelectorAll('button')].filter(button=>button.textContent.includes('QA continuation')).length`),1);
        assert.equal(await evalPage(`${el('agenda')}.querySelector('time[datetime="${today}"]').getAttribute('aria-current')`),'date');
        const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0,10);
        if (tomorrow.startsWith(month)) {
            assert.match(await evalPage(`${el('agenda')}.querySelector('time[datetime="${tomorrow}"]').closest('section').textContent`),
                /กำหนดการถัดไป.*QA upcoming meeting/);
        }
        await evalPage(`${el('view-grid')}.click()`);
        await evalPage(`(()=>{const department=${el('department')};department.value='budget';department.dispatchEvent(new Event('change'));})()`);
        assert.equal(await evalPage(`${el('selected-empty')}.textContent`),'ไม่พบกำหนดการตามตัวกรองในวันที่เลือก');
        assert.equal(await evalPage(`${todayCell}.dataset.count`),'0');
        await evalPage(`${el('clear')}.click()`);
        assert.equal(await evalPage(`${el('clear')}.hidden && ${el('department')}.value==='' && ${el('person')}.value==='' && ${root}.activeElement===${el('department')}`),true);
        await evalPage(`(() => {
            window.__travelLoadingTexts=[];
            const feedback=${el('feedback')};
            new MutationObserver(() => {
                if (feedback.textContent.includes('กำลังโหลด')) window.__travelLoadingTexts.push(feedback.textContent);
            }).observe(feedback,{childList:true,characterData:true,subtree:true});
        })()`);
        for (const offset of [1,2]) {
            const target = new Date(`${month}-01T00:00:00Z`);
            target.setUTCMonth(target.getUTCMonth() - offset);
            await evalPage(`${el('prev')}.click()`);
            await until(`!${el('prev')}.disabled && !!${el('grid')}.querySelector('time[datetime="${target.toISOString().slice(0,10)}"]')`);
        }
        assert.equal(await evalPage(`window.__travelLoadingTexts.length`),0,'changing months must not announce a loading message');
        assert.equal(await evalPage(`${el('feedback')}.textContent`),'');
        await evalPage(`${el('view-list')}.click()`);
        assert.equal(await evalPage(`!${el('empty')}.hidden && ${el('empty')}.textContent==='เดือนนี้ยังไม่มีกำหนดการ'`),true);
        await evalPage(`${el('current')}.click()`);
        await until(`${el('current')}.disabled && ${el('selected-date')}.dateTime === '${today}'`);
        assert.equal(await evalPage(`window.__travelLoadingTexts.length`),0,'returning to the current month must not announce a loading message');
        assert.equal(await evalPage(`${el('feedback')}.textContent`),'');
        await evalPage(`${el('view-grid')}.click()`);
        console.log('PASS selected-day panel, compact date selection, unique cross-month agenda and scoped filters');
        assert.equal(await evalPage(`Array.from(${el('selected-items')}.querySelectorAll('.travel-entry')).every(button => !button.hasAttribute('aria-label') && button.innerText.trim().length>0)`),true,'entry names must come from their visible button text');
        const focused = await evalPage(`(() => {
            const button=${el('selected-items')}.querySelector('button[data-department=academic]');
            window.__travelKeyboardEvents=[];
            for (const type of ['keydown','keyup','click']) button.addEventListener(type,event=>window.__travelKeyboardEvents.push({type:event.type,key:event.key,trusted:event.isTrusted}));
            button.focus();
            return {active:${root}.activeElement===button,documentHasFocus:document.hasFocus()};
        })()`);
        assert.equal(focused.active,true,`entry must receive focus before Enter: ${JSON.stringify(focused)}`);
        await press('Enter',13);
        const keyboardEvents = await evalPage('window.__travelKeyboardEvents');
        assert.ok(keyboardEvents.some(event=>event.type==='keydown'&&event.key==='Enter'&&event.trusted),`native Enter keydown must reach the focused entry: ${JSON.stringify(keyboardEvents)}`);
        assert.ok(keyboardEvents.some(event=>event.type==='click'&&event.trusted),`Enter must activate the focused entry: ${JSON.stringify(keyboardEvents)}`);
        await until(`${el('detail')}?.open === true`);
        assert.equal(await evalPage(`${el('detail')}.contains(${root}.activeElement)`),true,'opening details by keyboard moves focus into the dialog');
        assert.equal(await evalPage(`${el('detail-title')}.textContent`),'<img src=x> ทดสอบ');
        assert.equal(await evalPage(`${el('detail-title')}.querySelector('img') === null`),true);
        assert.match(await evalPage(`${el('detail-items')}.textContent`),/ข้อความภายใน/);
        await press('Escape',27);
        await until(`${el('detail')}?.open === false`);
        assert.equal(await evalPage(`${el('selected-items')}.querySelector('button[data-department=academic]') === ${root}.activeElement`),true,'closing details restores focus to its trigger');
        console.log('PASS keyboard opens details and Escape restores focus');
        const emptyCell = `${el('grid')}.querySelector('.travel-day[data-count="0"]')`;
        const desktopLayout = `(() => {
            const box = node => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
            return {
                calendar: [box(${el('grid')}), ...Array.from(${el('grid')}.querySelectorAll('.travel-day'), box)],
                panelBottom: ${el('selected-panel')}.getBoundingClientRect().bottom,
                bottomGap: innerHeight - ${el('calendar-layout')}.closest('.travel-panel').getBoundingClientRect().bottom,
                entries: ${el('selected-items')}.children.length
            };
        })()`;
        const desktopGridHeights = [];
        for (const [width, height] of [[1440, 900], [1280, 720], [1440, 620]]) {
            await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
            await until(`innerWidth===${width} && ${el('grid')}.checkVisibility()`);
            await evalPage(`document.fonts.ready.then(() => true)`);
            await evalPage(`${todayCell}.click()`);
            const busy = await evalPage(desktopLayout);
            await evalPage(`${emptyCell}.click()`);
            const empty = await evalPage(desktopLayout);
            assert.equal(busy.entries,3);
            assert.equal(empty.entries,0);
            assert.ok(Math.abs(busy.panelBottom - empty.panelBottom) < 1,`the selected-day panel stays the same height at ${width}x${height}`);
            assert.deepEqual(busy.calendar,empty.calendar,`calendar and all day cells keep their positions and sizes at ${width}px`);
            assert.ok(empty.bottomGap >= 0 && empty.bottomGap < 70,`calendar uses the space near the bottom at ${width}x${height}: ${empty.bottomGap}px`);
            desktopGridHeights.push(empty.calendar[0][3]);
        }
        assert.ok(desktopGridHeights[0] - desktopGridHeights[2] > 200,'the calendar grows with desktop viewport height');
        await evalPage(`${todayCell}.click()`);
        const scrollTarget = await evalPage(`(() => {
            const list = ${el('selected-items')}, body = ${el('selected-body')};
            list.append(...Array.from(list.children, entry => entry.cloneNode(true)));
            const r = body.getBoundingClientRect();
            return {x:Math.round(r.left + r.width / 2), y:Math.round(r.top + r.height / 2), overflow:body.scrollHeight - body.clientHeight};
        })()`);
        assert.ok(scrollTarget.overflow > 0,'a busy day overflows within the schedule body');
        const beforeScroll = await evalPage(`[scrollY, ${el('grid')}.getBoundingClientRect().top, ${el('selected-heading')}.getBoundingClientRect().top]`);
        await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:scrollTarget.x,y:scrollTarget.y,deltaX:0,deltaY:1200});
        await until(`${el('selected-body')}.scrollTop > 0`);
        assert.equal(await evalPage(`Math.abs(${el('selected-body')}.scrollHeight - ${el('selected-body')}.clientHeight - ${el('selected-body')}.scrollTop) < 2`),true,'scroll reaches the last schedule');
        assert.deepEqual(await evalPage(`[scrollY, ${el('grid')}.getBoundingClientRect().top, ${el('selected-heading')}.getBoundingClientRect().top]`),beforeScroll,'scrolling leaves the page, grid and date heading in place');
        await evalPage(`${emptyCell}.click()`);
        assert.equal(await evalPage(`${el('selected-body')}.scrollTop`),0,'switching dates resets schedule scroll');
        assert.equal(await evalPage(`${el('presence-summary')}.textContent`),'อยู่ 3 · ไม่อยู่ 0');
        assert.equal(await evalPage(`${el('presence-list')}.querySelectorAll('[data-presence=away]').length`),0,'a date without scheduled travel marks every executive present');
        for (const control of [el('title'), el('department'), el('next'), todayCell]) {
            assert.match(await evalPage(`getComputedStyle(${control}).fontFamily`),/^["']?Prompt\b/);
        }
        console.log('PASS desktop calendar fills the viewport, stays stable across dates and uses Prompt');
        assert.equal(await evalPage(`${el('selected-items')}.querySelectorAll('.travel-entry').length`),0,'empty dates show a compact empty state');
        await evalPage(`${el('new')}.focus()`);
        await press('Enter',13);
        await until(`${el('editor')}?.open === true`);
        assert.equal(await evalPage(`${el('editor')}.contains(${root}.activeElement)`),true,'opening the editor by keyboard moves focus into the dialog');
        assert.equal(await evalPage(`${el('start-time')}.hidden && ${el('end-time')}.hidden && !${el('form')}.elements.namedItem('start_time').required && !${el('form')}.elements.namedItem('end_time').required`),true,'all-day editor hides and disables time requirements');
        const editorViewports = [
            {width:1440,height:900,sideBySide:true},
            {width:1121,height:800,sideBySide:true},
            {width:1000,height:700,sideBySide:true},
            {width:768,height:1024,sideBySide:false},
            {width:672,height:900,sideBySide:false},
            {width:896,height:800,sideBySide:false},
            {width:512,height:800,sideBySide:false},
            {width:390,height:844,sideBySide:false},
            {width:320,height:568,sideBySide:false},
            {width:844,height:390,sideBySide:false}
        ];
        for (const viewport of editorViewports) {
            await send('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:1,mobile:false});
            await until(`innerWidth===${viewport.width} && ${el('grid')}.checkVisibility()`);
            const layout = await evalPage(`(() => {
                window.scrollTo(0,0);
                const dialog=${el('editor')}, box=dialog.getBoundingClientRect();
                const calendar=${el('grid')}.getBoundingClientRect(), selected=${el('selected-panel')}.getBoundingClientRect();
                const monthNavigation=${el('month')}.closest('.travel-month-navigation').getBoundingClientRect();
                const monthControls=${el('prev')}.parentElement.getBoundingClientRect();
                const scrollHeight=dialog.scrollHeight, clientHeight=dialog.clientHeight;
                const canScroll=scrollHeight<=clientHeight || (() => {
                    dialog.scrollTop=scrollHeight;
                    const reached=dialog.scrollTop>0;
                    dialog.scrollTop=0;
                    return reached;
                })();
                return {
                    width:innerWidth,
                    overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)>innerWidth,
                    grid:${el('grid')}.checkVisibility(),
                    agenda:${el('agenda')}.checkVisibility(),
                    selected:${el('selected-items')}.checkVisibility(),
                    presence:${el('presence')}.checkVisibility(),
                    presenceHeight:${el('presence')}.getBoundingClientRect().height,
                    avatarWidth:${el('presence-list')}.querySelector('.travel-presence-avatar-wrap')?.getBoundingClientRect().width || 0,
                    sideBySide:selected.left>=calendar.right-1 && selected.top<calendar.bottom,
                    stacked:selected.top>=calendar.bottom-1,
                    calendarHeight:calendar.height,
                    headerHeight:${el('title')}.closest('header').getBoundingClientRect().height,
                    calendarBottom:calendar.bottom,
                    selectedTop:selected.top,
                    selectedBottom:selected.bottom,
                    monthNavigationHeight:monthNavigation.height,
                    monthControlsTop:monthControls.top,
                    monthControlsBottom:monthControls.bottom,
                    dialogFits:box.left>=0 && box.top>=0 && box.right<=innerWidth && box.bottom<=innerHeight && dialog.scrollWidth<=dialog.clientWidth,
                    dialogCanScroll:getComputedStyle(dialog).overflowY==='auto' && canScroll,
                    dialogContentOverflows:scrollHeight>clientHeight
                };
            })()`);
            assert.equal(layout.grid,true,`compact date calendar at ${viewport.width}px`);
            assert.equal(layout.agenda,false,`monthly list remains hidden in calendar view at ${viewport.width}px`);
            assert.equal(layout.selected,true,`selected-day agenda at ${viewport.width}px`);
            assert.equal(layout.presence,true,`selected-day executive photos at ${viewport.width}px`);
            if (viewport.width <= 390) assert.ok(layout.avatarWidth >= 38,`mobile executive avatars are enlarged at ${viewport.width}px: ${JSON.stringify(layout)}`);
            assert.equal(layout.sideBySide,viewport.sideBySide,`calendar/selected-day placement at ${viewport.width}px`);
            if (!viewport.sideBySide) assert.equal(layout.stacked,true,`selected date panel below calendar at ${viewport.width}px`);
            assert.ok(layout.headerHeight <= 46,`page header stays compact at ${viewport.width}px`);
            if (viewport.width <= 390) assert.ok(layout.calendarHeight < 325,`calendar stays compact at ${viewport.width}px: ${JSON.stringify(layout)}`);
            if (viewport.width <= 320) {
                assert.ok(layout.calendarBottom <= viewport.height,`whole month stays above the fold at ${viewport.width}px: ${JSON.stringify(layout)}`);
                assert.ok(layout.selectedTop < viewport.height && layout.presenceHeight < 100,
                    `executive photos and the selected-day heading start above the fold on the smallest screen: ${JSON.stringify(layout)}`);
                assert.ok(layout.monthControlsTop < layout.monthControlsBottom && layout.monthNavigationHeight < 40,
                    `month title and navigation share one compact row at ${viewport.width}px: ${JSON.stringify(layout)}`);
            }
            if (viewport.sideBySide) assert.ok(Math.max(layout.calendarBottom,layout.selectedBottom) <= viewport.height,`calendar and selected-day panel fit at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`);
            if (viewport.width <= 390) assert.ok(layout.selectedTop < viewport.height,`selected date starts above the fold at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`);
            assert.equal(layout.overflow,false,`page must not overflow horizontally at ${viewport.width}x${viewport.height}`);
            assert.equal(layout.dialogFits,true,`editor dialog must fit and remain scrollable at ${viewport.width}x${viewport.height}`);
            assert.equal(layout.dialogCanScroll,true,`editor dialog scroll behavior at ${viewport.width}x${viewport.height}`);
            if (viewport.height < 500) assert.equal(layout.dialogContentOverflows,true,`short viewport must expose dialog content scrolling at ${viewport.width}x${viewport.height}`);
        }
        console.log('PASS calendar and editor layout at 10 desktop, breakpoint, mobile and landscape viewports');
        await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
        await evalPage(`(() => {
            const form=${el('form')}, allDay=form.elements.namedItem('all_day');
            allDay.checked=false; allDay.dispatchEvent(new Event('change',{bubbles:true}));
        })()`);
        assert.equal(await evalPage(`!${el('start-time')}.hidden && !${el('end-time')}.hidden && ${el('form')}.elements.namedItem('start_time').required && ${el('form')}.elements.namedItem('end_time').required`),true,'timed trips reveal and require both time fields');
        await evalPage(`(() => {
            const form=${el('form')}; form.elements.namedItem('all_day').checked=true;
            form.elements.namedItem('all_day').dispatchEvent(new Event('change',{bubbles:true}));
            window.__travelConfirmDecision=false; window.__travelConfirmCalls=[];
            window.confirm=message=>{window.__travelConfirmCalls.push(message);return window.__travelConfirmDecision;};
            const subject=form.elements.namedItem('subject'); subject.value='ฉบับร่าง'; subject.dispatchEvent(new Event('input',{bubbles:true}));
        })()`);
        await press('Escape',27);
        assert.equal(await evalPage(`${el('editor')}.open && ${el('form')}.elements.namedItem('subject').value === 'ฉบับร่าง' && window.__travelConfirmCalls.length === 1`),true,'canceling the discard prompt preserves the unsaved draft');
        await evalPage('window.__travelConfirmDecision=true');
        await press('Escape',27);
        await until(`${el('editor')}?.open === false`);
        assert.equal(await evalPage(`${el('new')} === ${root}.activeElement`),true,'closing the editor restores focus to its trigger');
        console.log('PASS timed/all-day fields and Escape draft retention');
        await evalPage(`${el('new')}.click()`);
        await until(`${el('editor')}?.open === true`);
        await evalPage(`(() => {
            const f=${el('form')};
            const boxes=[...${el('executive-checkboxes')}.querySelectorAll('input[type=checkbox]')];
            for (const value of ['1','3']) {
                const box=boxes.find(input=>input.value===value);
                box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));
            }
            if (f.elements.namedItem('department')) throw Error('Department selection must not remain in the editor');
            f.elements.namedItem('subject').value='ทดสอบบันทึกจากหน้าเว็บ';
            f.elements.namedItem('place').value='ห้องทดสอบ';
            f.requestSubmit();
        })()`);
        await until(`${el('feedback')}?.textContent === 'บันทึกกำหนดการแล้ว'`);
        assert.equal(await evalPage(`[...${el('selected-items')}.querySelectorAll('.travel-entry')].filter(entry=>entry.textContent.includes('ทดสอบบันทึกจากหน้าเว็บ')).length`),2,'one add form creates both selected executives');
        assert.match(await evalPage(`${el('selected-items')}.textContent`),/รอง ผอ\. · กลุ่มบริหารวิชาการ/,'deputy department is derived from member groups');
        await evalPage(`[...${el('selected-items')}.querySelectorAll('.travel-entry')].find(entry=>entry.textContent.includes('ทดสอบบันทึกจากหน้าเว็บ')).click()`);
        await until(`${el('detail')}?.open === true`);
        await evalPage(`${el('edit')}.click()`);
        await until(`${el('editor')}?.open === true`);
        assert.equal(await evalPage(`${el('executive-checkboxes')}.hidden && !${el('executive-select')}.hidden && ${el('executive-select')}.value !== ''`),true,'edit mode uses one selected executive');
        await press('Escape',27);
        await until(`${el('editor')}?.open === false`);
        await evalPage(`(() => {const filter=${el('department')}; filter.value='academic'; filter.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        assert.equal(await evalPage(`${el('selected-items')}.querySelectorAll('button[data-department=director]').length`),0);
        assert.ok(await evalPage(`${el('selected-items')}.querySelectorAll('button[data-department=academic]').length`));
        await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
        await until(`${el('selected-items')}.checkVisibility() && ${el('grid')}.checkVisibility()`);
        assert.equal(await evalPage(`${el('agenda')}.checkVisibility()`),false);
        assert.equal(await evalPage(`${el('selected-items')}.checkVisibility() && document.documentElement.scrollWidth<=innerWidth`),true);
        await session('reader');
        await send('Page.navigate',{url:base+'/official_travel/index.html'});
        await until(`window.eofficeUser?.id === 4 && location.search === '?view=official_travel' && ${el('presence-list')}?.querySelectorAll('.travel-presence-person').length === 3`);
        assert.equal(await evalPage("document.querySelector('#group_menu_official_travel').hidden"),false,'staff without manage permission can see the public calendar link');
        assert.equal(await evalPage("document.querySelector('#modalOverlay')?.classList.contains('active')"),false,'signed-in staff still see the calendar without the login modal');
        assert.equal(await evalPage(`${el('new')}.hidden`),true,'staff without manage permission cannot add schedules');
        assert.equal(await evalPage(`fetch('/api/official-travel.php?month=${month}').then(r=>r.ok)`),true,'staff can read the public calendar API');
        await session('deputy');
        await send('Page.navigate',{url:base+'/official_travel/index.html'});
        await until(`window.eofficeUser?.id === 3 && location.search === '?view=official_travel' && !!${el('selected-items')}?.querySelector('button[data-department=academic]')`);
        assert.equal(await evalPage(`${el('new')}.hidden`),true);
        assert.equal(await evalPage(`${el('selected-items')}.checkVisibility() && ${el('grid')}.checkVisibility() && !${el('agenda')}.checkVisibility()`),true,'reader uses the compact calendar with the selected-day agenda on mobile');
        assert.equal(await evalPage("document.querySelector('#group_menu_official_travel').hidden"),false,'deputy director sees the calendar link');
        await evalPage(`${el('selected-items')}.querySelector('button[data-department=academic]').focus()`);
        await press('Enter',13);
        await until(`${el('detail')}?.open === true`);
        assert.equal(await evalPage(`${el('detail-title')}.textContent`),'<img src=x> ทดสอบ');
        assert.doesNotMatch(await evalPage(`${el('detail-items')}.textContent`),/ข้อความภายใน|เลขภายใน/);
        await press('Escape',27);
        await until(`${el('detail')}?.open === false`);
        assert.equal(await evalPage(`${el('selected-items')}.querySelector('button[data-department=academic]') === ${root}.activeElement`),true,'closing selected-day details restores focus to its trigger');
        console.log('PASS mobile selected-day agenda opens an accessible, permission-filtered detail');
        await evalPage(`${el('selected-items')}.querySelector('button[data-department=academic]').click()`);
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
