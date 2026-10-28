const assert=require('node:assert/strict');
const cp=require('node:child_process');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const env={...process.env,DB_DATABASE:`eoffice_export_${process.pid}_test`,EOFFICE_MOCK_SERVICES:'true'};
function run(action,query='') {
    const result=cp.spawnSync(php,['tests/order-export-fixture.php',action,query],{env,encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
    return JSON.parse(result.stdout);
}
let created=false;
try {
    run('seed');created=true;
    const normal=run('read','year=2569&limit=1&page=2');
    assert.equal(normal.data.length,1);assert.equal(normal.pagination.current_page,2);
    assert.equal(normal.pagination.total_items,205);
    const exported=run('read','export=1&year=2569&search='+encodeURIComponent('แต่งตั้ง')+'&limit=1&page=2');
    assert.equal(exported.data.length,205);assert.equal(exported.pagination.total_items,205);
    assert.equal(exported.pagination.current_page,1);assert.equal(exported.pagination.total_pages,1);
    assert.ok(exported.data.every(row=>row.doc_year==='2569'&&row.files[0]==='before.pdf'));
    assert.equal(run('read','export=1&year=2568').data.length,1);
    assert.equal(run('other','export=1').data.length,1,'recipient scoping');
    assert.equal(run('guest','export=1').status,'error','authentication is required');
    for(const search of ['%','_','missing'])assert.equal(run('read','export=1&search='+encodeURIComponent(search)).data.length,0);
    const snapshot=run('concurrent','export=1&year=2569');
    assert.equal(snapshot.data.length,205);
    assert.ok(snapshot.data.every(row=>row.doc_name.startsWith('before ')&&row.files[0]==='before.pdf'),'document fields and attachment metadata must share the pre-edit snapshot');
    const after=run('read','export=1&year=2569');
    assert.ok(after.data.every(row=>row.doc_name==='after'&&row.files[0]==='after.pdf'),'concurrent edits must actually commit and appear on the next export');
    console.log('PASS export API: >200 rows, filters, recipient scope, authentication, pagination and concurrent document/attachment snapshot');
} finally {
    if(created)run('drop');
}
