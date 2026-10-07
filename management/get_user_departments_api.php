<?php
require_once __DIR__.'/../config/config.php'; app_method('GET'); app_admin();
header('Content-Type: application/json; charset=utf-8');

$User_Id = isset($_GET['User_Id']) ? $_GET['User_Id'] : '';
$data = [];

if ($User_Id !== '') {
    $stmt = $conn->prepare("
        SELECT d.Department_Id, d.Department_Name
        FROM t_user_department ud
        JOIN t_department d ON ud.Department_Id = d.Department_Id
        WHERE ud.User_Id = ?
    ");
    $stmt->bind_param("s", $User_Id);
    $stmt->execute();
    $result = $stmt->get_result();

    while ($row = $result->fetch_assoc()) {
        $data[] = $row;
    }
    $stmt->close();
}

echo json_encode(["status" => "success", "data" => $data]);
?>
