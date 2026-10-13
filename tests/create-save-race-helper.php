<?php
if(PHP_SAPI!=='cli')exit;
require_once __DIR__.'/../config/bootstrap.php';
if(!str_ends_with(app_settings()['database'],'_test')||!app_settings()['mock'])throw new RuntimeException('Only isolated mock tests allowed');
$pdo=app_pdo();$action=$argv[1]??'';$table=$argv[2]??'';
if(!in_array($table,['maintenance_requests','room_bookings'],true))throw new RuntimeException('Invalid fixture table');
if($action==='waits'){
 $q=$pdo->prepare("SELECT COUNT(*) FROM performance_schema.metadata_locks WHERE OBJECT_SCHEMA=? AND OBJECT_NAME=? AND LOCK_STATUS='PENDING'");
 $q->execute([app_settings()['database'],$table]);echo $q->fetchColumn();exit;
}
if($action==='revoke'){
 $id=(int)($argv[3]??0);$q=$pdo->prepare('SELECT User_Email FROM t_user WHERE User_Id=?');$q->execute([$id]);
 if(!str_starts_with((string)$q->fetchColumn(),'qa-'))throw new RuntimeException('Only synthetic accounts allowed');
 $pdo->prepare('DELETE FROM eoffice_sessions WHERE User_Id=?')->execute([$id]);echo "REVOKED\n";exit;
}
if($action==='session-live'){
 $id=(int)($argv[3]??0);$q=$pdo->prepare('SELECT COUNT(*) FROM eoffice_sessions WHERE User_Id=? AND expires_at>NOW()');$q->execute([$id]);echo $q->fetchColumn();exit;
}
if($action==='count'){
 $column=$table==='room_bookings'?'topic':'damage_details';$q=$pdo->prepare("SELECT COUNT(*) FROM `$table` WHERE `$column`=?");$q->execute([$argv[3]??'']);echo $q->fetchColumn();exit;
}
if($action!=='lock')throw new RuntimeException('Invalid fixture action');
$pdo->exec("LOCK TABLES `$table` WRITE");echo "LOCKED\n";flush();
try{if(trim((string)fgets(STDIN))!=='release')throw new RuntimeException('Expected release');}
finally{$pdo->exec('UNLOCK TABLES');}
