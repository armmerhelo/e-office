<?php
// Organizational position is independent of application privileges and routing.
function app_member_positions(): array {
    return ['staff'=>'บุคลากรทั่วไป','director'=>'ผู้อำนวยการ','deputy_director'=>'รองผู้อำนวยการ'];
}

function app_member_positions_migrate(PDO $pdo): void {
    if(!$pdo->query("SHOW COLUMNS FROM t_user LIKE 'User_Position'")->fetch())$pdo->exec("ALTER TABLE t_user ADD COLUMN User_Position VARCHAR(30) NOT NULL DEFAULT 'staff'");
}

// Match by account as well as destination: legacy rows may lack user_id, and
// sharing an executive mailbox must not bypass the order-email exclusion.
function app_order_executive_recipient(?int $userId,string $email,bool $locking=false): bool {
    // Include staff rows in the locking read: a promotion must wait until an
    // already-started delivery finishes, even under READ COMMITTED isolation.
    // PHP trim handles tabs, newlines, CR, NUL and vertical tabs as well as
    // spaces. SQL TRIM only removes spaces and misses old padded mailboxes.
    // Locking all candidate accounts also prevents an email/position edit from
    // introducing a newly matching executive before an in-flight send commits.
    $q=app_pdo()->query('SELECT User_Id,User_Email,User_Position FROM t_user ORDER BY User_Id'.($locking?' LOCK IN SHARE MODE':''));
    $email=strtolower(trim($email));
    foreach($q as $user){
        if(!in_array($user['User_Position'],['director','deputy_director'],true))continue;
        if(($userId!==null&&(int)$user['User_Id']===$userId)||($email!==''&&strtolower(trim((string)$user['User_Email']))===$email))return true;
    }
    return false;
}
