<?php
// Disposable database only. No application documents, uploads or mail are created.
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/bootstrap.php';
$s=app_settings();$database=$s['database'];
if(!preg_match('/^eoffice_export_\d+_test$/D',$database)||!$s['mock'])throw new RuntimeException('Disposable export database required');
$dsn="mysql:host={$s['host']};port={$s['port']};charset=utf8mb4";
$options=[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC];
$admin=new PDO($dsn,$s['username'],$s['password'],$options);
$action=$argv[1]??'';
if($action==='drop'){$admin->exec("DROP DATABASE IF EXISTS `$database`");echo '{}';exit;}
if($action==='seed'){
    $admin->exec("CREATE DATABASE `$database` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $admin->exec("USE `$database`");
    $admin->exec('CREATE TABLE t_user (User_Id INT PRIMARY KEY,User_Name VARCHAR(100),User_Email VARCHAR(255),User_Status VARCHAR(20)) ENGINE=InnoDB');
    $admin->exec('CREATE TABLE eoffice_sessions (token_hash CHAR(64) PRIMARY KEY,User_Id INT,expires_at DATETIME) ENGINE=InnoDB');
    $admin->exec("INSERT INTO t_user VALUES (1,'Export QA','export@example.test','User'),(2,'Other QA','other@example.test','User')");
    $q=$admin->prepare('INSERT INTO eoffice_sessions VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))');
    foreach([1,2] as $id)$q->execute([hash('sha256',hash('sha256','export-fixture-'.$id)),$id]);
    $admin->exec('CREATE TABLE t_document (Doc_Id INT PRIMARY KEY,Doc_Name TEXT,External_Number INT,Doc_Year VARCHAR(4),Doc_File_Link VARCHAR(50),Is_Delete VARCHAR(10)) ENGINE=InnoDB');
    $admin->exec('CREATE TABLE email_logs (doc_id VARCHAR(50),file_name VARCHAR(255),recipient_email VARCHAR(255),delivery_status VARCHAR(20),created_at DATETIME) ENGINE=InnoDB');
    $admin->exec('CREATE TABLE t_document_upload (Doc_File_Link VARCHAR(50),Doc_Upload_Path VARCHAR(255)) ENGINE=InnoDB');
    $doc=$admin->prepare('INSERT INTO t_document VALUES (?,?,?,?,?,?)');
    $log=$admin->prepare("INSERT INTO email_logs VALUES (?,?,?,?, '2026-10-28 09:00:00')");
    $file=$admin->prepare('INSERT INTO t_document_upload VALUES (?,?)');
    for($id=1;$id<=209;$id++){
        $doc->execute([$id,'before แต่งตั้ง '.$id,$id,$id===206?'2568':'2569','file-'.$id,$id===207?'deleted':'active']);
        $log->execute([(string)$id,'before.pdf',$id===209?'other@example.test':'export@example.test',$id===208?'failed':'success']);
        $file->execute(['file-'.$id,'before.pdf']);
    }
    echo '{}';exit;
}
$_SERVER['REQUEST_METHOD']='GET';
parse_str($argv[2]??'',$_GET);
if($action!=='guest')$_COOKIE['User_Token']=hash('sha256','export-fixture-'.($action==='other'?2:1));
if($action==='concurrent'){
    // Commit a second connection's edit after COUNT establishes the read view,
    // before the endpoint reads document fields and attachment metadata.
    $admin->exec("USE `$database`");
    class ExportConcurrentStatement extends PDOStatement {
        protected function __construct(private PDO $writer) {}
        public function execute(?array $params=null): bool {
            $ok=parent::execute($params);
            if(str_starts_with($this->queryString,'SELECT COUNT(DISTINCT')){
                $this->writer->exec("UPDATE t_document SET Doc_Name='after'");
                $this->writer->exec("UPDATE email_logs SET file_name='after.pdf'");
                $this->writer->exec("UPDATE t_document_upload SET Doc_Upload_Path='after.pdf'");
            }
            return $ok;
        }
    }
    app_pdo()->setAttribute(PDO::ATTR_STATEMENT_CLASS,[ExportConcurrentStatement::class,[$admin]]);
}
require __DIR__.'/../email_send/api_get_my_docs.php';
