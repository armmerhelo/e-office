<?php
require_once __DIR__ . '/bootstrap.php';

// All member mutations lock the Admin roster first, in the same order. This
// serializes demotion/deletion and prevents concurrent removal of the last Admin.
function app_lock_member(PDO $pdo, array $actor, int $id): array {
    $admins = $pdo->query("SELECT User_Id FROM t_user WHERE User_Status='Admin' ORDER BY User_Id FOR UPDATE")->fetchAll(PDO::FETCH_COLUMN);
    $q = $pdo->prepare('SELECT * FROM t_user WHERE User_Id=? FOR UPDATE');
    $q->execute([$actor['User_Id']]);
    $currentActor = $q->fetch();
    // The request may have waited behind another member mutation. Hold and
    // revalidate the actual session, not just the account's current role.
    $sessionActor = app_user(false, true);
    if (!$currentActor || !$sessionActor || (int)$sessionActor['User_Id'] !== (int)$actor['User_Id']) {
        $pdo->rollBack();
        app_fail('กรุณาเข้าสู่ระบบใหม่', 401);
    }
    if (!$currentActor || !app_can($currentActor, 'members')) {
        $pdo->rollBack();
        app_fail('คุณไม่มีสิทธิ์ทำรายการนี้', 403);
    }
    $q->execute([$id]);
    $target = $q->fetch();
    if (!$target) {
        $pdo->rollBack();
        app_fail('ไม่พบผู้ใช้', 404);
    }
    if ($currentActor['User_Status'] !== 'Admin' && $target['User_Status'] === 'Admin') {
        $pdo->rollBack();
        app_fail('เฉพาะ Admin สูงสุดเท่านั้นที่จัดการบัญชีนี้ได้', 403);
    }
    // Resetting another staff account's email/password would also transfer its
    // permissions. Delegated member managers may only manage basic accounts.
    if ($currentActor['User_Status'] !== 'Admin' && (int)$id !== (int)$currentActor['User_Id'] && app_user_permissions($target)) {
        $pdo->rollBack();
        app_fail('เฉพาะ Admin สูงสุดเท่านั้นที่จัดการบัญชีผู้ดูแลงานได้', 403);
    }
    return ['actor'=>$currentActor, 'target'=>$target, 'admin_count'=>count($admins)];
}

function app_member_departments(PDO $pdo, int $id): array {
    $q = $pdo->prepare('SELECT d.Department_Id,d.Department_Name FROM t_user_department ud JOIN t_department d ON d.Department_Id=ud.Department_Id WHERE ud.User_Id=? ORDER BY d.Department_Id');
    $q->execute([$id]);
    return $q->fetchAll();
}

function app_member_version(array $user, array $departments): string {
    return hash('sha256', json_encode([
        (int)$user['User_Id'], $user['User_Name'], $user['User_Email'],
        $user['User_Status'], $user['User_Password'],
        array_map('intval', array_column($departments, 'Department_Id')),
    ], JSON_THROW_ON_ERROR));
}

function app_member_permission_version(array $user, array $permissions): string {
    sort($permissions, SORT_STRING);
    return hash('sha256', json_encode([(int)$user['User_Id'], $user['User_Status'], $permissions], JSON_THROW_ON_ERROR));
}

function app_check_member_version(PDO $pdo, array $user, string $expected): void {
    $current = app_member_version($user, app_member_departments($pdo, (int)$user['User_Id']));
    if (!preg_match('/^[a-f0-9]{64}$/D', $expected) || !hash_equals($current, $expected)) {
        $pdo->rollBack();
        app_fail('ข้อมูลสมาชิกเปลี่ยนแล้ว กรุณาปิดหน้าต่างและเปิดข้อมูลใหม่', 409);
    }
}

function app_require_remaining_admin(PDO $pdo, array $locked, string $nextStatus): void {
    if ($locked['target']['User_Status'] === 'Admin' && $nextStatus !== 'Admin' && $locked['admin_count'] <= 1) {
        $pdo->rollBack();
        app_fail('ต้องมี Admin สูงสุดอย่างน้อยหนึ่งคนในระบบ', 409);
    }
}
