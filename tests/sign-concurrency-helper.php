<?php
if(PHP_SAPI!=='cli')exit;
require_once __DIR__.'/../config/services.php';
require_once __DIR__.'/../config/sign-routing.php';
require_once __DIR__.'/../config/member-management.php';
require_once __DIR__.'/../config/document-files.php';
if(!preg_match('/^eoffice_members_\d+_test$/D',app_settings()['database'])||!app_settings()['mock'])throw new RuntimeException('Disposable concurrency fixture only');
$pdo=app_pdo();$action=$argv[1]??'';$department='กลุ่มบริหารวิชาการ';
function stage(string $message): void { echo $message."\n";flush();if(trim((string)fgets(STDIN))!=='release')throw new RuntimeException('Expected release command'); }
if($action==='install-then-auto-rollback'){
    $lock=app_document_file_lock(1);app_document_transaction();
    $pdo->query('SELECT Doc_Id FROM t_document WHERE Doc_Id=1 FOR UPDATE')->fetchColumn();
    $target=app_storage('e-sign','2569','signed_1_routing.pdf');$backup=$target.'.test-backup';
    if(!is_file($target)||is_file($backup))throw new RuntimeException('Signed fixture required');
    if(!rename($target,$backup)||file_put_contents($target,"%PDF-1.4\n% UNCOMMITTED-FAILED-SIGNATURE\n%%EOF\n")===false)throw new RuntimeException('Fixture installation failed');
    // Simulate InnoDB releasing all row locks on a deadlock; file mutex survives.
    $pdo->rollBack();stage('DB_RELEASED_FILE_LOCK_HELD');
    app_restore_signed_file($target,$backup,true);$lock->release();echo "RESTORED\n";
}elseif($action==='receipt-before-admin'){
    $lock=app_document_file_lock(1);app_document_transaction();app_lock_sign_routing($pdo);
    $pdo->query('SELECT Doc_Id FROM t_document WHERE Doc_Id=1 FOR UPDATE')->fetchColumn();
    $pdo->exec('DELETE FROM t_access_rights WHERE Doc_Id=1 AND User_Id=1');
    app_validate_document_receipts($pdo,2,[$department]);stage('RECEIPT_GATE_HELD');
    $added=app_register_document_receipts($pdo,2,1,'routing.pdf',str_repeat('a',64),[$department]);
    $pdo->commit();$lock->release();echo json_encode(['added'=>$added])."\n";
}elseif($action==='admin-before-receipt'){
    $pdo->beginTransaction();app_lock_sign_routing($pdo,true);
    $pdo->query("SELECT User_Id FROM t_user WHERE User_Status='Admin' ORDER BY User_Id FOR UPDATE")->fetchAll();stage('ADMIN_GATE_HELD');
    $pdo->exec('DELETE FROM eoffice_sign_routes');
    $pdo->prepare('INSERT INTO eoffice_sign_routes VALUES (?,?,?)')->execute([2,$department,1]);
    $pdo->commit();echo "ROUTE_COMMITTED\n";
}elseif($action==='gate-waits'){
    $q=$pdo->prepare("SELECT COUNT(*) FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='eoffice_counters'");
    $q->execute([app_settings()['database']]);echo $q->fetchColumn();
}elseif($action==='fail-next-signed-row'){
    $pdo->exec("CREATE TRIGGER fail_signed_revision BEFORE INSERT ON eoffice_signed_files FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic post-install failure'");
}elseif($action==='clear-failure'){
    $pdo->exec('DROP TRIGGER IF EXISTS fail_signed_revision');
}elseif($action==='arm-deadlock'){
    $pdo->exec("INSERT INTO eoffice_counters VALUES ('test-sign-deadlock',0) ON DUPLICATE KEY UPDATE value=0");
    $pdo->exec("CREATE TRIGGER fail_signed_revision BEFORE INSERT ON eoffice_signed_files FOR EACH ROW UPDATE eoffice_counters SET value=value+1 WHERE counter_key='test-sign-deadlock'");
}elseif($action==='deadlock-after-install'){
    $pdo->beginTransaction();
    $pdo->exec("UPDATE eoffice_counters SET value=value+1 WHERE counter_key='test-sign-deadlock'");
    // Make this fixture heavier than the HTTP transaction so InnoDB selects
    // the signing request as the deadlock victim, releasing its row locks.
    $q=$pdo->prepare('INSERT INTO eoffice_counters (counter_key,value) VALUES (?,1)');
    for($i=0;$i<100;$i++)$q->execute(['test-deadlock-weight-'.$i]);
    stage('DEADLOCK_PARENT_HELD');
    $pdo->query('SELECT Doc_Id FROM t_document WHERE Doc_Id=1 FOR UPDATE')->fetchColumn();
    $pdo->commit();echo "DEADLOCK_RESOLVED\n";
}else throw new RuntimeException('Unknown concurrency helper action');
