const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('external_number_booking/external_number_booking.html', 'utf8');
const source = fs.readFileSync('external_number_booking/number-booking.js', 'utf8');
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const response = (status = 200, data = []) => ({status, ok: status === 200,
    json: async () => ({status: status === 200 ? 'success' : 'error', isAdmin: true, data})});

class Element extends EventTarget {
    constructor() { super(); this.value = ''; this.hidden = false; this.disabled = false; this.open = false; this.children = []; this.attributes = {}; this._text = ''; this.resets = 0; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    querySelector(selector) {
        if (selector.startsWith('.')) {
            const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
            return descendants(this).find(node => node.className?.split(' ').includes(selector.slice(1))) || null;
        }
        return this.slot ||= new Element();
    }
    insertAdjacentHTML() {}
    setCustomValidity() {}
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    reset() { this.resets++; this.dispatchEvent(new Event('reset')); }
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}

function setup() {
    const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element()]));
    const el = id => { assert.ok(nodes.has(id), 'Unknown element ' + id); return nodes.get(id); };
    el('unauthorizedScreen').hidden = el('bookingResult').hidden = true;
    el('yearFilter').value = String(new Date().getFullYear() + 543);
    const timers = new Map(), requests = [], popups = [];
    let timerId = 0, refresh, resume, suspend, changeCheck, saved = 0;
    const windowEvents = new EventTarget();
    el('editForm').addEventListener('eoffice:form-saved', () => saved++);
    const context = vm.createContext({Event, DOMException, AbortController, Intl, Date, console,
        document: {getElementById: el, createElement: () => new Element(), createDocumentFragment: () => new Element(), addEventListener() {}},
        window: {eofficeRegisterModuleRefresh: fn => { refresh = fn; },
            eofficeRegisterModuleResume: fn => { resume = fn; }, eofficeRegisterModuleSuspend: fn => { suspend = fn; },
            eofficeRegisterModuleChanges: fn => { changeCheck = fn; },
            addEventListener: windowEvents.addEventListener.bind(windowEvents)},
        Swal: {fire: options => { popups.push(options); return Promise.resolve({isConfirmed: true}); }},
        setTimeout: (fn, delay) => { timers.set(++timerId, {fn, delay}); return timerId; },
        clearTimeout: id => timers.delete(id),
        fetch: (url, options) => new Promise((resolve, reject) => {
            requests.push({url, options, resolve, reject});
            options.signal.addEventListener('abort', () => reject(options.signal.reason), {once: true});
        })
    });
    vm.runInContext(source, context);
    return {el, requests, popups, refresh: () => refresh(), resume: () => resume(), suspend: () => suspend(), timers, saved: () => saved,
        retainedChanges: () => changeCheck(),
        leaving() { const event = new Event('beforeunload', {cancelable: true}); windowEvents.dispatchEvent(event); return event.defaultPrevented; },
        expire() { const timer = [...timers.values()].find(timer => timer.delay === 30000); assert.ok(timer, 'request has 30-second deadline'); timer.fn(); },
        book() { el('docDetail').value = 'เรื่องเดิม'; el('bookingForm').dispatchEvent(new Event('submit', {cancelable: true})); },
        edit(id = '1', detail = 'ชื่อเรื่องที่ยังไม่ยืนยันผล') { el('editModal').showModal(); el('editId').value = id; el('editDocDetail').value = detail; el('editForm').dispatchEvent(new Event('submit', {cancelable: true})); }};
}

async function run() {
    assert.equal(html.match(/<h1\b[^>]*>(.*?)<\/h1>/s)?.[1], 'จองเลขคำสั่ง', 'router must see the real page heading first');
    assert.match(html, /<dialog id="bookingModal"[^>]*>[\s\S]*?<form id="bookingForm">/, 'creation form lives inside the modal');
    {
        const s = setup();
        assert.equal(s.el('bookingModal').open, false);
        s.el('openBooking').click();
        assert.equal(s.el('bookingModal').open, true);
        s.el('docDetail').value = 'ร่างคำสั่ง';
        s.el('cancelBooking').click();
        assert.equal(s.el('bookingModal').open, false);
        assert.equal(s.retainedChanges(), true, 'closed booking draft is still protected by the navigation guard');
        s.el('openBooking').click();
        assert.equal(s.el('docDetail').value, 'ร่างคำสั่ง', 'reopening retains the draft');
        s.book();
        const cancel = new Event('cancel', {cancelable: true});
        s.el('bookingModal').dispatchEvent(cancel);
        assert.equal(cancel.defaultPrevented, true);
        assert.equal(s.el('bookingModal').open, true, 'Escape cannot dismiss a pending reservation');
        assert.equal(s.el('closeBooking').disabled, true);
        s.requests[0].reject(new TypeError('QA offline')); await tick();
        assert.equal(s.el('bookingModal').open, true, 'failure keeps the form and error available');
        assert.equal(s.el('closeBooking').disabled, false);
        s.el('closeBooking').click();
        assert.equal(s.el('bookingModal').open, false);
    }
    {
        const s = setup();
        const failed = s.refresh(); s.requests[0].resolve(response(401)); await failed;
        assert.equal(s.el('mainApp').hidden, true);
        assert.equal(s.el('unauthorizedScreen').hidden, false);
        const recovered = s.refresh(); s.requests[1].resolve(response()); await recovered;
        assert.equal(s.el('mainApp').hidden, false, 'successful authenticated read restores the page');
        assert.equal(s.el('unauthorizedScreen').hidden, true);
        assert.equal(s.timers.size, 0, 'completed requests clear deadlines');
        const stale = s.refresh(), latest = s.refresh();
        s.requests[3].resolve(response()); await latest;
        s.requests[2].resolve(response(401)); await stale;
        assert.equal(s.el('mainApp').hidden, false, 'old 401 must not hide a newer successful read');
        assert.equal(s.el('unauthorizedScreen').hidden, true);
    }
    for (const phase of ['fetch', 'response-body']) {
        const s = setup(); s.edit(); s.edit();
        assert.equal(s.requests.length, 1, 'pending edit blocks duplicate submission');
        assert.equal(s.el('saveEdit').disabled, true);
        if (phase === 'response-body') {
            const signal = s.requests[0].options.signal;
            s.requests[0].resolve({ok: true, status: 200, json: () => new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => reject(new DOMException('Body aborted', 'AbortError')), {once: true});
            })});
            await tick();
        }
        s.expire(); await tick();
        assert.equal(s.requests[0].options.signal.aborted, true);
        for (const id of ['saveEdit', 'cancelEdit', 'closeEdit']) assert.equal(s.el(id).disabled, false, phase + ': releases ' + id);
        assert.equal(s.el('editDocDetail').readOnly, false);
        assert.equal(s.el('editDocDetail').value, 'ชื่อเรื่องที่ยังไม่ยืนยันผล');
        assert.equal(s.el('editModal').open, true, 'keep unsaved text available after timeout');
        assert.match(s.el('editError').textContent, /ระบบอาจบันทึกแล้ว.*ตรวจสอบก่อนบันทึกซ้ำ/);
        assert.equal(s.saved(), 0, 'uncertain result cannot mark the form saved');
        assert.equal(s.el('editForm').resets, 0);
        assert.equal(s.requests.length, 1, 'never retry an uncertain write automatically');
        assert.equal(s.timers.size, 0);
        const cancel = new Event('cancel', {cancelable: true}); s.el('editModal').dispatchEvent(cancel);
        assert.equal(s.el('editModal').open, false, 'Escape closes the dialog after timeout');
        s.el('editDocDetail').value = 'newer draft';
        s.requests[0].resolve(response(200, {})); await tick();
        assert.equal(s.el('editDocDetail').value, 'newer draft', 'late completion cannot clear newer fields');
    }
    const record = {id: 1, External_Number: '001/2569', Doc_Year: '2569', Doc_Detail: 'เรื่องเดิม', User_Name: 'QA'};
    for (const method of ['POST', 'PUT', 'DELETE']) for (const newerFirst of [true, false]) {
        const s = setup(), initial = s.refresh();
        s.requests[0].resolve(response(200, [record])); await initial;
        if (method === 'POST') s.book();
        if (method === 'PUT') s.edit();
        if (method === 'DELETE') s.el('tableBody').querySelector('.booking-delete').click();
        await tick();
        assert.equal(s.requests[1].options.method, method);
        const latest = s.refresh();
        if (newerFirst) {
            s.requests[2].resolve(response(200, [record])); await latest;
            s.requests[1].resolve(response(401)); await tick();
        } else {
            s.requests[1].resolve(response(401)); await tick();
            s.requests[2].resolve(response(200, [record])); await latest;
        }
        assert.equal(s.el('mainApp').hidden, false, method + ': old write 401 cannot hide newer confirmed session');
        assert.equal(s.el('unauthorizedScreen').hidden, true);
        const error = method === 'POST' ? s.el('bookingError').textContent : method === 'PUT' ? s.el('editError').textContent : s.popups.at(-1).text;
        assert.match(error, newerFirst ? /คำขอนี้ไม่สำเร็จ/ : /เซสชันหมดอายุ/, method + ': failed write is still reported');
        assert.equal(s.requests.length, 3, 'failed writes are not retried automatically');
        assert.equal(s.saved(), 0);
    }
    {
        const s = setup(), earlier = s.refresh(); s.edit();
        s.requests[0].resolve(response()); await earlier;
        s.requests[1].resolve(response(401)); await tick();
        assert.equal(s.el('mainApp').hidden, true, 'success of an earlier request cannot dismiss a current 401');
    }
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        for (const newerFirst of [true, false]) {
            const s = setup(), initial = s.refresh();
            s.requests[0].resolve(response(200, [record])); await initial;
            const remove = s.el('tableBody').querySelector('.booking-delete');
            const older = s.refresh();
            let newer;
            if (method === 'GET') newer = s.refresh();
            if (method === 'POST') s.book();
            if (method === 'PUT') s.edit();
            // An already-open delete confirmation may outlive a refresh.
            if (method === 'DELETE') { remove.click(); await tick(); }
            const failure = s.requests.at(-1);
            if (newerFirst) {
                failure.resolve(response(401)); await (newer || tick());
                s.requests[1].resolve(response(200, [record])); await older;
            } else {
                s.requests[1].resolve(response(200, [record])); await older;
                failure.resolve(response(401)); await (newer || tick());
            }
            assert.equal(s.el('mainApp').hidden, true, method + ': newest 401 wins in either completion order');
            assert.equal(s.el('unauthorizedScreen').hidden, false);
            const recovered = s.refresh(); s.requests.at(-1).resolve(response(200, [record])); await recovered;
            assert.equal(s.el('mainApp').hidden, false, 'a genuinely newer successful request can recover');
        }
    }
    {
        const s = setup(), earlier = s.refresh();
        let finishBody;
        s.requests[0].resolve({ok: true, status: 200, json: () => new Promise(resolve => { finishBody = resolve; })});
        await tick(); s.book();
        s.requests[1].resolve(response(401)); await tick();
        finishBody({status: 'success', data: [], isAdmin: true}); await earlier;
        assert.equal(s.el('mainApp').hidden, true, 'an old response body completing late cannot reopen an expired session');
    }
    const completionOrders = [[0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0]];
    for (const statuses of [[200,401,200], [401,200,401], [401,401,200], [200,200,401]]) {
        for (const order of completionOrders) {
            const s = setup(), reads = [s.refresh(), s.refresh(), s.refresh()];
            let newestCompleted = -1;
            for (const index of order) {
                s.requests[index].resolve(response(statuses[index])); await reads[index];
                newestCompleted = Math.max(newestCompleted, index);
                assert.equal(s.el('mainApp').hidden, statuses[newestCompleted] === 401,
                    'three concurrent requests must follow the newest confirmed outcome: ' + statuses + ' / ' + order);
            }
            assert.equal(s.timers.size, 0);
        }
    }
    for (const sameRecord of [true, false]) {
        const s = setup(); s.book();
        s.requests[0].resolve(response(200, record)); await tick();
        s.requests[1].resolve(response(200, [record])); await tick();
        assert.equal(s.el('bookingResult').hidden, false);
        const updated = '<ชื่อเรื่องที่แก้ไขแล้ว>';
        s.edit(sameRecord ? '1' : '2', updated);
        s.requests[2].resolve(response(200, {})); await tick();
        assert.equal(s.el('resultDetail').textContent, sameRecord ? updated : record.Doc_Detail, 'update only the matching reservation banner');
        // The write succeeded even when the follow-up register read fails.
        s.requests[3].reject(new TypeError('QA offline')); await tick();
        assert.equal(s.el('resultDetail').textContent, sameRecord ? updated : record.Doc_Detail);
        assert.equal(s.el('resultNumber').textContent, record.External_Number);
        assert.equal(s.el('editModal').open, false);
        if (sameRecord) {
            const refreshed = s.refresh();
            s.requests[4].resolve(response(200, [{...record, Doc_Detail: 'ชื่อเรื่องล่าสุดจากทะเบียน'}])); await refreshed;
            assert.equal(s.el('resultDetail').textContent, 'ชื่อเรื่องล่าสุดจากทะเบียน', 'later reads keep the banner synchronized');
        }
    }
    {
        const s = setup(); s.book();
        s.requests[0].resolve(response(200, record)); await tick();
        s.requests[1].resolve(response(200, [record])); await tick();
        s.edit(); s.requests[2].resolve(response(400)); await tick();
        assert.equal(s.el('resultDetail').textContent, record.Doc_Detail, 'failed edit must not change the successful reservation');
    }
    {
        const s = setup(); s.edit();
        s.requests[0].resolve(response(401)); await tick();
        assert.equal(s.el('editModal').open, false);
        assert.equal(s.leaving(), true, 'hidden expired-session edits still warn before closing the tab');
        assert.equal(s.retainedChanges(), true, 'central guard must count the hidden retained edit before logout');
        s.resume();
        assert.equal(s.el('editModal').open, false, 'resuming navigation cannot open an expired-session dialog');
        const recovered = s.refresh(); s.requests[1].resolve(response()); await recovered;
        assert.equal(s.el('editModal').open, true, 'confirmed recovery restores the retained edit');
        assert.equal(s.el('editDocDetail').value, 'ชื่อเรื่องที่ยังไม่ยืนยันผล');
        assert.equal(s.saved(), 0);
        s.el('cancelEdit').click(); s.resume();
        assert.equal(s.el('editModal').open, false, 'cancelled draft must not reopen');
        assert.equal(s.leaving(), false);
        assert.equal(s.retainedChanges(), false, 'cancel releases the retained-edit guard');
    }
    {
        const s = setup(); s.el('openBooking').click(); s.book(); s.requests[0].resolve(response(401)); await tick();
        assert.equal(s.el('bookingModal').open, false, 'expired session closes the booking modal');
        assert.equal(s.leaving(), true, 'hidden booking subject must warn before closing the tab');
        assert.equal(s.retainedChanges(), true, 'central guard must count a hidden booking subject');
        const recovered = s.refresh(); s.requests[1].resolve(response()); await recovered;
        assert.equal(s.el('bookingModal').open, true, 'authentication recovery restores the booking draft');
        s.el('docDetail').value = '';
        assert.equal(s.leaving(), false, 'no draft means no extra exit warning');
        assert.equal(s.retainedChanges(), false);
    }
    {
        const s = setup(); s.el('openBooking').click(); s.book();
        s.requests[0].resolve(response(200, record)); await tick();
        s.requests[1].resolve(response(200, [record])); await tick();
        assert.equal(s.el('bookingModal').open, false, 'successful reservation closes the booking modal');
        s.el('yearFilter').value = '2568';
        const otherYear = s.refresh(); s.requests[2].resolve(response()); await otherYear;
        assert.equal(s.el('bookingResult').hidden, false, 'another year cannot invalidate the latest reservation');
        s.el('yearFilter').value = String(new Date().getFullYear() + 543);
        const removed = s.refresh(); s.requests[3].resolve(response()); await removed;
        assert.equal(s.el('bookingResult').hidden, true, 'a removed reservation must not remain advertised as usable');
    }
    {
        const s = setup();
        const records = Array.from({length: 45}, (_, i) => ({...record, id: i + 1, Doc_Detail: 'QA searchable ' + i}));
        const initial = s.refresh(); s.requests[0].resolve(response(200, records)); await initial;
        s.el('nextPage').click(); s.el('nextPage').click();
        assert.equal(s.el('pageLabel').textContent, '3 / 3');
        const pending = s.refresh();
        s.el('tableSearch').value = 'QA searchable'; s.el('tableSearch').dispatchEvent(new Event('input'));
        s.requests[1].resolve(response(200, records)); await pending;
        assert.equal(s.el('pageLabel').textContent, '1 / 3', 'typing during a refresh still resets pagination');
    }
    console.log('PASS number booking: shared authentication ordering (all methods/both completion orders), recovery, retained dialogs, fetch/body timeout, duplicate submit, synchronized/deleted result banner and pending-search pagination');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
