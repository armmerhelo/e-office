<?php
require_once __DIR__.'/../config/member-management.php'; app_method('POST'); $actor=app_permission('members');
$id=(int)($_POST['User_Id']??0);$name=app_text($_POST,'User_name',255,true);$email=app_text($_POST,'User_Email',255,true);$submittedRole=app_text($_POST,'User_Status',20);$version=app_text($_POST,'member_version',64);
$p1=app_password($_POST,'User_password1');$p2=app_password($_POST,'User_password2');
if($id<=0||!filter_var($email,FILTER_VALIDATE_EMAIL)||($submittedRole!==''&&!in_array($submittedRole,['User','Editor','Admin'],true))||$p1!==$p2||($p1!==''&&mb_strlen($p1)<8))app_fail('ข้อมูลผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
if (array_key_exists('permissions',$_POST)) app_fail('กรุณาใช้หน้าจอจัดการสิทธิ์โดย Admin สูงสุด',403);
$pdo=app_pdo();$pdo->beginTransaction();$locked=app_lock_member($pdo,$actor,$id);
// Accept the unchanged legacy status field, but never mutate roles here.
if ($submittedRole!=='' && $submittedRole!==$locked['target']['User_Status']) { $pdo->rollBack();app_fail('เปลี่ยนระดับผู้ใช้จากหน้าจัดการระดับเท่านั้น กรุณาโหลดข้อมูลใหม่',$locked['actor']['User_Status']==='Admin'?409:403); }
app_check_member_version($pdo,$locked['target'],$version);
try{
 if($p1!==''){$pdo->prepare('UPDATE t_user SET User_Name=?,User_Email=?,User_Password=? WHERE User_Id=?')->execute([$name,$email,password_hash($p1,PASSWORD_DEFAULT),$id]);$pdo->prepare('DELETE FROM eoffice_sessions WHERE User_Id=?')->execute([$id]);}
 else $pdo->prepare('UPDATE t_user SET User_Name=?,User_Email=? WHERE User_Id=?')->execute([$name,$email,$id]);
 $depts=$_POST['Department_Id_Acc']??[];if(!is_array($depts))throw new InvalidArgumentException('Invalid departments');
 $pdo->prepare('DELETE FROM t_user_department WHERE User_Id=?')->execute([$id]);$q=$pdo->prepare('INSERT INTO t_user_department (User_Id,Department_Id) VALUES (?,?)');foreach(array_unique(array_map('intval',$depts)) as $dept)$q->execute([$id,$dept]);$pdo->commit();
}catch(Throwable $e){$pdo->rollBack();if($e instanceof PDOException&&$e->getCode()==='23000')app_fail('อีเมลซ้ำหรือกลุ่มงานไม่ถูกต้อง',409);throw $e;}
app_json(['status'=>'success','message'=>'บันทึกข้อมูลสำเร็จ']);
