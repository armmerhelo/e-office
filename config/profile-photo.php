<?php
require_once __DIR__.'/bootstrap.php';

const APP_PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const APP_PROFILE_PHOTO_MAX_PIXELS = 12_000_000;
const APP_PROFILE_PHOTO_SIZE = 512;
const APP_PROFILE_PHOTO_TOP_BIAS = 0.18;

function app_profile_photo_migrate(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_user_photos (
        User_Id INT NOT NULL PRIMARY KEY,
        revision INT UNSIGNED NOT NULL,
        file_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
        mime_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
        bytes INT UNSIGNED NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_eoffice_user_photo_user FOREIGN KEY(User_Id) REFERENCES t_user(User_Id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function app_profile_photo_root(): string {
    return rtrim((string)app_settings()['storage'], '/\\').'/profile-photos';
}

function app_profile_photo_valid_name(string $name): bool {
    return (bool)preg_match('/^[a-f0-9]{32}\.jpg$/D', $name);
}

function app_profile_photo_path(string $name): string {
    if (!app_profile_photo_valid_name($name)) throw new RuntimeException('Invalid profile photo path');
    return app_profile_photo_root().'/'.$name;
}

function app_profile_photo_url(int $userId, int $revision): string {
    return 'api/profile-photo.php?user_id='.$userId.'&v='.$revision;
}

function app_profile_photo_state(PDO $pdo, int $userId, bool $locking = false): array {
    $q = $pdo->prepare('SELECT revision,file_name FROM eoffice_user_photos WHERE User_Id=?'.($locking ? ' FOR UPDATE' : ''));
    $q->execute([$userId]);
    $row = $q->fetch() ?: null;
    $revision = (int)($row['revision'] ?? 0);
    $fileName = is_string($row['file_name'] ?? null) && app_profile_photo_valid_name($row['file_name']) ? $row['file_name'] : null;
    return [
        'revision' => $revision,
        'file_name' => $fileName,
        'url' => $fileName ? app_profile_photo_url($userId, $revision) : null,
    ];
}

function app_profile_photo_crop(int $width, int $height): array {
    if ($width < 1 || $height < 1) throw new RuntimeException('Profile photo has no pixels');
    $side = min($width, $height);
    // Portrait photos usually keep the face in the upper half. A centered
    // square can cut off the forehead or hairline, so bias the crop upward
    // while leaving square and landscape photos centered.
    return [
        'x' => (int)(($width - $side) / 2),
        'y' => (int)round(($height - $side) * APP_PROFILE_PHOTO_TOP_BIAS),
        'side' => $side,
    ];
}

function app_profile_photo_normalize(array $upload): string {
    if (($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($upload['tmp_name'] ?? '')) {
        app_fail('กรุณาเลือกไฟล์รูปโปรไฟล์');
    }
    $size = (int)($upload['size'] ?? 0);
    if ($size < 1 || $size > APP_PROFILE_PHOTO_MAX_BYTES) app_fail('รูปโปรไฟล์ต้องมีขนาดไม่เกิน 2 MB');

    $info = @getimagesize($upload['tmp_name']);
    $types = [IMAGETYPE_JPEG => 'image/jpeg', IMAGETYPE_PNG => 'image/png', IMAGETYPE_WEBP => 'image/webp'];
    $expected = is_array($info) ? ($types[$info[2]] ?? null) : null;
    if (!$expected || (int)$info[0] < 1 || (int)$info[1] < 1 || (int)$info[0] * (int)$info[1] > APP_PROFILE_PHOTO_MAX_PIXELS) {
        app_fail('รองรับเฉพาะรูป JPEG, PNG หรือ WebP ที่มีความละเอียดไม่เกิน 12 ล้านพิกเซล');
    }
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($upload['tmp_name']);
    if ($mime !== $expected) app_fail('เนื้อหาไฟล์รูปไม่ถูกต้อง');

    if (!function_exists('imagecreatefromstring') || !function_exists('imagejpeg')) {
        throw new RuntimeException('GD image support is required for profile photos');
    }
    $bytes = file_get_contents($upload['tmp_name']);
    $image = is_string($bytes) ? @imagecreatefromstring($bytes) : false;
    if (!$image) app_fail('ไม่สามารถอ่านไฟล์รูปได้');

    try {
        if ($expected === 'image/jpeg' && function_exists('exif_read_data')) {
            $exif = @exif_read_data($upload['tmp_name']);
            $angle = [3 => 180, 6 => -90, 8 => 90][(int)($exif['Orientation'] ?? 1)] ?? 0;
            if ($angle) {
                $rotated = @imagerotate($image, $angle, 0);
                if ($rotated) {
                    imagedestroy($image);
                    $image = $rotated;
                }
            }
        }
        $crop = app_profile_photo_crop(imagesx($image), imagesy($image));
        $canvas = imagecreatetruecolor(APP_PROFILE_PHOTO_SIZE, APP_PROFILE_PHOTO_SIZE);
        if (!$canvas) throw new RuntimeException('Could not allocate profile photo canvas');
        $white = imagecolorallocate($canvas, 255, 255, 255);
        imagefill($canvas, 0, 0, $white);
        if (!imagecopyresampled($canvas, $image, 0, 0, $crop['x'], $crop['y'],
            APP_PROFILE_PHOTO_SIZE, APP_PROFILE_PHOTO_SIZE, $crop['side'], $crop['side'])) {
            imagedestroy($canvas);
            throw new RuntimeException('Could not resize profile photo');
        }
        ob_start();
        $encoded = imagejpeg($canvas, null, 86);
        $jpeg = ob_get_clean();
        imagedestroy($canvas);
        if (!$encoded || !is_string($jpeg) || $jpeg === '' || strlen($jpeg) > APP_PROFILE_PHOTO_MAX_BYTES) {
            throw new RuntimeException('Could not encode profile photo');
        }
        return $jpeg;
    } finally {
        imagedestroy($image);
    }
}

function app_profile_photo_store(array $upload): array {
    $jpeg = app_profile_photo_normalize($upload);
    $root = app_profile_photo_root();
    if (!is_dir($root) && !mkdir($root, 0700, true) && !is_dir($root)) {
        throw new RuntimeException('Could not create profile photo directory');
    }
    if (!is_file($root.'/.htaccess')) @file_put_contents($root.'/.htaccess', "Require all denied\n");
    $name = bin2hex(random_bytes(16)).'.jpg';
    $path = $root.'/'.$name;
    $partial = $path.'.partial';
    try {
        if (file_put_contents($partial, $jpeg, LOCK_EX) !== strlen($jpeg)) throw new RuntimeException('Could not stage profile photo');
        chmod($partial, 0600);
        if (!hash_equals(hash('sha256', $jpeg), hash_file('sha256', $partial))) throw new RuntimeException('Profile photo write verification failed');
        if (!rename($partial, $path)) throw new RuntimeException('Could not finalize profile photo');
        chmod($path, 0600);
    } catch (Throwable $error) {
        @unlink($partial);
        @unlink($path);
        throw $error;
    }
    return ['file_name' => $name, 'mime_type' => 'image/jpeg', 'bytes' => strlen($jpeg)];
}

function app_profile_photo_delete_file(?string $name): void {
    if (!$name || !app_profile_photo_valid_name($name)) return;
    $path = app_profile_photo_path($name);
    if (is_file($path) && !unlink($path)) error_log('Could not remove profile photo file');
}
