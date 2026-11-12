<?php
require_once __DIR__.'/../config/services.php';
require_once __DIR__.'/../config/sign-routing.php';

$rawDocId = $_GET['Doc_Id'] ?? 0;
$docId = filter_var($rawDocId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) ?: 0;
$user = app_user(false);

function esign_v2_error_page(int $status, string $title, string $message, string $actionHref = '../index.php', string $actionLabel = 'กลับหน้าหลัก'): never
{
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    $safeTitle = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
    $safeMessage = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');
    $safeHref = htmlspecialchars($actionHref, ENT_QUOTES, 'UTF-8');
    $safeLabel = htmlspecialchars($actionLabel, ENT_QUOTES, 'UTF-8');
    echo '<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'.$safeTitle.'</title>'
        .'<style>body{font-family:"Sarabun",Tahoma,sans-serif;background:#f3f4f6;margin:0;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}'
        .'.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 12px 40px #0f172a1a;max-width:480px;padding:28px;text-align:center}'
        .'h1{font-size:20px;margin:0 0 10px;color:#0f172a}p{color:#475569;line-height:1.7;margin:0 0 20px}'
        .'a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 18px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600}'
        .'</style></head><body><main class="card"><h1>'.$safeTitle.'</h1><p>'.$safeMessage.'</p><a href="'.$safeHref.'">'.$safeLabel.'</a></main></body></html>';
    exit;
}

if (!$user) {
    esign_v2_error_page(401, 'กรุณาเข้าสู่ระบบใหม่', 'เซสชันของคุณหมดอายุหรือยังไม่ได้เข้าสู่ระบบ กรุณาเข้าสู่ระบบแล้วเปิดเอกสารนี้อีกครั้ง', '../index.php', 'เข้าสู่ระบบ');
}
if ($docId < 1) {
    esign_v2_error_page(404, 'ไม่พบเอกสาร', 'ลิงก์เอกสารไม่ถูกต้องหรือเอกสารถูกลบแล้ว');
}

$pdo = app_pdo();
$q = $pdo->prepare("SELECT * FROM t_document WHERE Doc_Id=? AND Is_Delete='active'");
$q->execute([$docId]);
$doc = $q->fetch();
if (!$doc) {
    esign_v2_error_page(404, 'ไม่พบเอกสาร', 'เอกสารนี้ถูกลบหรือไม่มีอยู่ในระบบ');
}

$allowed = (int)$doc['User_Id'] === (int)$user['User_Id'] || ($user['User_Status'] ?? '') === 'Admin';
if (!$allowed) {
    $q = $pdo->prepare('SELECT 1 FROM t_access_rights WHERE Doc_Id=? AND User_Id=? UNION SELECT 1 FROM t_access_rights_department a JOIN t_user_department u ON u.Department_Id=a.Department_Id WHERE a.Doc_Id=? AND u.User_Id=?');
    $q->execute([$docId, $user['User_Id'], $docId, $user['User_Id']]);
    $allowed = (bool)$q->fetchColumn();
}
if (!$allowed) {
    esign_v2_error_page(403, 'ไม่มีสิทธิ์เข้าถึงเอกสาร', 'บัญชีนี้ไม่มีสิทธิ์เปิดเอกสารดังกล่าว กรุณาติดต่อผู้ส่งเอกสาร');
}

$rawFile = $_GET['File_Path'] ?? '';
$fileName = is_string($rawFile) ? trim($rawFile) : '';
if ($fileName !== '' && (mb_strlen($fileName) > 255 || $fileName !== basename($fileName) || str_contains($fileName, '\\'))) {
    esign_v2_error_page(400, 'ข้อมูลไฟล์ไม่ถูกต้อง', 'ชื่อไฟล์เอกสารไม่ถูกต้อง กรุณาเปิดเอกสารจากกล่องรับเอกสารอีกครั้ง');
}
if ($fileName === '') {
    $q = $pdo->prepare('SELECT Doc_Upload_Path FROM t_document_upload WHERE Doc_File_Link=? LIMIT 1');
    $q->execute([$doc['Doc_File_Link']]);
    $fileName = (string)($q->fetchColumn() ?: '');
} else {
    $q = $pdo->prepare('SELECT 1 FROM t_document_upload WHERE Doc_File_Link=? AND Doc_Upload_Path=? LIMIT 1');
    $q->execute([$doc['Doc_File_Link'], $fileName]);
    if (!$q->fetchColumn()) {
        esign_v2_error_page(403, 'ไฟล์ไม่ตรงกับเอกสาร', 'ไฟล์ที่ระบุไม่ใช่ไฟล์ของเอกสารนี้ กรุณาเปิดเอกสารจากกล่องรับเอกสารอีกครั้ง');
    }
}
if ($fileName === '' || $fileName !== basename($fileName) || str_contains($fileName, '\\')) {
    esign_v2_error_page(404, 'ไม่พบไฟล์เอกสาร', 'เอกสารนี้ยังไม่มีไฟล์แนบที่สามารถลงนามได้');
}

$year = trim((string)($doc['Doc_Year'] ?? ''));
if (!preg_match('/^\d{4}$/', $year)) {
    esign_v2_error_page(400, 'ข้อมูลเอกสารไม่ถูกต้อง', 'ปีของเอกสารไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ');
}

$docId = (int)$doc['Doc_Id'];
$version = uniqid('', true);
$urlPrimary = '../api/view_file.php?'.http_build_query([
    'Type' => 'signed',
    'Year' => $year,
    'File_Path' => $fileName,
    'version' => $version,
    'Doc_Id' => $docId,
], '', '&', PHP_QUERY_RFC3986);

$rawRemote = $_GET['url'] ?? '';
$urlSecondary = '';
if (is_string($rawRemote) && $rawRemote !== '' && strlen($rawRemote) <= 2000 && preg_match('#^https?://#i', $rawRemote)) {
    $urlSecondary = '../api/cors.php?url='.rawurlencode($rawRemote);
}

$q = $pdo->prepare('SELECT Is_Signed, Date FROM t_access_rights WHERE Doc_Id=? AND User_Id=?');
$q->execute([$docId, $user['User_Id']]);
$myAccess = $q->fetch() ?: [];
$mySigned = ($myAccess['Is_Signed'] ?? 'false') === 'true';

$jsonFlags = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES;
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
$assetVersion = static function (string $relative): string {
    $path = __DIR__.'/'.$relative;
    return (string)(@filemtime($path) ?: '1');
};

$docMeta = array_values(array_filter([
    trim((string)($doc['Doc_Date_Receive'] ?? ($doc['Doc_Date'] ?? ''))),
    trim((string)($doc['Doc_Receive_From'] ?? '')),
    'ปี '.$year,
], static fn($value) => $value !== ''));

$configJson = json_encode([
    'docId' => $docId,
    'year' => $year,
    'fileName' => $fileName,
    'fileBaseName' => basename($fileName),
    'primaryUrl' => $urlPrimary,
    'secondaryUrl' => $urlSecondary,
    'saveUrl' => 'upload_pdf.php',
    'receiptScopesUrl' => 'receipt_scopes.php',
    'stampUrl' => 'e-stamp/template_stamp.png',
    'departments' => array_values(app_sign_departments()),
    'docNumber' => (string)($doc['Doc_Number'] ?? ''),
    'docName' => (string)($doc['Doc_Name'] ?? ''),
    'mySigned' => $mySigned,
    'userName' => (string)($user['User_Name'] ?? ''),
    'maxCanvasPixels' => 12000000,
], $jsonFlags);
?>
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover">
    <meta name="robots" content="noindex,nofollow">
    <title>ลงนามเอกสาร - E-Office</title>
    <link rel="icon" type="image/x-icon" href="eoffice_icon.ico">
    <link rel="stylesheet" href="../assets/ui-buttons.css?v=<?= htmlspecialchars($assetVersion('../assets/ui-buttons.css'), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="stylesheet" href="v2/ui.css?v=<?= htmlspecialchars($assetVersion('v2/ui.css'), ENT_QUOTES, 'UTF-8') ?>">
</head>
<body>
<div class="app">
    <header class="app-header">
        <a class="app-back" href="../index.php" aria-label="กลับหน้าหลัก">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18L9 12L15 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <img class="app-brand" src="../img/icon_app_xl.png" width="42" height="42" alt="">
        </a>
        <div class="app-doc">
            <div class="app-doc__eyebrow">
                <span class="app-doc__number"><?= htmlspecialchars((string)($doc['Doc_Number'] ?? ''), ENT_QUOTES, 'UTF-8') ?></span>
                <span id="doc-status" class="status-badge <?= $mySigned ? 'status-badge--signed' : '' ?>"><?= $mySigned ? 'ลงนามแล้ว' : 'รอลงนาม' ?></span>
                <span class="status-badge status-badge--v2">เวอร์ชันทดลอง</span>
            </div>
            <h1 class="app-doc__title"><?= htmlspecialchars((string)($doc['Doc_Name'] ?? 'เอกสาร'), ENT_QUOTES, 'UTF-8') ?></h1>
            <p class="app-doc__meta"><?= htmlspecialchars(implode(' • ', $docMeta), ENT_QUOTES, 'UTF-8') ?></p>
        </div>
        <div class="app-header__actions">
            <span id="save-state" class="save-state" role="status">พร้อมลงนาม</span>
            <button type="button" id="btn-finger" class="eo-btn eo-btn--ghost eo-btn--sm hidden" title="สลับการรับนิ้วเมื่อตรวจพบปากกา">รับเฉพาะปากกา</button>
            <span class="app-user" title="<?= htmlspecialchars((string)($user['User_Name'] ?? ''), ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars((string)($user['User_Name'] ?? ''), ENT_QUOTES, 'UTF-8') ?></span>
        </div>
    </header>

    <div id="error-banner" class="error-banner hidden" role="alert">
        <div>
            <strong id="error-title">เกิดข้อผิดพลาด</strong>
            <p id="error-message"></p>
        </div>
        <div class="error-banner__actions">
            <button type="button" id="error-retry" class="eo-btn eo-btn--secondary eo-btn--sm hidden">ลองใหม่</button>
            <button type="button" id="error-dismiss" class="eo-btn eo-btn--ghost eo-btn--sm">ปิด</button>
        </div>
    </div>

    <main id="viewer-scroll" class="viewer-scroll">
        <div id="pages" class="pages"></div>
        <div id="empty-state" class="empty-state hidden">
            <strong>ไม่พบเอกสารที่แสดงได้</strong>
            <p>ไม่สามารถโหลดไฟล์ PDF จากเซิร์ฟเวอร์ได้ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ</p>
        </div>
    </main>

    <footer class="app-toolbar">
        <div class="tool-group" role="group" aria-label="เครื่องมือลงนาม">
            <button type="button" id="btn-hand" class="eo-btn eo-btn--ghost eo-btn--icon tool-btn is-active" title="เลื่อนดู" aria-label="เลื่อนดู">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-6.5a1.5 1.5 0 0 1 3 0V12m0-5.5a1.5 1.5 0 0 1 3 0V13m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.6a6 6 0 0 1-4.8-2.4L4 14.7a1.7 1.7 0 0 1 2.7-2L8 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <span class="tool-sep" aria-hidden="true"></span>
            <button type="button" id="btn-pen" class="eo-btn eo-btn--ghost eo-btn--icon tool-btn" title="ปากกา" aria-label="ปากกา">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4.5 19.5 1.2-4.2L16.8 4.2a2.2 2.2 0 0 1 3.1 3.1L9 18.4l-4.5 1.1Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button type="button" id="btn-whiteout" class="eo-btn eo-btn--ghost eo-btn--icon tool-btn" title="ปากกาสีขาว (ปิดทับข้อความ)" aria-label="ปากกาสีขาว">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 15 6-6 6 6-3 3H8l-3-3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m11 9 4-4 5 5-4 4" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 21h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>
            <button type="button" id="btn-eraser" class="eo-btn eo-btn--ghost eo-btn--icon tool-btn" title="ยางลบ (ลบทั้งเส้น)" aria-label="ยางลบ">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 16 6-9 6 4-4 7-5 1-3-3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m11 9 6 4" stroke="currentColor" stroke-width="1.8"/><path d="M4 21h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>
            <button type="button" id="btn-stamp" class="eo-btn eo-btn--ghost eo-btn--icon tool-btn" title="ประทับตรา" aria-label="ประทับตรา">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 14.5c0-2 1.4-3.4 3-4.2V7a3 3 0 0 1 6 0v3.3c1.6.8 3 2.2 3 4.2V17H6v-2.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 20h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>
            <span class="tool-sep" aria-hidden="true"></span>
            <button type="button" id="btn-undo" class="eo-btn eo-btn--ghost eo-btn--icon" title="ย้อนกลับ" aria-label="ย้อนกลับ" disabled>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 7 4 12l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 12h9a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>
        </div>

        <div class="page-group" role="group" aria-label="นำทางหน้า">
            <button type="button" id="btn-prev" class="eo-btn eo-btn--ghost eo-btn--icon eo-btn--sm" aria-label="หน้าก่อน">‹</button>
            <span id="page-indicator" class="page-indicator" aria-live="polite">หน้า 1 / 1</span>
            <button type="button" id="btn-next" class="eo-btn eo-btn--ghost eo-btn--icon eo-btn--sm" aria-label="หน้าถัดไป">›</button>
        </div>

        <div class="zoom-group" role="group" aria-label="ซูม">
            <button type="button" id="btn-zoom-out" class="eo-btn eo-btn--ghost eo-btn--icon eo-btn--sm" aria-label="ซูมออก">−</button>
            <span id="zoom-label" class="zoom-label" aria-live="polite">100%</span>
            <button type="button" id="btn-zoom-fit" class="eo-btn eo-btn--ghost eo-btn--sm" aria-label="พอดีความกว้าง">พอดี</button>
            <button type="button" id="btn-zoom-in" class="eo-btn eo-btn--ghost eo-btn--icon eo-btn--sm" aria-label="ซูมเข้า">+</button>
        </div>

        <div class="action-group">
            <button type="button" id="btn-download" class="eo-btn eo-btn--secondary" aria-label="ดาวน์โหลดเอกสาร">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v10m0 0 4-4m-4 4-4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 19h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                <span>ดาวน์โหลด</span>
            </button>
            <button type="button" id="btn-save" class="eo-btn eo-btn--primary" aria-label="ลงนามและบันทึก" aria-busy="false">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 17h10a3 3 0 0 0 .4-6 5 5 0 0 0-9.6-1.3A4 4 0 0 0 7 17Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 12v5m0-5-2 2m2-2 2 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <span>ลงนามและบันทึก</span>
            </button>
        </div>
    </footer>
</div>

<div id="loading" class="loading hidden" role="status" aria-live="polite">
    <span class="loading__spinner" aria-hidden="true"></span>
    <p id="loading-text">กำลังโหลดเอกสาร...</p>
</div>

<div id="stamp-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="stamp-title">
    <div class="modal__card">
        <div class="modal__head">
            <h2 id="stamp-title">ระบุข้อมูลประทับตรา</h2>
            <button type="button" id="stamp-close" class="eo-btn eo-btn--ghost eo-btn--icon eo-btn--sm" aria-label="ปิด">×</button>
        </div>
        <div class="modal__body">
            <label class="field">
                <span>ฝ่ายงาน</span>
                <select id="stamp-text-1">
                    <option value="">-- เลือกฝ่ายงาน --</option>
                    <?php foreach (app_sign_departments() as $department): ?>
                        <option value="<?= htmlspecialchars($department, ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars($department, ENT_QUOTES, 'UTF-8') ?></option>
                    <?php endforeach; ?>
                </select>
            </label>
            <div id="stamp-receipt-fields" class="field-stack">
                <label class="field"><span>เลขรับ</span><input type="text" id="stamp-text-2" placeholder="เลขรับ..." autocomplete="off"></label>
                <label class="field"><span>วันที่</span><input type="text" id="stamp-text-3" placeholder="วันที่..." autocomplete="off"></label>
                <label class="field"><span>เวลา</span><input type="text" id="stamp-text-4" placeholder="เวลา..." autocomplete="off"></label>
            </div>
            <p id="stamp-director-hint" class="hint hidden">หลังประทับตรา ใช้ปากกาติ๊กฝ่ายงาน เติมข้อความ และลงลายมือชื่อบนเอกสาร</p>
            <div class="stamp-preview">
                <canvas id="stamp-preview-canvas" height="100" aria-label="ตัวอย่างตราประทับ"></canvas>
            </div>
        </div>
        <div class="modal__foot">
            <button type="button" id="stamp-cancel" class="eo-btn eo-btn--secondary">ยกเลิก</button>
            <button type="button" id="stamp-confirm" class="eo-btn eo-btn--primary">ตกลง</button>
        </div>
    </div>
</div>

<div id="toast" class="toast hidden" role="status" aria-live="polite">
    <span class="toast__dot" aria-hidden="true"></span>
    <span id="toast-message">แจ้งเตือน</span>
</div>

<script>
window.ESIGN_V2_CONFIG = <?= $configJson ?>;
</script>
<script src="v2/vendor/pdf-lib.min.js"></script>
<script src="../assets/stamp-render-queue.js"></script>
<script src="v2/geometry.js"></script>
<script type="module" src="v2/app.js?v=<?= htmlspecialchars($assetVersion('v2/app.js'), ENT_QUOTES, 'UTF-8') ?>"></script>
</body>
</html>
