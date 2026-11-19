const assert = require('node:assert/strict');
const {spawn, execFileSync} = require('node:child_process');
const php = process.env.PHP_BIN || 'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const port = Number(process.env.OFFICIAL_TRAVEL_TEST_PORT || 8197);
const base = `http://127.0.0.1:${port}`;
const env = {...process.env, DB_HOST:'127.0.0.1', DB_DATABASE:`eoffice_travel_${process.pid}_test`, APP_URL:base, EOFFICE_MOCK_SERVICES:'true'};
const fixture = action => execFileSync(php, ['tests/official-travel-fixture.php',action], {env,encoding:'utf8'});
const endpoint = '/api/official-travel.php';
let tokens, server, seeded = false, passed = 0;
async function request(as, status, {query='', data, origin}={}) {
    const response = await fetch(base + endpoint + query, {
        method:data ? 'POST' : 'GET',
        headers:{...(as ? {Cookie:`User_Token=${tokens[as]}`} : {}), ...(data ? {'Content-Type':'application/json'} : {}), ...(origin ? {Origin:origin} : {})},
        body:data ? JSON.stringify(data) : undefined
    });
    const text = await response.text();
    assert.equal(response.status, status, text);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return JSON.parse(text);
}
async function check(name, fn) { await fn(); passed++; console.log('PASS '+name); }
async function run() {
    tokens = JSON.parse(fixture('seed'));
    seeded = true;
    server = spawn(php, ['-S',`127.0.0.1:${port}`,'scripts/router.php'], {env,stdio:'ignore'});
    for (let i=0; i<50; i++) {
        try { await request(null,401); break; }
        catch (error) {
            if (i === 49 || error.code === 'ERR_ASSERTION') throw error;
            await new Promise(resolve => setTimeout(resolve,100));
        }
    }
    const initial = await request('secretary',200);
    const nextYear = Number(initial.today.slice(0,4)) + 1;
    const data = {_expected_owner:2, executive_id:3, department:'academic', subject:'<img src=x> ทดสอบ', place:'สถานที่ทดสอบ',
        start_date:initial.today,end_date:initial.today,all_day:true,status:'scheduled',reference_no:'เลขภายใน',private_note:'ข้อความภายใน'};
    let travelId, old;
    await check('authenticated users read; only grant holders or Admin may write', async () => {
        assert.deepEqual(initial.executives.map(row => Number(row.id)).sort(),[1,3]);
        assert.equal((await request('admin',200)).can_manage,true);
        const reader = await request('reader',200);
        assert.equal(reader.can_manage,false);
        assert.deepEqual(reader.executives,[]);
        await request('reader',403,{data});
        await request(null,401,{data});
        await request('secretary',403,{data,origin:'https://example.test'});
        await request('secretary',409,{data:{...data,_expected_owner:1}});
    });
    await check('validates month, dates, clock, executive and role at the API', async () => {
        for (const query of ['?month=2026-13','?month[]=2026-11']) await request('reader',400,{query});
        for (const change of [{start_date:'2026-02-30'},{end_date:'1900-01-01'},{status:'cancelled'},
            {all_day:false,start_time:'16:00',end_time:'08:00'},{all_day:false,start_time:'09:00',end_time:'24:00'}]) {
            await request('secretary',400,{data:{...data,...change}});
        }
        await request('secretary',422,{data:{...data,executive_id:4}});
        await request('secretary',422,{data:{...data,department:'director'}});
    });
    await check('today summary, multi-month overlap, restricted fields and idempotent migration', async () => {
        ({id:travelId} = await request('secretary',201,{data}));
        await request('admin',201,{data:{...data,_expected_owner:1,executive_id:1,department:'director',
            start_date:`${nextYear}-01-30`,end_date:`${nextYear}-02-02`,all_day:false,start_time:'10:15',end_time:'16:45'}});
        fixture('migrate');
        old = (await request('secretary',200)).entries.find(row => row.id === travelId);
        assert.equal(old.private_note,data.private_note);
        assert.equal(old.reference_no,data.reference_no);
        assert.equal(old.revision,1);
        const {entries,today_entries} = await request('reader',200);
        assert.ok(today_entries.some(row => row.id === travelId));
        const row = entries.find(row => row.id === travelId);
        assert.equal(row.subject,data.subject);
        for (const key of ['private_note','reference_no','revision']) assert.equal(Object.hasOwn(row,key),false);
        for (const month of [`${nextYear}-01`,`${nextYear}-02`]) {
            const data = await request('reader',200,{query:'?month='+month});
            assert.equal(data.entries.find(row => row.department === 'director').end_time,'16:45');
            assert.ok(data.today_entries.some(row => row.id === travelId));
        }
        assert.equal((await request('reader',200,{query:`?month=${nextYear}-03`})).entries.length,0);
    });
    if (process.env.OFFICIAL_TRAVEL_BROWSER === '1') {
        await check('real browser: login-protected menu, form save, filters, safe text and mobile agenda', () =>
            require('./official-travel-browser.cjs')({base,tokens,month:initial.month}));
    }
    await check('postpone and cancel in place; stale edits and revoked permissions do not overwrite', async () => {
        const edit = {...data,id:travelId,revision:1,status:'postponed'};
        await request('secretary',200,{data:edit});
        await request('secretary',409,{data:edit});
        assert.ok(!(await request('reader',200)).today_entries.some(row => row.id === travelId));
        fixture('revoke');
        await request('secretary',403,{data:{...edit,revision:2,status:'cancelled'}});
        fixture('departed');
        await request('admin',200,{data:{...edit,_expected_owner:1,revision:2,status:'cancelled'}});
        const row = (await request('reader',200)).entries.find(row => row.id === travelId);
        assert.equal(row.status,'cancelled');
        assert.equal(row.executive_name,old.executive_name);
        const audit = JSON.parse(fixture('audit')).filter(row => Number(row.target_id) === travelId);
        assert.deepEqual(audit.map(row => row.event),['official_travel.create','official_travel.update','official_travel.update']);
        assert.deepEqual(JSON.parse(audit[2].metadata),{from:'postponed',to:'cancelled'});
    });
    console.log(`${passed} official travel checks passed`);
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    server?.kill();
    if (seeded) fixture('drop');
});
