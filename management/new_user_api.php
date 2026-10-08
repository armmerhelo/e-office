<?php
require_once __DIR__.'/../config/member-management.php'; app_method('POST');$actor=app_permission('members');
$name=app_text($_POST,'User_name',255,true);$email=app_text($_POST,'User_Email',255,true);$role=app_text($_POST,'User_Status',20,true);$p1=app_password($_POST,'User_password1',true);$p2=app_password($_POST,'User_password2',true);
if(!filter_var($email,FILTER_VALIDATE_EMAIL)||!in_array($role,['User','Editor','Admin'],true)||$p1!==$p2||mb_strlen($p1)<8)app_fail('ข้อมูลผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
if (array_key_exists('permissions',$_POST)) app_fail('กรุณาใช้หน้าจอจัดการสิทธิ์โดย Admin สูงสุด',403);
$pdo=app_pdo();$pdo->beginTransaction();$locked=app_lock_member($pdo,$actor,(int)$actor['User_Id']);
if ($locked['actor']['User_Status']!=='Admin' && $role!=='User') { $pdo->rollBack();app_fail('เฉพาะ Admin สูงสุดเท่านั้นที่เปลี่ยนระดับผู้ใช้ได้',403); }
try{$pdo->prepare('INSERT INTO t_user (User_Name,User_Email,User_Password,User_Status,User_Token) VALUES (?,?,?,?,?)')->execute([$name,$email,password_hash($p1,PASSWORD_DEFAULT),$role,bin2hex(random_bytes(32))]);$id=(int)$pdo->lastInsertId();$pdo->commit();}
catch(Throwable $e){$pdo->rollBack();if($e instanceof PDOException && $e->getCode()==='23000')app_fail('อีเมลซ้ำ',409);throw $e;}
app_json(['status'=>'success','message'=>'เพิ่มผู้ใช้สำเร็จ','user_id'=>$id]);
