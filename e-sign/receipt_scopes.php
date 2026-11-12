<?php
require_once __DIR__.'/../config/sign-routing.php';
app_method('GET');$user=app_user();app_document((int)($_GET['Doc_Id']??0),$user);
$pdo=app_pdo();
$q=$pdo->prepare('SELECT department FROM eoffice_sign_routes WHERE secretary_id=?');
$q->execute([$user['User_Id']]);$scopes=$q->fetchAll(PDO::FETCH_COLUMN);
// A dual-role member must have an explicit department route. Legacy wildcard
// routes cannot expose every department as a valid receipt scope.
if (app_sign_is_deputy($pdo,(int)$user['User_Id'])) $scopes=array_values(array_filter($scopes,static fn($department)=>$department!==''));
app_json(['status'=>'success','departments'=>in_array('',$scopes,true)?app_sign_departments():array_values(array_intersect(app_sign_departments(),$scopes))]);
