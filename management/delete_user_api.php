<?php
require_once __DIR__.'/../config/bootstrap.php';app_method('POST');$admin=app_admin();$id=(int)($_POST['User_Id']??0);
if($id<=0||$id===$admin['User_Id'])app_fail('ไม่สามารถลบผู้ใช้นี้ได้');
$q=app_pdo()->prepare('SELECT COUNT(*) FROM t_document WHERE User_Id=?');$q->execute([$id]);if($q->fetchColumn())app_fail('ผู้ใช้มีเอกสารอยู่ กรุณาโอนเอกสารก่อนลบ',409);
app_pdo()->prepare('DELETE FROM t_user WHERE User_Id=?')->execute([$id]);app_json(['status'=>'success','message'=>'ลบผู้ใช้สำเร็จ']);
