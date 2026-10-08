<?php
if (PHP_SAPI!=='cli') exit;
require __DIR__.'/../config/bootstrap.php';
$database=app_settings()['database'];
if (!preg_match('/^eoffice_members_\d+_test$/',$database)) throw new RuntimeException('Disposable member test database required');
$settings=app_settings();
$pdo=new PDO("mysql:host={$settings['host']};port={$settings['port']};charset=utf8mb4",$settings['username'],$settings['password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
if (($argv[1]??'')==='drop') { $pdo->exec("DROP DATABASE IF EXISTS `$database`");exit; }
if (($argv[1]??'')!=='seed') throw new RuntimeException('Unknown action');
$pdo->exec("CREATE DATABASE `$database` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
$pdo->exec("USE `$database`");
$pdo->exec("CREATE TABLE t_user (User_Id INT PRIMARY KEY AUTO_INCREMENT, User_Name VARCHAR(255), User_Email VARCHAR(255) UNIQUE, User_Password VARCHAR(255), User_Status VARCHAR(20), User_Token VARCHAR(64), Phone_Number VARCHAR(30)) ENGINE=InnoDB");
$pdo->exec("CREATE TABLE eoffice_sessions (token_hash CHAR(64) PRIMARY KEY, User_Id INT, expires_at DATETIME, FOREIGN KEY(User_Id) REFERENCES t_user(User_Id) ON DELETE CASCADE) ENGINE=InnoDB");
$pdo->exec("CREATE TABLE eoffice_permissions (User_Id INT, permission VARCHAR(50), PRIMARY KEY(User_Id,permission), FOREIGN KEY(User_Id) REFERENCES t_user(User_Id) ON DELETE CASCADE) ENGINE=InnoDB");
$pdo->exec("CREATE TABLE t_document (Doc_Id INT PRIMARY KEY AUTO_INCREMENT, User_Id INT) ENGINE=InnoDB");
$pdo->exec("CREATE TABLE t_department (Department_Id INT PRIMARY KEY AUTO_INCREMENT, Department_Name VARCHAR(255), Department_Detail TEXT) ENGINE=InnoDB");
$pdo->exec("CREATE TABLE t_user_department (User_Id INT, Department_Id INT, PRIMARY KEY(User_Id,Department_Id), FOREIGN KEY(User_Id) REFERENCES t_user(User_Id) ON DELETE CASCADE, FOREIGN KEY(Department_Id) REFERENCES t_department(Department_Id) ON DELETE CASCADE) ENGINE=InnoDB");
$pdo->exec("CREATE TABLE t_access_rights_department (Doc_Id INT, Department_Id INT) ENGINE=InnoDB");
$pdo->exec("CREATE TABLE eoffice_counters (counter_key VARCHAR(100) PRIMARY KEY,value INT NOT NULL) ENGINE=InnoDB");
$pdo->exec("CREATE TABLE eoffice_migrations (name VARCHAR(100) PRIMARY KEY,applied_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB");
$users=[];$q=$pdo->prepare('INSERT INTO t_user (User_Name,User_Email,User_Password,User_Status,User_Token) VALUES (?,?,?,?,?)');
foreach (['admin'=>'Admin','manager'=>'User','staff'=>'User','basic'=>'User'] as $name=>$status) {
    $q->execute([$name,$name.'@example.test',password_hash('Member-Test-2026!',PASSWORD_DEFAULT),$status,bin2hex(random_bytes(32))]);
    $id=(int)$pdo->lastInsertId();$token=bin2hex(random_bytes(32));
    $pdo->prepare('INSERT INTO eoffice_sessions VALUES (?,?,?)')->execute([hash('sha256',$token),$id,date('Y-m-d H:i:s',time()+3600)]);
    $users[$name]=['id'=>$id,'cookie'=>'User_Token='.$token];
}
require_once __DIR__.'/../config/sign-routing.php';
app_sign_routes_migrate(app_pdo());
echo json_encode($users,JSON_THROW_ON_ERROR);
