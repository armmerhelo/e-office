<?php
require_once __DIR__ . '/bootstrap.php';

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
