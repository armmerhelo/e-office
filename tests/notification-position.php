<?php
// Called by the isolated order fixture with mocked mail and push transports.
if(PHP_SAPI!=='cli'||!app_settings()['mock']||!preg_match('/^eoffice_orders_\d+_test$/D',app_settings()['database']))throw new RuntimeException('Disposable mock fixture only');
$pdo=app_pdo();$passed=0;
function notification_position_check(bool $ok,string $name): void {global $passed;if(!$ok)throw new RuntimeException('FAIL '.$name);$passed++;echo 'PASS '.$name.PHP_EOL;}
$alice=(int)$pdo->query("SELECT User_Id FROM t_user WHERE User_Name='alice'")->fetchColumn();
$pdo->exec("CREATE TEMPORARY TABLE eoffice_outbox (id BIGINT AUTO_INCREMENT PRIMARY KEY,payload JSON,status VARCHAR(20),created_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB");
$pdo->exec("INSERT INTO t_document (Doc_Number,Doc_Name,Doc_Type,Doc_Year) VALUES ('NOTIFICATION-POSITION','Synthetic notification','External','2569')");$doc=(int)$pdo->lastInsertId();
$read=static function()use($pdo){$row=$pdo->query('SELECT payload,status FROM eoffice_outbox ORDER BY id DESC LIMIT 1')->fetch();$row['payload']=json_decode($row['payload'],true);return $row;};
$run=static function(array $delivery=[])use($pdo,$doc,$alice){
    $pdo->exec('DELETE FROM eoffice_outbox');$payload=['type'=>'document_notification','user_id'=>$alice,'doc_id'=>$doc];if($delivery)$payload['delivery']=$delivery;app_queue($payload);
    $mail=0;$push=0;app_process_notifications(20,['mail'=>static function()use(&$mail){$mail++;return true;},'push'=>static function()use(&$push){$push++;return 'success';}]);return [$mail,$push];
};
try{
    foreach(['director','deputy_director'] as $position){
        $pdo->prepare('UPDATE t_user SET User_Position=? WHERE User_Id=?')->execute([$position,$alice]);
        [$mail,$push]=$run();$row=$read();
        notification_position_check($mail===0&&$push===1&&$row['payload']['delivery']['mail']['status']==='skipped'&&$row['payload']['delivery']['mail']['reason']==='executive_excluded'&&$row['payload']['delivery']['mail']['attempts']===0,$position.' external notification skips mail without an SMTP attempt while retaining push');
        [$mail,$push]=$run(['mail'=>['status'=>'sending','attempts'=>1]]);$row=$read();
        notification_position_check($mail===0&&$push===1&&$row['payload']['delivery']['mail']['status']==='uncertain'&&$row['status']==='manual',$position.' crashed SMTP marker remains uncertain');
        [$mail,$push]=$run(['mail'=>['status'=>'success','attempts'=>1]]);$row=$read();
        notification_position_check($mail===0&&$push===1&&$row['payload']['delivery']['mail']['status']==='success',$position.' accepted delivery remains success');
    }
    $pdo->prepare("UPDATE t_document SET Doc_Type='Internal' WHERE Doc_Id=?")->execute([$doc]);
    $pdo->prepare("INSERT INTO t_access_rights (User_Id,Doc_Id) VALUES (?,?)")->execute([$alice,$doc]);
    [$mail,$push]=$run();notification_position_check($mail===1&&$push===1,'internal document notifications still deliver to executives');
    $pdo->prepare("UPDATE t_document SET Doc_Type='External' WHERE Doc_Id=?")->execute([$doc]);
    $pdo->prepare("UPDATE t_user SET User_Position='staff' WHERE User_Id=?")->execute([$alice]);
    [$mail,$push]=$run();notification_position_check($mail===1&&$push===1,'external document notifications still deliver to ordinary staff');
    $pdo->exec('DELETE FROM eoffice_outbox');app_queue(['type'=>'document_notification','user_id'=>$alice,'doc_id'=>$doc]);
    $writer=new PDO("mysql:host={$settings['host']};port={$settings['port']};dbname={$settings['database']};charset=utf8mb4",$settings['username'],$settings['password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);$writer->exec('SET SESSION innodb_lock_wait_timeout=1');$blocked=false;$calls=0;
    app_process_notifications(20,['mail'=>static function()use($writer,$alice,&$blocked,&$calls){$calls++;try{$writer->prepare("UPDATE t_user SET User_Position='director' WHERE User_Id=?")->execute([$alice]);}catch(PDOException $e){$blocked=(int)($e->errorInfo[1]??0)===1205;}return true;},'push'=>static fn()=>'success']);
    notification_position_check($calls===1&&$blocked&&$read()['payload']['delivery']['mail']['status']==='success','position change waits for in-flight notification SMTP result');
    $writer->prepare("UPDATE t_user SET User_Position='director' WHERE User_Id=?")->execute([$alice]);[$mail,$push]=$run();
    notification_position_check($mail===0&&$push===1,'position change committed after a send protects the next notification');
    $pdo->prepare("UPDATE t_user SET User_Position='staff' WHERE User_Id=?")->execute([$alice]);
    $pdo->exec('DELETE FROM eoffice_outbox');app_queue(['type'=>'document_notification','user_id'=>$alice,'doc_id'=>$doc]);$push=0;
    app_process_notifications(20,['mail'=>static function(){throw new RuntimeException('Simulated ambiguous SMTP failure');},'push'=>static function()use(&$push){$push++;return 'success';}]);$row=$read();
    notification_position_check($row['payload']['delivery']['mail']['status']==='uncertain'&&$row['status']==='manual'&&$push===1,'SMTP failure remains uncertain and push continues');
    $pdo->exec('DELETE FROM eoffice_outbox');app_queue(['type'=>'document_notification','user_id'=>$alice,'doc_id'=>$doc]);
    $writer->beginTransaction();$q=$writer->prepare('SELECT Doc_Id FROM t_document WHERE Doc_Id=? FOR UPDATE');$q->execute([$doc]);
    $pdo->exec('SET SESSION innodb_lock_wait_timeout=1');$mail=0;$push=0;
    app_process_notifications(20,['mail'=>static function()use(&$mail){$mail++;return true;},'push'=>static function()use(&$push){$push++;return 'success';}]);$writer->commit();$row=$read();
    notification_position_check($mail===0&&$push===1&&$row['payload']['delivery']['mail']['status']==='pending'&&$row['payload']['delivery']['mail']['attempts']===0&&$row['payload']['delivery']['mail']['preflight_attempts']===1,'pre-SMTP lock timeout stays retryable while push continues');
    $payload=$row['payload'];$payload['retry_at']=0;$id=(int)$pdo->query('SELECT id FROM eoffice_outbox ORDER BY id DESC LIMIT 1')->fetchColumn();app_outbox_progress($id,$payload);
    app_process_notifications(20,['mail'=>static function()use(&$mail){$mail++;return true;},'push'=>static function()use(&$push){$push++;return 'success';}]);$row=$read();
    notification_position_check($mail===1&&$push===1&&$row['payload']['delivery']['mail']['status']==='success','retry after preflight contention sends mail once and does not repeat push');
    echo 'Notification positions: '.$passed.' passed'.PHP_EOL;
}finally{
    $pdo->prepare("UPDATE t_user SET User_Position='staff' WHERE User_Id=?")->execute([$alice]);
    $pdo->prepare('DELETE FROM t_access_rights WHERE Doc_Id=?')->execute([$doc]);$pdo->prepare('DELETE FROM t_document WHERE Doc_Id=?')->execute([$doc]);
    $pdo->exec('DROP TEMPORARY TABLE eoffice_outbox');
}
