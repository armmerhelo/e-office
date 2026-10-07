<?php
require_once __DIR__ . '/../config/auth.php';
app_method('POST');
$data = app_input();
$email = app_text($data, 'username', 255, true);
$password = app_password($data, 'password', true);
$pdo = app_pdo();
$key = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . ':' . strtolower($email));
$q = $pdo->prepare('SELECT attempts FROM eoffice_login_attempts WHERE identity_hash=? AND window_start>DATE_SUB(NOW(), INTERVAL 15 MINUTE)');
$q->execute([$key]);
if ((int)$q->fetchColumn() >= 10) app_fail('ลองเข้าสู่ระบบใหม่ในอีก 15 นาที', 429);
$q = $pdo->prepare('SELECT * FROM t_user WHERE User_Email=? LIMIT 1'); $q->execute([$email]); $user = $q->fetch();
$stored = $user['User_Password'] ?? '';
$isHash = password_get_info($stored)['algoName'] !== 'unknown';
$valid = $user && ($isHash ? password_verify($password, $stored) : ($stored !== '' && hash_equals($stored, $password)));
if (!$valid) {
    $q = $pdo->prepare('INSERT INTO eoffice_login_attempts VALUES (?,1,NOW()) ON DUPLICATE KEY UPDATE attempts=IF(window_start>DATE_SUB(NOW(),INTERVAL 15 MINUTE),attempts+1,1),window_start=IF(window_start>DATE_SUB(NOW(),INTERVAL 15 MINUTE),window_start,NOW())'); $q->execute([$key]);
    app_fail('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 401);
}
if (!$isHash || password_needs_rehash($stored, PASSWORD_DEFAULT)) {
    $q = $pdo->prepare('UPDATE t_user SET User_Password=? WHERE User_Id=?'); $q->execute([password_hash($password, PASSWORD_DEFAULT), $user['User_Id']]);
}
$pdo->prepare('DELETE FROM eoffice_login_attempts WHERE identity_hash=?')->execute([$key]);
app_login_session($user);
app_json(['status'=>'success', 'user_name'=>$user['User_Name'], 'user_status'=>$user['User_Status']]);
