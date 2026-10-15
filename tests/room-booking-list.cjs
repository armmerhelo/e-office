const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('room_booking/edit_room_booking.html', 'utf8');
const nodes = new Map();
const get = id => {
    if (!nodes.has(id)) nodes.set(id, {value:'all',textContent:'',hidden:false,disabled:false,
        setAttribute(name,value){this[name]=value;}, classList:{add(){},remove(){}}});
    return nodes.get(id);
};
get('searchInput').value = '';
get('sortFilter').value = 'latest';
const rows = [
    {id:1,topic:'ประชุมฝ่ายวิชาการ',room_name:'ห้องกันเกรา',requester_name:'สมใจ',status:'confirm',start_datetime:'2026-10-15 09:00:00',end_datetime:'2026-10-15 10:00:00'},
    {id:2,topic:'อบรม',room_name:'ห้องสารภี',requester_name:'สมชาย',status:'pending',start_datetime:'2026-10-14 23:00:00',end_datetime:'2026-10-16 01:00:00'},
    {id:3,topic:'ยกเลิกอบรม',status:'cancel',start_datetime:'2026-10-10 09:00:00',end_datetime:'2026-10-10 10:00:00'},
    ...Array.from({length:15},(_,i)=>({id:i+4,topic:'รายการเพิ่มเติม',status:'pending',start_datetime:'2026-11-01 09:00:00',end_datetime:'2026-11-01 10:00:00'}))
];
class Clock extends Date { constructor(...args){super(...(args.length ? args : ['2026-10-15T12:00:00']));} }
const context = vm.createContext({document:{getElementById:get},Date:Clock,console:{error(){}},window:{sessionReady:Promise.resolve()},fetch:null});
vm.runInContext(html.slice(html.indexOf('        let bookings ='),html.indexOf('        function renderTable(')), context);
context.records=rows;
vm.runInContext('bookings=records;bookingLoaded=true;function renderTable(data){rendered=data;}',context);
vm.runInContext(html.slice(html.indexOf('        function filterBookings('),html.indexOf("        document.getElementById('searchInput').addEventListener")),context);
const run = code => vm.runInContext(code,context);
run('filterBookings()');
assert.equal(context.rendered.length,10);
assert.equal(get('pageNumber').textContent,'1 / 2');
run('bookingPage=2;filterBookings()');assert.equal(context.rendered.length,8);
get('searchInput').value=' สมใจ ';run('filterBookings()');
assert.deepEqual(Array.from(context.rendered,b=>b.id),[1]);assert.equal(get('pageNumber').textContent,'1 / 1');
get('searchInput').value='';get('statusFilter').value='cancelled';run('filterBookings()');
assert.equal(context.rendered[0].id,3);
get('statusFilter').value='all';get('periodFilter').value='today';run('filterBookings()');
assert.deepEqual(Array.from(context.rendered,b=>b.id),[1,2],'today includes an overnight booking');
get('periodFilter').value='upcoming';run('filterBookings()');assert.equal(get('resultCount').textContent,'16 รายการ');
get('periodFilter').value='past';run('filterBookings()');assert.equal(get('resultCount').textContent,'2 รายการ');
get('periodFilter').value='all';get('searchInput').value='ไม่มีผลลัพธ์';run('filterBookings()');
assert.equal(get('emptyTitle').textContent,'ไม่พบรายการที่ตรงกับตัวกรอง');assert.equal(get('resetFilters').hidden,false);
get('searchInput').value='';
vm.runInContext(html.slice(html.indexOf('        let bookingRequest='),html.lastIndexOf('        window.onload =')),context);
run("function getCookie(){return 'QA';}");
async function main(){
    const settle=()=>new Promise(resolve=>setImmediate(resolve));
    const requests=[];
    context.fetch=()=>new Promise((resolve,reject)=>requests.push({resolve,reject}));
    const older=run('fetchBookings()'),newer=run('fetchBookings()');
    await settle();
    assert.equal(requests.length,1,'superseded session wait must not start another request');
    requests[0].resolve({ok:true,json:async()=>({status:'success',data:rows,is_admin:false})});await Promise.all([older,newer]);
    const failed=run('fetchBookings()');await settle();requests[1].reject(new Error('test offline'));await failed;
    assert.equal(get('bookingFeedback').hidden,false);assert.equal(get('resultCount').textContent,'18 รายการ');
    assert.equal(get('bookingResults')['aria-busy'],'false');
    const first=run('fetchBookings()');await settle();const second=run('fetchBookings()');await settle();
    requests[3].resolve({ok:true,json:async()=>({status:'success',data:[],is_admin:false})});await second;
    requests[2].reject(new Error('obsolete'));await first;
    assert.equal(get('bookingFeedback').hidden,true);assert.equal(get('resultCount').textContent,'0 รายการ');
    assert.equal(get('emptyTitle').textContent,'ยังไม่มีรายการจองห้องประชุม');
    console.log('PASS room booking list: search, status aliases, dates, pagination, empty state, refresh failure and stale requests');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
