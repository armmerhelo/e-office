const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));

class Node extends EventTarget {
    constructor() {
        super();this.value='';this.checked=false;this.disabled=false;this.children=[];this.parts=new Map();
        const classes=new Set();this.classList={add:(...names)=>names.forEach(name=>classes.add(name)),remove:(...names)=>names.forEach(name=>classes.delete(name)),contains:name=>classes.has(name)};
    }
    set innerHTML(html) {
        this.children=[];this.parts.clear();
        for (const name of ['material-name','material-qty']) {
            const match=html.match(new RegExp(`class="${name}"[^>]*value="([^"]*)"`));
            if(match){const field=new Node();field.value=match[1];this.parts.set('.'+name,field);}
        }
    }
    querySelector(selector){if(!this.parts.has(selector))this.parts.set(selector,new Node());return this.parts.get(selector);}
    querySelectorAll(selector){return selector==='.material-row'?this.children:[];}
    appendChild(node){node.parent=this;this.children.push(node);return node;}
    remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);}
    getContext(){return {};}
}

async function setup() {
    const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
    const radios=new Map(['considerationStatus','actionResult'].map(name=>[name,['pending','can_proceed','cannot_proceed','fixed','cannot_fix'].map(value=>Object.assign(new Node(),{value}))]));
    const document=new EventTarget();Object.assign(document,{getElementById:el,body:{style:{},appendChild(){}},createElement:()=>new Node(),
        querySelectorAll:selector=>radios.get(selector.match(/name="([^"]+)"/)?.[1])||[],
        querySelector:selector=>{const group=radios.get(selector.match(/name="([^"]+)"/)?.[1])||[];const value=selector.match(/value="([^"]+)"/)?.[1];return group.find(node=>value?node.value===value:node.checked);}});
    const form=el('adminActionForm');let dirty=false;
    for(const type of ['input','change','eoffice:form-dirty'])form.addEventListener(type,()=>{dirty=true;});
    form.addEventListener('eoffice:form-saved',()=>{dirty=false;});
    const records=[1,2].map(id=>({id,requester_name:'QA',request_date:'2026-10-13',repair_types:'ไฟฟ้า',consideration_status:'can_proceed',action_result:'pending',materials:[{name:'Saved material',qty:'1'}]}));
    const requests=[],window={};
    vm.runInNewContext(fs.readFileSync('maintenance_requests/admin.js','utf8'),{document,window,Event,Date,console,
        escapeHTML:value=>String(value??''),escapeRecord:value=>value,Chart:class{destroy(){}},setTimeout(){},requestAnimationFrame:fn=>fn(),
        fetch:(url,options)=>options?new Promise(resolve=>requests.push({resolve,payload:JSON.parse(options.body)})):Promise.resolve({ok:true,json:async()=>({status:'success',data:records})})});
    document.dispatchEvent(new Event('DOMContentLoaded'));await tick();
    const open=id=>window.openManageModal(id);
    const submit=()=>form.dispatchEvent(new Event('submit',{cancelable:true}));
    const finish=async(ok=true,status='success')=>{requests.shift().resolve({ok,json:async()=>({status,message:'saved'})});await tick();};
    const edit=value=>{el('assignedTo').value=value;form.dispatchEvent(new Event('input'));};
    return {el,form,requests,open,submit,finish,edit,dirty:()=>dirty};
}

async function run() {
    const page=await setup();page.open(1);assert.equal(page.dirty(),false,'snapshot initialization stays clean');
    page.el('modalMaterialsList').children[0].querySelector('.remove-row-btn').dispatchEvent(new Event('click'));
    assert.equal(page.dirty(),true,'removing an existing material must notify the navigation guard');
    page.open(1);assert.equal(page.dirty(),false,'opening a fresh snapshot clears previous dirty state');
    page.el('addMaterialBtn').dispatchEvent(new Event('click'));assert.equal(page.dirty(),true,'adding a material must notify the guard');
    page.submit();page.submit();assert.equal(page.requests.length,1,'duplicate submit is blocked');await page.finish();
    assert.equal(page.dirty(),false);assert.equal(page.el('editModal').classList.contains('hidden'),true);
    page.open(1);assert.equal(page.dirty(),false,'reopening after save must not inherit dirty state');
    page.edit('cancelled edit');page.el('cancelModalBtn').dispatchEvent(new Event('click'));page.open(1);
    assert.equal(page.dirty(),false,'reopening after explicit cancellation starts clean');
    page.edit('submitted');page.submit();page.open(2);await page.finish();
    assert.equal(page.dirty(),false,'old save must not mark a fresh reopened form dirty');
    assert.equal(page.el('editModal').classList.contains('hidden'),false,'old save must not close a fresh reopened form');
    for(const scenario of ['edit','silent-edit','remove','reopen','http-error','rejected-write']) {
        const page=await setup();page.open(1);page.edit('submitted');page.submit();
        if(scenario==='edit')page.edit('later edit');
        if(scenario==='silent-edit')page.el('assignedTo').value='silent later edit';
        if(scenario==='remove')page.el('modalMaterialsList').children[0].querySelector('.remove-row-btn').dispatchEvent(new Event('click'));
        if(scenario==='reopen'){page.open(2);page.edit('new form edit');}
        await page.finish(scenario!=='http-error',scenario==='rejected-write'?'error':'success');
        assert.equal(page.el('editModal').classList.contains('hidden'),false,scenario+': old success/failure must not close current edits');
        assert.equal(page.dirty(),true,scenario+': unsaved changes must retain the warning');
        assert.equal(page.el('saveBtn').disabled,false);
    }
    console.log('PASS maintenance staff form: material edits, fresh snapshots, successful/failed saves, duplicate submit and late edits/reopened forms');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
