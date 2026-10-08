<?php
require_once __DIR__.'/bootstrap.php';

// Keep the routing scopes identical to the receipt stamps in e-sign.
function app_sign_departments(): array {
    return ['โรงเรียนศรียานุสรณ์', 'ฝ่ายงานผู้อำนวยการ', 'กลุ่มบริหารทั่วไป', 'กลุ่มบริหารวิชาการ', 'กลุ่มบริหารงานบุคคล', 'กลุ่มบริหารงบประมาณ'];
}

function app_sign_routes_migrate(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_sign_routes (
        secretary_id INT NOT NULL, department VARCHAR(100) NOT NULL, deputy_id INT NOT NULL,
        PRIMARY KEY(secretary_id,department), KEY(deputy_id),
        FOREIGN KEY(secretary_id) REFERENCES t_user(User_Id) ON DELETE CASCADE,
        FOREIGN KEY(deputy_id) REFERENCES t_user(User_Id) ON DELETE CASCADE
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_document_receipts (
        Doc_Id INT NOT NULL, file_name VARCHAR(255) NOT NULL, revision CHAR(64) NOT NULL,
        secretary_id INT NOT NULL, department VARCHAR(100) NOT NULL, received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(Doc_Id,file_name,revision,secretary_id,department),
        FOREIGN KEY(Doc_Id) REFERENCES t_document(Doc_Id) ON DELETE CASCADE,
        CONSTRAINT fk_eoffice_receipt_secretary FOREIGN KEY(secretary_id) REFERENCES t_user(User_Id) ON DELETE RESTRICT
    ) ENGINE=InnoDB");
    // CREATE IF NOT EXISTS does not upgrade installations using the old cascade.
    // Replace the FK in one ALTER so existing receipt rows are preserved and
    // direct/concurrent account deletion is also blocked at the database layer.
    $constraints=$pdo->query("SELECT DISTINCT r.CONSTRAINT_NAME,r.DELETE_RULE
        FROM information_schema.REFERENTIAL_CONSTRAINTS r
        JOIN information_schema.KEY_COLUMN_USAGE k ON k.CONSTRAINT_SCHEMA=r.CONSTRAINT_SCHEMA AND k.TABLE_NAME=r.TABLE_NAME AND k.CONSTRAINT_NAME=r.CONSTRAINT_NAME
        WHERE r.CONSTRAINT_SCHEMA=DATABASE() AND r.TABLE_NAME='eoffice_document_receipts'
        AND k.COLUMN_NAME='secretary_id' AND k.REFERENCED_TABLE_NAME='t_user'")->fetchAll();
    foreach ($constraints as $constraint) {
        if (in_array($constraint['DELETE_RULE'],['RESTRICT','NO ACTION'],true)) continue;
        $name='`'.str_replace('`','``',$constraint['CONSTRAINT_NAME']).'`';
        $replacement='fk_eoffice_receipt_secretary_restrict_'.substr(hash('sha256',$constraint['CONSTRAINT_NAME']),0,12);
        $pdo->exec("ALTER TABLE eoffice_document_receipts DROP FOREIGN KEY $name,
            ADD CONSTRAINT `$replacement` FOREIGN KEY(secretary_id) REFERENCES t_user(User_Id) ON DELETE RESTRICT");
    }
    $pdo->exec("INSERT IGNORE INTO eoffice_counters (counter_key,value) VALUES ('sign-routes-lock',0)");
    $pdo->beginTransaction();
    try {
        $pdo->query("SELECT value FROM eoffice_counters WHERE counter_key='sign-routes-lock' FOR UPDATE")->fetchColumn();
        if (!$pdo->query("SELECT 1 FROM eoffice_migrations WHERE name='managed-sign-routes'")->fetchColumn()) {
            $routes=json_decode(app_env('EOFFICE_SIGN_ROUTES','{"8":13,"11":15,"14":58,"10":61}'),true,512,JSON_THROW_ON_ERROR);
            if (!is_array($routes)) throw new RuntimeException('Invalid EOFFICE_SIGN_ROUTES');
            $q=$pdo->prepare("INSERT IGNORE INTO eoffice_sign_routes (secretary_id,department,deputy_id)
                SELECT s.User_Id,'',d.User_Id FROM t_user s JOIN t_user d ON d.User_Id=? WHERE s.User_Id=? AND s.User_Id<>d.User_Id");
            foreach ($routes as $secretary=>$deputy) {
                if (!ctype_digit((string)$secretary) || !ctype_digit((string)$deputy) || (int)$secretary<1 || (int)$deputy<1) throw new RuntimeException('Invalid EOFFICE_SIGN_ROUTES');
                $q->execute([(int)$deputy,(int)$secretary]);
            }
            $pdo->exec("INSERT INTO eoffice_migrations (name) VALUES ('managed-sign-routes')");
        }
        $pdo->commit();
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
}

function app_sign_routes(PDO $pdo, bool $locking=false): array {
    $rows=$pdo->query('SELECT secretary_id,department,deputy_id FROM eoffice_sign_routes ORDER BY secretary_id,department'.($locking?' FOR UPDATE':''))->fetchAll();
    return array_map(static fn($row)=>['secretary_id'=>(int)$row['secretary_id'],'department'=>$row['department'],'deputy_id'=>(int)$row['deputy_id']],$rows);
}

function app_sign_routes_version(array $routes): string {
    return hash('sha256',json_encode($routes,JSON_THROW_ON_ERROR));
}

function app_has_sign_role(PDO $pdo, int $id): bool {
    $q=$pdo->prepare('SELECT 1 FROM eoffice_sign_routes WHERE secretary_id=? OR deputy_id=? LIMIT 1');
    $q->execute([$id,$id]);
    return (bool)$q->fetchColumn();
}

function app_has_document_receipts(PDO $pdo, int $id): bool {
    $q=$pdo->prepare('SELECT 1 FROM eoffice_document_receipts WHERE secretary_id=? LIMIT 1');
    $q->execute([$id]);
    return (bool)$q->fetchColumn();
}

// This is an explicit, audited receipt declaration by an assigned secretary,
// not an assertion that arbitrary PDF bytes contain a visible stamp.
function app_register_document_receipts(PDO $pdo, int $secretary, int $docId, string $file, string $revision, array $departments): array {
    if (!$departments) return [];
    $q=$pdo->prepare("SELECT department FROM eoffice_sign_routes WHERE secretary_id=? LOCK IN SHARE MODE");
    $q->execute([$secretary]);$scopes=$q->fetchAll(PDO::FETCH_COLUMN);
    foreach ($departments as $department) {
        if (!in_array('', $scopes, true) && !in_array($department, $scopes, true)) throw new DomainException('คุณไม่ได้รับมอบหมายเป็นเลขาของฝ่ายที่ยืนยันรับเอกสาร');
    }
    $q=$pdo->prepare('INSERT INTO eoffice_document_receipts (Doc_Id,file_name,revision,secretary_id,department) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE revision=VALUES(revision)');
    foreach ($departments as $department) $q->execute([$docId,$file,$revision,$secretary,$department]);
    return app_sign_auto_send($pdo,$secretary,$docId,$departments);
}

// Called inside the same transaction as the PDF revision and signer access.
function app_sign_auto_send(PDO $pdo, int $secretary, int $docId, array $departments): array {
    if (!$departments) return [];
    $marks=implode(',',array_fill(0,count($departments),'?'));
    $q=$pdo->prepare("SELECT deputy_id FROM eoffice_sign_routes WHERE secretary_id=? AND (department='' OR department IN ($marks)) ORDER BY deputy_id LOCK IN SHARE MODE");
    $q->execute([$secretary,...$departments]);
    $recipients=array_values(array_unique(array_map('intval',$q->fetchAll(PDO::FETCH_COLUMN))));
    $added=[];
    foreach ($recipients as $deputy) {
        if ($deputy===$secretary) continue;
        // Do not reset read/signed state or notify again when access already exists.
        $exists=$pdo->prepare('SELECT 1 FROM t_access_rights WHERE User_Id=? AND Doc_Id=?');
        $exists->execute([$deputy,$docId]);
        if ($exists->fetchColumn()) continue;
        $pdo->prepare("INSERT INTO t_access_rights (User_Id,Doc_Id,Date,alert_to) VALUES (?,?,'',0)")->execute([$deputy,$docId]);
        app_queue(['type'=>'document_notification','user_id'=>$deputy,'doc_id'=>$docId]);
        $added[]=$deputy;
    }
    return $added;
}
