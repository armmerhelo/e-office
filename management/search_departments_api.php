<?php
require_once __DIR__.'/../config/config.php'; app_method('GET'); app_user();
header('Content-Type: application/json; charset=utf-8');

// (สามารถเพิ่มโค้ดตรวจสอบ Token ตรงนี้ได้เหมือนไฟล์อื่นๆ เพื่อความปลอดภัย)

$search = isset($_GET['search']) ? $_GET['search'] : '';
$data = [];

if ($search !== '') {
    $search_param = "%{$search}%";
    $stmt = $conn->prepare("SELECT Department_Id, Department_Name FROM t_department WHERE Department_Name LIKE ? LIMIT 10");
    $stmt->bind_param("s", $search_param);
    $stmt->execute();
    $result = $stmt->get_result();

    while ($row = $result->fetch_assoc()) {
        $data[] = $row;
    }
    $stmt->close();
}

echo json_encode(["status" => "success", "data" => $data]);
?>
