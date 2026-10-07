const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const checker = path.resolve('scripts/check-staged.cjs');
const parent = path.join(os.tmpdir(), 'opencode');
fs.mkdirSync(parent, {recursive:true});
const repo = fs.mkdtempSync(path.join(parent, 'eoffice-secret-check-'));
const env = {...process.env, EOFFICE_CREDENTIAL_FILE:path.join(repo, 'missing-credentials.private.txt')};
function git(...args) {
    cp.execFileSync('git', args, {cwd:repo, env, stdio:'pipe'});
}
function check(status) {
    const r = cp.spawnSync(process.execPath, [checker], {cwd:repo, env, encoding:'utf8'});
    assert.equal(r.status, status, r.stderr || r.stdout);
    return JSON.parse(r.stdout);
}
try {
    git('init', '--quiet');
    const fakeSecret = 'GOCSPX-' + 'x'.repeat(32);
    fs.writeFileSync(path.join(repo, 'fixture.js'), `const secret = '${fakeSecret}';\n`);
    git('add', '--', 'fixture.js');
    // The scanner must inspect the staged blob even after the working file is cleaned.
    fs.writeFileSync(path.join(repo, 'fixture.js'), "const secret = '';\n");
    const rejected = check(1);
    assert.deepEqual(rejected.errors, [{file:'fixture.js', reason:'embedded private key/token'}]);
    assert.ok(!JSON.stringify(rejected).includes(fakeSecret));
    git('add', '--', 'fixture.js');
    assert.deepEqual(check(0).errors, []);
    fs.writeFileSync(path.join(repo, 'oauth.yaml'), `google_client_secret: ${fakeSecret}\n`);
    git('add', '--', 'oauth.yaml');
    assert.ok(check(1).errors.some(e=>e.file==='oauth.yaml' && e.reason==='embedded private key/token'));
    fs.writeFileSync(path.join(repo, 'oauth.yaml'), 'google_client_secret: YOUR_CLIENT_SECRET\n');
    git('add', '--', 'oauth.yaml');
    fs.mkdirSync(path.join(repo, 'config'));
    fs.writeFileSync(path.join(repo, 'config/local.php'), '<?php return [];\n');
    git('add', '--force', '--', 'config/local.php');
    assert.ok(check(1).errors.some(e=>e.file==='config/local.php' && e.reason==='private/runtime file'));
    console.log('PASS staged Google secret detection across JS/YAML, staged-vs-working-tree protection, clean placeholders and private config rejection');
} finally {
    fs.rmSync(repo, {recursive:true, force:true});
}
