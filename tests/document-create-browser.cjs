// Browser-to-database regression for the main document create form.
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const php = process.env.PHP_BIN || 'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const port = Number(process.env.DOCUMENT_CREATE_BROWSER_PORT || 8737);
const cdpPort = Number(process.env.DOCUMENT_CREATE_CDP_PORT || 9267);
const base = `http://127.0.0.1:${port}`;
const database = `eoffice_amss_${process.pid}_test`;
const dbHost = process.env.DB_HOST || '127.0.0.1';
if (!['localhost', '127.0.0.1', '::1'].includes(dbHost)) {
    throw Error('Document-create browser tests require a loopback database host');
}
if (!database.endsWith('_test') || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) {
    throw Error('Document-create browser writes require a local *_test database');
}

const temp = path.join(os.tmpdir(), 'opencode');
const storage = path.join(temp, `eoffice-document-create-${process.pid}`);
const profile = path.join(temp, `eoffice-document-create-chrome-${process.pid}`);
const env = {
    ...process.env,
    DB_HOST: dbHost,
    DB_DATABASE: database,
    TEST_DATABASE: database,
    APP_URL: base,
    EOFFICE_MOCK_SERVICES: 'true',
    EOFFICE_REMOTE_FILES: 'false',
    EOFFICE_DRIVE_ARCHIVE_ENABLED: 'false',
    EOFFICE_SETTINGS_KEY: require('node:crypto').randomBytes(32).toString('base64'),
    EOFFICE_STORAGE: storage,
};
let fixtureCreated = false;
let server;
let chrome;
let socket;
let sequence = 0;
const pending = new Map();
const exceptions = [];
const browserDialogs = [];
let serverErrors = '';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function cli(args) {
    const result = cp.spawnSync(php, args, { env, encoding: 'utf8', timeout: 120000 });
    if (result.status !== 0) throw Error(result.stdout + result.stderr);
    return result.stdout;
}

function fixture(action) {
    return cli(['tests/amss-fixture.php', action]);
}

function assertPortFree(port) {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(port, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolve()));
    });
}

function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(Error(`CDP timeout: ${method}`));
        }, 30000);
        pending.set(id, {
            resolve: value => { clearTimeout(timer); resolve(value); },
            reject,
        });
        socket.send(JSON.stringify({ id, method, params }));
    });
}

async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
    });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
}

async function until(expression) {
    for (let i = 0; i < 200; i++) {
        try {
            if (await evaluate(expression)) return;
        } catch {}
        await sleep(100);
    }
    throw Error(`Condition timed out: ${expression}`);
}

async function run() {
    fs.mkdirSync(temp, { recursive: true });
    if (fs.existsSync(storage) || fs.existsSync(profile)) {
        throw Error('Refusing to reuse an existing browser-test directory');
    }
    await assertPortFree(port);
    await assertPortFree(cdpPort);

    console.log('PREPARE isolated mock document schema');
    fixture('seed');
    fixtureCreated = true;
    const schema = `
        require 'config/bootstrap.php';
        $pdo=app_pdo();
        $pdo->exec("CREATE TABLE t_department (Department_Id INT PRIMARY KEY AUTO_INCREMENT,Department_Name VARCHAR(255),Department_Detail TEXT) ENGINE=InnoDB");
        $pdo->exec("ALTER TABLE t_access_rights ADD COLUMN Status VARCHAR(20) NOT NULL DEFAULT 'Unread'");
        $pdo->exec("CREATE TABLE t_external_number_booking (Doc_Year VARCHAR(4),External_Number INT) ENGINE=InnoDB");
    `;
    const schemaResult = cp.spawnSync(php, ['-r', schema], { env, encoding: 'utf8', timeout: 120000 });
    if (schemaResult.status !== 0) throw Error(schemaResult.stdout + schemaResult.stderr);
    cli(['scripts/migrate.php', '--test']);
    const seed = JSON.parse(cli(['tests/seed.php']));

    console.log('START local browser and authenticate the synthetic Admin');
    server = cp.spawn(php, ['-S', `127.0.0.1:${port}`, 'scripts/router.php'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    server.stderr.on('data', data => { serverErrors += String(data); });
    let serverReady = false;
    for (let i = 0; i < 100; i++) {
        try {
            const response = await fetch(`${base}/api/me.php`, { signal: AbortSignal.timeout(1000) });
            if (response.ok) {
                serverReady = true;
                break;
            }
        } catch {
            await sleep(100);
        }
    }
    assert.equal(serverReady, true, 'local test server must answer its isolated API probe');
    const login = await fetch(`${base}/api/auth_login.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'qa-admin@siya.ac.th', password: 'Review-Test-2026!' }),
        signal: AbortSignal.timeout(10000),
    });
    const loginBody = await login.text();
    assert.equal(login.status, 200, loginBody);
    const cookie = login.headers.getSetCookie().find(value => value.startsWith('User_Token='));
    assert.ok(cookie, 'test admin receives an authenticated session cookie');
    const token = cookie.slice('User_Token='.length).split(';', 1)[0];

    chrome = cp.spawn(process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
        '--headless=new',
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
    ], { stdio: 'ignore' });

    let targets;
    for (let i = 0; i < 100; i++) {
        try {
            targets = await fetch(`http://127.0.0.1:${cdpPort}/json`, {
                signal: AbortSignal.timeout(1000),
            }).then(response => response.json());
            break;
        } catch {
            await sleep(100);
        }
    }
    assert.ok(targets, 'Chromium must start for the document form browser test');
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
            const call = pending.get(message.id);
            pending.delete(message.id);
            message.error ? call.reject(Error(JSON.stringify(message.error))) : call.resolve(message.result);
        }
        if (message.method === 'Page.javascriptDialogOpening') {
            browserDialogs.push(message.params.message);
            send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
        }
        if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.setBlockedURLs', {
        urls: [
            '*://www.googletagmanager.com/*',
            '*://fonts.googleapis.com/*',
            '*://fonts.gstatic.com/*',
            '*://cdnjs.cloudflare.com/*',
            '*://cdn.onesignal.com/*',
            '*://cdn-icons-png.flaticon.com/*',
        ],
    });
    await send('Emulation.setDeviceMetricsOverride', {
        width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    const cookieResult = await send('Network.setCookie', {
        name: 'User_Token',
        value: token,
        url: base,
        httpOnly: true,
        sameSite: 'Lax',
    });
    assert.equal(cookieResult.success, true, 'browser receives only the isolated test session');
    await send('Page.navigate', { url: `${base}/index.php?view=send_table` });
    await until("window.eofficeSessionState?.status==='authenticated' && document.getElementById('add-doc-btn')?.checkVisibility()");
    await evaluate("document.getElementById('add-doc-btn').click()");
    await until("!document.getElementById('document-modal').classList.contains('hidden')");

    const stamp = Date.now();
    await evaluate(`(()=>{const values={doc_number_receive:'QA-BROWSER-${stamp}',doc_number:'QA-BROWSER-${stamp}',doc_date:'2026-10-14',doc_receive_from:'Browser QA',doc_name:'Browser attachment and recipient regression'};for(const [id,value]of Object.entries(values)){const node=document.getElementById(id);node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    await evaluate("document.getElementById('addNewInputFile_btn').click()");
    await until("document.querySelector('#file_send input[type=file]')");
    const encodedPdf = JSON.stringify(seed.pdf);
    await evaluate(`(()=>{const bytes=Uint8Array.from(atob(${encodedPdf}),value=>value.charCodeAt(0));const file=new File([bytes],'browser-fixture.pdf',{type:'application/pdf'});const transfer=new DataTransfer();transfer.items.add(file);const input=document.querySelector('#file_send input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#file_send input[name="doc_file_name[]"]').value='Browser fixture PDF';})()`);
    await evaluate("document.getElementById('name_search').value='QA recipient';get_userName()");
    await until("document.getElementById('findName').textContent.includes('QA recipient') && document.querySelector('#findName img')");
    await evaluate("document.querySelector('#findName img').click()");
    assert.equal(await evaluate("document.querySelector('#user_send input[name=\"send_to[]\"]')?.value"), String(seed.users.recipient));
    assert.equal(await evaluate("document.getElementById('document-form').checkValidity()"), true, 'required fields and attachment caption are valid');
    await evaluate(`(()=>{const original=window.fetch.bind(window);window.__qaDocumentSave=null;window.fetch=async(...args)=>{const response=await original(...args);if(new URL(String(args[0]),location.href).pathname==='/api/create_document.php')window.__qaDocumentSave={status:response.status,body:await response.clone().text()};return response;};})()`);
    await evaluate("document.getElementById('document-form').requestSubmit()");
    try {
        await until("document.getElementById('formtype').value==='edit_document' && Number(document.getElementById('doc_id').value)>0 && document.getElementById('document-modal').classList.contains('hidden')");
    } catch (error) {
        const state = await evaluate(`(()=>({formType:document.getElementById('formtype')?.value,docId:document.getElementById('doc_id')?.value,modalOpen:!document.getElementById('document-modal')?.classList.contains('hidden'),save:window.__qaDocumentSave,loading:document.getElementById('loading_save')?.checkVisibility()}))()`);
        throw Error(`${error.message}; browser=${JSON.stringify(state)}; dialogs=${JSON.stringify(browserDialogs)}; PHP=${serverErrors.slice(-12000)}`);
    }
    const browserResult = await evaluate(`(()=>({docId:Number(document.getElementById('doc_id').value),formType:document.getElementById('formtype').value,modalClosed:document.getElementById('document-modal').classList.contains('hidden')}))()`);

    const inspectCode = `
        require 'config/bootstrap.php';
        $id=(int)getenv('EOFFICE_QA_DOC_ID');
        $pdo=app_pdo();
        $q=$pdo->prepare('SELECT * FROM t_document WHERE Doc_Id=?');$q->execute([$id]);$doc=$q->fetch();
        $q=$pdo->prepare('SELECT * FROM t_document_upload WHERE Doc_File_Link=?');$q->execute([$doc['Doc_File_Link']]);$files=$q->fetchAll();
        $q=$pdo->prepare('SELECT User_Id FROM t_access_rights WHERE Doc_Id=? ORDER BY User_Id');$q->execute([$id]);$recipients=$q->fetchAll(PDO::FETCH_COLUMN);
        $outbox=$pdo->query('SELECT payload FROM eoffice_outbox ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
        $outbox=array_values(array_filter($outbox,static fn($payload)=>(int)(json_decode($payload,true)['doc_id']??0)===$id));
        $path=$files?app_storage('original',$doc['Doc_Year'],$files[0]['Doc_Upload_Path']):'';
        echo json_encode(['doc'=>$doc,'files'=>$files,'recipients'=>$recipients,'outbox'=>$outbox,'file_exists'=>$path!==''&&is_file($path),'file_sha256'=>$path!==''&&is_file($path)?hash_file('sha256',$path):null],JSON_THROW_ON_ERROR);
    `;
    const inspect = cp.spawnSync(php, ['-r', inspectCode], {
        env: { ...env, EOFFICE_QA_DOC_ID: String(browserResult.docId) },
        encoding: 'utf8',
        timeout: 120000,
    });
    if (inspect.status !== 0) throw Error(inspect.stdout + inspect.stderr);
    const saved = JSON.parse(inspect.stdout);
    assert.ok(browserResult.docId > 0);
    assert.equal(browserResult.formType, 'edit_document');
    assert.equal(browserResult.modalClosed, true);
    assert.equal(saved.doc.Doc_Name, 'Browser attachment and recipient regression');
    assert.equal(saved.doc.User_Id, seed.users.admin);
    assert.equal(saved.files.length, 1);
    assert.equal(saved.files[0].Doc_Upload_Detail, 'Browser fixture PDF');
    assert.equal(saved.recipients.length, 1);
    assert.equal(Number(saved.recipients[0]), seed.users.recipient);
    assert.equal(saved.file_exists, true);
    assert.equal(saved.file_sha256, require('node:crypto').createHash('sha256').update(Buffer.from(seed.pdf, 'base64')).digest('hex'));
    assert.equal(saved.outbox.length, 1, 'the selected recipient is notified from the committed document');
    const notification = JSON.parse(saved.outbox[0]);
    assert.equal(notification.user_id, seed.users.recipient);
    assert.equal(notification.doc_id, browserResult.docId);
    assert.deepEqual(exceptions, [], 'browser flow must not throw JavaScript exceptions');
    console.log('PASS browser creates a document with a selected recipient and uploaded PDF; UI, DB grant, notification and stored bytes agree');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    socket?.close();
    chrome?.kill();
    server?.kill();
    if (fixtureCreated) {
        try { fixture('drop'); } catch (error) { console.error(error); process.exitCode = 1; }
    }
    for (const directory of [profile, storage]) {
        try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
    }
});
