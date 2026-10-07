<?php
// =============================================
// API: ดึงรายการแจ้งซ่อม (GET)
// ระบบใบแจ้งซ่อม - กลุ่มบริหารทั่วไป โรงเรียนศรียานุสรณ์
// =============================================

header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// 1. เรียกใช้งานไฟล์คอนฟิก
require_once __DIR__ . '/config_maintenance.php';
app_method('GET');

// 2. เรียกฟังก์ชันเชื่อมต่อฐานข้อมูล
$pdo = getDatabaseConnection();
$current_user = app_user();

// -----------------------------------------------------------
// 2.1 ตรวจสอบ User_Token จาก Cookie (สำหรับกรองรายการของผู้ใช้)
// -----------------------------------------------------------
$User_Token = $current_user['User_Token'];
$User_Id = null;

if (!empty($User_Token) && $User_Token !== '1') {
    $sqlToken = "SELECT User_Id FROM t_user WHERE User_Token = :user_token LIMIT 1";
    $stmtToken = $pdo->prepare($sqlToken);
    $stmtToken->execute([':user_token' => $User_Token]);
    $userResult = $stmtToken->fetch(PDO::FETCH_ASSOC);

    if ($userResult) {
        $User_Id = $userResult['User_Id'];
    }
}
// -----------------------------------------------------------

// -----------------------------------------------------------
// 2.2 ตรวจสอบสิทธิ์ Admin (เฉพาะผู้ใช้งานรหัส 1 หรือ 14 เท่านั้นที่มีสิทธิ์ดูทั้งหมด)
// -----------------------------------------------------------
$allowed_admins = app_can($current_user, 'maintenance') ? [$current_user['User_Id']] : [];
$my = $_GET['my'] ?? '';

if ($my !== 'true') {
    if ($User_Id === null || !in_array($User_Id, $allowed_admins)) {
        http_response_code(403);
        echo json_encode([
            "status"  => "error",
            "message" => "คุณไม่มีสิทธิ์เข้าถึงข้อมูลส่วนนี้ (สงวนสิทธิ์เฉพาะเจ้าหน้าที่)"
        ], JSON_UNESCAPED_UNICODE);
        exit();
    }
} else {
    if ($User_Id === null) {
        http_response_code(401);
        echo json_encode([
            "status"  => "error",
            "message" => "กรุณาเข้าสู่ระบบเพื่อดูประวัติการแจ้งซ่อมของคุณ"
        ], JSON_UNESCAPED_UNICODE);
        exit();
    }
}

// 3. รับ Query Parameters
$status = $_GET['status'] ?? '';   // กรองตามสถานะ: pending, can_proceed, cannot_proceed
$result = $_GET['result'] ?? '';   // กรองตามผล: pending, fixed, cannot_fix
$my     = $_GET['my'] ?? '';       // ?my=true → แสดงเฉพาะรายการของผู้ใช้ที่ล็อกอินอยู่
$limit  = max(1, min(1000, (int)($_GET['limit'] ?? 100)));
$offset = max(0, (int)($_GET['offset'] ?? 0));

try {
    // 4. สร้าง SQL Query พร้อม Filtering
    $sql = "SELECT * FROM maintenance_requests WHERE 1=1";
    $params = [];

    // กรองตามสถานะการพิจารณา
    if (!empty($status) && in_array($status, ['pending', 'can_proceed', 'cannot_proceed'])) {
        $sql .= " AND consideration_status = :status";
        $params[':status'] = $status;
    }

    // กรองตามผลการดำเนินการ
    if (!empty($result) && in_array($result, ['pending', 'fixed', 'cannot_fix'])) {
        $sql .= " AND action_result = :result";
        $params[':result'] = $result;
    }

    // กรองเฉพาะรายการของผู้ใช้ที่ล็อกอิน (?my=true)
    if ($my === 'true' && $User_Id !== null) {
        $sql .= " AND User_Id = :user_id";
        $params[':user_id'] = $User_Id;
    }

    // เรียงจากใหม่ → เก่า + จำกัดจำนวน
    $sql .= " ORDER BY created_at DESC LIMIT :limit OFFSET :offset";

    $stmt = $pdo->prepare($sql);

    // Bind ค่า filter parameters
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value, PDO::PARAM_STR);
    }

    // Bind LIMIT & OFFSET เป็น INT
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);

    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 5. แปลง materials และ images จาก JSON string → array
    foreach ($rows as &$row) {
        if (!empty($row['materials'])) {
            $row['materials'] = json_decode($row['materials'], true);
        }
        if (!empty($row['images'])) {
            $row['images'] = json_decode($row['images'], true);
        } else {
            $row['images'] = [];
        }
    }
    unset($row); // ยกเลิก reference

    // 6. นับจำนวนรายการทั้งหมด (สำหรับ pagination)
    $countSql = "SELECT COUNT(*) as total FROM maintenance_requests WHERE 1=1";
    $countParams = [];

    if (!empty($status) && in_array($status, ['pending', 'can_proceed', 'cannot_proceed'])) {
        $countSql .= " AND consideration_status = :status";
        $countParams[':status'] = $status;
    }
    if (!empty($result) && in_array($result, ['pending', 'fixed', 'cannot_fix'])) {
        $countSql .= " AND action_result = :result";
        $countParams[':result'] = $result;
    }
    if ($my === 'true' && $User_Id !== null) {
        $countSql .= " AND User_Id = :user_id";
        $countParams[':user_id'] = $User_Id;
    }

    $countStmt = $pdo->prepare($countSql);
    $countStmt->execute($countParams);
    $total = $countStmt->fetch()['total'];

    // 7. ส่งผลลัพธ์กลับ
    echo json_encode([
        "status" => "success",
        "total"  => intval($total),
        "data"   => $rows
    ], JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
    echo json_encode([
        "status"  => "error",
        "message" => "เกิดข้อผิดพลาดในการดึงข้อมูล: " . $e->getMessage()
    ]);
}
?>
