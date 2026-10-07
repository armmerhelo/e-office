<?php
require_once __DIR__.'/config_roombooking.php';app_method('GET');$user=app_user();$admin=app_can($user,'room_booking');
$q=app_pdo()->prepare('SELECT * FROM room_bookings'.($admin?'':' WHERE User_Id=?').' ORDER BY start_datetime DESC LIMIT 1000');$q->execute($admin?[]:[$user['User_Id']]);
app_json(['status'=>'success','user_id'=>(int)$user['User_Id'],'is_admin'=>$admin,'data'=>$q->fetchAll()]);
