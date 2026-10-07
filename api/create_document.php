<?php
require_once __DIR__.'/../config/services.php';
app_method('POST');$user=app_user();$pdo=app_pdo();
$edit=($_POST['formtype']??'')==='edit_document';$id=(int)($_POST['doc_id']??0);
$doc=$edit?app_document($id,$user):null;
$canEdit=!$edit || (int)$doc['User_Id']===(int)$user['User_Id'] || $user['User_Status']==='Admin';
// Recipients may change only their own receipt fields, never the shared document.
if(!$canEdit){
 $number=app_text($_POST,'doc_number_receive_stamp',20);$date=app_text($_POST,'stamp_date_recieve',20);
 $q=$pdo->prepare("INSERT INTO t_access_rights (User_Id,Doc_Id,Date,alert_to,Stamp_Recieve_Number,Stamp_Date_Recieve) VALUES (?,?,'',0,?,?) ON DUPLICATE KEY UPDATE Stamp_Recieve_Number=VALUES(Stamp_Recieve_Number),Stamp_Date_Recieve=VALUES(Stamp_Date_Recieve)");
 $q->execute([$user['User_Id'],$id,$number,$date]);app_json(['status'=>'success','message'=>'บันทึกเลขรับของคุณสำเร็จ','doc_id'=>$id]);
}
$year=$edit?(string)$doc['Doc_Year']:(string)(date('Y')+543);
$type=app_text($_POST,'doc_type',30,true)==='คำสั่ง'?'External':'Internal';
$number=app_text($_POST,'doc_number',255,true);$name=app_text($_POST,'doc_name',10000,true);
$date=app_text($_POST,'doc_date_receive',10,true);app_date($date);
$urls=$_POST['doc_url']??[];$urlNames=$_POST['doc_url_name']??[];
if(!is_array($urls)||!is_array($urlNames)||count($urls)!==count($urlNames)||count($urls)>20)app_fail('Invalid links');
$links=[];foreach($urls as $i=>$url){if(!is_string($url)||strlen($url)>2000||!filter_var($url,FILTER_VALIDATE_URL)||!in_array(parse_url($url,PHP_URL_SCHEME),['http','https'],true)||!is_string($urlNames[$i]))app_fail('Invalid link');$links[]=[$urlNames[$i]=>$url];}
$fileNames=$_POST['doc_file_name']??[];$fileIds=$_POST['file_id']??[];
if(!is_array($fileNames)||!is_array($fileIds)||count($fileNames)>20)app_fail('Invalid files');
$existing=[];if($edit){$q=$pdo->prepare('SELECT * FROM t_document_upload WHERE Doc_File_Link=?');$q->execute([$doc['Doc_File_Link']]);foreach($q as $file)$existing[(int)$file['Doc_Upload_Id']]=$file;}
$uploads=[];$keep=[];
foreach($fileNames as $i=>$detail){
 if(!is_string($detail)||mb_strlen($detail)>1000)app_fail('Invalid filename');
 $fid=(int)($fileIds[$i]??0);if($fid&&!isset($existing[$fid]))app_fail('ไฟล์ไม่ตรงกับเอกสาร',403);if($fid)$keep[]=$fid;
 $err=$_FILES['doc_upload']['error'][$i]??UPLOAD_ERR_NO_FILE;
 if($err!==UPLOAD_ERR_NO_FILE){$f=['name'=>$_FILES['doc_upload']['name'][$i]??'', 'error'=>$err, 'tmp_name'=>$_FILES['doc_upload']['tmp_name'][$i]??'', 'size'=>$_FILES['doc_upload']['size'][$i]??0];$ext=app_uploaded($f);$uploads[$i]=[$f,bin2hex(random_bytes(16)).'.'.$ext];}
 if(!$fid&&!isset($uploads[$i]))app_fail('กรุณาเลือกไฟล์แนบ');
}
if(isset($_FILES['doc_upload']['name'])&&count($_FILES['doc_upload']['name'])!==count($fileNames))app_fail('จำนวนไฟล์และชื่อไฟล์ไม่สัมพันธ์กัน');
foreach(['send_to','send_to_group'] as $key){if(isset($_POST[$key])&&(!is_array($_POST[$key])||count($_POST[$key])>500))app_fail('Invalid recipients');}
$moved=[];$oldFiles=[];$pdo->beginTransaction();
try{
 if($edit){$q=$pdo->prepare('SELECT Doc_Id FROM t_document WHERE Doc_Id=? FOR UPDATE');$q->execute([$id]);}
 $values=[$number,$name,json_encode($links,JSON_UNESCAPED_UNICODE),$type,date('d/m/Y H:i'),($_POST['status']??'')==='ด่วน'?'Urgent':'Nomal',app_text($_POST,'doc_number_receive'),$date,app_text($_POST,'doc_receive_from'),app_text($_POST,'doc_action'),app_text($_POST,'doc_other'),$type==='External'?(int)($_POST['external_number']??strtok($number,'/')):0,''];
 if($edit){$q=$pdo->prepare('UPDATE t_document SET Doc_Number=?,Doc_Name=?,Doc_Url=?,Doc_Type=?,Doc_Date_Update=?,Status=?,Doc_Number_Receive=?,Doc_Date_Receive=?,Doc_Receive_From=?,Doc_Action=?,Doc_Other=?,External_Number=?,Doc_Url_Name=? WHERE Doc_Id=?');$q->execute([...$values,$id]);$link=$doc['Doc_File_Link'];}
 else{$q=$pdo->prepare('INSERT INTO t_document (Doc_Number,Doc_Name,Doc_Url,Doc_Type,Doc_Date_Update,Status,Doc_Number_Receive,Doc_Date_Receive,Doc_Receive_From,Doc_Action,Doc_Other,External_Number,Doc_Url_Name,Doc_Year,User_Id,Doc_Date,Doc_File_Link) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');$q->execute([...$values,$year,$user['User_Id'],date('d/m/Y H:i'),'']);$id=(int)$pdo->lastInsertId();$link=(string)$id;$pdo->prepare('UPDATE t_document SET Doc_File_Link=? WHERE Doc_Id=?')->execute([$link,$id]);}
 // Missing fields mean unchanged. The UI sends replace_recipients when editing the complete list.
 if(isset($_POST['send_to'])||($_POST['replace_recipients']??'')==='1'){
  $recipients=array_values(array_unique(array_map('intval',$_POST['send_to']??[])));
  $q=$pdo->prepare('SELECT * FROM t_access_rights WHERE Doc_Id=?');$q->execute([$id]);
  foreach($q->fetchAll() as $access){if(!in_array((int)$access['User_Id'],$recipients,true)){$pdo->prepare('INSERT INTO eoffice_access_history (Doc_Id,User_Id,snapshot) VALUES (?,?,?)')->execute([$id,$access['User_Id'],json_encode($access)]);$pdo->prepare('DELETE FROM t_access_rights WHERE id=?')->execute([$access['id']]);}}
  $q=$pdo->prepare("INSERT INTO t_access_rights (User_Id,Doc_Id,Date,alert_to) VALUES (?,?,'',0) ON DUPLICATE KEY UPDATE Doc_Id=VALUES(Doc_Id)");
  foreach($recipients as $recipient){$q->execute([$recipient,$id]);if($q->rowCount()===1)app_queue(['type'=>'document_notification','user_id'=>$recipient,'doc_id'=>$id]);}
 }
 if(isset($_POST['send_to_group'])||($_POST['replace_recipients']??'')==='1'){
  $pdo->prepare('DELETE FROM t_access_rights_department WHERE Doc_Id=?')->execute([$id]);$q=$pdo->prepare('INSERT INTO t_access_rights_department (Doc_Id,Department_Id) VALUES (?,?)');foreach(array_unique(array_map('intval',$_POST['send_to_group']??[])) as $dept)$q->execute([$id,$dept]);
 }
 $dir=app_storage('original',$year);if(!is_dir($dir)&&!mkdir($dir,0755,true))throw new RuntimeException('Storage unavailable');
 foreach($fileNames as $i=>$detail){$fid=(int)($fileIds[$i]??0);$path=$fid?$existing[$fid]['Doc_Upload_Path']:'';
  if(isset($uploads[$i])){[$f,$newName]=$uploads[$i];$target=$dir.$newName;if(!move_uploaded_file($f['tmp_name'],$target))throw new RuntimeException('Upload failed');$moved[]=$target;if($fid)$oldFiles[]=$dir.$path;$path=$newName;}
  if($fid)$pdo->prepare('UPDATE t_document_upload SET Doc_Upload_Detail=?,Doc_Upload_Path=? WHERE Doc_Upload_Id=? AND Doc_File_Link=?')->execute([$detail,$path,$fid,$link]);
  else $pdo->prepare('INSERT INTO t_document_upload (Doc_Upload_Detail,Doc_Upload_Path,Doc_File_Link,User_Id) VALUES (?,?,?,?)')->execute([$detail,$path,$link,$user['User_Id']]);
 }
 if($edit&&($_POST['replace_files']??'')==='1')foreach($existing as $fid=>$file)if(!in_array($fid,$keep,true)){$pdo->prepare('DELETE FROM t_document_upload WHERE Doc_Upload_Id=? AND Doc_File_Link=?')->execute([$fid,$link]);$oldFiles[]=$dir.$file['Doc_Upload_Path'];}
 $pdo->commit();foreach($oldFiles as $old)if(is_file($old))unlink($old);
}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();foreach($moved as $path)if(is_file($path))unlink($path);if($e instanceof PDOException&&$e->getCode()==='23000')app_fail('เลขเอกสารซ้ำหรือผู้รับไม่ถูกต้อง',409);throw $e;}
app_json(['status'=>'success','message'=>'บันทึกเอกสารสำเร็จ','doc_id'=>$id,'files'=>['status'=>'success']]);
