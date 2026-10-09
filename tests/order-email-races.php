<?php
// Controlled interleaving using a test-only SQL trigger and advisory lock.
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/order-emails.php';
if(!preg_match('/^eoffice_orders_\d+_test$/D',app_settings()['database'])||!app_settings()['mock'])throw new RuntimeException('Disposable mock test only');
$pdo=app_pdo();$action=$argv[1]??'';$docId=(int)($argv[2]??0);
if($action==='setup'){
    $pdo->exec("CREATE TRIGGER order_send_gate BEFORE UPDATE ON eoffice_order_recipients FOR EACH ROW BEGIN IF NEW.status='sending' AND OLD.status='pending' THEN SET @order_gate=GET_LOCK('order-test:sendgate',20); SET @order_release=RELEASE_LOCK('order-test:sendgate'); END IF; END");echo '{}';exit;
}
if($action==='cleanup'){$pdo->exec('DROP TRIGGER IF EXISTS order_send_gate');exit;}
if($action==='gate'){$pdo->query("SELECT GET_LOCK('order-test:sendgate',0)");echo "LOCKED\n";flush();fgets(STDIN);$pdo->query("SELECT RELEASE_LOCK('order-test:sendgate')");exit;}
if(str_starts_with($action,'blocked-')){
    $needle=$action==='blocked-marker'?"SET @order_gate=GET_LOCK%":"SELECT * FROM t_document WHERE Doc_Id=%FOR UPDATE%";
    $q=$pdo->prepare('SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE DB=? AND INFO LIKE ?');$q->execute([app_settings()['database'],$needle]);echo $q->fetchColumn();exit;
}
if($action==='revoke'){
    $job=app_order_job($docId);if(!$job)throw new RuntimeException('Fixture job required');
    $pdo->beginTransaction();$q=$pdo->prepare('SELECT * FROM t_document WHERE Doc_Id=? FOR UPDATE');$q->execute([$docId]);$doc=$q->fetch();
    $q=$pdo->prepare('SELECT status FROM eoffice_order_recipients WHERE job_id=?');$q->execute([$job['id']]);$before=$q->fetchColumn();
    $pdo->prepare('DELETE FROM t_access_rights WHERE Doc_Id=?')->execute([$docId]);app_order_saved($docId,false,'External',app_order_settings());$pdo->commit();
    echo json_encode(['status_at_revoke'=>$before,'revoked'=>true]);exit;
}
if($action==='worker'){
    $sent=[];app_order_worker(90,['ai'=>static fn()=>[],'mail'=>static function($subject,$email)use(&$sent){$sent[]=$email;return true;}]);echo json_encode(['sent'=>$sent]);exit;
}
throw new RuntimeException('Unknown action');
