<?php
require_once __DIR__.'/../config/services.php';
app_method('POST');app_permission('email');
$processed=app_process_notifications();
$summary=app_pdo()->query("SELECT status,COUNT(*) total FROM eoffice_outbox WHERE status IN ('pending','manual','partial') GROUP BY status")->fetchAll();
$attention=['pending'=>0,'manual'=>0,'partial'=>0];foreach($summary as $row)$attention[$row['status']]=(int)$row['total'];
app_json(['status'=>'success','processed'=>$processed,'queue'=>$attention]);
