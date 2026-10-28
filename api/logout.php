<?php
require_once __DIR__ . '/../config/bootstrap.php';
app_method('POST');
$token = $_COOKIE['User_Token'] ?? '';
if($token===''&&preg_match('/^Bearer ([a-f0-9]{64})$/i',$_SERVER['HTTP_AUTHORIZATION']??'',$match))$token=$match[1];
$user=app_user(false);$pdo=app_pdo();
if (is_string($token)) {
    // Session revocation must commit even when audit storage is unavailable.
    $q=$pdo->prepare('DELETE FROM eoffice_sessions WHERE token_hash=?');$q->execute([hash('sha256', $token)]);
    // Delivery also joins live sessions, so revocation is effective immediately
    // even if registry cleanup fails. Never remove another device's binding.
    try {$cleanup=$pdo->prepare('DELETE FROM eoffice_push_subscriptions WHERE session_hash=?');$cleanup->execute([hash('sha256',$token)]);}
    catch(Throwable $e){error_log('Push logout cleanup failed ('.get_class($e).')');}
    if ($user && $q->rowCount()>0) {
        try {app_audit('auth.logout',$user,(int)$user['User_Id']);}
        catch (Throwable $e) {error_log('Audit logout could not be stored ('.get_class($e).')');}
    }
}
foreach (['User_Token','User_Status','User_DisplayName','User_Id'] as $name) app_cookie($name, '', time()-3600, $name==='User_Token');
app_json(['status'=>'success', 'message'=>'Logged out successfully']);
