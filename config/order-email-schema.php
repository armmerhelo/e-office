<?php
function app_order_email_migrate(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_order_settings (
        id TINYINT PRIMARY KEY, enabled TINYINT NOT NULL DEFAULT 0, activated_at DATETIME NULL,
        api_key_cipher TEXT NULL, model VARCHAR(150) NULL, updated_by INT NULL,
        updated_at DATETIME NULL, worker_at DATETIME NULL, revision BIGINT UNSIGNED NOT NULL DEFAULT 0
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_order_key_health (
        key_id BIGINT PRIMARY KEY, last_success_at DATETIME NULL,
        last_error_at DATETIME NULL, last_error_code VARCHAR(80) NULL
    ) ENGINE=InnoDB");
    if(!$pdo->query("SHOW COLUMNS FROM eoffice_order_settings LIKE 'revision'")->fetch())$pdo->exec('ALTER TABLE eoffice_order_settings ADD COLUMN revision BIGINT UNSIGNED NOT NULL DEFAULT 0');
    $pdo->exec('INSERT IGNORE INTO eoffice_order_settings (id) VALUES (1)');
    foreach(['options_json'=>'TEXT NULL','smtp_password_cipher'=>'TEXT NULL','worker_finished_at'=>'DATETIME NULL','worker_result'=>'TEXT NULL','active_key_id'=>'BIGINT NULL'] as $column=>$definition){
        if(!$pdo->query("SHOW COLUMNS FROM eoffice_order_settings LIKE '$column'")->fetch())$pdo->exec("ALTER TABLE eoffice_order_settings ADD COLUMN $column $definition");
    }
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_order_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, actor_id INT NULL, event VARCHAR(50) NOT NULL,
        details TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_order_event (event,id)
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_order_api_keys (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, reference VARCHAR(24) NOT NULL UNIQUE,
        label VARCHAR(100) NOT NULL, cipher TEXT NULL, enabled TINYINT NOT NULL DEFAULT 1,
        deleted_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by INT NULL, remind_days INT NOT NULL DEFAULT 90,
        tested_at DATETIME NULL, tested_model VARCHAR(150) NULL, test_code VARCHAR(80) NULL,
        last_success_at DATETIME NULL, last_error_at DATETIME NULL, last_error_code VARCHAR(80) NULL
    ) ENGINE=InnoDB");
    // Row lock makes importing the legacy active copy repeatable and atomic.
    $pdo->beginTransaction();
    try{
        $legacy=$pdo->query('SELECT active_key_id,api_key_cipher,updated_by FROM eoffice_order_settings WHERE id=1 FOR UPDATE')->fetch();
        if($legacy['active_key_id']===null&&$legacy['api_key_cipher']!==null&&strlen(base64_decode($legacy['api_key_cipher'],true)?:'')>28){
            $pdo->prepare("INSERT INTO eoffice_order_api_keys (reference,label,cipher,created_by) VALUES (?,'Key เดิมของระบบ',?,?)")->execute(['key_'.bin2hex(random_bytes(8)),$legacy['api_key_cipher'],$legacy['updated_by']]);
            $pdo->prepare('UPDATE eoffice_order_settings SET active_key_id=? WHERE id=1')->execute([$pdo->lastInsertId()]);
        }
        $pdo->commit();
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_order_ai_usage (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, model VARCHAR(150) NOT NULL, purpose VARCHAR(30) NOT NULL,
        prompt_tokens INT UNSIGNED NOT NULL DEFAULT 0, output_tokens INT UNSIGNED NOT NULL DEFAULT 0,
        total_tokens INT UNSIGNED NOT NULL DEFAULT 0, duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB");
    if(!$pdo->query("SHOW COLUMNS FROM eoffice_order_ai_usage LIKE 'key_id'")->fetch())$pdo->exec('ALTER TABLE eoffice_order_ai_usage ADD COLUMN key_id BIGINT NULL, ADD KEY idx_usage_key (key_id,created_at)');
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_order_jobs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, doc_id INT NOT NULL UNIQUE,
        source VARCHAR(20) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'waiting_files',
        model VARCHAR(150) NULL, created_by INT NULL, error_code VARCHAR(80) NULL,
        retry_attempts INT NOT NULL DEFAULT 0, retry_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_order_jobs_status (status,id)
    ) ENGINE=InnoDB");
    if(!$pdo->query("SHOW COLUMNS FROM eoffice_order_jobs LIKE 'retry_attempts'")->fetch())$pdo->exec('ALTER TABLE eoffice_order_jobs ADD COLUMN retry_attempts INT NOT NULL DEFAULT 0');
    if(!$pdo->query("SHOW COLUMNS FROM eoffice_order_jobs LIKE 'retry_at'")->fetch())$pdo->exec('ALTER TABLE eoffice_order_jobs ADD COLUMN retry_at DATETIME NULL');
    if(!$pdo->query("SHOW COLUMNS FROM eoffice_order_jobs LIKE 'approval_hash'")->fetch())$pdo->exec('ALTER TABLE eoffice_order_jobs ADD COLUMN approval_hash CHAR(64) NULL');
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_order_files (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, job_id BIGINT NOT NULL, file_name VARCHAR(255) NOT NULL,
        caption VARCHAR(1000) NOT NULL DEFAULT '', file_hash CHAR(64) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending', targets JSON NULL,
        attempts INT NOT NULL DEFAULT 0, retry_at DATETIME NULL, error_code VARCHAR(80) NULL,
        UNIQUE KEY uq_order_file (job_id,file_name), KEY idx_order_files_status (job_id,status),
        FOREIGN KEY (job_id) REFERENCES eoffice_order_jobs(id) ON DELETE CASCADE
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_order_recipients (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, job_id BIGINT NOT NULL, user_id INT NULL,
        recipient_name VARCHAR(255) NOT NULL, recipient_email VARCHAR(255) NOT NULL,
        email_key CHAR(64) NOT NULL, source VARCHAR(20) NOT NULL DEFAULT 'ai',
        status VARCHAR(20) NOT NULL DEFAULT 'pending', attempts INT NOT NULL DEFAULT 0,
        error_code VARCHAR(80) NULL, attempted_at DATETIME NULL, sent_at DATETIME NULL,
        UNIQUE KEY uq_order_recipient (job_id,email_key), KEY idx_order_recipient_status (job_id,status),
        FOREIGN KEY (job_id) REFERENCES eoffice_order_jobs(id) ON DELETE CASCADE
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_order_audit (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, actor_id INT NULL, doc_id INT NULL,
        action VARCHAR(50) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB");
}
