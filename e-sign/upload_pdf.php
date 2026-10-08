<?php
require_once __DIR__.'/../config/services.php';app_method('POST');$user=app_user();
require_once __DIR__.'/../config/drive-archive.php';
$id=(int)($_POST['Doc_Id']??0);$doc=app_document($id,$user);$file=$_FILES['file']??[];app_uploaded($file,['pdf']);
$name=basename($file['name']);app_bound_file($doc,$name);$year=(string)$doc['Doc_Year'];if((string)($_POST['year']??'')!==$year)app_fail('Invalid year');
$expected=app_text($_POST,'revision',64,true);if(!preg_match('/^[a-f0-9]{64}$/',$expected))app_fail('Invalid revision');
$dir=app_storage('e-sign',$year);if(!is_dir($dir)&&!@mkdir($dir,0755,true)&&!is_dir($dir))throw new RuntimeException('Storage unavailable');
$target=$dir.'signed_'.$id.'_'.$name;$original=app_storage('original',$year,$name);$legacy=$dir.'signed_'.$name;
$remoteCurrent=null;
if(app_drive_archive_enabled())$remoteCurrent=app_drive_archive_resolve($doc,$name,true);
$pdo=app_document_transaction();$backup=null;$installed=false;$temp=$dir.bin2hex(random_bytes(16)).'.tmp';
try{
 $doc=app_locked_document($id,$user);
 if((string)$doc['Doc_Year']!==$year){$pdo->rollBack();app_fail('ข้อมูลเอกสารเปลี่ยนแปลง กรุณาโหลดใหม่',409);}
 app_bound_file($doc,$name);
 $preferCloudSigned=app_drive_archive_enabled()&&app_drive_archive_current($id,$name,'signed')!==null;
 $current=is_file($target)?$target:(is_file($legacy)?$legacy:($preferCloudSigned?($remoteCurrent??$original):(is_file($original)?$original:($remoteCurrent??$original))));
 if($current===$remoteCurrent&&!is_file($target)&&!is_file($legacy)&&($preferCloudSigned||!is_file($original))&&app_drive_archive_enabled()){
  $cloud=app_drive_archive_current($id,$name,'signed')??app_drive_archive_current($id,$name,'original');
  if(!$cloud||!hash_equals($cloud['revision'],$expected)){$pdo->rollBack();app_fail('เอกสารถูกแก้ไขแล้ว กรุณาโหลดใหม่ก่อนลงนาม',409);}
 }
 if(!is_file($current)||!hash_equals(hash_file('sha256',$current),$expected)){$pdo->rollBack();app_fail('เอกสารถูกแก้ไขแล้ว กรุณาโหลดใหม่ก่อนลงนาม',409);}
 if(!move_uploaded_file($file['tmp_name'],$temp))throw new RuntimeException('Upload failed');
 if(is_file($target)){$backup=$target.'.'.bin2hex(random_bytes(8)).'.bak';if(!rename($target,$backup))throw new RuntimeException('Backup failed');}
 if(!rename($temp,$target))throw new RuntimeException('File save failed');
 $installed=true;
 $revision=hash_file('sha256',$target);
 $pdo->prepare("INSERT INTO t_access_rights (User_Id,Doc_Id,Date,alert_to,Status,Is_Signed) VALUES (?,?,?,0,'Readed','true') ON DUPLICATE KEY UPDATE Date=VALUES(Date),Status='Readed',Is_Signed='true'")->execute([$user['User_Id'],$id,date('d/m/Y H:i')]);
 $pdo->prepare('INSERT INTO eoffice_signed_files VALUES (?,?,?,NOW()) ON DUPLICATE KEY UPDATE revision=VALUES(revision),signed_at=NOW()')->execute([$id,$name,$revision]);
 app_drive_archive_track($id,$name,'signed',$target);
 // Preserve the existing assistant -> supervisor routing as configurable business data.
 $routes=json_decode(app_env('EOFFICE_SIGN_ROUTES','{"8":13,"11":15,"14":58,"10":61}'),true);
 if(isset($routes[$user['User_Id']])){$supervisor=(int)$routes[$user['User_Id']];$pdo->prepare("INSERT INTO t_access_rights (User_Id,Doc_Id,Date,alert_to) VALUES (?,?,'',0) ON DUPLICATE KEY UPDATE Doc_Id=VALUES(Doc_Id)")->execute([$supervisor,$id]);app_queue(['type'=>'document_notification','user_id'=>$supervisor,'doc_id'=>$id]);}
 $pdo->commit();
}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();if(is_file($temp))unlink($temp);if($backup&&is_file($backup)){if(is_file($target))unlink($target);rename($backup,$target);}elseif(is_file($target)&&$installed)unlink($target);throw $e;}
if($backup&&is_file($backup)&&!unlink($backup))error_log('Signed file backup cleanup failed');
app_json(['status'=>'success','message'=>'บันทึกการลงนามสำเร็จ','revision'=>$revision]);
