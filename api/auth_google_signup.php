<?php
require_once __DIR__ . '/../config/google-auth.php';
app_method('GET', 'POST');
if (!app_google_enabled()) app_fail('ยังไม่ได้ตั้งค่า Google login', 503);
app_google_session();
try {
    $pending = app_google_signup_pending($_SESSION);
} catch (DomainException $e) {
    session_write_close();
    app_fail('การยืนยัน Google หมดอายุ กรุณาเข้าสู่ระบบด้วย Google อีกครั้ง', 401);
}
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    session_write_close();
    app_json(['status'=>'success', 'mode'=>$pending['mode'], 'email'=>$pending['identity']['email'], 'name'=>$pending['identity']['name'], 'csrf'=>$pending['csrf']]);
}
$data = app_input();
$csrf = $data['csrf'] ?? null;
if (!is_string($csrf) || !hash_equals($pending['csrf'], $csrf)) app_fail('คำขอไม่ถูกต้อง กรุณาลองใหม่', 403);
$link = $pending['mode'] === 'link';
if (!$link && ($data['consent'] ?? false) !== true) app_fail('กรุณายอมรับข้อตกลงการสมัครสมาชิก');
$name = $link ? null : app_text($data, 'name', 255, true);
$password = $link ? app_password($data, 'password', true) : null;
$attemptKey = $link ? app_login_attempt_key($pending['identity']['email']) : null;
$pdo = app_pdo();
$pdo->beginTransaction();
try {
    // Email, Google ID and privileges come from trusted server state, never POST data.
    $user = app_google_user($pdo, $pending['identity'], $name, $password);
    if ($attemptKey !== null) $pdo->prepare('DELETE FROM eoffice_login_attempts WHERE identity_hash=?')->execute([$attemptKey]);
    app_login_session($user);
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    session_write_close();
    if ($e instanceof DomainException && $e->getMessage() === 'invalid_password') {
        app_login_failed_attempt($attemptKey);
        app_fail('รหัสผ่านบัญชี E-Office ไม่ถูกต้อง', 401);
    }
    if ($e instanceof DomainException || ($e instanceof PDOException && $e->getCode() === '23000')) {
        app_fail('บัญชีเปลี่ยนแปลงหรือมีการลงทะเบียนแล้ว กรุณาเข้าสู่ระบบด้วย Google อีกครั้ง', 409);
    }
    throw $e;
}
unset($_SESSION['google_signup']);
session_write_close();
$documentId = $pending['document_id'];
app_json(['status'=>'success', 'redirect_url'=>app_settings()['base_url'].'/'.($documentId !== '' ? '?id='.rawurlencode($documentId) : '')]);
