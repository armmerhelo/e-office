<?php
// One registry for API validation, member management and navigation.
function app_permission_catalog(): array {
    return [
        'members' => ['label'=>'ดูแลสมาชิก', 'description'=>'เพิ่ม แก้ไข ลบสมาชิกทั่วไป และกำหนดกลุ่มงาน'],
        'departments' => ['label'=>'ดูแลกลุ่มงาน', 'description'=>'เพิ่ม แก้ไข และลบกลุ่มงาน'],
        'external_numbers' => ['label'=>'ดูแลเลขคำสั่ง', 'description'=>'แก้ไขและลบรายการจองเลขคำสั่งในระบบเดิม'],
        'email' => ['label'=>'งานอีเมล', 'description'=>'ส่งอีเมลคำสั่งและตรวจสอบประวัติการส่ง'],
        'room_booking' => ['label'=>'ดูแลการจองห้อง', 'description'=>'พิจารณาอนุมัติและจัดการรายการจองห้อง'],
        'maintenance' => ['label'=>'ดูแลงานแจ้งซ่อม', 'description'=>'พิจารณา มอบหมาย และบันทึกผลการซ่อม'],
    ];
}

function app_user_permissions(array $user): array {
    $keys = array_keys(app_permission_catalog());
    if ($user['User_Status'] === 'Admin') return $keys;
    $q = app_pdo()->prepare('SELECT permission FROM eoffice_permissions WHERE User_Id=?');
    $q->execute([$user['User_Id']]);
    return array_values(array_intersect($keys, $q->fetchAll(PDO::FETCH_COLUMN)));
}
