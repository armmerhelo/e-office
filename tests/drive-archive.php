<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/drive-archive-worker.php';require __DIR__.'/../config/drive-archive-schema.php';
if(!str_ends_with(app_settings()['database'],'_test')||!app_settings()['mock'])throw new RuntimeException('Isolated mock test only');
app_drive_archive_migrate(app_pdo());$pdo=app_pdo();$passed=0;$objects=[];
function drive_check(bool $condition,string $label): void {global $passed;if(!$condition)throw new RuntimeException('FAIL '.$label);$passed++;echo 'PASS '.$label.PHP_EOL;}
function drive_reject(callable $fn,string $label): void {try{$fn();}catch(Throwable $e){drive_check(true,$label);return;}throw new RuntimeException('FAIL '.$label);}
$put=static function(string $bytes)use(&$objects):string{$id=hash('sha256',$bytes);$objects[$id]=$bytes;return $id;};
$get=static function(string $id)use(&$objects):string{if(!isset($objects[$id]))throw new RuntimeException('Mock cloud missing');return $objects[$id];};
$call=static fn(array $input):array=>['status'=>'success','descriptor'=>$input['descriptor']??null];$transport=['get'=>$get,'put'=>$put,'call'=>$call];
$pdo->exec("INSERT INTO t_user (User_Name,User_Email,User_Password,User_Status,User_Token) VALUES ('Archive fixture','archive-fixture@example.invalid','not-a-login','User','')");$user=(int)$pdo->lastInsertId();
$pdo->prepare("INSERT INTO t_document (Doc_Number,Doc_Name,Doc_Type,Doc_Year,User_Id,Doc_Date,Doc_File_Link,Is_Delete) VALUES ('ARCHIVE-FIXTURE','Archive fixture','Internal','2566',?,'01/01/2023 00:00','archive-fixture','active')")->execute([$user]);$id=(int)$pdo->lastInsertId();$name='archive-fixture.pdf';
$pdo->prepare("INSERT INTO t_document_upload (Doc_Upload_Path,Doc_File_Link,Doc_Upload_Detail,User_Id) VALUES (?,'archive-fixture','Fixture',?)")->execute([$name,$user]);
$path=app_storage('original','2566',$name);if(!is_dir(dirname($path)))mkdir(dirname($path),0700,true);
$original="%PDF-1.4\n".random_bytes(1048600);file_put_contents($path,$original);
app_document_transaction();app_drive_archive_track($id,$name,'original',$path);$pdo->commit();$version=app_drive_archive_current($id,$name,'original');
drive_check($version['status']==='pending'&&is_file(app_drive_archive_directory('spool').'/'.$version['id'].'.source'),'new file is tracked and pinned before cloud upload');
drive_check(app_drive_archive_upload_version($version,microtime(true)+30,$transport),'encrypted multi-part upload and full cloud read-back');
$version=app_drive_archive_current($id,$name,'original');drive_check($version['status']==='verified'&&count(app_drive_archive_parts($version))===2,'both parts recorded only as verified ciphertext');
foreach($objects as $bytes)drive_check(!str_starts_with($bytes,'%PDF-'),'cloud object contains ciphertext only');
$cache=app_drive_archive_restore($version,$get);drive_check(file_get_contents($cache)===$original,'complete cloud recovery preserves exact original bytes');
drive_check(app_drive_archive_old_year(2566,2569)&&!app_drive_archive_old_year(2567,2569)&&!app_drive_archive_old_year(2569,2569),'current year plus previous two years stay local');
$pdo->exec('UPDATE eoffice_drive_state SET full_scan_at=NOW() WHERE id=1');
$daily=app_drive_archive_backup($transport);drive_check($daily['completed']&&$daily['versions']===1,'daily DB snapshot and encrypted manifest complete with verified file mappings');
$date=date('Y-m-d');$record=$pdo->query('SELECT * FROM eoffice_drive_backups')->fetch();$manifest=json_decode($record['manifest'],true);
drive_check(isset($manifest['versions'][$version['id']])&&$manifest['database']['tables']>0,'database snapshot captures the same recovery manifest');
drive_check(app_drive_archive_backup($transport)['already_completed'],'daily retries do not create another completed run');
putenv('EOFFICE_DRIVE_EVICT_ENABLED=true');$pdo->prepare('UPDATE eoffice_drive_versions SET verified_at=DATE_SUB(NOW(),INTERVAL 15 DAY) WHERE id=?')->execute([$version['id']]);$version=app_drive_archive_current($id,$name,'original');
drive_check(app_drive_archive_evict($version,$transport)&&!is_file($path),'old verified file is quarantined only after a complete recoverable daily backup');
$quarantine=app_drive_archive_directory('quarantine').'/'.$version['id'].'.source';if(is_file($quarantine))unlink($quarantine);
$doc=$pdo->query('SELECT * FROM t_document WHERE Doc_Id='.$id)->fetch();
drive_check(file_get_contents(app_drive_archive_resolve($doc,$name))===$original,'Drive-only original remains accessible through the file resolver');
// A new signature is a new immutable version; never return the old original.
$signedPath=app_drive_archive_local($doc,$name,'signed');if(!is_dir(dirname($signedPath)))mkdir(dirname($signedPath),0700,true);$signed=$original."\n% signed\n";file_put_contents($signedPath,$signed);
app_document_transaction();app_drive_archive_track($id,$name,'signed',$signedPath);$pdo->commit();$signedVersion=app_drive_archive_current($id,$name,'signed');
drive_check(app_drive_archive_upload_version($signedVersion,microtime(true)+30,$transport),'new signed variant uploads independently without replacing original history');
$signedVersion=app_drive_archive_current($id,$name,'signed');$signedCache=app_drive_archive_restore($signedVersion,$get);unlink($signedPath);
drive_check(file_get_contents(app_drive_archive_resolve($doc,$name,true))===$signed,'signed cloud variant has priority over original');
unlink($signedCache);$parts=app_drive_archive_parts($signedVersion);$object=$parts[0]['object'];$saved=$objects[$object];$objects[$object]='corrupt';
drive_reject(static fn()=>app_drive_archive_restore($signedVersion,$get),'corrupted cloud ciphertext is rejected before plaintext publication');$objects[$object]=$saved;
drive_check(!is_file($signedCache),'corruption never publishes an incomplete plaintext cache');
$pending=$signedVersion;$pending['status']='pending';drive_reject(static fn()=>app_drive_archive_restore($pending,$get),'unverified versions cannot be restored as trusted files');
// A slow upload of a pinned revision must not undo a concurrent replacement.
$replacement=$original."\n% replacement one\n";file_put_contents($path.'.new',$replacement);rename($path.'.new',$path);
app_document_transaction();app_drive_archive_track($id,$name,'original',$path);$pdo->commit();$olderPending=app_drive_archive_current($id,$name,'original');
$newer=$original."\n% replacement two\n";file_put_contents($path.'.new',$newer);rename($path.'.new',$path);
app_document_transaction();app_drive_archive_track($id,$name,'original',$path);$pdo->commit();$newerVersion=app_drive_archive_current($id,$name,'original');
app_drive_archive_upload_version($olderPending,microtime(true)+30,$transport);
drive_check(app_drive_archive_current($id,$name,'original')['id']===$newerVersion['id'],'late upload verification never overwrites a newer file-version pointer');
$pdo->beginTransaction();try{drive_reject(static fn()=>app_drive_archive_snapshot($pdo),'consistent snapshot refuses current files still pending upload');}finally{$pdo->rollBack();}
$badGet=static fn(string $id):string=>'changed bytes';
drive_reject(static fn()=>app_drive_archive_upload_version($newerVersion,microtime(true)+30,['put'=>$put,'get'=>$badGet]),'upload never verifies a version whose cloud read-back differs');
drive_check(app_drive_archive_current($id,$name,'original')['status']==='pending','failed remote verification keeps the version pending and local source intact');
echo 'Drive archive behavior: '.$passed.' passed'.PHP_EOL;
if(getenv('EOFFICE_DRIVE_HTTP_FIXTURE')==='1'){
    app_drive_archive_restore($signedVersion,$get);
    $cookies=[];$users=[];
    foreach(['reader','outsider','admin'] as $label){
        $pdo->prepare('INSERT INTO t_user (User_Name,User_Email,User_Password,User_Status,User_Token) VALUES (?,?,?,?,?)')->execute(['Archive '.$label,$label.'@example.invalid','not-a-login',$label==='admin'?'Admin':'User','']);$uid=(int)$pdo->lastInsertId();$users[$label]=$uid;
        $token=bin2hex(random_bytes(32));$pdo->prepare('INSERT INTO eoffice_sessions (token_hash,User_Id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))')->execute([hash('sha256',$token),$uid]);$cookies[$label]='User_Token='.$token;
    }
    $pdo->prepare('INSERT INTO t_access_rights (User_Id,Doc_Id,Date) VALUES (?,?,?)')->execute([$users['reader'],$id,'']);
    // Some older local schema fixtures lack the legacy alert_to column.
    if(!$pdo->query("SHOW COLUMNS FROM t_access_rights LIKE 'alert_to'")->fetch())$pdo->exec('ALTER TABLE t_access_rights ADD COLUMN alert_to INT NOT NULL DEFAULT 0');
    echo json_encode(['doc'=>$id,'name'=>$name,'cookies'=>$cookies,'users'=>$users,'signed_revision'=>$signedVersion['revision'],'signed_cache'=>$signedCache],JSON_THROW_ON_ERROR).PHP_EOL;
}
