// Execute the real member UI with controlled responses; no production accounts.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element {
    constructor(id=''){this.id=id;this.hidden=false;this.disabled=false;this.value='';this.children=[];this.events={};this.classList={toggle(){},add(){},remove(){}};}
    addEventListener(name,fn){this.events[name]=fn;}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    querySelector(selector){if(selector==='option[value=Editor]')return null;if(selector==='.actions')return this.actions??=new Element();return new Element();}
    setAttribute(){} focus(){} reset(){} add(node){this.children.push(node);} getClientRects(){return[{}];}
}
const elements=new Map();const el=id=>elements.get(id)??(elements.set(id,new Element(id)),elements.get(id));
let keydown;
const document={getElementById:el,createElement:()=>new Element(),querySelectorAll:()=>[],addEventListener(name,fn){if(name==='keydown')keydown=fn;},activeElement:new Element()};
const user={User_Id:4,User_Name:'basic',User_Email:'basic@example.test',User_Status:'User',permissions:[],can_edit:true};
const membershipRequests=[],writes=[];let searches=0;
const response=data=>({ok:true,json:async()=>data});
const fetch=async (route,options)=>{
    if(route.startsWith('get_users_api'))return response({status:'success',data:[user],total:1,page:1,permission_catalog:{},can_manage_permissions:true});
    if(route.startsWith('get_user_departments_api'))return new Promise(resolve=>membershipRequests.push(resolve));
    if(route.startsWith('search_departments_api')){searches++;return response({status:'success',data:[{Department_Id:2,Department_Name:'Beta'}]});}
    if(route==='update_user_api.php'||route==='save_user_status_api.php'||route==='save_user_permissions_api.php'){writes.push({route,body:options.body});return response({status:'success',message:'Saved'});}
    throw Error('Unexpected route: '+route);
};
const source=fs.readFileSync('assets/member-management.js','utf8');
class MockFormData {
    constructor(form){this.data=new Map();if(form.id==='form_permissions'){this.data.set('permissions',el('permission-options').children.map(label=>label.children[0]).filter(input=>input.checked).map(input=>input.value));return;}for(const[name,id]of Object.entries({User_Id:'edit_id',User_name:'edit_name',User_Email:'edit_email',User_Status:'User_Status',User_password1:'password_1',User_password2:'password_2'}))if(!el(id).disabled)this.data.set(name,[el(id).value]);}
    get(key){return this.data.get(key)?.[0]??null;} getAll(key){return this.data.get(key)??[];}
    set(key,value){this.data.set(key,[value]);} append(key,value){this.data.set(key,[...(this.data.get(key)??[]),value]);} delete(key){this.data.delete(key);}
}
vm.runInNewContext(source,{document,fetch,window:{sessionReady:Promise.resolve(),eofficeUser:{id:1},parent:{postMessage(){}},addEventListener(){}},location:{origin:'http://localhost'},URLSearchParams,FormData:MockFormData,confirm:()=>true,Option:class{constructor(text,value){this.text=text;this.value=value;}},escapeHTML:String,setTimeout,clearTimeout,console});
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
const selected=()=>el('selected-departments').children.map(chip=>chip.children[0]?.textContent);
const snapshot=dept=>response({status:'success',data:[{Department_Id:dept==='Alpha'?1:3,Department_Name:dept}],user,member_version:'a'.repeat(64),permissions:[],permission_version:'b'.repeat(64)});
async function run(){
    await tick();const edit=el('userTableBody').children[0].actions.children.find(button=>button.textContent==='แก้ไข');
    edit.events.click();await tick();
    assert.equal(el('save-member').disabled,true);assert.equal(el('department-search').disabled,true);
    assert.equal(el('User_Status').disabled,true);assert.equal(el('User_Status_Group').hidden,true);
    el('department-search').value='Beta';el('department-search').events.input();await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(searches,0);assert.equal(el('department-loading').hidden,false);
    membershipRequests.shift()(snapshot('Alpha'));await tick();
    assert.equal(el('department-search').disabled,false);assert.equal(el('save-member').disabled,false);
    el('department-search').events.input();await new Promise(resolve=>setTimeout(resolve,300));
    el('txtHint_department').children[0].children[0].events.click();
    assert.deepEqual(selected(),['Alpha','Beta']);
    console.log('PASS group controls stay disabled until the initial snapshot loads; selections then persist');

    const editAgain=el('userTableBody').children[0].actions.children.find(button=>button.textContent==='แก้ไข');
    editAgain.events.click();await tick();const old=membershipRequests.shift();
    // Two openings of the same account must not share a response identity.
    keydown({key:'Escape'});
    editAgain.events.click();await tick();const latest=membershipRequests.shift();
    latest(snapshot('Gamma'));await tick();old(snapshot('Alpha'));await tick();
    assert.deepEqual(selected(),['Gamma']);assert.equal(el('save-member').disabled,false);
    console.log('PASS an older response cannot overwrite a reopened dialog for the same member');
    editAgain.events.click();await tick();const late=membershipRequests.shift();
    // Replacing edit mode with add mode also invalidates the pending read.
    el('add-member').events.click();await tick();late(snapshot('Alpha'));await tick();
    assert.equal(el('edit_id').value,'');assert.deepEqual(selected(),[]);
    console.log('PASS a pending edit response cannot overwrite a new-member form');
    editAgain.events.click();await tick();membershipRequests.shift()(snapshot('Alpha'));await tick();
    el('edit_name').value='Changed name';
    await el('form_user_data').events.submit({preventDefault(){}});
    const saved=writes.at(-1);assert.equal(saved.route,'update_user_api.php');
    assert.equal(saved.body.get('User_Status'),null);assert.equal(saved.body.get('member_version'),'a'.repeat(64));
    assert.equal(saved.body.get('User_name'),'Changed name');
    console.log('PASS profile submissions carry the snapshot version and never carry an Admin status');
    const level=el('userTableBody').children[0].actions.children.find(button=>button.textContent==='ระดับ');
    level.events.click();await tick();membershipRequests.shift()(snapshot('Alpha'));await tick();
    el('status-select').value='Admin';await el('form_status').events.submit({preventDefault(){}});
    const roleWrite=writes.at(-1);assert.equal(roleWrite.route,'save_user_status_api.php');
    assert.deepEqual(JSON.parse(roleWrite.body),{user_id:4,status:'Admin',member_version:'a'.repeat(64)});
    console.log('PASS explicit Admin promotion uses the separate version-checked status endpoint');
    const rights=el('userTableBody').children[0].actions.children.find(button=>button.textContent==='สิทธิ์');
    rights.events.click();await tick();
    assert.equal(el('save-permissions').disabled,true);
    membershipRequests.shift()(snapshot('Alpha'));await tick();
    assert.equal(el('save-permissions').disabled,false);
    await el('form_permissions').events.submit({preventDefault(){}});
    const permissionWrite=writes.at(-1);assert.equal(permissionWrite.route,'save_user_permissions_api.php');
    assert.deepEqual(JSON.parse(permissionWrite.body),{user_id:4,permissions:[],permission_version:'b'.repeat(64)});
    console.log('PASS permission forms reload their current snapshot and submit its version');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
