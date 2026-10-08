<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/bootstrap.php';
$settings=app_settings();$database=$settings['database'];$action=$argv[1]??'';
if(!preg_match('/^eoffice_amss_\d+_test$/D',$database)||!$settings['mock'])throw new RuntimeException('Disposable mock AMSS database required');
$db=new PDO("mysql:host={$settings['host']};port={$settings['port']};charset=utf8mb4",$settings['username'],$settings['password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
if($action==='drop'){$db->exec("DROP DATABASE IF EXISTS `$database`");exit;}
if($action==='fill-attachments'){
 $pdo=app_pdo();$id=(int)($argv[2]??0);$count=(int)($argv[3]??20);if(!in_array($count,[20,21],true))throw new RuntimeException('Invalid fixture count');
 $q=$pdo->prepare('SELECT d.Doc_File_Link,d.Doc_Year,d.User_Id,u.Doc_Upload_Path FROM t_document d JOIN t_document_upload u ON u.Doc_File_Link=d.Doc_File_Link WHERE d.Doc_Id=? ORDER BY u.Doc_Upload_Id LIMIT 1');$q->execute([$id]);$doc=$q->fetch();if(!$doc)throw new RuntimeException('Fixture document missing');
 $q=$pdo->prepare('SELECT COUNT(*) FROM t_document_upload WHERE Doc_File_Link=?');$q->execute([$doc['Doc_File_Link']]);$existing=(int)$q->fetchColumn();
 for($i=$existing;$i<$count;$i++){$name=bin2hex(random_bytes(16)).'.pdf';if(!copy(app_storage('original',$doc['Doc_Year'],$doc['Doc_Upload_Path']),app_storage('original',$doc['Doc_Year'],$name)))throw new RuntimeException('Fixture PDF copy failed');$pdo->prepare('INSERT INTO t_document_upload (Doc_Upload_Detail,Doc_Upload_Path,Doc_File_Link,User_Id) VALUES (?,?,?,?)')->execute(['Synthetic PDF '.$i,$name,$doc['Doc_File_Link'],$doc['User_Id']]);}
 exit;
}
if($action!=='seed')throw new RuntimeException('Unknown fixture action');
$db->exec("CREATE DATABASE `$database` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");$db->exec("USE `$database`");
try{
 $db->exec("CREATE TABLE t_user (User_Id INT PRIMARY KEY AUTO_INCREMENT,User_Name VARCHAR(255),User_Email VARCHAR(255),User_Password VARCHAR(255),User_Status VARCHAR(20),User_Token VARCHAR(64)) ENGINE=InnoDB");
 $db->exec("CREATE TABLE eoffice_sessions (token_hash CHAR(64) PRIMARY KEY,User_Id INT,expires_at DATETIME) ENGINE=InnoDB");
 $db->exec("CREATE TABLE eoffice_permissions (User_Id INT,permission VARCHAR(50),PRIMARY KEY(User_Id,permission)) ENGINE=InnoDB");
 $db->exec("CREATE TABLE t_document (Doc_Id INT PRIMARY KEY AUTO_INCREMENT,Doc_Number VARCHAR(255),Doc_Name TEXT,Doc_Url TEXT,Doc_Type VARCHAR(20),Doc_Date_Update VARCHAR(30),Status VARCHAR(20),Doc_Number_Receive VARCHAR(255),Doc_Date_Receive VARCHAR(255),Doc_Receive_From TEXT,Doc_Action TEXT,Doc_Other TEXT,External_Number INT,Doc_Url_Name TEXT,Doc_Year VARCHAR(4),User_Id INT,Doc_Date VARCHAR(30),Doc_File_Link VARCHAR(50),Is_Delete VARCHAR(10) DEFAULT 'active') ENGINE=InnoDB");
 $db->exec("CREATE TABLE t_document_upload (Doc_Upload_Id INT PRIMARY KEY AUTO_INCREMENT,Doc_Upload_Detail VARCHAR(1000),Doc_Upload_Path VARCHAR(255),Doc_File_Link VARCHAR(50),User_Id INT) ENGINE=InnoDB");
 $db->exec("CREATE TABLE t_access_rights (id INT PRIMARY KEY AUTO_INCREMENT,User_Id INT,Doc_Id INT,Date VARCHAR(30),alert_to INT,Is_Signed VARCHAR(10) DEFAULT 'false',Stamp_Recieve_Number VARCHAR(20),Stamp_Date_Recieve VARCHAR(30),UNIQUE(User_Id,Doc_Id)) ENGINE=InnoDB");
 $db->exec("CREATE TABLE t_access_rights_department (Doc_Id INT,Department_Id INT) ENGINE=InnoDB");
 $db->exec("CREATE TABLE t_user_department (User_Id INT,Department_Id INT) ENGINE=InnoDB");
 $db->exec("CREATE TABLE eoffice_access_history (id INT PRIMARY KEY AUTO_INCREMENT,Doc_Id INT,User_Id INT,snapshot JSON) ENGINE=InnoDB");
 $db->exec("CREATE TABLE eoffice_outbox (id BIGINT PRIMARY KEY AUTO_INCREMENT,payload JSON,status VARCHAR(20),created_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB");
 // Exercise order integration as well when that feature exists in the checkout.
 $orderSupport=is_file(__DIR__.'/../config/order-email-schema.php');
 if($orderSupport){require __DIR__.'/../config/order-email-schema.php';app_order_email_migrate($db);}
 $users=[];
 foreach(['admin'=>'Admin','owner'=>'User','alice'=>'User','bob'=>'User'] as $name=>$role){
  $db->prepare('INSERT INTO t_user (User_Name,User_Email,User_Status) VALUES (?,?,?)')->execute([$name,$name.'@example.test',$role]);$id=(int)$db->lastInsertId();$token=bin2hex(random_bytes(32));
  $db->prepare('INSERT INTO eoffice_sessions VALUES (?,?,?)')->execute([hash('sha256',$token),$id,date('Y-m-d H:i:s',time()+3600)]);$users[$name]=['id'=>$id,'cookie'=>'User_Token='.$token];
 }
 $pdf="%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n";
 echo json_encode(['users'=>$users,'pdf'=>base64_encode($pdf),'order_support'=>$orderSupport]);
}catch(Throwable $e){$db->exec("DROP DATABASE `$database`");throw $e;}
