<?php
require_once __DIR__.'/../config/sign-routing.php';
app_method('GET');app_admin();
$pdo=app_pdo();$pdo->beginTransaction();
try {
    $routes=app_sign_routes($pdo);
    $users=$pdo->query('SELECT User_Id,User_Name,User_Email FROM t_user ORDER BY User_Name,User_Id')->fetchAll();
    $pdo->commit();
} catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
app_json(['status'=>'success','routes'=>$routes,'route_version'=>app_sign_routes_version($routes),'users'=>$users,'departments'=>app_sign_departments()]);
