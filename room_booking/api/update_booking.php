<?php
require_once __DIR__.'/config_roombooking.php';app_method('POST');$user=app_user();$d=app_input();$id=(int)($d['id']??0);$pdo=app_pdo();
$q=$pdo->prepare('SELECT * FROM room_bookings WHERE id=?');$q->execute([$id]);$booking=$q->fetch();if(!$booking)app_fail('ไม่พบรายการ',404);
if(!app_can($user,'room_booking')&&(int)$booking['User_Id']!==(int)$user['User_Id'])app_fail('คุณไม่มีสิทธิ์แก้ไขรายการนี้',403);
$room=app_text($d,'room_name',100,true);$topic=app_text($d,'topic',255,true);$name=app_text($d,'requester_name',255,true);$dept=app_text($d,'department',100,true);
[$start,$end]=app_times(app_text($d,'start_datetime',19,true),app_text($d,'end_datetime',19,true));$count=filter_var($d['attendees']??null,FILTER_VALIDATE_INT,['options'=>['min_range'=>1,'max_range'=>10000]]);if($count===false)app_fail('Invalid attendees');
$lock='room:'.substr(hash('sha256',$room),0,55);$q=$pdo->prepare('SELECT GET_LOCK(?,5)');$q->execute([$lock]);if(!$q->fetchColumn())app_fail('กรุณาลองใหม่',409);
try{$pdo->beginTransaction();$q=$pdo->prepare('SELECT User_Id FROM room_bookings WHERE id=? FOR UPDATE');$q->execute([$id]);$owner=$q->fetchColumn();if(!app_can($user,'room_booking')&&(int)$owner!==(int)$user['User_Id']){ $pdo->rollBack();app_fail('Forbidden',403); }
 $q=$pdo->prepare("SELECT 1 FROM room_bookings WHERE room_name=? AND status IN ('confirmed','confirm') AND id<>? AND start_datetime<? AND end_datetime>? LIMIT 1");$q->execute([$room,$id,$end,$start]);if($q->fetchColumn()){$pdo->rollBack();app_fail('ห้องถูกจองแล้ว',409);}
 $pdo->prepare('UPDATE room_bookings SET room_name=?,topic=?,requester_name=?,department=?,attendees=?,start_datetime=?,end_datetime=?,equipment_audio=?,equipment_computer=?,equipment_projector=?,equipment_food=?,equipment_other=? WHERE id=?')->execute([$room,$topic,$name,$dept,$count,$start,$end,!empty($d['equipment_audio'])?1:0,!empty($d['equipment_computer'])?1:0,!empty($d['equipment_projector'])?1:0,!empty($d['equipment_food'])?1:0,app_text($d,'equipment_other'),$id]);$pdo->commit();
}finally{if($pdo->inTransaction())$pdo->rollBack();$pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([$lock]);}
app_json(['status'=>'success','message'=>'แก้ไขการจองสำเร็จ']);
