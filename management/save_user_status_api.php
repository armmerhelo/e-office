<?php
require_once __DIR__.'/../config/member-management.php';app_method('POST');$actor=app_admin();$input=app_input();
$id=filter_var($input['user_id']??null,FILTER_VALIDATE_INT,['options'=>['min_range'=>1]]);
$status=app_text($input,'status',20,true);$version=app_text($input,'member_version',64,true);
if(!$id||!in_array($status,['User','Editor','Admin'],true))app_fail('ระดับผู้ใช้ไม่ถูกต้อง');
$pdo=app_pdo();$pdo->beginTransaction();
try {
    $locked=app_lock_member($pdo,$actor,$id);
    if($locked['actor']['User_Status']!=='Admin'){ $pdo->rollBack();app_fail('เฉพาะ Admin สูงสุดเท่านั้นที่เปลี่ยนระดับผู้ใช้ได้',403); }
    app_check_member_version($pdo,$locked['target'],$version);
    app_require_remaining_admin($pdo,$locked,$status);
    $pdo->prepare('UPDATE t_user SET User_Status=? WHERE User_Id=?')->execute([$status,$id]);
    if($status!==$locked['target']['User_Status']&&($status==='Admin'||$locked['target']['User_Status']==='Admin'))$pdo->prepare('DELETE FROM eoffice_permissions WHERE User_Id=?')->execute([$id]);
    $pdo->commit();
}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
app_json(['status'=>'success','message'=>'บันทึกระดับผู้ใช้สำเร็จ']);
