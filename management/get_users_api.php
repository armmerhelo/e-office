<?php
require_once __DIR__.'/../config/bootstrap.php'; app_method('GET'); $actor=app_permission('members');
require_once __DIR__.'/../config/sign-routing.php';
$pdo=app_pdo();$search='%'.app_text($_GET,'search',255).'%';$limit=max(1,min(200,(int)($_GET['limit']??20)));$page=max(1,(int)($_GET['page']??1));
$filter=app_text($_GET,'permission',50);$catalog=app_permission_catalog();
if ($filter!=='' && $filter!=='Admin' && !isset($catalog[$filter])) app_fail('สิทธิ์ไม่ถูกต้อง');
$where='u.User_Name LIKE ?';$params=[$search];
if ($filter==='Admin') $where.=" AND u.User_Status='Admin'";
elseif ($filter!=='') { $where.=" AND (u.User_Status='Admin' OR EXISTS (SELECT 1 FROM eoffice_permissions p WHERE p.User_Id=u.User_Id AND p.permission=?))"; $params[]=$filter; }
$q=$pdo->prepare("SELECT COUNT(*) FROM t_user u WHERE $where");$q->execute($params);$total=(int)$q->fetchColumn();$page=min($page,max(1,(int)ceil($total/$limit)));$offset=($page-1)*$limit;
$q=$pdo->prepare("SELECT u.User_Id,u.User_Name,u.User_Email,u.User_Status,u.Phone_Number FROM t_user u WHERE $where ORDER BY u.User_Id LIMIT $limit OFFSET $offset");$q->execute($params);$users=$q->fetchAll();
$grants=[];$signRoles=[];
if ($users) {
    $ids=array_column($users,'User_Id');$marks=implode(',',array_fill(0,count($ids),'?'));
    $q=$pdo->prepare("SELECT User_Id,permission FROM eoffice_permissions WHERE User_Id IN ($marks)");$q->execute($ids);
    foreach ($q->fetchAll() as $row) if (isset($catalog[$row['permission']])) $grants[$row['User_Id']][]=$row['permission'];
    $q=$pdo->prepare("SELECT secretary_id,department,deputy_id FROM eoffice_sign_routes WHERE secretary_id IN ($marks) OR deputy_id IN ($marks)");$q->execute([...$ids,...$ids]);
    foreach ($q->fetchAll() as $row) {
        $scope=$row['department']?:'ทุกฝ่าย (คู่เดิม)';
        $signRoles[$row['secretary_id']][]='เลขาฝ่าย — '.$scope;
        $signRoles[$row['deputy_id']][]='รองฝ่าย — '.$scope;
    }
}
foreach ($users as &$user) {
    $user['permissions']=$user['User_Status']==='Admin' ? array_keys($catalog) : array_values(array_intersect(array_keys($catalog),$grants[$user['User_Id']]??[]));
    $user['sign_roles']=array_values(array_unique($signRoles[$user['User_Id']]??[]));
    $user['can_edit']=$actor['User_Status']==='Admin' || ($user['User_Status']!=='Admin' && ((!$user['permissions'] && !$user['sign_roles']) || (int)$user['User_Id']===(int)$actor['User_Id']));
}
unset($user);
app_json(['status'=>'success','data'=>$users,'total'=>$total,'page'=>$page,'permission_catalog'=>$catalog,'can_manage_permissions'=>$actor['User_Status']==='Admin']);
