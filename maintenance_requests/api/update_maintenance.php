<?php
require_once __DIR__.'/../../config/bootstrap.php';app_method('POST');app_permission('maintenance');$d=app_input();$id=(int)($d['id']??0);
$consideration=app_text($d,'considerationStatus',30,true);$result=app_text($d,'actionResult',30,true);if(!in_array($consideration,['pending','can_proceed','cannot_proceed'],true)||!in_array($result,['pending','fixed','cannot_fix'],true))app_fail('Invalid status');
$materials=$d['materials']??[];if(!is_array($materials)||count($materials)>100)app_fail('Invalid materials');$clean=[];foreach($materials as $m){if(!is_array($m))app_fail('Invalid material');$name=app_text($m,'name',255,true);$qty=app_text($m,'qty',100,true);$clean[]=['name'=>$name,'qty'=>$qty];}
$pdo=app_pdo();$q=$pdo->prepare('SELECT id FROM maintenance_requests WHERE id=?');$q->execute([$id]);if(!$q->fetch())app_fail('ไม่พบใบแจ้งซ่อม',404);
$pdo->prepare('UPDATE maintenance_requests SET consideration_status=?,assigned_to=?,reason_cannot_proceed=?,materials=?,action_result=?,reason_cannot_fix=?,repair_details=? WHERE id=?')->execute([$consideration,app_text($d,'assignedTo',255),app_text($d,'reasonCannotProceed',500),$clean?json_encode($clean,JSON_UNESCAPED_UNICODE):null,$result,app_text($d,'reasonCannotFix',500),app_text($d,'repairDetails',10000),$id]);
app_json(['status'=>'success','message'=>'บันทึกผลการซ่อมสำเร็จ']);
