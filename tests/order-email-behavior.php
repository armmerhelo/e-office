<?php
// Invoked only by the disposable mock fixture.
$passed=0;
function order_verify(bool $ok,string $name): void {global $passed;if(!$ok)throw new RuntimeException('FAIL '.$name);$passed++;echo 'PASS '.$name.PHP_EOL;}
$cipher=app_order_encrypt('synthetic-credential');
order_verify(app_order_decrypt($cipher)==='synthetic-credential','authenticated encryption round-trips the saved key');
$bytes=base64_decode($cipher);$bytes[15]=chr(ord($bytes[15])^1);$tamperRejected=false;
try{app_order_decrypt(base64_encode($bytes));}catch(AppOrderAIException $e){$tamperRejected=$e->reason==='settings_decryption_failed';}
order_verify($tamperRejected,'tampered encrypted credentials are rejected');
function order_fixture_doc(array $names): array {
    $pdo=app_pdo();$pdo->prepare("INSERT INTO t_document (Doc_Number,Doc_Name,Doc_Type,Doc_Year,User_Id,Doc_File_Link) VALUES (?,'Synthetic order','External','2569',1,'')")->execute(['BEHAVIOR-'.bin2hex(random_bytes(8))]);$id=(int)$pdo->lastInsertId();
    $pdo->prepare('UPDATE t_document SET Doc_File_Link=? WHERE Doc_Id=?')->execute([(string)$id,$id]);
    $pdo->prepare("INSERT INTO eoffice_order_jobs (doc_id,source,status) VALUES (?,'automatic','queued')")->execute([$id]);$job=app_order_job($id);
    $dir=app_storage('original','2569');if(!is_dir($dir))mkdir($dir,0700,true);
    foreach($names as $name){file_put_contents($dir.$name,"%PDF-1.4\n% synthetic order\n%%EOF\n");$pdo->prepare('INSERT INTO t_document_upload (Doc_Upload_Detail,Doc_Upload_Path,Doc_File_Link,User_Id) VALUES (?,?,?,1)')->execute([$name,$name,(string)$id]);}
    return $job;
}
function order_fixture_recipients(array $job): array {$q=app_pdo()->prepare('SELECT * FROM eoffice_order_recipients WHERE job_id=? ORDER BY id');$q->execute([$job['id']]);return $q->fetchAll();}
$pdo->exec("UPDATE eoffice_order_settings SET enabled=1,api_key_cipher=NULL,model='gemini-test' WHERE id=1");
// Hide existing HTTP-test jobs from this focused behavior run.
$pdo->exec("UPDATE eoffice_order_jobs SET status='cancelled'");
$q=$pdo->query("SELECT User_Id FROM t_user WHERE User_Name='alice'");$alice=(int)$q->fetchColumn();$bob=(int)$pdo->query("SELECT User_Id FROM t_user WHERE User_Name='bob'")->fetchColumn();$invalid=(int)$pdo->query("SELECT User_Id FROM t_user WHERE User_Name='invalid'")->fetchColumn();
$job=order_fixture_doc(['behavior-a.pdf','behavior-b.pdf']);$ai=0;$mails=[];
$transports=['ai'=>static function($path)use(&$ai,$alice,$bob,$invalid){$ai++;return basename($path)==='behavior-a.pdf'?[$alice,$invalid,999999]:[$alice,$bob];},'mail'=>static function($subject,$email,$body)use(&$mails){$mails[]=[$email,$body];return true;}];
app_order_worker(90,$transports);$recipients=order_fixture_recipients($job);
order_verify($ai===2&&count($mails)===2,'all PDFs analyzed and duplicate recipient gets one email');
order_verify(str_contains($mails[0][1],'behavior-a.pdf')&&str_contains($mails[0][1],'behavior-b.pdf'),'one email includes links to every PDF');
order_verify(count($recipients)===3&&count(array_filter($recipients,static fn($r)=>$r['status']==='skipped'))===1,'unknown IDs ignored and invalid email visible as skipped');
order_verify(app_order_job((int)$job['doc_id'])['status']==='partial','invalid recipient is not reported as complete success');
app_order_worker(90,$transports);order_verify(count($mails)===2&&$ai===2,'completed or partial jobs do not repeat automatically');
$pdo->prepare("UPDATE eoffice_order_jobs SET status='queued' WHERE id=?")->execute([$job['id']]);app_order_worker(90,$transports);order_verify(count($mails)===2,'queued again still preserves accepted SMTP deliveries');
$job2=order_fixture_doc(['behavior-retry-a.pdf','behavior-retry-b.pdf']);$calls=[];$sent=0;
$transports2=['ai'=>static function($path)use(&$calls,$alice){$name=basename($path);$calls[$name]=($calls[$name]??0)+1;if($name==='behavior-retry-b.pdf'&&$calls[$name]===1)throw new AppOrderAIException('ai_temporary_failure',true,120);return [$alice];},'mail'=>static function()use(&$sent){$sent++;return true;}];
app_order_worker(90,$transports2);order_verify($sent===0,'no email sent until every PDF analysis succeeds');
app_order_worker(90,$transports2);order_verify($calls['behavior-retry-b.pdf']===1,'AI backoff prevents immediate retry');
$pdo->prepare('UPDATE eoffice_order_files SET retry_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE job_id=?')->execute([$job2['id']]);app_order_worker(90,$transports2);
order_verify($calls['behavior-retry-a.pdf']===1&&$calls['behavior-retry-b.pdf']===2&&$sent===1,'AI retry reuses successful file results');
$job3=order_fixture_doc(['behavior-uncertain.pdf']);$smtp=0;
$transports3=['ai'=>static fn()=>[$alice],'mail'=>static function()use(&$smtp){$smtp++;throw new RuntimeException('Simulated ambiguous SMTP timeout');}];
app_order_worker(90,$transports3);$r=order_fixture_recipients($job3);order_verify($r[0]['status']==='uncertain','ambiguous SMTP is persisted for manual review');
$pdo->prepare("UPDATE eoffice_order_jobs SET status='queued' WHERE id=?")->execute([$job3['id']]);app_order_worker(90,$transports3);order_verify($smtp===1,'ambiguous email is not automatically retried');
$job4=order_fixture_doc(['behavior-crash.pdf']);app_order_sync_files($job4,app_order_pdf_files(app_order_document((int)$job4['doc_id'])));
$pdo->prepare("UPDATE eoffice_order_files SET status='success',targets=? WHERE job_id=?")->execute([json_encode([$alice]),$job4['id']]);app_order_build_recipients($job4);
$pdo->prepare("UPDATE eoffice_order_recipients SET status='sending',attempts=1 WHERE job_id=?")->execute([$job4['id']]);$crashMail=0;
app_order_worker(90,['ai'=>static fn()=>[],'mail'=>static function()use(&$crashMail){$crashMail++;return true;}]);order_verify($crashMail===0&&order_fixture_recipients($job4)[0]['status']==='uncertain','crashed send marker prevents duplicate SMTP');
$job5=order_fixture_doc(['behavior-change.pdf']);app_order_sync_files($job5,app_order_pdf_files(app_order_document((int)$job5['doc_id'])));
$pdo->prepare("UPDATE eoffice_order_files SET status='success',targets=? WHERE job_id=?")->execute([json_encode([$alice]),$job5['id']]);app_order_build_recipients($job5);$pdo->prepare("UPDATE eoffice_order_recipients SET status='success' WHERE job_id=?")->execute([$job5['id']]);
file_put_contents(app_storage('original','2569','behavior-change.pdf'),"%PDF-1.4\n% replacement\n%%EOF\n");app_order_worker(90,['ai'=>static fn()=>[$alice],'mail'=>static fn()=>true]);
order_verify(app_order_job((int)$job5['doc_id'])['error_code']==='files_changed','replaced PDF after delivery requires explicit reanalysis');
$job6=order_fixture_doc(['behavior-deleted.pdf']);$pdo->prepare("UPDATE t_document SET Is_Delete='delete' WHERE Doc_Id=?")->execute([$job6['doc_id']]);app_order_worker(90,['ai'=>static fn()=>[$alice],'mail'=>static fn()=>true]);order_verify(app_order_job((int)$job6['doc_id'])['status']==='cancelled','deleted order never sent');
$job7=order_fixture_doc(['behavior-no-targets.pdf']);app_order_worker(90,['ai'=>static fn()=>[],'mail'=>static fn()=>true]);order_verify(app_order_job((int)$job7['doc_id'])['error_code']==='no_recipients','no recipients is review rather than success');
$job8=order_fixture_doc(['behavior-legacy.pdf']);$pdo->prepare("INSERT INTO email_logs (doc_id,file_name,recipient_name,recipient_email,delivery_status) VALUES (?,?,?,'alice@example.test','success')")->execute([(string)$job8['doc_id'],'behavior-legacy.pdf','alice']);$legacyMail=0;
app_order_worker(90,['ai'=>static fn()=>[$alice],'mail'=>static function()use(&$legacyMail){$legacyMail++;return true;}]);order_verify($legacyMail===0,'existing successful legacy logs prevent automatic duplicates');
$pdo->exec('UPDATE eoffice_order_settings SET enabled=0');$job9=order_fixture_doc(['behavior-paused.pdf']);order_verify(app_order_worker(90,$transports)===0&&app_order_job((int)$job9['doc_id'])['status']==='queued','paused worker retains queued work');
// A second connection holding the worker lock simulates an overlapping cron.
$other=new PDO("mysql:host={$settings['host']};port={$settings['port']};dbname={$settings['database']};charset=utf8mb4",$settings['username'],$settings['password']);$other->query("SELECT GET_LOCK('eoffice:orders',0)");
order_verify(app_order_worker(90,$transports)===0,'overlapping cron does not run a second worker');$other->query("SELECT RELEASE_LOCK('eoffice:orders')");
$pdo->exec("UPDATE eoffice_order_jobs SET status='cancelled'");$pdo->exec('UPDATE eoffice_order_settings SET enabled=1');
$firstJob=order_fixture_doc(['behavior-batch-first.pdf']);$secondJob=order_fixture_doc(['behavior-batch-cancelled.pdf']);$batchMail=0;
app_order_worker(90,['ai'=>static fn()=>[$alice],'mail'=>static function()use(&$batchMail,$secondJob){$batchMail++;app_pdo()->prepare("UPDATE eoffice_order_jobs SET status='cancelled' WHERE id=?")->execute([$secondJob['id']]);return true;}]);
order_verify($batchMail===1&&app_order_job((int)$secondJob['doc_id'])['status']==='cancelled','worker rechecks cancellation after selecting a batch');
$pdo->exec("UPDATE eoffice_order_jobs SET status='cancelled'");
$job=order_fixture_doc(['behavior-race-before.pdf']);$sent=0;
app_order_worker(90,['ai'=>static function()use($pdo,$job,$alice){
    $pdo->beginTransaction();$pdo->prepare('SELECT Doc_Id FROM t_document WHERE Doc_Id=? FOR UPDATE')->execute([$job['doc_id']]);
    file_put_contents(app_storage('original','2569','behavior-race-after.pdf'),"%PDF-1.4\n% replacement fixture\n%%EOF\n");
    $pdo->prepare('UPDATE t_document_upload SET Doc_Upload_Path=? WHERE Doc_File_Link=?')->execute(['behavior-race-after.pdf',(string)$job['doc_id']]);
    app_order_saved((int)$job['doc_id'],false,'External',app_order_settings());$pdo->commit();unlink(app_storage('original','2569','behavior-race-before.pdf'));return [$alice];
},'mail'=>static function()use(&$sent){$sent++;return true;}]);
order_verify(app_order_job((int)$job['doc_id'])['status']==='analyzing'&&$sent===0,'PDF replacement during AI requeues before any mail is sent');
app_order_worker(90,['ai'=>static fn()=>[$bob],'mail'=>static function($subject,$email)use(&$sent){order_verify($email==='bob@example.test','replacement targets supersede the old PDF targets');$sent++;return true;}]);
order_verify($sent===1&&app_order_job((int)$job['doc_id'])['status']==='success','replacement PDF completes automatically on next cron');
$job=order_fixture_doc(['behavior-race-add.pdf']);$sent=0;$added=false;
app_order_worker(90,['ai'=>static function()use($pdo,$job,$alice,&$added){
    if(!$added){$added=true;file_put_contents(app_storage('original','2569','behavior-race-extra.pdf'),"%PDF-1.4\n% extra fixture\n%%EOF\n");$pdo->prepare('INSERT INTO t_document_upload (Doc_Upload_Detail,Doc_Upload_Path,Doc_File_Link,User_Id) VALUES (?,?,?,1)')->execute(['Extra','behavior-race-extra.pdf',(string)$job['doc_id']]);}return [$alice];
},'mail'=>static function()use(&$sent){$sent++;return true;}]);
order_verify($sent===0&&app_order_job((int)$job['doc_id'])['status']==='analyzing','adding a PDF during AI cannot send an incomplete snapshot');
app_order_worker(90,['ai'=>static fn()=>[$alice,$bob],'mail'=>static function()use(&$sent){$sent++;return true;}]);
order_verify($sent===2&&app_order_job((int)$job['doc_id'])['status']==='success','added PDF merges automatically on next cron');
// A selected recipient may have no document grant when selected manually or by
// AI. Only the document-source policy requires a current direct grant.
$job=order_fixture_doc(['behavior-policies.pdf']);$user=$pdo->query("SELECT User_Id,User_Name,User_Email FROM t_user WHERE User_Name='alice'")->fetch();app_order_add_recipient($job,$user,'manual');$sent=0;
app_order_worker(90,['ai'=>static fn()=>[$bob],'mail'=>static function()use(&$sent){$sent++;return true;}]);
order_verify($sent===2,'manual and AI recipients remain deliverable without document grants');

// Cold verified Drive archive: no local/spool/quarantine/cache bytes. The mock
// download asserts that remote restoration precedes the document transaction.
require __DIR__.'/../config/drive-archive-schema.php';app_drive_archive_migrate($pdo);
putenv('EOFFICE_DRIVE_ARCHIVE_ENABLED=true');putenv('EOFFICE_BACKUP_KEY='.base64_encode(random_bytes(32)));
$job=order_fixture_doc(['behavior-cloud.pdf']);$path=app_storage('original','2569','behavior-cloud.pdf');$plain=file_get_contents($path);$key=app_drive_archive_key();$revision=hash('sha256',$plain);$versionId=app_drive_archive_id((int)$job['doc_id'],'behavior-cloud.pdf','original',$revision);
$encrypted=app_settings()['storage'].'/synthetic-cloud.ebak';$writer=new AppBackupWriter($encrypted,$key);$writer->write($plain);$meta=$writer->finish();$bytes=file_get_contents($encrypted);unlink($encrypted);
$parts=[['offset'=>0,'bytes'=>$meta['bytes'],'sha256'=>$meta['sha256'],'object'=>hash('sha256',$bytes)]];
$pdo->prepare("INSERT INTO eoffice_drive_versions (id,doc_id,file_name,variant,revision,bytes,key_id,parts,status) VALUES (?,?,?,'original',?,?,?,?,'verified')")->execute([$versionId,$job['doc_id'],'behavior-cloud.pdf',$revision,strlen($plain),substr(hash('sha256',$key),0,16),json_encode($parts)]);
$pdo->prepare("INSERT INTO eoffice_drive_files VALUES (?,?,'original',?)")->execute([$job['doc_id'],'behavior-cloud.pdf',$versionId]);unlink($path);
$downloads=0;$sent=0;
app_order_worker(90,['archive_get'=>static function()use($pdo,$bytes,&$downloads){order_verify(!$pdo->inTransaction(),'cold archive is downloaded without database locks');$downloads++;return $bytes;},'ai'=>static fn()=>[$alice],'mail'=>static function()use(&$sent){$sent++;return true;}]);
order_verify($downloads===1&&$sent===1&&app_order_job((int)$job['doc_id'])['status']==='success','Drive-only order analyzes and delivers from a cold cache');
order_verify(!is_file($path)&&file_get_contents(app_drive_archive_directory('cache').'/'.$versionId.'.plain')===$plain,'recovered cache preserves bytes without recreating the original storage file');
$pdo->prepare("UPDATE eoffice_order_jobs SET status='queued' WHERE id=?")->execute([$job['id']]);app_order_worker(90,['archive_get'=>static function(){throw new RuntimeException('Warm cache must not download');},'ai'=>static fn()=>[],'mail'=>static function()use(&$sent){$sent++;return true;}]);
order_verify($sent===1,'warm archived order does not download or resend accepted email');
$job=order_fixture_doc(['behavior-cloud-race.pdf']);$path=app_storage('original','2569','behavior-cloud-race.pdf');$plain=file_get_contents($path);$revision=hash('sha256',$plain);$versionId=app_drive_archive_id((int)$job['doc_id'],'behavior-cloud-race.pdf','original',$revision);
// Same synthetic plaintext permits reuse of the authenticated mock object.
$pdo->prepare("INSERT INTO eoffice_drive_versions (id,doc_id,file_name,variant,revision,bytes,key_id,parts,status) VALUES (?,?,?,'original',?,?,?,?,'verified')")->execute([$versionId,$job['doc_id'],'behavior-cloud-race.pdf',$revision,strlen($plain),substr(hash('sha256',$key),0,16),json_encode($parts)]);
$pdo->prepare("INSERT INTO eoffice_drive_files VALUES (?,?,'original',?)")->execute([$job['doc_id'],'behavior-cloud-race.pdf',$versionId]);unlink($path);$downloads=0;
$snapshot=app_order_snapshot($job,static function()use($pdo,$job,$bytes,&$downloads){
    $downloads++;$pdo->beginTransaction();$pdo->prepare('SELECT Doc_Id FROM t_document WHERE Doc_Id=? FOR UPDATE')->execute([$job['doc_id']]);
    file_put_contents(app_storage('original','2569','behavior-cloud-replacement.pdf'),"%PDF-1.4\n% changed during restore\n%%EOF\n");
    $pdo->prepare('UPDATE t_document_upload SET Doc_Upload_Path=? WHERE Doc_File_Link=?')->execute(['behavior-cloud-replacement.pdf',(string)$job['doc_id']]);
    app_order_saved((int)$job['doc_id'],false,'External',app_order_settings());$pdo->commit();return $bytes;
});
order_verify($downloads===1&&array_keys($snapshot['files'])===['behavior-cloud-replacement.pdf'],'document changed during cloud restoration is revalidated instead of using stale cache');

function order_cloud_fixture(string $name): array {
    global $pdo;
    $job=order_fixture_doc([$name]);$path=app_storage('original','2569',$name);$plain=file_get_contents($path);$key=app_drive_archive_key();$hash=hash('sha256',$plain);$id=app_drive_archive_id((int)$job['doc_id'],$name,'original',$hash);
    $encrypted=app_settings()['storage'].'/'.bin2hex(random_bytes(8)).'.ebak';$writer=new AppBackupWriter($encrypted,$key);$writer->write($plain);$meta=$writer->finish();$bytes=file_get_contents($encrypted);unlink($encrypted);
    $parts=[['offset'=>0,'bytes'=>$meta['bytes'],'sha256'=>$meta['sha256'],'object'=>hash('sha256',$bytes)]];
    $pdo->prepare("INSERT INTO eoffice_drive_versions (id,doc_id,file_name,variant,revision,bytes,key_id,parts,status) VALUES (?,?,?,'original',?,?,?,?,'verified')")->execute([$id,$job['doc_id'],$name,$hash,strlen($plain),substr(hash('sha256',$key),0,16),json_encode($parts)]);
    $pdo->prepare("INSERT INTO eoffice_drive_files VALUES (?,?,'original',?)")->execute([$job['doc_id'],$name,$id]);unlink($path);return [$job,$bytes,app_drive_archive_directory('cache').'/'.$id.'.plain'];
}
function order_due(array $job): void {app_pdo()->prepare('UPDATE eoffice_order_jobs SET retry_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE id=?')->execute([$job['id']]);}
$pdo->exec("UPDATE eoffice_order_jobs SET status='cancelled'");
[$job,$bytes,$cache]=order_cloud_fixture('behavior-cloud-transient.pdf');$tries=0;$sent=0;
$transport=['archive_get'=>static function()use(&$tries,$bytes){$tries++;if($tries===1)throw new AppDriveArchiveRetry('Mock temporary outage');return $bytes;},'ai'=>static fn()=>[$alice],'mail'=>static function()use(&$sent){$sent++;return true;}];
app_order_worker(90,$transport);$retry=app_order_job((int)$job['doc_id']);
order_verify($retry['status']==='queued'&&$retry['retry_attempts']==1&&$retry['retry_at']!==null,'temporary Drive outage schedules a bounded retry instead of permanent review');
app_order_worker(90,$transport);order_verify($tries===1&&$sent===0,'job-level backoff prevents immediate repeat cloud requests');
order_due($job);app_order_worker(90,$transport);order_verify($tries===2&&$sent===1&&app_order_job((int)$job['doc_id'])['status']==='success','recovered Drive service completes the original order automatically');
[$job,$bytes,$cache]=order_cloud_fixture('behavior-cloud-exhausted.pdf');$tries=0;
$failure=['archive_get'=>static function()use(&$tries){$tries++;throw new AppDriveArchiveRetry('Mock persistent outage');},'ai'=>static fn()=>[$alice],'mail'=>static fn()=>true];
for($i=0;$i<5;$i++){if($i)order_due($job);app_order_worker(90,$failure);}
$exhausted=app_order_job((int)$job['doc_id']);order_verify($tries===5&&$exhausted['status']==='review'&&$exhausted['error_code']==='drive_retry_exhausted','Drive retries stop after five failures');
[$job,$bytes,$cache]=order_cloud_fixture('behavior-cloud-corrupt.pdf');$sent=0;
app_order_worker(90,['archive_get'=>static fn()=>'corrupted fixture bytes','ai'=>static fn()=>[$alice],'mail'=>static function()use(&$sent){$sent++;return true;}]);
order_verify($sent===0&&app_order_job((int)$job['doc_id'])['status']==='review'&&app_order_job((int)$job['doc_id'])['retry_at']===null,'integrity failures never become automatic transient retries');
[$job,$bytes,$cache]=order_cloud_fixture('behavior-cache-eviction.pdf');$sent=[];
app_order_worker(90,['archive_get'=>static fn()=>$bytes,'ai'=>static fn()=>[$alice,$bob],'mail'=>static function($subject,$email)use(&$sent,$cache){$sent[]=$email;touch($cache,time()-7200);app_drive_archive_cache_sweep();return true;}]);
$retry=app_order_job((int)$job['doc_id']);order_verify($sent===['alice@example.test']&&$retry['status']==='queued'&&$retry['error_code']==='pdf_cache_not_ready','cache eviction after accepted mail preserves pending recipients without claiming a revision change');
order_due($job);$ai=0;
app_order_worker(90,['archive_get'=>static fn()=>$bytes,'ai'=>static function()use(&$ai){$ai++;return [];},'mail'=>static function($subject,$email)use(&$sent){$sent[]=$email;return true;}]);
order_verify($sent===['alice@example.test','bob@example.test']&&$ai===0&&app_order_job((int)$job['doc_id'])['status']==='success','cache recovery sends only the remaining recipient and reuses AI results');
[$job,$bytes,$cache]=order_cloud_fixture('behavior-cache-changing-revision.pdf');$sent=[];
app_order_worker(90,['archive_get'=>static fn()=>$bytes,'ai'=>static fn()=>[$alice,$bob],'mail'=>static function($subject,$email)use(&$sent,$cache){$sent[]=$email;unlink($cache);return true;}]);
file_put_contents(app_storage('original','2569','behavior-cache-changing-revision.pdf'),"%PDF-1.4\n% actual changed revision\n%%EOF\n");order_due($job);
app_order_worker(90,['archive_get'=>static fn()=>$bytes,'ai'=>static fn()=>[$alice,$bob],'mail'=>static function($subject,$email)use(&$sent){$sent[]=$email;return true;}]);
order_verify($sent===['alice@example.test']&&app_order_job((int)$job['doc_id'])['error_code']==='files_changed','a true revision change after accepted mail still requires review');
putenv('EOFFICE_DRIVE_ARCHIVE_ENABLED=false');
$missing=order_fixture_doc(['behavior-missing-local.pdf']);unlink(app_storage('original','2569','behavior-missing-local.pdf'));
$healthy=order_fixture_doc(['behavior-after-missing.pdf']);$batchSent=0;
$processed=app_order_worker(90,['ai'=>static fn()=>[$alice],'mail'=>static function()use(&$batchSent){$batchSent++;return true;}]);
order_verify(app_order_job((int)$missing['doc_id'])['status']==='review'&&app_order_job((int)$missing['doc_id'])['error_code']==='pdf_unavailable','permanently missing original PDF is moved to review, not endlessly requeued');
order_verify(app_order_job((int)$healthy['doc_id'])['status']==='success'&&$batchSent===1&&$processed===2,'missing PDF in one job does not block a healthy later order in the same batch');
order_verify(app_order_worker(90,['ai'=>static fn()=>[$alice],'mail'=>static function()use(&$batchSent){$batchSent++;return true;}])===0&&$batchSent===1,'reviewed missing-PDF job is not retried every cron cycle');
$pdo->exec("UPDATE eoffice_order_jobs SET status='cancelled'");$pdo->exec('ALTER TABLE t_document MODIFY Doc_Year VARCHAR(255)');
$padded=order_fixture_doc(['behavior-padded-year.pdf']);$pdo->prepare('UPDATE t_document SET Doc_Year=? WHERE Doc_Id=?')->execute(['2569 ',$padded['doc_id']]);
$invalidYear=order_fixture_doc(['behavior-invalid-year.pdf']);$pdo->prepare('UPDATE t_document SET Doc_Year=? WHERE Doc_Id=?')->execute(['not-a-year',$invalidYear['doc_id']]);
$normal=order_fixture_doc(['behavior-normal-year.pdf']);$sent=0;
app_order_worker(90,['ai'=>static fn()=>[$alice],'mail'=>static function()use(&$sent){$sent++;return true;}]);
order_verify(app_order_job((int)$padded['doc_id'])['status']==='success','legacy trailing spaces in year normalize before path helpers');
order_verify(app_order_job((int)$invalidYear['doc_id'])['error_code']==='invalid_document_year'&&app_order_job((int)$normal['doc_id'])['status']==='success'&&$sent===2,'invalid year fails one job without exiting the CLI batch');
echo "Order behavior: $passed passed\n";
