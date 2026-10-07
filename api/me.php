<?php
require_once __DIR__ . '/../config/bootstrap.php';
app_method('GET');
$user = app_user(false);
app_json(['status'=>'success', 'user'=>$user ? ['id'=>(int)$user['User_Id'], 'name'=>$user['User_Name'], 'status'=>$user['User_Status'], 'permissions'=>array_values(array_filter(['maintenance','room_booking','email','external_numbers'],fn($p)=>app_can($user,$p)))] : null]);
