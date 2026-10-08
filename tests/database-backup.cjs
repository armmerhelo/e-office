const cp=require('node:child_process'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const env={...process.env,DB_DATABASE:process.env.TEST_DATABASE||'eoffice_review_test',EOFFICE_MOCK_SERVICES:'true',EOFFICE_STORAGE:path.join(os.tmpdir(),'opencode','eoffice-test-storage'),EOFFICE_BACKUP_KEY:crypto.randomBytes(32).toString('base64')};
if(!env.DB_DATABASE.endsWith('_test'))throw Error('Only test databases allowed');
function run(args){const r=cp.spawnSync(php,args,{env,encoding:'utf8'});if(r.status!==0)throw Error('Backup test failed: '+r.stdout+r.stderr);return JSON.parse(r.stdout);}
const result=run(['scripts/backup.php']);
const database='eoffice_restore_'+crypto.randomBytes(6).toString('hex')+'_test',dir=path.join(os.tmpdir(),'opencode','restore-check-'+crypto.randomBytes(6).toString('hex')),keyFile=dir+'.private.json';let created=false;
function sql(code){const r=cp.spawnSync(php,['-r',`require 'config/bootstrap.php';${code}`],{env,encoding:'utf8'});if(r.status!==0)throw Error('Isolated restore database setup failed');}
try{
assert.equal(result.created,true);assert.ok(result.tables>0&&result.rows>0);assert.ok(result.encrypted_bytes>0);const verify=run(['scripts/encrypted-file.php','verify',result.path]);assert.equal(verify.verified,true);assert.equal(verify.sha256,result.stream_sha256);console.log('PASS encrypted database snapshot is published outside web root and authenticated');
sql(`app_pdo()->exec('CREATE DATABASE ${database} CHARACTER SET utf8mb4');`);created=true;
fs.writeFileSync(keyFile,JSON.stringify({backup_key:env.EOFFICE_BACKUP_KEY}),{mode:0o600});
const restored=cp.spawnSync('python',['scripts/restore-backup.py',result.path,'--key-file',keyFile,'--output',dir,'--database',database],{env,encoding:'utf8'});
assert.equal(restored.status,0,restored.stderr);const details=JSON.parse(restored.stdout);assert.equal(details.tables,result.tables);assert.equal(details.rows,result.rows);assert.equal(details.restored,true);
const refused=cp.spawnSync(php,['scripts/restore-database.php'],{env:{...env,DB_DATABASE:database},input:'',encoding:'utf8'});assert.notEqual(refused.status,0);assert.match(refused.stdout+refused.stderr,/Restore target must be empty/);
const unsafe=cp.spawnSync(php,['scripts/restore-database.php'],{env:{...env,DB_DATABASE:'production'},input:'',encoding:'utf8'});assert.notEqual(unsafe.status,0);assert.match(unsafe.stdout+unsafe.stderr,/isolated _test database/);
console.log('PASS concatenated gzip snapshot restores schema and every row into an empty isolated test database');
}finally{if(created)sql(`app_pdo()->exec('DROP DATABASE ${database}');`);fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(keyFile,{force:true});fs.unlinkSync(result.path);}
