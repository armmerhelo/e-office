<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/bootstrap.php';
require __DIR__.'/../config/inbox-completion.php';
$s=app_settings();$database='eoffice_inbox_'.getmypid().'_test';
$pdo=new PDO("mysql:host={$s['host']};port={$s['port']};charset=utf8mb4",$s['username'],$s['password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$pdo->exec("CREATE DATABASE `$database`");
function check(bool $ok,string $message): void {if(!$ok)throw new RuntimeException($message);}
try {
    $pdo->exec("USE `$database`");
    $pdo->exec('CREATE TABLE t_document (Doc_Id INT PRIMARY KEY)');
    $pdo->exec("CREATE TABLE t_access_rights (User_Id INT,Doc_Id INT,Status VARCHAR(20) DEFAULT 'NotRead',Is_Signed VARCHAR(10) DEFAULT 'false',PRIMARY KEY(User_Id,Doc_Id))");
    $pdo->exec('CREATE TABLE t_access_rights_department (Doc_Id INT,Department_Id INT)');
    $pdo->exec('CREATE TABLE t_user_department (User_Id INT,Department_Id INT)');
    $pdo->exec("INSERT INTO t_document VALUES (1),(2),(3),(4),(5),(6)");
    $pdo->exec("INSERT INTO t_access_rights (User_Id,Doc_Id,Status) VALUES (1,1,'Readed')");
    app_inbox_migrate($pdo);app_inbox_migrate($pdo);
    check($pdo->query('SELECT Inbox_Delivered_At FROM t_access_rights')->fetchColumn()===null,'Migration must preserve unknown history');
    $q=$pdo->prepare("INSERT INTO t_access_rights (User_Id,Doc_Id,Status,Inbox_Delivered_At) VALUES (1,?,'Readed',?)");
    foreach([2=>'2026-10-30 16:59:59',3=>'2026-10-30 17:00:00',4=>'2026-10-30 17:00:01'] as $id=>$time)$q->execute([$id,$time]);
    $completed=app_inbox_completed_sql(1);
    $ids=fn()=>array_map('intval',$pdo->query("SELECT d.Doc_Id FROM t_document d WHERE $completed ORDER BY d.Doc_Id")->fetchAll(PDO::FETCH_COLUMN));
    check($ids()===[1,2],'Unknown/before complete on read; exact/after cutoff remain pending');
    $pdo->exec("UPDATE t_access_rights SET Is_Signed='true' WHERE User_Id=1 AND Doc_Id=3");
    check($ids()===[1,2,3],'Actual signature completes at cutoff');
    check((int)$pdo->query("SELECT COUNT(*) FROM t_access_rights WHERE Doc_Id IN (1,2) AND Is_Signed='true'")->fetchColumn()===0,'Legacy read must never be rewritten as signed');
    check(!(bool)$pdo->query('SELECT '.app_inbox_completed_sql(2).' FROM t_document d WHERE Doc_Id=3')->fetchColumn(),'Completion must be recipient-specific');
    $pdo->exec("INSERT INTO t_access_rights_department (Doc_Id,Department_Id,Inbox_Delivered_At) VALUES (5,7,NULL),(6,8,'2026-10-30 17:00:00')");
    $pdo->exec("INSERT INTO t_user_department (User_Id,Department_Id,Inbox_Delivered_At) VALUES (1,7,'2026-10-30 17:00:01'),(1,8,NULL)");
    check(app_inbox_delivery($pdo,1,5)==='2026-10-30 17:00:01','New group membership on an old document starts a new delivery');
    check(app_inbox_delivery($pdo,1,6)==='2026-10-30 17:00:00','New group grant with old membership uses grant time');
    // Reading a group document materializes the original delivery, not read time.
    $q=$pdo->prepare("INSERT INTO t_access_rights (User_Id,Doc_Id,Status,Inbox_Delivered_At) VALUES (1,?,'Readed',?)");
    foreach([5,6] as $id)$q->execute([$id,app_inbox_delivery($pdo,1,$id)]);
    check($ids()===[1,2,3],'Group reads after cutoff remain pending');
    $pdo->exec("INSERT INTO t_access_rights_department (Doc_Id,Department_Id,Inbox_Delivered_At) VALUES (4,9,NULL)");
    $pdo->exec("INSERT INTO t_user_department (User_Id,Department_Id,Inbox_Delivered_At) VALUES (1,9,NULL)");
    check(app_inbox_delivery($pdo,1,4)===null,'Old active path wins over a later direct grant');
    check($ids()===[1,2,3,4],'Old group delivery read is grandfathered');
    $pdo->exec('DELETE FROM t_access_rights_department WHERE Doc_Id=4');
    check($ids()===[1,2,3],'Revoked old delivery cannot grandfather a later active delivery');
    $pdo->exec('DELETE FROM t_access_rights WHERE User_Id=1 AND Doc_Id=2');
    $pdo->exec("INSERT INTO t_access_rights (User_Id,Doc_Id,Inbox_Delivered_At) VALUES (1,2,'2026-10-30 17:00:01')");
    check($ids()===[1,3],'Regrant is a new delivery, not old completion');
    app_inbox_migrate($pdo);
    check(app_inbox_delivery($pdo,1,2)==='2026-10-30 17:00:01','Rerunning migration must preserve new timestamps');
    echo "PASS inbox cutoff: UTC boundary, unknown history, read/sign isolation, group membership/grants, earliest active path, regrants and idempotent migration\n";
} finally {$pdo->exec("DROP DATABASE `$database`");}
