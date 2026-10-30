<?php
// UTC: 31 October 2026 00:00 Asia/Bangkok. NULL preserves unknown
// historical delivery times instead of inventing dates during migration.
const APP_INBOX_SIGNATURE_CUTOFF_UTC = '2026-10-30 17:00:00';
const APP_INBOX_LEGACY_TIME = '1000-01-01 00:00:00';

function app_inbox_migrate(PDO $pdo): void {
    foreach (['t_access_rights','t_access_rights_department','t_user_department'] as $table) {
        if (!$pdo->query("SHOW COLUMNS FROM $table LIKE 'Inbox_Delivered_At'")->fetch()) {
            $pdo->exec("ALTER TABLE $table ADD Inbox_Delivered_At DATETIME NULL DEFAULT NULL");
        }
    }
}

// Earliest active path wins. A group delivery starts when both its grant
// and the user's membership exist. Arguments are server-controlled integers/SQL.
function app_inbox_delivery_sql(int $uid, string $doc = 'd.Doc_Id'): string {
    $old=APP_INBOX_LEGACY_TIME;
    return "(SELECT MIN(delivery.at_time) FROM (
        SELECT a.Doc_Id,COALESCE(a.Inbox_Delivered_At,'$old') at_time FROM t_access_rights a WHERE a.User_Id=$uid
        UNION ALL
        SELECT a.Doc_Id,GREATEST(COALESCE(a.Inbox_Delivered_At,'$old'),COALESCE(u.Inbox_Delivered_At,'$old')) at_time
        FROM t_access_rights_department a JOIN t_user_department u ON u.Department_Id=a.Department_Id WHERE u.User_Id=$uid
    ) delivery WHERE delivery.Doc_Id=$doc)";
}

function app_inbox_delivery(PDO $pdo, int $uid, int $docId): ?string {
    $sql=app_inbox_delivery_sql($uid,(string)$docId);
    $time=$pdo->query("SELECT $sql")->fetchColumn();
    return !$time || $time===APP_INBOX_LEGACY_TIME ? null : $time;
}

function app_inbox_completed_sql(int $uid): string {
    $delivery=app_inbox_delivery_sql($uid);$cutoff=APP_INBOX_SIGNATURE_CUTOFF_UTC;
    return "EXISTS (SELECT 1 FROM t_access_rights r WHERE r.Doc_Id=d.Doc_Id AND r.User_Id=$uid
        AND (r.Is_Signed='true' OR (r.Status='Readed' AND $delivery < '$cutoff')))";
}
