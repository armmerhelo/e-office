<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/bootstrap.php';
if(!str_ends_with(app_settings()['database'],'_test')||!app_settings()['mock'])throw new RuntimeException('Only isolated mock tests allowed');
$pdo=app_pdo();$action=$argv[1]??'';$id=(int)($argv[2]??0);$uid=(int)($argv[3]??0);$dept=(int)($argv[4]??0);
if($action==='join-group'){$pdo->prepare('INSERT INTO t_user_department (User_Id,Department_Id) VALUES (?,?)')->execute([$uid,$dept]);exit;}
if($action==='waits'){
    // MySQL 8 performance_schema gives deterministic proof that an HTTP writer
    // has reached the document lock. Staging is covered by sequential API tests.
    $q=$pdo->prepare("SELECT COUNT(*) FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='t_document' AND l.LOCK_DATA=?");
    $q->execute([app_settings()['database'],(string)$id]);echo $q->fetchColumn();exit;
}
if($action!=='lock')throw new RuntimeException('Unknown race action');
$pdo->beginTransaction();
try{
    $q=$pdo->prepare('SELECT * FROM t_document WHERE Doc_Id=? FOR UPDATE');$q->execute([$id]);$doc=$q->fetch();
    if(!$doc||!str_starts_with($doc['Doc_Number'],'RACE-'))throw new RuntimeException('Not a race fixture');
    echo "LOCKED\n";flush();$command=trim(fgets(STDIN));
    if($command==='revoke')$pdo->prepare('DELETE FROM t_access_rights WHERE Doc_Id=? AND User_Id=?')->execute([$id,$uid]);
    elseif($command==='revoke-group')$pdo->prepare('DELETE FROM t_user_department WHERE User_Id=? AND Department_Id=?')->execute([$uid,$dept]);
    elseif($command==='logout')$pdo->prepare('DELETE FROM eoffice_sessions WHERE User_Id=?')->execute([$uid]);
    elseif($command==='replace'){
        $q=$pdo->prepare('SELECT * FROM t_document_upload WHERE Doc_File_Link=? ORDER BY Doc_Upload_Id LIMIT 1');$q->execute([$doc['Doc_File_Link']]);$file=$q->fetch();
        $old=app_storage('original',$doc['Doc_Year'],$file['Doc_Upload_Path']);$name=bin2hex(random_bytes(16)).'.pdf';
        if(!copy($old,app_storage('original',$doc['Doc_Year'],$name)))throw new RuntimeException('Fixture copy failed');
        $pdo->prepare('UPDATE t_document_upload SET Doc_Upload_Path=? WHERE Doc_Upload_Id=?')->execute([$name,$file['Doc_Upload_Id']]);
        $pdo->commit();unlink($old);echo json_encode(['new_file'=>$name])."\n";exit;
    }else throw new RuntimeException('Unknown lock operation');
    $pdo->commit();echo "RELEASED\n";
}finally{if($pdo->inTransaction())$pdo->rollBack();}
