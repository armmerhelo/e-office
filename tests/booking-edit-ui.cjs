const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('room_booking/edit_room_booking.html','utf8');
const program=source.slice(source.indexOf("        const modal ="),source.indexOf('        function printSlip('));
function setup() {
    const nodes={},timers=[],requests=[];
    const classes=()=>{const values=new Set();return {add:v=>values.add(v),remove:v=>values.delete(v),contains:v=>values.has(v)};};
    const values={edit_id:'1',edit_room_name:'QA room',edit_topic:'submitted topic',edit_requester_name:'QA',edit_department:'QA',edit_attendees:'3',edit_start_datetime:'2026-10-20T09:00',edit_end_datetime:'2026-10-20T10:00',edit_eq_other:''};
    for(const [id,value] of Object.entries(values))nodes[id]={id,value,type:'text'};
    for(const id of ['audio','computer','projector','food','led1','led2'])nodes['edit_eq_'+id]={id:'edit_eq_'+id,type:'checkbox',checked:false};
    nodes.edit_room_name.selectedIndex=0;
    const fields=Object.values(nodes);
    let resets=0,clean=0;
    nodes.editForm=new EventTarget();nodes.editForm.elements=fields;
    nodes.editForm.reset=()=>{resets++;fields.forEach(node=>{node.value='';node.checked=false;});nodes.editForm.dispatchEvent(new Event('reset'));};
    nodes.editForm.addEventListener('eoffice:form-saved',()=>clean++);
    nodes.editModal={classList:classes(),querySelector:()=>({classList:classes()})};
    nodes['save-booking-changes']={disabled:false};
    const records=[1,2].map(id=>({id,room_name:'QA room',topic:'booking '+id,requester_name:'QA',department:'QA',attendees:3,start_datetime:'2026-10-20 09:00:00',end_datetime:'2026-10-20 10:00:00',equipment_other:''}));
    const context=vm.createContext({document:{getElementById:id=>nodes[id]},Event,Date,JSON,console,bookings:records,
        setTimeout:fn=>timers.push(fn),fetch:()=>new Promise(resolve=>requests.push(resolve)),filterBookings(){},showToast(){}});
    vm.runInContext(program,context);
    return {nodes,requests,run:code=>vm.runInContext(code,context),flush:()=>{while(timers.length)timers.shift()();},clean:()=>clean,resets:()=>resets};
}
async function run() {
    for(const outcome of ['success','rejected','http-failed','later-input','silent-edit','same-text-edit','reopened']) {
        const s=setup(),pending=s.run('saveChanges()');
        await s.run('saveChanges()');assert.equal(s.requests.length,1,'duplicate save must be blocked');
        if(outcome==='later-input'||outcome==='same-text-edit') {
            if(outcome==='later-input')s.nodes.edit_topic.value='new unsaved topic';
            s.nodes.editForm.dispatchEvent(new Event('input'));
        }
        if(outcome==='silent-edit')s.nodes.edit_topic.value='silent unsaved topic';
        if(outcome==='reopened')s.run('openEditModal(2)');
        const clean=s.clean();
        s.requests[0]({ok:outcome!=='http-failed',json:async()=>({status:outcome==='rejected'?'error':'success'})});
        await pending;s.flush();
        assert.equal(s.nodes['save-booking-changes'].disabled,false);
        if(outcome==='success') {
            assert.equal(s.resets(),1);assert.equal(s.clean(),clean+1);
            assert.equal(s.nodes.editModal.classList.contains('hidden'),true);
        } else {
            assert.equal(s.resets(),0,outcome+': preserve current form');assert.equal(s.clean(),clean);
            if(outcome==='reopened')assert.equal(String(s.nodes.edit_id.value),'2');
            if(outcome==='later-input')assert.equal(s.nodes.edit_topic.value,'new unsaved topic');
            if(outcome==='silent-edit')assert.equal(s.nodes.edit_topic.value,'silent unsaved topic');
        }
    }
    const s=setup();s.run('closeModal();openEditModal(2)');s.flush();
    assert.equal(String(s.nodes.edit_id.value),'2');assert.equal(s.resets(),0);
    assert.equal(s.nodes.editModal.classList.contains('hidden'),false);
    console.log('PASS real booking edit: success/failures, duplicate submit, later/silent/same-text edits, reopened form and stale close timer');

    const dashboardProgram=fs.readFileSync('email_send/my-dashboard.js','utf8');
    class Element extends EventTarget {
        constructor(tag='div') {super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.value='';this.hidden=false;this._text='';}
        append(...nodes){this.children.push(...nodes);}
        replaceChildren(...nodes){this._text='';this.children=nodes;}
        setAttribute(name,value){this.attributes[name]=String(value);}
        set textContent(value){this._text=String(value??'');this.children=[];}
        get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
        querySelectorAll(tag){return this.children.flatMap(node=>[...(node.tagName===tag.toUpperCase()?[node]:[]),...node.querySelectorAll(tag)]);}
        querySelector(tag){return this.querySelectorAll(tag)[0]||null;}
        click(){this.dispatchEvent(new Event('click'));}
        focus(){}
    }
    for(const prefix of ['/','/eoffice/']) {
        const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
        get('yearSelect').value='all';get('refreshOrders').append(new Element('span'));
        let refresh,transport;
        const result={status:'success',user_name:'QA',user_email:'qa@example.test',years:['2569'],data:[{doc_id:1,doc_year:'2569',file_name:'a #.pdf',files:['a #.pdf','b.pdf']}],pagination:{total_items:1,total_pages:1}};
        const response=data=>({ok:true,json:async()=>data});
        transport=async()=>response(result);
        const context=vm.createContext({URL,URLSearchParams,console,
            window:{eofficeRegisterModuleRefresh:fn=>{refresh=fn;}},
            document:{baseURI:`https://example.test${prefix}email_send/my_dashboard.html`,getElementById:get,createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)},
            fetch:(...args)=>transport(...args)});
        vm.runInContext(dashboardProgram,context);await refresh();
        const links=get('myDocTableBody').querySelectorAll('a');
        assert.equal(links.length,2);
        for(const link of links)assert.equal(new URL(link.href).pathname,prefix+'api/view_file.php');
        assert.equal(new URL(links[0].href).searchParams.get('File_Path'),'a #.pdf');
        assert.equal(get('listContent').attributes['aria-busy'],'false');
        const pending=[];transport=()=>new Promise((resolve,reject)=>pending.push({resolve,reject}));
        const older=refresh(),newer=refresh();
        pending[1].resolve(response({...result,user_email:'latest@example.test'}));await newer;
        pending[0].reject(new Error('obsolete failure'));await older;
        assert.ok(get('userInfo').textContent.includes('latest@example.test'));
        assert.equal(get('listFeedback').hidden,true);
        const failed=refresh();pending[2].reject(new Error('current failure'));await failed;
        assert.equal(get('listFeedback').hidden,false);
        assert.equal(get('myDocTableBody').querySelectorAll('a').length,2,'failed background refresh retains PDF links');
        assert.equal(get('listContent').attributes['aria-busy'],'false');
        transport=async()=>response({...result,pagination:{total_items:21,total_pages:3}});
        await refresh();
        const pageReads=[];transport=()=>new Promise((resolve,reject)=>pageReads.push({resolve,reject}));
        get('paginationBtns').querySelectorAll('button').find(button=>button.textContent==='ถัดไป').click();
        assert.ok(get('myDocTableBody').children.some(row=>row.className==='skeleton-row'));
        const refreshDuringPageLoad=refresh();
        pageReads[1].reject(new Error('refresh during pagination failed'));await refreshDuringPageLoad;
        pageReads[0].reject(new Error('obsolete page failed'));await new Promise(resolve=>setImmediate(resolve));
        assert.equal(get('myDocTableBody').children.some(row=>row.className==='skeleton-row'),false,'failed refresh must not retain a loading skeleton as previous results');
        assert.ok(get('myDocTableBody').textContent.includes('โหลดรายการไม่สำเร็จ'));
        assert.equal(get('listContent').attributes['aria-busy'],'false');
    }
    console.log('PASS current personal-order script: PDF URLs at root/subdirectory, encoded filenames, stale failure isolation and retained results');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
