<?php
require_once __DIR__.'/../config/bootstrap.php';
require_once __DIR__.'/../config/profile-photo.php';
app_method('GET');
$user = app_user(false);
$id = (int)($_GET['user_id'] ?? 0);
if ($id <= 0) app_fail('ผู้ใช้ไม่ถูกต้อง');
$version = $_GET['v'] ?? null;
if ($version !== null && (!is_string($version) || !preg_match('/^\d{1,10}$/D', $version))) {
    app_fail('เวอร์ชันรูปไม่ถูกต้อง');
}
$pdo = app_pdo();
if (!$user || !app_can($user, 'members')) {
    $q = $pdo->prepare('SELECT User_Position FROM t_user WHERE User_Id=?');
    $q->execute([$id]);
    if (!in_array($q->fetchColumn(), ['director', 'deputy_director'], true)) {
        app_fail('คุณไม่มีสิทธิ์ดูรูปโปรไฟล์นี้', $user ? 403 : 401);
    }
}
$photo = app_profile_photo_state($pdo, $id);
if (!$photo['file_name'] || ($version !== null && (int)$version !== $photo['revision'])) {
    http_response_code(404);
    exit;
}
$path = app_profile_photo_path($photo['file_name']);
if (!is_file($path) || !is_readable($path)) {
    http_response_code(404);
    exit;
}
header('Content-Type: image/jpeg');
header('Content-Length: '.filesize($path));
header('Cache-Control: no-store');
header('Content-Disposition: inline; filename="profile-photo.jpg"');
readfile($path);
exit;
