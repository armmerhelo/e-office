<?php
require_once __DIR__ . '/../config/bootstrap.php';
app_method('POST'); $user=app_user(); $data=app_input(); $id=(int)($data['Doc_Id']??0);
app_document_transaction();$doc=app_locked_document($id,$user,true);
app_pdo()->prepare("UPDATE t_document SET Is_Delete='delete',Is_Delete_Time=NOW() WHERE Doc_Id=?")->execute([$id]);
app_pdo()->commit();
app_json(['status'=>'success','message'=>'ลบเอกสารเรียบร้อย','doc_id'=>$id]);
