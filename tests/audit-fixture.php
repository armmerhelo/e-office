<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/bootstrap.php';
if(!preg_match('/^eoffice_members_\d+_test$/D',app_settings()['database'])||!app_settings()['mock'])throw new RuntimeException('Disposable audit database required');
$pdo=app_pdo();$action=$argv[1]??'';
if($action==='snapshot') {
    echo json_encode(['logs'=>$pdo->query('SELECT * FROM eoffice_audit_log ORDER BY id')->fetchAll(),'users'=>$pdo->query('SELECT User_Id,User_Name FROM t_user ORDER BY User_Id')->fetchAll()],JSON_THROW_ON_ERROR);exit;
}
if($action==='setup') {
    $pdo->exec("CREATE TABLE eoffice_login_attempts (identity_hash CHAR(64) PRIMARY KEY,attempts INT NOT NULL,window_start DATETIME NOT NULL) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE eoffice_google_accounts (google_sub VARCHAR(255) PRIMARY KEY,User_Id INT UNIQUE) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE room_bookings (id INT AUTO_INCREMENT PRIMARY KEY,User_Id INT NULL,requester_name VARCHAR(255),room_name VARCHAR(100),topic VARCHAR(255),department VARCHAR(100),attendees INT,start_datetime DATETIME,end_datetime DATETIME,equipment_audio TINYINT,equipment_computer TINYINT,equipment_projector TINYINT,equipment_food TINYINT,equipment_other TEXT,status VARCHAR(30)) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE maintenance_requests (id INT AUTO_INCREMENT PRIMARY KEY,User_Id INT NULL,requester_name VARCHAR(255),position VARCHAR(255),department VARCHAR(255),phone VARCHAR(50),request_date DATE,repair_types VARCHAR(1000),other_type_detail VARCHAR(255),building VARCHAR(255),room VARCHAR(255),damage_details TEXT,images JSON,consideration_status VARCHAR(30),action_result VARCHAR(30),assigned_to VARCHAR(255),reason_cannot_proceed TEXT,materials JSON,reason_cannot_fix TEXT,repair_details TEXT) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE t_external_number_booking (id INT AUTO_INCREMENT PRIMARY KEY,User_Id INT,Doc_Detail VARCHAR(300),External_Number INT,Doc_Year VARCHAR(4),UNIQUE(Doc_Year,External_Number)) ENGINE=InnoDB");
    exit;
}
if($action==='reject-audit') {$pdo->exec("CREATE TRIGGER audit_reject BEFORE INSERT ON eoffice_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic audit failure'");exit;}
if($action==='allow-audit') {$pdo->exec('DROP TRIGGER audit_reject');exit;}
if($action==='samples') {
    $actor=['User_Id'=>987654,'User_Name'=>'<img src=x onerror=alert(1)> audit 100%_!'];
    app_audit_migrate($pdo);app_audit_migrate($pdo);
    $pdo->beginTransaction();
    app_audit('member.update',$actor,123456,['password'=>'DO-NOT-LOG','token'=>'DO-NOT-LOG','reset_password'=>true]);
    $pdo->prepare('UPDATE eoffice_audit_log SET occurred_at=? WHERE id=?')->execute(['2024-01-02 23:59:59',$pdo->lastInsertId()]);
    app_audit('member.update',$actor,123457,['department_ids'=>[1,2]]);
    $pdo->prepare('UPDATE eoffice_audit_log SET occurred_at=? WHERE id=?')->execute(['2024-01-03 00:00:00',$pdo->lastInsertId()]);
    $pdo->commit();echo '{}';exit;
}
throw new RuntimeException('Unknown audit fixture action');
