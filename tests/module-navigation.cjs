const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');

// Keep every listener, as the browser does. A single callback per event type
// silently drops the first of the production page's two pageshow handlers.
function makeEventTarget(shortcuts = {}) {
    const listeners = new Map();
    const captureOf = options => typeof options === 'boolean' ? options : Boolean(options?.capture);
    const target = {
        addEventListener(type, callback, options = false) {
            const capture = captureOf(options), records = listeners.get(type) || [];
            if (!records.some(record => record.callback === callback && record.capture === capture)) {
                records.push({callback, capture, once: Boolean(options?.once)});
                listeners.set(type, records);
            }
            shortcuts[type] = event => target.emit(type, event);
        },
        removeEventListener(type, callback, options = false) {
            const capture = captureOf(options);
            listeners.set(type, (listeners.get(type) || []).filter(record => record.callback !== callback || record.capture !== capture));
        },
        emit(type, event = {type}, capture) {
            const results = [];
            for (const record of [...(listeners.get(type) || [])]) {
                if (capture !== undefined && capture !== record.capture) continue;
                if (!(listeners.get(type) || []).includes(record)) continue;
                if (record.once) target.removeEventListener(type, record.callback, record.capture);
                results.push(record.callback.call(target, event));
            }
            return results.some(value => value && typeof value.then === 'function') ? Promise.all(results) : results.at(-1);
        },
        dispatchEvent(event) { target.emit(event.type, event); return !event.defaultPrevented; },
        listenerCount(type) { return (listeners.get(type) || []).length; },
    };
    return target;
}

function checkEventTargetMock() {
    const target = makeEventTarget(), calls = [];
    const first = () => calls.push('first'), second = () => calls.push('second');
    target.addEventListener('pageshow', first);
    target.addEventListener('pageshow', second);
    target.addEventListener('pageshow', first); // Duplicate listener is ignored.
    target.dispatchEvent({type:'pageshow', persisted:true});
    assert.deepEqual(calls, ['first','second']);
    target.removeEventListener('pageshow', first);
    target.addEventListener('pageshow', first, {once:true});
    target.dispatchEvent({type:'pageshow'});target.dispatchEvent({type:'pageshow'});
    assert.deepEqual(calls, ['first','second','second','first','second']);
}
checkEventTargetMock();

const routes = {
    members: ['menu-members', 'management/user_manage.html'],
    groups: ['menu-groups', 'management/department_manage.html'],
    book: ['menu-bookdocnumber', 'external_number_booking/external_number_booking.html'],
    my_public: ['my_menu_public', 'email_send/my_dashboard.html'],
    send_email: ['send_email', 'email_send/doc_send_email.html'],
    room_booking: ['menu-bookingroom', 'room_booking/index.html'],
    edit_room_booking: ['menu-edit-room-booking', 'room_booking/edit_room_booking.html'],
    maintenance: ['menu-maintenance', 'maintenance_requests/index.html'],
    maintenance_admin: ['menu-maintenance-admin', 'maintenance_requests/admin.html']
};

const main = fs.readFileSync('assets/main.js', 'utf8');
const index = fs.readFileSync('index.php', 'utf8');
const routeSource = main.match(/const MODULE_ROUTES = Object\.freeze\(\{([\s\S]*?)\}\);/);
assert.ok(routeSource, 'main navigation should define standalone module routes');

for (const [view, [menuId, path]] of Object.entries(routes)) {
    assert.ok(routeSource[1].includes(`${view}: '${path}'`), `${view} should map to ${path}`);
    const anchor = index.match(new RegExp(`<a\\b[^>]*\\bid="${menuId}"[^>]*>`));
    assert.ok(anchor, `main menu should include ${menuId}`);
    assert.ok(anchor[0].includes(`href="${path}"`), `${menuId} should link to ${path}`);
    assert.ok(anchor[0].includes(`showView('${view}'`), `${menuId} should retain its view handler`);
}

const pages = [
    ...Object.values(routes).map(([, path]) => path),
    'room_booking/new_room.html',
    'email_send/ai_settings.html'
];
for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    assert.match(html, /assets\/app-navigation\.js/, `${page} should include the shared navigation`);
    assert.doesNotMatch(html, /<iframe\b/i, `${page} must render as a top-level page`);
    const head=html.slice(0,html.indexOf('</head>'));
    for(const file of ['app-navigation.css','sidebar.css']) assert.ok(head.includes(`../assets/${file}?`),`${page}: shell CSS must load before body paint`);
    assert.match(html,/<body\b[^>]*class="[^"]*\beoffice-module-page\b/);
    const shellScript=html.match(/<script\b[^>]*src="\.\.\/assets\/app-navigation\.js[^\"]*"[^>]*><\/script>/g)||[];
    assert.equal(shellScript.length,1,`${page}: initialize the shell exactly once`);
    assert.doesNotMatch(shellScript[0],/\b(?:defer|async)\b/,`${page}: navigation must be built before parsing page content`);
    const scriptPosition=html.indexOf(shellScript[0]);
    assert.ok(html.indexOf('class="eoffice-module-content"')<scriptPosition && html.indexOf('class="eoffice-module-view')<scriptPosition,`${page}: prepare final content geometry in HTML`);
    const firstContent=html.search(/<(?:main|form|section)\b/);
    if(firstContent>=0)assert.ok(scriptPosition<firstContent,`${page}: shell must precede module content`);
}

assert.doesNotMatch(index, /<iframe\b/i, 'the main page must not embed module frames');
assert.doesNotMatch(main, /<iframe\b/i, 'the main router must not generate module frames');
assert.doesNotMatch(main, /iframe/i, 'obsolete frame sizing, containers and branches must be removed');
assert.doesNotMatch(index, /iframe/i, 'obsolete frame messaging must be removed from the main page');
assert.match(main, /window\.location\.assign\(moduleRoute\)/, 'module selections should open the standalone page');
assert.match(main, /requestedViewFromUrl\(\)/, 'the main inbox should accept direct view links');
assert.match(fs.readFileSync('assets/app-navigation.js', 'utf8'), /eoffice:permissions-changed/);
assert.doesNotMatch(fs.readFileSync('assets/member-management.js', 'utf8'), /window\.parent\.postMessage/);

console.log(`PASS ${Object.keys(routes).length} module routes and ${pages.length} top-level pages use shared navigation`);

// Main and module markup must use the same sidebar contract and menu icons.
function sidebarParityChecks() {
    const navigation=fs.readFileSync('assets/app-navigation.js','utf8');
    assert.match(index,/assets\/sidebar\.css/);
    assert.ok(navigation.includes("'sidebar.css'"));
    const modules=vm.runInNewContext(navigation.match(/const modules = (\[[\s\S]*?\n    \]);/)[1]);
    const icons=vm.runInNewContext('('+navigation.match(/const iconPaths = (\{[\s\S]*?\n    \});/)[1]+')');
    for (const item of modules) {
        const anchor=index.match(new RegExp(`<a\\b(?=[^>]*\\bid=)[^>]*href="${item.path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"[^>]*>([\\s\\S]*?)</a>`));
        assert.ok(anchor,`${item.path} must be accessible from both sidebars`);
        const label=anchor[1].replace(/<svg[\s\S]*?<\/svg>/g,'').replace(/<[^>]*>/g,'').trim();
        assert.equal(label,item.label,`${item.path}: sidebar labels must match`);
        assert.equal(anchor[1].match(/\bd="([^"]+)"/)[1],icons[item.icon],`${item.path}: sidebar icons must match`);
    }
    const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,{style:{},tagName:'LI'});return nodes.get(id);};
    const runtime={window:{},document:{getElementById:el},display_style:(id,display)=>{el(id).style.display=display;}};
    vm.createContext(runtime);
    vm.runInContext(main.slice(main.indexOf('function eofficeCan('),main.indexOf('let permissionRefreshSequence')),runtime);
    for(const user of [null,{status:'User',permissions:[]},{status:'User',permissions:['email']},{status:'Admin',permissions:['email','members','departments','maintenance']}]) {
        runtime.window.eofficeUser=user;runtime.applyPermissionMenus();
        assert.equal(el('group_ai_settings').style.display,user?.status==='Admin'?'block':'none');
        assert.equal(el('group_menu_request_room').style.display,user?'block':'none');
    }
    console.log('PASS shared sidebar stylesheet, all menu labels/icons and Admin-only AI/request-room visibility');
}
sidebarParityChecks();

// Execute the real router without the rest of the document UI or network requests.
const router = main.slice(main.indexOf('function showView('), main.indexOf('function view_doc_public('));
const elements = new Map();
const el = id => {
    if (!elements.has(id)) elements.set(id, {style:{}, value:'', innerHTML:''});
    return elements.get(id);
};
const values = new Map();
const sessionValues = new Map();
const routerEvents = {};
const routerWindowEvents = makeEventTarget(routerEvents);
const historyEntries = ['http://localhost/index.php'];
let historyPosition = 0;
const recordHistory = (url, push) => {
    if (push) { historyEntries.splice(historyPosition + 1); historyEntries.push(String(url)); historyPosition++; }
    else historyEntries[historyPosition] = String(url);
    context.window.location.href = String(url);
};
const context = {
    window: {...routerWindowEvents,eofficeUser:{permissions:['members','departments','email','maintenance']},location:{href:'http://localhost/index.php',assign:path => context.navigated = path}},
    document: {body:{style:{}},getElementById:el},
    MODULE_ROUTES: Object.freeze(Object.fromEntries([...Object.entries(routes).map(([key,[,path]]) => [key,path]), ['room_booking2','room_booking/new_room.html']])),
    restrictedViewPermission:view => ({members:'members',groups:'departments',send_email:'email',maintenance_admin:'maintenance'})[view],
    eofficeCan:permission => Boolean(context.window.eofficeUser?.permissions.includes(permission)),
    getCookie:() => context.window.eofficeUser ? 'session' : null,
    setSidebarOpen(){}, display_style:(id,display) => { el(id).style.display = display; },
    localStorage:{getItem:key => values.get(key),setItem:(key,value) => values.set(key,value)},
    sessionStorage:{getItem:key => sessionValues.get(key)??null,setItem:(key,value)=>sessionValues.set(key,value),removeItem:key=>sessionValues.delete(key)},
    closeModal(){},applyPermissionMenus(){},User_Status:'Admin',refreshPermissionMenus(){},invalidateDocumentRequests(){},
    get_data_api_received:() => {context.loaded='received';},get_data_api_send:() => {context.loaded='send';},
    get_data_api_public:() => {context.loaded='public';},get_data_api_send_table:() => {context.loaded='send_table';},
    history:{replaceState:(_,__,url) => recordHistory(url,false),pushState:(_,__,url)=>recordHistory(url,true)}, URL, console:{log(){}}, id:null,
    className_default:'default',className_click:'active'
};
for (const name of ['components_pagination','search_menu','send_email','menu_maintenance','menu_maintenance_admin','my_public','menu_members','menu_groups','menu_send','menu_send_table','menu_received','menu_bookdocnumber','menu_public','menu_bookingroom','menu_edit_room_booking','current_view_title','sub_head','content_received','add_doc_btn','load_data']) context[name] = el(name);
vm.createContext(context);
vm.runInContext(main.slice(main.indexOf('const DOCUMENT_VIEWS'),main.indexOf("window.addEventListener('eoffice:permissions-changed'")),context);
vm.runInContext(router, context);
for (const [view,path] of Object.entries(context.MODULE_ROUTES)) {
    context.navigated=null;
    context.showView(view,'load');
    assert.equal(context.navigated,path,`${view} should navigate without touching an old container`);
}
for (const view of ['constructor','toString','__proto__','missing','received','send','public','send_table']) {
    context.navigated=null;
    context.showView(view,'load');
    assert.equal(context.navigated,null);
    assert.equal(context.loaded,['received','send','public','send_table'].includes(view)?view:'received');
    assert.equal(new URL(context.window.location.href).searchParams.get('view'),context.loaded);
}
context.window.eofficeUser={permissions:[]};
context.showView('members','load');
assert.equal(context.loaded,'received');
context.window.eofficeUser=null;
context.showView('room_booking','load');
assert.equal(context.loaded,'public');
console.log('PASS real router: module redirects, document tabs, invalid/prototype routes, denied permissions and guests');

context.window.eofficeUser={permissions:['members','departments','email','maintenance']};
const mounted=[];
context.window.eofficeModuleRouter={open:(view,options)=>mounted.push({view,...options}),leave:()=>true};
context.navigated=null;
for(const view of Object.keys(context.MODULE_ROUTES))context.showView(view,'load');
assert.equal(mounted.length,Object.keys(context.MODULE_ROUTES).length);
assert.equal(context.navigated,null,'persistent host must replace module redirects');
context.showView('public','load');assert.equal(context.loaded,'public','document views still use the existing renderer');
delete context.window.eofficeModuleRouter;
console.log('PASS same-document main router delegates all module views without location navigation');

const startupStart=main.indexOf('    var currentPage = localStorage.getItem("currentPage");');
const startupEnd=main.indexOf('    if (getCookie("User_Token") === null)',startupStart);
const startup=new vm.Script('{'+main.slice(startupStart,startupEnd)+'}');
for (const view of Object.keys(context.MODULE_ROUTES)) {
    context.window.eofficeUser=null;
    context.window.location.href=`http://localhost/index.php?view=${view}`;
    context.showView(view,'load');
    assert.equal(context.loaded,'public');
    assert.equal(sessionValues.get('eoffice-login-view'),view,'guest module target must survive canonicalization');
    // Guest startup displays public again after opening its login modal.
    context.showView('public','load');
    context.window.eofficeUser={permissions:['members','departments','email','maintenance']};
    context.navigated=null;
    startup.runInContext(context);
    assert.equal(context.navigated,context.MODULE_ROUTES[view]);
    assert.equal(sessionValues.has('eoffice-login-view'),false,'return destination is consumed once');
}
sessionValues.set('eoffice-login-view','https://example.test/');
context.window.location.href='http://localhost/index.php?view=public';
context.navigated=null;startup.runInContext(context);assert.equal(context.navigated,null);
sessionValues.set('eoffice-login-view','members');
context.window.eofficeUser={permissions:[]};startup.runInContext(context);
assert.equal(context.loaded,'received');assert.equal(context.navigated,null);
assert.equal(sessionValues.size,0);
assert.equal(context.navigateView({ctrlKey:true,button:0},'public'),true);
console.log('PASS login return: all module targets, guest reload, one-time consumption, invalid targets and denied permissions');

async function historyChecks() {
    context.window.eofficeUser={permissions:[]};
    context.window.location.href='http://localhost/index.php?view=received';
    historyEntries.splice(0,historyEntries.length,context.window.location.href);historyPosition=0;
    context.showView('received','load');
    const click={button:0};
    assert.equal(context.navigateView(click,'public'),false);
    assert.equal(context.navigateView(click,'send_table'),false);
    assert.equal(historyEntries.length,3);
    const count=historyEntries.length;
    context.window.location.href=historyEntries[--historyPosition];
    await routerEvents.popstate();
    assert.equal(context.loaded,'public');assert.equal(context.menu_public.className,'active');
    context.window.location.href=historyEntries[--historyPosition];
    await routerEvents.popstate();
    assert.equal(context.loaded,'received');assert.equal(context.menu_received.className,'active');
    context.window.location.href=historyEntries[++historyPosition];await routerEvents.popstate();
    assert.equal(context.loaded,'public');
    assert.equal(historyEntries.length,count,'Back/Forward must not add history entries');
    startup.runInContext(context);assert.equal(context.loaded,'public','refresh retains current URL view');
    for(const [view,menuId] of Object.entries({public:'menu-public',received:'menu-received',send:'menu-send',send_table:'menu-send-table'})) {
        const anchor=index.match(new RegExp(`<a\\b[^>]*\\bid="${menuId}"[^>]*>`))[0];
        assert.ok(anchor.includes(`href="index.php?view=${view}"`));
        assert.ok(anchor.includes(`return navigateView(event, '${view}')`));
    }
    console.log('PASS document history: real menu handler, Back, Forward, refresh, highlight and modified clicks');
}
historyChecks().catch(error=>{console.error(error);process.exitCode=1;});

// Exercise navigation lifecycle with controllable session responses.
class Element {
    constructor(tag) { this.tag=tag;this.tagName=tag.toUpperCase(); this.children=[]; this.dataset={}; this.hidden=false; this.events={};this.captures={};this.eventTarget=makeEventTarget(); this.attributes={};const classes=new Set();this.classList={add:className=>classes.add(className),contains:className=>classes.has(className)}; this.style={};this.isConnected=true; }
    get firstChild() {return this.children[0] || null;}
    append(...nodes) {for(const node of nodes){if(node.parent)node.parent.children.splice(node.parent.children.indexOf(node),1);node.parent=this;this.children.push(node);}}
    insertBefore(node) { this.children.unshift(node); }
    setAttribute(key,value) { this.attributes[key]=value; }
    addEventListener(name,fn,options=false) {
        const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
        this.eventTarget.addEventListener(name,fn,options);
        (capture?this.captures:this.events)[name]=event=>this.eventTarget.emit(name,event,capture);
    }
    removeEventListener(name,fn,options=false) { this.eventTarget.removeEventListener(name,fn,options); }
    dispatchEvent(event) { return this.eventTarget.dispatchEvent(event); }
    querySelectorAll(tags) {const list=tags.split(','); return this.children.flatMap(child => [...(list.includes(child.tag)?[child]:[]),...child.querySelectorAll(tags)]); }
    contains(node) { return this===node || this.children.some(child => child.contains(node)); }
    getClientRects() {return this.hidden?[]:[{}];}
    hasAttribute(key) {return key in this.attributes;}
    closest(selector) {if(selector==='form' && this.tag==='form')return this;if(selector==='a[href]' && this.tag==='a')return this;return this.parent?.closest(selector) || null;}
    focus() { this.focused=true; }
}
async function navigationChecks() {
    const head=new Element('head'),body=new Element('body'),events={},pending=[],sessions=[],sessionStates=[];
    const windowEvents=makeEventTarget(events), documentEvents=makeEventTarget(events);
    let firstUser,confirmed=false,lastWarning='';
    const media={matches:false,addEventListener:(name,fn)=>{media.change=fn;}};
    const narrow={matches:false,addEventListener(){}};
    const window={...windowEvents,sessionReady:new Promise(resolve=>{firstUser=resolve;}),dispatchEvent(event){if(event.type==='eoffice:session-updated'){sessionStates.push(event.detail);if(['authenticated','guest'].includes(event.detail.status))sessions.push(event.detail.user);}return windowEvents.dispatchEvent(event);},matchMedia:query=>query.includes('639')?narrow:media,alert(){},confirm:message=>{lastWarning=message;return confirmed;}};
    const doc={...documentEvents,head,body,title:'Test',currentScript:{src:'http://localhost/eoffice/assets/app-navigation.js'},querySelector:()=>null,querySelectorAll:()=>body.querySelectorAll('form').filter(form=>form.dataset.eofficeDraftState==='saved'),createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};
    vm.runInNewContext(fs.readFileSync('assets/app-navigation.js','utf8'),{document:doc,window,location:{href:'http://localhost/eoffice/management/user_manage.html',pathname:'/eoffice/management/user_manage.html'},URL,
        fetch:()=>new Promise(resolve=>pending.push(resolve)),localStorage:{},sessionStorage:{},Event,CustomEvent});
    const nav=body.children.find(el=>el.tag==='nav'),header=body.children.find(el=>el.tag==='header');
    const list=nav.children.find(el=>el.className==='eoffice-app-navigation__links');
    const toggle=header.children[1],content=body.children.find(el=>el.className==='eoffice-module-content');
    assert.equal(nav.inert,true);
    assert.equal(windowEvents.listenerCount('pageshow'),2,'both the BFCache verification and navigation approval reset must be registered');
    const tick=()=>new Promise(resolve=>setImmediate(resolve));
    const admin={status:'Admin',permissions:['members','departments','email','maintenance']};
    events.focus();
    assert.equal(window.eofficeSessionState.status,'pending','verification must publish pending synchronously, before any response');
    pending.shift()({ok:true,json:async()=>({user:null})});await tick();
    window.eofficeUser=admin;firstUser(admin);await tick();
    assert.equal(window.eofficeUser,null,'late initial security assignment must not replace the latest accepted session');
    assert.deepEqual(sessions,[null],'only the accepted refresh may publish a session update');
    assert.equal(list.children.filter(link=>link.tag==='a' && !link.hidden).length,1,'a late initial session must not restore logged-out menus');
    events.focus();events.focus();
    const lastPendingRevision=window.eofficeSessionState.revision;
    const older=pending.shift(),latest=pending.shift();
    latest({ok:true,json:async()=>({user:null})});await tick();
    older({ok:true,json:async()=>({user:admin})});await tick();
    assert.equal(sessionStates.at(-1).status,'guest');assert.ok(sessionStates.at(-1).revision>lastPendingRevision);
    assert.ok(sessions.every(user=>user===null),'stale session responses must not restart draft ownership');
    assert.equal(list.children.filter(link=>link.tag==='a' && !link.hidden).length,1,'an older refresh must not restore revoked menus');
    events.focus();pending.shift()({ok:true,json:async()=>({user:admin})});await tick();
    assert.equal(JSON.stringify(sessions.at(-1)),JSON.stringify(admin),'successful refresh should publish the recovered session');
    assert.equal(JSON.stringify(window.eofficeSessionState.user),JSON.stringify(admin),'the latest accepted session is replayable to late consumers');
    assert.equal(Object.isFrozen(window.eofficeSessionState),true);assert.equal(Object.isFrozen(window.eofficeSessionState.user),true);
    assert.equal(Object.isFrozen(window.eofficeSessionState.user.permissions),true);
    assert.ok(window.eofficeSessionState.revision > 1);
    const verifiedState=window.eofficeSessionState;
    events.focus();events.focus();
    assert.equal(window.eofficeSessionState.status,'pending');
    const olderVerification=pending.shift(),newerVerification=pending.shift();
    olderVerification({ok:true,json:async()=>({user:admin})});await tick();
    assert.equal(window.eofficeSessionState.status,'pending','an older successful response cannot resume writes while the newer verification is pending');
    newerVerification({ok:false,status:503});await tick();
    assert.equal(window.eofficeSessionState.status,'unavailable');assert.equal(window.eofficeUser,null);
    assert.equal(window.eofficeSessionState.user,verifiedState.user,'failed checks retain only the old owner boundary, not permission to write');
    events.focus();pending.shift()({ok:true,json:async()=>({user:admin})});await tick();
    const links=list.children.filter(link=>link.tag==='a');
    assert.equal(links.filter(link=>!link.hidden).length,14);
    assert.equal(links[0].attributes['aria-current'],'page');
    assert.equal(links[0].href,'http://localhost/eoffice/management/user_manage.html');
    toggle.events.click();assert.equal(nav.inert,false);assert.equal(content.inert,true);assert.equal(toggle.attributes['aria-expanded'],'true');
    events.keydown({key:'Escape',preventDefault(){}});assert.equal(nav.inert,true);assert.equal(content.inert,false);assert.equal(toggle.focused,true);
    media.matches=true;media.change();assert.equal(nav.inert,false);assert.equal(content.inert,false);
    const form=new Element('form');body.append(form);events.input({target:form});
    let warned=false;events.beforeunload({preventDefault(){warned=true;}});assert.equal(warned,true,'unsaved form survives a failed submission');
    let cancelled=false;events.click({target:links[3],button:0,preventDefault(){cancelled=true;},stopImmediatePropagation(){}});assert.equal(cancelled,true);
    assert.ok(!lastWarning.includes('บันทึกไว้ในแท็บนี้แล้ว'),'unsupported forms must not promise recovery');
    form.dataset.eofficeDraftState='pending';events.click({target:links[3],button:0,preventDefault(){},stopImmediatePropagation(){}});
    assert.ok(!lastWarning.includes('บันทึกไว้ในแท็บนี้แล้ว'),'edits awaiting authentication are not recoverable yet');
    window.eofficeUser={id:7};form.dataset.eofficeDraftUser='7';form.dataset.eofficeDraftState='saved';
    events.click({target:links[3],button:0,preventDefault(){},stopImmediatePropagation(){}});
    assert.ok(lastWarning.includes('ร่างข้อความล่าสุดบันทึกไว้ในแท็บนี้แล้ว'),'only successfully persisted drafts may promise text recovery');
    form.dataset.eofficeDraftState='unavailable';events.click({target:links[3],button:0,preventDefault(){},stopImmediatePropagation(){}});
    assert.ok(!lastWarning.includes('บันทึกไว้ในแท็บนี้แล้ว'),'storage failures must not promise recovery');
    form.dataset.eofficeDraftState='saved';window.eofficeUser={id:8};events.click({target:links[3],button:0,preventDefault(){},stopImmediatePropagation(){}});
    assert.ok(!lastWarning.includes('บันทึกไว้ในแท็บนี้แล้ว'),'another account cannot recover this draft');
    window.eofficeUser={id:7};
    const unsupported=new Element('form');body.append(unsupported);events.input({target:unsupported});
    events.click({target:links[3],button:0,preventDefault(){},stopImmediatePropagation(){}});
    assert.ok(!lastWarning.includes('บันทึกไว้ในแท็บนี้แล้ว'),'mixed recoverable and unsupported forms must not promise full recovery');
    events['eoffice:form-saved']({target:unsupported});
    await nav.children.find(node=>node.className==='eoffice-app-navigation__logout').events.click();
    assert.ok(lastWarning.includes('ร่างทั้งหมดในแท็บนี้จะถูกล้าง'),'logout must warn that it clears even successfully saved drafts');
    confirmed=true;cancelled=false;events.click({target:links[3],button:0,preventDefault(){cancelled=true;}});assert.equal(cancelled,false);
    warned=false;events.beforeunload({preventDefault(){warned=true;}});assert.equal(warned,false,'confirmed navigation must not ask twice');
    events['eoffice:form-dirty']({target:form,detail:{replayed:true}});warned=false;events.beforeunload({preventDefault(){warned=true;}});assert.equal(warned,false,'replaying an already approved early edit must not trigger a second departure warning');
    events.input({target:form});warned=false;events.beforeunload({preventDefault(){warned=true;}});assert.equal(warned,true,'new edits must revoke a previous departure approval');
    events.pageshow({persisted:false});events['eoffice:form-saved']({target:form});warned=false;events.beforeunload({preventDefault(){warned=true;}});assert.equal(warned,false);
    events['eoffice:form-dirty']({target:form});warned=false;events.beforeunload({preventDefault(){warned=true;}});assert.equal(warned,true,'button-driven form edits must warn');
    events['eoffice:form-saved']({target:form});warned=false;events.beforeunload({preventDefault(){warned=true;}});assert.equal(warned,false,'completed saves or discarded edits clear the shared guard');
    const restored=new Element('form');restored.dataset.eofficeDraftState='saved';body.append(restored);
    confirmed=false;let restoredWarning='';
    await nav.children.find(node=>node.className==='eoffice-app-navigation__logout').events.click();restoredWarning=lastWarning;
    assert.ok(restoredWarning.includes('ร่างทั้งหมดในแท็บนี้จะถูกล้าง'),'an untouched restored draft must still warn before logout');
    restored.hidden=true;
    events.focus();pending.shift()({ok:true,json:async()=>({user:{status:'User',permissions:[]}})});await tick();
    assert.equal(links.filter(link=>!link.hidden).length,9,'basic users must not see staff/admin links');
    console.log('PASS sidebar: document shortcuts, subdirectory URLs, mobile inert/Escape, dirty-form guards and stale session responses');
}
navigationChecks().catch(error=>{console.error(error);process.exitCode=1;});

async function preparedShellChecks() {
    const head=new Element('head'),body=new Element('body'),content=new Element('div'),view=new Element('div'),input=new Element('input');
    content.className='eoffice-module-content';view.className='eoffice-module-view';input.value='existing input';view.append(input);content.append(view);body.append(content);
    const stylesheet=new Element('link'),windowEvents=makeEventTarget();
    const document={...makeEventTarget(),head,body,currentScript:{src:'http://localhost/assets/app-navigation.js'},
        querySelector:selector=>selector==='.eoffice-module-content'?content:selector==='.eoffice-module-view'?view:selector.startsWith('link[')?stylesheet:null,
        createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};
    const window={...windowEvents,sessionReady:Promise.resolve({id:7,permissions:[]}),matchMedia:()=>({matches:true,addEventListener(){}})};
    vm.runInNewContext(fs.readFileSync('assets/app-navigation.js','utf8'),{window,document,location:{href:'http://localhost/maintenance_requests/index.html',pathname:'/maintenance_requests/index.html'},URL,Event,CustomEvent});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(content.children[0],view);assert.equal(view.children[0],input);assert.equal(input.value,'existing input');
    assert.equal(body.children.filter(node=>node.className==='eoffice-module-content').length,1);
    assert.equal(head.children.filter(node=>node.tag==='link').length,0,'prepared head stylesheets must not be injected a second time');
    assert.equal(body.classList.contains('eoffice-shell-ready'),true);
    assert.equal(window.eofficeSessionState.status,'authenticated');
    console.log('PASS prepared shell: reuse content/input nodes, avoid duplicate stylesheets and initialize session before page content');
}
preparedShellChecks().catch(error=>{console.error(error);process.exitCode=1;});

async function documentResponseChecks() {
    const nodes=new Map(),requests=[];
    const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},innerHTML:'',textContent:''});return nodes.get(id);};
    const runtime={document:{getElementById:node},window:{innerWidth:1440,innerHeight:900,location:{href:'http://localhost/index.php?view=public'}},
        fetch:()=>new Promise(resolve=>requests.push(resolve)),getCookie:()=> '2569',URL,
        localStorage:{getItem:()=> 'public',setItem(){}},history:{replaceState(){}},console:{log(){},error(){}},
        updateDataSave(){},updateDataSavePublic(){},updateDataSaveSend(){},Page_number:1};
    vm.createContext(runtime);vm.runInContext(fs.readFileSync('assets/api-service.js','utf8'),runtime);
    const snapshot=()=>JSON.stringify([...nodes].map(([id,value])=>[id,value.innerHTML,value.textContent,value.style]));
    for(const method of ['get_data_api_received','get_data_api_public','get_data_api_send','get_data_api_send_table']) {
        const old=runtime[method](1);
        runtime.invalidateDocumentRequests();
        const next=runtime.get_data_api_public(1);
        const stale=requests.shift(),latest=requests.shift();
        latest({ok:true,json:async()=>[]});await next;
        const before=snapshot();
        stale({ok:true,json:async()=>[]});await old;
        assert.equal(snapshot(),before,`${method}: old response must not alter current DOM, pagination or loader`);
    }
    const old=runtime.get_data_api_received(1);runtime.invalidateDocumentRequests();const next=runtime.get_data_api_public(1);
    const stale=requests.shift(),latest=requests.shift();
    stale({ok:false,status:500,json:async()=>[]});await old;
    assert.equal(node('load_data').style.display,'block','stale failure must not hide the current loader');
    latest({ok:true,json:async()=>[]});await next;
    console.log('PASS all four document APIs: cross-view late responses and failures cannot replace current content or loader');
}
documentResponseChecks().catch(error=>{console.error(error);process.exitCode=1;});

async function draftChecks() {
    const store=new Map();const tick=()=>new Promise(resolve=>setImmediate(resolve));
    async function open(userId, {delayLoad=false,delaySession=false,storageFailure=false,initialGuest=false,initialFailure=false,retainedSession=null,radios=false}={}) {
        const form=new Element('form');form.id='maintenanceForm';form.before=()=>{};
        const text=new Element('textarea');text.id='damageDetails';text.type='textarea';text.value='';
        const checkbox=new Element('input');checkbox.name='repairType';checkbox.id='';checkbox.type='checkbox';checkbox.checked=false;
        const password=new Element('input');password.id='password';password.type='password';password.value='';
        const file=new Element('input');file.id='imageFiles';file.type='file';file.value='';
        form.elements=[text,checkbox,password,file];
        const radioA=new Element('input'),radioB=new Element('input');
        for(const [field,id] of [[radioA,'choice-a'],[radioB,'choice-b']]) {field.id=id;field.name='choice';field.type='radio';field.checked=false;}
        const checkedRadios=new Map([[radioA,false],[radioB,false]]);
        for(const radio of [radioA,radioB]) Object.defineProperty(radio,'checked',{
            get:()=>checkedRadios.get(radio),set:value=>{
                checkedRadios.set(radio,Boolean(value));
                if(value)checkedRadios.set(radio===radioA?radioB:radioA,false);
            }
        });
        if(radios)form.elements.push(radioA,radioB);
        for(const field of form.elements)field.dispatchEvent=()=>true;
        let finishSession;const sessionEvents={},windowEvents=makeEventTarget(sessionEvents);
        const initialUser=initialGuest||initialFailure?null:{id:userId};
        const window={...windowEvents,sessionReady:delaySession?new Promise(resolve=>{finishSession=(user={id:userId})=>{window.eofficeUser=user;resolve(user);};}):initialFailure?Promise.reject(Error('session network failure')):Promise.resolve(initialUser),eofficeUser:initialUser};
        if(retainedSession) {window.eofficeSessionState=retainedSession;window.eofficeUser=retainedSession.user;}
        const document={...makeEventTarget(),readyState:delayLoad?'loading':'complete',getElementById:id=>id===form.id?form:null,createElement:tag=>new Element(tag)};
        vm.runInNewContext(fs.readFileSync('assets/module-drafts.js','utf8'),{document,window,location:{pathname:'/maintenance_requests/index.html'},sessionStorage:{getItem:key=>store.get(key),setItem:(key,value)=>{if(storageFailure)throw Error('storage quota');store.set(key,value);},removeItem:key=>store.delete(key)},Event});
        const updateSession=(user,status=user?.id?'authenticated':'guest')=>{
            window.eofficeUser=status==='authenticated'?user:status==='pending'?window.eofficeUser:null;
            window.eofficeSessionState={revision:(window.eofficeSessionState?.revision||0)+1,status,user};
            window.dispatchEvent({type:'eoffice:session-updated',detail:window.eofficeSessionState});
        };
        const startVerification=()=>updateSession(window.eofficeSessionState?.user || {id:userId},'pending');
        const editField=(field,mutate)=>{const event={target:field};form.captures.change(event);mutate();form.events.change(event);};
        const deliverOldEvent=state=>window.dispatchEvent({type:'eoffice:session-updated',detail:state});
        const finishLoad=delayLoad?()=>window.dispatchEvent({type:'load'}):undefined;
        await tick();return {form,text,checkbox,password,file,radioA,radioB,finishLoad,finishSession,updateSession,startVerification,editField,deliverOldEvent};
    }
    const first=await open(7);first.text.value='ข้อความที่ยังไม่บันทึก';first.checkbox.checked=true;first.password.value='never-persist';first.file.value='image.png';first.form.events.input();
    assert.ok([...store.values()][0].includes('ข้อความที่ยังไม่บันทึก'));assert.ok(![...store.values()][0].includes('never-persist'));assert.ok(![...store.values()][0].includes('image.png'));
    const other=await open(8);assert.equal(other.text.value,'');
    const restored=await open(7);assert.equal(restored.text.value,first.text.value);assert.equal(restored.checkbox.checked,true);assert.equal(restored.file.value,'');
    restored.form.events['eoffice:form-saved']();assert.equal(store.size,0);
    first.form.events.input();first.form.events.reset();assert.equal(store.size,0);
    console.log('PASS create-form drafts: text/unnamed checkbox restoration, user isolation, reset/success clearing and secret/file exclusion');
    for(const delays of [{delayLoad:true},{delaySession:true},{delayLoad:true,delaySession:true}]) {
        first.text.value='older saved draft';first.form.events.input();
        const untouched=await open(7,delays);untouched.finishSession?.();untouched.finishLoad?.();await tick();
        assert.equal(untouched.text.value,'older saved draft','slow startup without edits must still restore the draft');
        const pending=await open(7,delays);
        pending.text.value='new text while loading';pending.form.events.input();
        if(!delays.delaySession) {
            assert.ok([...store.values()][0].includes('new text while loading'),'early navigation before page load must retain current edits');
            assert.equal(pending.form.dataset.eofficeDraftState,'saved');
        } else {
            assert.equal(pending.form.dataset.eofficeDraftState,'pending','unknown owner must not claim persistence');
        }
        pending.finishSession?.();await tick();
        assert.ok([...store.values()][0].includes('new text while loading'),'authentication must persist edits without waiting for page load');
        pending.finishLoad?.();await tick();
        assert.equal(pending.text.value,'new text while loading','startup restoration must not overwrite new user edits');
        assert.ok([...store.values()][0].includes('new text while loading'));
        const again=await open(7);assert.equal(again.text.value,pending.text.value);
        first.form.events.input();
        const reset=await open(7,delays);reset.form.events.reset();reset.finishLoad?.();reset.finishSession?.();await tick();
        assert.equal(reset.text.value,'');assert.equal(store.size,0,'reset before readiness must not revive an older draft');
    }
    first.form.events.input();
    const saved=await open(7,{delayLoad:true,delaySession:true});saved.form.events['eoffice:form-saved']();saved.finishLoad();saved.finishSession();await tick();
    assert.equal(store.size,0,'a successful save before readiness must clear the old draft');
    console.log('PASS draft startup races: slow page/session, edit-before-restore, reset-before-restore and save-before-restore');
    const unavailable=await open(7,{storageFailure:true});unavailable.text.value='not persisted';unavailable.form.events.input();
    assert.equal(unavailable.form.dataset.eofficeDraftState,'unavailable');assert.equal(store.size,0);
    console.log('PASS draft persistence before page load, pending authentication status and storage failure state');
    for (const initial of [{initialGuest:true},{initialFailure:true}]) {
        first.text.value='older draft must not replace edits';first.form.events.input();
        const recovering=await open(7,{...initial,delayLoad:true});
        assert.equal(recovering.form.dataset.eofficeDraftState,'unavailable');
        recovering.text.value='text entered before session recovery';recovering.form.events.input();
        recovering.updateSession({id:7});
        assert.equal(recovering.form.dataset.eofficeDraftState,'saved','recovered sessions immediately persist edits before page readiness');
        assert.ok([...store.values()][0].includes(recovering.text.value));
        recovering.finishLoad();await tick();
        assert.equal(recovering.text.value,'text entered before session recovery');
        recovering.form.events.reset();assert.equal(store.size,0);
        first.text.value='draft for untouched recovered form';first.form.events.input();
        const untouched=await open(7,initial);untouched.updateSession({id:7});await tick();
        assert.equal(untouched.text.value,'draft for untouched recovered form');
        untouched.updateSession({id:7});assert.equal(untouched.form.dataset.eofficeDraftState,'saved','ordinary focus refresh must keep restored drafts recoverable');
        untouched.updateSession(null);untouched.updateSession({id:7});assert.equal(untouched.form.dataset.eofficeDraftState,'saved');
        untouched.updateSession(null);untouched.text.value='same account reauthentication text';untouched.form.events.input();
        assert.notEqual(untouched.form.dataset.eofficeDraftState,'saved');
        untouched.updateSession({id:7});assert.ok([...store.values()][0].includes(untouched.text.value));
        untouched.form.events.reset();assert.equal(store.size,0);
    }
    const lateInitial=await open(7,{delaySession:true});lateInitial.text.value='newest session text';lateInitial.form.events.input();
    lateInitial.updateSession({id:7});lateInitial.finishSession(null);await tick();
    assert.equal(lateInitial.form.dataset.eofficeDraftState,'saved','late initial failures must not disable an already recovered session');
    lateInitial.text.value='edit after late initial failure';lateInitial.form.events.input();assert.equal(lateInitial.form.dataset.eofficeDraftState,'saved');
    lateInitial.updateSession({id:8});lateInitial.text.value='different account content';lateInitial.form.events.input();
    assert.notEqual(lateInitial.form.dataset.eofficeDraftState,'saved');
    assert.ok(!store.has('eoffice-draft:8:/maintenance_requests/index.html:maintenanceForm'),'account switching must not transfer the previous form data');
    assert.ok(![...store.values()][0].includes('different account content'));
    lateInitial.updateSession({id:7});lateInitial.form.events.input();
    assert.notEqual(lateInitial.form.dataset.eofficeDraftState,'saved','a form used by another account requires a reload before drafts resume');
    console.log('PASS draft session recovery: initial guest/failure, early edits, untouched restoration, same-owner reauthentication, stale initial response and cross-owner isolation');

    store.clear();
    const original=await open(7);original.text.value='account 7 private draft';original.form.events.input();
    const published={revision:3,user:{id:8}};
    const lateSubscriber=await open(7,{retainedSession:published});
    assert.equal(lateSubscriber.text.value,'','late script must not restore account 7 draft while account 8 is current');
    assert.equal(lateSubscriber.form.dataset.eofficeDraftUser,'8');
    lateSubscriber.text.value='account 8 private draft';lateSubscriber.form.events.input();
    assert.ok(store.get('eoffice-draft:8:/maintenance_requests/index.html:maintenanceForm').includes('account 8 private draft'));
    assert.ok(!store.get('eoffice-draft:7:/maintenance_requests/index.html:maintenanceForm').includes('account 8 private draft'));
    lateSubscriber.deliverOldEvent({revision:1,user:{id:7}});
    assert.equal(lateSubscriber.form.dataset.eofficeDraftUser,'8');
    const latestGuest=await open(7,{retainedSession:{revision:4,user:null}});
    latestGuest.text.value='guest input';latestGuest.form.events.input();
    assert.notEqual(latestGuest.form.dataset.eofficeDraftState,'saved','retained logout must take priority over cached authenticated promise');
    const pendingProducer=await open(7,{retainedSession:{revision:0,user:null}});
    assert.equal(pendingProducer.form.dataset.eofficeDraftUser,undefined,'a pending shared producer must not fall back to stale cached identity');
    pendingProducer.updateSession({id:8});assert.equal(pendingProducer.form.dataset.eofficeDraftUser,'8');
    console.log('PASS late session subscribers: retained newer account/logout, pending producer, cached promise and stale event isolation');

    for(const delays of [{delayLoad:true},{delayLoad:true,delaySession:true},{delayLoad:true,initialGuest:true}]) {
        store.clear();
        const previous=await open(7);previous.text.value='long description from previous draft';previous.checkbox.checked=false;previous.form.events.input();
        const early=await open(7,delays);
        early.checkbox.checked=true;early.form.events.change({target:early.checkbox});
        early.finishSession?.();if(delays.initialGuest)early.updateSession({id:7});await tick();
        const beforeLoad=JSON.parse(store.get('eoffice-draft:7:/maintenance_requests/index.html:maintenanceForm'));
        assert.equal(beforeLoad.find(field=>field.id==='damageDetails').value,'long description from previous draft','an unrelated early checkbox edit must not erase stored text');
        assert.equal(beforeLoad.find(field=>field.type==='checkbox').value,true);
        const revisited=await open(7);assert.equal(revisited.text.value,'long description from previous draft');assert.equal(revisited.checkbox.checked,true,'early navigation must recover the merged snapshot');
        early.finishLoad();await tick();assert.equal(early.text.value,'long description from previous draft');assert.equal(early.checkbox.checked,true);
        early.form.events.reset();early.text.value='';early.checkbox.checked=false;
        early.text.value='new draft after explicit reset';early.form.events.input({target:early.text});
        assert.ok(!store.get('eoffice-draft:7:/maintenance_requests/index.html:maintenanceForm').includes('long description from previous draft'));
    }
    store.clear();
    const oldBeforeReset=await open(7);oldBeforeReset.text.value='discarded previous text';oldBeforeReset.checkbox.checked=true;oldBeforeReset.form.events.input();
    const resetBeforeSession=await open(7,{delayLoad:true,delaySession:true});
    resetBeforeSession.form.events.reset();resetBeforeSession.text.value='fresh edit after reset';resetBeforeSession.form.events.input({target:resetBeforeSession.text});
    resetBeforeSession.finishSession();await tick();resetBeforeSession.finishLoad();await tick();
    assert.equal(resetBeforeSession.text.value,'fresh edit after reset');assert.equal(resetBeforeSession.checkbox.checked,false);
    assert.ok(!store.get('eoffice-draft:7:/maintenance_requests/index.html:maintenanceForm').includes('discarded previous text'));
    store.clear();
    const old=await open(7);old.text.value='old text';old.form.events.input();
    const cleared=await open(7,{delayLoad:true});cleared.text.value='';cleared.form.events.input({target:cleared.text});cleared.finishLoad();await tick();
    assert.equal(cleared.text.value,'','explicit user clearing of a field must not be undone by restoration');
    const dependent=await open(7);dependent.text.value='dependent description';dependent.form.events.input({target:dependent.text});
    dependent.checkbox.checked=false;
    dependent.editField(dependent.checkbox,()=>{dependent.text.value='';});
    assert.equal(JSON.parse(store.get('eoffice-draft:7:/maintenance_requests/index.html:maintenanceForm')).find(field=>field.id==='damageDetails').value,'','dependent handler clearing must also persist');
    store.clear();
    const previousRadio=await open(7,{radios:true});previousRadio.text.value='preserved radio draft';previousRadio.radioA.checked=true;previousRadio.form.events.input();
    const earlyRadio=await open(7,{radios:true,delayLoad:true});earlyRadio.radioB.checked=true;earlyRadio.editField(earlyRadio.radioB,()=>{});
    assert.equal(earlyRadio.radioB.checked,true,'capture-time merging must respect native radio-group selection');
    earlyRadio.finishLoad();await tick();
    assert.equal(earlyRadio.radioA.checked,false);assert.equal(earlyRadio.radioB.checked,true);assert.equal(earlyRadio.text.value,'preserved radio draft');
    console.log('PASS per-field merging: early checkbox edits, delayed authentication/recovery, early navigation, untouched text, explicit clear/reset and dependent handler changes');

    const key7='eoffice-draft:7:/maintenance_requests/index.html:maintenanceForm';
    const key8='eoffice-draft:8:/maintenance_requests/index.html:maintenanceForm';
    for (const initialized of [true,false]) {
        store.clear();
        const existing=await open(7);existing.text.value='verified owner 7 data';existing.form.events.input({target:existing.text});
        const current=await open(7,{delayLoad:!initialized,retainedSession:{revision:5,status:'authenticated',user:{id:7}}});
        const original=store.get(key7);
        current.startVerification();
        assert.equal(current.form.dataset.eofficeDraftState,'pending');
        current.text.value='edit while next session check is pending';current.form.events.input({target:current.text});
        current.checkbox.checked=true;current.form.events.change({target:current.checkbox});
        assert.equal(store.get(key7),original,'pending verification must not write the last owner draft');
        current.deliverOldEvent({revision:4,status:'authenticated',user:{id:7}});
        assert.equal(current.form.dataset.eofficeDraftState,'pending');assert.equal(store.get(key7),original);
        current.updateSession({id:7});
        assert.ok(store.get(key7).includes(current.text.value),'same-owner verification may commit buffered edits');
        current.startVerification();const beforeFailure=store.get(key7);
        current.text.value='buffer after failed verification';current.form.events.input({target:current.text});
        current.updateSession({id:7},'unavailable');
        assert.equal(current.form.dataset.eofficeDraftState,'unavailable');assert.equal(store.get(key7),beforeFailure);
        current.startVerification();assert.equal(store.get(key7),beforeFailure);current.updateSession({id:7});
        assert.ok(store.get(key7).includes('buffer after failed verification'));
        const lastSafe=store.get(key7);
        current.startVerification();current.text.value='private text typed after account 8 signs in';current.form.events.input({target:current.text});
        current.updateSession({id:8});
        assert.equal(store.get(key7),lastSafe,'a different-account reply cannot commit pending edits into the old account');
        assert.equal(store.has(key8),false,'pending edits must not be automatically transferred to the newly verified account');
        current.updateSession({id:7});current.form.events.input({target:current.text});assert.equal(store.get(key7),lastSafe);
    }
    store.clear();
    const pendingOld=await open(7);pendingOld.text.value='old draft before pending subscriber';pendingOld.form.events.input({target:pendingOld.text});
    const unchanged=store.get(key7);
    const latePending=await open(7,{retainedSession:{revision:9,status:'pending',user:{id:7}}});
    assert.equal(latePending.text.value,'','a late subscriber must not restore private fields before pending verification completes');
    latePending.text.value='new account input';latePending.form.events.input({target:latePending.text});
    assert.equal(store.get(key7),unchanged);latePending.updateSession({id:8});assert.equal(store.get(key7),unchanged);assert.equal(store.has(key8),false);
    const afterSwitch=await open(7,{retainedSession:{revision:12,status:'authenticated',user:{id:8},pageOwnerId:'7'}});
    afterSwitch.text.value='late script on page previously owned by 7';afterSwitch.form.events.input({target:afterSwitch.text});
    assert.equal(store.get(key7),unchanged);assert.equal(store.has(key8),false,'a late subscriber after a completed account switch must still require reload');
    const afterGuest=await open(7,{retainedSession:{revision:13,status:'guest',user:null,pageOwnerId:'7'}});
    afterGuest.text.value='guest edits on old account page';afterGuest.form.events.input({target:afterGuest.text});afterGuest.updateSession({id:8});
    assert.equal(store.get(key7),unchanged);assert.equal(store.has(key8),false,'logout must not erase the previous page owner boundary for late subscribers');
    for (const sameOwner of [true,false]) {
        store.clear();const resetSource=await open(7);resetSource.text.value='keep until owner confirmed';resetSource.form.events.input();
        const resetPending=await open(7);const storedBefore=store.get(key7);resetPending.startVerification();resetPending.form.events.reset();
        assert.equal(store.get(key7),storedBefore,'a pending reset must not delete the last owner draft');
        resetPending.updateSession({id:sameOwner?7:8});
        assert.equal(store.has(key7),!sameOwner,'only same-owner confirmation may apply the staged deletion');
    }
    console.log('PASS pending verification boundary: buffered edits, stale replies, same-owner commit, failures/retry, different-account rejection, late subscribers and staged resets');
}
draftChecks().catch(error=>{console.error(error);process.exitCode=1;});

async function sessionDraftIntegrationChecks() {
    const tick=()=>new Promise(resolve=>setImmediate(resolve));
    for (const confirmedId of [7,8]) {
        const head=new Element('head'),body=new Element('body'),requests=[],events={},store=new Map();
        const form=new Element('form');form.id='maintenanceForm';form.before=()=>{};
        const input=new Element('textarea');input.id='damageDetails';input.type='textarea';input.value='';form.elements=[input];body.append(form);
        const windowEvents=makeEventTarget(events);
        const window={...windowEvents,sessionReady:Promise.resolve({id:7,status:'User',permissions:[]}),
            matchMedia:()=>({matches:true,addEventListener(){}}),confirm:()=>false,alert(){}};
        const document={...makeEventTarget(),head,body,readyState:'complete',currentScript:{src:'http://localhost/assets/app-navigation.js'},querySelector:()=>null,
            getElementById:id=>id===form.id?form:null,createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};
        const runtime={document,window,location:{href:'http://localhost/maintenance_requests/index.html',pathname:'/maintenance_requests/index.html'},
            URL,Event,CustomEvent,fetch:()=>new Promise(resolve=>requests.push(resolve)),localStorage:{},
            sessionStorage:{getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)}};
        vm.createContext(runtime);vm.runInContext(fs.readFileSync('assets/app-navigation.js','utf8'),runtime);
        vm.runInContext(fs.readFileSync('assets/module-drafts.js','utf8'),runtime);await tick();
        input.value='verified old-owner text';form.events.input({target:input});
        const key='eoffice-draft:7:/maintenance_requests/index.html:maintenanceForm', original=store.get(key);
        events.focus();
        assert.equal(window.eofficeSessionState.status,'pending');assert.equal(form.dataset.eofficeDraftState,'pending');
        input.value='new text during actual verification';form.events.input({target:input});
        assert.equal(store.get(key),original,'the real publisher must pause the real draft consumer before the fetch resolves');
        requests.shift()({ok:true,json:async()=>({user:{id:confirmedId,status:'User',permissions:[]}})});await tick();
        if (confirmedId===7) assert.ok(store.get(key).includes('new text during actual verification'));
        else {assert.equal(store.get(key),original);assert.equal(store.has('eoffice-draft:8:/maintenance_requests/index.html:maintenanceForm'),false);}
    }
    console.log('PASS real session publisher + draft consumer integration: pending writes remain staged and only the same owner commits them');
}
sessionDraftIntegrationChecks().catch(error=>{console.error(error);process.exitCode=1;});

async function bfcacheDraftChecks() {
    const tick=()=>new Promise(resolve=>setImmediate(resolve));
    for (const outcome of ['same-owner','different-owner','network-failure']) {
        const head=new Element('head'),body=new Element('body'),requests=[],store=new Map();
        body.style.overflow='';
        const form=new Element('form');form.id='maintenanceForm';form.before=()=>{};
        const input=new Element('textarea');input.id='damageDetails';input.type='textarea';input.value='';form.elements=[input];body.append(form);
        const windowEvents=makeEventTarget(),documentEvents=makeEventTarget();
        const window={...windowEvents,sessionReady:Promise.resolve({id:7,status:'User',permissions:[]}),
            matchMedia:()=>({matches:false,addEventListener(){}}),confirm:()=>true,alert(){}};
        const document={...documentEvents,head,body,readyState:'complete',currentScript:{src:'http://localhost/assets/app-navigation.js'},querySelector:()=>null,
            getElementById:id=>id===form.id?form:null,createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};
        const runtime={document,window,location:{href:'http://localhost/maintenance_requests/index.html',pathname:'/maintenance_requests/index.html'},
            URL,Event,CustomEvent,fetch:()=>new Promise((resolve,reject)=>requests.push({resolve,reject})),localStorage:{},
            sessionStorage:{getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)}};
        vm.createContext(runtime);vm.runInContext(fs.readFileSync('assets/app-navigation.js','utf8'),runtime);
        vm.runInContext(fs.readFileSync('assets/module-drafts.js','utf8'),runtime);await tick();
        assert.equal(windowEvents.listenerCount('pageshow'),2,'BFCache setup must retain both production handlers');

        input.value='last verified account 7 text';form.events.input({target:input});
        documentEvents.emit('input',{target:form});
        const key7='eoffice-draft:7:/maintenance_requests/index.html:maintenanceForm';
        const key8='eoffice-draft:8:/maintenance_requests/index.html:maintenanceForm';
        const original=store.get(key7), nav=body.children.find(node=>node.tag==='nav');
        // A previous confirmed departure is retained when the page enters BFCache.
        const brand=nav.querySelectorAll('a')[0];
        documentEvents.emit('click',{target:brand,button:0,preventDefault(){},stopImmediatePropagation(){}});
        const approved=new Event('beforeunload',{cancelable:true});window.dispatchEvent(approved);
        assert.equal(approved.defaultPrevented,false);

        // The page may also have a cached open drawer/scroll lock.
        const header=body.children.find(node=>node.tag==='header'),toggle=header.children[1];
        const content=body.children.find(node=>node.className==='eoffice-module-content');
        toggle.events.click();assert.equal(content.inert,true);assert.equal(body.style.overflow,'hidden');
        window.dispatchEvent({type:'pageshow',persisted:false});
        assert.equal(requests.length,0,'ordinary pageshow must not run the BFCache-only verification');
        assert.equal(content.inert,true);

        // Re-establish the approved flag so the persisted event must clear it too.
        documentEvents.emit('click',{target:brand,button:0,preventDefault(){},stopImmediatePropagation(){}});
        toggle.events.click();
        window.dispatchEvent({type:'pageshow',persisted:true});
        assert.equal(requests.length,1,'returning from BFCache must start a fresh session request');
        assert.equal(window.eofficeSessionState.status,'pending');assert.equal(form.dataset.eofficeDraftState,'pending');
        assert.equal(nav.inert,true);assert.equal(content.inert,false);assert.equal(toggle.attributes['aria-expanded'],'false');
        assert.equal(body.style.overflow,'','BFCache return must release its cached scroll lock');

        input.value='edited after BFCache return while verifying';form.events.input({target:input});
        assert.equal(store.get(key7),original,'BFCache pending verification must not write to the previous account');
        const warning=new Event('beforeunload',{cancelable:true});window.dispatchEvent(warning);
        assert.equal(warning.defaultPrevented,true,'the second pageshow handler must revoke the old departure approval');

        if (outcome==='same-owner') {
            // Browsers can emit focus immediately after the persisted pageshow.
            window.dispatchEvent({type:'focus'});assert.equal(requests.length,2);
            requests.shift().resolve({ok:true,json:async()=>({user:{id:8,status:'User',permissions:[]}})});await tick();
            assert.equal(window.eofficeSessionState.status,'pending');assert.equal(form.dataset.eofficeDraftState,'pending');
            assert.equal(store.get(key7),original,'an obsolete BFCache response must not resume writes or latch the wrong owner while the focus check is pending');
        }

        const request=requests.shift();
        if (outcome==='network-failure') request.reject(Error('QA unavailable session'));
        else request.resolve({ok:true,json:async()=>({user:{id:outcome==='same-owner'?7:8,status:'User',permissions:[]}})});
        await tick();
        if (outcome==='same-owner') {
            assert.equal(form.dataset.eofficeDraftState,'saved');assert.ok(store.get(key7).includes(input.value));
        } else {
            assert.equal(form.dataset.eofficeDraftState,'unavailable');assert.equal(store.get(key7),original);assert.equal(store.has(key8),false);
            input.value='another edit after unsuccessful verification';form.events.input({target:input});assert.equal(store.get(key7),original);
        }
        assert.equal(input.value,outcome==='same-owner'?'edited after BFCache return while verifying':'another edit after unsuccessful verification');
    }
    console.log('PASS BFCache pageshow: both listeners, drawer/scroll cleanup, approval reset, pending edits, overlapping focus, same/different account and network failure');
}
bfcacheDraftChecks().catch(error=>{console.error(error);process.exitCode=1;});

function bookingDefaultsChecks() {
    const source=fs.readFileSync('room_booking/new_room.html','utf8');
    const initializer=source.slice(source.indexOf('        function initializeBookingForm()'),source.indexOf('        function getCookie(name)'));
    assert.ok(initializer.includes('initializeBookingForm();'));
    assert.doesNotMatch(source,/window\.onload\s*=/,'form defaults should run before resource loading completes');
    const nodes=new Map();
    const el=id=>{if(!nodes.has(id)){const field=new Element('input');field.id=id;field.value='';nodes.set(id,field);}return nodes.get(id);};
    const runtime={window:{},document:{getElementById:el,querySelector:()=>el('submit')},getCookie:()=>encodeURIComponent('Default requester'),Date,decodeURIComponent};
    vm.createContext(runtime);vm.runInContext(fs.readFileSync('assets/form-dates.js','utf8'),runtime);vm.runInContext(initializer,runtime);
    assert.equal(el('requesterName').value,'Default requester');
    assert.match(el('startDate').value,/^\d{4}-\d{2}-\d{2}$/);
    el('requesterName').value='New requester';el('startDate').value='2030-05-17';el('endDate').value='2030-05-18';
    runtime.initializeBookingForm();
    assert.equal(el('requesterName').value,'New requester');assert.equal(el('startDate').value,'2030-05-17');assert.equal(el('endDate').value,'2030-05-18');
    console.log('PASS real booking defaults: early initialization fills empty fields and preserves existing requester/dates');
    const maintenance=fs.readFileSync('maintenance_requests/script.js','utf8');
    const defaults=maintenance.slice(maintenance.indexOf('    const dateInput'),maintenance.indexOf('    // 2. Toggle'));
    el('requestDate').value='2031-08-20';el('requesterName').value='Edited maintenance requester';
    vm.runInContext('{'+defaults+'}',runtime);
    assert.equal(el('requestDate').value,'2031-08-20');assert.equal(el('requesterName').value,'Edited maintenance requester');
    console.log('PASS maintenance defaults also preserve user values entered before initialization');
}
bookingDefaultsChecks();

async function bookingEquipmentDraftChecks() {
    const tick=()=>new Promise(resolve=>setImmediate(resolve));
    const source=fs.readFileSync('room_booking/new_room.html','utf8');
    const controller=source.slice(source.indexOf('        function toggleOtherEquip()'),source.indexOf('        function updateRoomPreview()'));
    const led1='จอ LED (ขึ้นภาพนิ่งหรือพื้นหลังเท่านั้น)',led2='จอ LED (เปิดไฟล์อื่นๆ เพื่อประกอบการอบรม/ประชุม)';
    const key='eoffice-draft:7:/room_booking/new_room.html:bookingForm';
    async function open({delaySession=false}={}) {
        const form=new Element('form');form.id='bookingForm';form.before=()=>{};
        const nodes=new Map();
        for(const id of ['equipOtherCheck2','equipOtherCheck3','equipOtherCheck','equipOtherText']) {
            const field=new Element('input');field.id=id;field.type=id==='equipOtherText'?'text':'checkbox';field.value='';field.checked=false;
            field.classList.remove=()=>{};nodes.set(id,field);
        }
        form.elements=[...nodes.values()];
        nodes.get('equipOtherText').dataset.draftComposed=source.match(/id="equipOtherText"[^>]*data-draft-composed="([^"]+)"/)?.[1];
        const old=[{id:'equipOtherCheck',type:'checkbox',value:true},{id:'equipOtherCheck2',type:'checkbox',value:false},
            {id:'equipOtherCheck3',type:'checkbox',value:true},{id:'equipOtherText',type:'text',value:`CUSTOM QA EQUIPMENT, ${led2}`}];
        const store=new Map([[key,JSON.stringify(old)]]),events=makeEventTarget();let finishSession;
        const window={...events,eofficeUser:delaySession?null:{id:7},sessionReady:delaySession?new Promise(resolve=>{finishSession=()=>{window.eofficeUser={id:7};resolve({id:7});};}):Promise.resolve({id:7})};
        const document={readyState:'loading',getElementById:id=>id==='bookingForm'?form:nodes.get(id),createElement:tag=>new Element(tag)};
        const runtime={document,window,location:{pathname:'/room_booking/new_room.html'},Event,
            sessionStorage:{getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)}};
        vm.createContext(runtime);vm.runInContext(controller,runtime);vm.runInContext(fs.readFileSync('assets/module-drafts.js','utf8'),runtime);
        function dispatch(field,type) {
            const event={type,target:field};form.captures[type]?.(event);
            if(type==='change' && field.type==='checkbox')runtime.toggleOtherEquip();
            form.events[type]?.(event);
        }
        for(const field of nodes.values())field.dispatchEvent=event=>{dispatch(field,event.type);return true;};
        await tick();return {nodes,store,dispatch,finishSession,load:async()=>{window.dispatchEvent({type:'load'});await tick();}};
    }
    for(const delaySession of [false,true]) {
        const page=await open({delaySession});const led=page.nodes.get('equipOtherCheck2');led.checked=true;page.dispatch(led,'change');
        page.finishSession?.();await tick();
        assert.ok(JSON.parse(page.store.get(key)).find(field=>field.id==='equipOtherText').value.includes('CUSTOM QA EQUIPMENT'),
            'an early LED toggle must preserve the stored custom text before restoration');
        await page.load();
        const text=page.nodes.get('equipOtherText');
        assert.ok(text.value.includes('CUSTOM QA EQUIPMENT'));assert.equal(text.value.split(led1).length,2);assert.equal(text.value.split(led2).length,2);
        led.checked=false;page.dispatch(led,'change');led.checked=true;page.dispatch(led,'change');
        assert.ok(text.value.includes('CUSTOM QA EQUIPMENT'));assert.equal(text.value.split(led1).length,2);assert.equal(text.value.split(led2).length,2);
        const other=page.nodes.get('equipOtherCheck');other.checked=false;page.dispatch(other,'change');
        assert.ok(!text.value.includes('CUSTOM QA EQUIPMENT'),'explicitly unchecking Other must still discard the custom portion');
    }
    const earlyDiscard=await open();const other=earlyDiscard.nodes.get('equipOtherCheck');other.checked=false;earlyDiscard.dispatch(other,'change');await earlyDiscard.load();
    assert.ok(!earlyDiscard.nodes.get('equipOtherText').value.includes('CUSTOM QA EQUIPMENT'));
    for(const delaySession of [false,true]) {
        const page=await open({delaySession});const other=page.nodes.get('equipOtherCheck');
        other.checked=false;page.dispatch(other,'change');other.checked=true;page.dispatch(other,'change');
        page.finishSession?.();await tick();await page.load();
        assert.ok(!page.nodes.get('equipOtherText').value.includes('CUSTOM QA EQUIPMENT'),'re-enabling Other must not revive explicitly discarded custom text');
    }
    const typed=await open();typed.nodes.get('equipOtherText').value='EXPLICIT NEW CUSTOM TEXT';typed.dispatch(typed.nodes.get('equipOtherText'),'input');await typed.load();
    assert.ok(typed.nodes.get('equipOtherText').value.includes('EXPLICIT NEW CUSTOM TEXT'));assert.ok(!typed.nodes.get('equipOtherText').value.includes('CUSTOM QA EQUIPMENT'));
    assert.match(source,/id="equipOtherText"[^>]*data-draft-composed|data-draft-composed[^>]*id="equipOtherText"/,'the real form must identify its composed field');
    console.log('PASS real booking equipment controller + drafts: early LED/authentication, custom text retention, explicit Other removal, direct text edit and annotation deduplication');
}
bookingEquipmentDraftChecks().catch(error=>{console.error(error);process.exitCode=1;});

async function signRoutingFormChecks() {
    class Node extends Element {
        constructor(tag) {super(tag);this.classList.toggle=(name,force)=>{if(force)this.classList.add(name);};}
        add(option) {this.append(option);}
        replaceChildren(...nodes) {for(const child of this.children)child.parent=null;this.children=[];this.append(...nodes);}
        remove() {if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}}
        querySelectorAll(tags) {return super.querySelectorAll(tags.split(',').map(x=>x.trim()).join(','));}
        dispatchEvent(event) {notifications.push({target:this.id,type:event.type});return true;}
    }
    const nodes=new Map(),notifications=[],requests=[];
    const el=id=>{if(!nodes.has(id)){const node=new Node(id==='form_sign_routes'?'form':'div');node.id=id;nodes.set(id,node);}return nodes.get(id);};
    let confirmed=true;
    const fixture={users:[{User_Id:1,User_Name:'Secretary',User_Email:'s@example.test'},{User_Id:2,User_Name:'Deputy',User_Email:'d@example.test'}],departments:['Test department'],route_version:'v1',routes:[{department:'Test department',secretary_id:1,deputy_id:2}]};
    const tick=()=>new Promise(resolve=>setImmediate(resolve));
    vm.runInNewContext(fs.readFileSync('assets/sign-routing-management.js','utf8'),{
        document:{getElementById:el,createElement:tag=>new Node(tag)},window:{sessionReady:Promise.resolve({status:'Admin'}),dispatchEvent(){}},
        fetch:()=>new Promise(resolve=>requests.push(resolve)),confirm:()=>confirmed,Event,
        Option:class extends Node{constructor(label,value){super('option');this.textContent=label;this.value=value;}}
    });
    await tick();requests.shift()({ok:true,json:async()=>fixture});await tick();
    assert.equal(notifications.at(-1).type,'eoffice:form-saved','initial loading establishes a clean shared state');
    el('add-sign-route').events.click();assert.equal(notifications.at(-1).type,'eoffice:form-dirty');
    el('sign-route-rows').children.at(-1).querySelectorAll('button')[0].events.click();assert.equal(notifications.at(-1).type,'eoffice:form-dirty');
    const select=el('sign-route-rows').children[0].querySelectorAll('select')[0];select.events.change();
    assert.equal(notifications.at(-1).type,'eoffice:form-dirty');
    let saving=el('form_sign_routes').events.submit({preventDefault(){}});
    requests.shift()({ok:false,json:async()=>({status:'error',message:'failed save'})});await saving;
    assert.equal(notifications.at(-1).type,'eoffice:form-dirty','failed save must retain navigation warning');
    saving=el('form_sign_routes').events.submit({preventDefault(){}});
    requests.shift()({ok:true,json:async()=>({route_version:'v2',message:'saved'})});await saving;
    assert.equal(notifications.at(-1).type,'eoffice:form-saved');
    el('add-sign-route').events.click();
    confirmed=false;const count=notifications.length;await el('reload-sign-routes').events.click();
    assert.equal(requests.length,0);assert.equal(notifications.length,count,'cancelled reload must retain dirty state');
    confirmed=true;let reload=el('reload-sign-routes').events.click();
    requests.shift()({ok:false,json:async()=>({status:'error',message:'failed reload'})});await reload;
    assert.equal(notifications.at(-1).type,'eoffice:form-dirty','failed reload must not clear edits');
    reload=el('reload-sign-routes').events.click();requests.shift()({ok:true,json:async()=>fixture});await reload;
    assert.equal(notifications.at(-1).type,'eoffice:form-saved','confirmed successful reload clears discarded edits');
    assert.ok(notifications.every(event=>event.target==='form_sign_routes'));
    console.log('PASS Auto send lifecycle: add/remove/select, successful/failed save, cancelled/failed/successful reload and shared form notifications');
}
signRoutingFormChecks().catch(error=>{console.error(error);process.exitCode=1;});

async function documentFormGuardChecks() {
    const form=new Element('form');form.id='document-form';
    const input=new Element('input');input.name='doc_name';input.value='';form.elements=[input];
    const nodes=new Map([[form.id,form]]),el=id=>{if(!nodes.has(id))nodes.set(id,new Element('div'));return nodes.get(id);};
    let confirmed=false,confirmCount=0,finishWrite,refreshed=false;
    const window={...makeEventTarget(),eofficeUser:{id:7},confirm:()=>{confirmCount++;return confirmed;}};
    const document={...makeEventTarget(),getElementById:el};
    const runtime={window,document,location:{href:'http://localhost/index.php',origin:'http://localhost',pathname:'/index.php',search:''},URL,Event,CustomEvent,queueMicrotask,
        getCookie:()=> 'session',localStorage:{getItem:()=> 'send_table'},FormData:class{set(){}},
        fetch:()=>new Promise(resolve=>{finishWrite=resolve;}),alert(){},console:{error(){}},showView:()=>{refreshed=true;}};
    vm.createContext(runtime);vm.runInContext(fs.readFileSync('assets/form-owner-boundary.js','utf8'),runtime);vm.runInContext(fs.readFileSync('assets/document-form-guard.js','utf8'),runtime);
    const warns=()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;};
    assert.equal(warns(),false);input.value='unsaved';form.events.input();assert.equal(warns(),true);
    context.window.eofficeUser={permissions:['members']};context.window.eofficeApproveDocumentLeaving=window.eofficeApproveDocumentLeaving;
    context.navigated=null;context.showView('members');assert.equal(context.navigated,null,'cancelled departure must not redirect');
    confirmed=true;context.showView('members');assert.equal(context.navigated,'management/user_manage.html');
    const count=confirmCount;assert.equal(window.eofficeApproveDocumentLeaving(),true);assert.equal(confirmCount,count);assert.equal(warns(),false);
    window.dispatchEvent(new Event('pageshow'));assert.equal(warns(),true);
    form.events['eoffice:form-saved']({});assert.equal(warns(),false);
    const oldLength=form.elements.length;form.elements.push({name:'send_to_user[]',type:'hidden',value:'7'});form.dispatchEvent(new Event('eoffice:form-dirty'));
    await Promise.resolve();assert.equal(form.elements.length,oldLength+1);assert.equal(warns(),true,'button-driven recipient edits must warn');
    form.events.reset();assert.equal(warns(),false);
    vm.runInContext(main.slice(main.indexOf('const docForm ='),main.indexOf('function search_find(')),runtime);
    for (const outcome of ['failed','success','later-edits','partial-files','reopened-form','discarded-form','cancelled-discard']) {
        form.events.reset();input.value='submitted';form.events.input();refreshed=false;
        const write=form.events.submit({preventDefault(){}});
        if(outcome==='later-edits'){input.value='changed while saving';form.events.input();}
        if(outcome==='reopened-form'){form.events.reset();input.value='another new document';el('doc_id').value='';el('formtype').value='create_document';form.events.input();}
        if(outcome==='discarded-form'){el('doc_id').value='';el('formtype').value='create_document';assert.equal(window.eofficeDiscardDocumentEdits(),true);}
        if(outcome==='cancelled-discard'){confirmed=false;const generation=window.eofficeDocumentGeneration();assert.equal(window.eofficeDiscardDocumentEdits(),false);assert.equal(window.eofficeDocumentGeneration(),generation);confirmed=true;}
        finishWrite({ok:outcome!=='failed',json:async()=>({status:outcome==='failed'?'error':'success',doc_id:42,files:{status:outcome==='partial-files'?'error':'success'},message:'QA response'})});
        await write;
        assert.equal(warns(),!['success','discarded-form','cancelled-discard'].includes(outcome),`${outcome}: only a complete save or explicit discard clears dirty state`);
        assert.equal(refreshed,['success','cancelled-discard'].includes(outcome));
        if(outcome==='later-edits'){assert.equal(el('doc_id').value,42);assert.equal(el('formtype').value,'edit_document');}
        if(outcome==='reopened-form'){assert.equal(el('doc_id').value,'');assert.equal(el('formtype').value,'create_document');}
        if(outcome==='discarded-form'){assert.equal(el('doc_id').value,'','a late successful receipt must not mutate a discarded form');assert.equal(el('formtype').value,'create_document');}
    }
    delete context.window.eofficeApproveDocumentLeaving;
    assert.match(index,/assets\/document-form-guard\.js/);
    console.log('PASS main document guard: cancelled/approved module departure, BFCache, reset, hidden recipient edits and actual save failure/success/later edits/partial files');
}
documentFormGuardChecks().catch(error=>{console.error(error);process.exitCode=1;});

async function conditionalDraftReadinessChecks() {
    const tick=()=>new Promise(resolve=>setImmediate(resolve));
    for(const type of ['checkbox','select-one']) {
        const form=new Element('form');form.id='maintenanceForm';form.before=()=>{};
        const control=new Element(type==='checkbox'?'input':'select');control.id='controller';control.type=type;control.value='';control.checked=false;
        const detail=new Element('input');detail.id='detail';detail.type='text';detail.value='';detail.dataset.draftClearWhen=control.id;detail.dataset.draftActiveValue='other';
        form.elements=[control,detail];const key='eoffice-draft:7:/maintenance_requests/index.html:maintenanceForm';
        const store=new Map([[key,JSON.stringify([{id:control.id,type,value:type==='checkbox'?true:'other'},{id:detail.id,type:'text',value:'old detail to discard'}])]]);
        let finishSession,shown=false,syntheticFocus=0;
        const window={...makeEventTarget(),sessionReady:new Promise(resolve=>{finishSession=resolve;})};
        const document={readyState:'loading',getElementById:id=>id===form.id?form:null,createElement:tag=>new Element(tag)};
        const handler=()=>{shown=type==='checkbox'?control.checked:control.value==='other';detail.required=shown;if(!shown)detail.value='';};
        const change=()=>{const event={type:'change',target:control};form.captures.change(event);handler();form.events.change(event);};
        control.dispatchEvent=event=>{assert.equal(form.dataset.eofficeDraftRestoring,'true');handler();syntheticFocus++;return true;};detail.dispatchEvent=()=>true;
        vm.runInNewContext(fs.readFileSync('assets/module-drafts.js','utf8'),{window,document,Event,location:{pathname:'/maintenance_requests/index.html'},
            sessionStorage:{getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)}});
        form.dispatchEvent(new Event('eoffice:form-ready'));
        for(const enabled of [true,false,true]){control.checked=enabled;control.value=enabled?'other':'standard';change();}
        const previous=store.get(key);assert.equal(form.dataset.eofficeDraftState,'pending');finishSession({id:7});await tick();
        assert.equal(detail.value,'','explicit discard must survive re-enabling during delayed authentication');
        assert.equal(shown,true);assert.equal(detail.required,true);assert.ok(syntheticFocus>0);
        assert.ok(!store.get(key).includes('old detail to discard'));assert.notEqual(store.get(key),previous);
        assert.equal(document.readyState,'loading','restoration must not depend on resource load');
    }
    const html=fs.readFileSync('maintenance_requests/index.html','utf8');
    assert.match(html,/data-draft-clear-when="otherTypeCheckbox"/);
    assert.match(fs.readFileSync('maintenance_requests/script.js','utf8'),/if \(event\.isTrusted\) otherDetailInput\.focus/);
    console.log('PASS conditional draft readiness: explicit checkbox/select clear survives re-enable, pending storage isolation and synchronized visibility/required before resource load');
}
conditionalDraftReadinessChecks().catch(error=>{console.error(error);process.exitCode=1;});

function documentStructuralEditChecks() {
    const form=new Element('form'),nodes=new Map([['document-form',form]]);let dirty=0;
    form.addEventListener('eoffice:form-dirty',()=>dirty++);
    const el=id=>{if(!nodes.has(id))nodes.set(id,{insertAdjacentHTML(_,html){this.html=html;}});return nodes.get(id);};
    const runtime={document:{getElementById:id=>/^(user|group)_send_\d/.test(id)?null:el(id),querySelector:()=>null},localStorage:{getItem:()=> 'Send'},Event,
        escapeHtml:value=>String(value??''),safeHttpUrl:value=>String(value??''),console:{log(){}},doc_type:new Element('select')};
    vm.createContext(runtime);const source=fs.readFileSync('assets/utils.js','utf8');
    vm.runInContext('let fileIndex=0;'+source.slice(source.indexOf('function notifyDocumentEdit'),source.indexOf('function loop_show_file')),runtime);
    for(const mutate of [()=>runtime.addNewInputFile(),()=>runtime.addNewLink(),()=>runtime.add_user_send(7,'QA'),()=>runtime.add_group_send(8,'QA')]) {
        const before=dirty;mutate();assert.equal(dirty,before+1,'structural edits report dirty synchronously from the actual handler');
    }
    const before=dirty;runtime.addNewInputFile('Saved',42,99,'old.pdf',2569,false);runtime.addNewLink('Saved','https://example.test',false);
    runtime.add_user_send(7,'QA',undefined,false);runtime.add_group_send(8,'QA',undefined,false);assert.equal(dirty,before,'snapshot rendering must remain clean');
    let removed=false;runtime.removeDocumentRow({remove(){removed=true;}});assert.equal(removed,true);assert.equal(dirty,before+1);
    for(const id of ['file_send','doc_file_link_main','user_send','group_send'])assert.match(el(id).html,/removeDocumentRow/);
    console.log('PASS real structural handlers: immediate dirty for file/link/user/group add/remove, passive rendering stays clean');
}
documentStructuralEditChecks();

function documentFileReconciliationChecks() {
    const fields=row=>name=>row.controls[name];
    function fileRow(id,path,file) {
        const controls={'file_id':{value:String(id)},'file_version':{value:path},'doc_file_name':{value:'caption edited after submission'},'doc_upload':{files:file?[file]:[],_value:'upload'}};
        Object.defineProperty(controls.doc_upload,'value',{get(){return this._value;},set(v){this._value=v;if(v==='')this.files=[];}});
        return {connected:true,controls,link:{href:''},display:{textContent:'selected'},querySelector(selector){if(selector.startsWith('[name='))return controls[selector.match(/name="([^\[]+)/)[1]];if(selector.startsWith('a['))return this.link;if(selector.startsWith('[id^='))return this.display;}};
    }
    const uploaded={name:'submitted.pdf'},newer={name:'newer.pdf'},first=fileRow(42,'old.pdf',uploaded),second=fileRow('', '',uploaded),deleted=fileRow(43,'old2.pdf',uploaded);
    const link={connected:true,controls:{doc_url:{value:'https://amss.sesact.go.th/test.pdf'},doc_url_name:{value:'original caption'}},querySelector(selector){return fields(this)(selector.match(/name="([^\[]+)/)[1]);},remove(){this.connected=false;}};
    const form={querySelectorAll:selector=>selector.includes('file_send')?[first,second,deleted]:[link],contains:row=>row.connected};
    const imported=[],window={addNewInputFile:(...args)=>imported.push(args)};
    vm.runInNewContext(fs.readFileSync('assets/document-file-state.js','utf8'),{window,document:{}});
    const captured=window.captureDocumentFileState(form);first.controls.doc_upload.files=[newer];deleted.connected=false;link.controls.doc_url_name.value='renamed imported caption';
    const response={doc_id:99,files:{year:'2569',entries:[{input_index:0,file_id:42,path:'saved.pdf'},{input_index:1,file_id:100,path:'new.pdf'},{input_index:2,file_id:43,path:'saved2.pdf'}],imported:[{link_index:0,file_id:101,path:'imported.pdf',detail:'original caption'}]}};
    window.reconcileDocumentFiles(form,captured,response);
    assert.equal(first.controls.file_version.value,'saved.pdf');assert.equal(first.controls.doc_upload.files[0],newer);assert.equal(first.controls.doc_file_name.value,'caption edited after submission');
    assert.equal(second.controls.file_id.value,100);assert.equal(second.controls.file_version.value,'new.pdf');assert.equal(second.controls.doc_upload.files.length,0);
    assert.equal(deleted.controls.file_version.value,'old2.pdf','removed rows must not be reinserted');assert.match(first.link.href,/File_Path=saved.pdf/);
    assert.equal(imported[0][0],'renamed imported caption');assert.equal(imported[0].at(-1),false);assert.equal(link.connected,false);
    link.connected=true;const changed=window.captureDocumentFileState(form);link.controls.doc_url.value='https://example.test/new.pdf';
    window.reconcileDocumentFiles(form,changed,response);assert.equal(link.connected,true);assert.equal(imported.length,1,'changed URLs stay pending rather than being removed');
    const clearLink={...link,connected:true,controls:{doc_url:{value:'https://amss.sesact.go.th/clear.pdf'},doc_url_name:{value:'submitted caption'}}};
    const clearForm={querySelectorAll:selector=>selector.includes('file_send')?[]:[clearLink],contains:row=>row.connected};
    const beforeClear=window.captureDocumentFileState(clearForm);clearLink.controls.doc_url_name.value='';
    window.reconcileDocumentFiles(clearForm,beforeClear,{doc_id:99,files:{year:'2569',entries:[],imported:[{link_index:0,file_id:102,path:'clear.pdf',detail:'submitted caption'}]}});
    assert.equal(imported.at(-1)[0],'','an explicitly cleared import caption must not be restored from the receipt');
    console.log('PASS attachment receipts: refreshed IDs/versions, uploaded-file clearing, newer selections/captions/removals preserved, imported links consumed without dirty events');
}
documentFileReconciliationChecks();

async function mainLogoutChecks() {
    for(const outcome of ['cancel-first','network-error','http-error','new-edit-cancel','success']) {
        const form=new Element('form');form.elements=[];const document={...makeEventTarget(),getElementById:()=>form};
        const drafts=new Map([['eoffice-draft:7:/maintenance_requests/index.html:maintenanceForm','QA draft']]);
        let confirmations=0,request,clientCleared=false;
        const window={...makeEventTarget(),eofficeUser:{id:7},location:{href:'http://localhost/index.php'},
            confirm:()=>{confirmations++;return outcome!=='cancel-first' && !(outcome==='new-edit-cancel' && confirmations===2);},dispatchEvent(){}};
        const runtime={document,window,location:{href:window.location.href,origin:'http://localhost',pathname:'/index.php',search:''},URL,Event,
            sessionStorage:{get length(){return drafts.size;},key:index=>[...drafts.keys()][index],clear:()=>{drafts.clear();clientCleared=true;}},
            localStorage:{clear:()=>{clientCleared=true;}},fetch:()=>new Promise((resolve,reject)=>{request={resolve,reject};}),alert(){},console:{error(){}}};
        vm.createContext(runtime);vm.runInContext(fs.readFileSync('assets/document-form-guard.js','utf8'),runtime);
        const api=fs.readFileSync('assets/api-service.js','utf8');vm.runInContext(api.slice(api.indexOf('async function logOut('),api.indexOf('async function loginUser(')),runtime);
        const work=runtime.logOut();
        if(outcome==='cancel-first'){await work;assert.equal(request,undefined);assert.equal(drafts.size,1);continue;}
        if(outcome==='network-error')request.reject(Error('QA network failure'));
        else {
            if(outcome==='new-edit-cancel')form.dispatchEvent(new Event('input'));
            request.resolve({ok:outcome!=='http-error',json:async()=>({status:'success'})});
        }
        await work;assert.equal(clientCleared,outcome==='success',`${outcome}: logout may clear drafts only after success and current approval`);
        if(outcome!=='success')assert.equal(drafts.size,1);
        if(outcome==='new-edit-cancel')assert.equal(window.eofficeUser,null,'server logout is reflected without deleting the new unsaved data');
    }
    console.log('PASS main logout: existing drafts warn, cancellation/network/HTTP failure preserve storage, edits during logout require renewed confirmation');
}
mainLogoutChecks().catch(error=>{console.error(error);process.exitCode=1;});

async function sharedLogoutRaceChecks() {
    const head=new Element('head'),body=new Element('body'),form=new Element('form');body.append(form);
    const documents=makeEventTarget(),windows=makeEventTarget(),requests=[],store=new Map([['eoffice-draft:7:/previous:form','QA draft']]);
    let confirmed=true;
    const window={...windows,sessionReady:Promise.resolve({id:7,status:'User',permissions:[]}),confirm:()=>confirmed,alert(){},matchMedia:()=>({matches:true,addEventListener(){}})};
    const document={...documents,head,body,title:'QA',currentScript:{src:'http://localhost/assets/app-navigation.js'},querySelector:()=>null,querySelectorAll:()=>[],createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};
    const runtime={window,document,location:{href:'http://localhost/maintenance_requests/index.html',pathname:'/maintenance_requests/index.html',assign(){throw Error('cancelled departure must not redirect');}},URL,Event,CustomEvent,
        fetch:(url)=>new Promise(resolve=>requests.push({url,resolve})),localStorage:{clear(){throw Error('cancelled departure must retain storage');}},
        sessionStorage:{get length(){return store.size;},key:index=>[...store.keys()][index],clear(){throw Error('cancelled departure must retain storage');}}};
    vm.runInNewContext(fs.readFileSync('assets/app-navigation.js','utf8'),runtime);await new Promise(resolve=>setImmediate(resolve));
    documents.emit('input',{target:form});window.dispatchEvent(new Event('focus'));
    const nav=body.children.find(node=>node.tag==='nav'),logout=nav.children.find(node=>node.className==='eoffice-app-navigation__logout');
    const work=logout.events.click();documents.emit('input',{target:form});confirmed=false;
    const oldSession=requests.shift(),logoutRequest=requests.shift();
    logoutRequest.resolve({ok:true,json:async()=>({status:'success'})});await work;
    assert.equal(window.eofficeSessionState.status,'guest');assert.equal(store.size,1);
    oldSession.resolve({ok:true,json:async()=>({user:{id:7,status:'User',permissions:[]}})});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(window.eofficeSessionState.status,'guest','a pre-logout session response cannot reauthenticate the retained page');
    const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
    console.log('PASS shared logout race: new edits cancel storage clearing, server logout publishes guest, obsolete session checks cannot resume draft writes');
}
sharedLogoutRaceChecks().catch(error=>{console.error(error);process.exitCode=1;});

async function mainPermissionRefreshChecks() {
    const requests=[],window={...makeEventTarget(),eofficeUser:{id:7,permissions:['members']}},runtime={window,CustomEvent,
        fetch:()=>new Promise(resolve=>requests.push(resolve)),applyPermissionMenus(){},localStorage:{getItem:()=> 'public'},restrictedViewPermission:()=>null,console:{error(){}}};
    vm.createContext(runtime);vm.runInContext(main.slice(main.indexOf('let permissionRefreshSequence'),main.indexOf('function restrictedViewPermission(')),runtime);
    const older=runtime.refreshPermissionMenus(),latest=runtime.refreshPermissionMenus();
    const oldReply=requests.shift(),newReply=requests.shift();newReply({ok:true,json:async()=>({user:{id:8,permissions:[]}})});await latest;
    oldReply({ok:true,json:async()=>({user:{id:7,permissions:['members']}})});await older;assert.equal(window.eofficeUser.id,8);
    const pending=runtime.refreshPermissionMenus();window.eofficeRevokeSession();requests.shift()({ok:true,json:async()=>({user:{id:7,permissions:['members']}})});await pending;
    assert.equal(window.eofficeUser,null,'an outstanding main-page session check cannot undo a confirmed logout');
    vm.runInContext(main.match(/window\.addEventListener\('pageshow', event => \{[\s\S]*?\n\}\);/)[0],runtime);
    window.dispatchEvent({type:'pageshow',persisted:false});assert.equal(requests.length,0);
    window.dispatchEvent({type:'pageshow',persisted:true});assert.equal(window.eofficeSessionState.status,'pending','BFCache return must invalidate the cached authorization synchronously');
    requests.shift()({ok:true,json:async()=>({user:{id:9,permissions:[]}})});await new Promise(resolve=>setImmediate(resolve));assert.equal(window.eofficeUser.id,9);
    console.log('PASS main session refresh: latest reply wins and confirmed logout invalidates outstanding permission responses');
}
mainPermissionRefreshChecks().catch(error=>{console.error(error);process.exitCode=1;});

async function documentOwnerBoundaryChecks() {
    for(const scenario of ['different-owner','owner-return','reset-after-switch','late-response','late-return','late-pending-same-owner','same-owner-reauth']) {
        const form=new Element('form');form.id='document-form';form.elements=[];
        const nodes=new Map([[form.id,form]]),el=id=>{if(!nodes.has(id)){const node=new Element('input');node.value='original';nodes.set(id,node);}return nodes.get(id);};
        let finish,calls=0,reconciled=false;
        const window={...makeEventTarget(),eofficeUser:{id:7},alert(){},confirm:()=>true,
            captureDocumentFileState:()=>({}),reconcileDocumentFiles:()=>{reconciled=true;}};
        const document={...makeEventTarget(),getElementById:el};
        const runtime={window,document,location:{href:'http://localhost/index.php',origin:'http://localhost',pathname:'/index.php',search:''},URL,Event,CustomEvent,
            getCookie:()=> 'session',localStorage:{getItem:()=> 'send_table'},FormData:class{set(){}},alert(){},console:{error(){}},showView(){},
            fetch:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}};
        vm.createContext(runtime);vm.runInContext(fs.readFileSync('assets/form-owner-boundary.js','utf8'),runtime);
        vm.runInContext(fs.readFileSync('assets/document-form-guard.js','utf8'),runtime);
        vm.runInContext(main.slice(main.indexOf('const docForm ='),main.indexOf('function search_find(')),runtime);
        const session=id=>{window.eofficeUser=id?{id}:null;window.eofficeSessionState={status:id?'authenticated':'guest',user:window.eofficeUser,pageOwnerId:'7'};window.dispatchEvent(new Event('eoffice:session-updated'));};
        form.dispatchEvent(new Event('input'));
        if(scenario.startsWith('late')) {
            const save=form.events.submit({preventDefault(){}});
            if(scenario==='late-pending-same-owner')window.eofficeSessionState={status:'pending',user:{id:7},pageOwnerId:'7'};
            else {session(8);if(scenario==='late-return')session(7);}
            finish({ok:true,json:async()=>({status:'success',doc_id:99,files:{status:'success'}})});
            if(scenario==='late-pending-same-owner') {
                await new Promise(resolve=>setImmediate(resolve));assert.equal(reconciled,false);session(7);await save;
                assert.equal(el('doc_id').value,99);assert.equal(reconciled,true);continue;
            }
            await save;
            assert.equal(el('doc_id').value,'original');assert.equal(reconciled,false,'another account or a historical switch must reject the old attachment receipt');
            const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
        }else {
            session(scenario==='same-owner-reauth'?null:8);
            if(scenario!=='different-owner')session(7);
            if(scenario==='reset-after-switch')form.events.reset();
            const save=form.events.submit({preventDefault(){}});
            if(scenario==='same-owner-reauth'){finish({ok:true,json:async()=>({status:'success',doc_id:99,files:{status:'success'}})});await save;assert.equal(calls,1);}
            else {await save;assert.equal(calls,0,`${scenario}: cross-owner DOM must never be posted`);}
        }
    }
    assert.ok(index.indexOf('form-owner-boundary.js')<index.indexOf('assets/main.js'),'the owner boundary must be installed before the document handler');
    console.log('PASS main document owner boundary: account switch/return/reset blocks POST, late cross-owner receipts cannot mutate or clean forms, same-owner reauthentication remains valid');
}
documentOwnerBoundaryChecks().catch(error=>{console.error(error);process.exitCode=1;});

async function committedDocumentRecoveryChecks() {
    for(const outcome of ['recover','new-edit','different-owner','reset','discard']) {
        const form=new Element('form');form.id='document-form';form.elements=[];
        const nodes=new Map([[form.id,form]]),el=id=>{if(!nodes.has(id)){const node=new Element('input');node.value='original';nodes.set(id,node);}return nodes.get(id);};
        let finish,calls=0,reconciled=0,refreshed=false;
        const window={...makeEventTarget(),eofficeUser:{id:7},alert(){},confirm:()=>true,captureDocumentFileState:()=>({}),reconcileDocumentFiles:()=>{reconciled++;}};
        const document={...makeEventTarget(),getElementById:el};
        const runtime={window,document,location:{href:'http://localhost/index.php',origin:'http://localhost',pathname:'/index.php',search:''},URL,Event,CustomEvent,
            getCookie:()=> 'session',localStorage:{getItem:()=> 'send_table'},FormData:class{set(){}},alert(){},console:{error(){}},showView(){refreshed=true;},
            fetch:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}};
        vm.createContext(runtime);vm.runInContext(fs.readFileSync('assets/form-owner-boundary.js','utf8'),runtime);vm.runInContext(fs.readFileSync('assets/document-form-guard.js','utf8'),runtime);
        vm.runInContext(main.slice(main.indexOf('const docForm ='),main.indexOf('function search_find(')),runtime);
        const session=(status,id=7)=>{window.eofficeUser=status==='authenticated'?{id}:null;window.eofficeSessionState={status,user:window.eofficeUser,pageOwnerId:'7'};window.dispatchEvent(new Event('eoffice:session-updated'));};
        form.dispatchEvent(new Event('input'));const work=form.events.submit({preventDefault(){}});session('unavailable');
        finish({ok:true,json:async()=>({status:'success',doc_id:99,files:{status:'success'}})});await new Promise(resolve=>setImmediate(resolve));
        assert.equal(form.dataset.eofficeSaveState,'awaiting-session');assert.equal(reconciled,0);
        for(const status of ['pending','unavailable','guest']){session(status);await form.events.submit({preventDefault(){}});assert.equal(calls,1);}
        if(outcome==='new-edit')form.dispatchEvent(new Event('input'));
        if(outcome==='reset')form.dispatchEvent(new Event('reset'));
        else if(outcome==='discard')window.eofficeDiscardDocumentEdits();
        else session('authenticated',outcome==='different-owner'?8:7);
        await work;
        assert.equal(form.dataset.eofficeSaveState,undefined);
        assert.equal(reconciled,outcome==='recover'||outcome==='new-edit'?1:0,'only the same-owner live editor can consume the committed receipt');
        assert.equal(refreshed,outcome==='recover');
        if(outcome==='recover'||outcome==='new-edit'){assert.equal(el('doc_id').value,99);assert.equal(el('formtype').value,'edit_document');}
        else assert.equal(el('doc_id').value,'original');
        const warning=new Event('beforeunload',{cancelable:true});window.dispatchEvent(warning);
        assert.equal(warning.defaultPrevented,outcome==='new-edit'||outcome==='different-owner');
    }
    console.log('PASS committed document receipt recovery: repeated session failures/guest never resend create, same-owner recovery syncs once, later edits persist, account switch/reset/discard cancel safely');
}
committedDocumentRecoveryChecks().catch(error=>{console.error(error);process.exitCode=1;});
