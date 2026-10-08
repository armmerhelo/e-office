<?php
require_once __DIR__.'/../config/member-management.php';app_method('GET');$actor=app_permission('members');
$id=(int)($_GET['User_Id']??0);if($id<=0)app_fail('ผู้ใช้ไม่ถูกต้อง');
$pdo=app_pdo();$pdo->beginTransaction();
try {
    $locked=app_lock_member($pdo,$actor,$id);$user=$locked['target'];
    $departments=app_member_departments($pdo,$id);
    $version=app_member_version($user,$departments);
    $permissions=app_user_permissions($user);$permissionVersion=app_member_permission_version($user,$permissions);
    $pdo->commit();
} catch (Throwable $e) { if($pdo->inTransaction())$pdo->rollBack();throw $e; }
app_json(['status'=>'success','data'=>$departments,'member_version'=>$version,'permissions'=>$permissions,'permission_version'=>$permissionVersion,
    'user'=>['User_Id'=>(int)$user['User_Id'],'User_Name'=>$user['User_Name'],'User_Email'=>$user['User_Email'],'User_Status'=>$user['User_Status']]]);
