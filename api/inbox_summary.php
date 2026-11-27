<?php
require_once __DIR__.'/../config/bootstrap.php';
require_once __DIR__.'/../config/inbox-completion.php';

app_method('POST');
header('Cache-Control: no-store');
$user=app_user();
$uid=(int)$user['User_Id'];
$data=app_input();
$year=(string)($data['Year']??date('Y')+543);
if(!preg_match('/^\d{4}$/',$year))app_fail('Invalid year');

$pdo=app_pdo();
$where="d.Is_Delete='active' AND d.Doc_Year=? AND (
    EXISTS (SELECT 1 FROM t_access_rights a WHERE a.Doc_Id=d.Doc_Id AND a.User_Id=?)
    OR EXISTS (
        SELECT 1 FROM t_access_rights_department a
        JOIN t_user_department u ON u.Department_Id=a.Department_Id
        WHERE a.Doc_Id=d.Doc_Id AND u.User_Id=?
    )
)";
$completed=app_inbox_completed_sql($uid);
$q=$pdo->prepare("SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN $completed THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN NOT ($completed) THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN NOT ($completed) AND d.Status='Urgent' THEN 1 ELSE 0 END) AS urgent
    FROM t_document d WHERE $where");
$q->execute([$year,$uid,$uid]);
$row=$q->fetch()?:[];
$counts=[];
foreach(['total','pending','urgent','completed'] as $key)$counts[$key]=(int)($row[$key]??0);

app_json([
    'status'=>'success',
    'year'=>$year,
    'counts'=>$counts,
]);
