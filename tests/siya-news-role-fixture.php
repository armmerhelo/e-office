<?php
// Additive synthetic accounts only, for the opt-in local browser suite.
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/siya-news.php';
$settings=app_settings();
if(!$settings['mock']||!preg_match('/^eoffice_siya_news_[a-z0-9_]+_test$/D',$settings['database'])||!in_array($settings['host'],['127.0.0.1','localhost'],true))throw new RuntimeException('Isolated local SIYA NEWS mock database required');
$password=getenv('EOFFICE_QA_PASSWORD');if(!is_string($password)||strlen($password)<12)throw new RuntimeException('QA password required');
if(($argv[1]??'')==='cleanup'){
    $emails=json_decode(stream_get_contents(STDIN),true,16,JSON_THROW_ON_ERROR);$pdo=app_pdo();
    if(!is_array($emails)||!in_array(count($emails),[5,6],true))throw new RuntimeException('Expected exact fixture emails');
    foreach($emails as $email){
        if(!is_string($email)||!preg_match('/^siya-(submit|submit2|editor|producer|none|admin)-[a-f0-9]{12}@localhost\.test$/D',$email))throw new RuntimeException('Invalid fixture email');
        $q=$pdo->prepare("SELECT User_Id FROM t_user WHERE User_Email=? AND User_Name LIKE 'Synthetic SIYA %'");$q->execute([$email]);$id=$q->fetchColumn();if(!$id)continue;
        $q=$pdo->prepare('SELECT i.id,i.extension FROM eoffice_siya_news_images i JOIN eoffice_siya_news n ON n.id=i.news_id WHERE n.owner_id=?');$q->execute([$id]);
        foreach($q->fetchAll() as $image){$path=app_siya_news_image_path($image['id'],$image['extension']);if(is_file($path)&&!unlink($path))throw new RuntimeException('Fixture image cleanup failed');}
        $pdo->prepare('DELETE FROM eoffice_siya_news WHERE owner_id=?')->execute([$id]);
        foreach(['eoffice_sessions','eoffice_permissions','t_user'] as $table)$pdo->prepare('DELETE FROM '.$table.' WHERE User_Id=?')->execute([$id]);
        $lock=app_siya_news_root().'/proofread-'.(int)$id.'.lock';if(is_file($lock)&&!unlink($lock))throw new RuntimeException('Fixture throttle cleanup failed');
    }
    echo "Fixture cleanup complete\n";exit;
}
$pdo=app_pdo();$suffix=bin2hex(random_bytes(6));$accounts=[];
$roles=['submit'=>'news_submit','submit2'=>'news_submit','editor'=>'news_editor','producer'=>'news_producer','none'=>null];if(($argv[1]??'')==='with-admin')$roles['admin']=null;
foreach($roles as $role=>$permission){
    $email="siya-$role-$suffix@localhost.test";
    $pdo->prepare('INSERT INTO t_user(User_Name,User_Email,User_Password,User_Status,User_Token) VALUES(?,?,?,?,?)')->execute(['Synthetic SIYA '.$role,$email,password_hash($password,PASSWORD_DEFAULT),$role==='admin'?'Admin':'User',bin2hex(random_bytes(32))]);
    $id=(int)$pdo->lastInsertId();
    if($permission)$pdo->prepare('INSERT INTO eoffice_permissions(User_Id,permission) VALUES(?,?)')->execute([$id,$permission]);
    $accounts[$role]=$email;
}
echo json_encode($accounts,JSON_THROW_ON_ERROR),PHP_EOL;
