<?php
require_once __DIR__ . '/../config/bootstrap.php';
app_method('POST'); $user = app_user(); $data = app_input();
$target = app_text($data, 'target_Id', 100, true);
if (!preg_match('/^[a-zA-Z0-9-]{10,100}$/', $target)) app_fail('Invalid subscription');
$q = app_pdo()->prepare('INSERT INTO t_target_id (target_Id,User_Id) VALUES (?,?) ON DUPLICATE KEY UPDATE User_Id=VALUES(User_Id)');
$q->execute([$target, $user['User_Id']]);
app_json(['status'=>'success']);
