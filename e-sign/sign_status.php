<?php
require_once __DIR__.'/../config/sign-routing.php';
app_method('GET');
$user=app_user();
$id=filter_var($_GET['Doc_Id']??0,FILTER_VALIDATE_INT,['options'=>['min_range'=>1]])?:0;
if($id<1)app_fail('ไม่พบเอกสาร',404);
$doc=app_document($id,$user);
$pdo=app_pdo();

$q=$pdo->prepare('SELECT Is_Signed,Date FROM t_access_rights WHERE Doc_Id=? AND User_Id=?');
$q->execute([$id,$user['User_Id']]);$myAccess=$q->fetch()?:[];

$q=$pdo->prepare("SELECT a.User_Id,a.Is_Signed,a.Date,u.User_Name FROM t_access_rights a LEFT JOIN t_user u ON u.User_Id=a.User_Id WHERE a.Doc_Id=? AND a.Is_Signed='true' ORDER BY a.Date,a.User_Id LIMIT 200");
$q->execute([$id]);$signers=$q->fetchAll();

$q=$pdo->prepare('SELECT r.file_name,r.revision,r.department,r.received_at,u.User_Name FROM eoffice_document_receipts r LEFT JOIN t_user u ON u.User_Id=r.secretary_id WHERE r.Doc_Id=? ORDER BY r.received_at DESC,r.department LIMIT 200');
$q->execute([$id]);$receipts=$q->fetchAll();

$q=$pdo->prepare('SELECT file_name,revision,signed_at FROM eoffice_signed_files WHERE Doc_Id=? ORDER BY signed_at DESC,file_name LIMIT 50');
$q->execute([$id]);$files=$q->fetchAll();

$q=$pdo->prepare("SELECT occurred_at,actor_name,metadata FROM eoffice_audit_log WHERE event='document.sign' AND target_id=? ORDER BY id DESC LIMIT 50");
$q->execute([$id]);$audit=[];
foreach($q as $row){
    $metadata=json_decode((string)$row['metadata'],true);
    if(!is_array($metadata))$metadata=[];
    $audit[]=['occurred_at'=>$row['occurred_at'],'actor_name'=>$row['actor_name'],'method'=>$metadata['signature_method']??null,'departments'=>$metadata['signature_departments']??[],'receipt_departments'=>$metadata['receipt_departments']??[]];
}

app_json([
    'status'=>'success',
    'document'=>[
        'id'=>(int)$doc['Doc_Id'],
        'number'=>(string)($doc['Doc_Number']??''),
        'name'=>(string)($doc['Doc_Name']??''),
        'year'=>(string)($doc['Doc_Year']??''),
        'my_signed'=>($myAccess['Is_Signed']??'false')==='true',
        'my_signed_date'=>(string)($myAccess['Date']??''),
    ],
    'signers'=>$signers,
    'receipts'=>$receipts,
    'files'=>$files,
    'audit'=>$audit,
]);
