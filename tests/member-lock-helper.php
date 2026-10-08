<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/bootstrap.php';
if(!preg_match('/^eoffice_members_\d+_test$/D',app_settings()['database'])||!app_settings()['mock'])throw new RuntimeException('Member fixture only');
$pdo=app_pdo();$action=$argv[1]??'';$id=(int)($argv[2]??0);
if($action==='waits'){
    $q=$pdo->prepare("SELECT COUNT(*) FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='t_user'");
    $q->execute([app_settings()['database']]);echo $q->fetchColumn();exit;
}
if($action==='expire'||$action==='renew'){
    $sql=$action==='expire'?'UPDATE eoffice_sessions SET expires_at=DATE_SUB(NOW(),INTERVAL 1 DAY) WHERE User_Id=?':'UPDATE eoffice_sessions SET expires_at=DATE_ADD(NOW(),INTERVAL 1 HOUR) WHERE User_Id=?';
    $pdo->prepare($sql)->execute([$id]);exit;
}
// Deterministic session value exists only inside this disposable local fixture.
if($action==='session-cookie'){echo 'User_Token='.hash('sha256','member-regression-'.$id);exit;}
if($action==='session'){
    $token=hash('sha256','member-regression-'.$id);$pdo->prepare('INSERT INTO eoffice_sessions VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))')->execute([hash('sha256',$token),$id]);exit;
}
if($action!=='lock')throw new RuntimeException('Unknown lock action');
$pdo->beginTransaction();
try{$pdo->query("SELECT User_Id FROM t_user WHERE User_Status='Admin' ORDER BY User_Id FOR UPDATE")->fetchAll();echo "LOCKED\n";flush();fgets(STDIN);$pdo->commit();}
finally{if($pdo->inTransaction())$pdo->rollBack();}
