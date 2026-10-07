<?php
require_once __DIR__.'/../config/boardcast.php';app_method('GET','POST');
if(isset($_GET['id1'])){
 boardcast_writer();$pdo=boardcast_db();$pdo->beginTransaction();$q=$pdo->prepare('UPDATE parking_slots SET is_occupied=? WHERE id=?');$updated=[];
 for($i=1;isset($_GET['id'.$i])&&$i<=100;$i++){$id=app_text($_GET,'id'.$i,100,true);$occupied=(int)($_GET['occupied'.$i]??0);if(!in_array($occupied,[0,1],true))app_fail('Invalid occupancy');$q->execute([$occupied,$id]);$updated[]=['id'=>$id,'status'=>$occupied];}$pdo->commit();app_json(['status'=>'success','details'=>$updated]);
}
$rows=boardcast_db()->query('SELECT id,zone,is_occupied,type,last_update FROM parking_slots ORDER BY zone,id')->fetchAll();foreach($rows as &$row)$row['is_occupied']=(bool)$row['is_occupied'];app_json($rows);
