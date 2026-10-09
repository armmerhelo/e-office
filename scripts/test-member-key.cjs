// Mock/local serving only. Secret values stay in private files or child pipes.
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function validateKey(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, 'base64').length !== 32) {
        throw Error('Invalid private test member-version key; refusing to replace it');
    }
    return value;
}

function prepareTestMemberKey(env, {php, root = path.resolve(__dirname, '..'), directory = path.join(os.tmpdir(), 'opencode', 'member-version-keys')} = {}) {
    if (!env.DB_DATABASE?.endsWith('_test') || env.EOFFICE_MOCK_SERVICES !== 'true') throw Error('Member test key setup requires an isolated mock database');
    // PHP resolves environment vs config/local.php exactly as the application
    // does. Validate an existing effective key before starting the web server.
    const code = `require $argv[1].'/config/member-management.php';
        $key=(string)app_env('EOFFICE_MEMBER_VERSION_KEY');
        if($key==='')$key=(string)app_env('EOFFICE_SETTINGS_KEY');
        if($key!=='')app_member_version_key();
        echo json_encode(['key'=>$key],JSON_THROW_ON_ERROR);`;
    const result = cp.spawnSync(php, ['-d', 'display_errors=0', '-r', code, root], {env, encoding:'utf8'});
    if (result.status !== 0) throw Error('Member-version configuration validation failed; check private key settings');
    let configured;
    try { configured = JSON.parse(result.stdout).key; } catch { throw Error('Member-version configuration probe failed'); }
    if (configured !== '') return {...env, EOFFICE_MEMBER_VERSION_KEY:configured};

    fs.mkdirSync(directory, {recursive:true, mode:0o700});
    const identity = crypto.createHash('sha256').update(path.resolve(root) + '\0' + env.DB_DATABASE).digest('hex');
    const target = path.join(directory, identity + '.key');
    if (!fs.existsSync(target)) {
        const temporary = target + '.' + crypto.randomBytes(12).toString('hex') + '.tmp';
        try {
            fs.writeFileSync(temporary, crypto.randomBytes(32).toString('base64'), {flag:'wx', mode:0o600});
            // Publish only complete bytes, exclusively. Concurrent launchers
            // adopt the winning key and never overwrite each other's secret.
            try { fs.linkSync(temporary, target); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    return {...env, EOFFICE_MEMBER_VERSION_KEY:validateKey(fs.readFileSync(target, 'utf8'))};
}

module.exports = {prepareTestMemberKey};
