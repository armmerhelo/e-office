const cp=require('node:child_process'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const base=process.env.TEST_DATABASE||'eoffice_security_test';if(!base.endsWith('_test'))throw Error('Isolated schema source required');
const database='drive_archive_'+crypto.randomBytes(6).toString('hex')+'_test',directory=path.join(os.tmpdir(),'opencode',database);
const port=Number(process.env.DRIVE_TEST_PORT||8108),url=`http://localhost:${port}`;
const env={...process.env,DB_DATABASE:database,APP_URL:url,EOFFICE_MOCK_SERVICES:'true',EOFFICE_DRIVE_ARCHIVE_ENABLED:'true',EOFFICE_DRIVE_HTTP_FIXTURE:'1',EOFFICE_BACKUP_KEY:crypto.randomBytes(32).toString('base64'),EOFFICE_STORAGE:path.join(directory,'file_document')};let created=false,server;
function run(code,db=base){const result=cp.spawnSync(php,['-r',code],{env:{...env,DB_DATABASE:db},encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);return result.stdout;}
async function test(){try{
    run(`require 'config/bootstrap.php';$pdo=app_pdo();$pdo->exec('CREATE DATABASE ${database} CHARACTER SET utf8mb4');`);created=true;
    // Clone schema only; no personnel/document data is copied into this fixture.
    const setup=`require 'config/bootstrap.php';$pdo=app_pdo();$pdo->exec('SET FOREIGN_KEY_CHECKS=0');$tables=$pdo->query('SHOW FULL TABLES')->fetchAll(PDO::FETCH_NUM);foreach($tables as [$table,$type]){if($type!=='BASE TABLE'||str_starts_with($table,'eoffice_drive_'))continue;$quote=chr(96);$sql=$pdo->query('SHOW CREATE TABLE '.$quote.$table.$quote)->fetch(PDO::FETCH_NUM)[1];$pdo->exec('USE ${database}');$pdo->exec($sql);$pdo->exec('USE ${base}');}`;
    run(setup);
    fs.mkdirSync(directory,{recursive:true});
    const result=cp.spawnSync(php,['tests/drive-archive.php'],{env,encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);process.stdout.write(result.stdout.trim().split(/\r?\n/).slice(0,-1).join('\n')+'\n');
    const fixture=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    server=cp.spawn(php,['-S',`localhost:${port}`,'scripts/router.php'],{env,stdio:'ignore'});
    for(let i=0;i<50;i++){try{await fetch(url+'/api/me.php');break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
    const route='/api/view_file.php?Doc_Id='+fixture.doc+'&File_Path='+fixture.name+'&Type=signed&Year=2566';
    async function request(path,role,headers={}){return fetch(url+path,{headers:{...(role?{Cookie:fixture.cookies[role]}:{}),...headers}});}
    assert.equal((await request(route)).status,401);assert.equal((await request(route,'outsider')).status,403);
    const viewed=await request(route,'reader');assert.equal(viewed.status,200);assert.equal(viewed.headers.get('X-Document-Revision'),fixture.signed_revision);await viewed.arrayBuffer();
    const partial=await request(route,'reader',{Range:'bytes=0-7'});assert.equal(partial.status,206);assert.equal(await partial.text(),'%PDF-1.4');assert.match(partial.headers.get('Content-Range'),/^bytes 0-7\//);
    assert.equal((await request(route,'reader',{Range:'bytes=999999999-'})).status,416);
    assert.equal((await request('/api/drive_archive_status.php')).status,401);assert.equal((await request('/api/drive_archive_status.php','reader')).status,403);assert.equal((await request('/api/drive_archive_status.php','admin')).status,200);
    console.log('PASS private cloud-only HTTP reads, revision headers, PDF ranges and Admin-only archive status');
    // Original may still be local even though the current signed version is
    // Drive-only: signing must compare against signed cloud bytes, not original.
    fs.writeFileSync(path.join(directory,'file_document','original','2566',fixture.name),'%PDF-1.4\n% old original\n');
    const form=new FormData();form.append('Doc_Id',String(fixture.doc));form.append('year','2566');form.append('revision',fixture.signed_revision);form.append('file',new Blob(['%PDF-1.4\n% HTTP signed fixture\n'],{type:'application/pdf'}),fixture.name);
    const saved=await fetch(url+'/e-sign/upload_pdf.php',{method:'POST',headers:{Cookie:fixture.cookies.reader},body:form});assert.equal(saved.status,200,await saved.text());
    const fresh=await request(route,'reader');assert.equal(fresh.status,200);assert.notEqual(fresh.headers.get('X-Document-Revision'),fixture.signed_revision);await fresh.arrayBuffer();
    const count=Number(run(`require 'config/bootstrap.php';echo app_pdo()->query("SELECT COUNT(*) FROM eoffice_drive_versions WHERE variant='signed' AND status='pending'")->fetchColumn();`,database));assert.equal(count,1);
    run(`require 'config/bootstrap.php';app_pdo()->exec('DELETE FROM t_access_rights WHERE User_Id=${fixture.users.reader} AND Doc_Id=${fixture.doc}');`,database);
    assert.equal((await request(route,'reader')).status,403);
    console.log('PASS signing a Drive-only PDF creates a queued immutable revision and revoked readers lose access');
    const bridge=cp.spawnSync(process.execPath,['tests/drive-appscript.cjs'],{encoding:'utf8'});process.stdout.write(bridge.stdout);assert.equal(bridge.status,0,bridge.stdout+bridge.stderr);
}finally{if(server){server.kill();await new Promise(resolve=>server.once('exit',resolve));}if(created)run(`require 'config/bootstrap.php';app_pdo()->exec('DROP DATABASE ${database}');`);fs.rmSync(directory,{recursive:true,force:true});}}
test().catch(error=>{console.error(error);process.exitCode=1;});
