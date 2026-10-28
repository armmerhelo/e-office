<?php
require_once __DIR__.'/../config/member-management.php';app_method('POST');$actor=app_admin();$input=app_input();
$id=filter_var($input['user_id']??null,FILTER_VALIDATE_INT,['options'=>['min_range'=>1]]);
$position=app_text($input,'position',30,true);$version=app_text($input,'member_version',64,true);
if(!$id||!isset(app_member_positions()[$position]))app_fail('ตำแหน่งไม่ถูกต้อง');
$pdo=app_pdo();$pdo->beginTransaction();
try{
    $locked=app_lock_member($pdo,$actor,$id);
    if($locked['actor']['User_Status']!=='Admin'){$pdo->rollBack();app_fail('เฉพาะ Admin สูงสุดเท่านั้นที่กำหนดตำแหน่งได้',403);}
    app_check_member_version($pdo,$locked['target'],$version);
    $pdo->prepare('UPDATE t_user SET User_Position=? WHERE User_Id=?')->execute([$position,$id]);
    app_audit('member.position',$locked['actor'],$id,['from'=>$locked['target']['User_Position']??'','to'=>$position]);
    $pdo->commit();
}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
app_json(['status'=>'success','message'=>'บันทึกตำแหน่งสำเร็จ']);
