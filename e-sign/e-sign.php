<?php
require_once __DIR__.'/../config/services.php';
require_once __DIR__.'/../config/sign-routing.php';

$rawDocId=$_GET['Doc_Id']??0;
$docId=filter_var($rawDocId,FILTER_VALIDATE_INT,['options'=>['min_range'=>1]])?:0;
$user=app_user(false);
$doc=null;$error=null;$statusCode=400;$fileName='';$year='';

if(!$user){$error='กรุณาเข้าสู่ระบบใหม่';$statusCode=401;}
elseif($docId<1){$error='ไม่พบเอกสาร';$statusCode=404;}
else{
    [$doc,$lookupError]=app_document_lookup($docId,$user);
    if(!$doc){$error=$lookupError==='not_found'?'ไม่พบเอกสาร':'คุณไม่มีสิทธิ์เข้าถึงเอกสารนี้';$statusCode=$lookupError==='not_found'?404:403;}
}

if($doc){
    $rawFile=$_GET['File_Path']??'';
    $fileName=is_string($rawFile)?trim($rawFile):'';
    if(mb_strlen($fileName)>255){$error='ชื่อไฟล์ยาวเกินไป';$statusCode=400;$doc=null;}
    else{
        $pdo=app_pdo();
        if($fileName===''){
            $q=$pdo->prepare('SELECT Doc_Upload_Path FROM t_document_upload WHERE Doc_File_Link=? LIMIT 1');
            $q->execute([$doc['Doc_File_Link']]);$fileName=(string)($q->fetchColumn()?:'');
        }else{
            $q=$pdo->prepare('SELECT 1 FROM t_document_upload WHERE Doc_File_Link=? AND Doc_Upload_Path=? LIMIT 1');
            $q->execute([$doc['Doc_File_Link'],$fileName]);
            if(!$q->fetchColumn()){$error='ไฟล์ไม่ตรงกับเอกสาร';$statusCode=403;$doc=null;}
        }
    }
    if($doc){
        $year=trim((string)($doc['Doc_Year']??''));
        if($fileName===''||$fileName!==basename($fileName)||str_contains($fileName,'\\')||!preg_match('/^\d{4}$/',$year)){
            $error='ข้อมูลไฟล์เอกสารไม่ถูกต้อง';$statusCode=400;$doc=null;
        }
    }
}

if($error){
    http_response_code($statusCode);
    header('Cache-Control: no-store');
    $safe=htmlspecialchars($error,ENT_QUOTES,'UTF-8');
    echo '<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>เปิดเอกสารไม่ได้</title>'
        .'<style>body{font-family:"Sarabun",Tahoma,sans-serif;background:#f3f4f6;margin:0;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}'
        .'.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 12px 40px #0f172a1a;max-width:480px;padding:28px;text-align:center}'
        .'h1{font-size:20px;margin:0 0 10px;color:#0f172a}p{color:#475569;line-height:1.7;margin:0 0 20px}'
        .'a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 18px;border-radius:10px;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600}</style></head>'
        .'<body><main class="card"><h1>เปิดเอกสารไม่ได้</h1><p>'.$safe.'</p><a href="../index.php">กลับหน้าหลัก</a></main></body></html>';
    exit;
}

header('Cache-Control: no-store');
$docId=(int)$doc['Doc_Id'];
$version=uniqid('',true);
$urlPrimary='../api/view_file.php?'.http_build_query([
    'Type'=>'signed',
    'Year'=>$year,
    'File_Path'=>$fileName,
    'version'=>$version,
    'Doc_Id'=>$docId,
],'','&',PHP_QUERY_RFC3986);

$jsonFlags=JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT|JSON_UNESCAPED_SLASHES|JSON_INVALID_UTF8_SUBSTITUTE;
$urlPrimaryJson=json_encode($urlPrimary,$jsonFlags);
$docIdInt=$docId;
$yearJson=json_encode($year,$jsonFlags);
$fileBasenameJson=json_encode($fileName,$jsonFlags);

$q=app_pdo()->prepare('SELECT Is_Signed,Date FROM t_access_rights WHERE Doc_Id=? AND User_Id=?');
$q->execute([$docId,$user['User_Id']]);$myAccess=$q->fetch()?:[];
$docInfoJson=json_encode([
    'id'=>$docId,
    'number'=>(string)($doc['Doc_Number']??''),
    'name'=>(string)($doc['Doc_Name']??''),
    'date'=>(string)($doc['Doc_Date_Receive']??($doc['Doc_Date']??'')),
    'from'=>(string)($doc['Doc_Receive_From']??''),
    'status'=>(string)($doc['Status']??''),
    'fileName'=>$fileName,
    'year'=>$year,
    'mySigned'=>($myAccess['Is_Signed']??'false')==='true',
    'mySignedDate'=>(string)($myAccess['Date']??''),
    'userId'=>(int)$user['User_Id'],
    'userName'=>(string)($user['User_Name']??''),
],$jsonFlags);
$departmentsJson=json_encode(app_sign_departments(),$jsonFlags);

$tailwindVersion=@filemtime(__DIR__.'/../assets/tailwind.css')?:'1';
$pdfjsVersion=@filemtime(__DIR__.'/../assets/vendor/pdfjs/pdf.min.js')?:'1';
$pdfLibVersion=@filemtime(__DIR__.'/../assets/vendor/pdf-lib.min.js')?:'1';
$lucideVersion=@filemtime(__DIR__.'/../assets/vendor/lucide.min.js')?:'1';
$appVersion=@filemtime(__DIR__.'/../assets/e-sign-app.js')?:'1';
?><!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover">
    <title>E-Office ระบบหนังสือราชการ</title>
    <link rel="icon" type="image/x-icon" href="eoffice_icon.ico">

    <link rel="stylesheet" href="../assets/tailwind.css?v=<?= htmlspecialchars($tailwindVersion,ENT_QUOTES,'UTF-8') ?>">

    <script type="module">
        (async () => {
            try {
                const pdfjs = await import('../assets/vendor/pdfjs/pdf.min.js?v=<?= htmlspecialchars($pdfjsVersion,ENT_QUOTES,'UTF-8') ?>');
                window.pdfjsLib = pdfjs;
                window.pdfjsWorkerUrl = '../assets/vendor/pdfjs/pdf.worker.min.js?v=<?= htmlspecialchars($pdfjsVersion,ENT_QUOTES,'UTF-8') ?>';
                window.dispatchEvent(new Event('pdfjsready'));
            } catch (localError) {
                try {
                    const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
                    window.pdfjsLib = pdfjs;
                    window.pdfjsWorkerUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
                    window.dispatchEvent(new Event('pdfjsready'));
                } catch (remoteError) {
                    window.pdfjsLoadError = remoteError || localError;
                    window.dispatchEvent(new Event('pdfjsfailed'));
                }
            }
        })();
    </script>
    <script src="../assets/vendor/pdf-lib.min.js?v=<?= htmlspecialchars($pdfLibVersion,ENT_QUOTES,'UTF-8') ?>" onerror="this.onerror=null;this.src='https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'"></script>
    <script src="../assets/stamp-render-queue.js?v=20261008-1"></script>

    <!-- Icons (local, with CDN fallback) -->
    <script src="../assets/vendor/lucide.min.js?v=<?= htmlspecialchars($lucideVersion,ENT_QUOTES,'UTF-8') ?>" onerror="this.onerror=null;this.src='https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js'"></script>

    <style>
        @font-face {
            font-family: 'Sarabun';
            src: url('../assets/fonts/sarabun/Sarabun-Regular.ttf') format('truetype');
            font-weight: 400;
            font-style: normal;
            font-display: swap;
        }
        @font-face {
            font-family: 'Sarabun';
            src: url('../assets/fonts/sarabun/Sarabun-Bold.ttf') format('truetype');
            font-weight: 600;
            font-style: normal;
            font-display: swap;
        }

        /* Use this page's hidden state even if a CDN stylesheet is unavailable. */
        .hidden { display: none !important; }

        body {
            font-family: 'Sarabun', Tahoma, sans-serif;
            background-color: #f3f4f6;
            overflow: hidden;
            height: 100vh;
            height: 100dvh;
            display: flex;
            flex-direction: column;
        }

        /* Canvas Container Layering */
        .page-container {
            position: relative;
            margin-bottom: 20px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }

        .pdf-canvas {
            display: block;
            background-color: white;
            /* Ensure canvas doesn't overflow visually if scaled */
            max-width: 100%;
            height: auto;
        }

        .drawing-canvas {
            position: absolute;
            top: 0;
            left: 0;
            cursor: crosshair;
            touch-action: none;
            max-width: 100%;
            height: auto;
        }

        .tool-btn.active {
            background-color: #eff6ff; /* blue-50 */
            color: #2563eb; /* blue-600 */
            border-color: #2563eb;
            box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.06);
        }

        /* Custom Scrollbar */
        #document-container::-webkit-scrollbar {
            width: 8px;
        }
        #document-container::-webkit-scrollbar-track {
            background: #f1f1f1;
        }
        #document-container::-webkit-scrollbar-thumb {
            background: #c1c1c1;
            border-radius: 4px;
        }

        .loading-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(255,255,255,0.95);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 70;
            flex-direction: column;
        }

        /* --- Signing workspace shell --- */
        .app-header {
            background: #fff;
            border-bottom: 1px solid #e2e8f0;
            box-shadow: 0 2px 10px rgba(15,23,42,.05);
            flex: none;
            z-index: 20;
        }
        .app-header__inner {
            max-width: 1440px;
            margin: 0 auto;
            padding: 10px max(16px, env(safe-area-inset-left)) 10px max(16px, env(safe-area-inset-right));
            padding-top: max(10px, env(safe-area-inset-top));
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 0;
        }
        .app-back {
            width: 44px;
            height: 44px;
            min-width: 44px;
            border-radius: 12px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: #4338ca;
            background: #eef2ff;
            text-decoration: none;
        }
        .app-back:hover { background: #e0e7ff; }
        .app-back svg { width: 22px; height: 22px; }
        .app-brand { width: 42px; height: 42px; object-fit: contain; flex: none; }
        .app-doc { min-width: 0; flex: 1; }
        .app-doc__eyebrow {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
            font-size: 12px;
            color: #475569;
            line-height: 1.4;
        }
        .app-doc__title {
            font-size: 17px;
            line-height: 1.35;
            font-weight: 600;
            color: #0f172a;
            margin: 2px 0 3px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .app-doc__meta {
            margin: 0;
            font-size: 12px;
            color: #64748b;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .status-badge {
            display: inline-flex;
            align-items: center;
            min-height: 24px;
            padding: 2px 9px;
            border-radius: 999px;
            background: #fff7ed;
            color: #c2410c;
            border: 1px solid #fed7aa;
            font-size: 11px;
            font-weight: 600;
        }
        .status-badge--signed { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
        .app-header__actions { display: flex; align-items: center; gap: 8px; margin-left: auto; flex: none; }
        .save-state {
            max-width: 250px;
            font-size: 12px;
            color: #475569;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 999px;
            padding: 6px 10px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .save-state--dirty { color: #b45309; background: #fffbeb; border-color: #fde68a; }
        .save-state--saved { color: #047857; background: #ecfdf5; border-color: #a7f3d0; }

        .app-banner {
            flex: none;
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 10px max(16px, env(safe-area-inset-left)) 10px max(16px, env(safe-area-inset-right));
            border-bottom: 1px solid;
            font-size: 13px;
            line-height: 1.5;
            z-index: 19;
        }
        .app-banner--error { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
        .app-banner--warning { background: #fffbeb; border-color: #fde68a; color: #92400e; }
        .app-banner__text { flex: 1; min-width: 0; }
        .app-banner__text strong { display: block; margin-bottom: 2px; }
        .app-banner__text p { margin: 0; }
        .app-banner__actions { display: flex; gap: 8px; flex: none; }

        .save-success {
            position: fixed;
            right: 18px;
            bottom: calc(92px + env(safe-area-inset-bottom));
            width: min(460px, calc(100vw - 32px));
            background: #fff;
            border: 1px solid #a7f3d0;
            border-left: 5px solid #059669;
            border-radius: 14px;
            box-shadow: 0 18px 50px rgba(15,23,42,.2);
            padding: 14px 16px;
            z-index: 45;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .save-success p { margin: 4px 0 0; color: #475569; font-size: 13px; }
        .save-success__actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: flex-end; }

        .app-toolbar {
            flex: none;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: center;
            gap: 6px 10px;
            padding: 8px max(12px, env(safe-area-inset-left)) calc(8px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-right));
            background: #fff;
            border-top: 1px solid #e2e8f0;
            box-shadow: 0 -6px 18px rgba(15,23,42,.05);
            z-index: 25;
        }
        .tool-group, .page-group, .zoom-group, .action-group { display: flex; align-items: center; gap: 4px; min-width: 0; }
        .action-group { margin-left: auto; gap: 8px; }
        .tool-sep { width: 1px; height: 26px; background: #e2e8f0; margin: 0 3px; flex: none; }
        .whiteout-dot {
            position: absolute; right: 7px; bottom: 6px; width: 9px; height: 9px;
            border-radius: 50%; background: #fff; border: 1px solid #64748b;
        }
        .stamp-dot { position: absolute; right: 7px; top: 6px; width: 8px; height: 8px; border-radius: 50%; background: #ef4444; }
        .page-indicator { min-width: 82px; text-align: center; font-size: 12px; color: #475569; white-space: nowrap; }
        .download-label { display: inline; }
        #toast { bottom: calc(96px + env(safe-area-inset-bottom)) !important; max-width: min(560px, calc(100vw - 24px)); }

        #document-container {
            min-height: 0;
            overflow: auto;
            overscroll-behavior: contain;
            -webkit-overflow-scrolling: touch;
        }
        #pages-wrapper {
            transform-origin: top center;
            margin: 0 auto;
            transition: zoom .15s ease;
        }
        .page-container { position: relative; }
        .page-placeholder {
            display: flex;
            align-items: center;
            justify-content: center;
            background: #fff;
            color: #94a3b8;
            font-size: 12px;
            border: 1px dashed #e2e8f0;
            box-sizing: border-box;
            width: min(100%, 860px);
        }

        .modal-backdrop, .drawer-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(15,23,42,.55);
            z-index: 60;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            backdrop-filter: blur(3px);
        }
        .modal-card {
            background: #fff;
            border-radius: 16px;
            box-shadow: 0 24px 80px rgba(15,23,42,.35);
            width: min(560px, 100%);
            max-height: calc(100dvh - 32px);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .modal-card--stamp { width: min(480px, 100%); }
        .modal-card__head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 14px 18px;
            border-bottom: 1px solid #e2e8f0;
            flex: none;
        }
        .modal-card__head h2, .modal-card__head h3 { margin: 0; font-size: 17px; }
        .modal-card__head--blue { background: #1d4ed8; border-bottom-color: #1e40af; color: #fff; }
        .modal-card__head--blue button { background: transparent; border: 0; color: #fff; min-height: 36px; min-width: 36px; cursor: pointer; }
        .modal-card__body { padding: 18px; overflow-y: auto; min-height: 0; display: flex; flex-direction: column; gap: 14px; }
        .modal-card__foot {
            padding: 12px 18px;
            border-top: 1px solid #e2e8f0;
            background: #f8fafc;
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            flex-wrap: wrap;
            flex: none;
        }
        .field-error { color: #b91c1c; font-size: 12px; margin: 6px 0 0; }
        .muted { color: #64748b; font-size: 13px; }
        .modal-card__body p { margin: 0; }
        #stamp-preview-canvas { max-width: 100%; height: auto; }
        .drawer-backdrop { align-items: stretch; justify-content: flex-end; padding: 0; }
        .audit-drawer {
            background: #fff;
            width: min(460px, 100%);
            height: 100%;
            display: flex;
            flex-direction: column;
            box-shadow: -20px 0 60px rgba(15,23,42,.25);
        }
        .audit-content { padding: 16px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; }
        .audit-section h3 { margin: 0 0 8px; font-size: 14px; color: #0f172a; }
        .audit-row { border-bottom: 1px solid #f1f5f9; padding: 8px 0; font-size: 13px; line-height: 1.55; }
        .audit-row:last-child { border-bottom: 0; }
        .audit-row strong { color: #0f172a; }
        .audit-row small { color: #64748b; }
        .audit-empty { color: #94a3b8; font-size: 13px; }
        .audit-method { display: inline-flex; align-items: center; border-radius: 999px; padding: 1px 8px; background: #eef2ff; color: #4338ca; font-size: 11px; }

        @media (max-width: 760px) {
            .app-header__inner { gap: 8px; padding-top: 8px; padding-bottom: 8px; }
            .app-brand { display: none; }
            .app-doc__title { font-size: 15px; }
            .save-state { display: none; }
            .audit-label { display: none; }
            .app-banner { align-items: flex-start; }
            .app-banner__actions { flex-direction: column; }
            .app-toolbar { justify-content: flex-start; gap: 6px; }
            .action-group { margin-left: 0; width: 100%; justify-content: flex-end; order: 5; }
            .page-group { order: 2; }
            .zoom-group { order: 3; }
            .download-label { display: none; }
            .save-success { right: 12px; left: 12px; width: auto; bottom: calc(150px + env(safe-area-inset-bottom)); }
            #toast { bottom: calc(165px + env(safe-area-inset-bottom)) !important; }
        }
        @media (max-width: 420px) {
            .tool-group { width: 100%; justify-content: space-between; }
            .tool-sep { display: none; }
            .page-group { flex: 1; justify-content: center; }
            .zoom-group { flex: 1; justify-content: flex-end; }
            #btn-save { flex: 1; }
        }
    </style>
    <link rel="stylesheet" href="../assets/ui-buttons.css?v=20261016-buttons-3">
</head>
<body class="flex flex-col">

    <noscript>
        <div class="app-banner app-banner--error" role="alert">
            <div class="app-banner__text"><strong>ต้องเปิดใช้งาน JavaScript</strong><p>หน้าเซ็นเอกสารต้องใช้ JavaScript ในการแสดงและบันทึกเอกสาร</p></div>
        </div>
    </noscript>

    <!-- Loading Screen -->
    <div id="loading" class="loading-overlay hidden" role="status" aria-live="polite">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <p id="loading-text" class="text-gray-600 font-semibold">กำลังเชื่อมต่อ Server...</p>
    </div>

    <!-- Document header -->
    <header id="app-header" class="app-header">
        <div class="app-header__inner">
            <a class="app-back" href="../index.php" aria-label="กลับหน้าหลัก">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M15 18L9 12L15 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </a>
            <img class="app-brand" src="../img/icon_app_xl.png" width="42" height="42" alt="">
            <div class="app-doc">
                <div class="app-doc__eyebrow">
                    <span id="doc-number"><?= htmlspecialchars((string)($doc['Doc_Number']??''),ENT_QUOTES,'UTF-8') ?></span>
                    <span id="doc-status-badge" class="status-badge <?= ($myAccess['Is_Signed']??'false')==='true'?'status-badge--signed':'' ?>"><?= ($myAccess['Is_Signed']??'false')==='true'?'ลงนามแล้ว':'รอลงนาม' ?></span>
                </div>
                <h1 id="doc-name" class="app-doc__title"><?= htmlspecialchars((string)($doc['Doc_Name']??'เอกสาร'),ENT_QUOTES,'UTF-8') ?></h1>
                <p class="app-doc__meta">
                    <?php
                    $metaParts=array_filter([
                        trim((string)($doc['Doc_Date_Receive']??($doc['Doc_Date']??''))),
                        trim((string)($doc['Doc_Receive_From']??'')),
                        'ปี '.$year,
                    ],static fn($value)=>$value!=='');
                    echo htmlspecialchars(implode(' • ',$metaParts),ENT_QUOTES,'UTF-8');
                    ?>
                </p>
            </div>
            <div class="app-header__actions">
                <span id="save-state" class="save-state" role="status" aria-live="polite">พร้อมลงนาม</span>
                <button id="btn-audit" type="button" class="eo-btn eo-btn--ghost eo-btn--sm" onclick="openAuditDrawer()" aria-label="ประวัติการลงนาม">
                    <i data-lucide="history" class="w-4 h-4"></i><span class="audit-label">ประวัติ</span>
                </button>
            </div>
        </div>
    </header>

    <div id="error-banner" class="app-banner app-banner--error hidden" role="alert" aria-live="assertive">
        <div class="app-banner__text">
            <strong id="error-title">เกิดข้อผิดพลาด</strong>
            <p id="error-message"></p>
        </div>
        <div class="app-banner__actions">
            <button id="error-retry" type="button" class="eo-btn eo-btn--secondary eo-btn--sm hidden" onclick="retryLastAction()">ลองใหม่</button>
            <button id="error-dismiss" type="button" class="eo-btn eo-btn--ghost eo-btn--sm" onclick="hideErrorBanner()">ปิด</button>
        </div>
    </div>

    <div id="session-banner" class="app-banner app-banner--warning hidden" role="status" aria-live="polite">
        <div class="app-banner__text">
            <strong>เซสชันหมดอายุ</strong>
            <p>ลายเซ็นของคุณยังอยู่บนหน้านี้ กรุณาเข้าสู่ระบบในแท็บใหม่ แล้วกลับมากด “ลงนามและบันทึก” อีกครั้ง</p>
        </div>
        <a class="eo-btn eo-btn--secondary eo-btn--sm" href="../index.php" target="_blank" rel="noopener">เข้าสู่ระบบ</a>
    </div>

    <div id="save-success" class="save-success hidden" role="status" aria-live="polite">
        <div>
            <strong>บันทึกการลงนามเรียบร้อย</strong>
            <p id="save-success-detail"></p>
        </div>
        <div class="save-success__actions">
            <button id="success-download" type="button" class="eo-btn eo-btn--secondary eo-btn--sm" onclick="downloadDocument()">ดาวน์โหลดสำเนา</button>
            <a class="eo-btn eo-btn--primary eo-btn--sm" href="../index.php">กลับหน้าหลัก</a>
            <button type="button" class="eo-btn eo-btn--ghost eo-btn--icon" onclick="document.getElementById('save-success').classList.add('hidden')" aria-label="ปิด">×</button>
        </div>
    </div>

    <!-- Document Container -->
    <main id="document-container" class="flex-1 bg-gray-100 p-4 md:p-8 flex flex-col items-center relative">
        <div id="pages-wrapper" class="flex flex-col gap-6 shadow-2xl"></div>

        <div id="empty-state" class="text-center mt-20 hidden">
            <i data-lucide="file-warning" class="w-16 h-16 mx-auto text-gray-400 mb-4"></i>
            <p class="text-gray-500 text-lg">ไม่พบเอกสาร</p>
            <button onclick="loadServerDocument()" class="eo-btn eo-btn--secondary mt-4">ลองใหม่อีกครั้ง</button>
        </div>
    </main>

    <!-- Bottom toolbar keeps save/actions reachable on tablets and phones. -->
    <footer id="toolbar" class="app-toolbar">
        <div class="tool-group" role="group" aria-label="เครื่องมือลงนาม">
            <button type="button" onclick="setTool('hand')" id="btn-hand" class="eo-btn eo-btn--ghost eo-btn--icon tool-btn active" title="เลื่อนดู (Hand)" aria-label="เลื่อนดูเอกสาร">
                <i data-lucide="hand" class="w-5 h-5"></i>
            </button>
            <span class="tool-sep" aria-hidden="true"></span>
            <button type="button" onclick="setTool('pen')" id="btn-pen" class="eo-btn eo-btn--ghost eo-btn--icon tool-btn" title="ปากกาสีดำ" aria-label="ปากกาสีดำ">
                <i data-lucide="pen-tool" class="w-5 h-5"></i>
            </button>
            <button type="button" onclick="setTool('whiteout')" id="btn-whiteout" class="eo-btn eo-btn--ghost eo-btn--icon tool-btn relative" title="ปากกาสีขาว (ปิดทับข้อความ)" aria-label="ปากกาสีขาว สำหรับปิดทับข้อความ">
                <i data-lucide="highlighter" class="w-5 h-5"></i>
                <span class="whiteout-dot" aria-hidden="true"></span>
            </button>
            <button type="button" onclick="setTool('eraser')" id="btn-eraser" class="eo-btn eo-btn--ghost eo-btn--icon tool-btn" title="ยางลบ" aria-label="ยางลบ">
                <i data-lucide="eraser" class="w-5 h-5"></i>
            </button>
            <button type="button" onclick="openStampModal()" id="btn-stamp" class="eo-btn eo-btn--ghost eo-btn--icon tool-btn group relative" title="ประทับตรา" aria-label="ประทับตรา">
                <i data-lucide="stamp" class="w-5 h-5"></i>
                <span class="stamp-dot" aria-hidden="true"></span>
            </button>
            <span class="tool-sep" aria-hidden="true"></span>
            <button type="button" onclick="undoLastAction()" id="btn-undo" class="eo-btn eo-btn--ghost eo-btn--icon" title="ย้อนกลับ" aria-label="ย้อนกลับ">
                <i data-lucide="undo-2" class="w-5 h-5"></i>
            </button>
        </div>

        <div class="page-group" role="group" aria-label="นำทางหน้า">
            <button type="button" id="page-prev" class="eo-btn eo-btn--ghost eo-btn--icon eo-btn--sm" onclick="goToRelativePage(-1)" aria-label="หน้าก่อน">‹</button>
            <span id="page-indicator" class="page-indicator" aria-live="polite">หน้า 1 / 1</span>
            <button type="button" id="page-next" class="eo-btn eo-btn--ghost eo-btn--icon eo-btn--sm" onclick="goToRelativePage(1)" aria-label="หน้าถัดไป">›</button>
            <button type="button" id="page-last" class="eo-btn eo-btn--ghost eo-btn--sm" onclick="goToLastPage()" aria-label="ไปหน้าสุดท้าย">ท้ายเอกสาร</button>
        </div>

        <div class="zoom-group" role="group" aria-label="ซูม">
            <button type="button" class="eo-btn eo-btn--ghost eo-btn--icon eo-btn--sm" onclick="changeZoom(-0.1)" aria-label="ซูมออก">−</button>
            <button type="button" class="eo-btn eo-btn--ghost eo-btn--sm" onclick="resetZoom()" aria-label="พอดีความกว้าง">พอดี</button>
            <button type="button" class="eo-btn eo-btn--ghost eo-btn--icon eo-btn--sm" onclick="changeZoom(0.1)" aria-label="ซูมเข้า">+</button>
        </div>

        <div class="action-group">
            <button type="button" onclick="downloadDocument()" id="btn-download" class="eo-btn eo-btn--secondary" aria-label="ดาวน์โหลดเอกสาร">
                <i data-lucide="download" class="w-4 h-4"></i><span class="download-label">ดาวน์โหลด</span>
            </button>
            <button type="button" onclick="saveToServer()" id="btn-save" class="eo-btn eo-btn--primary" aria-busy="false">
                <i data-lucide="cloud-upload" class="w-4 h-4"></i>
                <span>ลงนามและบันทึก</span>
            </button>
        </div>
    </footer>

    <!-- Notification Toast -->
    <div id="toast" class="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-gray-800/90 backdrop-blur text-white px-6 py-3 rounded-full shadow-2xl opacity-0 transition-all duration-300 pointer-events-none z-50 flex items-center gap-3 translate-y-4" role="status" aria-live="polite">
        <span id="toast-icon" class="w-5 h-5 text-green-400 flex items-center"><i data-lucide="check-circle" class="w-5 h-5"></i></span>
        <span id="toast-message" class="font-medium">แจ้งเตือน</span>
    </div>

    <div id="stamp-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="stamp-title">
        <div class="modal-card modal-card--stamp">
            <div class="modal-card__head modal-card__head--blue">
                <h3 id="stamp-title" class="text-white font-bold text-lg">ระบุข้อมูลประทับตรา</h3>
                <button type="button" onclick="closeStampModal()" class="text-white" aria-label="ปิด">
                    <i data-lucide="x" class="w-5 h-5"></i>
                </button>
            </div>

            <div class="modal-card__body">
              <div>
                  <label for="stamp-text-1" class="block text-sm font-medium text-gray-700 mb-1">ฝ่ายงาน <span class="text-red-600">*</span></label>
                  <select id="stamp-text-1" required class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                      <option value="">-- เลือกฝ่ายงาน --</option>
                      <?php foreach (app_sign_departments() as $department): ?>
                      <option value="<?= htmlspecialchars($department, ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars($department, ENT_QUOTES, 'UTF-8') ?></option>
                      <?php endforeach; ?>
                  </select>
                  <p id="stamp-department-error" class="field-error hidden" role="alert">กรุณาเลือกฝ่ายงานก่อนประทับตรา</p>
              </div>
                <div id="stamp-receipt-fields" class="space-y-4">
                <div>
                    <label for="stamp-text-2" class="block text-sm font-medium text-gray-700 mb-1">เลขรับ</label>
                    <input type="text" id="stamp-text-2" class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="เลขรับ..." autocomplete="off">
                </div>
                <div>
                    <label for="stamp-text-3" class="block text-sm font-medium text-gray-700 mb-1">วันที่</label>
                    <input type="text" id="stamp-text-3" class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="วันที่..." inputmode="numeric" autocomplete="off">
                </div>
                <div>
                    <label for="stamp-text-4" class="block text-sm font-medium text-gray-700 mb-1">เวลา</label>
                    <input type="text" id="stamp-text-4" class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="เวลา..." inputmode="numeric" autocomplete="off">
                </div>
                </div>
                <p id="stamp-director-hint" class="hidden text-sm text-gray-500">หลังประทับตรา ใช้เครื่องมือปากกาติ๊กฝ่ายงาน เติมข้อความอื่น ๆ และลงลายมือชื่อบนเอกสาร</p>

                <div class="border rounded-lg p-4 bg-gray-50 flex justify-center items-center h-45">
                    <canvas id="stamp-preview-canvas" height="100" class="max-w-full h-auto" aria-label="ตัวอย่างตราประทับ"></canvas>
                </div>
            </div>

            <div class="modal-card__foot">
                <button type="button" onclick="closeStampModal()" class="eo-btn eo-btn--secondary">ยกเลิก</button>
                <button type="button" onclick="confirmStampData()" class="eo-btn eo-btn--primary">ตกลง</button>
            </div>
        </div>
    </div>

    <!-- Conflict recovery -->
    <div id="conflict-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <div class="modal-card">
            <div class="modal-card__head">
                <h2 id="conflict-title">เอกสารถูกแก้ไขระหว่างที่คุณลงนาม</h2>
                <button type="button" class="eo-btn eo-btn--ghost eo-btn--icon" onclick="hideConflictModal()" aria-label="ปิด">×</button>
            </div>
            <div class="modal-card__body">
                <p>ระบบยังเก็บลายเซ็นที่คุณทำไว้บนหน้านี้ แต่ไม่สามารถบันทึกทับเอกสารเวอร์ชันใหม่ได้โดยตรง</p>
                <p class="muted">เลือกดาวน์โหลดสำเนาที่คุณลงนามไว้เพื่อเก็บหลักฐาน หรือโหลดเอกสารล่าสุด (ลายเซ็นที่ยังไม่บันทึกจะหายไป)</p>
            </div>
            <div class="modal-card__foot">
                <button type="button" class="eo-btn eo-btn--secondary" onclick="hideConflictModal()">ยกเลิก</button>
                <button type="button" class="eo-btn eo-btn--secondary" onclick="downloadDocument()">ดาวน์โหลดสำเนา</button>
                <button type="button" class="eo-btn eo-btn--primary" onclick="reloadLatestDocument()">โหลดล่าสุด</button>
            </div>
        </div>
    </div>

    <!-- Signing history -->
    <div id="audit-overlay" class="drawer-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="audit-title" onclick="if(event.target===this)closeAuditDrawer()">
        <aside class="audit-drawer">
            <div class="modal-card__head">
                <h2 id="audit-title">ประวัติการลงนาม</h2>
                <button type="button" class="eo-btn eo-btn--ghost eo-btn--icon" onclick="closeAuditDrawer()" aria-label="ปิด">×</button>
            </div>
            <div id="audit-content" class="audit-content">
                <p class="muted">กำลังโหลด...</p>
            </div>
        </aside>
    </div>

    <script>
        window.ESIGN_CONFIG = {
            PDF_URL: <?= $urlPrimaryJson ?>,
            docId: <?= $docIdInt ?>,
            year: <?= $yearJson ?>,
            fileName: <?= $fileBasenameJson ?>,
            document: <?= $docInfoJson ?>,
            departments: <?= $departmentsJson ?>,
            SCALE: 2.5,
            workerUrl: '../assets/vendor/pdfjs/pdf.worker.min.js?v=<?= htmlspecialchars($pdfjsVersion,ENT_QUOTES,'UTF-8') ?>',
            stampUrl: 'e-stamp/template_stamp.png'
        };
    </script>
    <script src="../assets/e-sign-app.js?v=<?= htmlspecialchars($appVersion,ENT_QUOTES,'UTF-8') ?>"></script>

    <style media="screen">
      .btn-back {
    /* ล้างค่าปุ่มเดิม */
    background: none;
    border: none;
    cursor: pointer;
    /* เพิ่มพื้นที่การกดให้ใหญ่ขึ้น (สำคัญมากบนมือถือ) */
    padding: 12px;
    /* จัดตำแหน่ง */
    display: flex;
    align-items: center;
    justify-content: center;
    /* สีของไอคอน (เปลี่ยนได้ตาม Theme) */
    color: #333;
    /* เพิ่ม Effect เวลากด */
    border-radius: 50%;
    transition: background-color 0.2s;
}

/* Effect เวลามีเมาส์ชี้ หรือกดบนมือถือ */
.btn-back:hover, .btn-back:active {
    background-color: rgba(0, 0, 0, 0.2);
}

/* กำหนดขนาดไอคอน */
.icon {
    width: 35px;
    height: 35px;
}
    </style>
</body>
</html>
