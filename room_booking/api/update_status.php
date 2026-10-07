<?php
require_once __DIR__.'/config_roombooking.php';app_method('POST');app_permission('room_booking');$d=app_input();$id=(int)($d['id']??0);$status=app_text($d,'status',20,true);
if(!in_array($status,['pending','confirmed','cancelled'],true))app_fail('Invalid status');
$pdo=app_pdo();$q=$pdo->prepare('SELECT room_name FROM room_bookings WHERE id=?');$q->execute([$id]);$room=$q->fetchColumn();if($room===false)app_fail('ไม่พบรายการ',404);
$lock='room:'.substr(hash('sha256',$room),0,55);$q=$pdo->prepare('SELECT GET_LOCK(?,5)');$q->execute([$lock]);if(!$q->fetchColumn())app_fail('กรุณาลองใหม่',409);
try{$pdo->beginTransaction();$q=$pdo->prepare('SELECT * FROM room_bookings WHERE id=? FOR UPDATE');$q->execute([$id]);$b=$q->fetch();if(!$b||$b['room_name']!==$room){$pdo->rollBack();app_fail('ข้อมูลเปลี่ยนแปลง กรุณาลองใหม่',409);}
 if($status==='confirmed'){app_times($b['start_datetime'],$b['end_datetime']);$q=$pdo->prepare("SELECT 1 FROM room_bookings WHERE room_name=? AND id<>? AND status IN ('confirm','confirmed') AND start_datetime<? AND end_datetime>? LIMIT 1");$q->execute([$room,$id,$b['end_datetime'],$b['start_datetime']]);if($q->fetchColumn()){$pdo->rollBack();app_fail('ห้องถูกอนุมัติในช่วงนี้แล้ว',409);}}
 $pdo->prepare('UPDATE room_bookings SET status=? WHERE id=?')->execute([$status,$id]);$pdo->commit();
}finally{if($pdo->inTransaction())$pdo->rollBack();$pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([$lock]);}
app_json(['status'=>'success','message'=>'อัปเดตสถานะสำเร็จ']);
