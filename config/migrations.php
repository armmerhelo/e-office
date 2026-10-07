<?php
function app_migrate(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_sessions (token_hash CHAR(64) PRIMARY KEY, User_Id INT NOT NULL, expires_at DATETIME NOT NULL, KEY(User_Id), FOREIGN KEY(User_Id) REFERENCES t_user(User_Id) ON DELETE CASCADE) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_google_accounts (google_sub VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, User_Id INT NOT NULL UNIQUE, FOREIGN KEY(User_Id) REFERENCES t_user(User_Id) ON DELETE CASCADE) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_login_attempts (identity_hash CHAR(64) PRIMARY KEY, attempts INT NOT NULL DEFAULT 0, window_start DATETIME NOT NULL) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_counters (counter_key VARCHAR(100) PRIMARY KEY, value INT NOT NULL) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_signed_files (Doc_Id INT NOT NULL, file_name VARCHAR(255) NOT NULL, revision CHAR(64) NOT NULL, signed_at DATETIME NOT NULL, PRIMARY KEY(Doc_Id,file_name), FOREIGN KEY(Doc_Id) REFERENCES t_document(Doc_Id) ON DELETE CASCADE) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_outbox (id BIGINT AUTO_INCREMENT PRIMARY KEY, payload JSON NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, status VARCHAR(20) NOT NULL DEFAULT 'pending') ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_access_history (id BIGINT AUTO_INCREMENT PRIMARY KEY, Doc_Id INT NOT NULL, User_Id INT NOT NULL, snapshot JSON NOT NULL, archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_permissions (User_Id INT NOT NULL, permission VARCHAR(50) NOT NULL, PRIMARY KEY(User_Id,permission), FOREIGN KEY(User_Id) REFERENCES t_user(User_Id) ON DELETE CASCADE) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_migrations (name VARCHAR(100) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB");
    if (!$pdo->query("SELECT 1 FROM eoffice_migrations WHERE name='legacy-staff-permissions'")->fetchColumn()) {
        $pdo->beginTransaction();
        foreach (['maintenance'=>[1,14], 'room_booking'=>[1,14], 'email'=>[1,14], 'external_numbers'=>[1,18]] as $permission=>$ids) {
            $q=$pdo->prepare('INSERT IGNORE INTO eoffice_permissions (User_Id,permission) SELECT User_Id,? FROM t_user WHERE User_Id=?');
            foreach ($ids as $id) $q->execute([$permission,$id]);
        }
        $pdo->exec("INSERT INTO eoffice_migrations (name) VALUES ('legacy-staff-permissions')");
        $pdo->commit();
    }
    $duplicate=$pdo->query('SELECT 1 FROM t_access_rights GROUP BY User_Id,Doc_Id HAVING COUNT(*)>1 LIMIT 1')->fetchColumn();
    if ($duplicate) throw new RuntimeException('Duplicate access rights: reconcile before adding the unique index');
    $indexes=$pdo->query('SHOW INDEX FROM t_access_rights')->fetchAll();$unique=[];
    foreach ($indexes as $index) if ((int)$index['Non_unique']===0) $unique[$index['Key_name']][(int)$index['Seq_in_index']]=$index['Column_name'];
    $hasPair=false;
    foreach ($unique as $columns) {ksort($columns);if (array_values($columns)===['User_Id','Doc_Id']||array_values($columns)===['Doc_Id','User_Id'])$hasPair=true;}
    if (!$hasPair)$pdo->exec('ALTER TABLE t_access_rights ADD UNIQUE KEY uq_eoffice_user_doc (User_Id,Doc_Id)');
    $duplicate=$pdo->query('SELECT 1 FROM t_external_number_booking GROUP BY Doc_Year,External_Number HAVING COUNT(*)>1 LIMIT 1')->fetchColumn();
    if ($duplicate)throw new RuntimeException('Duplicate external numbers: reconcile before adding the unique index');
    if (!$pdo->query("SHOW INDEX FROM t_external_number_booking WHERE Key_name='uq_eoffice_year_number'")->fetch())$pdo->exec('ALTER TABLE t_external_number_booking ADD UNIQUE KEY uq_eoffice_year_number (Doc_Year,External_Number)');
}
