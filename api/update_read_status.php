<?php
require_once __DIR__ . '/../config/bootstrap.php';
app_method('POST'); $user=app_user(); $data=app_input(); $id=(int)($data['doc_id']??0);
app_document_transaction();app_locked_document($id,$user);
$q=app_pdo()->prepare("INSERT INTO t_access_rights (User_Id,Doc_Id,Status,Date,alert_to) VALUES (?,?,'Readed',?,0) ON DUPLICATE KEY UPDATE Status='Readed',Date=IF(Date='',VALUES(Date),Date)");
$q->execute([$user['User_Id'],$id,date('d/m/Y H:i')]);
if ($q->rowCount()>0) app_audit('document.read',$user,$id);
app_pdo()->commit();
app_json(['status'=>'success']);
