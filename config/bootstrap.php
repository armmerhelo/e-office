<?php
date_default_timezone_set('Asia/Bangkok');
function app_env(string $key, $default = '') {
    $value = getenv($key);
    if ($value !== false) return $value;
    static $local;
    $local ??= is_file(__DIR__.'/local.php') ? require __DIR__.'/local.php' : [];
    return $local[$key] ?? $default;
}
function app_settings(): array {
    static $settings;
    return $settings ??= require __DIR__ . '/settings.php';
}
function app_json(array $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
function app_fail(string $message, int $status = 400): never {
    app_json(['status' => 'error', 'message' => $message], $status);
}
function app_method(string ...$methods): void {
    if (!in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', $methods, true)) app_fail('Method not allowed', 405);
    if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT', 'DELETE', 'PATCH'], true)) {
        // Origin verification also protects legacy forms. SameSite is defense in depth.
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $site = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
        if ($site === 'cross-site') app_fail('Cross-site request rejected', 403);
        if ($origin !== '') {
            $parts = parse_url($origin);
            $expected = parse_url(app_settings()['base_url']);
            if (!$parts || !$expected || strtolower($parts['host'] ?? '') !== strtolower($expected['host'] ?? '')
                || ($parts['port'] ?? (($parts['scheme'] ?? '') === 'https' ? 443 : 80)) !== ($expected['port'] ?? (($expected['scheme'] ?? '') === 'https' ? 443 : 80))
                || ($parts['scheme'] ?? '') !== ($expected['scheme'] ?? '')) app_fail('Invalid origin', 403);
        }
    }
}
function app_input(): array {
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data) || json_last_error() !== JSON_ERROR_NONE) app_fail('Invalid JSON');
    return $data;
}
function app_text(array $input, string $key, int $max = 2000, bool $required = false): string {
    $v = $input[$key] ?? '';
    if (!is_string($v) || mb_strlen($v) > $max) app_fail('Invalid field: ' . $key);
    $v = trim($v);
    if ($required && $v === '') app_fail('Required field: ' . $key);
    return $v;
}
function app_mysqli(): mysqli {
    static $conn;
    if ($conn) return $conn;
    $s = app_settings();
    if (!$s['database'] || !$s['username']) throw new RuntimeException('Database configuration required');
    mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
    $conn = new mysqli($s['host'], $s['username'], $s['password'], $s['database'], $s['port']);
    $conn->set_charset('utf8mb4');
    return $conn;
}
function app_pdo(): PDO {
    static $pdo;
    if ($pdo) return $pdo;
    $s = app_settings();
    return $pdo = new PDO("mysql:host={$s['host']};port={$s['port']};dbname={$s['database']};charset=utf8mb4", $s['username'], $s['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
}
function app_user(bool $required = true): ?array {
    $token = $_COOKIE['User_Token'] ?? '';
    if ($token === '') {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (preg_match('/^Bearer ([a-f0-9]{64})$/i', $header, $m)) $token = $m[1];
    }
    $user = null;
    if (is_string($token) && preg_match('/^[a-f0-9]{64}$/', $token)) {
        $q = app_pdo()->prepare('SELECT u.* FROM eoffice_sessions s JOIN t_user u ON u.User_Id=s.User_Id WHERE s.token_hash=? AND s.expires_at>NOW()');
        $q->execute([hash('sha256', $token)]);
        $user = $q->fetch() ?: null;
    }
    if (!$user && $required) app_fail('กรุณาเข้าสู่ระบบใหม่', 401);
    return $user;
}
function app_admin(): array {
    $user = app_user();
    if ($user['User_Status'] !== 'Admin') app_fail('คุณไม่มีสิทธิ์ทำรายการนี้', 403);
    return $user;
}
function app_can(array $user, string $permission): bool {
    if($user['User_Status']==='Admin')return true;
    $q=app_pdo()->prepare('SELECT 1 FROM eoffice_permissions WHERE User_Id=? AND permission=?');
    $q->execute([$user['User_Id'],$permission]);return (bool)$q->fetchColumn();
}
function app_permission(string $permission): array {
    $user=app_user();if(!app_can($user,$permission))app_fail('คุณไม่มีสิทธิ์ทำรายการนี้',403);return $user;
}
function app_cookie(string $name, string $value, int $expires, bool $httpOnly = false): void {
    setcookie($name, $value, ['expires' => $expires, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off', 'httponly' => $httpOnly, 'samesite' => 'Strict']);
}
function app_date(string $value): string {
    $d = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
    if (!$d || $d->format('Y-m-d') !== $value) app_fail('Invalid date');
    return $value;
}
function app_password(array $input, string $key, bool $required = false): string {
    $value=$input[$key]??'';
    if(!is_string($value)||strlen($value)>4096||($required&&$value===''))app_fail('Invalid password');
    return $value;
}
function app_times(string $start, string $end): array {
    foreach ([$start, $end] as $v) {
        $d = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $v);
        if (!$d || $d->format('Y-m-d H:i:s') !== $v) app_fail('Invalid date/time');
    }
    if ($start >= $end) app_fail('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น');
    return [$start, $end];
}
function app_document(int $id, array $user, bool $edit = false): array {
    $q = app_pdo()->prepare("SELECT * FROM t_document WHERE Doc_Id=? AND Is_Delete='active'");
    $q->execute([$id]); $doc = $q->fetch();
    if (!$doc) app_fail('ไม่พบเอกสาร', 404);
    if ((int)$doc['User_Id'] === (int)$user['User_Id'] || $user['User_Status'] === 'Admin') return $doc;
    if (!$edit) {
        $q = app_pdo()->prepare('SELECT 1 FROM t_access_rights WHERE Doc_Id=? AND User_Id=? UNION SELECT 1 FROM t_access_rights_department a JOIN t_user_department u ON u.Department_Id=a.Department_Id WHERE a.Doc_Id=? AND u.User_Id=?');
        $q->execute([$id, $user['User_Id'], $id, $user['User_Id']]);
        if ($q->fetchColumn()) return $doc;
    }
    app_fail('คุณไม่มีสิทธิ์เข้าถึงเอกสารนี้', 403);
}
function app_bound_file(array $doc, string $name): array {
    if ($name !== basename($name) || str_contains($name, '\\')) app_fail('Invalid filename');
    $q = app_pdo()->prepare('SELECT * FROM t_document_upload WHERE Doc_File_Link=? AND Doc_Upload_Path=?');
    $q->execute([$doc['Doc_File_Link'], $name]);
    $file = $q->fetch();
    if (!$file) app_fail('ไฟล์ไม่ตรงกับเอกสาร', 403);
    return $file;
}
function app_storage(string $kind, string $year, string $name = ''): string {
    if (!in_array($kind, ['original', 'e-sign'], true) || !preg_match('/^\d{4}$/', $year) || $name !== basename($name) || str_contains($name, '\\')) app_fail('Invalid file path');
    return app_settings()['storage'] . '/' . $kind . '/' . $year . '/' . $name;
}
function app_uploaded(array $file, array $extensions = ['pdf', 'jpg', 'png', 'docx', 'xlsx']): string {
    if (($file['error'] ?? -1) !== UPLOAD_ERR_OK || ($file['size'] ?? 0) <= 0 || $file['size'] > 20 * 1024 * 1024 || !is_uploaded_file($file['tmp_name'])) app_fail('ไฟล์ไม่สมบูรณ์หรือเกิน 20 MB');
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, $extensions, true)) app_fail('ชนิดไฟล์ไม่ถูกต้อง');
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
    $allowed = ['pdf'=>['application/pdf'], 'jpg'=>['image/jpeg'], 'png'=>['image/png'], 'docx'=>['application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document'], 'xlsx'=>['application/zip','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']];
    if (!in_array($mime, $allowed[$ext] ?? [], true)) app_fail('เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์');
    return $ext;
}
if (PHP_SAPI !== 'cli') {
    ini_set('display_errors', '0');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('X-Frame-Options: SAMEORIGIN');
    set_exception_handler(static function (Throwable $e) {
        error_log((string)$e);
        app_fail('เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่', 500);
    });
}
