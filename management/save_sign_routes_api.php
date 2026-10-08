<?php
require_once __DIR__.'/../config/member-management.php';
require_once __DIR__.'/../config/sign-routing.php';
app_method('POST');$actor=app_admin();
$input=json_decode(file_get_contents('php://input'));
if (json_last_error()!==JSON_ERROR_NONE || !($input instanceof stdClass)) app_fail('ข้อมูล Auto send ไม่ถูกต้อง');
$routes=$input->routes??null;$version=$input->route_version??null;
if (!is_array($routes) || !array_is_list($routes) || count($routes)>500 || !is_string($version) || !preg_match('/^[a-f0-9]{64}$/D',$version)) app_fail('ข้อมูล Auto send ไม่ถูกต้อง');
$keys=[];
foreach ($routes as $route) {
    if (!($route instanceof stdClass) || !is_int($route->secretary_id??null) || $route->secretary_id<1 || !is_int($route->deputy_id??null) || $route->deputy_id<1
        || !is_string($route->department??null) || ($route->department!=='' && !in_array($route->department,app_sign_departments(),true))) app_fail('กรุณาเลือกฝ่าย เลขาฝ่าย และรองฝ่ายให้ครบ');
    if ($route->secretary_id===$route->deputy_id) app_fail('เลขาฝ่ายและรองฝ่ายต้องเป็นคนละคน');
    $key=$route->secretary_id.':'.$route->department;
    if (isset($keys[$key])) app_fail('เลขาฝ่ายหนึ่งคนกำหนดรองได้หนึ่งคนต่อฝ่าย กรุณาลบรายการซ้ำ');
    $keys[$key]=true;
}
$pdo=app_pdo();$pdo->beginTransaction();
try {
    $locked=app_lock_member($pdo,$actor,(int)$actor['User_Id']);
    if ($locked['actor']['User_Status']!=='Admin') { $pdo->rollBack();app_fail('เฉพาะ Admin สูงสุดเท่านั้นที่กำหนด Auto send ได้',403); }
    $pdo->query("SELECT value FROM eoffice_counters WHERE counter_key='sign-routes-lock' FOR UPDATE")->fetchColumn();
    $current=app_sign_routes($pdo,true);
    if (!hash_equals(app_sign_routes_version($current),$version)) { $pdo->rollBack();app_fail('การกำหนด Auto send เปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่',409); }
    // The member roster lock serializes this validation with user deletion.
    $users=array_map('intval',$pdo->query('SELECT User_Id FROM t_user')->fetchAll(PDO::FETCH_COLUMN));
    foreach ($routes as $route) if (!in_array($route->secretary_id,$users,true) || !in_array($route->deputy_id,$users,true)) { $pdo->rollBack();app_fail('สมาชิกถูกลบแล้ว กรุณาโหลดข้อมูลใหม่',409); }
    $pdo->exec('DELETE FROM eoffice_sign_routes');
    $q=$pdo->prepare('INSERT INTO eoffice_sign_routes (secretary_id,department,deputy_id) VALUES (?,?,?)');
    foreach ($routes as $route) $q->execute([$route->secretary_id,$route->department,$route->deputy_id]);
    $saved=app_sign_routes($pdo);
    $pdo->commit();
} catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
app_json(['status'=>'success','message'=>'บันทึกเลขาฝ่าย / รองฝ่ายสำหรับ Auto send สำเร็จ','routes'=>$saved,'route_version'=>app_sign_routes_version($saved)]);
