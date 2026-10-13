const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Field extends EventTarget {
    constructor(value=''){super();this.value=value;this.dataset={};this.attributes={};this.classList={remove(){}};}
    setAttribute(name,value){this.attributes[name]=value;}
}
function runtime(clock='2026-10-12T17:30:00Z') {
    const fields=new Map();
    const el=id=>{if(!fields.has(id))fields.set(id,new Field());return fields.get(id);};
    let now=clock;
    const context={window:new EventTarget(),document:Object.assign(new EventTarget(),{getElementById:el,querySelector:()=>el('submit'),hidden:false}),
        Date:class extends Date{constructor(...args){super(...(args.length?args:[now]));}},
        getCookie:()=>null,decodeURIComponent};
    vm.createContext(context);vm.runInContext(fs.readFileSync('assets/form-dates.js','utf8'),context);
    const html=fs.readFileSync('room_booking/new_room.html','utf8');
    vm.runInContext(html.slice(html.indexOf('        function initializeBookingForm()'),html.indexOf('        function getCookie(name)')),context);
    return {context,el,dates:context.window.eofficeDates,setClock:value=>{now=value;}};
}
function run() {
    for(const [clock,expected] of [
        ['2026-10-12T16:59:00Z','2026-10-12'],['2026-10-12T17:00:00Z','2026-10-13'],
        ['2026-10-12T23:59:00Z','2026-10-13'],['2026-12-31T17:30:00Z','2027-01-01']]) {
        const {el,dates,context}=runtime(clock);assert.equal(dates.today(),expected);
        assert.equal(el('startDate').value,expected);assert.equal(el('endDate').value,expected);
        assert.equal(el('startDate').attributes.min,expected);assert.equal(el('endDate').attributes.min,expected);
        const source=fs.readFileSync('maintenance_requests/script.js','utf8'),defaults=source.slice(source.indexOf('    const dateInput'),source.indexOf('    // 2. Toggle'));
        vm.runInContext('{'+defaults+'}',context);assert.equal(el('requestDate').value,expected);
    }
    for(const [date,time,endDate,endTime] of [
        ['2026-10-13','09:30','2026-10-13','10:30'],['2026-10-13','22:59','2026-10-13','23:59'],
        ['2026-10-13','23:00','2026-10-14','00:00'],['2026-10-31','23:30','2026-11-01','00:30'],
        ['2026-12-31','23:30','2027-01-01','00:30'],['2028-02-28','23:30','2028-02-29','00:30'],
        ['2028-02-29','23:30','2028-03-01','00:30']]) {
        const {el,dates}=runtime();el('startDate').value=date;el('endDate').value=date;el('startTime').value=time;
        el('startTime').dispatchEvent(new Event('change'));assert.equal(el('endDate').value,endDate);assert.equal(el('endTime').value,endTime);
        assert.equal(JSON.stringify(dates.afterOneHour(date,time)),JSON.stringify({date:endDate,time:endTime}));
    }
    const {el,context,dates}=runtime();el('startDate').value='2026-10-31';el('endDate').value='2026-10-31';el('startTime').value='23:30';el('startTime').dispatchEvent(new Event('change'));
    el('startTime').value='09:00';el('startTime').dispatchEvent(new Event('change'));assert.equal(el('endDate').value,'2026-10-31');assert.equal(el('endTime').value,'10:00');
    el('endTime').value='12:45';el('endTime').dispatchEvent(new Event('input'));el('startTime').value='23:30';el('startTime').dispatchEvent(new Event('change'));
    assert.equal(el('endTime').value,'12:45','manual end times are not overwritten');assert.equal(el('endDate').value,'2026-10-31');
    el('bookingForm').dispatchEvent(new Event('reset'));el('startDate').value='2027-01-31';el('endDate').value='';el('endTime').value='';el('startTime').value='23:15';el('startTime').dispatchEvent(new Event('change'));
    assert.equal(el('endDate').value,'2027-02-01');assert.equal(el('endTime').value,'00:15');
    el('bookingForm').dataset.eofficeDraftRestoring='true';el('endDate').dispatchEvent(new Event('change'));delete el('bookingForm').dataset.eofficeDraftRestoring;
    el('startDate').value='2027-02-10';el('startDate').dispatchEvent(new Event('change'));assert.equal(el('endDate').value,'2027-02-11');
    const restored=runtime();restored.el('startDate').value='2027-03-01';restored.el('endDate').value='2027-03-02';restored.el('endTime').value='14:30';restored.el('startTime').value='10:00';restored.el('startTime').dispatchEvent(new Event('change'));
    assert.equal(restored.el('endTime').value,'14:30');assert.equal(restored.el('endDate').value,'2027-03-02','existing/restored ranges remain unchanged');
    const duplicate=runtime();duplicate.context.initializeBookingForm();duplicate.context.initializeBookingForm();duplicate.el('startTime').value='09:00';duplicate.el('startTime').dispatchEvent(new Event('change'));
    duplicate.el('startTime').value='23:30';duplicate.el('startTime').dispatchEvent(new Event('change'));assert.equal(duplicate.el('endTime').value,'00:30');assert.equal(duplicate.el('endDate').value,'2026-10-14','reinitializing must not install competing suggestion state machines');
    restored.el('endDate').value='2027-03-03';restored.el('endDate').dispatchEvent(new Event('change'));restored.el('startDate').value='2027-03-02';restored.el('startDate').dispatchEvent(new Event('change'));
    assert.equal(restored.el('endDate').value,'2027-03-03');assert.equal(restored.el('endTime').value,'14:30');
    el('requesterName').value='existing requester';el('startDate').value='2030-01-01';context.initializeBookingForm();assert.equal(el('requesterName').value,'existing requester');assert.equal(el('startDate').value,'2030-01-01');
    context.getCookie=()=> 'legacy 50% name';el('requesterName').value='';context.initializeBookingForm();assert.equal(el('requesterName').value,'legacy 50% name','a malformed legacy cookie must not abort date/time initialization');
    for(const [date,time]of[['2026-02-30','09:00'],['invalid','09:00'],['2026-10-13','24:00'],['2026-10-13','23:60']])assert.equal(dates.afterOneHour(date,time),null);
    const early=runtime();early.el('bookingForm').dataset.eofficeRequiresDraft='true';early.el('startTime').value='23:30';early.el('startTime').dispatchEvent(new Event('change'));
    assert.equal(early.el('endTime').value,'','early automatic values must not beat an untouched stored date');
    early.el('startDate').value='2026-10-31';early.el('endDate').value='2026-10-31';early.el('bookingForm').dispatchEvent(new Event('eoffice:draft-restored'));
    assert.equal(early.el('endDate').value,'2026-11-01');assert.equal(early.el('endTime').value,'00:30');
    for(const trigger of ['focus','pageshow','visibilitychange','input','submit']) {
        const page=runtime('2026-10-13T16:59:00Z'),form=page.el('bookingForm');
        page.el('startDate').value='2026-10-13';page.el('endDate').value='2026-10-13';
        page.setClock('2026-10-13T17:01:00Z');
        form.checkValidity=()=>['startDate','endDate'].every(id=>page.el(id).value>=page.el(id).attributes.min);
        let reported=false;form.reportValidity=()=>{reported=true;};
        const event=new Event(trigger,{cancelable:true});
        if(trigger==='visibilitychange')page.context.document.dispatchEvent(event);
        else if(trigger==='input')page.el('startDate').dispatchEvent(event);
        else if(trigger==='submit')form.dispatchEvent(event);
        else page.context.window.dispatchEvent(event);
        assert.equal(page.el('startDate').attributes.min,'2026-10-14');assert.equal(page.el('endDate').attributes.min,'2026-10-14');
        assert.equal(page.el('startDate').value,'2026-10-13','refresh must not silently rewrite the chosen date');
        if(trigger==='submit'){assert.equal(event.defaultPrevented,true);assert.equal(reported,true);}
    }
    console.log('PASS Bangkok date defaults/min, local midnight/month/year, rollover/leap days, manual/restored end ranges, reset and invalid inputs');
}
run();
