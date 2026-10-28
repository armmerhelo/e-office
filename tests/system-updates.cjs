const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('./release-updates.cjs');
const source = fs.readFileSync('assets/system-updates.js', 'utf8');
const pageSource = fs.readFileSync('assets/system-updates-page.js', 'utf8');
const releases = JSON.parse(fs.readFileSync('data/system-updates.json', 'utf8'));
const item = (id, date = '2026-01-01') => ({id,date,title:'<script>plain text</script>',summary:'รายละเอียด',added:['เพิ่ม'],improved:[],fixed:[]});
class Node {
    constructor() { this.children=[]; this.hidden=false; this.attributes={}; this.listeners={}; this.textContent=''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children=nodes; }
    setAttribute(key,value) { this.attributes[key]=value; }
    addEventListener(type,callback) { this.listeners[type]=callback; }
}
function setup(items = releases, fail = false, values = new Map()) {
    const events={}, nodes=new Map();
    const state={items,fail,storageFail:false,writeFail:false,calls:0,now:Date.now(),timeouts:[],stall:null};
    const listen = (type, callback) => {
        const previous = events[type];
        events[type] = (...args) => Promise.all([previous?.(...args), callback(...args)]);
    };
    const node=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
    const window={eofficeUser:{id:1},eofficeSessionState:{status:'authenticated'},
        addEventListener:listen};
    const document={currentScript:{src:'https://example.test/sub/assets/system-updates.js'},hidden:true,
        getElementById:node, createElement:()=>new Node(),addEventListener:(type,callback)=>listen('document:'+type,callback)};
    node('group_menu_updates').style={};
    class Clock extends Date { static now() { return state.now; } }
    const stall = signal => new Promise((resolve,reject) => {
        state.release = resolve;
        signal.addEventListener('abort', () => reject(signal.reason), {once:true});
    });
    const context=vm.createContext({window,document,URL,Intl,Date:Clock,Set,Map,Error,JSON,
        AbortSignal:{timeout:ms=>{const controller=new AbortController();state.timeouts.push({ms,controller});return controller.signal;}},
        localStorage:{get length(){return values.size;},key:i=>[...values.keys()][i],clear:()=>values.clear(),removeItem:key=>{state.beforeRemove?.(key);values.delete(key);},getItem:key=>{if(state.storageFail)throw Error('denied');return values.get(key)||null;},setItem:(key,value)=>{if(state.storageFail||state.writeFail)throw Error('denied');values.set(key,value);}},
        fetch:async (url,options)=>{
            assert.equal(url.href,'https://example.test/sub/data/system-updates.json');state.calls++;
            if(state.stall==='fetch')await stall(options.signal);
            return {ok:!state.fail,json:async()=>{if(state.stall==='body')await stall(options.signal);return state.items;}};
        }});
    vm.runInContext(source,context);
    return {window,document,context,state,node,events,values};
}
async function run() {
    const env=setup([item('old'),item('latest','2026-02-01'),item('future','2999-01-01')]);
    const service=env.window.eofficeSystemUpdates;
    assert.deepEqual(Array.from(await service.load(),x=>x.id),['latest','old']);
    assert.equal(env.node('system-updates-badge').hidden,false);
    service.markRead('latest',2);
    assert.equal(env.node('system-updates-badge').hidden,false,'another account cannot mark read');
    env.window.eofficeRegisterModuleResume=callback=>env.resume=callback;
    vm.runInContext(pageSource,env.context);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(env.node('updates-list').children.length,2);
    assert.equal(env.node('updates-list').children[0].children[1].textContent,'<script>plain text</script>');
    assert.equal(env.node('system-updates-badge').hidden,false,'hidden/preloaded module must not mark read');
    env.document.hidden=false;await env.resume();
    assert.equal(env.node('system-updates-badge').hidden,true,'visible module marks read');
    env.values.set('User_Token','session');env.values.set('draft','private');
    service.clearSessionStorage();
    assert.deepEqual([...env.values.keys()],['eoffice:system-updates:read:1:"latest"'],'logout retains only read markers');
    env.window.eofficeUser={id:2};env.events['eoffice:session-updated']();
    assert.equal(env.node('system-updates-badge').hidden,false,'account-specific read state');
    await env.resume();
    assert.equal(env.node('system-updates-badge').hidden,false,'old module owner cannot mark new owner read');
    env.state.storageFail=true;service.markRead('latest',2);
    assert.equal(env.node('system-updates-badge').hidden,true,'in-memory fallback without storage');
    env.window.eofficeSessionState.status='guest';env.events['eoffice:session-updated']();
    assert.equal(env.node('group_menu_updates').style.display,'none');
    assert.equal(env.node('system-updates-badge').hidden,true);
    console.log('PASS sorting, future entries, safe text rendering, visible-only read, account isolation, storage fallback and logout');

    const failure=setup([item('valid')],true);
    await assert.rejects(failure.window.eofficeSystemUpdates.load());
    vm.runInContext(pageSource,failure.context);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(failure.node('updates-retry').hidden,false);
    assert.equal(failure.node('updates-list').attributes['aria-busy'],'false');
    failure.state.fail=false;
    await failure.node('updates-retry').listeners.click();
    assert.equal(failure.node('updates-list').children.length,1);
    assert.equal(failure.node('updates-retry').hidden,true);
    const empty=setup([]);await empty.window.eofficeSystemUpdates.load();
    assert.equal(empty.node('system-updates-badge').hidden,true);
    const invalid=setup([item('duplicate'),item('duplicate')]);
    await assert.rejects(invalid.window.eofficeSystemUpdates.load());
    const invalidDate=setup([item('invalid-date','2026-02-30')]);
    await assert.rejects(invalidDate.window.eofficeSystemUpdates.load());
    const invalidVersion=setup([{...item('invalid-version'),version:{bad:true}}]);
    await assert.rejects(invalidVersion.window.eofficeSystemUpdates.load());
    const leap=setup([item('leap-day','2024-02-29')]);
    assert.equal((await leap.window.eofficeSystemUpdates.load())[0].date,'2024-02-29');
    console.log('PASS network failure/retry, empty feed and invalid duplicate IDs');
    const actual=setup();assert.ok((await actual.window.eofficeSystemUpdates.load()).length);
    console.log('PASS published release feed schema');
    const commit = {hash:'a'.repeat(40), category:'fixed', summary:'<script>อธิบายเป็นข้อความ</script>'};
    const withCommits = setup([{...item('deployed'), commits:[commit]}]);
    await withCommits.window.eofficeSystemUpdates.load();
    vm.runInContext(pageSource, withCommits.context);
    await new Promise(resolve=>setImmediate(resolve));
    const details = withCommits.node('updates-list').children[0].children.at(-1);
    assert.equal(details.children[0].textContent, 'รายละเอียดแต่ละ commit (1 รายการ)');
    const row = details.children[1].children[0];
    assert.equal(row.children[0].textContent, 'aaaaaaa');
    assert.equal(row.children[0].title, commit.hash);
    assert.equal(row.children[1].textContent, ` — ${commit.summary}`, 'commit summaries render as plain text');
    for (const invalidCommit of [{...commit, hash:'bad'}, {...commit, summary:''}, {...commit, category:'unknown'}, null]) {
        const malformed = setup([{...item('bad-commit'), commits:[invalidCommit]}]);
        await assert.rejects(malformed.window.eofficeSystemUpdates.load());
    }
    console.log('PASS per-commit details, safe text and invalid commit metadata rejection');

    const shared=new Map(), marker='eoffice:system-updates:read:1:"v2"';
    const tabA=setup([item('v1')],false,shared), tabB=setup([item('v2','2026-02-01')],false,shared);
    await tabA.window.eofficeSystemUpdates.load();
    tabA.window.eofficeSystemUpdates.markRead('v1',1);
    await tabB.window.eofficeSystemUpdates.load();
    tabB.window.eofficeSystemUpdates.markRead('v2',1);
    await tabA.events.storage({key:marker,newValue:'1'});
    tabA.window.eofficeSystemUpdates.markRead('v1',1);
    await tabB.events.storage({key:'eoffice:system-updates:read:1:"v1"',newValue:'1'});
    assert.equal(tabB.node('system-updates-badge').hidden,true,'late old read cannot undo newer read');
    tabA.state.items=[item('v2','2026-02-01')];
    await tabA.window.eofficeSystemUpdates.load({force:true});
    assert.equal(tabA.node('system-updates-badge').hidden,true,'reading in tab B clears tab A badge after feed refresh');
    shared.delete(marker);
    await tabA.events.storage({key:marker,newValue:null});
    assert.equal(tabA.node('system-updates-badge').hidden,false,'removing a read marker in another tab restores unread state');
    tabA.state.writeFail=true;
    tabA.window.eofficeSystemUpdates.markRead('v2',1);
    assert.equal(tabA.node('system-updates-badge').hidden,true,'failed writes still remember read state locally');
    shared.set(marker,'0');
    await tabA.events.storage({key:'unrelated',newValue:'value'});
    assert.equal(tabA.node('system-updates-badge').hidden,true,'unrelated storage events preserve unsaved fallback');
    await tabA.events.storage({key:marker,newValue:'0'});
    assert.equal(tabA.node('system-updates-badge').hidden,false,'cross-tab marker replaces fallback state');
    tabA.window.eofficeSystemUpdates.markRead('v2',1);
    assert.equal(tabA.node('system-updates-badge').hidden,true,'failed write fallback overrides stale readable storage');
    shared.clear();
    await tabA.events.storage({key:null,newValue:null});
    assert.equal(tabA.node('system-updates-badge').hidden,false,'storage clear also invalidates fallback state');
    console.log('PASS shared-storage tabs: new read marker, removal, clear and failed-write fallback');

    const legacyValues=new Map([['eoffice:system-updates:seen:1','legacy']]);
    const legacy=setup([item('legacy')],false,legacyValues);
    await legacy.window.eofficeSystemUpdates.load();
    assert.equal(legacy.node('system-updates-badge').hidden,true,'legacy read marker remains honored');
    legacy.state.items=[item('new-release','2026-02-01')];
    await legacy.window.eofficeSystemUpdates.load({force:true});
    assert.equal(legacy.node('system-updates-badge').hidden,false,'legacy marker cannot hide a different release');
    legacy.window.eofficeSystemUpdates.markRead('new-release',1);
    legacyValues.set('User_Token','secret');legacyValues.set('draft','private');
    legacy.window.eofficeSystemUpdates.clearSessionStorage();
    assert.deepEqual([...legacyValues.keys()].sort(),['eoffice:system-updates:read:1:"new-release"','eoffice:system-updates:seen:1']);
    const restored=setup([item('new-release','2026-02-01')],false,legacyValues);
    await restored.window.eofficeSystemUpdates.load();
    assert.equal(restored.node('system-updates-badge').hidden,true,'new marker survives logout and reload');
    restored.window.eofficeUser={id:2};await restored.events['eoffice:session-updated']();
    assert.equal(restored.node('system-updates-badge').hidden,false,'persisted read markers remain account-specific');
    console.log('PASS legacy compatibility, logout preservation, reload and account isolation');

    const interleaved=new Map();
    const slow=setup([item('slow-v1')],false,interleaved);
    await slow.window.eofficeSystemUpdates.load();slow.state.stall='body';slow.document.hidden=false;
    const slowRead=slow.window.eofficeSystemUpdates.load({force:true}).then(items=>slow.window.eofficeSystemUpdates.markRead(items[0].id,1));
    await new Promise(resolve=>setImmediate(resolve));
    const fast=setup([item('fast-v2','2026-03-01')],false,interleaved);
    await fast.window.eofficeSystemUpdates.load();fast.window.eofficeSystemUpdates.markRead('fast-v2',1);
    slow.state.release();await slowRead;
    await fast.events.storage({key:'eoffice:system-updates:read:1:"slow-v1"',newValue:'1'});
    assert.equal(fast.node('system-updates-badge').hidden,true,'late older response cannot undo the newer read');
    const revisit=setup([item('fast-v2','2026-03-01')],false,interleaved);
    await revisit.window.eofficeSystemUpdates.load();
    assert.equal(revisit.node('system-updates-badge').hidden,true,'out-of-order reads stay correct after reload');
    console.log('PASS delayed old response after newer read, cross-tab storage event and reload');

    const duringLogout=setup([item('logout-concurrent','2026-04-01')],false,interleaved);
    await duringLogout.window.eofficeSystemUpdates.load();
    interleaved.set('private-draft','private');
    fast.state.beforeRemove=()=>duringLogout.window.eofficeSystemUpdates.markRead('logout-concurrent',1);
    fast.window.eofficeSystemUpdates.clearSessionStorage();
    assert.equal(interleaved.get('eoffice:system-updates:read:1:"logout-concurrent"'),'1','logout does not erase a concurrent tab read');
    assert.equal(interleaved.has('private-draft'),false);
    console.log('PASS concurrent read during logout cleanup preserves marker and removes session data');

    const refresh=setup([item('v1')]), api=refresh.window.eofficeSystemUpdates;
    await api.load();
    const initialCalls=refresh.state.calls;
    refresh.state.items=[item('v2','2026-02-01')];
    assert.equal((await api.load())[0].id,'v1','fresh cache can be reused');
    assert.equal(refresh.state.calls,initialCalls);
    refresh.state.now+=60_001;
    assert.equal((await api.load())[0].id,'v2','expired cache reloads the feed');
    api.markRead('v2',1);
    refresh.state.items=[item('v3','2026-03-01')];
    refresh.document.hidden=false;
    await refresh.events.focus();await api.load();
    assert.equal(refresh.node('system-updates-badge').hidden,false,'new release appears on focus without page reload');
    refresh.window.eofficeRegisterModuleResume=callback=>refresh.resume=callback;
    vm.runInContext(pageSource,refresh.context);
    await new Promise(resolve=>setImmediate(resolve));
    refresh.document.hidden=true;
    refresh.state.items=[item('v4','2026-04-01')];
    await refresh.events.focus();
    assert.equal((await api.load())[0].id,'v3','hidden tab does not refresh or mark unseen content');
    refresh.document.hidden=false;
    await refresh.resume();
    assert.equal((await api.load())[0].id,'v4');
    assert.equal(refresh.node('system-updates-badge').hidden,true,'module reentry renders the latest feed and marks it read');
    refresh.state.items=[item('v5','2026-05-01')];
    await refresh.events['document:visibilitychange']();
    assert.equal((await api.load())[0].id,'v5');
    assert.equal(refresh.node('updates-list').children[0].children[0].children[0].dateTime,'2026-05-01');
    refresh.state.items=[item('v6','2026-06-01')];
    await refresh.events.pageshow({persisted:true});await api.load();
    assert.equal((await api.load())[0].id,'v6','BFCache return refreshes feed');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(refresh.node('updates-list').children[0].children[0].children[0].dateTime,'2026-06-01','BFCache refresh also updates displayed cards');
    console.log('PASS cache expiry, focus/visibility/BFCache refresh, module reentry and latest badge/list consistency');

    for(const phase of ['fetch','body']) {
        const timeout=setup([item('before')]), loader=timeout.window.eofficeSystemUpdates;
        await loader.load();timeout.document.hidden=false;
        vm.runInContext(pageSource,timeout.context);
        await new Promise(resolve=>setImmediate(resolve));
        timeout.state.items=[item('after','2026-06-01')];timeout.state.stall=phase;
        const attempt=timeout.node('updates-retry').listeners.click();
        const shared=loader.load({force:true});
        const rejected=assert.rejects(shared,{name:'TimeoutError'});
        await new Promise(resolve=>setImmediate(resolve));
        const deadline=timeout.state.timeouts.at(-1);
        assert.equal(deadline.ms,20_000);
        const calls=timeout.state.calls;
        deadline.controller.abort(new DOMException('Timed out','TimeoutError'));
        await rejected;await attempt;
        assert.equal(timeout.node('updates-feedback').hidden,false);
        assert.equal(timeout.node('updates-retry').hidden,false);
        assert.equal(timeout.node('updates-list').attributes['aria-busy'],'false');
        assert.equal(timeout.node('updates-list').children.length,1,'failed refresh keeps prior cards');
        timeout.state.stall=null;
        await timeout.node('updates-retry').listeners.click();
        assert.equal(timeout.state.calls,calls+1,'retry starts a fresh request after timeout');
        assert.equal(timeout.node('updates-retry').hidden,true);
        assert.equal(timeout.node('updates-list').children[0].children[0].children[0].dateTime,'2026-06-01');
        console.log(`PASS ${phase} timeout: shared pending request, visible error, retained content and successful retry`);
    }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
