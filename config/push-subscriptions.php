<?php
require_once __DIR__.'/bootstrap.php';

function app_push_subscriptions_migrate(PDO $pdo): void {
    // Legacy targets have no session/device ownership evidence. Retain them for
    // rollback, but only the new, session-bound registry is eligible for sends.
    $pdo->exec("CREATE TABLE IF NOT EXISTS eoffice_push_subscriptions (
        subscription_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
        User_Id INT NOT NULL,
        session_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY(User_Id), KEY(session_hash),
        FOREIGN KEY(User_Id) REFERENCES t_user(User_Id) ON DELETE CASCADE
    ) ENGINE=InnoDB");
}

function app_push_targets(int $userId): array {
    $q=app_pdo()->prepare('SELECT p.subscription_id FROM eoffice_push_subscriptions p JOIN eoffice_sessions s ON s.token_hash=p.session_hash AND s.User_Id=p.User_Id WHERE p.User_Id=? AND s.expires_at>NOW()');
    $q->execute([$userId]);
    return $q->fetchAll(PDO::FETCH_COLUMN);
}
