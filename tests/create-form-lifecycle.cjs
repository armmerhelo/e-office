const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));

class Node extends EventTarget {
    constructor(id='',type='text') {
        super();this.id=id;this.name=id;this.type=type;this.tagName='INPUT';this.value='';this.checked=false;this.disabled=false;
        this.files=[];this.dataset={};this.children=[];this.attributes={};const classes=new Set();
        this.classList={add:cls=>classes.add(cls),remove:cls=>classes.delete(cls),contains:cls=>classes.has(cls)};
    }
    appendChild(node){this.children.push(node);return node;}
    set innerHTML(value){this.html=value;this.children=[];}
    get innerHTML(){return this.html||'';}
    querySelector(selector){this.parts ||= new Map();if(!this.parts.has(selector))this.parts.set(selector,new Node());return this.parts.get(selector);}
    querySelectorAll(selector){return this.children.filter(node=>selector==='button'?node.tagName==='BUTTON':selector==='.field-error'?node.classList.contains('field-error'):false);}
    setAttribute(name,value){this.attributes[name]=value;}
    removeAttribute(name){delete this.attributes[name];}
    focus(){}
    remove(){}
    before(node){this.notices ||= [];this.notices.push(node);}
}
function setup(kind,{store=new Map(),drafts=false,owner=7,preselectedFiles=[],storage}={}) {
    const id=kind==='maintenance'?'maintenanceForm':'bookingForm', form=new Node(id);form.tagName='FORM';form.elements=[];
    form.checkValidity=()=>true;form.reportValidity=()=>{};
    const ids=kind==='maintenance'?['requesterName','position','department','phone','requestDate','otherTypeCheckbox','otherTypeDetail','building','room','damageDetails','imageFiles']:
        ['requesterName','department','roomSelect','otherRoom','topic','attendees','startDate','endDate','startTime','endTime','equipAudio','equipComputer','equipProjector','equipFood','equipOtherCheck','equipOtherCheck2','equipOtherCheck3','equipOtherText','agreement'];
    const nodes=new Map([[id,form]]);
    for(const name of ids){const type=name==='imageFiles'?'file':name==='otherTypeCheckbox'||name.startsWith('equip')&&!name.endsWith('Text')||name==='agreement'?'checkbox':'text';const node=new Node(name,type);node.value=type==='text'?'QA value':'';form.elements.push(node);nodes.set(name,node);}
    const el=id=>{if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);};
    const submit=el('submitBtn');submit.type='submit';form.elements.push(submit);
    const bootstrap=new Node('bootstrap','fieldset');bootstrap.tagName='FIELDSET';bootstrap.disabled=true;
    form.querySelector=selector=>selector.includes('fieldset')?bootstrap:submit;
    const text=el(kind==='maintenance'?'damageDetails':'topic');text.value='submitted text';
    if(drafts)for(const node of form.elements){node.value='';node.checked=false;}
    form.resets=0;form.reset=()=>{form.dispatchEvent(new Event('reset'));form.resets++;for(const field of form.elements){field.value='';field.checked=false;}};
    const document=new EventTarget();Object.assign(document,{cookie:'',readyState:'complete',getElementById:name=>['maintenanceForm','bookingForm'].includes(name)?nodes.get(name)||null:el(name),querySelector:()=>null,
        querySelectorAll:()=>[el('otherTypeCheckbox')],createElement:()=>new Node(),body:new Node()});
    const window=Object.assign(new EventTarget(),{eofficeUser:{id:owner},eofficeSessionState:{revision:1,status:'authenticated',user:{id:owner},pageOwnerId:String(owner)},alerts:[],alert(message){this.alerts.push(message);}});
    const requests=[],readers=[];
    const context={document,window,Event,CustomEvent,Date,location:{pathname:kind==='maintenance'?'/maintenance_requests/index.html':'/room_booking/new_room.html'},
        sessionStorage:storage || {getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},
        console:{error(){}},alert:message=>window.alerts.push(message),requestAnimationFrame:callback=>callback(),setTimeout(){},queueMicrotask,
        fetch:(url,options)=>new Promise(resolve=>requests.push({resolve,body:JSON.parse(options.body)})),
        FileReader:class{constructor(){this.readyState=1;readers.push(this);}readAsDataURL(){}abort(){this.onabort?.();}}};
    vm.createContext(context);vm.runInContext(fs.readFileSync('assets/form-owner-boundary.js','utf8'),context);vm.runInContext(fs.readFileSync('assets/draft-commits.js','utf8'),context);vm.runInContext(fs.readFileSync('assets/create-form-lifecycle.js','utf8'),context);
    vm.runInContext(fs.readFileSync('assets/form-dates.js','utf8'),context);
    assert.equal(bootstrap.disabled,false,'bootstrap controls must be enabled after installing early-edit protection');
    if(kind==='maintenance'){
        el('imageFiles').files=preselectedFiles;
        vm.runInContext(fs.readFileSync('maintenance_requests/script.js','utf8'),context);document.dispatchEvent(new Event('DOMContentLoaded'));
    }else{
        const html=fs.readFileSync('room_booking/new_room.html','utf8');
        context.getCookie=()=> 'session';context.updateRoomPreview=context.toggleOtherRoom=context.toggleOtherEquip=()=>{};
        vm.runInContext(html.slice(html.indexOf('        async function submit_bookingroom('),html.indexOf('        // แสดงช่องกรอกเมื่อเลือก "อื่นๆ" ในส่วนสถานที่')),context);
        form.addEventListener('submit',event=>context.submit_bookingroom(event));
    }
    if(drafts)vm.runInContext(fs.readFileSync('assets/module-drafts.js','utf8'),context);
    const submitForm=()=>form.dispatchEvent(new Event('submit',{cancelable:true}));
    const finish=async(success=true)=>{requests.shift().resolve({ok:success,status:503,json:async()=>({status:success?'success':'error',message:'QA error'})});await tick();};
    return {form,text,window,nodes,el,requests,readers,context,submitForm,finish,store};
}
async function run() {
    const maintenanceHtml=fs.readFileSync('maintenance_requests/index.html','utf8');
    assert.match(maintenanceHtml,/<input type="text" id="phone"[^>]*inputmode="tel"/,'phone keyboard changes must preserve the field type used by existing saved drafts');
    for(const html of ['maintenance_requests/index.html','room_booking/new_room.html']) assert.match(fs.readFileSync(html,'utf8'),/<fieldset disabled data-eoffice-bootstrap/,'controls must not be editable before the first lifecycle script is installed');
    for(const kind of ['maintenance','booking'])for(const outcome of ['success','new-edit','silent-edit','reset','failure','new-owner','owner-return']) {
        const page=setup(kind);const previouslyDisabled=page.el('department');previouslyDisabled.disabled=true;
        page.submitForm();assert.equal(page.requests.length,1);assert.ok(page.form.elements.every(node=>node.disabled),'all controls must be frozen while saving');
        assert.equal(page.requests[0].body._expected_owner,'7','new form requests must carry the owner captured before posting');
        page.submitForm();assert.equal(page.requests.length,1,'a duplicate submit cannot create another request');
        if(outcome==='new-edit'||outcome==='silent-edit'){page.text.value='new unsent text';if(outcome==='new-edit')page.form.dispatchEvent(new Event('input'));}
        if(outcome==='reset'){page.form.reset();page.text.value='fresh form';page.form.dispatchEvent(new Event('input'));}
        if(outcome==='new-owner'||outcome==='owner-return'){
            page.window.eofficeSessionState={status:'authenticated',user:{id:8},pageOwnerId:'7'};page.window.eofficeUser={id:8};page.window.dispatchEvent(new Event('eoffice:session-updated'));
            if(outcome==='owner-return'){page.window.eofficeSessionState={status:'authenticated',user:{id:7},pageOwnerId:'7'};page.window.eofficeUser={id:7};page.window.dispatchEvent(new Event('eoffice:session-updated'));}
        }
        const resets=page.form.resets;await page.finish(outcome!=='failure');
        assert.equal(page.form.resets,resets+(outcome==='success'?1:0),`${kind}/${outcome}: success can reset only the unchanged same-owner form`);
        if(outcome==='new-edit'||outcome==='silent-edit')assert.equal(page.text.value,'new unsent text');
        assert.equal(previouslyDisabled.disabled,true);assert.equal(page.text.disabled,false);
    }
    for(const status of ['pending','guest','switched']) {
        const page=setup('maintenance');page.window.eofficeSessionState=status==='switched'?{status:'authenticated',user:{id:8},pageOwnerId:'7'}:{status,user:null,pageOwnerId:'7'};
        page.submitForm();assert.equal(page.requests.length,0,`${status} session must not send old-owner form data`);assert.equal(page.text.disabled,false);
    }
    for(const kind of ['maintenance','booking']) {
        const page=setup(kind);
        for(const id of [8,7]){page.window.eofficeUser={id};page.window.eofficeSessionState={status:'authenticated',user:{id},pageOwnerId:'7'};page.window.dispatchEvent(new Event('eoffice:session-updated'));}
        page.form.reset();page.text.value='new text on previously conflicted page';page.submitForm();
        assert.equal(page.requests.length,0,'returning to the first account and resetting the form must not unlock a conflicted page');
        assert.ok(page.window.alerts.at(-1).includes('โหลดหน้าใหม่'));
    }
    for(const kind of ['maintenance','booking']) {
        const page=setup(kind);page.submitForm();
        page.window.eofficeSessionState={status:'pending',user:{id:7},pageOwnerId:'7'};page.window.dispatchEvent(new Event('eoffice:session-updated'));
        await page.finish();assert.equal(page.form.resets,0,'a committed response waits for the pending identity check');assert.equal(page.text.disabled,true);
        page.window.eofficeSessionState={status:'authenticated',user:{id:7},pageOwnerId:'7'};page.window.dispatchEvent(new Event('eoffice:session-updated'));await tick();
        assert.equal(page.form.resets,1);assert.equal(page.text.disabled,false);
    }
    for(const kind of ['maintenance','booking'])for(const newerDraft of [false,true]) {
        const store=new Map(),page=setup(kind,{store,drafts:true});await tick();
        page.text.value='already committed text';page.form.dispatchEvent(new Event('input'));
        const owner='7',path=page.context.location.pathname,key=`eoffice-draft:${owner}:${path}:${page.form.id}`;
        assert.ok(store.get(key).includes('already committed text'));
        page.submitForm();
        page.window.eofficeUser=null;page.window.eofficeSessionState={revision:2,status:'unavailable',user:null,pageOwnerId:owner};page.window.dispatchEvent(new Event('eoffice:session-updated'));
        if(newerDraft){
            const updated=JSON.parse(store.get(key));updated.find(field=>field.id===page.text.id).value='newer unsent draft';store.set(key,JSON.stringify(updated));
        }
        await page.finish();assert.equal(page.form.dataset.eofficeSaveState,'awaiting-session');
        assert.ok([...store.keys()].some(key=>key.startsWith('eoffice-committed:7:')));
        const other=setup(kind,{store,drafts:true,owner:8});await tick();assert.equal(other.text.value,'','another account must not restore the committed or pending fields');
        const reloaded=setup(kind,{store,drafts:true});await tick();
        assert.equal(reloaded.text.value,newerDraft?'newer unsent draft':'','reload must suppress only the exact completed draft');
        if(!newerDraft){
            assert.equal(store.has(key),false);
            reloaded.text.value='already committed text';reloaded.form.dispatchEvent(new Event('input'));
            const again=setup(kind,{store,drafts:true});await tick();assert.equal(again.text.value,'already committed text','a fresh intentional draft with the same text is a different draft version');
        }else assert.ok(store.get(key).includes('newer unsent draft'));
        page.form.reset();await tick();
    }
    for(const kind of ['maintenance','booking']) {
        const store=new Map(),old=setup(kind,{store,drafts:true});await tick();old.text.value='identical text';old.form.dispatchEvent(new Event('input'));old.submitForm();
        old.window.eofficeSessionState={revision:2,status:'unavailable',user:null,pageOwnerId:'7'};old.window.dispatchEvent(new Event('eoffice:session-updated'));
        const path=old.context.location.pathname,key=`eoffice-draft:7:${path}:${old.form.id}`;
        const version='newer-editor-version';store.set(`eoffice-draft-version:7:${path}:${old.form.id}`,version);
        await old.finish();
        const latest=setup(kind,{store,drafts:true});await tick();assert.equal(latest.text.value,'identical text','an older save must not mark a newer identical draft as completed');
        const before=store.get(key);old.form.dispatchEvent(new Event('input'));assert.equal(store.get(key),before,'a cached old editor cannot overwrite a newer draft');
        old.form.reset();await tick();assert.equal(store.get(key),before,'a stale reset cannot erase a newer editor');
    }
    for(const kind of ['maintenance','booking']) {
        const store=new Map(),old=setup(kind,{store,drafts:true});await tick();
        old.text.value='older cached text';old.form.dispatchEvent(new Event('input'));
        const newest=setup(kind,{store,drafts:true});await tick();newest.text.value='newer unsent text';newest.form.dispatchEvent(new Event('input'));
        const key=`eoffice-draft:7:${old.context.location.pathname}:${old.form.id}`,before=store.get(key);
        old.window.eofficeSessionState={revision:2,status:'pending',user:{id:7},pageOwnerId:'7'};old.window.dispatchEvent(new Event('eoffice:session-updated'));
        old.window.eofficeSessionState={revision:3,status:'authenticated',user:{id:7},pageOwnerId:'7'};old.window.dispatchEvent(new Event('eoffice:session-updated'));
        assert.equal(store.get(key),before,'an ordinary new page must own the editor slot without a reset or a committed draft');
        old.form.reset();assert.equal(store.get(key),before,'a restored cached editor must not delete the latest page draft');
        old.submitForm();assert.equal(old.requests.length,0,'a restored cached editor must not POST after another page acquired the slot');
    }
    for(const kind of ['maintenance','booking']) {
        const store=new Map(),old=setup(kind,{store,drafts:true});await tick();old.text.value='older request';old.form.dispatchEvent(new Event('input'));old.submitForm();
        const newest=setup(kind,{store,drafts:true});await tick();newest.text.value='latest completed request';newest.form.dispatchEvent(new Event('input'));newest.submitForm();
        newest.window.eofficeUser=null;newest.window.eofficeSessionState={revision:2,status:'unavailable',user:null,pageOwnerId:'7'};newest.window.dispatchEvent(new Event('eoffice:session-updated'));
        await newest.finish();
        const key=`eoffice-committed:7:${old.context.location.pathname}:${old.form.id}`,latest=store.get(key);
        await old.finish();assert.equal(store.get(key),latest,'a stale response cannot overwrite a newer editor commit marker');
        const reloaded=setup(kind,{store,drafts:true});await tick();assert.equal(reloaded.text.value,'','reload must still recognize the latest completed request');
        newest.form.reset();await tick();
    }
    const cleared=setup('maintenance');cleared.submitForm();await cleared.finish();cleared.store.clear();
    cleared.submitForm();assert.equal(cleared.requests.length,0,'a cached editor cannot use its memory version to resurrect cleared session storage');
    for(const kind of ['maintenance','booking']) {
        const store=new Map();const storage={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
        const old=setup(kind,{store,storage,drafts:true});await tick();old.text.value='keep until saved';old.form.dispatchEvent(new Event('input'));
        const editorKey=`eoffice-draft-editor:7:${old.context.location.pathname}:${old.form.id}`;
        let failing=true;storage.setItem=(key,value)=>{if(failing && key===editorKey)throw new Error('QA transient editor write failure');store.set(key,value);};
        const current=setup(kind,{store,storage,drafts:true});await tick();
        const draftKey=`eoffice-draft:7:${old.context.location.pathname}:${old.form.id}`,before=store.get(draftKey);
        current.text.value='new value without draft storage';current.form.dispatchEvent(new Event('input'));
        assert.equal(store.get(draftKey),before,'a memory-only claim must not overwrite the prior editor draft');
        assert.equal(current.form.dataset.eofficeDraftState,'unavailable');
        current.submitForm();assert.equal(current.requests.length,1,'an active editor must still be able to save when its metadata write temporarily fails');
        await current.finish();assert.equal(current.form.resets,1,'the API success must still complete the active form');
        const markerKey=`eoffice-committed:7:${old.context.location.pathname}:${old.form.id}`,marker=store.get(markerKey),after=store.get(draftKey);
        assert.ok(marker,'a durable handoff must remain when the editor slot still cannot be written');
        old.form.dispatchEvent(new Event('input'));old.form.reset();old.submitForm();
        assert.equal(old.requests.length,0);assert.equal(store.get(markerKey),marker);assert.equal(store.get(draftKey),after,'the old persisted editor must be revoked by the successful receipt');
        failing=false;
        current.form.reset();current.text.value='fresh request after storage recovery';current.form.dispatchEvent(new Event('input'));
        current.submitForm();assert.equal(current.requests.length,1);await current.finish(false);
    }
    for(const kind of ['maintenance','booking']) {
        const store=new Map(),storage={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
        const page=setup(kind,{store,storage,drafts:true});await tick();page.text.value='prior draft';page.form.dispatchEvent(new Event('input'));
        const key=`eoffice-draft-version:7:${page.context.location.pathname}:${page.form.id}`;
        storage.setItem=(slot,value)=>{if(slot===key)throw new Error('QA version write failure');store.set(slot,value);};
        page.form.reset();page.text.value='fresh data after reset';page.form.dispatchEvent(new Event('input'));
        page.submitForm();assert.equal(page.requests.length,1,'a failed version metadata write must not block the core API save');await page.finish();
        assert.equal(page.form.resets,2);
    }
    for(const kind of ['maintenance','booking']) {
        const store=new Map(),storage={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
        const old=setup(kind,{store,storage,drafts:true});await tick();old.text.value='old live editor';old.form.dispatchEvent(new Event('input'));
        const prefix=`:7:${old.context.location.pathname}:${old.form.id}`;
        storage.setItem=(key,value)=>{if(key===`eoffice-draft-editor${prefix}`||key===`eoffice-draft-version${prefix}`)throw new Error('QA metadata write failed');store.set(key,value);};
        const current=setup(kind,{store,storage,drafts:true});await tick();current.form.reset();current.text.value='saved despite metadata outage';current.form.dispatchEvent(new Event('input'));
        current.submitForm();assert.equal(current.requests.length,1);await current.finish();
        old.form.reset();old.submitForm();assert.equal(old.requests.length,0,'a receipt handoff must revoke the old editor even if both normal metadata slots are read-only');
        const record=JSON.parse(store.get(`eoffice-committed${prefix}`));assert.equal(record.editor,current.form.dataset.eofficeDraftEditor);
    }
    for(const kind of ['maintenance','booking']) {
        const store=new Map(),storage={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
        const original=setup(kind,{store,storage,drafts:true});await tick();original.text.value='initial draft';original.form.dispatchEvent(new Event('input'));
        const editorKey=`eoffice-draft-editor:7:${original.context.location.pathname}:${original.form.id}`;let failing=true;
        storage.setItem=(key,value)=>{if(failing&&key===editorKey)throw new Error('QA failed claim');store.set(key,value);};
        const delayed=setup(kind,{store,storage,drafts:true});await tick();delayed.text.value='older submitted data';delayed.form.dispatchEvent(new Event('input'));delayed.submitForm();assert.equal(delayed.requests.length,1);
        failing=false;const latest=setup(kind,{store,storage,drafts:true});await tick();latest.text.value='latest unsent data';latest.form.dispatchEvent(new Event('input'));
        const key=`eoffice-draft:7:${original.context.location.pathname}:${original.form.id}`,before=store.get(key);await delayed.finish();
        assert.equal(store.get(key),before,'a delayed receipt from a failed claim must never take over and reset the latest editor draft');
        assert.equal(latest.window.eofficeDraftCommits.currentEditor('7',latest.context.location.pathname,latest.form.id,latest.form.dataset.eofficeDraftEditor),true);
    }
    for(const kind of ['maintenance','booking']) {
        const store=new Map(),storage={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
        const old=setup(kind,{store,storage,drafts:true});await tick();old.text.value='starting draft';old.form.dispatchEvent(new Event('input'));
        const key=`eoffice-draft-version:7:${old.context.location.pathname}:${old.form.id}`;
        storage.setItem=(slot,value)=>{if(slot===key)throw new Error('QA version write failure');store.set(slot,value);};
        old.form.reset();old.text.value='old request during version failure';old.form.dispatchEvent(new Event('input'));old.submitForm();assert.equal(old.requests.length,1);
        const latest=setup(kind,{store,storage,drafts:true});await tick();latest.text.value='latest active data';latest.form.dispatchEvent(new Event('input'));
        const version=latest.form.dataset.eofficeDraftVersion;await old.finish();
        assert.equal(latest.window.eofficeDraftCommits.current('7',latest.context.location.pathname,latest.form.id,version),true,'a stale response must not take over the latest draft version through a receipt handoff');
        latest.submitForm();assert.equal(latest.requests.length,1);await latest.finish(false);
    }
    for(const kind of ['maintenance','booking']) {
        const store=new Map(),page=setup(kind,{store});
        const key=`eoffice-draft:7:${page.context.location.pathname}:${page.form.id}`;
        store.set(key,page.window.eofficeDraftCommits.signature(page.form));
        page.form.reset();vm.runInContext(fs.readFileSync('assets/module-drafts.js','utf8'),page.context);await tick();
        assert.equal(store.has(key),false,'resetting before the draft script loads must not revive the old draft');
        page.form.reset();page.text.value='new draft after reset';page.form.dispatchEvent(new Event('input'));assert.ok(store.get(key).includes('new draft after reset'));
    }
    for(const kind of ['maintenance','booking']) {
        const store=new Map(),page=setup(kind,{store});
        const key=`eoffice-draft:7:${page.context.location.pathname}:${page.form.id}`;
        const older=JSON.parse(page.window.eofficeDraftCommits.signature(page.form));older.find(field=>field.id===page.text.id).value='stored before script load';older.find(field=>field.id==='department').value='untouched stored department';store.set(key,JSON.stringify(older));
        page.form.dataset.eofficeRequiresDraft='true';
        page.text.value='typed before draft script loaded';
        const event=new Event('input');Object.defineProperty(event,'target',{value:page.text});page.form.dispatchEvent(event);
        const earlyUnload=new Event('beforeunload',{cancelable:true});page.window.dispatchEvent(earlyUnload);assert.equal(earlyUnload.defaultPrevented,true,'early text must warn before the shared navigation guard is loaded');
        page.window.dispatchEvent(new Event('eoffice:leaving-confirmed'));const approved=new Event('beforeunload',{cancelable:true});page.window.dispatchEvent(approved);assert.equal(approved.defaultPrevented,false,'early edits must not cause a second warning after a confirmed departure');
        page.window.dispatchEvent(new Event('eoffice:leaving-cancelled'));
        let replayedDirty=false;page.form.addEventListener('eoffice:form-dirty',event=>{replayedDirty=event.detail.replayed;});
        const earlySubmit=new Event('submit',{cancelable:true});page.form.dispatchEvent(earlySubmit);
        assert.equal(earlySubmit.defaultPrevented,true,'a native submit must not fall through to GET while DOMContentLoaded handlers are waiting');
        assert.equal(page.requests.length,0,'the native application must wait for its draft consumer before submitting');
        vm.runInContext(fs.readFileSync('assets/module-drafts.js','utf8'),page.context);await tick();
        assert.equal(page.text.value,'typed before draft script loaded','loading the deferred draft script must not overwrite earlier input');
        assert.ok(store.get(key).includes('typed before draft script loaded'));
        assert.equal(page.el('department').value,'untouched stored department');assert.equal(replayedDirty,true);
        page.submitForm();assert.equal(page.requests.length,1);await page.finish(false);
    }
    for(const kind of ['maintenance','booking']) {
        const store=new Map(),page=setup(kind,{store});
        const key=`eoffice-draft:7:${page.context.location.pathname}:${page.form.id}`;
        store.set(key,page.window.eofficeDraftCommits.signature(page.form));const before=store.get(key);
        for(const id of [8,7]){page.window.eofficeUser={id};page.window.eofficeSessionState={revision:id===8?2:3,status:'authenticated',user:{id},pageOwnerId:'7'};page.window.dispatchEvent(new Event('eoffice:session-updated'));}
        page.text.value='private input from the switched account';
        const event=new Event('input');Object.defineProperty(event,'target',{value:page.text});page.form.dispatchEvent(event);
        vm.runInContext(fs.readFileSync('assets/module-drafts.js','utf8'),page.context);await tick();
        assert.equal(store.get(key),before,'a late draft consumer must inherit the historical owner conflict and never persist cross-owner buffered text');
        assert.equal(page.form.dataset.eofficeDraftState,'unavailable');
    }
    const secrets=setup('maintenance');
    for(const type of ['password','hidden','file']){const field=new Node('private-'+type,type);field.value='NEVER PERSIST THIS';secrets.form.elements.push(field);}
    const signature=secrets.window.eofficeDraftCommits.signature(secrets.form);assert.ok(!signature.includes('NEVER PERSIST THIS'));
    secrets.submitForm();await secrets.finish();
    assert.ok(![...secrets.store.values()].join('').includes('NEVER PERSIST THIS'),'commit records must retain the draft exclusions for passwords/hidden fields/file bytes');
    for(const kind of ['maintenance','booking'])for(const outcome of ['recover','new-edit','different-owner','reset']) {
        const page=setup(kind);page.submitForm();
        const session=(status,id=7)=>{page.window.eofficeUser=status==='authenticated'?{id}:null;page.window.eofficeSessionState={status,user:status==='authenticated'?{id}:null,pageOwnerId:'7'};page.window.dispatchEvent(new Event('eoffice:session-updated'));};
        session('unavailable');await page.finish();
        assert.equal(page.form.dataset.eofficeSaveState,'awaiting-session','a successful receipt must stay pending through a failed identity check');
        for(const status of ['pending','unavailable','guest']){session(status);page.submitForm();await tick();assert.equal(page.requests.length,0,'an already-committed request cannot be submitted again');}
        if(outcome==='new-edit'){page.text.value='new unsent text';page.form.dispatchEvent(new Event('input'));}
        if(outcome==='reset')page.form.reset();
        else session('authenticated',outcome==='different-owner'?8:7);
        await tick();
        assert.equal(page.form.dataset.eofficeSaveState,undefined);assert.equal(page.text.disabled,false);
        assert.equal(page.form.resets,outcome==='recover'||outcome==='reset'?1:0);
        if(outcome==='new-edit')assert.equal(page.text.value,'new unsent text');
    }
    // Force a session check to start in the microtask after verified() resolves.
    // The receipt must be retained through that intervening failed check too.
    for(const kind of ['maintenance','booking']) {
        const page=setup(kind),owner=page.window.eofficeFormOwner;let intervened=false;
        page.window.eofficeFormOwner={...owner,async verified(...args){
            const accepted=await owner.verified(...args);
            if(accepted&&!intervened){intervened=true;page.window.eofficeSessionState={status:'unavailable',user:null,pageOwnerId:'7'};page.window.dispatchEvent(new Event('eoffice:session-updated'));}
            return accepted;
        }};
        page.submitForm();await page.finish();assert.equal(page.form.dataset.eofficeSaveState,'awaiting-session');
        page.submitForm();assert.equal(page.requests.length,0);
        page.window.eofficeSessionState={status:'authenticated',user:{id:7},pageOwnerId:'7'};page.window.dispatchEvent(new Event('eoffice:session-updated'));await tick();
        assert.equal(page.form.resets,1);assert.equal(page.text.disabled,false);
    }
    const page=setup('maintenance'),picker=page.el('imageFiles');picker.files=[{name:'qa.png',type:'image/png',size:7,lastModified:1}];picker.dispatchEvent(new Event('change'));
    page.submitForm();assert.equal(page.requests.length,0,'submit waits until every selected image finishes reading');
    page.readers[0].onload({target:{result:'data:image/png;base64,QA'}});page.submitForm();assert.equal(page.requests[0].body.images.length,1);await page.finish(false);
    page.form.reset();assert.equal(page.el('imagePreviewContainer').children.length,0);
    picker.dispatchEvent(new Event('change'));const stale=page.readers.at(-1);page.form.reset();stale.onload({target:{result:'data:image/png;base64,STALE'}});
    assert.equal(page.el('imagePreviewContainer').children.length,0,'a late image decode cannot revive a reset form');
    picker.dispatchEvent(new Event('change'));page.readers.at(-1).onerror();page.submitForm();assert.equal(page.requests.length,0,'failed image decoding must not silently submit without that image');
    for(const invalid of [{name:'not-an-image.txt',type:'text/plain',size:7},{name:'oversized.png',type:'image/png',size:6*1024*1024}]) {
        picker.files=[invalid];picker.dispatchEvent(new Event('change'));page.submitForm();
        assert.equal(page.requests.length,0,'choosing another rejected file must not clear an unresolved image read failure');
    }
    picker.files=[{name:'retry.png',type:'image/png',size:7,lastModified:1}];picker.dispatchEvent(new Event('change'));page.readers.at(-1).onload({target:{result:'data:image/png;base64,RETRY'}});
    page.submitForm();assert.equal(page.requests.length,1,'a valid successful replacement clears the image read failure');await page.finish(false);
    const preselected=setup('maintenance',{preselectedFiles:[{name:'early.png',type:'image/png',size:7,lastModified:1}]});
    assert.equal(preselected.readers.length,1,'a file picked before DOMContentLoaded must be handed to the installed reader');
    preselected.submitForm();assert.equal(preselected.requests.length,0);preselected.readers[0].onload({target:{result:'data:image/png;base64,QA'}});
    preselected.submitForm();assert.equal(preselected.requests[0].body.images[0].filename,'early.png');await preselected.finish(false);
    const resetDate=setup('maintenance');resetDate.form.reset();await tick();assert.equal(resetDate.el('requestDate').value,resetDate.window.eofficeDates.today());
    const capped=setup('maintenance');
    capped.el('imageFiles').files=Array.from({length:7},(_,i)=>({name:`photo-${i}.png`,type:'image/png',size:7}));
    capped.el('imageFiles').dispatchEvent(new Event('change'));
    assert.equal(capped.readers.length,5,'pending reads must count toward the five-image limit');
    capped.readers.forEach(reader=>reader.onload({target:{result:'data:image/png;base64,QA'}}));
    capped.submitForm();assert.equal(capped.requests[0].body.images.length,5);await capped.finish(false);
    capped.el('imageFiles').files=[{name:'extra.jpg',type:'image/jpeg',size:7}];capped.el('imageFiles').dispatchEvent(new Event('change'));
    assert.equal(capped.readers.length,5,'completed images must also count toward the limit');
    const unsupported=setup('maintenance');unsupported.el('imageFiles').files=[{name:'animation.gif',type:'image/gif',size:7}];
    unsupported.el('imageFiles').dispatchEvent(new Event('change'));assert.equal(unsupported.readers.length,0,'reject image formats the API cannot accept');
    console.log('PASS real maintenance/booking lifecycle: save races, image decoding, persistent commit suppression on reload, fresh/newer drafts and cross-account isolation');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
