const cp=require('node:child_process'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const base=process.env.TEST_DATABASE||'eoffice_security_test';if(!base.endsWith('_test'))throw Error('Isolated schema source required');
const database='drive_archive_'+crypto.randomBytes(6).toString('hex')+'_test',directory=path.join(os.tmpdir(),'opencode',database);
const port=Number(process.env.DRIVE_TEST_PORT||8108),url=`http://localhost:${port}`;
const env={...process.env,DB_DATABASE:database,APP_URL:url,EOFFICE_MOCK_SERVICES:'true',EOFFICE_DRIVE_ARCHIVE_ENABLED:'true',EOFFICE_DRIVE_HTTP_FIXTURE:'1',EOFFICE_BACKUP_KEY:crypto.randomBytes(32).toString('base64'),EOFFICE_STORAGE:path.join(directory,'file_document')};let created=false,server;const workers=[],lockers=new Set();
function run(code,db=base){const result=cp.spawnSync(php,['-r',code],{env:{...env,DB_DATABASE:db},encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);return result.stdout;}
async function test(){try{
    const client=cp.spawnSync(php,['tests/drive-client.php'],{env,encoding:'utf8'});process.stdout.write(client.stdout);assert.equal(client.status,0,client.stdout+client.stderr);
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
    // Use actual API source with only the external cloud transport substituted.
    // Two independent PHP workers exercise a paused cold-cache restore.
    for(let worker=1;worker<=2;worker++)workers.push(cp.spawn(php,['-S',`localhost:${port+worker}`,'tests/drive-read-router.php'],{env:{...env,APP_URL:`http://localhost:${port+worker}`},stdio:'ignore'}));
    for(let worker=1;worker<=2;worker++)for(let i=0;i<50;i++){try{await fetch(`http://localhost:${port+worker}/api/me.php`);break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}
    const mockCloud=path.join(directory,'mock-cloud'),waiting=path.join(mockCloud,'waiting'),releaseCloud=path.join(mockCloud,'release');
    const cold=()=>fetch(`http://localhost:${port+1}${route}&pause_cloud=1`,{headers:{Cookie:fixture.cookies.reader}});
    const local=()=>fetch(`http://localhost:${port+2}/api/view_file.php?Doc_Id=${fixture.doc}&File_Path=${fixture.local_name}`,{headers:{Cookie:fixture.cookies.reader}});
    // Avoid assimilating the pending Response promise while waiting for marker.
    async function pausedCold(){
        fs.rmSync(fixture.signed_cache,{force:true});fs.rmSync(waiting,{force:true});fs.rmSync(releaseCloud,{force:true});const pending=cold();
        for(let i=0;i<100;i++){if(fs.existsSync(waiting))return {pending};await new Promise(resolve=>setTimeout(resolve,25));}
        throw Error('Cold cloud read did not reach the paused transport');
    }
    let held=await pausedCold();
    const localResponse=await local();assert.equal(localResponse.status,200,await localResponse.text());
    assert.equal(localResponse.headers.get('X-Document-Revision'),fixture.local_revision);
    fs.writeFileSync(releaseCloud,'release');const recovered=await held.pending;assert.equal(recovered.status,200);assert.equal(recovered.headers.get('X-Document-Revision'),fixture.signed_revision);await recovered.arrayBuffer();
    console.log('PASS slow cold-cache Drive download does not hold the document mutex or block another local attachment');
    const requestsFile=path.join(mockCloud,'requests');
    const cloudRequests=()=>fs.existsSync(requestsFile)?fs.readFileSync(requestsFile,'utf8').trim().split('\n').length:0;
    const unusedCache=path.join(path.dirname(fixture.signed_cache),crypto.randomBytes(32).toString('hex')+'.plain');
    fs.writeFileSync(unusedCache,'unused old cache');
    const oldCacheTime=new Date(Date.now()-7200_000);fs.utimesSync(fixture.signed_cache,oldCacheTime,oldCacheTime);fs.utimesSync(unusedCache,oldCacheTime,oldCacheTime);
    const downloadsBeforeWarm=cloudRequests(),inodeBeforeWarm=fs.statSync(fixture.signed_cache).ino;
    const warmUrl=`http://localhost:${port+1}${route}`;
    const warm=await fetch(warmUrl,{headers:{Cookie:fixture.cookies.reader}});assert.equal(warm.status,200);assert.equal(warm.headers.get('X-Document-Revision'),fixture.signed_revision);await warm.arrayBuffer();
    assert.ok(fs.statSync(fixture.signed_cache).mtimeMs>Date.now()-5000);assert.equal(fs.statSync(fixture.signed_cache).ino,inodeBeforeWarm);
    const swept=Number(run("require 'config/drive-archive.php';putenv('EOFFICE_DRIVE_CACHE_TTL=3600');putenv('EOFFICE_DRIVE_CACHE_BYTES=268435456');echo app_drive_archive_cache_sweep();",database));
    assert.ok(swept>=1);assert.equal(fs.existsSync(unusedCache),false);assert.equal(fs.existsSync(fixture.signed_cache),true);
    const warmAgain=await fetch(warmUrl,{headers:{Cookie:fixture.cookies.reader}});assert.equal(warmAgain.status,200);assert.equal(warmAgain.headers.get('X-Document-Revision'),fixture.signed_revision);await warmAgain.arrayBuffer();assert.equal(cloudRequests(),downloadsBeforeWarm);
    console.log('PASS HTTP warm-cache read refreshes TTL; sweep retains the active inode, removes unused old cache and reread avoids cloud downloads');
    const missingTouch=JSON.parse(run(`require 'config/drive-archive.php';$path=app_drive_archive_directory('cache').'/'.str_repeat('e',64).'.plain';file_put_contents($path,'already-open');$handle=fopen($path,'rb');unlink($path);app_drive_archive_touch_cache($path,$handle);echo json_encode(['exists'=>is_file($path),'read'=>stream_get_contents($handle)]);fclose($handle);`,database));
    assert.equal(missingTouch.exists,false);assert.equal(missingTouch.read,'already-open');
    console.log('PASS cache activity touch cannot recreate an empty cache file after a concurrent sweep');
    const replacedTouch=JSON.parse(run(`require 'config/drive-archive.php';$path=app_drive_archive_directory('cache').'/'.str_repeat('c',64).'.plain';file_put_contents($path,'old-inode');rename($path,$path.'.opened');$handle=fopen($path.'.opened','rb');file_put_contents($path,'replacement-inode');$old=time()-7200;touch($path,$old);clearstatcache(true,$path);app_drive_archive_touch_cache($path,$handle);clearstatcache(true,$path);echo json_encode(['mtime'=>filemtime($path),'expected'=>$old,'bytes'=>file_get_contents($path),'opened'=>stream_get_contents($handle)]);fclose($handle);unlink($path);unlink($path.'.opened');`,database));
    assert.equal(replacedTouch.mtime,replacedTouch.expected);assert.equal(replacedTouch.bytes,'replacement-inode');assert.equal(replacedTouch.opened,'old-inode');
    console.log('PASS a reader holding an old inode cannot refresh a replacement cache file');
    const cacheLocker=cp.spawn(php,['tests/document-lock-helper.php',path.basename(fixture.signed_cache),'cache'],{env,stdio:['pipe','pipe','pipe']});lockers.add(cacheLocker);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Cache lock fixture unavailable')),5000);cacheLocker.stdout.on('data',bytes=>{if(String(bytes).includes('LOCKED')){clearTimeout(timer);resolve();}});cacheLocker.on('error',reject);});
    try {
        const nonblocking=await fetch(warmUrl,{headers:{Cookie:fixture.cookies.reader},signal:AbortSignal.timeout(3000)});
        assert.equal(nonblocking.status,200);assert.equal(nonblocking.headers.get('X-Document-Revision'),fixture.signed_revision);await nonblocking.arrayBuffer();
    }finally{const done=new Promise(resolve=>cacheLocker.once('exit',resolve));cacheLocker.stdin.end('release\n');await done;lockers.delete(cacheLocker);}
    console.log('PASS a cache-maintenance mutex held by another worker does not block an authenticated warm-cache HTTP read');
    const cacheActivity=cp.spawnSync(php,['tests/cache-activity.php'],{env,encoding:'utf8'});assert.equal(cacheActivity.status,0,cacheActivity.stdout+cacheActivity.stderr);process.stdout.write(cacheActivity.stdout);
    held=await pausedCold();
    const replacement=Buffer.from('%PDF-1.4\n% newer committed signature during cloud read\n');
    run(`require 'config/drive-archive.php';$lock=app_document_file_lock(${fixture.doc});$pdo=app_document_transaction();$pdo->query('SELECT Doc_Id FROM t_document WHERE Doc_Id=${fixture.doc} FOR UPDATE');$file=app_storage('e-sign','2566','signed_${fixture.doc}_${fixture.name}');file_put_contents($file,base64_decode('${replacement.toString('base64')}'));$pdo->commit();$lock->release();`,database);
    fs.writeFileSync(releaseCloud,'release');const replaced=await held.pending;assert.equal(replaced.status,200);assert.deepEqual(Buffer.from(await replaced.arrayBuffer()),replacement);assert.equal(replaced.headers.get('X-Document-Revision'),crypto.createHash('sha256').update(replacement).digest('hex'));
    run(`require 'config/drive-archive.php';$lock=app_document_file_lock(${fixture.doc});unlink(app_storage('e-sign','2566','signed_${fixture.doc}_${fixture.name}'));$lock->release();`,database);
    console.log('PASS new local signature during cloud download supersedes the prepared old cache after revalidation');
    held=await pausedCold();
    const staleVersion=JSON.parse(run(`require 'config/drive-archive.php';echo json_encode(app_drive_archive_current(${fixture.doc},'${fixture.name}','signed'));`,database));
    const changedId=crypto.randomBytes(32).toString('hex'),changedRevision=crypto.randomBytes(32).toString('hex');
    run(`require 'config/bootstrap.php';$pdo=app_pdo();$pdo->exec("INSERT INTO eoffice_drive_versions (id,doc_id,file_name,variant,revision,bytes,key_id,parts,status) SELECT '${changedId}',doc_id,file_name,variant,'${changedRevision}',bytes,key_id,parts,status FROM eoffice_drive_versions WHERE id='${staleVersion.id}'");$pdo->exec("UPDATE eoffice_drive_files SET version_id='${changedId}' WHERE doc_id=${fixture.doc} AND variant='signed'");`,database);
    fs.writeFileSync(releaseCloud,'release');const stale=await held.pending;assert.equal(stale.status,409);await stale.arrayBuffer();
    run(`require 'config/bootstrap.php';$pdo=app_pdo();$pdo->exec("UPDATE eoffice_drive_files SET version_id='${staleVersion.id}' WHERE doc_id=${fixture.doc} AND variant='signed'");$pdo->exec("DELETE FROM eoffice_drive_versions WHERE id='${changedId}'");`,database);
    console.log('PASS a changed cloud-only registry revision rejects the prepared stale download instead of fetching under the mutex');
    held=await pausedCold();
    run(`require 'config/bootstrap.php';app_pdo()->exec('DELETE FROM t_access_rights WHERE User_Id=${fixture.users.reader} AND Doc_Id=${fixture.doc}');`,database);
    fs.writeFileSync(releaseCloud,'release');const revoked=await held.pending;assert.equal(revoked.status,403);await revoked.arrayBuffer();
    run(`require 'config/bootstrap.php';app_pdo()->exec("INSERT INTO t_access_rights (User_Id,Doc_Id,Date,alert_to) VALUES (${fixture.users.reader},${fixture.doc},'',0)");`,database);
    console.log('PASS reader revocation during cloud download is checked again before plaintext is sent');
    const locker=cp.spawn(php,['tests/document-lock-helper.php',String(fixture.doc)],{env,stdio:['pipe','pipe','pipe']});lockers.add(locker);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('File lock fixture unavailable')),5000);locker.stdout.on('data',bytes=>{if(String(bytes).includes('LOCKED')){clearTimeout(timer);resolve();}});locker.on('error',reject);});
    try {const busy=await local();assert.equal(busy.status,503);assert.equal(busy.headers.get('Retry-After'),'2');assert.match((await busy.json()).message,/กรุณาลองใหม่/);}
    finally {const done=new Promise(resolve=>locker.once('exit',resolve));locker.stdin.end('release\n');await done;lockers.delete(locker);}
    console.log('PASS document mutex timeout returns retryable HTTP 503 with Retry-After instead of HTTP 500');
    // Original may still be local even though the current signed version is
    // Drive-only: signing must compare against signed cloud bytes, not original.
    const form=new FormData();form.append('Doc_Id',String(fixture.doc));form.append('year','2566');form.append('revision',fixture.signed_revision);form.append('file',new Blob(['%PDF-1.4\n% HTTP signed fixture\n'],{type:'application/pdf'}),fixture.name);
    const saved=await fetch(url+'/e-sign/upload_pdf.php',{method:'POST',headers:{Cookie:fixture.cookies.reader},body:form});assert.equal(saved.status,200,await saved.text());
    const fresh=await request(route,'reader');assert.equal(fresh.status,200);assert.notEqual(fresh.headers.get('X-Document-Revision'),fixture.signed_revision);await fresh.arrayBuffer();
    const count=Number(run(`require 'config/bootstrap.php';echo app_pdo()->query("SELECT COUNT(*) FROM eoffice_drive_versions WHERE variant='signed' AND status='pending'")->fetchColumn();`,database));assert.equal(count,1);
    run(`require 'config/drive-archive.php';$lock=app_document_file_lock(${fixture.doc});unlink(app_storage('e-sign','2566','signed_${fixture.doc}_${fixture.name}'));$lock->release();`,database);
    const pinned=await request(route,'reader');assert.equal(pinned.status,200);assert.equal(pinned.headers.get('X-Document-Revision'),fresh.headers.get('X-Document-Revision'));await pinned.arrayBuffer();
    console.log('PASS pending cloud revisions remain readable from pinned spool bytes without requiring a verified remote restore');
    run(`require 'config/bootstrap.php';app_pdo()->exec('DELETE FROM t_access_rights WHERE User_Id=${fixture.users.reader} AND Doc_Id=${fixture.doc}');`,database);
    assert.equal((await request(route,'reader')).status,403);
    console.log('PASS signing a Drive-only PDF creates a queued immutable revision and revoked readers lose access');
    run("require 'config/order-ai.php';require 'config/order-email-schema.php';app_order_email_migrate(app_pdo());",database);
    const scheduled=cp.spawnSync(php,['scripts/scheduled-jobs.php'],{env:{...env,EOFFICE_DRIVE_ARCHIVE_ENABLED:'false'},encoding:'utf8'});assert.equal(scheduled.status,0,scheduled.stdout+scheduled.stderr);assert.match(scheduled.stdout,/0 order jobs processed/);assert.ok(!scheduled.stdout.includes('drive_worker'));
    console.log('PASS existing order scheduler remains operational while cloud feature is disabled');
    const bridge=cp.spawnSync(process.execPath,['tests/drive-appscript.cjs'],{encoding:'utf8'});process.stdout.write(bridge.stdout);assert.equal(bridge.status,0,bridge.stdout+bridge.stderr);
    const unified=cp.spawnSync(process.execPath,['tests/drive-unified.cjs'],{encoding:'utf8'});process.stdout.write(unified.stdout);assert.equal(unified.status,0,unified.stdout+unified.stderr);
}finally{for(const locker of lockers)locker.kill();for(const worker of workers)worker.kill();if(server){server.kill();await new Promise(resolve=>server.once('exit',resolve));}if(created)run(`require 'config/bootstrap.php';app_pdo()->exec('DROP DATABASE ${database}');`);fs.rmSync(directory,{recursive:true,force:true});}}
test().catch(error=>{console.error(error);process.exitCode=1;});
