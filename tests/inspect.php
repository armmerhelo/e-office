<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/bootstrap.php';
if(!str_ends_with(app_settings()['database'],'_test'))throw new RuntimeException('Only test databases are allowed');
$pdo=app_pdo();$action=$argv[1]??'';$value=$argv[2]??'';
switch($action){
 case 'registration':$q=$pdo->prepare('SELECT register_token FROM t_register_check WHERE register_email=? ORDER BY register_check_id DESC LIMIT 1');$q->execute([$value]);$result=$q->fetchColumn();break;
 case 'user':$q=$pdo->prepare('SELECT User_Id,User_Password,User_Status FROM t_user WHERE User_Email=?');$q->execute([$value]);$u=$q->fetch();$result=$u?['id'=>(int)$u['User_Id'],'hashed'=>password_get_info($u['User_Password'])['algoName']!=='unknown','status'=>$u['User_Status']]:null;break;
 case 'access':$q=$pdo->prepare('SELECT * FROM t_access_rights WHERE Doc_Id=?');$q->execute([(int)$value]);$result=$q->fetchAll();break;
 case 'history':$q=$pdo->prepare('SELECT snapshot FROM eoffice_access_history WHERE Doc_Id=?');$q->execute([(int)$value]);$result=array_map(fn($v)=>json_decode($v,true),$q->fetchAll(PDO::FETCH_COLUMN));break;
 case 'outbox':$q=$pdo->query('SELECT payload,status FROM eoffice_outbox ORDER BY id DESC LIMIT 1000');$result=array_map(fn($v)=>['payload'=>json_decode($v['payload'],true),'status'=>$v['status']],$q->fetchAll());break;
 case 'previous_year':$pdo->prepare("UPDATE t_document SET Doc_Year='2568' WHERE Doc_Id=?")->execute([(int)$value]);$result=true;break;
 case 'remove_template':$filename=basename($value);if(!preg_match('/^\d+_[a-f0-9]{32}\.png$/',$filename))throw new RuntimeException('Invalid test filename');$file=__DIR__.'/../e-sign/generated_images/'.$filename;$result=is_file($file)?unlink($file):false;break;
 default:throw new RuntimeException('Unknown inspection');
}
echo json_encode($result,JSON_THROW_ON_ERROR);
