<?php
require_once __DIR__.'/../config/bootstrap.php';app_method('GET','POST','PUT','DELETE');$user=app_user();$pdo=app_pdo();$admin=app_can($user,'external_numbers');
$method=$_SERVER['REQUEST_METHOD'];
if($method==='GET'){$year=(string)(int)($_GET['year']??date('Y')+543);$q=$pdo->prepare("SELECT b.id,b.User_Id,u.User_Name,b.Doc_Detail,CONCAT(LPAD(b.External_Number,3,'0'),'/',b.Doc_Year) AS External_Number,b.Doc_Year FROM t_external_number_booking b LEFT JOIN t_user u ON u.User_Id=b.User_Id WHERE b.Doc_Year=? ORDER BY b.id DESC");$q->execute([$year]);app_json(['status'=>'success','isAdmin'=>$admin,'data'=>$q->fetchAll()]);}
$d=app_input();
if($method==='POST'){
 $detail=app_text($d,'docDetail',300,true);$year=(string)($d['docYear']??date('Y')+543);if(!preg_match('/^\d{4}$/',$year))app_fail('Invalid year');
 $key='external:'.$year;
 // Initialize in autocommit: INSERT IGNORE inside the transaction takes a shared
 // duplicate-key lock which can deadlock when multiple writers upgrade it.
 $pdo->prepare('INSERT IGNORE INTO eoffice_counters (counter_key,value) VALUES (?,0)')->execute([$key]);
 $pdo->beginTransaction();
 try{$q=$pdo->prepare('SELECT value FROM eoffice_counters WHERE counter_key=? FOR UPDATE');$q->execute([$key]);$value=(int)$q->fetchColumn();
  $q=$pdo->prepare('SELECT COALESCE(MAX(External_Number),0) FROM t_external_number_booking WHERE Doc_Year=?');$q->execute([$year]);$next=max($value,(int)$q->fetchColumn())+1;
  $pdo->prepare('UPDATE eoffice_counters SET value=? WHERE counter_key=?')->execute([$next,$key]);$pdo->prepare('INSERT INTO t_external_number_booking (User_Id,Doc_Detail,External_Number,Doc_Year) VALUES (?,?,?,?)')->execute([$user['User_Id'],$detail,$next,$year]);$id=(int)$pdo->lastInsertId();$pdo->commit();
 }catch(Throwable $e){$pdo->rollBack();throw $e;}
 app_json(['status'=>'success','message'=>'จองเลขสำเร็จ','data'=>['id'=>$id,'External_Number'=>str_pad((string)$next,3,'0',STR_PAD_LEFT).'/'.$year,'Doc_Detail'=>$detail,'User_Name'=>$user['User_Name']]]);
}
if(!$admin)app_fail('Admin only',403);$id=(int)($d['id']??0);if($id<=0)app_fail('Invalid id');
if($method==='PUT')$pdo->prepare('UPDATE t_external_number_booking SET Doc_Detail=? WHERE id=?')->execute([app_text($d,'docDetail',300,true),$id]);
else $pdo->prepare('DELETE FROM t_external_number_booking WHERE id=?')->execute([$id]);
app_json(['status'=>'success','message'=>'ดำเนินการสำเร็จ']);
