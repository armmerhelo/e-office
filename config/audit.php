<?php
// Loaded by bootstrap. Never pass request bodies, credentials or file contents here.
function app_audit_catalog(): array {
    return [
        'auth.login'=>['auth','เข้าสู่ระบบ','user'],
        'auth.login_failed'=>['auth','เข้าสู่ระบบไม่สำเร็จ','user'],
        'auth.logout'=>['auth','ออกจากระบบ','user'],
        'document.create'=>['documents','สร้างเอกสาร','document'],
        'document.update'=>['documents','แก้ไขเอกสาร / ผู้รับ / ไฟล์แนบ','document'],
        'document.delete'=>['documents','ลบเอกสาร','document'],
        'document.read'=>['documents','บันทึกสถานะอ่านเอกสาร','document'],
        'document.receipt'=>['documents','บันทึกเลขรับเอกสาร','document'],
        'document.sign'=>['documents','บันทึก PDF ลงนาม / ประทับตรา','document'],
        'member.create'=>['members','เพิ่มสมาชิก','user'],
        'member.update'=>['members','แก้ไขสมาชิก / กลุ่มงาน','user'],
        'member.delete'=>['members','ลบสมาชิก','user'],
        'member.role'=>['members','เปลี่ยนระดับสมาชิก','user'],
        'member.permissions'=>['members','เปลี่ยนสิทธิ์สมาชิก','user'],
        'member.position'=>['members','เปลี่ยนตำแหน่งสมาชิก','user'],
        'department.create'=>['departments','เพิ่มกลุ่มงาน','department'],
        'department.update'=>['departments','แก้ไขกลุ่มงาน','department'],
        'department.delete'=>['departments','ลบกลุ่มงาน','department'],
        'routing.update'=>['members','กำหนด Auto send','routing'],
        'booking.create'=>['bookings','สร้างรายการจองห้อง','booking'],
        'booking.update'=>['bookings','แก้ไขรายการจองห้อง','booking'],
        'booking.status'=>['bookings','เปลี่ยนสถานะการจองห้อง','booking'],
        'maintenance.create'=>['maintenance','สร้างใบแจ้งซ่อม','maintenance'],
        'maintenance.update'=>['maintenance','บันทึกผล / สถานะแจ้งซ่อม','maintenance'],
        'number.create'=>['numbers','จองเลขคำสั่ง','number'],
        'number.update'=>['numbers','แก้ไขรายการจองเลขคำสั่ง','number'],
        'number.delete'=>['numbers','ลบรายการจองเลขคำสั่ง','number'],
        'email.action'=>['email','จัดการงานอีเมล / ตั้งค่า AI','document'],
        'email.key_add'=>['email','เพิ่ม API Key','api_key'],
        'email.key_test'=>['email','ทดสอบ API Key','api_key'],
        'email.key_activate'=>['email','เปลี่ยน API Key ตัวหลัก','api_key'],
        'email.key_update'=>['email','แก้ไข / พักใช้ API Key','api_key'],
        'email.key_delete'=>['email','ลบ API Key','api_key'],
        'email.key_server'=>['email','กลับไปใช้ API Key ของเซิร์ฟเวอร์','api_key'],
    ];
}
function app_audit_categories(): array {
    return ['auth'=>'เข้าสู่ระบบ','documents'=>'เอกสาร','members'=>'สมาชิกและสิทธิ์','departments'=>'กลุ่มงาน',
        'bookings'=>'จองห้อง','maintenance'=>'แจ้งซ่อม','numbers'=>'เลขคำสั่ง','email'=>'อีเมลและ AI'];
}
function app_audit_migrate(PDO $pdo): void {
    // Snapshots deliberately have no FK: deleting a user/document must preserve history.
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_audit_log (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        occurred_at DATETIME NOT NULL,
        actor_id INT NULL,
        actor_name VARCHAR(255) NOT NULL,
        event VARCHAR(64) NOT NULL,
        category VARCHAR(32) NOT NULL,
        outcome VARCHAR(16) NOT NULL,
        target_type VARCHAR(32) NOT NULL,
        target_id BIGINT NULL,
        metadata JSON NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        user_agent VARCHAR(500) NOT NULL,
        KEY idx_audit_time (occurred_at,id),
        KEY idx_audit_category (category,occurred_at,id),
        KEY idx_audit_actor (actor_id,occurred_at,id),
        KEY idx_audit_target (target_type,target_id,id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}
function app_audit(string $event, ?array $actor, ?int $target = null, array $metadata = [], string $outcome = 'success'): void {
    $definition=app_audit_catalog()[$event]??null;
    if (!$definition) throw new InvalidArgumentException('Unknown audit event');
    if (!in_array($outcome,['success','failure'],true)) throw new InvalidArgumentException('Invalid audit outcome');
    // Only explicitly safe, bounded fields may enter the log, even if a caller
    // accidentally supplies a full user/POST record later.
    $safe=[];
    foreach (['method','action','from','to','permissions','department_ids','reset_password','receipt_departments','auto_sent_user_ids','count','year','number'] as $key) {
        if (!array_key_exists($key,$metadata)) continue;
        $value=$metadata[$key];
        $clean=static fn($v)=>is_string($v)?mb_substr($v,0,255):(is_int($v)||is_bool($v)||$v===null?$v:null);
        $safe[$key]=is_array($value)?array_map($clean,array_slice(array_values($value),0,500)):$clean($value);
    }
    // Key references are server-generated opaque identifiers, never provider keys.
    if (str_starts_with($event,'email.key_') && is_string($metadata['reference']??null)
        && preg_match('/^(?:key_[a-f0-9]{16}|server)$/D',$metadata['reference'])) $safe['reference']=$metadata['reference'];
    $ip=$_SERVER['REMOTE_ADDR']??'';
    if (!is_string($ip)||!filter_var($ip,FILTER_VALIDATE_IP)) $ip='';
    app_pdo()->prepare('INSERT INTO eoffice_audit_log (occurred_at,actor_id,actor_name,event,category,outcome,target_type,target_id,metadata,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?,?,?,?)')->execute([
        date('Y-m-d H:i:s'),$actor?(int)$actor['User_Id']:null,mb_substr((string)($actor['User_Name']??'ผู้ไม่ระบุตัวตน'),0,255),
        $event,$definition[0],$event==='auth.login_failed'?'failure':$outcome,$definition[2],$target,
        json_encode($safe,JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE|JSON_THROW_ON_ERROR),$ip,
        mb_substr(mb_scrub((string)($_SERVER['HTTP_USER_AGENT']??''),'UTF-8'),0,500),
    ]);
}
// Failed-login logging must not override a 401/429 or lock out users during an
// infrastructure problem. Successful mutations use the strict transactional API.
function app_audit_login_failed(): void {
    try { app_audit('auth.login_failed',null,null,['method'=>str_contains(basename($_SERVER['SCRIPT_NAME']??''),'google')?'google':'password']); }
    catch (Throwable $e) { error_log('Audit login failure could not be stored ('.get_class($e).')'); }
}
