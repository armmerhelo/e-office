const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
    const nodes = new Map();
    for (const id of ['loop_receive', 'content_received', 'load_data', 'doc_status_42', 'All_Doc', 'All_Doc_1', 'All_Doc_2', 'received-retry', 'Pagination', 'Pagination_PREV', 'Pagination_NEXT']) {
        nodes.set(id, {style: {}, textContent: '20', innerHTML: '',dataset:{},classList:{add(){},remove(){}}});
    }
    const stored = new Map([['read_status_change', 'NotRead'], ['currentPage', 'received']]);
    const opened = {doc_id: 42, status: 'NotRead', is_signed: false};
    const requests = [];
    let listResponse = () => [];
    let listFailure = '';
    let readResponse = {status:'success'};
    const context = vm.createContext({
        document: {getElementById: id => nodes.get(id)}, window: {innerWidth: 1400, location: {href: 'https://example.test/'}, history: {replaceState() {}}},
        localStorage: {getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value)},
        console: {log() {}, error() {}, warn() {}}, data_save: [opened], getCookie: () => '2569',
        pagination_create() {}, updateDataSave:rows=>{context.data_save=rows;}, URL,
        fetch: async (url, options) => {
            requests.push({url, payload: JSON.parse(options.body)});
            if (!url.includes('update_read') && !JSON.parse(options.body).Doc_Id) {
                if (listFailure === 'network') throw Error('Network unavailable');
                if (listFailure === 'http') return {ok:false,status:503};
                if (listFailure === 'json') return {ok:true,json:async()=>{throw SyntaxError('Invalid JSON');}};
                if (listFailure === 'shape') return {ok:true,json:async()=>({status:'error'})};
            }
            return {ok: true, json: async () => url.includes('update_read') ? readResponse : listResponse(JSON.parse(options.body))};
        }
    });
    vm.runInContext(fs.readFileSync('assets/api-service.js', 'utf8'), context);
    await context.update_read_status(42, '', 'received');
    assert.equal(requests.length, 1, 'opening must not refetch/remove the pending item');
    assert.equal(opened.status, 'Readed', 'reading is still tracked independently');
    assert.equal(opened.is_signed, false, 'reading must not complete signing');
    assert.notEqual(nodes.get('doc_status_42').style.display, 'none', 'pending signature dot must survive opening');
    readResponse={status:'success',requires_signature:false};
    listResponse=()=>[];
    const beforeLegacyRead=requests.length;
    await context.update_read_status(42,'','received');
    assert.equal(opened.is_signed,false);
    assert.equal(opened.is_completed,true);
    assert.equal(opened.completion_reason,'legacy_read');
    assert.equal(nodes.get('doc_status_42').style.display,'none');
    assert.equal(requests.length-beforeLegacyRead,2,'legacy read refreshes background pending/count');
    readResponse={status:'success',requires_signature:true};
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
    context.window.innerWidth = 390;
    listResponse = () => [{doc_id:42,status:'Readed',is_signed:false,is_completed:true,requires_signature:false,completion_reason:'legacy_read',Pagination:1,Total_Records:1}];
    await context.get_data_api_received(1);
    assert.ok(nodes.get('loop_receive').innerHTML.includes('อ่านแล้วตามเกณฑ์เดิม'));
    assert.equal(nodes.get('loop_receive').innerHTML.includes('id="doc_status_42"'),false,'legacy completion hides the dot without claiming a signature');
    context.window.innerWidth = 1400;
    listResponse = () => [];
    for (const [filter, message] of [['NotRead', 'ไม่มีหนังสือรอดำเนินการ'], ['Readed', 'ไม่มีหนังสือที่ดำเนินการแล้ว'], ['', 'ไม่พบข้อมูล']]) {
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
    assert.equal(requests.at(-1).payload.Read_Status_find, '', 'direct document links bypass the category without changing its selection');
    const details = [];
    context.view_doc_detail = (...args) => details.push(args);
    stored.set('read_status_change','NotRead');
    listResponse = payload => payload.Doc_Id ? [{doc_id:42,is_signed:true,status:'Readed',Pagination:1,Total_Records:1}] : [];
    const beforeSignedLink = requests.length;
    await context.get_data_api_received(1,'',42);
    assert.deepEqual(details,[[42,'received']]);
    assert.equal(requests.length-beforeSignedLink,2,'direct links restore the selected list after opening details');
    assert.equal(requests.at(-1).payload.Read_Status_find,'NotRead');
    assert.equal(nodes.get('All_Doc').textContent,'0','a signed deep link must not inflate pending counters');
    for (const failure of ['http','network','json','shape']) {
        listFailure=failure;
        const beforeDetails=details.length;
        await context.get_data_api_received(2,'kept search',42,'2568');
        assert.equal(details.length,beforeDetails+1,'background failure must not dismiss an opened document');
        assert.ok(nodes.get('loop_receive').innerHTML.includes('role="alert"'));
        assert.ok(nodes.get('loop_receive').innerHTML.includes('ลองใหม่'));
        assert.equal(context.data_save.length,0,'signed deep-link data must not remain as pending-list data');
        assert.equal(nodes.get('All_Doc').textContent,'—','failed counts must be unknown, not stale or zero');
        assert.equal(nodes.get('load_data').style.display,'none');
        const retry=nodes.get('received-retry').onclick;
        listFailure='';listResponse=()=>[{doc_id:43,status:'Readed',is_signed:false,Pagination:2,Total_Records:21}];
        const beforeRetry=requests.length;
        await retry();
        assert.equal(requests.length,beforeRetry+1,'background retry must load the category, not reopen the deep link');
        assert.equal(requests.at(-1).payload.Doc_Id,undefined);
        assert.equal(requests.at(-1).payload.Page_number,2);
        assert.equal(requests.at(-1).payload.search_txt,'kept search');
        assert.equal(requests.at(-1).payload.Year,'2568');
        assert.equal(nodes.get('All_Doc').textContent,21);
        assert.ok(!nodes.get('loop_receive').innerHTML.includes('role="alert"'));
        const afterRetry=requests.length;await retry();
        assert.equal(requests.length,afterRetry,'an obsolete retry cannot replace a newer list');
        listResponse=payload=>payload.Doc_Id?[{doc_id:42,is_signed:true,status:'Readed',Pagination:1,Total_Records:1}]:[];
    }
    const main = fs.readFileSync('assets/main.js', 'utf8');
    vm.runInContext(main.slice(main.indexOf('function restoreReceivedFilter('), main.indexOf('function read_show(')), context);
    nodes.set('sub_head', {});
    nodes.set('received-filter-description', {});
    for (const id of ['received-pending-filter', 'received-signed-filter', 'received-all-filter']) {
        const classes = new Set();
        nodes.set(id, {classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},setAttribute(name,value){this[name]=value;}});
    }
    for (const filter of ['NotRead', 'Readed', '']) {
        stored.set('read_status_change', filter);context.restoreReceivedFilter();
        assert.equal(stored.get('read_status_change'), filter, 'reload/Back preserves the selected category');
    }
    stored.delete('read_status_change');context.restoreReceivedFilter();
    assert.equal(stored.get('read_status_change'),'NotRead','new users start with pending work');
    stored.set('read_status_change', '');
    context.read_status_change('NotRead');assert.equal(nodes.get('sub_head').innerHTML, 'รอดำเนินการ');
    context.read_status_change('NotRead');assert.equal(nodes.get('sub_head').innerHTML, 'รอดำเนินการ','repeated clicks cannot switch silently to All');
    assert.equal(nodes.get('received-pending-filter')['aria-pressed'],'true');
    assert.equal(nodes.get('received-all-filter')['aria-pressed'],'false');
    context.read_status_change('Readed');assert.equal(nodes.get('sub_head').innerHTML, 'ดำเนินการแล้ว');
    context.read_status_change('Readed');assert.equal(nodes.get('sub_head').innerHTML, 'ดำเนินการแล้ว');
    context.read_status_change('');assert.equal(nodes.get('sub_head').innerHTML, 'ทั้งหมด');
    assert.equal(nodes.get('received-all-filter')['aria-pressed'],'true');
    assert.ok(nodes.get('received-filter-description').textContent.includes('31 ต.ค. 2569'));
    stored.set('read_status_change','Readed');
    listResponse=()=>[{doc_id:43,is_signed:true,status:'Readed',Pagination:1,Total_Records:1}];
    await context.get_data_api_received(1);
    assert.equal(nodes.get('sub_head').innerHTML,'ดำเนินการแล้ว','loading after another tab changes storage must sync the selected category');
    assert.equal(nodes.get('received-signed-filter')['aria-pressed'],'true');
    let resolveList;
    listResponse=()=>new Promise(resolve=>{resolveList=resolve;});
    const pending=context.get_data_api_received(1);
    await new Promise(resolve=>setImmediate(resolve));
    stored.set('read_status_change','NotRead');
    resolveList([{doc_id:43,is_signed:true,status:'Readed',Pagination:1,Total_Records:1}]);await pending;
    assert.equal(nodes.get('sub_head').innerHTML,'ดำเนินการแล้ว','accepted response labels must reflect its captured filter, not newer storage');
    console.log('PASS inbox filters: pending dots survive reading and reload, signed dots disappear, all filters/read states, signing labels, empty states and counters');
})().catch(error => { console.error(error); process.exitCode = 1; });
