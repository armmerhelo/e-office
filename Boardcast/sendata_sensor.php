<?php
// อนุญาตให้เว็บไซต์อื่นดึงข้อมูลไปใช้ได้ (ป้องกัน CORS Error)
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");

// --- ส่วนนี้คือการจำลองข้อมูล หรือดึงจาก Database ---
// หากคุณมีฐานข้อมูล ให้เขียนคำสั่ง SQL ดึงค่าล่าสุดตรงนี้
$data = array(
    "temp" => 32.5,
    "humidity" => 65,
    "moisture" => 40,
    "last_update" => date("Y-m-d H:i:s")
);

// ส่งข้อมูลออกเป็นรูปแบบ JSON
echo json_encode($data);
?>
