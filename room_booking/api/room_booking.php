<?php
require_once __DIR__.'/config_roombooking.php';app_method('POST');$data=app_input();$user=app_user(false);
$name=app_text($data,'requesterName',255,true);$room=app_text($data,'roomSelect',100,true);if($room==='อื่นๆ')$room=app_text($data,'otherRoom',100,true);
$topic=app_text($data,'topic',255,true);$dept=app_text($data,'department',100,true);
[$start,$end]=app_times(app_text($data,'startDate',10,true).' '.app_text($data,'startTime',5,true).':00',app_text($data,'endDate',10,true).' '.app_text($data,'endTime',5,true).':00');
$attendees=filter_var($data['attendees']??null,FILTER_VALIDATE_INT,['options'=>['min_range'=>1,'max_range'=>10000]]);if($attendees===false)app_fail('Invalid attendees');
$eq=$data['equipment']??[];if(!is_array($eq))app_fail('Invalid equipment');
$pdo=app_pdo();$lock='room:'.substr(hash('sha256',$room),0,55);$q=$pdo->prepare('SELECT GET_LOCK(?,5)');$q->execute([$lock]);if(!$q->fetchColumn())app_fail('กรุณาลองใหม่',409);
try{$q=$pdo->prepare("SELECT 1 FROM room_bookings WHERE room_name=? AND status IN ('confirm','confirmed') AND start_datetime<? AND end_datetime>? LIMIT 1");$q->execute([$room,$end,$start]);if($q->fetchColumn())app_fail('ห้องถูกจองแล้ว',409);
 $q=$pdo->prepare("INSERT INTO room_bookings (User_Id,requester_name,room_name,topic,department,attendees,start_datetime,end_datetime,equipment_audio,equipment_computer,equipment_projector,equipment_food,equipment_other,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')");
 $q->execute([$user['User_Id']??null,$name,$room,$topic,$dept,$attendees,$start,$end,!empty($eq['audio'])?1:0,!empty($eq['computer'])?1:0,!empty($eq['projector'])?1:0,!empty($eq['food'])?1:0,app_text($eq,'otherText')]);$id=(int)$pdo->lastInsertId();
}finally{$pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([$lock]);}
app_json(['status'=>'success','message'=>'บันทึกการจองสำเร็จ','id'=>$id]);
