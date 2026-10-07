<?php
require_once __DIR__.'/../config/bootstrap.php'; app_method('POST'); $admin=app_admin();
$id=(int)($_POST['User_Id']??0);$name=app_text($_POST,'User_name',255,true);$email=app_text($_POST,'User_Email',255,true);$role=app_text($_POST,'User_Status',20,true);
$p1=app_password($_POST,'User_password1');$p2=app_password($_POST,'User_password2');
if($id<=0||!filter_var($email,FILTER_VALIDATE_EMAIL)||!in_array($role,['User','Editor','Admin'],true)||$p1!==$p2||($p1!==''&&mb_strlen($p1)<8))app_fail('ข้อมูลผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
if($id===$admin['User_Id']&&$role!=='Admin')app_fail('ไม่สามารถลดสิทธิ์ตัวเองได้');
$pdo=app_pdo();$pdo->beginTransaction();$q=$pdo->prepare('SELECT User_Id FROM t_user WHERE User_Id=? FOR UPDATE');$q->execute([$id]);if(!$q->fetch()){ $pdo->rollBack();app_fail('ไม่พบผู้ใช้',404); }
try{
 if($p1!==''){$pdo->prepare('UPDATE t_user SET User_Name=?,User_Email=?,User_Status=?,User_Password=? WHERE User_Id=?')->execute([$name,$email,$role,password_hash($p1,PASSWORD_DEFAULT),$id]);$pdo->prepare('DELETE FROM eoffice_sessions WHERE User_Id=?')->execute([$id]);}
 else $pdo->prepare('UPDATE t_user SET User_Name=?,User_Email=?,User_Status=? WHERE User_Id=?')->execute([$name,$email,$role,$id]);
 $depts=$_POST['Department_Id_Acc']??[];if(!is_array($depts))throw new InvalidArgumentException('Invalid departments');
 $pdo->prepare('DELETE FROM t_user_department WHERE User_Id=?')->execute([$id]);$q=$pdo->prepare('INSERT INTO t_user_department (User_Id,Department_Id) VALUES (?,?)');foreach(array_unique(array_map('intval',$depts)) as $dept)$q->execute([$id,$dept]);$pdo->commit();
}catch(Throwable $e){$pdo->rollBack();if($e instanceof PDOException&&$e->getCode()==='23000')app_fail('อีเมลซ้ำหรือกลุ่มงานไม่ถูกต้อง',409);throw $e;}
app_json(['status'=>'success','message'=>'บันทึกข้อมูลสำเร็จ']);
