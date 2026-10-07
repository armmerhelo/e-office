<?php
require_once __DIR__.'/../config/bootstrap.php';app_method('GET','POST');app_permission('email');
$rows=app_pdo()->query("SELECT doc_id,COUNT(*) total_count,SUM(delivery_status='success') success_count,SUM(delivery_status='failed') failed_count,SUM(delivery_status='pending') pending_count FROM email_logs GROUP BY doc_id")->fetchAll();
$ids=[];$statuses=[];foreach($rows as $row){$id=$row['doc_id'];if($row['success_count'])$ids[]=$id;$statuses[$id]=array_map('intval',array_diff_key($row,['doc_id'=>true]));}
app_json(['status'=>'success','sent_ids'=>$ids,'doc_statuses'=>$statuses]);
