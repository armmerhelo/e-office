(() => {
    const scriptUrl = document.currentScript?.src;
    if (!scriptUrl || document.querySelector('.eoffice-app-navigation')) return;
    const appRoot = new URL('../', scriptUrl);
    const route = path => new URL(path, appRoot).href;
    const modules = [
        {label:'จัดการสมาชิก', path:'management/user_manage.html', permission:'members', group:'จัดการระบบ', icon:'♙'},
        {label:'จัดการกลุ่มงาน', path:'management/department_manage.html', permission:'departments', group:'จัดการระบบ', icon:'▣'},
        {label:'จองเลขคำสั่ง', path:'external_number_booking/external_number_booking.html', login:true, group:'ทะเบียนเอกสาร', icon:'#'},
        {label:'คำสั่ง', path:'index.php?view=public', group:'ทะเบียนเอกสาร', icon:'♧'},
        {label:'คำสั่งของฉัน', path:'email_send/my_dashboard.html', login:true, group:'ทะเบียนเอกสาร', icon:'▤'},
        {label:'ส่งอีเมลคำสั่ง', path:'email_send/doc_send_email.html', permission:'email', group:'ทะเบียนเอกสาร', icon:'✉'},
        {label:'หนังสือส่งถึง', path:'index.php?view=received', login:true, group:'ทะเบียนเอกสาร', icon:'✉'},
        {label:'ทะเบียนหนังสือรับ', path:'index.php?view=send_table', login:true, group:'ทะเบียนเอกสาร', icon:'▥'},
        {label:'จองห้องประชุม', path:'room_booking/index.html', login:true, group:'อื่น ๆ', icon:'▦'},
        {label:'ขอใช้สถานที่', path:'room_booking/new_room.html', login:true, group:'อื่น ๆ', icon:'+'},
        {label:'รายการจองห้องของฉัน', path:'room_booking/edit_room_booking.html', login:true, group:'อื่น ๆ', icon:'▤'},
        {label:'แจ้งซ่อม', path:'maintenance_requests/index.html', login:true, group:'อื่น ๆ', icon:'⚒'},
        {label:'แจ้งซ่อม (ฝ่ายงาน)', path:'maintenance_requests/admin.html', permission:'maintenance', group:'อื่น ๆ', icon:'▥'},
        {label:'ตั้งค่า AI และอีเมล', path:'email_send/ai_settings.html', admin:true, group:'อื่น ๆ', icon:'⚙'}
    ];
    const make = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    };
    const iconPaths = {
        '♙':'M15 19a4 4 0 10-8 0m4-8a4 4 0 100-8 4 4 0 000 8m8-3v6m3-3h-6',
        '▣':'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
        '#':'M7 20l4-16m2 16l4-16M5 9h16M3 15h16',
        '♧':'M11 6v13l-3-1-2-6m5-6V6c4 0 7-2 9-4v17c-2-2-5-5-9-5M6 6H5a3 3 0 000 6h6',
        '✉':'M3 7l9 6 9-6M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z',
        '▤':'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2m-6 0a2 2 0 012-2h2a2 2 0 012 2m-6 0a2 2 0 002 2h2a2 2 0 002-2m-6 9l2 2 4-4',
        '▥':'M12 6c-3-2-7-2-9-1v14c3-1 6-1 9 1m0-14c3-2 7-2 9-1v14c-3-1-6-1-9 1m0-14v14',
        '▦':'M8 7V3m8 4V3M5 7h14v14H5V7zm0 4h14',
        '+':'M12 4v16m8-8H4',
        '⚒':'M14 6a5 5 0 00-7 6l-4 4a2 2 0 003 3l4-4a5 5 0 006-7l-3 3-3-3 4-4',
        '⚙':'M12 8a4 4 0 100 8 4 4 0 000-8m0-5v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2'
    };
    const nav = make('nav', 'eoffice-app-navigation');
    nav.id = 'eoffice-module-sidebar';
    nav.setAttribute('aria-label', 'เมนูหลัก E-Office');
    const brand = make('a', 'eoffice-app-navigation__brand');
    brand.href = route('index.php?view=received');
    const logo = make('img');
    logo.src = route('img/icon_app_xl.png'); logo.alt = 'E-Office'; logo.width = 60; logo.height = 60;
    const identity = make('div', 'eoffice-app-navigation__identity');
    identity.append(brand);
    brand.append(logo, make('strong', '', 'ระบบหนังสือราชการ E-Office'), make('span', '', 'โรงเรียนศรียานุสรณ์'));
    const userName = make('p', 'eoffice-app-navigation__user');
    identity.append(userName);
    const list = make('div', 'eoffice-app-navigation__links');
    const groups = [];
    let previousGroup;
    for (const item of modules) {
        if (item.group !== previousGroup) {
            const heading = make('p', 'eoffice-app-navigation__group', item.group);
            list.append(heading); groups.push({heading, links:[]}); previousGroup = item.group;
        }
        const link = make('a', 'eoffice-app-navigation__link');
        link.href = route(item.path); link.dataset.path = item.path;
        const icon = document.createElementNS('http://www.w3.org/2000/svg','svg');
        icon.setAttribute('class','eoffice-app-navigation__icon');icon.setAttribute('viewBox','0 0 24 24');
        icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.6');icon.setAttribute('aria-hidden','true');
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',iconPaths[item.icon]);path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');icon.append(path);
        link.append(icon, make('span', '', item.label));
        if (item.permission) link.dataset.permission = item.permission;
        if (item.login) link.dataset.requiresLogin = 'true';
        if (item.admin) link.dataset.requiresAdmin = 'true';
        if (new URL(link.href).pathname === location.pathname) {link.setAttribute('aria-current','page');link.classList.add('is-current');}
        list.append(link); groups[groups.length - 1].links.push(link);
    }
    const logout = make('button', 'eoffice-app-navigation__logout', 'ออกจากระบบ'); logout.type = 'button';
    const login = make('a', 'eoffice-app-navigation__link', 'เข้าสู่ระบบ'); login.href = route('index.php?view=received');
    nav.append(identity, list, make('p', 'eoffice-app-navigation__group', 'ผู้ใช้งาน'), logout, login,
        make('p', 'eoffice-app-navigation__footer', 'พบปัญหาติดต่อ ครูภูธเนศ\nE-OFFICE ศรียานุสรณ์'));

    const header = make('header', 'eoffice-module-header');
    const mobileBrand = make('a', '', 'E-Office SIYA'); mobileBrand.href = brand.href;
    const toggle = make('button', 'eoffice-module-menu-toggle', '☰'); toggle.type = 'button';
    toggle.setAttribute('aria-label','เปิดเมนู'); toggle.setAttribute('aria-controls',nav.id);toggle.setAttribute('aria-expanded','false');
    header.append(mobileBrand, toggle);
    const overlay = make('div', 'eoffice-module-backdrop'); overlay.hidden = true;
    const content = make('div', 'eoffice-module-content');
    const view = make('div', 'eoffice-module-view');
    view.dataset.page = location.pathname;
    if (location.pathname.endsWith('/room_booking/index.html')) view.classList.add('eoffice-calendar-view');
    while (document.body.firstChild) view.append(document.body.firstChild);
    content.append(view);
    document.body.append(header, nav, overlay, content);
    document.body.classList.add('eoffice-module-page');
    const stylesheet = make('link');stylesheet.rel='stylesheet';stylesheet.href=new URL('app-navigation.css?v=20261009-sidebar2',scriptUrl).href;document.head.append(stylesheet);
    if (!document.querySelector('link[href*="family=Prompt"]')) {
        const font=make('link');font.rel='stylesheet';font.href='https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600&display=swap';document.head.append(font);
    }

    const desktop = window.matchMedia('(min-width: 64rem)');
    const narrow = window.matchMedia('(max-width: 639px)');
    const registryLink=[...list.querySelectorAll('a')].find(link=>link.dataset.path==='index.php?view=send_table');
    const fitRegistry=()=>{if(registryLink)registryLink.href=route(`index.php?view=${narrow.matches?'send':'send_table'}`);};
    narrow.addEventListener('change',fitRegistry);fitRegistry();
    let open = false, previousOverflow;
    function setOpen(value, focus = true) {
        const wasOpen = open;
        open = !desktop.matches && value;
        nav.dataset.open = String(open); nav.inert = !desktop.matches && !open;
        overlay.hidden = !open; content.inert = open;
        toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'ปิดเมนู':'เปิดเมนู');
        if (open) {
            if (previousOverflow === undefined) previousOverflow = document.body.style.overflow;
            document.body.style.overflow='hidden';
            if (focus) [...nav.querySelectorAll('a,button')].find(node=>!node.hidden)?.focus();
        } else {
            if (previousOverflow !== undefined) {document.body.style.overflow=previousOverflow;previousOverflow=undefined;}
            if (wasOpen && !desktop.matches && focus) toggle.focus();
        }
    }
    toggle.addEventListener('click',()=>setOpen(!open));overlay.addEventListener('click',()=>setOpen(false));
    desktop.addEventListener('change',()=>setOpen(false));setOpen(false,false);
    document.addEventListener('keydown',event=>{
        if (!open) return;
        if (event.key==='Escape') {event.preventDefault();setOpen(false);}
        if (event.key==='Tab') {
            const nodes=[...nav.querySelectorAll('a,button')].filter(node=>!node.hidden && node.getClientRects().length);
            const first=nodes[0],last=nodes[nodes.length-1];
            if (event.shiftKey && document.activeElement===first) {event.preventDefault();last?.focus();}
            else if (!event.shiftKey && document.activeElement===last) {event.preventDefault();first?.focus();}
        }
    });
    const applyAccess = user => {
        for (const link of list.querySelectorAll('a')) link.hidden = Boolean(
            (link.dataset.requiresLogin && !user) ||
            (link.dataset.permission && !user?.permissions?.includes(link.dataset.permission)) ||
            (link.dataset.requiresAdmin && user?.status !== 'Admin'));
        for (const group of groups) group.heading.hidden = group.links.every(link=>link.hidden);
        logout.hidden=!user;login.hidden=!!user;userName.textContent=user?.name || '';
    };
    applyAccess(null);
    let accessRequest=0, acceptedSession=null, sessionRevision=0, pageOwnerId=null;
    // Replayable state for consumers whose script loads after a session event.
    window.eofficeSessionState = Object.freeze({revision: 0, status: 'pending', user: null});
    function publishSession(status) {
        const snapshot = Object.freeze({revision: ++sessionRevision, status, user: acceptedSession, pageOwnerId});
        window.eofficeSessionState = snapshot;
        window.dispatchEvent(new CustomEvent('eoffice:session-updated', {detail: snapshot}));
    }
    function updateSession(user) {
        acceptedSession = user ? Object.freeze({...user, permissions: Object.freeze([...(user.permissions || [])])}) : null;
        if (pageOwnerId === null && acceptedSession?.id) pageOwnerId=String(acceptedSession.id);
        window.eofficeUser = acceptedSession;
        applyAccess(window.eofficeUser);
        publishSession(acceptedSession ? 'authenticated' : 'guest');
    }
    const getUser=window.sessionReady?Promise.resolve(window.sessionReady):fetch(route('api/me.php'),{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(data=>data?.user??null).catch(()=>null);
    getUser.then(user=>{
        if(accessRequest===0)updateSession(user);
        else window.eofficeUser=window.eofficeSessionState.status === 'authenticated' ? acceptedSession : null; // Ignore stale initial assignments.
    });
    function refreshAccess() {
        const request=++accessRequest;
        // Suspend draft writes synchronously before starting any asynchronous verification.
        publishSession('pending');
        return fetch(route('api/me.php'),{credentials:'same-origin'}).then(r=>{
            if (!r.ok) throw new Error('Session verification failed');
            return r.json();
        }).then(data=>{
            if(request!==accessRequest)return;updateSession(data?.user??null);
        }).catch(()=>{
            if(request!==accessRequest)return;
            window.eofficeUser=null;applyAccess(null);publishSession('unavailable');
        });
    }
    window.addEventListener('eoffice:permissions-changed',refreshAccess);window.addEventListener('focus',refreshAccess);
    window.addEventListener('pageshow',event=>{if(event.persisted){setOpen(false,false);refreshAccess();}});

    // Dirty forms are tracked by user edits, never by submit (which may fail).
    const dirtyForms = new Set();
    let approvedNavigation = false, approvedDiscard = false;
    const markDirty = event => {
        const form=event.target.closest?.('form');
        if(form && form.dataset.eofficeDraftRestoring !== 'true' && form.id !== 'filters' && !form.classList.contains('filters')) {
            if (event.detail?.replayed) {dirtyForms.add(form);return;}
            dirtyForms.add(form);approvedNavigation=false;
            window.dispatchEvent(new Event('eoffice:leaving-cancelled'));
        }
    };
    document.addEventListener('input',markDirty);document.addEventListener('change',markDirty);
    document.addEventListener('eoffice:form-dirty',markDirty);
    document.addEventListener('reset',event=>{dirtyForms.delete(event.target);});
    document.addEventListener('eoffice:form-saved',event=>{if(event.target.tagName==='FORM')dirtyForms.delete(event.target);});
    const hasChanges=()=>[...dirtyForms].some(form=>form.isConnected && form.getClientRects().length);
    window.addEventListener('pageshow',()=>{approvedNavigation=false;});
    function approveLeaving(discardDrafts = false) {
        if (approvedNavigation && (!discardDrafts || approvedDiscard)) return true;
        const candidates = new Set(dirtyForms);
        if (discardDrafts) for (const form of document.querySelectorAll('form[data-eoffice-draft-state="saved"]')) candidates.add(form);
        const changed = [...candidates].filter(form=>form.isConnected && form.getClientRects().length);
        let storedDrafts=false;
        if (discardDrafts) try {
            for (let i=0;i<sessionStorage.length;i++) if (sessionStorage.key(i)?.startsWith('eoffice-draft:')) {storedDrafts=true;break;}
        } catch { /* Visible form state still supplies the warning if storage is unavailable. */ }
        if (!changed.length && !storedDrafts) return true;
        const canRecover = !discardDrafts && changed.every(form=>form.dataset.eofficeDraftState === 'saved' &&
            form.dataset.eofficeDraftUser === String(window.eofficeUser?.id));
        const warning = discardDrafts
            ? 'มีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากระบบหรือไม่? ข้อมูลที่ยังไม่ได้บันทึกและร่างทั้งหมดในแท็บนี้จะถูกล้าง'
            : canRecover
            ? 'มีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่? ร่างข้อความล่าสุดบันทึกไว้ในแท็บนี้แล้ว ไฟล์แนบต้องเลือกใหม่เมื่อกลับมา'
            : 'มีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่? ข้อมูลที่ยังไม่ได้บันทึกและไม่มีร่างจะสูญหาย';
        if (!window.confirm(warning)) {
            approvedNavigation=false;window.dispatchEvent(new Event('eoffice:leaving-cancelled'));return false;
        }
        approvedNavigation=true;approvedDiscard=discardDrafts;window.dispatchEvent(new Event('eoffice:leaving-confirmed'));return true;
    }
    window.addEventListener('beforeunload',event=>{if(!approvedNavigation && hasChanges()){event.preventDefault();event.returnValue='';}});
    document.addEventListener('click',event=>{
        const link=event.target.closest?.('a[href]');
        if(!link || event.defaultPrevented || event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || (link.target && link.target!=='_self') || link.hasAttribute('download'))return;
        const target=new URL(link.href,location.href);
        if (!['http:','https:'].includes(target.protocol)) return;
        if(target.href===location.href || (target.origin===new URL(location.href).origin && target.pathname===location.pathname && target.search===location.search))return;
        if(!approveLeaving()){event.preventDefault();event.stopImmediatePropagation();return;}
        setOpen(false,false);
    },true);
    logout.addEventListener('click',async()=>{
        if (logout.disabled) return;
        if(!approveLeaving(true))return;
        logout.disabled=true;
        try {
            const response=await fetch(route('api/logout.php'),{method:'POST',credentials:'same-origin'});const result=await response.json();
            if(!response.ok || result.status!=='success')throw new Error(result.message || 'ออกจากระบบไม่สำเร็จ');
            // The server has revoked the session. Invalidate checks started before
            // logout even if the user stays to preserve newly edited data.
            accessRequest++;updateSession(null);
            if (!approveLeaving(true)) {
                return;
            }
            localStorage.clear();sessionStorage.clear();location.assign(brand.href);
        } catch(error){approvedNavigation=false;window.dispatchEvent(new Event('eoffice:leaving-cancelled'));window.alert(error.message || 'ไม่สามารถออกจากระบบได้');}
        finally {logout.disabled=false;}
    });
})();
