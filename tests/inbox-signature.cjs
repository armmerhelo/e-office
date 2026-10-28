const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
    const nodes = new Map();
    for (const id of ['loop_receive', 'content_received', 'load_data', 'doc_status_42', 'All_Doc', 'All_Doc_1', 'All_Doc_2']) {
        nodes.set(id, {style: {}, textContent: '20', innerHTML: ''});
    }
    const stored = new Map([['read_status_change', 'NotRead'], ['currentPage', 'received']]);
    const opened = {doc_id: 42, status: 'NotRead', Is_Signed: 'false'};
    const requests = [];
    const context = vm.createContext({
        document: {getElementById: id => nodes.get(id)}, window: {location: {href: 'https://example.test/'}, history: {replaceState() {}}},
        localStorage: {getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value)},
        console: {log() {}, error() {}, warn() {}}, data_save: [opened], getCookie: () => '2569',
        pagination_create() {}, updateDataSave() {}, URL,
        fetch: async (url, options) => {
            requests.push({url, payload: JSON.parse(options.body)});
            return {ok: true, json: async () => url.includes('update_read') ? {status: 'success'} : []};
        }
    });
    vm.runInContext(fs.readFileSync('assets/api-service.js', 'utf8'), context);
    await context.update_read_status(42, '', 'received');
    assert.equal(requests.length, 1, 'opening must not refetch/remove the pending item');
    assert.equal(opened.status, 'Readed', 'reading is still tracked independently');
    assert.equal(opened.Is_Signed, 'false', 'reading must not complete signing');
    assert.equal(nodes.get('doc_status_42').style.display, 'none', 'read indicator still clears');
    for (const [filter, message] of [['NotRead', 'ไม่มีหนังสือรอดำเนินการ'], ['Readed', 'ไม่มีหนังสือที่ลงนามแล้ว'], ['', 'ไม่พบข้อมูล']]) {
        stored.set('read_status_change', filter);
        await context.get_data_api_received(1);
        assert.equal(requests.at(-1).payload.Read_Status_find, filter);
        assert.ok(nodes.get('content_received').innerHTML.includes(message));
        for (const id of ['All_Doc', 'All_Doc_1', 'All_Doc_2']) assert.equal(nodes.get(id).textContent, '0');
    }
    const main = fs.readFileSync('assets/main.js', 'utf8');
    vm.runInContext(main.slice(main.indexOf('function read_status_change('), main.indexOf('function read_show(')), context);
    nodes.set('sub_head', {});
    stored.set('read_status_change', '');
    context.read_status_change('NotRead');assert.equal(nodes.get('sub_head').innerHTML, 'รอดำเนินการ');
    context.read_status_change('Readed');assert.equal(nodes.get('sub_head').innerHTML, 'ลงนามแล้ว');
    context.read_status_change('Readed');assert.equal(nodes.get('sub_head').innerHTML, 'ทั้งหมด');
    console.log('PASS inbox filters: reading preserves pending work, separate read indicator, signing labels, empty states and counters');
})().catch(error => { console.error(error); process.exitCode = 1; });
