const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
    const nodes = new Map();
    for (const id of ['loop_receive', 'content_received', 'load_data', 'doc_status_42', 'All_Doc', 'All_Doc_1', 'All_Doc_2']) {
        nodes.set(id, {style: {}, textContent: '20', innerHTML: ''});
    }
    const stored = new Map([['read_status_change', 'NotRead'], ['currentPage', 'received']]);
    const opened = {doc_id: 42, status: 'NotRead', is_signed: false};
    const requests = [];
    let listResponse = () => [];
    const context = vm.createContext({
        document: {getElementById: id => nodes.get(id)}, window: {innerWidth: 1400, location: {href: 'https://example.test/'}, history: {replaceState() {}}},
        localStorage: {getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value)},
        console: {log() {}, error() {}, warn() {}}, data_save: [opened], getCookie: () => '2569',
        pagination_create() {}, updateDataSave() {}, URL,
        fetch: async (url, options) => {
            requests.push({url, payload: JSON.parse(options.body)});
            return {ok: true, json: async () => url.includes('update_read') ? {status: 'success'} : listResponse(JSON.parse(options.body))};
        }
    });
    vm.runInContext(fs.readFileSync('assets/api-service.js', 'utf8'), context);
    await context.update_read_status(42, '', 'received');
    assert.equal(requests.length, 1, 'opening must not refetch/remove the pending item');
    assert.equal(opened.status, 'Readed', 'reading is still tracked independently');
    assert.equal(opened.is_signed, false, 'reading must not complete signing');
    assert.notEqual(nodes.get('doc_status_42').style.display, 'none', 'pending signature dot must survive opening');
    for (const filter of ['NotRead', 'Readed', '']) {
        stored.set('read_status_change', filter);
        context.window.innerWidth = 390;
        for (const status of ['NotRead', 'Readed']) {
            for (const signed of [false, true]) {
                listResponse = () => [{doc_id: 42, status, is_signed: signed, Pagination: 1, Total_Records: 1}];
                await context.get_data_api_received(1);
                assert.equal(nodes.get('loop_receive').innerHTML.includes('id="doc_status_42"'), !signed, `${filter}/${status}/${signed}`);
                if (!signed) assert.ok(nodes.get('loop_receive').innerHTML.includes('aria-label="รอลงนาม"'));
            }
        }
    }
    context.window.innerWidth = 1400;
    listResponse = () => [];
    for (const [filter, message] of [['NotRead', 'ไม่มีหนังสือรอดำเนินการ'], ['Readed', 'ไม่มีหนังสือที่ลงนามแล้ว'], ['', 'ไม่พบข้อมูล']]) {
        stored.set('read_status_change', filter);
        await context.get_data_api_received(1);
        assert.equal(requests.at(-1).payload.Read_Status_find, filter);
        assert.ok(nodes.get('content_received').innerHTML.includes(message));
        for (const id of ['All_Doc', 'All_Doc_1', 'All_Doc_2']) assert.equal(nodes.get(id).textContent, '0');
    }
    stored.set('read_status_change', 'NotRead');
    listResponse = payload => payload.Page_number > 1 ? [] : [{doc_id: 43, status: 'Readed', Pagination: 1, Total_Records: 20}];
    const beforeFallback = requests.length;
    await context.get_data_api_received(2, 'retained search', undefined, '2568', 'token');
    assert.deepEqual(requests.slice(beforeFallback).map(request => request.payload.Page_number), [2, 1]);
    assert.equal(requests.at(-1).payload.search_txt, 'retained search');
    assert.equal(requests.at(-1).payload.Year, '2568');
    assert.equal(requests.at(-1).payload.Read_Status_find, 'NotRead');
    assert.equal(nodes.get('All_Doc').textContent, 20, 'remaining documents must not be reported as zero');
    assert.ok(nodes.get('loop_receive').innerHTML.includes('tb_status_read_43'));
    listResponse = () => [];
    const beforeEmpty = requests.length;
    await context.get_data_api_received(5);
    assert.equal(requests.length - beforeEmpty, 2, 'empty inbox fallback must terminate at page one');
    const beforeTarget = requests.length;
    await context.get_data_api_received(2, '', 42);
    assert.equal(requests.length - beforeTarget, 1, 'targeted document lookups must not fall back to unrelated documents');
    const main = fs.readFileSync('assets/main.js', 'utf8');
    vm.runInContext(main.slice(main.indexOf('function read_status_change('), main.indexOf('function read_show(')), context);
    nodes.set('sub_head', {});
    stored.set('read_status_change', '');
    context.read_status_change('NotRead');assert.equal(nodes.get('sub_head').innerHTML, 'รอดำเนินการ');
    context.read_status_change('Readed');assert.equal(nodes.get('sub_head').innerHTML, 'ลงนามแล้ว');
    context.read_status_change('Readed');assert.equal(nodes.get('sub_head').innerHTML, 'ทั้งหมด');
    console.log('PASS inbox filters: pending dots survive reading and reload, signed dots disappear, all filters/read states, signing labels, empty states and counters');
})().catch(error => { console.error(error); process.exitCode = 1; });
