const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const vm = require('node:vm');
const php = process.env.PHP_BIN || 'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const logic = cp.spawnSync(php, ['tests/google-auth.php'], {encoding:'utf8'});
process.stdout.write(logic.stdout);
if (logic.status !== 0) throw Error(logic.stdout + logic.stderr);

const script = fs.readFileSync('assets/google-login.js', 'utf8');
function ui(enabled, query) {
    const nodes = {google_login_part:{hidden:true}, google_login_btn:{href:'api/auth_google.php'}, google_signup_change_account:{href:'api/auth_google.php'}, login_status:{textContent:''}};
    const window = {EOFFICE_GOOGLE_LOGIN_ENABLED:enabled, location:{href:'http://localhost/' + query}, history:{state:null,replaceState(_state,_title,url){this.url=url;}}};
    vm.runInNewContext(script, {window, URL, document:{getElementById:id=>nodes[id]}});
    return {nodes,window};
}
assert.equal(ui(false, '').nodes.google_login_part.hidden, true);
const enabled = ui(true, '?id=123&google_login=not_registered');
assert.equal(enabled.nodes.google_login_part.hidden, false);
assert.equal(enabled.nodes.google_login_btn.href, 'api/auth_google.php?id=123');
assert.equal(enabled.nodes.google_signup_change_account.href, 'api/auth_google.php?id=123');
assert.equal(ui(true, '?id=https://attacker.example').nodes.google_signup_change_account.href, 'api/auth_google.php');
assert.match(enabled.nodes.login_status.textContent, /ผู้ดูแล/);
assert.equal(enabled.window.history.url, '/?id=123');
assert.ok(!ui(true, '?google_login=%3Cscript%3E').nodes.login_status.textContent.includes('<script>'));
for (const error of ['__proto__', 'constructor', 'toString', '<script>', 'unknown']) {
    assert.equal(ui(true, '?google_login=' + encodeURIComponent(error)).nodes.login_status.textContent,
        ui(true, '?google_login=failed').nodes.login_status.textContent);
}
console.log('PASS Google login button visibility, document return and safe error display');

const port = Number(process.env.GOOGLE_TEST_PORT || 8094);
const base = `http://localhost:${port}`;
const env = {...process.env, APP_URL:base, EOFFICE_MOCK_SERVICES:'true', GOOGLE_CLIENT_ID:'test-client', GOOGLE_CLIENT_SECRET:'test-secret'};
const servers = [];
let errors = '';
function start(port, env) {
    const server = cp.spawn(php, ['-S', `localhost:${port}`, 'scripts/router.php'], {env,stdio:['ignore','ignore','pipe']});
    server.stderr.on('data', data=>errors+=data);
    servers.push(server);
    return server;
}
async function ready(url) {
    for(let i=0;i<50;i++) {
        try { await fetch(url); return; } catch { await new Promise(resolve=>setTimeout(resolve,100)); }
    }
    throw Error('Google test server unavailable');
}
async function get(route, cookie='') {
    return fetch(base+route, {redirect:'manual',headers:cookie?{Cookie:cookie}:{}});
}
async function begin(query='') {
    const r = await get('/api/auth_google.php'+query);
    assert.equal(r.status, 302);
    const url = new URL(r.headers.get('Location'));
    assert.equal(url.origin, 'https://accounts.google.com');
    const cookies = r.headers.getSetCookie();
    const cookie = cookies.find(c=>c.startsWith('EOFFICE_GOOGLE='));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Max-Age=600/i);
    assert.equal(url.searchParams.get('redirect_uri'), base+'/api/auth_google_callback.php');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.match(url.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
    assert.match(url.searchParams.get('state'), /^[a-f0-9]{64}$/);
    assert.ok(!r.headers.get('Location').includes('test-secret'));
    return {state:url.searchParams.get('state'),cookie:cookie.split(';')[0]};
}
async function run() {
    start(port, env);
    start(port+1, {...env,APP_URL:`http://localhost:${port+1}`,GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:''});
    await Promise.all([ready(base+'/'),ready(`http://localhost:${port+1}/`)]);
    const html = await (await get('/')).text();
    assert.match(html, /EOFFICE_GOOGLE_LOGIN_ENABLED = true/);
    assert.ok(!html.includes('test-secret'));
    const flow = await begin('?id=123');
    let r = await get('/api/auth_google_callback.php?state=wrong&code=forged', flow.cookie);
    assert.equal(r.status, 303);
    assert.equal(new URL(r.headers.get('Location')).searchParams.get('google_login'), 'invalid_state');
    assert.ok(!r.headers.getSetCookie().some(c=>c.startsWith('User_Token=')));
    r = await get('/api/auth_google_callback.php?state='+flow.state+'&error=access_denied', flow.cookie);
    assert.equal(new URL(r.headers.get('Location')).searchParams.get('google_login'), 'cancelled');
    const cancelled = await begin('?id=123');
    r = await get('/api/auth_google_callback.php?state='+cancelled.state+'&error=access_denied', cancelled.cookie);
    assert.equal(r.headers.get('Location'), base+'/?id=123&google_login=cancelled');
    r = await get('/api/auth_google_callback.php?state='+cancelled.state+'&error=access_denied', cancelled.cookie);
    assert.equal(new URL(r.headers.get('Location')).searchParams.get('google_login'), 'invalid_state');
    r = await get('/api/auth_google_callback.php?state[]=bad');
    assert.equal(new URL(r.headers.get('Location')).searchParams.get('google_login'), 'invalid_state');
    const missing = await begin('?id=https://attacker.example');
    r = await get('/api/auth_google_callback.php?state='+missing.state, missing.cookie);
    assert.equal(r.headers.get('Location'), base+'/?google_login=failed');
    r = await fetch(`http://localhost:${port+1}/api/auth_google.php`, {redirect:'manual'});
    assert.equal(r.status, 303);
    assert.equal(new URL(r.headers.get('Location')).searchParams.get('google_login'), 'not_configured');
    const disabledHtml = await (await fetch(`http://localhost:${port+1}/`)).text();
    assert.match(disabledHtml, /EOFFICE_GOOGLE_LOGIN_ENABLED = false/);
    console.log('PASS HTTP authorization redirect, session cookie, state/replay, cancellation, malformed callback, fixed return and disabled configuration');
}
run().catch(error=>{console.error(error);console.error(errors);process.exitCode=1;}).finally(()=>servers.forEach(server=>server.kill()));
