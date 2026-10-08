<?php
function app_drive_archive_migrate(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_drive_versions (
        id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
        doc_id INT NOT NULL, file_name VARCHAR(255) NOT NULL, variant VARCHAR(10) NOT NULL,
        revision CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, bytes BIGINT NOT NULL,
        key_id CHAR(16) NOT NULL, parts JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, verified_at DATETIME NULL,
        evicted_at DATETIME NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending',
        retry_at DATETIME NULL, attempts INT NOT NULL DEFAULT 0, error_code VARCHAR(50) NULL,
        KEY doc_file(doc_id,file_name,variant), KEY worker_status(status,created_at)
    ) ENGINE=InnoDB");
    $columns=array_column($pdo->query('SHOW COLUMNS FROM eoffice_drive_versions')->fetchAll(PDO::FETCH_ASSOC),'Field');
    foreach(['retry_at'=>'DATETIME NULL','attempts'=>'INT NOT NULL DEFAULT 0','error_code'=>'VARCHAR(50) NULL'] as $name=>$definition){
        if(!in_array($name,$columns,true))$pdo->exec('ALTER TABLE eoffice_drive_versions ADD COLUMN '.$name.' '.$definition);
    }
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_drive_files (
        doc_id INT NOT NULL, file_name VARCHAR(255) NOT NULL, variant VARCHAR(10) NOT NULL,
        version_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        PRIMARY KEY(doc_id,file_name,variant), KEY(version_id)
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_drive_state (
        id INT PRIMARY KEY, scan_doc INT NOT NULL DEFAULT 0, worker_at DATETIME NULL, full_scan_at DATETIME NULL,
        error_code VARCHAR(50) NULL, uploaded BIGINT NOT NULL DEFAULT 0, evicted BIGINT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB");
    $pdo->exec('INSERT IGNORE INTO eoffice_drive_state (id) VALUES (1)');
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_drive_backups (
        backup_date DATE PRIMARY KEY, status VARCHAR(20) NOT NULL DEFAULT 'pending',
        manifest JSON NULL, objects JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME NULL, error_code VARCHAR(50) NULL
    ) ENGINE=InnoDB");
}
