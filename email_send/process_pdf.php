<?php
// Compatibility route: old clients enqueue work and receive an immediate SSE
// terminal event. AI and SMTP are only executed by the CLI worker.
require_once __DIR__.'/../config/order-emails.php';
app_method('POST');$actor=app_permission('email');$input=app_input();$id=(int)($input['doc_id']??0);
if(!empty($input['force_new']))app_fail('กรุณาวิเคราะห์ใหม่จากหน้าติดตามคำสั่ง',409);
$pdo=app_pdo();$lock='email:'.$id;$q=$pdo->prepare('SELECT GET_LOCK(?,0)');$q->execute([$lock]);if(!$q->fetchColumn())app_fail('คำสั่งนี้กำลังทำงาน',409);
$error=null;
try{
    $pdo->beginTransaction();$q=$pdo->prepare("SELECT Doc_Id FROM t_document WHERE Doc_Id=? AND Doc_Type='External' AND Is_Delete='active' FOR UPDATE");$q->execute([$id]);
    if(!$q->fetchColumn()){$pdo->rollBack();$error='ไม่พบคำสั่ง';}
    else{
        $current=app_user(true,true);
        if(!app_can($current,'email')){$pdo->rollBack();$error='คุณไม่มีสิทธิ์ทำรายการนี้';}
        else{$pdo->prepare("INSERT IGNORE INTO eoffice_order_jobs (doc_id,source,status,created_by) VALUES (?,'manual','queued',?)")->execute([$id,$actor['User_Id']]);app_order_audit('enqueue_legacy',(int)$actor['User_Id'],$id);$pdo->commit();}
    }
}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
finally{$pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([$lock]);}
if($error!==null)app_fail($error,409);
header('Content-Type: text/event-stream; charset=utf-8');header('Cache-Control: no-store');
echo 'data: '.json_encode(['status'=>'success','progress'=>100,'message'=>'เพิ่มงานเข้าคิวแล้ว ไม่ต้องรอประมวลผล','summary'=>['queued'=>true,'doc_id'=>$id]],JSON_UNESCAPED_UNICODE)."\n\n";
