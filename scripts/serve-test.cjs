const cp = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const php = process.env.PHP_BIN || 'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const port = Number(process.env.DEV_PORT || 80);
const database = process.env.TEST_DATABASE || 'eoffice_review_test';
if (!database.endsWith('_test')) throw Error('Only *_test databases may be served by this command');
const env = {...process.env, DB_DATABASE:database, APP_URL:`http://localhost${port === 80 ? '' : ':' + port}`,
    EOFFICE_MOCK_SERVICES:'true', EOFFICE_STORAGE:path.join(os.tmpdir(),'opencode','eoffice-test-storage')};
const seed = cp.spawnSync(php, ['tests/seed.php'], {env,encoding:'utf8'});
if (seed.status !== 0) throw Error(seed.stdout + seed.stderr);
env.EOFFICE_TEST_AI_RECIPIENTS = JSON.stringify([JSON.parse(seed.stdout).users.recipient]);
const detached = process.argv.includes('--detach');
const server = cp.spawn(php, ['-S',`localhost:${port}`,'scripts/router.php'], {env,detached,stdio:detached?'ignore':'inherit'});
server.on('error', error => {console.error(error);process.exitCode=1;});
if (detached) server.once('spawn', () => {server.unref();console.log(`Test server PID ${server.pid}, ${env.APP_URL}, database ${database}`);process.exit(0);});
else server.on('exit', code => {process.exitCode = code;});
