<?php
// Layout documents reference approved news; they never copy or publish news text.
function app_siya_news_studio_migrate(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_siya_news_layouts (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        owner_id INT NOT NULL,
        title VARCHAR(120) NOT NULL DEFAULT '',
        document JSON NOT NULL,
        version INT UNSIGNED NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY layout_owner_updated(owner_id,updated_at,id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_siya_news_layout_revisions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        layout_id BIGINT UNSIGNED NOT NULL,
        version INT UNSIGNED NOT NULL,
        actor_id INT NULL,
        snapshot JSON NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY layout_version(layout_id,version),
        KEY layout_history(layout_id,version),
        CONSTRAINT fk_siya_layout_revision FOREIGN KEY(layout_id) REFERENCES eoffice_siya_news_layouts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}
