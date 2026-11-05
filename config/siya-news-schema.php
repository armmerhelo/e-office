<?php
function app_siya_news_migrate(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_siya_news (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        owner_id INT NOT NULL,
        title VARCHAR(255) NOT NULL DEFAULT '',
        event_date DATE NULL,
        location VARCHAR(255) NOT NULL DEFAULT '',
        department VARCHAR(255) NOT NULL DEFAULT '',
        body MEDIUMTEXT NOT NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'draft',
        version INT UNSIGNED NOT NULL DEFAULT 1,
        approved_version INT UNSIGNED NULL,
        review_note TEXT NULL,
        reviewer_id INT NULL,
        submitted_at DATETIME NULL,
        reviewed_at DATETIME NULL,
        used_at DATETIME NULL,
        used_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY news_status_updated(status,updated_at,id),
        KEY news_owner_updated(owner_id,updated_at,id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_siya_news_revisions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        news_id BIGINT UNSIGNED NOT NULL,
        version INT UNSIGNED NOT NULL,
        actor_id INT NULL,
        snapshot JSON NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY news_version(news_id,version),
        KEY news_history(news_id,created_at,id),
        CONSTRAINT fk_siya_news_revision_news FOREIGN KEY(news_id) REFERENCES eoffice_siya_news(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_siya_news_images (
        id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
        news_id BIGINT UNSIGNED NOT NULL,
        uploaded_by INT NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        extension VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        mime_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        bytes BIGINT UNSIGNED NOT NULL,
        sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        caption VARCHAR(500) NOT NULL DEFAULT '',
        credit VARCHAR(255) NOT NULL DEFAULT '',
        sort_order INT UNSIGNED NOT NULL DEFAULT 0,
        is_removed TINYINT(1) NOT NULL DEFAULT 0,
        storage_state VARCHAR(16) NOT NULL DEFAULT 'local',
        drive_file_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
        drive_parts JSON NULL,
        uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        drive_verified_at DATETIME NULL,
        retry_at DATETIME NULL,
        attempts INT UNSIGNED NOT NULL DEFAULT 0,
        error_code VARCHAR(50) NULL,
        KEY news_images_order(news_id,sort_order,id),
        KEY news_image_worker(storage_state,retry_at,uploaded_at),
        CONSTRAINT fk_siya_news_image_news FOREIGN KEY(news_id) REFERENCES eoffice_siya_news(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}
