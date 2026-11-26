<?php
require_once __DIR__.'/../config/member-management.php';
app_method('POST');
$actor = app_permission('members');
$id = (int)($_POST['User_Id'] ?? 0);
$expected = app_text($_POST, 'member_version', 64, true);
$action = app_text($_POST, 'action', 16, true);
if ($id <= 0 || !in_array($action, ['upload', 'remove'], true)) app_fail('คำขอจัดการรูปโปรไฟล์ไม่ถูกต้อง');

$pdo = app_pdo();
$pdo->beginTransaction();
$stored = null;
$oldName = null;
$response = null;
try {
    $locked = app_lock_member($pdo, $actor, $id);
    app_check_member_version($pdo, $locked['target'], $expected);
    $photo = app_profile_photo_state($pdo, $id, true);
    $oldName = $photo['file_name'];
    $revision = $photo['revision'];

    if ($action === 'upload') {
        $upload = $_FILES['photo'] ?? null;
        if (!is_array($upload)) app_fail('กรุณาเลือกไฟล์รูปโปรไฟล์');
        $stored = app_profile_photo_store($upload);
        $revision++;
        $pdo->prepare('INSERT INTO eoffice_user_photos (User_Id,revision,file_name,mime_type,bytes) VALUES (?,?,?,?,?)
            ON DUPLICATE KEY UPDATE revision=VALUES(revision),file_name=VALUES(file_name),mime_type=VALUES(mime_type),bytes=VALUES(bytes)')
            ->execute([$id, $revision, $stored['file_name'], $stored['mime_type'], $stored['bytes']]);
        app_audit('member.photo', $locked['actor'], $id, ['action' => 'upload']);
    } elseif ($photo['file_name']) {
        $revision++;
        $pdo->prepare('UPDATE eoffice_user_photos SET revision=?,file_name=NULL,mime_type=NULL,bytes=0 WHERE User_Id=?')
            ->execute([$revision, $id]);
        app_audit('member.photo', $locked['actor'], $id, ['action' => 'remove']);
    }

    $departments = app_member_departments($pdo, $id);
    $memberVersion = app_member_version($locked['target'], $departments, $revision);
    $response = [
        'member_version' => $memberVersion,
        'photo' => [
            'revision' => $revision,
            'url' => $action === 'upload' ? app_profile_photo_url($id, $revision) : null,
        ],
    ];
    $pdo->commit();
} catch (Throwable $error) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    if ($stored) app_profile_photo_delete_file($stored['file_name']);
    throw $error;
}

app_profile_photo_delete_file($oldName);
app_json(['status' => 'success', 'message' => $action === 'upload' ? 'บันทึกรูปโปรไฟล์แล้ว' : 'ลบรูปโปรไฟล์แล้ว'] + $response);
