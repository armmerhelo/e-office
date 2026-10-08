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
echo "Order behavior: $passed passed\n";
