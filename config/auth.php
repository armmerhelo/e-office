<?php
require_once __DIR__ . '/bootstrap.php';

function app_login_attempt_key(string $email): string {
    $key = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . ':' . strtolower($email));
    $q = app_pdo()->prepare('SELECT attempts FROM eoffice_login_attempts WHERE identity_hash=? AND window_start>DATE_SUB(NOW(), INTERVAL 15 MINUTE)');
    $q->execute([$key]);
    if ((int)$q->fetchColumn() >= 10) app_fail('ลองเข้าสู่ระบบใหม่ในอีก 15 นาที', 429);
    return $key;
}

function app_login_failed_attempt(string $key): void {
    app_pdo()->prepare('INSERT INTO eoffice_login_attempts VALUES (?,1,NOW()) ON DUPLICATE KEY UPDATE attempts=IF(window_start>DATE_SUB(NOW(),INTERVAL 15 MINUTE),attempts+1,1),window_start=IF(window_start>DATE_SUB(NOW(),INTERVAL 15 MINUTE),window_start,NOW())')->execute([$key]);
}

function app_login_session(array $user): void {
    $token = bin2hex(random_bytes(32));
    $expires = time() + 86400 * 30;
    app_pdo()->prepare('INSERT INTO eoffice_sessions VALUES (?,?,?)')->execute([
        hash('sha256', $token), $user['User_Id'], date('Y-m-d H:i:s', $expires),
    ]);
    app_cookie('User_Token', $token, $expires, true);
    foreach (['User_Status'=>'User_Status', 'User_DisplayName'=>'User_Name', 'User_Id'=>'User_Id'] as $cookie=>$field) {
        app_cookie($cookie, (string)$user[$field], $expires);
    }
}
