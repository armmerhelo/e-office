<?php
require_once __DIR__ . '/../config/bootstrap.php';
app_method('GET');
$user = app_user(false);
app_json(['status'=>'success', 'user'=>$user ? ['id'=>(int)$user['User_Id'], 'name'=>$user['User_Name'], 'status'=>$user['User_Status'], 'permissions'=>app_user_permissions($user)] : null]);
