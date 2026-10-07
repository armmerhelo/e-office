<?php
require_once __DIR__.'/../../config/services.php';require_once __DIR__.'/drive.php';
app_method('POST');$d=app_input();$user=app_user(false);
$name=app_text($d,'requesterName',255,true);$date=app_date(app_text($d,'requestDate',10,true));$phone=app_text($d,'phone',50,true);$building=app_text($d,'building',255,true);$room=app_text($d,'room',255,true);$details=app_text($d,'damageDetails',10000,true);
$types=$d['repairTypes']??[];if(!is_array($types)||!$types||count($types)>20)app_fail('Invalid repair types');foreach($types as $type)if(!is_string($type)||mb_strlen($type)>50)app_fail('Invalid repair type');$types=implode(',',$types);
$images=$d['images']??[];if(!is_array($images)||count($images)>5)app_fail('อัปโหลดได้ไม่เกิน 5 รูป');$urls=[];
try{foreach($images as $image){if(!is_array($image))app_fail('Invalid image');$base=app_text($image,'base64Data',8*1024*1024,true);if(str_contains($base,','))$base=explode(',',$base,2)[1];$urls[]=upload_maintenance_image((int)substr($date,0,4)+543,$base,app_text($image,'filename',255)?:'image.jpg',app_text($image,'mimeType',100)?:'image/jpeg');}}
catch(Throwable $e){error_log((string)$e);if($urls)app_queue(['type'=>'drive_cleanup_required','urls'=>$urls]);app_fail('อัปโหลดรูปไม่สำเร็จ',502);}
$pdo=app_pdo();
try{$q=$pdo->prepare("INSERT INTO maintenance_requests (User_Id,requester_name,position,department,phone,request_date,repair_types,other_type_detail,building,room,damage_details,images,consideration_status,action_result) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending','pending')");$q->execute([$user['User_Id']??null,$name,app_text($d,'position',255),app_text($d,'department',255),$phone,$date,$types,app_text($d,'otherTypeDetail',255),$building,$room,$details,$urls?json_encode($urls):null]);}
catch(Throwable $e){if($urls)app_queue(['type'=>'drive_cleanup_required','urls'=>$urls]);throw $e;}
app_json(['status'=>'success','message'=>'บันทึกใบแจ้งซ่อมสำเร็จ','id'=>(int)$pdo->lastInsertId()]);
