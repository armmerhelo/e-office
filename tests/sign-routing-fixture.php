<?php
if (PHP_SAPI!=='cli') exit;
$action=$argv[1]??'';
if ($action==='seed') require __DIR__.'/member-fixture.php';
require_once __DIR__.'/../config/services.php';
require_once __DIR__.'/../config/sign-routing.php';
if (!preg_match('/^eoffice_members_\d+_test$/',app_settings()['database'])) throw new RuntimeException('Disposable routing test database required');
if ($action==='seed') {
    $pdo=app_pdo();
    $pdo->exec("ALTER TABLE t_document ADD Doc_Year VARCHAR(4), ADD Doc_File_Link VARCHAR(64), ADD Is_Delete VARCHAR(20), ADD Doc_Type VARCHAR(20) DEFAULT 'Internal'");
    $pdo->exec("CREATE TABLE t_document_upload (Doc_File_Link VARCHAR(64),Doc_Upload_Path VARCHAR(255)) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE t_access_rights (User_Id INT,Doc_Id INT,Date VARCHAR(30) DEFAULT '',alert_to INT DEFAULT 0,Status VARCHAR(20) DEFAULT 'Unread',Is_Signed VARCHAR(10) DEFAULT 'false',PRIMARY KEY(User_Id,Doc_Id),FOREIGN KEY(User_Id) REFERENCES t_user(User_Id) ON DELETE CASCADE,FOREIGN KEY(Doc_Id) REFERENCES t_document(Doc_Id) ON DELETE CASCADE) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE eoffice_signed_files (Doc_Id INT,file_name VARCHAR(255),revision CHAR(64),signed_at DATETIME,PRIMARY KEY(Doc_Id,file_name)) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE eoffice_outbox (id BIGINT AUTO_INCREMENT PRIMARY KEY,payload JSON,created_at DATETIME DEFAULT CURRENT_TIMESTAMP,status VARCHAR(20)) ENGINE=InnoDB");
    $pdo->exec("INSERT INTO t_document (User_Id,Doc_Year,Doc_File_Link,Is_Delete) VALUES (1,'2569','routing-test','active')");
    $pdo->exec("INSERT INTO t_document_upload VALUES ('routing-test','routing.pdf')");
    $pdo->exec("INSERT INTO t_access_rights (User_Id,Doc_Id) VALUES (2,1),(4,1)");
    $dir=app_storage('original','2569');
    if (!is_dir($dir)) mkdir($dir,0755,true);
    file_put_contents($dir.'routing.pdf',"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
} elseif ($action==='inspect') {
    $pdo=app_pdo();
    echo json_encode(['access'=>$pdo->query('SELECT * FROM t_access_rights WHERE Doc_Id=1 ORDER BY User_Id')->fetchAll(),
        'signed_files'=>$pdo->query('SELECT * FROM eoffice_signed_files WHERE Doc_Id=1 ORDER BY file_name')->fetchAll(),
        'receipts'=>$pdo->query('SELECT * FROM eoffice_document_receipts WHERE Doc_Id=1 ORDER BY received_at,revision')->fetchAll(),
        'notifications'=>array_map(fn($v)=>json_decode($v,true),$pdo->query('SELECT payload FROM eoffice_outbox ORDER BY id')->fetchAll(PDO::FETCH_COLUMN))],JSON_THROW_ON_ERROR);
} elseif ($action==='migrate') {
    app_sign_routes_migrate(app_pdo());
} elseif ($action==='legacy-receipt-fk') {
    // Simulate the already-deployed cascade schema without changing receipt rows.
    $pdo=app_pdo();
    $name=$pdo->query("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='eoffice_document_receipts' AND COLUMN_NAME='secretary_id' AND REFERENCED_TABLE_NAME='t_user'")->fetchColumn();
    $name='`'.str_replace('`','``',$name).'`';
    $pdo->exec("ALTER TABLE eoffice_document_receipts DROP FOREIGN KEY $name, ADD CONSTRAINT legacy_receipt_secretary FOREIGN KEY(secretary_id) REFERENCES t_user(User_Id) ON DELETE CASCADE");
} elseif ($action==='delete-secretary-direct') {
    try {
        app_pdo()->exec('DELETE FROM t_user WHERE User_Id=2');
        echo json_encode(['blocked'=>false]);
    } catch (PDOException $e) {
        if ($e->getCode()!=='23000') throw $e;
        echo json_encode(['blocked'=>true]);
    }
} else { throw new RuntimeException('Unknown routing fixture action'); }
