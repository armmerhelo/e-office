<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/bootstrap.php';
if(!str_ends_with(app_settings()['database'],'_test'))throw new RuntimeException('Only test databases are allowed');
$pdo=app_pdo();$action=$argv[1]??'';$value=$argv[2]??'';
switch($action){
 case 'inbox_after_cutoff':
  foreach(['t_access_rights','t_access_rights_department'] as $table)$pdo->prepare("UPDATE $table SET Inbox_Delivered_At='2026-10-30 17:00:00' WHERE Doc_Id=?")->execute([(int)$value]);
  $result=true;break;
 case 'inbox_before_cutoff':
  foreach(['t_access_rights','t_access_rights_department'] as $table)$pdo->prepare("UPDATE $table SET Inbox_Delivered_At='2026-10-30 16:59:59' WHERE Doc_Id=?")->execute([(int)$value]);
  $result=true;break;
 case 'inbox_unknown':
  foreach(['t_access_rights','t_access_rights_department'] as $table)$pdo->prepare("UPDATE $table SET Inbox_Delivered_At=NULL WHERE Doc_Id=?")->execute([(int)$value]);
  $result=true;break;
 case 'inbox_group_legacy':
  $pdo->prepare('UPDATE t_user_department u JOIN t_access_rights_department a ON a.Department_Id=u.Department_Id SET u.Inbox_Delivered_At=NULL,a.Inbox_Delivered_At=NULL WHERE a.Doc_Id=?')->execute([(int)$value]);$result=true;break;
 case 'inbox_group_times':
  $q=$pdo->prepare('SELECT a.Department_Id,a.Inbox_Delivered_At grant_time,u.User_Id,u.Inbox_Delivered_At member_time FROM t_access_rights_department a JOIN t_user_department u ON u.Department_Id=a.Department_Id WHERE a.Doc_Id=? ORDER BY a.Department_Id,u.User_Id');$q->execute([(int)$value]);$result=$q->fetchAll();break;
 case 'registration':$q=$pdo->prepare('SELECT register_token FROM t_register_check WHERE register_email=? ORDER BY register_check_id DESC LIMIT 1');$q->execute([$value]);$result=$q->fetchColumn();break;
 case 'user':$q=$pdo->prepare('SELECT User_Id,User_Password,User_Status FROM t_user WHERE User_Email=?');$q->execute([$value]);$u=$q->fetch();$result=$u?['id'=>(int)$u['User_Id'],'hashed'=>password_get_info($u['User_Password'])['algoName']!=='unknown','status'=>$u['User_Status']]:null;break;
 case 'access':$q=$pdo->prepare('SELECT * FROM t_access_rights WHERE Doc_Id=?');$q->execute([(int)$value]);$result=$q->fetchAll();break;
 case 'history':$q=$pdo->prepare('SELECT snapshot FROM eoffice_access_history WHERE Doc_Id=?');$q->execute([(int)$value]);$result=array_map(fn($v)=>json_decode($v,true),$q->fetchAll(PDO::FETCH_COLUMN));break;
 case 'outbox':$q=$pdo->query('SELECT payload,status FROM eoffice_outbox ORDER BY id DESC LIMIT 1000');$result=array_map(fn($v)=>['payload'=>json_decode($v['payload'],true),'status'=>$v['status']],$q->fetchAll());break;
 case 'outbox_count':$result=(int)$pdo->query('SELECT COUNT(*) FROM eoffice_outbox')->fetchColumn();break;
 case 'previous_year':$pdo->prepare("UPDATE t_document SET Doc_Year='2568' WHERE Doc_Id=?")->execute([(int)$value]);$result=true;break;
 case 'remove_template':$filename=basename($value);if(!preg_match('/^\d+_[a-f0-9]{32}\.png$/',$filename))throw new RuntimeException('Invalid test filename');$file=__DIR__.'/../e-sign/generated_images/'.$filename;$result=is_file($file)?unlink($file):false;break;
 default:throw new RuntimeException('Unknown inspection');
}
echo json_encode($result,JSON_THROW_ON_ERROR);
