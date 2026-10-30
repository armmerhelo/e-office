<?php
require_once __DIR__.'/../config/services.php';app_method('POST');$user=app_user();
require_once __DIR__.'/../config/sign-routing.php';
require_once __DIR__.'/../config/drive-archive.php';
// Legacy client metadata is never authority to grant recipients.
$legacyStamp=app_text($_POST,'stamp_departments',2000);
if ($legacyStamp!=='' && $legacyStamp!=='[]') app_fail('กรุณาโหลดหน้าใหม่และยืนยันลงทะเบียนรับเอกสารก่อน Auto send');
$receiptJson=app_text($_POST,'receipt_departments',2000);
$receiptDepartments=$receiptJson===''?[]:json_decode($receiptJson);
if (!is_array($receiptDepartments) || !array_is_list($receiptDepartments) || count($receiptDepartments)>count(app_sign_departments())) app_fail('ข้อมูลฝ่ายที่รับเอกสารไม่ถูกต้อง');
foreach ($receiptDepartments as $department) if (!is_string($department) || !in_array($department,app_sign_departments(),true)) app_fail('ข้อมูลฝ่ายที่รับเอกสารไม่ถูกต้อง');
$receiptDepartments=array_values(array_unique($receiptDepartments));
if ($receiptDepartments && ($_POST['confirm_receipt']??'')!=='1') app_fail('ต้องยืนยันลงทะเบียนรับเอกสารก่อน Auto send');
$id=(int)($_POST['Doc_Id']??0);$doc=app_document($id,$user);$file=$_FILES['file']??[];app_uploaded($file,['pdf']);
$name=basename($file['name']);app_bound_file($doc,$name);$year=(string)$doc['Doc_Year'];if((string)($_POST['year']??'')!==$year)app_fail('Invalid year');
$expected=app_text($_POST,'revision',64,true);if(!preg_match('/^[a-f0-9]{64}$/',$expected))app_fail('Invalid revision');
// This is an authenticated declaration of signing intent, not verification of
// handwriting pixels. Old/no-op clients must not silently complete the inbox.
if(($_POST['confirm_signature']??'')!=='1')app_fail('กรุณาโหลดหน้าใหม่และลงนามก่อนบันทึก');
$penDeclaration=$_POST['confirm_pen_signature']??'';
if(!in_array($penDeclaration,['','1'],true))app_fail('ข้อมูลยืนยันการลงนามด้วยปากกาไม่ถูกต้อง');
$penSignature=$penDeclaration==='1';
$dir=app_storage('e-sign',$year);if(!is_dir($dir)&&!@mkdir($dir,0755,true)&&!is_dir($dir))throw new RuntimeException('Storage unavailable');
$target=$dir.'signed_'.$id.'_'.$name;$original=app_storage('original',$year,$name);$legacy=$dir.'signed_'.$name;
$remoteCurrent=null;
if(app_drive_archive_enabled())$remoteCurrent=app_drive_archive_resolve($doc,$name,true);
$fileLock=app_document_file_lock($id);
$pdo=app_document_transaction();$backup=null;$installed=false;$temp=$dir.bin2hex(random_bytes(16)).'.tmp';
try{
 if($receiptDepartments || $penSignature)app_lock_sign_routing($pdo);
 $doc=app_locked_document($id,$user);
 if((string)$doc['Doc_Year']!==$year){$pdo->rollBack();app_fail('ข้อมูลเอกสารเปลี่ยนแปลง กรุณาโหลดใหม่',409);}
 app_bound_file($doc,$name);
 // Reject an unauthorized receipt before installing any bytes or pinning a
 // Drive source. The gate keeps this validation stable until commit.
 app_validate_document_receipts($pdo,(int)$user['User_Id'],$receiptDepartments);
 clearstatcache();
 $preferCloudSigned=app_drive_archive_enabled()&&app_drive_archive_current($id,$name,'signed')!==null;
 $current=is_file($target)?$target:(is_file($legacy)?$legacy:($preferCloudSigned?($remoteCurrent??$original):(is_file($original)?$original:($remoteCurrent??$original))));
 if($current===$remoteCurrent&&!is_file($target)&&!is_file($legacy)&&($preferCloudSigned||!is_file($original))&&app_drive_archive_enabled()){
  $cloud=app_drive_archive_current($id,$name,'signed')??app_drive_archive_current($id,$name,'original');
  if(!$cloud||!hash_equals($cloud['revision'],$expected)){$pdo->rollBack();app_fail('เอกสารถูกแก้ไขแล้ว กรุณาโหลดใหม่ก่อนลงนาม',409);}
 }
 if(!is_file($current)||!hash_equals(hash_file('sha256',$current),$expected)){$pdo->rollBack();app_fail('เอกสารถูกแก้ไขแล้ว กรุณาโหลดใหม่ก่อนลงนาม',409);}
 $changedSignature=!hash_equals(hash_file('sha256',$file['tmp_name']),$expected);
 if(!$changedSignature){
  $signed=$pdo->prepare("SELECT Is_Signed FROM t_access_rights WHERE Doc_Id=? AND User_Id=?");$signed->execute([$id,$user['User_Id']]);
  // A previously signed secretary may retry registering a saved receipt after
  // their routing role changes, without changing the already-persisted PDF.
  if($signed->fetchColumn()!=='true'){$pdo->rollBack();app_fail('เอกสารไม่มีการเปลี่ยนแปลง กรุณาลงนามก่อนบันทึก');}
 }
 if(!move_uploaded_file($file['tmp_name'],$temp))throw new RuntimeException('Upload failed');
 if(is_file($target)){$candidate=$target.'.'.bin2hex(random_bytes(8)).'.bak';if(!rename($target,$candidate))throw new RuntimeException('Backup failed');$backup=$candidate;}
 if(!rename($temp,$target))throw new RuntimeException('File save failed');
 $installed=true;
 $revision=hash_file('sha256',$target);
  require_once __DIR__.'/../config/inbox-completion.php';
  $delivery=app_inbox_delivery($pdo,(int)$user['User_Id'],$id);
  // A non-recipient owner/Admin signing is a new, genuinely signed grant.
  if($delivery===false)$delivery=gmdate('Y-m-d H:i:s');
  $pdo->prepare("INSERT INTO t_access_rights (User_Id,Doc_Id,Date,alert_to,Status,Is_Signed,Inbox_Delivered_At) VALUES (?,?,?,0,'Readed','true',?) ON DUPLICATE KEY UPDATE Date=VALUES(Date),Status='Readed',Is_Signed='true'")->execute([$user['User_Id'],$id,date('d/m/Y H:i'),$delivery]);
 $pdo->prepare('INSERT INTO eoffice_signed_files VALUES (?,?,?,NOW()) ON DUPLICATE KEY UPDATE revision=VALUES(revision),signed_at=NOW()')->execute([$id,$name,$revision]);
 app_drive_archive_track($id,$name,'signed',$target);
  $autoSent=app_register_document_receipts($pdo,(int)$user['User_Id'],$id,$name,$revision,$receiptDepartments);
  if($penSignature && $changedSignature)$autoSent=array_values(array_unique([...$autoSent,...app_sign_auto_send($pdo,(int)$user['User_Id'],$id,null)]));
  app_audit('document.sign',$user,$id,['receipt_departments'=>$receiptDepartments,'auto_sent_user_ids'=>$autoSent]);
 $pdo->commit();
}catch(Throwable $e){
 try {
  // Restore bytes before an explicit rollback releases the document row lock.
  // The file mutex still protects recovery if InnoDB rolled back implicitly.
  app_restore_signed_file($target,$backup,$installed);
  if(is_file($temp)&&!unlink($temp))throw new RuntimeException('Upload temporary file cleanup failed');
 }finally{if($pdo->inTransaction())$pdo->rollBack();$fileLock->release();}
 if($e instanceof DomainException)app_fail($e->getMessage(),403);
 if($e instanceof PDOException && in_array((int)($e->errorInfo[1]??0),[1205,1213],true))app_fail('เอกสารถูกใช้งานพร้อมกัน กรุณาลองบันทึกอีกครั้ง',409);
 throw $e;
}
if($backup&&is_file($backup)&&!unlink($backup))error_log('Signed file backup cleanup failed');
$fileLock->release();
app_json(['status'=>'success','message'=>'บันทึกการลงนามสำเร็จ','revision'=>$revision,'auto_sent_user_ids'=>$autoSent,'registered_receipt_departments'=>$receiptDepartments]);
