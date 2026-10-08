<?php
require_once __DIR__.'/../config/sign-routing.php';
app_method('GET');$user=app_user();app_document((int)($_GET['Doc_Id']??0),$user);
$q=app_pdo()->prepare('SELECT department FROM eoffice_sign_routes WHERE secretary_id=?');
$q->execute([$user['User_Id']]);$scopes=$q->fetchAll(PDO::FETCH_COLUMN);
app_json(['status'=>'success','departments'=>in_array('',$scopes,true)?app_sign_departments():array_values(array_intersect(app_sign_departments(),$scopes))]);
