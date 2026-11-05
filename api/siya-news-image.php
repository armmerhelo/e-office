<?php
require_once __DIR__.'/../config/siya-news-drive.php';
app_method('GET');$user=app_user();if(!app_siya_news_can_access($user))app_fail('คุณยังไม่ได้รับสิทธิ์ SIYA NEWS',403);
$id=$_GET['id']??'';if(!is_string($id)||!preg_match('/^[a-f0-9]{32}$/D',$id))app_fail('รหัสภาพไม่ถูกต้อง');
$pdo=app_pdo();$q=$pdo->prepare('SELECT i.*,n.owner_id,n.status,n.approved_version FROM eoffice_siya_news_images i JOIN eoffice_siya_news n ON n.id=i.news_id WHERE i.id=? AND i.is_removed=0');$q->execute([$id]);$image=$q->fetch();if(!$image)app_fail('ไม่พบภาพ',404);
$editor=app_can($user,'news_editor')&&in_array($image['status'],['review','approved'],true);$submitter=app_can($user,'news_submit')&&(int)$image['owner_id']===(int)$user['User_Id'];$producer=app_can($user,'news_producer')&&$image['status']==='approved';
if($producer&&!$editor&&!$submitter){$q=$pdo->prepare('SELECT snapshot FROM eoffice_siya_news_revisions WHERE news_id=? AND version=?');$q->execute([(int)$image['news_id'],(int)$image['approved_version']]);$snapshot=$q->fetchColumn();$snapshot=is_string($snapshot)?json_decode($snapshot,true,32,JSON_THROW_ON_ERROR):null;if(!is_array($snapshot)||!in_array($id,$snapshot['image_ids']??[],true))$producer=false;}
if(!$editor&&!$submitter&&!$producer)app_fail('คุณไม่มีสิทธิ์เปิดภาพนี้',403);
try{$bytes=app_siya_news_image_bytes($image);}catch(AppSiyaNewsError $e){app_fail($e->getMessage(),$e->status);}catch(Throwable $e){error_log('SIYA NEWS image integrity error');app_fail('ภาพไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ',503);}
$filename=preg_replace('/[^\pL\pN._ -]/u','_',basename(str_replace('\\','/',$image['original_name'])))?:'news-image.'.$image['extension'];
header('Content-Type: '.$image['mime_type']);header('Content-Length: '.strlen($bytes));header('Content-Disposition: inline; filename="'.rawurlencode($filename).'"; filename*=UTF-8\'\''.rawurlencode($filename));header('Cache-Control: private, no-store, max-age=0');header('Pragma: no-cache');
echo $bytes;
