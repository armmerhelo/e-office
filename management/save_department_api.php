<?php
require_once __DIR__.'/../config/bootstrap.php'; app_method('POST'); app_permission('departments');
$name=app_text($_POST,'Department_Name',255,true);$detail=app_text($_POST,'Department_Detail');$id=(int)($_POST['Department_Id']??0);
if($id)app_pdo()->prepare('UPDATE t_department SET Department_Name=?,Department_Detail=? WHERE Department_Id=?')->execute([$name,$detail,$id]);
else app_pdo()->prepare('INSERT INTO t_department (Department_Name,Department_Detail) VALUES (?,?)')->execute([$name,$detail]);
app_json(['status'=>'success','message'=>'บันทึกกลุ่มงานสำเร็จ']);
