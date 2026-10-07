<?php
require_once __DIR__.'/../config/bootstrap.php'; app_method('GET'); app_admin();
$pdo=app_pdo();$search='%'.app_text($_GET,'search',255).'%';$limit=max(1,min(200,(int)($_GET['limit']??20)));$page=max(1,(int)($_GET['page']??1));
$q=$pdo->prepare('SELECT COUNT(*) FROM t_user WHERE User_Name LIKE ?');$q->execute([$search]);$total=(int)$q->fetchColumn();$page=min($page,max(1,(int)ceil($total/$limit)));$offset=($page-1)*$limit;
$q=$pdo->prepare("SELECT User_Id,User_Name,User_Email,User_Status,Phone_Number FROM t_user WHERE User_Name LIKE ? ORDER BY User_Id LIMIT $limit OFFSET $offset");$q->execute([$search]);
app_json(['status'=>'success','data'=>$q->fetchAll(),'total'=>$total,'page'=>$page]);
