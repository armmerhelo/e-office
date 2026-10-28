<?php
require_once __DIR__.'/../config/bootstrap.php'; app_method('POST'); $actor=app_permission('departments');
$name=app_text($_POST,'Department_Name',255,true);$detail=app_text($_POST,'Department_Detail');$id=(int)($_POST['Department_Id']??0);
$pdo=app_pdo();$pdo->beginTransaction();
try {
    $edit=$id>0;
    if($edit){$q=$pdo->prepare('SELECT Department_Id FROM t_department WHERE Department_Id=? FOR UPDATE');$q->execute([$id]);if(!$q->fetchColumn())app_fail('ไม่พบกลุ่มงาน',404);$pdo->prepare('UPDATE t_department SET Department_Name=?,Department_Detail=? WHERE Department_Id=?')->execute([$name,$detail,$id]);}
    else {$pdo->prepare('INSERT INTO t_department (Department_Name,Department_Detail) VALUES (?,?)')->execute([$name,$detail]);$id=(int)$pdo->lastInsertId();}
    app_audit($edit?'department.update':'department.create',$actor,$id);$pdo->commit();
} catch (Throwable $e) {if($pdo->inTransaction())$pdo->rollBack();throw $e;}
app_json(['status'=>'success','message'=>'บันทึกกลุ่มงานสำเร็จ']);
