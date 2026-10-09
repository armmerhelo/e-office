<?php
function app_order_email_migrate(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_order_settings (
        id TINYINT PRIMARY KEY, enabled TINYINT NOT NULL DEFAULT 0, activated_at DATETIME NULL,
        api_key_cipher TEXT NULL, model VARCHAR(150) NULL, updated_by INT NULL,
        updated_at DATETIME NULL, worker_at DATETIME NULL, revision BIGINT UNSIGNED NOT NULL DEFAULT 0
    ) ENGINE=InnoDB");
    if(!$pdo->query("SHOW COLUMNS FROM eoffice_order_settings LIKE 'revision'")->fetch())$pdo->exec('ALTER TABLE eoffice_order_settings ADD COLUMN revision BIGINT UNSIGNED NOT NULL DEFAULT 0');
    $pdo->exec('INSERT IGNORE INTO eoffice_order_settings (id) VALUES (1)');
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
