<?php
require_once __DIR__ . '/../config/bootstrap.php';
app_method('POST'); $token=app_text($_POST,'token',64,true); $password=app_password($_POST,'password',true);
if(mb_strlen($password)<8) app_fail('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
$pdo=app_pdo();$pdo->beginTransaction();
$q=$pdo->prepare('SELECT * FROM t_register_check WHERE register_token=? FOR UPDATE');$q->execute([$token]);$row=$q->fetch();
if(!$row || (int)$row['time']<time()-1800){$pdo->rollBack();app_fail('ลิงก์ไม่ถูกต้องหรือหมดอายุ',400);}
try{
 $pdo->prepare("INSERT INTO t_user (User_Name,User_Email,User_Password,User_Token,User_Status) VALUES (?,?,?,?,'User')")->execute([$row['register_name'],$row['register_email'],password_hash($password,PASSWORD_DEFAULT),bin2hex(random_bytes(32))]);
 $pdo->prepare('DELETE FROM t_register_check WHERE register_email=?')->execute([$row['register_email']]);$pdo->commit();
}catch(PDOException $e){$pdo->rollBack();if($e->getCode()==='23000')app_fail('อีเมลนี้ลงทะเบียนแล้ว',409);throw $e;}
app_json(['status'=>'success','message'=>'สมัครสมาชิกสำเร็จ']);
