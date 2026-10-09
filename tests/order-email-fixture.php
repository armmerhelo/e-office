<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/order-emails.php';
require __DIR__.'/../config/order-email-schema.php';
$settings=app_settings();$database=$settings['database'];
if(!preg_match('/^eoffice_orders_\d+_test$/D',$database)||!$settings['mock'])throw new RuntimeException('Disposable mock order database required');
$action=$argv[1]??'';
if(in_array($action,['seed','drop'],true)){
    $db=new PDO("mysql:host={$settings['host']};port={$settings['port']};charset=utf8mb4",$settings['username'],$settings['password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
    if($action==='drop'){$db->exec("DROP DATABASE IF EXISTS `$database`");exit;}
    $db->exec("CREATE DATABASE `$database` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");$db->exec("USE `$database`");
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
    $db->exec("CREATE TABLE email_logs (id INT PRIMARY KEY AUTO_INCREMENT,doc_id VARCHAR(50),file_name VARCHAR(255),recipient_name VARCHAR(255),recipient_email VARCHAR(255),delivery_status VARCHAR(20),error_message TEXT,created_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB");
    app_order_email_migrate($db);$users=[];
    foreach(['admin'=>'Admin','owner'=>'User','staff'=>'User','alice'=>'User','bob'=>'User','invalid'=>'User'] as $name=>$role){
        $email=$name==='invalid'?'not-an-email':$name.'@example.test';
        $db->prepare('INSERT INTO t_user (User_Name,User_Email,User_Status) VALUES (?,?,?)')->execute([$name,$email,$role]);$id=(int)$db->lastInsertId();$token=bin2hex(random_bytes(32));
        $db->prepare('INSERT INTO eoffice_sessions VALUES (?,?,?)')->execute([hash('sha256',$token),$id,date('Y-m-d H:i:s',time()+3600)]);$users[$name]=['id'=>$id,'cookie'=>'User_Token='.$token];
    }
    $db->prepare("INSERT INTO eoffice_permissions VALUES (?,'email')")->execute([$users['staff']['id']]);
    $objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>'];$pdf="%PDF-1.4\n";$offsets=[];
    foreach($objects as $i=>$object){$offsets[]=strlen($pdf);$pdf.=($i+1)." 0 obj\n$object\nendobj\n";}$xref=strlen($pdf);$pdf.="xref\n0 4\n0000000000 65535 f \n";foreach($offsets as $offset)$pdf.=sprintf("%010d 00000 n \n",$offset);$pdf.="trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n";
    echo json_encode(['users'=>$users,'pdf'=>base64_encode($pdf)]);exit;
}
$pdo=app_pdo();
if($action==='corrupt-key'){$pdo->exec("UPDATE eoffice_order_settings SET api_key_cipher='synthetic-corrupted-cipher' WHERE id=1");exit;}
if($action==='pause-lock'){
    $pdo->beginTransaction();$pdo->query('SELECT id FROM eoffice_order_settings WHERE id=1 FOR UPDATE');echo "LOCKED\n";flush();fgets(STDIN);
    $pdo->exec('UPDATE eoffice_order_settings SET enabled=0,revision=revision+1,updated_at=NOW() WHERE id=1');$pdo->commit();echo "PAUSED\n";exit;
}
if($action==='blocked-save'){
    $q=$pdo->prepare("SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE DB=? AND INFO LIKE 'SELECT * FROM eoffice_order_settings WHERE id=1 FOR UPDATE%'");$q->execute([$database]);echo $q->fetchColumn();exit;
}
if($action==='worker'){echo app_order_worker();exit;}
if($action==='worker-empty'){putenv('EOFFICE_TEST_AI_RECIPIENTS=[]');echo app_order_worker();exit;}
if(str_starts_with($action,'prepare-ai:')){
    $job=app_order_job((int)substr($action,11));if(!$job)throw new RuntimeException('Missing fixture order');
    app_order_sync_files($job,app_order_pdf_files(app_order_document((int)$job['doc_id'])));
    $alice=(int)$pdo->query("SELECT User_Id FROM t_user WHERE User_Name='alice'")->fetchColumn();
    $pdo->prepare("UPDATE eoffice_order_files SET status='success',targets=? WHERE job_id=?")->execute([json_encode([$alice]),$job['id']]);
    app_order_build_recipients($job);echo '{}';exit;
}
if(str_starts_with($action,'pad-year:')){
    $id=(int)substr($action,9);$pdo->exec('ALTER TABLE t_document MODIFY Doc_Year VARCHAR(255)');
    $pdo->prepare('UPDATE t_document SET Doc_Year=? WHERE Doc_Id=?')->execute(['2569 ',$id]);
    $q=$pdo->prepare('SELECT u.Doc_Upload_Path FROM t_document_upload u JOIN t_document d ON d.Doc_File_Link=u.Doc_File_Link WHERE d.Doc_Id=? LIMIT 1');$q->execute([$id]);echo json_encode(['file_name'=>$q->fetchColumn()]);exit;
}
if($action==='snapshot'){
    $tables=['eoffice_order_settings','eoffice_order_jobs','eoffice_order_files','eoffice_order_recipients','eoffice_order_audit','eoffice_outbox'];$result=[];
    foreach($tables as $table)$result[$table]=$pdo->query("SELECT * FROM $table")->fetchAll();
    // Only this isolated fixture returns its test cipher for encryption assertions.
    echo json_encode($result);exit;
}
if($action==='behavior'){require __DIR__.'/order-email-behavior.php';exit;}
throw new RuntimeException('Unknown fixture action');
