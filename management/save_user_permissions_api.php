<?php
require_once __DIR__.'/../config/member-management.php';
app_method('POST');$actor=app_admin();
// Decode objects separately so {} is never mistaken for [] and cannot silently
// revoke permissions when a caller submits the wrong JSON shape.
$input=json_decode(file_get_contents('php://input'));
if (json_last_error()!==JSON_ERROR_NONE || !($input instanceof stdClass)) app_fail('ข้อมูลสิทธิ์ไม่ถูกต้อง');
$id=filter_var($input->user_id??null,FILTER_VALIDATE_INT,['options'=>['min_range'=>1]]);
$permissions=$input->permissions??null;$catalog=app_permission_catalog();
$version=$input->permission_version??'';
if (!$id || !is_array($permissions) || !array_is_list($permissions)) app_fail('ข้อมูลสิทธิ์ไม่ถูกต้อง');
foreach ($permissions as $permission) if (!is_string($permission) || !isset($catalog[$permission])) app_fail('สิทธิ์ไม่ถูกต้อง');
$permissions=array_values(array_unique($permissions));
$pdo=app_pdo();$pdo->beginTransaction();$locked=app_lock_member($pdo,$actor,$id);
if ($locked['actor']['User_Status']!=='Admin') { $pdo->rollBack();app_fail('เฉพาะ Admin สูงสุดเท่านั้นที่กำหนดสิทธิ์ได้',403); }
if ($locked['target']['User_Status']==='Admin') { $pdo->rollBack();app_fail('Admin สูงสุดมีทุกสิทธิ์โดยอัตโนมัติ กรุณาเปลี่ยนระดับผู้ใช้ก่อน',409); }
if (!is_string($version) || !preg_match('/^[a-f0-9]{64}$/D',$version) || !hash_equals(app_member_permission_version($locked['target'],app_user_permissions($locked['target'])),$version)) {
    $pdo->rollBack();app_fail('สิทธิ์สมาชิกเปลี่ยนแล้ว กรุณาปิดหน้าต่างและเปิดข้อมูลใหม่',409);
}
try {
    $pdo->prepare('DELETE FROM eoffice_permissions WHERE User_Id=?')->execute([$id]);
    $q=$pdo->prepare('INSERT INTO eoffice_permissions (User_Id,permission) VALUES (?,?)');
    foreach ($permissions as $permission) $q->execute([$id,$permission]);
    $pdo->commit();
} catch (Throwable $e) { $pdo->rollBack();throw $e; }
app_json(['status'=>'success','message'=>'บันทึกสิทธิ์สำเร็จ','permissions'=>$permissions]);
