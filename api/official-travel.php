<?php
require_once __DIR__.'/../config/official-travel.php';
app_method('GET', 'POST');
try {
    $user = app_user(false);
    if ($_SERVER['REQUEST_METHOD'] === 'GET') app_official_travel_read(app_pdo(), $user);
    if (!$user) app_fail('กรุณาเข้าสู่ระบบใหม่', 401);
    app_official_travel_write(app_pdo(), $user, app_input());
} catch (Throwable $error) {
    error_log('Official travel: '.get_class($error).' ('.$error->getCode().')');
    app_fail('ไม่สามารถใช้งานปฏิทินได้ในขณะนี้ กรุณาลองใหม่', 500);
}
