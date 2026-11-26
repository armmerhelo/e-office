<?php
require_once __DIR__.'/bootstrap.php';
require_once __DIR__.'/profile-photo.php';

function app_official_travel_departments(): array {
    return [
        'director'=>'ผู้อำนวยการ',
        'general'=>'กลุ่มบริหารทั่วไป',
        'academic'=>'กลุ่มบริหารวิชาการ',
        'personnel'=>'กลุ่มบริหารงานบุคคล',
        'budget'=>'กลุ่มบริหารงบประมาณ',
    ];
}

function app_official_travel_read(PDO $pdo, ?array $user): never {
    $today = date('Y-m-d');
    $month = $_GET['month'] ?? substr($today, 0, 7);
    if (!is_string($month) || !preg_match('/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/D', $month)) {
        app_fail('เดือนที่เลือกไม่ถูกต้อง');
    }
    $first = $month.'-01';
    $last = (new DateTimeImmutable($first))->format('Y-m-t');
    $manageable = $user !== null && app_can($user, 'official_travel');
    $fields = 'id, executive_id, executive_name, department, subject, place, start_date, end_date,
        LEFT(start_time,5) AS start_time, LEFT(end_time,5) AS end_time, status';
    if ($manageable) $fields .= ', reference_no, private_note, revision';
    $q = $pdo->prepare("SELECT $fields FROM eoffice_official_travel
        WHERE (end_date>=? AND start_date<=?) OR (end_date>=? AND start_date<=? AND status='scheduled')
        ORDER BY start_date,start_time,id");
    $q->execute([$first,$last,$today,$today]);
    $entries = [];
    $todayEntries = [];
    foreach ($q->fetchAll() as $row) {
        $row['id'] = (int)$row['id'];
        $row['executive_id'] = (int)$row['executive_id'];
        if ($manageable) $row['revision'] = (int)$row['revision'];
        if ($row['end_date'] >= $first && $row['start_date'] <= $last) $entries[] = $row;
        if ($row['status'] === 'scheduled' && $row['start_date'] <= $today && $row['end_date'] >= $today) {
            $todayEntries[] = $row;
        }
    }
    $executives = $pdo->query("SELECT u.User_Id AS id, u.User_Name AS name, u.User_Position AS position,
        COALESCE(p.revision,0) AS photo_revision
        FROM t_user u LEFT JOIN eoffice_user_photos p ON p.User_Id=u.User_Id
        WHERE u.User_Position IN ('director','deputy_director')
        ORDER BY u.User_Position DESC, u.User_Name, u.User_Id")->fetchAll();
    foreach ($executives as &$executive) {
        $executive['id'] = (int)$executive['id'];
        $executive['photo_revision'] = (int)$executive['photo_revision'];
        $executive['photo_url'] = $executive['photo_revision'] > 0
            ? app_profile_photo_url($executive['id'], $executive['photo_revision']) : null;
    }
    unset($executive);
    app_json(['status'=>'success', 'today'=>$today, 'month'=>$month, 'owner'=>$user ? (int)$user['User_Id'] : 0,
        'can_manage'=>$manageable, 'departments'=>app_official_travel_departments(), 'executives'=>$executives,
        'entries'=>$entries, 'today_entries'=>$todayEntries]);
}

function app_official_travel_date(array $input, string $key): string {
    $date = $input[$key] ?? null;
    if (!is_string($date) || !preg_match('/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/D', $date)) {
        app_fail('กรุณาระบุวันที่ให้ถูกต้อง');
    }
    $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
    if (!$parsed || $parsed->format('Y-m-d') !== $date) app_fail('กรุณาระบุวันที่ให้ถูกต้อง');
    return $date;
}

function app_official_travel_write(PDO $pdo, array $user, array $input): never {
    if (!app_can($user, 'official_travel')) app_fail('คุณไม่มีสิทธิ์แก้ไขปฏิทิน', 403);
    if (!isset($input['_expected_owner'])) app_fail('กรุณาโหลดหน้าใหม่ก่อนบันทึก');
    app_expected_owner($input, $user);
    $id = $input['id'] ?? 0;
    $revision = $input['revision'] ?? 0;
    $executiveIdsInput = $input['executive_ids'] ?? (array_key_exists('executive_id', $input) ? [$input['executive_id']] : null);
    $department = $input['department'] ?? null;
    $status = $input['status'] ?? null;
    if (!is_int($id) || $id < 0 || !is_int($revision) || ($id ? $revision < 1 : $revision !== 0)
        || !is_array($executiveIdsInput) || !$executiveIdsInput || count($executiveIdsInput) > 20
        || !is_string($department) || !isset(app_official_travel_departments()[$department])
        || !in_array($status, $id ? ['scheduled','postponed','cancelled'] : ['scheduled'], true)) {
        app_fail('ข้อมูลกำหนดการไม่ถูกต้อง');
    }
    $executiveIds = [];
    foreach ($executiveIdsInput as $executiveId) {
        if (!is_int($executiveId) || $executiveId < 1) app_fail('กรุณาเลือกผู้ไปราชการจากรายชื่อผู้บริหาร');
        $executiveIds[$executiveId] = $executiveId;
    }
    $executiveIds = array_values($executiveIds);
    if ($id && count($executiveIds) !== 1) app_fail('แก้ไขกำหนดการได้ครั้งละหนึ่งคน');
    $start = app_official_travel_date($input, 'start_date');
    $end = app_official_travel_date($input, 'end_date');
    $allDay = $input['all_day'] ?? null;
    if (!is_bool($allDay)) app_fail('กรุณาระบุว่าเดินทางทั้งวันหรือระบุเวลา');
    $startTime = $allDay ? null : ($input['start_time'] ?? null);
    $endTime = $allDay ? null : ($input['end_time'] ?? null);
    if (!$allDay) {
        foreach ([$startTime,$endTime] as $time) {
            if (!is_string($time) || !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/D', $time)) app_fail('กรุณาระบุเวลาไปและกลับให้ถูกต้อง');
        }
    }
    if ($start > $end || (!$allDay && $start === $end && $startTime >= $endTime)) {
        app_fail('วันและเวลากลับต้องไม่อยู่ก่อนวันไป และรายการระบุเวลาต้องมีเวลากลับหลังเวลาไป');
    }
    $subject = app_text($input, 'subject', 200, true);
    $place = app_text($input, 'place', 200, true);
    $reference = app_text($input, 'reference_no', 100);
    $note = app_text($input, 'private_note', 1000);

    try {
        $pdo->beginTransaction();
        $lockedUser = app_user(false, true);
        if (!$lockedUser || $lockedUser['User_Id'] !== $user['User_Id']) {
            $pdo->rollBack();
            app_fail('กรุณาเข้าสู่ระบบใหม่', 401);
        }
        if ($lockedUser['User_Status'] !== 'Admin') {
            $grant = $pdo->prepare("SELECT 1 FROM eoffice_permissions WHERE User_Id=? AND permission='official_travel' LOCK IN SHARE MODE");
            $grant->execute([$lockedUser['User_Id']]);
            if (!$grant->fetchColumn()) {
                $pdo->rollBack();
                app_fail('คุณไม่มีสิทธิ์แก้ไขปฏิทิน', 403);
            }
        }
        $old = null;
        if ($id) {
            $q = $pdo->prepare('SELECT executive_id,executive_name,department,status,revision FROM eoffice_official_travel WHERE id=? FOR UPDATE');
            $q->execute([$id]);
            $old = $q->fetch();
            if (!$old || (int)$old['revision'] !== $revision) {
                $pdo->rollBack();
                app_fail('รายการถูกเปลี่ยนแล้ว กรุณาปิดฟอร์มและโหลดข้อมูลใหม่', 409);
            }
        }
        $people = [];
        $personQuery = $pdo->prepare("SELECT User_Name, User_Position FROM t_user
            WHERE User_Id=? AND User_Position IN ('director','deputy_director') LOCK IN SHARE MODE");
        foreach ($executiveIds as $executiveId) {
            if ($old && (int)$old['executive_id'] === $executiveId) {
                $people[] = [
                    'id' => $executiveId,
                    'name' => $old['executive_name'],
                    'position' => $old['department'] === 'director' ? 'director' : 'deputy_director',
                ];
                continue;
            }
            $personQuery->execute([$executiveId]);
            $person = $personQuery->fetch();
            if (!$person) {
                $pdo->rollBack();
                app_fail('กรุณาเลือก ผอ. หรือรอง ผอ. จากรายชื่อผู้บริหาร', 422);
            }
            $people[] = ['id'=>$executiveId, 'name'=>$person['User_Name'], 'position'=>$person['User_Position']];
        }
        $hasDeputy = (bool)array_filter($people, fn($person) => $person['position'] === 'deputy_director');
        if (($hasDeputy && $department === 'director') || (!$hasDeputy && $department !== 'director')) {
            $pdo->rollBack();
            app_fail('ฝ่ายที่เลือกไม่ตรงกับตำแหน่งผู้ไปราชการ', 422);
        }
        $createdIds = [];
        if ($id) {
            $person = $people[0];
            $q = $pdo->prepare('UPDATE eoffice_official_travel SET executive_id=?,executive_name=?,department=?,subject=?,place=?,start_date=?,end_date=?,start_time=?,end_time=?,status=?,reference_no=?,private_note=?,revision=revision+1 WHERE id=?');
            $q->execute([$person['id'],$person['name'],$person['position'] === 'director' ? 'director' : $department,
                $subject,$place,$start,$end,$startTime,$endTime,$status,$reference,$note,$id]);
            $target = $id;
            $createdIds[] = $id;
            app_audit('official_travel.update', $lockedUser, $target,
                $old ? ['from'=>$old['status'], 'to'=>$status] : []);
        } else {
            $q = $pdo->prepare('INSERT INTO eoffice_official_travel (executive_id,executive_name,department,subject,place,start_date,end_date,start_time,end_time,status,reference_no,private_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
            foreach ($people as $person) {
                $rowDepartment = $person['position'] === 'director' ? 'director' : $department;
                $q->execute([$person['id'],$person['name'],$rowDepartment,$subject,$place,$start,$end,$startTime,$endTime,$status,$reference,$note]);
                $target = (int)$pdo->lastInsertId();
                $createdIds[] = $target;
                app_audit('official_travel.create', $lockedUser, $target);
            }
        }
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    app_json(['status'=>'success', 'id'=>$createdIds[0], 'ids'=>$createdIds], $id ? 200 : 201);
}
