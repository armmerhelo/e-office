<?php
// Production secrets must be supplied by the process environment or config/local.php.
$local = is_file(__DIR__ . '/local.php') ? require __DIR__ . '/local.php' : [];
$loopback = PHP_SAPI === 'cli' || in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
$get = static function ($key, $default = '') use ($local) {
    $value = getenv($key);
    return $value !== false ? $value : ($local[$key] ?? $default);
};
return [
    'host' => $get('DB_HOST', '127.0.0.1'), 'port' => (int)$get('DB_PORT', '3306'),
    'database' => $get('DB_DATABASE', $loopback ? 'document2' : ''),
    'username' => $get('DB_USERNAME', $loopback ? 'root' : ''), 'password' => $get('DB_PASSWORD'),
    'mock' => filter_var($get('EOFFICE_MOCK_SERVICES', 'false'), FILTER_VALIDATE_BOOLEAN),
    'remote_files' => filter_var($get('EOFFICE_REMOTE_FILES', 'false'), FILTER_VALIDATE_BOOLEAN),
    'storage' => $get('EOFFICE_STORAGE', dirname(__DIR__) . '/file_document'),
    'base_url' => rtrim($get('APP_URL', $loopback ? 'http://localhost' : 'https://e-office.siya.ac.th'), '/'),
];
