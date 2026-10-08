<?php
require_once __DIR__.'/../config/bootstrap.php'; app_method('POST'); app_permission('departments');$id=(int)($_POST['Department_Id']??0);if($id<=0)app_fail('Invalid department');
$pdo=app_pdo();$pdo->beginTransaction();
$pdo->prepare('DELETE FROM t_user_department WHERE Department_Id=?')->execute([$id]);
$pdo->prepare('DELETE FROM t_access_rights_department WHERE Department_Id=?')->execute([$id]);
$pdo->prepare('DELETE FROM t_department WHERE Department_Id=?')->execute([$id]);$pdo->commit();
app_json(['status'=>'success','message'=>'ลบกลุ่มงานสำเร็จ']);
