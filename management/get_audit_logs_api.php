<?php
require_once __DIR__.'/../config/bootstrap.php';
app_method('GET');app_admin();
$category=app_text($_GET,'category',32);$outcome=app_text($_GET,'outcome',16);$search=app_text($_GET,'search',100);
$from=app_text($_GET,'from',10);$to=app_text($_GET,'to',10);
if ($from!=='') app_date($from);
if ($to!=='') app_date($to);
if ($from!==''&&$to!==''&&$from>$to) app_fail('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด');
if ($category!==''&&!isset(app_audit_categories()[$category])) app_fail('ประเภทกิจกรรมไม่ถูกต้อง');
if ($outcome!==''&&!in_array($outcome,['success','failure'],true)) app_fail('ผลลัพธ์ไม่ถูกต้อง');
$page=filter_var($_GET['page']??1,FILTER_VALIDATE_INT,['options'=>['min_range'=>1,'max_range'=>1000000]]);
$limit=filter_var($_GET['limit']??25,FILTER_VALIDATE_INT,['options'=>['min_range'=>1,'max_range'=>100]]);
if ($page===false||$limit===false) app_fail('เลขหน้าหรือจำนวนรายการไม่ถูกต้อง');
$where=[];$params=[];
foreach (['category'=>$category,'outcome'=>$outcome] as $column=>$value) if ($value!=='') {$where[]="$column=?";$params[]=$value;}
if ($from!=='') {$where[]='occurred_at>=?';$params[]=$from.' 00:00:00';}
if ($to!=='') {$where[]='occurred_at<?';$params[]=(new DateTimeImmutable($to))->modify('+1 day')->format('Y-m-d').' 00:00:00';}
if ($search!=='') {
    $like='%'.strtr($search,['!'=>'!!','%'=>'!%','_'=>'!_']).'%';
    $where[]="(actor_name LIKE ? ESCAPE '!' OR event LIKE ? ESCAPE '!' OR ip_address LIKE ? ESCAPE '!' OR CAST(actor_id AS CHAR)=? OR CAST(target_id AS CHAR)=?)";
    array_push($params,$like,$like,$like,$search,$search);
}
$sql=$where?' WHERE '.implode(' AND ',$where):'';$pdo=app_pdo();
// A consistent read keeps count and rows in sync when new logs arrive.
$pdo->beginTransaction();
try {
    $q=$pdo->prepare('SELECT COUNT(*) FROM eoffice_audit_log'.$sql);$q->execute($params);$total=(int)$q->fetchColumn();
    $pages=max(1,(int)ceil($total/$limit));$page=min($page,$pages);$offset=($page-1)*$limit;
    $q=$pdo->prepare('SELECT * FROM eoffice_audit_log'.$sql." ORDER BY occurred_at DESC,id DESC LIMIT $limit OFFSET $offset");$q->execute($params);$rows=$q->fetchAll();
    $pdo->commit();
} catch (Throwable $e) {if($pdo->inTransaction())$pdo->rollBack();throw $e;}
$catalog=app_audit_catalog();
foreach ($rows as &$row) {
    $row['id']=(string)$row['id'];$row['actor_id']=$row['actor_id']===null?null:(int)$row['actor_id'];
    $row['target_id']=$row['target_id']===null?null:(string)$row['target_id'];
    $row['label']=$catalog[$row['event']][1]??$row['event'];
    $row['metadata']=json_decode($row['metadata'],true,512,JSON_THROW_ON_ERROR);
    $row['occurred_at']=str_replace(' ','T',$row['occurred_at']).'+07:00';
}
unset($row);
app_json(['status'=>'success','data'=>$rows,'total'=>$total,'page'=>$page,'pages'=>$pages,'limit'=>$limit,'categories'=>app_audit_categories()]);
