<?php
require_once __DIR__.'/../config/bootstrap.php';app_method('GET','HEAD');
$id=(int)($_GET['Doc_Id']??0);$user=app_user(false);$pdo=app_pdo();
$q=$pdo->prepare("SELECT * FROM t_document WHERE Doc_Id=? AND Is_Delete='active'");$q->execute([$id]);$doc=$q->fetch();if(!$doc)app_fail('ไม่พบเอกสาร',404);
if($doc['Doc_Type']!=='External'){$user=$user??app_user();app_document($id,$user);}
$name=app_text($_GET,'File_Path',255);if($name===''){$q=$pdo->prepare('SELECT Doc_Upload_Path FROM t_document_upload WHERE Doc_File_Link=? ORDER BY Doc_Upload_Id LIMIT 1');$q->execute([$doc['Doc_File_Link']]);$name=$q->fetchColumn()?:'';}
app_bound_file($doc,$name);$year=(string)$doc['Doc_Year'];if(isset($_GET['Year'])&&(string)$_GET['Year']!==$year)app_fail('Invalid year',403);
$path=app_storage('original',$year,$name);$signed=($_GET['Type']??'')==='signed';
if($signed){$p=app_storage('e-sign',$year,'signed_'.$id.'_'.$name);$old=app_storage('e-sign',$year,'signed_'.$name);if(is_file($p))$path=$p;elseif(is_file($old))$path=$old;}
if(!is_file($path)){
 // Fixed, trusted legacy host only; never accept a caller-supplied URL.
 if(!app_settings()['remote_files'])app_fail('ไม่พบไฟล์ต้นฉบับในเครื่อง',404);
 $ch=curl_init('https://eoffice.siya.ac.th/file_request.php?File_Path='.rawurlencode($year.'/'.$name).'&Type='.($signed?'signed':''));
 curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_TIMEOUT=>20,CURLOPT_SSL_VERIFYPEER=>true]);$body=curl_exec($ch);$status=curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);
 if($status!==200||!is_string($body)||strlen($body)>20*1024*1024)app_fail('ไม่สามารถโหลดไฟล์ต้นฉบับ',502);
 $mime=(new finfo(FILEINFO_MIME_TYPE))->buffer($body);$revision=hash('sha256',$body);
 if($signed&&$mime!=='application/pdf')app_fail('ไฟล์ต้นทางไม่ใช่ PDF',502);
 // Cache only document-bound bytes from the trusted legacy origin. Signing then
 // uses the same local revision rather than rejecting all legacy documents.
 $cache=$signed?app_storage('e-sign',$year,'signed_'.$id.'_'.$name):$path;
 $folder=dirname($cache);if(!is_dir($folder)&&!@mkdir($folder,0750,true)&&!is_dir($folder))throw new RuntimeException('Storage unavailable');
 $temporary=$cache.'.'.bin2hex(random_bytes(8)).'.tmp';
 app_document_transaction();
 try{
  $q=$pdo->prepare("SELECT * FROM t_document WHERE Doc_Id=? AND Is_Delete='active' FOR UPDATE");$q->execute([$id]);$latest=$q->fetch();
  if(!$latest){$pdo->rollBack();app_fail('ไม่พบเอกสาร',404);}
  if($latest['Doc_Type']!=='External'){
   $user=app_user(false);
   if(!$user){$pdo->rollBack();app_fail('กรุณาเข้าสู่ระบบใหม่',401);}
   $latest=app_locked_document($id,$user);
  }
  if((string)$latest['Doc_Year']!==$year){$pdo->rollBack();app_fail('ข้อมูลเอกสารเปลี่ยนแปลง',409);}
  app_bound_file($latest,$name);
  // Cache writers use the same document lock as signers. A late legacy fetch
  // can never replace a freshly signed file between an exists check and rename.
  clearstatcache(true,$cache);
  if(is_file($cache)){$path=$cache;unset($body);}
  else{
   if(file_put_contents($temporary,$body)!==strlen($body))throw new RuntimeException('Legacy file cache failed');
   if(!rename($temporary,$cache))throw new RuntimeException('Legacy file cache failed');
  }
  $pdo->commit();
 }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();if(is_file($temporary))unlink($temporary);throw $e;}
}
$handle=null;
if(!isset($body)){
 // Hash and stream one open inode, so atomic signing replacements cannot make
 // the response bytes disagree with X-Document-Revision.
 $handle=@fopen($path,'rb');if(!$handle)app_fail('ไฟล์กำลังเปลี่ยนแปลง กรุณาลองใหม่',503);
 $mime=(new finfo(FILEINFO_MIME_TYPE))->buffer(fread($handle,16384));rewind($handle);
 $hash=hash_init('sha256');hash_update_stream($hash,$handle);$revision=hash_final($hash);rewind($handle);
}
$inline=in_array($mime,['application/pdf','image/jpeg','image/png'],true)?'inline':'attachment';
header('Content-Type: '.$mime);header('Content-Disposition: '.$inline.'; filename="'.rawurlencode($name).'"');header('Cache-Control: private, no-store');header('X-Document-Revision: '.$revision);
if($_SERVER['REQUEST_METHOD']==='HEAD'){if($handle)fclose($handle);exit;}
if(isset($body))echo $body;else{fpassthru($handle);fclose($handle);}
