<?php
require_once __DIR__ . '/../config/services.php';
app_method('POST');
$email=strtolower(app_text($_POST,'register_email',255,true)); $name=app_text($_POST,'register_name',255,true);
if (!filter_var($email,FILTER_VALIDATE_EMAIL) || substr(strrchr($email,'@'),1)!=='siya.ac.th') app_fail('กรุณาใช้อีเมล @siya.ac.th');
$pdo=app_pdo(); $q=$pdo->prepare('SELECT 1 FROM t_user WHERE User_Email=?'); $q->execute([$email]);
if($q->fetchColumn()) app_fail('อีเมลนี้ลงทะเบียนแล้ว',409);
$q=$pdo->prepare('SELECT MAX(CAST(time AS UNSIGNED)) FROM t_register_check WHERE register_email=?'); $q->execute([$email]);
if((int)$q->fetchColumn()>time()-60) app_fail('กรุณารอ 1 นาทีก่อนส่งอีกครั้ง',429);
$token=bin2hex(random_bytes(32));
$pdo->prepare('INSERT INTO t_register_check (register_email,register_name,register_token,time) VALUES (?,?,?,?)')->execute([$email,$name,$token,(string)time()]);
$link=app_settings()['base_url'].'/submit_register.php?token='.$token;
try { app_mail('ยืนยันการลงทะเบียน E-Office',$email,'<p>ยืนยันการลงทะเบียนภายใน 30 นาที</p><a href="'.htmlspecialchars($link,ENT_QUOTES).'">ยืนยันอีเมล</a>'); }
catch(Throwable $e){$pdo->prepare('DELETE FROM t_register_check WHERE register_token=?')->execute([$token]);throw $e;}
app_json(['status'=>'success','message'=>'กรุณายืนยันอีเมล']);
