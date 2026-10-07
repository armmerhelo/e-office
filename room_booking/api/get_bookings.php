<?php
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET");

// 1. เรียกใช้งานไฟล์คอนฟิก
require_once __DIR__ . '/config_roombooking.php';

// 2. เรียกฟังก์ชันเชื่อมต่อฐานข้อมูล
$pdo = getDatabaseConnection();

try {
    // รับค่าเดือนและปีจาก Frontend
    $month = isset($_GET['month']) ? (int)$_GET['month'] : (int)date('n');
    $year = isset($_GET['year']) ? (int)$_GET['year'] : (int)date('Y');

    // สร้างออบเจกต์วันที่ของเดือนที่กำลังดูอยู่ (วันที่ 1)
    if ($month < 1 || $month > 12 || $year < 1900 || $year > 2200) app_fail('Invalid month/year');
    $targetDate = new DateTime("$year-$month-01");

    // คำนวณหาวันแรกของ "เดือนก่อนหน้า"
    $startObj = clone $targetDate;
    $startObj->modify('-1 month');
    $startDate = $startObj->format('Y-m-01 00:00:00');

    // คำนวณหาวันสุดท้ายของ "เดือนหน้า"
    $endObj = clone $targetDate;
    $endObj->modify('+1 month');
    $endDate = $endObj->format('Y-m-t 23:59:59');

    // ดึงข้อมูลรายการจอง (ลบ WHERE status = 'confirmed' ออก และเพิ่ม status ใน SELECT)
    $sql = "SELECT id, room_name, topic, requester_name, status, start_datetime, end_datetime,
                   equipment_audio, equipment_computer, equipment_projector, equipment_food, equipment_other 
            FROM room_bookings
            WHERE end_datetime >= :start_date
              AND start_datetime <= :end_date AND status NOT IN ('cancel', 'cancelled')
            ORDER BY start_datetime ASC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        ':start_date' => $startDate,
        ':end_date' => $endDate
    ]);

    $bookings = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // วนลูปตรวจสอบข้อมูลแต่ละแถว
    foreach ($bookings as &$booking) {
        // ถ้าสถานะไม่ใช่ 'confirmed' ให้เติมข้อความด้านหน้า
        if ($booking['status'] !== 'confirmed') {
            $booking['room_name'] = "(ยังไม่ยืนยันการจอง) " . $booking['room_name'];
        }
    }
    unset($booking); // ยกเลิก Reference ของตัวแปรเพื่อป้องกันข้อผิดพลาดในโค้ดส่วนอื่น

    echo json_encode([
        "status" => "success",
        "data" => $bookings
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Database error: " . $e->getMessage()]);
}
?>
