<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/services.php';
if(!str_ends_with(app_settings()['database'],'_test')||!app_settings()['mock'])throw new RuntimeException('Only isolated mock tests allowed');
$pdo=app_pdo();$passed=0;$docId=null;
function verify(bool $ok,string $name): void {global $passed;if(!$ok)throw new RuntimeException('FAIL '.$name);$passed++;echo 'PASS '.$name.PHP_EOL;}
function job(array $payload,string $status='pending'): int {if(($payload['type']??'')==='document_notification'&&$status==='pending')$payload['idempotency_key']??=app_notification_key();$pdo=app_pdo();$pdo->prepare('INSERT INTO eoffice_outbox (payload,status) VALUES (?,?)')->execute([json_encode($payload),$status]);return (int)$pdo->lastInsertId();}
function state(int $id): array {$q=app_pdo()->prepare('SELECT * FROM eoffice_outbox WHERE id=?');$q->execute([$id]);$row=$q->fetch();$row['payload']=json_decode($row['payload'],true);return $row;}
function ready(int $id): void {$row=state($id);$row['payload']['retry_at']=0;app_outbox_progress($id,$row['payload']);}
// A connection-local temporary table prevents touching pre-existing test jobs.
$pdo->exec('CREATE TEMPORARY TABLE eoffice_outbox (id BIGINT AUTO_INCREMENT PRIMARY KEY,payload JSON NOT NULL,status VARCHAR(20) NOT NULL,created_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB');
try{
    $q=$pdo->prepare('SELECT User_Id FROM t_user WHERE User_Email=?');$q->execute(['qa-owner@siya.ac.th']);$owner=(int)$q->fetchColumn();$q->execute(['qa-recipient@siya.ac.th']);$recipient=(int)$q->fetchColumn();
    if(!$owner||!$recipient)throw new RuntimeException('Seed QA accounts first');
    $pdo->prepare("INSERT INTO t_document (Doc_Number,Doc_Name,Doc_Url,Doc_Type,Doc_Date_Update,Status,Doc_Number_Receive,Doc_Date_Receive,Doc_Receive_From,Doc_Action,Doc_Other,External_Number,Doc_Url_Name,Doc_Year,User_Id,Doc_Date,Doc_File_Link) VALUES (?,?,'[]','Internal',?,'Nomal','','2026-10-07','','','',0,'','2569',?,?,'')")->execute(['NOTIFY-'.bin2hex(random_bytes(8)),'Notification regression fixture',date('d/m/Y H:i'),$owner,date('d/m/Y H:i')]);
    $docId=(int)$pdo->lastInsertId();
    $pdo->prepare("INSERT INTO t_access_rights (User_Id,Doc_Id,Date,alert_to) VALUES (?,?,'',0)")->execute([$recipient,$docId]);
    $payload=['type'=>'document_notification','user_id'=>$recipient,'doc_id'=>$docId];
    $mail=0;$push=0;$keys=[];
    $transports=['mail'=>static function()use(&$mail){$mail++;return true;},'push'=>static function(...$args)use(&$push,&$keys){$push++;$keys[]=$args[4];if($push===1)throw new RuntimeException('Injected push failure');return 'success';}];
    $id=job($payload);
    verify(app_process_notifications(100,$transports)===1,'failed push leaves one retryable job');
    $row=state($id);verify($row['payload']['delivery']['mail']['status']==='success'&&$row['payload']['delivery']['push']['status']==='pending','mail and push have independent delivery status');
    verify(app_process_notifications(100,$transports)===0,'push backoff prevents immediate retries');
    ready($id);app_process_notifications(100,$transports);
    verify($mail===1&&$push===2&&state($id)['status']==='success','push retry never resends accepted email');
    verify($keys[0]===$keys[1]&&preg_match('/^[a-f0-9-]{36}$/',$keys[0])===1,'push retry reuses persisted idempotency UUID');
    $pdo->exec('DELETE FROM eoffice_outbox');$id=job($payload);$before=time();app_process_notifications(100,['mail'=>static fn()=>true,'push'=>static function(){throw new AppPushDeliveryException(3600);}]);
    verify(state($id)['payload']['retry_at']>=$before+3600,'provider Retry-After is honored');
    $pdo->exec('DELETE FROM eoffice_outbox');
    for($i=0;$i<100;$i++)job(['type'=>'drive_cleanup_required','urls'=>['https://example.invalid/orphan']]);
    $id=job($payload);
    verify(app_process_notifications(100,['mail'=>static fn()=>true,'push'=>static fn()=>'skipped'])===1&&state($id)['status']==='success','100 legacy cleanup jobs cannot starve document notifications');
    verify((int)$pdo->query("SELECT COUNT(*) FROM eoffice_outbox WHERE status='manual'")->fetchColumn()===100,'cleanup remains preserved for an operator');
    $pdo->exec('DELETE FROM eoffice_outbox');app_queue(['type'=>'drive_cleanup_required','urls'=>[]]);
    verify($pdo->query('SELECT status FROM eoffice_outbox')->fetchColumn()==='manual','new cleanup jobs start outside the send queue');
    $pdo->exec('DELETE FROM eoffice_outbox');$legacy=job($payload,'failed');app_process_notifications(100);
    verify(state($legacy)['status']==='manual','legacy partial delivery cannot be blindly resent');
    $pdo->exec('DELETE FROM eoffice_outbox');$id=job($payload);$row=state($id);unset($row['payload']['idempotency_key']);app_outbox_progress($id,$row['payload']);app_process_notifications(100);
    verify(state($id)['status']==='manual','untracked legacy pending delivery requires review');
    $pdo->exec('DELETE FROM eoffice_outbox');$mail=0;$push=0;
    $id=job($payload);
    app_process_notifications(100,['mail'=>static function()use(&$mail){$mail++;throw new RuntimeException('Ambiguous SMTP failure');},'push'=>static function()use(&$push){$push++;return 'success';}]);
    $row=state($id);verify($row['status']==='manual'&&$row['payload']['delivery']['mail']['status']==='uncertain'&&$push===1,'ambiguous email failure does not prevent push delivery');
    app_process_notifications(100,$transports);verify($mail===1,'uncertain email is not automatically retried');
    $pdo->exec('DELETE FROM eoffice_outbox');$mail=0;
    $id=job($payload+['delivery'=>['mail'=>['status'=>'sending','attempts'=>1]]]);
    app_process_notifications(100,['mail'=>static function()use(&$mail){$mail++;return true;},'push'=>static fn()=>'success']);
    verify($mail===0&&state($id)['payload']['delivery']['mail']['status']==='uncertain','crashed mail send cannot cause an automatic duplicate');
    $pdo->exec('DELETE FROM eoffice_outbox');$mail=0;$push=0;
    $id=job($payload);$transports=['mail'=>static function()use(&$mail){$mail++;return true;},'push'=>static function()use(&$push){$push++;throw new RuntimeException('Persistent push failure');}];
    for($i=0;$i<5;$i++){if($i)ready($id);app_process_notifications(100,$transports);}
    verify($mail===1&&$push===5&&state($id)['status']==='partial','push retries stop after five attempts without repeating mail');
    $pdo->exec('DELETE FROM eoffice_outbox');$push=0;
    $id=job($payload+['delivery'=>['mail'=>['status'=>'success','attempts'=>1],'push'=>['status'=>'sending','attempts'=>1,'first_attempt_at'=>time()-31*86400]]]);
    app_process_notifications(100,['mail'=>static fn()=>true,'push'=>static function()use(&$push){$push++;return 'success';}]);
    verify($push===0&&state($id)['status']==='manual','expired provider idempotency window never causes an automatic resend');
    $pdo->exec('DELETE FROM eoffice_outbox');
    $pdo->prepare('DELETE FROM t_access_rights WHERE Doc_Id=? AND User_Id=?')->execute([$docId,$recipient]);
    $id=job($payload);$mail=0;
    app_process_notifications(100,['mail'=>static function()use(&$mail){$mail++;return true;},'push'=>static fn()=>'success']);
    verify($mail===0&&state($id)['status']==='cancelled','revoked recipient gets no queued notification');
    echo "Notification queue: $passed passed\n";
}finally{
    if($docId)$pdo->prepare('DELETE FROM t_document WHERE Doc_Id=? AND User_Id=?')->execute([$docId,$owner]);
    $pdo->exec('DROP TEMPORARY TABLE eoffice_outbox');
}
