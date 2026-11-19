<?php
function app_official_travel_migrate(PDO $pdo): void {
    // Keep the name and role at the time of booking even if a member account is later removed.
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_official_travel (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        executive_id INT NOT NULL,
        executive_name VARCHAR(255) NOT NULL,
        department VARCHAR(32) NOT NULL,
        subject VARCHAR(200) NOT NULL,
        place VARCHAR(200) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        start_time TIME NULL,
        end_time TIME NULL,
        status ENUM('scheduled','postponed','cancelled') NOT NULL,
        reference_no VARCHAR(100) NOT NULL DEFAULT '',
        private_note VARCHAR(1000) NOT NULL DEFAULT '',
        revision INT UNSIGNED NOT NULL DEFAULT 1,
        KEY idx_travel_dates (end_date,start_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}
