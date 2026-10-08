const assert=require('node:assert/strict'),cp=require('node:child_process'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const tag=crypto.randomBytes(6).toString('hex'),source='backup_source_'+tag+'_test',target='backup_target_'+tag+'_test';
const folder=path.join(os.tmpdir(),'opencode','backup-cases-'+tag),vault=folder+'.private.json';
const env={...process.env,DB_DATABASE:source,EOFFICE_BACKUP_KEY:crypto.randomBytes(32).toString('base64'),EOFFICE_STORAGE:path.join(os.tmpdir(),'opencode','eoffice-test-storage')};
const created=[];let archive;
function run(file,args=[],extra={},input){const r=cp.spawnSync(php,[file,...args],{env:{...env,...extra},input,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;}
function code(sql,db=source){return run('-r',[`require 'config/bootstrap.php';${sql}`],{DB_DATABASE:db});}
try{
    for(const database of [source,target]){code(`app_pdo()->exec('CREATE DATABASE ${database} CHARACTER SET utf8mb4');`,'mysql');created.push(database);}
    code(`$pdo=app_pdo();$pdo->exec("SET SESSION time_zone='+07:00'");$pdo->exec("SET SESSION sql_mode='NO_AUTO_VALUE_ON_ZERO'");$pdo->exec('CREATE TABLE fixture (id INT AUTO_INCREMENT PRIMARY KEY, value INT, payload LONGBLOB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, calculated INT GENERATED ALWAYS AS (value+1) STORED) ENGINE=InnoDB');$pdo->exec("INSERT INTO fixture (id,value,payload,created_at) VALUES (0,41,UNHEX('00ff8081c328'), '2020-01-02 03:04:05'),(7,9,NULL,'2021-02-03 04:05:06')");`);
    const backup=JSON.parse(run('scripts/backup.php'));archive=backup.path;
    assert.equal(backup.format_version,2);
    fs.writeFileSync(vault,JSON.stringify({backup_key:env.EOFFICE_BACKUP_KEY}),{mode:0o600});
    const restored=cp.spawnSync('python',['scripts/restore-backup.py',archive,'--key-file',vault,'--output',folder,'--database',target],{env,encoding:'utf8'});
    assert.equal(restored.status,0,restored.stderr);assert.equal(JSON.parse(restored.stdout).rows,2);
    const rows=JSON.parse(code("app_pdo()->exec(\"SET SESSION time_zone='+07:00'\");echo json_encode(app_pdo()->query('SELECT id,value,HEX(payload) payload,created_at,calculated FROM fixture ORDER BY id')->fetchAll());",target));
    assert.deepEqual(rows.map(row=>({...row,id:Number(row.id),value:Number(row.value),calculated:Number(row.calculated)})),[
        {id:0,value:41,payload:'00FF8081C328',created_at:'2020-01-02 03:04:05',calculated:42},
        {id:7,value:9,payload:null,created_at:'2021-02-03 04:05:06',calculated:10}
    ]);
    console.log('PASS binary bytes, original default timestamps, generated columns and zero auto-increment IDs survive recovery');
    code('$pdo=app_pdo();$pdo->exec("CREATE TABLE rejected (id INT) ENGINE=MyISAM");');
    const refused=cp.spawnSync(php,['scripts/backup.php'],{env,encoding:'utf8'});assert.notEqual(refused.status,0);assert.match(refused.stdout+refused.stderr,/requires InnoDB/);
    assert.equal(Number(code("echo app_pdo()->query(\"SELECT IS_FREE_LOCK('eoffice:database-backup')\")->fetchColumn();")),1);
    console.log('PASS unsupported table engine fails safely and releases the backup lock');
}finally{
    for(const database of created)code(`app_pdo()->exec('DROP DATABASE ${database}');`,'mysql');
    if(archive)fs.rmSync(archive,{force:true});fs.rmSync(vault,{force:true});fs.rmSync(folder,{recursive:true,force:true});
}
