<?php
declare(strict_types=1);

require_once __DIR__ . '/config_maintenance.php';

function drive_api_url(): string
{
    $url = app_env('DRIVE_APPS_SCRIPT_URL');
    if (!$url || parse_url($url, PHP_URL_SCHEME) !== 'https') throw new RuntimeException('Drive configuration required');
    return $url;
}

function drive_decode_response(string $response, int $status): array
{
    $decoded = json_decode($response, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('Google Drive API ตอบกลับไม่ใช่ JSON');
    }

    if ($status >= 400 || ($decoded['status'] ?? '') === 'error') {
        $message = $decoded['message'] ?? $decoded['error'] ?? 'Google Drive API error';
        throw new RuntimeException((string)$message);
    }

    return $decoded;
}

function drive_api_get(array $query): array
{
    $separator = str_contains(drive_api_url(), '?') ? '&' : '?';
    $url = drive_api_url() . $separator . http_build_query($query);

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
        ]);
        $response = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        $close = curl_close($ch);

        if ($response === false) {
            throw new RuntimeException('เชื่อมต่อ Google Drive API ไม่สำเร็จ: ' . $error);
        }
    } else {
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => "Accept: application/json\r\n",
                'timeout' => 120,
            ],
        ]);
        $response = file_get_contents($url, false, $context);
        $statusLine = $http_response_header[0] ?? 'HTTP/1.1 500';
        preg_match('/\s(\d{3})\s/', $statusLine, $match);
        $status = (int)($match[1] ?? 500);

        if ($response === false) {
            throw new RuntimeException('เชื่อมต่อ Google Drive API ไม่สำเร็จ');
        }
    }

    return drive_decode_response((string)$response, $status);
}

function drive_api_request(array $payload): array
{
    $encodedPayload = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($encodedPayload === false) {
        throw new RuntimeException('สร้างข้อมูลสำหรับส่งไป Google Drive API ไม่สำเร็จ');
    }

    if (function_exists('curl_init')) {
        $ch = curl_init(drive_api_url());
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => $encodedPayload,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_FOLLOWLOCATION => true,
        ]);
        $response = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($response === false) {
            throw new RuntimeException('เชื่อมต่อ Google Drive API ไม่สำเร็จ: ' . $error);
        }
    } else {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => $encodedPayload,
                'timeout' => 120,
            ],
        ]);
        $response = file_get_contents(drive_api_url(), false, $context);
        $statusLine = $http_response_header[0] ?? 'HTTP/1.1 500';
        preg_match('/\s(\d{3})\s/', $statusLine, $match);
        $status = (int)($match[1] ?? 500);

        if ($response === false) {
            throw new RuntimeException('เชื่อมต่อ Google Drive API ไม่สำเร็จ');
        }
    }

    return drive_decode_response((string)$response, $status);
}

function get_year_folder_id(int $year): string
{
    $pdo = getDatabaseConnection();
    
    // ค้นหาว่าโฟลเดอร์สำหรับปีนี้ถูกสร้างไว้หรือยัง
    $stmt = $pdo->prepare("SELECT drive_folder_id FROM maintenance_year_folders WHERE year = ? LIMIT 1");
    $stmt->execute([$year]);
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($result) {
        return (string)$result['drive_folder_id'];
    }
    
    // ถ้ายังไม่มี ให้สร้างโฟลเดอร์ใน Google Drive
    $folderName = "ใบแจ้งซ่อม-" . $year;
    
    $response = drive_api_request([
        'action' => 'create_folder',
        'folderName' => $folderName,
    ]);
    
    $folderId = (string)($response['folderId'] ?? '');
    if ($folderId === '') {
        throw new RuntimeException('Google Drive API ไม่ได้ส่ง folderId กลับมา');
    }
    
    $folderUrl = (string)($response['folderUrl'] ?? '');
    
    // บันทึกลงตาราง cache
    $stmtInsert = $pdo->prepare("INSERT INTO maintenance_year_folders (year, drive_folder_id, drive_folder_url) VALUES (?, ?, ?)");
    $stmtInsert->execute([$year, $folderId, $folderUrl]);
    
    return $folderId;
}

function validate_maintenance_image(string $base64Data): string {
    $bytes = base64_decode($base64Data, true);
    if ($bytes === false || strlen($bytes) > 5 * 1024 * 1024) throw new RuntimeException('Invalid image size');
    $info = @getimagesizefromstring($bytes);
    if (!$info || $info[0] * $info[1] > 16000000 || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG], true)) throw new RuntimeException('Invalid image');
    return $info['mime'];
}

function upload_maintenance_image(int $year, string $base64Data, string $filename, string $mimeType): string
{
    $mimeType = validate_maintenance_image($base64Data);
    if (app_settings()['mock']) {
        app_queue(['type'=>'drive_image','year'=>$year,'bytes'=>strlen(base64_decode($base64Data,true))]);
        return 'https://drive.google.com/file/d/mock-' . bin2hex(random_bytes(8)) . '/view';
    }
    $folderId = get_year_folder_id($year);
    
    $response = drive_api_request([
        'action' => 'create',
        'filename' => $filename,
        'mimeType' => $mimeType,
        'base64Data' => $base64Data,
        'folderId' => $folderId,
    ]);
    
    $fileId = (string)($response['fileId'] ?? $response['id'] ?? '');
    $fileUrl = (string)($response['fileUrl'] ?? $response['url'] ?? $response['webViewLink'] ?? '');
    
    if ($fileUrl === '' && $fileId !== '') {
        $fileUrl = 'https://drive.google.com/file/d/' . rawurlencode($fileId) . '/view';
    }
    
    if ($fileUrl === '') {
        throw new RuntimeException('Google Drive API อัปโหลดสำเร็จแต่ไม่ได้ส่ง fileUrl กลับมา');
    }
    
    return $fileUrl;
}
?>
