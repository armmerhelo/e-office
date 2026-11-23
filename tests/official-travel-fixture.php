<?php
if (PHP_SAPI !== 'cli') exit;
require __DIR__.'/../config/bootstrap.php';
require __DIR__.'/../config/official-travel-schema.php';
$settings = app_settings();
$database = $settings['database'];
if (!preg_match('/^eoffice_travel_\d+_test$/D', $database) || !$settings['mock']
    || !in_array($settings['host'], ['localhost','127.0.0.1','::1'], true)) {
    throw new RuntimeException('Local disposable travel test database required');
}
$action = $argv[1] ?? '';
if ($action === 'seed' || $action === 'drop') {
    $server = new PDO("mysql:host={$settings['host']};port={$settings['port']};charset=utf8mb4", $settings['username'], $settings['password']);
    if ($action === 'drop') {
        $server->exec("DROP DATABASE IF EXISTS `$database`");
        exit;
    }
    $server->exec("CREATE DATABASE `$database` CHARACTER SET utf8mb4");
}
$pdo = app_pdo();
switch ($action) {
    case 'seed':
        $pdo->exec("CREATE TABLE t_user (User_Id INT PRIMARY KEY, User_Name VARCHAR(255), User_Status VARCHAR(20), User_Position VARCHAR(30)) ENGINE=InnoDB");
        $pdo->exec("CREATE TABLE eoffice_sessions (token_hash CHAR(64) PRIMARY KEY, User_Id INT, expires_at DATETIME) ENGINE=InnoDB");
        $pdo->exec("CREATE TABLE eoffice_permissions (User_Id INT, permission VARCHAR(50), PRIMARY KEY(User_Id,permission)) ENGINE=InnoDB");
        $pdo->exec("INSERT INTO t_user VALUES (1,'ผู้บริหารทดสอบ','Admin','director'), (2,'เลขานุการทดสอบ','User','staff'),
            (3,'รองทดสอบ','User','deputy_director'), (4,'บุคลากรทดสอบ','User','staff'),
            (5,'ผู้อำนวยการทดสอบ','User','director'), (6,'Admin ทดสอบ','Admin','staff')");
        $pdo->exec("INSERT INTO eoffice_permissions VALUES (2, 'official_travel')");
        app_official_travel_migrate($pdo);
        app_audit_migrate($pdo);
        $insert = $pdo->prepare('INSERT INTO eoffice_sessions VALUES (?,?,DATE_ADD(NOW(), INTERVAL 1 HOUR))');
        $tokens = [];
        foreach (['admin'=>1,'secretary'=>2,'deputy'=>3,'reader'=>4,'director'=>5,'admin_staff'=>6] as $name=>$id) {
            $tokens[$name] = bin2hex(random_bytes(32));
            $insert->execute([hash('sha256', $tokens[$name]), $id]);
        }
        echo json_encode($tokens, JSON_THROW_ON_ERROR);
        break;
    case 'revoke':
        $pdo->exec("DELETE FROM eoffice_permissions WHERE User_Id=2 AND permission='official_travel'");
        break;
    case 'departed':
        $pdo->exec('DELETE FROM t_user WHERE User_Id=3');
        break;
    case 'migrate':
        app_official_travel_migrate($pdo);
        break;
    case 'audit':
        echo json_encode($pdo->query("SELECT event,actor_id,target_id,metadata FROM eoffice_audit_log ORDER BY id")->fetchAll(), JSON_THROW_ON_ERROR);
        break;
    default:
        throw new RuntimeException('Unknown travel fixture action');
}
