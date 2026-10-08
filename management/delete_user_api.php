<?php
require_once __DIR__.'/../config/member-management.php';app_method('POST');$actor=app_permission('members');$id=(int)($_POST['User_Id']??0);
if($id<=0)app_fail('ผู้ใช้ไม่ถูกต้อง');
$pdo=app_pdo();$pdo->beginTransaction();$locked=app_lock_member($pdo,$actor,$id);
app_require_remaining_admin($pdo,$locked,'deleted');
if ($id===(int)$actor['User_Id']) { $pdo->rollBack();app_fail('ไม่สามารถลบบัญชีที่กำลังใช้งานได้'); }
$q=$pdo->prepare('SELECT COUNT(*) FROM t_document WHERE User_Id=?');$q->execute([$id]);
if($q->fetchColumn()) { $pdo->rollBack();app_fail('ผู้ใช้มีเอกสารอยู่ กรุณาโอนเอกสารก่อนลบ',409); }
try { $pdo->prepare('DELETE FROM t_user WHERE User_Id=?')->execute([$id]);$pdo->commit(); }
catch (Throwable $e) { $pdo->rollBack();if ($e instanceof PDOException && $e->getCode()==='23000') app_fail('ผู้ใช้มีข้อมูลอ้างอิงอยู่ ไม่สามารถลบได้',409);throw $e; }
app_json(['status'=>'success','message'=>'ลบผู้ใช้สำเร็จ']);
