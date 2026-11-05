<?php
// Additive synthetic accounts only, for the opt-in local browser suite.
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/bootstrap.php';
$settings=app_settings();
if(!$settings['mock']||!preg_match('/^eoffice_siya_news_[a-z0-9_]+_test$/D',$settings['database'])||!in_array($settings['host'],['127.0.0.1','localhost'],true))throw new RuntimeException('Isolated local SIYA NEWS mock database required');
$password=getenv('EOFFICE_QA_PASSWORD');if(!is_string($password)||strlen($password)<12)throw new RuntimeException('QA password required');
$pdo=app_pdo();$suffix=bin2hex(random_bytes(6));$accounts=[];
foreach(['submit'=>'news_submit','submit2'=>'news_submit','editor'=>'news_editor','producer'=>'news_producer','none'=>null] as $role=>$permission){
    $email="siya-$role-$suffix@localhost.test";
    $pdo->prepare("INSERT INTO t_user(User_Name,User_Email,User_Password,User_Status,User_Token) VALUES(?,?,?,'User',?)")->execute(['Synthetic SIYA '.$role,$email,password_hash($password,PASSWORD_DEFAULT),bin2hex(random_bytes(32))]);
    $id=(int)$pdo->lastInsertId();
    if($permission)$pdo->prepare('INSERT INTO eoffice_permissions(User_Id,permission) VALUES(?,?)')->execute([$id,$permission]);
    $accounts[$role]=$email;
}
echo json_encode($accounts,JSON_THROW_ON_ERROR),PHP_EOL;
