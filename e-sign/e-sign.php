
<!DOCTYPE html>
<html lang="th">
<head>
<?php


 $Doc_Id = $_GET['Doc_Id'] ?? '';
 $File_Path = $_GET['File_Path'] ?? '';
 $Year = $_GET['Year'] ?? '';
 $url = $_GET['url'] ?? '';

$version = uniqid();
$file_request = "../api/view_file.php?Type=signed&Year=$Year&File_Path=$File_Path&version=$version&Doc_Id=$Doc_Id";
// URL หลัก (อันที่ 1)
$url_primary = "../api/view_file.php?Type=signed&Year=$Year&File_Path=$File_Path&version=$version&Doc_Id=$Doc_Id";
// URL สำรอง (อันที่ 2)
// $url =  'https://amss.sesact.go.th/modules/bookregister/upload_files2/1769410561x2033142038_1.pdf';
$url_secondary = "../api/cors.php?url=".urlencode($url);
//
// $file_request = "../api/view_file.php?File_Path=$File_Path&Type=signed&Year=$Year";
// // URL หลัก (อันที่ 1)
// $url_primary = "../api/view_file.php?File_Path=$File_Path&Type=signed&Year=$Year";
// // URL สำรอง (อันที่ 2)
// $url_secondary = "https://eoffice.siya.ac.th/file_request.php?Doc_Id=$Doc_Id&File_Path=2567/".$File_Path;


$jsonFlags = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES;

// 🛡️ SECURITY: JSON_HEX_* กันการหนีออกจากแท็ก <script> (XSS ผ่าน </script>)
$url_primary_json   = json_encode($url_primary, $jsonFlags);
$url_secondary_json = json_encode($url_secondary, $jsonFlags);
$year_json          = json_encode($Year, $jsonFlags);
$file_basename_json = json_encode(basename($File_Path), $jsonFlags);
$doc_id_int         = (int)$Doc_Id;
?>

    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>E-Office ระบบหนังสือราชการ  </title>
    <link rel="icon" type="image/x-icon" href="eoffice_icon.ico">

    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>

    <!-- PDF.js -->
    <script type="module">
        import * as pdfjs from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
        window.pdfjsLib = pdfjs;
        window.dispatchEvent(new Event('pdfjsready'));
    </script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"></script>


    <!-- Icons (Lucide) -->
    <script src="https://unpkg.com/lucide@latest"></script>

    <style>
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;600&display=swap');

        body {
            font-family: 'Sarabun', sans-serif;
            background-color: #f3f4f6;
            overflow: hidden;
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
            z-index: 50;
            flex-direction: column;
        }
    </style>
</head>
<body class="h-screen flex flex-col">

<script>
   var Stamp_Name ;
      if (!Stamp_Name) {
   Stamp_Name = 'template_stamp.png';
      }
</script>



    <!-- Loading Screen -->
    <div id="loading" class="loading-overlay hidden">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <p id="loading-text" class="text-gray-600 font-semibold">กำลังเชื่อมต่อ Server...</p>
    </div>

    <!-- Toolbar -->
    <header class="bg-white border-b border-gray-200 shadow-sm z-20 flex-none px-4 py-3">
        <div class="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">

            <!-- Title -->
            <div class="flex items-center gap-2 w-full sm:w-auto">
              <a class="flex items-center" href="../index.php">
                <!-- <div class="bg-blue-600 text-white p-2 rounded-lg">
                    <i data-lucide="file-signature" class="w-6 h-6"></i>
                </div> -->

                <button class="btn-back" width="50px">
                    <svg class="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M15 18L9 12L15 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>

                <img src="../img/icon_app_xl.png" width="50px" height="50px">
                <div>
                    <h1 class="text-lg font-bold text-gray-800 leading-tight">ระบบหนังสือราชการ</h1>
                    <p class="text-xs text-gray-500">E-Office</p>
                </div>

                </a>
            </div>


            <!-- Drawing Tools -->
            <div class="flex items-center bg-gray-50 p-1.5 rounded-xl border border-gray-200 gap-1 shadow-inner overflow-x-auto max-w-full">
                <button onclick="setTool('hand')" id="btn-hand" class="tool-btn active p-2 rounded-lg hover:bg-white border border-transparent transition flex-shrink-0" title="เลื่อนดู (Hand)">
                    <i data-lucide="hand" class="w-5 h-5"></i>
                </button>

                <div class="w-px h-6 bg-gray-300 mx-1 flex-shrink-0"></div>

                <button onclick="setTool('pen')" id="btn-pen" class="tool-btn p-2 rounded-lg hover:bg-white border border-transparent transition flex-shrink-0" title="ปากกาสีดำ">
                    <i data-lucide="pen-tool" class="w-5 h-5"></i>
                </button>

                <button onclick="setTool('eraser')" id="btn-eraser" class="tool-btn p-2 rounded-lg hover:bg-white border border-transparent transition flex-shrink-0" title="ยางลบ">
                    <i data-lucide="eraser" class="w-5 h-5"></i>
                </button>

                <!-- <button onclick="setTool('stamp')" id="btn-stamp" class="tool-btn p-2 rounded-lg hover:bg-white border border-transparent transition group relative flex-shrink-0" title="ประทับตรา">
                    <i data-lucide="stamp" class="w-5 h-5"></i>
                    <span class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                </button> -->
                <button onclick="openStampModal()" id="btn-stamp" class="tool-btn p-2 rounded-lg hover:bg-white border border-transparent transition group relative flex-shrink-0" title="ประทับตรา">
    <i data-lucide="stamp" class="w-5 h-5"></i>
    <span class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
</button>

                <div class="w-px h-6 bg-gray-300 mx-1 flex-shrink-0"></div>

                <button onclick="undoLastAction()" class="p-2 rounded-lg hover:bg-white text-gray-500 hover:text-red-500 transition flex-shrink-0" title="ย้อนกลับ">
                    <i data-lucide="undo-2" class="w-5 h-5"></i>
                </button>
                  <div class="w-px h-6 bg-gray-300 mx-1 flex-shrink-0"></div>
                <!-- Action Buttons -->
                <div class="flex items-center gap-3 w-full xl:w-auto justify-end">

                  <!-- Download Button -->
                  <button onclick="downloadDocument()" class=" xl:flex-none bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-sm transition transform active:scale-95 font-semibold text-sm">
                      <i data-lucide="download" class="w-4 h-4"></i>

                  </button>

                    <!-- Save to Server Button -->
                    <button onclick="saveToServer()" class=" xl:flex-none bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-sm transition transform active:scale-95 font-semibold text-sm">
                        <i data-lucide="cloud-upload" class="w-4 h-4"></i>
                        <span>บันทึก</span>
                    </button>


                </div>
            </div>



        </div>

    </header>

    <!-- Document Container -->
    <main id="document-container" class="flex-1 overflow-y-auto bg-gray-100 p-4 md:p-8 flex flex-col items-center relative">
        <div id="pages-wrapper" class="flex flex-col gap-6 shadow-2xl"></div>

        <div id="empty-state" class="text-center mt-20 hidden">
            <i data-lucide="file-warning" class="w-16 h-16 mx-auto text-gray-400 mb-4"></i>
            <p class="text-gray-500 text-lg">ไม่พบเอกสาร</p>
            <button onclick="loadServerDocument()" class="mt-4 text-blue-600 underline">ลองใหม่อีกครั้ง</button>
        </div>


    </main>

    <!-- Notification Toast -->
    <div id="toast" class="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-gray-800/90 backdrop-blur text-white px-6 py-3 rounded-full shadow-2xl opacity-0 transition-all duration-300 pointer-events-none z-50 flex items-center gap-3 translate-y-4">
        <i id="toast-icon" data-lucide="check-circle" class="w-5 h-5 text-green-400"></i>
        <span id="toast-message" class="font-medium">แจ้งเตือน</span>
    </div>

    <div id="stamp-modal" class="fixed inset-0 bg-black/50 z-50 hidden flex items-center justify-center p-4 backdrop-blur-sm">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col">
            <div class="bg-blue-700 px-6 py-4 flex justify-between items-center">
                <h3 class="text-white font-bold text-lg">ระบุข้อมูลประทับตรา</h3>
                <button onclick="closeStampModal()" class="text-white hover:bg-blue-700 rounded-full p-1">
                    <i data-lucide="x" class="w-5 h-5"></i>
                </button>
            </div>

            <div class="p-6 space-y-4 overflow-y-auto min-h-0">
              <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">ฝ่ายงาน</label>
                  <select id="stamp-text-1" class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                      <option value="">-- เลือกฝ่ายงาน --</option>
                       <option value="โรงเรียนศรียานุสรณ์">โรงเรียนศรียานุสรณ์</option>
                       <option value="ฝ่ายงานผู้อำนวยการ">ฝ่ายงานผู้อำนวยการ</option>
                      <option value="กลุ่มบริหารทั่วไป">กลุ่มบริหารทั่วไป</option>
                      <option value="กลุ่มบริหารวิชาการ">กลุ่มบริหารวิชาการ</option>
                      <option value="กลุ่มบริหารงานบุคคล">กลุ่มบริหารงานบุคคล</option>
                      <option value="กลุ่มบริหารงบประมาณ">กลุ่มบริหารงบประมาณ</option>
                  </select>
              </div>
                <div id="stamp-receipt-fields" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">เลขรับ</label>
                    <input type="text" id="stamp-text-2" class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="เลขรับ...">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">วันที่</label>
                    <input type="text" id="stamp-text-3" class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="วันที่...">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">เวลา</label>
                    <input type="text" id="stamp-text-4" class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="เวลา...">
                </div>
                </div>
                <p id="stamp-director-hint" class="hidden text-sm text-gray-500">หลังประทับตรา ใช้เครื่องมือปากกาติ๊กฝ่ายงาน เติมข้อความอื่น ๆ และลงลายมือชื่อบนเอกสาร</p>

                <div class="border rounded-lg p-4 bg-gray-50 flex justify-center items-center h-45">
                    <canvas id="stamp-preview-canvas" height="100" class="max-w-full h-auto" aria-label="ตัวอย่างตราประทับ"></canvas>
                </div>
            </div>

            <div class="px-6 py-4 bg-gray-50 flex justify-end gap-3 border-t flex-shrink-0">
                <button onclick="closeStampModal()" class="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg font-medium transition">ยกเลิก</button>
                <button onclick="confirmStampData()" class="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg font-medium shadow-sm transition">ตกลง</button>
            </div>
        </div>
    </div>




    <script>


        window.addEventListener('pdfjsready', function () {
        // --- 1. CONFIGURATION ---
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

//
//"https://eoffice.siya.ac.th/file_request.php?File_Name="+Doc_Id+'.pdf',
const CONFIG = {
            PDF_URL_1: <?= $url_primary_json ?>,
            PDF_URL_2: <?= $url_secondary_json ?>,
            STAMP_URL: "e-stamp/"+Stamp_Name,
            SCALE: 2.5
        };

        const FALLBACK = {
            PDF: "JVBERi0xLjcKCjEgMCBvYmogPDwKICAvVHlwZSAvQ2F0YWxvZwogIC9QYWdlcyAyIDAgUgo+PgplbmRvYmoKCjIgMCBvYmogPDwKICAvVHlwZSAvUGFnZXMKICAvTWVkaWFCb3ggWyAwIDAgNTk1LjI4IDg0MS44OSBdCiAgL0NvdW50IDEKICAvS2lkcyBbIDMgMCBSIF0KPj4KZW5kb2JqCgozIDAgb2JqIDw8CiAgL1R5cGUgL1BhZ2UKICAvUGFyZW50IDIgMCBSCiAgL1Jlc291cmNlcyA8PAogICAgL0ZvbnQgPDwKICAgICAgL0YxIDQgMCBSCgogICAgPj4KICA+PgogIC9Db250ZW50cyA1IDAgUgo+PgplbmRvYmoKCjQgMCBvYmogPDwKICAvVHlwZSAvRm9udAogIC9TdWJ0eXBlIC9UeXBlMQogIC9CYXNlRm9udCAvSGVsdmV0aWNhCj4+CmVuZG9iagoKNSAwIG9iaiA8PAogIC9MZW5ndGggMTIyCj4+CnN0cmVhbQpCVAo3MCA3MDAgVEQKL0YxIDI0IFRmCihTSVlBIEUtT0ZGSUNFIERFTU8pIFRqCkVUCkJUCjcwIDY1MCBURAovRjEgMTIgVGYKKFRoaXMgaXMgYSBmYWxsYmFjayBkb2N1bWVudCBiZWNhdXNlIHRoZSByZWFsIFVSTCB3YXMgYmxvY2tlZCBieSBDT1JTLikgVGoKRVQKRVQKZW5kc3RyZWFtCmVuZG9iagoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNjAgMDAwMDAgbiAKMDAwMDAwMDE1NyAwMDAwMCBuIAowMDAwMDAwMjY0IDAwMDAwIG4gCjAwMDAwMDAzNTIgMDAwMDAgbiAKdHJhaWxlcgo8PAogIC9TaXplIDYKICAvUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKNTI0CiUlRU9GCg==",
            STAMP: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAAAyCAYAAACg344VAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH3wQeFxo5K9n/2QAAA+NJREFUeNrtnE1oXFUYht9z78xM/kyaTOoP0tQ0aSL+oK2iC10IuCi40I2Ldhe6sLgQdFGlWxfuWnCnbiqILgRBECy1Wq1Z2qSNTOpMZu6953ycycx0MpnJ3Jm5c+F5N5N7z/2+8533fOf7zsB99913X/iJ3W53VCl1Sim1Ryn1gVJqUin1rlLqVa31mNb6jNb6jNb6ba31R61W6/j+/fuf63G3U1NTY1tbWx9pre9RSu0F7QE/aK1/1Fqf01qPzM/Pn6/HPe8FDFaD2O12R5VSp5RSe2p4zT/AH1rrl+bn58/V8N5/BIPVINxut0cptafG1/4F/Ky1fkApdbJO97xnMFgNYHZ29l6l1Kka3u8PpNbf01q/12w2f6zhvf8Ig9UguN1uj1JqT42v/UZr/YpS6kyNB/1vYLAawOzs7L1KqVM1vt/P2uvvNpvNH2p477YwWNvEbrc7qrXeV+Pr39Zan2y1Wot1uudhMFgN4PmpqanHa3y/n7XW3zWbzZ9qeO+2MFjbxPPT09OP1fj6P2qtv6jDPQ+DwWqA52dmZh6q8f1+01p/Xod73gsYrG1ienr6PqXUnoa/9s/a609rrc9W/a6FhYUvGngtg9UAMzMzD2utR2p8v0Va6w9ardbpGt67LQzWNjE9Pf2wUupwja//u9b6ZLPZ/K0O9zwMBqsBZmZmnqjx/X7VWn9ah3veCxisa2B6evqRGt/vt9rrU81m8/s63POuwWBdAzMzM0/W+Pr/aK1P1uGe9wIG6xqYnp5+Qik1VuP7/aa1/qwO97wXMFjXwMzMzJM1vv4/WuuTdbjnvYDBugamp6efVEqN1/h+i7TWn9XhnvcCBuuamJmZebLG1/9Ha32yDve8FzBY18D09PTTSqnxGt/vN631Z3W4572AwboGZmZmnqzx9f/RWp+swz3vBQzWNTI9Pf2MUmqsxvd7Q2v9aR3ueS9gsK6RmZmZp2p8/X+01ifrcM97AYN1jUxPTz+rlBqt8f3e0Fp/Wod73gsYrGtEx/hUja//r9b6ZLPZ/LEO97xrMFjXyPT09HNKy/wNrfWnNbzru4bBukZ0jM/U+Pp/a61P1uGe9wIG6xqZnp5+Tim1p8b3e0Nr/Wkd7nkvYLCukemZ5x6t8fX/0VqfbDab39fhnncNQ1M/f7fbfVFr/ZTW+rGduKdW6mWt9Yv5+fnjdbhfL9xr/7jWeqDita5qrT9vtVrf7d+//6uK19oJNPUDut3ui1rrwzt5r9b6i/n5+W938r6Vwn/1D2utBytea1Fr/XSr1fpuL4PVYNWfVkrtq3itP7XWc81m87uK19oJGKxtYrdb/1BrPVjxWn/VWs81GaxmYrAawH/1D2utX6x4rb9rrb9tNpvfVrzWTsBgbQO73fp7WutXKl7rH631t81m85uK19oWDFYDuN3un7TWL1W81j9a6++azeY3Fa+1E2jqiv1///1fAvhNCPGrEOJZIcSzQogRQohJQogJQohJQog9O3GvbeB+IcT3QogfAPwghHhWCPGjEGKPEOIxIcRjQojHhBCP7eSeO4Gm/sDMzMwRrfVbWuvDWusDWutxrfXDWusHlH/RLfKA1vpRrfV3WusvtdbTWutvK37XtjEzM3Ow1vrQbrf+4Ha79Qe3260/uN1u/cG+Wut9Nbzvf0YikUgkEolEIpFIJBKJRCKRSCQSiUQikUgk/wF+wW33fR4+ogAAAABJRU5ErkJggg=="
        };

        let currentPDF = null;
        let sourceBytes = null;
        let documentRevision = null;
        let scale = CONFIG.SCALE;
        let currentTool = 'hand';
        let isDrawing = false;
        let lastX = 0;
        let lastY = 0;
        let documentHistory = {};

        // --- 2. INITIALIZATION ---

        window.onload = function() {
            lucide.createIcons();
            loadServerDocument(); // Auto start (Requested #2)
        };

        // --- 3. LOADING LOGIC ---

        // ฟังก์ชันสำหรับดึงไฟล์ (แยกออกมาเพื่อให้เรียกซ้ำได้ง่าย)
                async function fetchPDF(url) {
                    const response = await fetch(url, {
                        method: 'GET',
                        credentials: 'include'
                    });
                    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
                   
                    documentRevision = response.headers.get('X-Document-Revision');
                    const blob = await response.blob();
                    const arrayBuffer = await blob.arrayBuffer();
                    return new Uint8Array(arrayBuffer);
                }

                async function loadServerDocument() {
                    showLoading(true, "กำลังดึงไฟล์จาก Server หลัก...");

                    try {
                        // --- 1. ลอง URL หลัก ---
                        const data = await fetchPDF(CONFIG.PDF_URL_1);
                        await renderPDF(data);
                        showToast("โหลดจาก Server หลักสำเร็จ", "success");

                    } catch (error1) {
                        console.warn("URL 1 Failed:", error1);
                       
                        // ถ้า URL 1 พลาด ให้ลอง URL 2
                        showLoading(true, "Server หลักขัดข้อง กำลังลอง Server สำรอง...");
                       
                        try {
                            // --- 2. ลอง URL ที่ 2 ---
                            const data = await fetchPDF(CONFIG.PDF_URL_2);
                            await renderPDF(data);
                            showToast("โหลดจาก Server สำรองสำเร็จ", "success");

                        } catch (error2) {
                            console.warn("URL 2 Failed:", error2);

                            // --- 3. ถ้าพลาดทั้งคู่ ใช้ไฟล์ Base64 (FALLBACK) ---
                            showToast("ไม่สามารถเชื่อมต่อ Server ได้ ใช้ไฟล์ตัวอย่างแทน", "warning");
                            loadPDFFromBase64(FALLBACK.PDF);
                        }
                    } finally {
                        showLoading(false);
                    }
                }

        async function loadPDFFromBase64(base64) {
            currentPDF = null;
            showToast('โหลดเอกสารจริงไม่สำเร็จ ไม่สามารถลงนามได้', 'error');
            document.getElementById('empty-state').classList.remove('hidden');
            return;
            const binaryString = window.atob(base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            await renderPDF(bytes);
        }

        async function renderPDF(data) {
            const container = document.getElementById('pages-wrapper');
            container.innerHTML = '';
            documentHistory = {};

            try {
                sourceBytes = data.slice();
                currentPDF = await pdfjsLib.getDocument({data: data.slice(), isEvalSupported: false}).promise;
                for (let pageNum = 1; pageNum <= currentPDF.numPages; pageNum++) {
                    await renderPage(pageNum, container);
                }
                setTool('hand');
            } catch (error) {
                console.error("PDF Render Error:", error);
                currentPDF = null;
                document.getElementById('empty-state').classList.remove('hidden');
                throw error;
            }
        }

        async function renderPage(pageNum, container) {
            const page = await currentPDF.getPage(pageNum);
            const viewport = page.getViewport({ scale: scale });

            // Calculate display dimensions based on scale
            // If scale is high (e.g. 3.0), we want to display it at a reasonable size but keep the canvas resolution high.
            // We use CSS to scale it down visually.
            const displayScale = 1; // Visual scale (how big it looks)
            const displayWidth = (viewport.width / scale) * displayScale;
            const displayHeight = (viewport.height / scale) * displayScale;

            // Or simpler approach: Use the viewport size directly for canvas size,
            // but let CSS handle responsive width (max-w-full).

            const wrapper = document.createElement('div');
            wrapper.className = 'page-container bg-white';
            // Explicitly setting width/height helps prevent layout shifts,
            // but for responsive scale-down we rely on max-w-full in CSS
            wrapper.style.maxWidth = `${viewport.width}px`;

            const pdfCanvas = document.createElement('canvas');
            pdfCanvas.className = 'pdf-canvas';
            pdfCanvas.id = `pdf-render-${pageNum}`;
            pdfCanvas.height = viewport.height;
            pdfCanvas.width = viewport.width;

            const drawCanvas = document.createElement('canvas');
            drawCanvas.className = 'drawing-canvas';
            drawCanvas.id = `draw-layer-${pageNum}`;
            drawCanvas.height = viewport.height;
            drawCanvas.width = viewport.width;
            drawCanvas.setAttribute('data-page', pageNum);

            wrapper.appendChild(pdfCanvas);
            wrapper.appendChild(drawCanvas);
            container.appendChild(wrapper);

            const renderContext = {
                canvasContext: pdfCanvas.getContext('2d'),
                viewport: viewport
            };
            await page.render(renderContext).promise;

            setupDrawingEvents(drawCanvas, pageNum);
        }

        // --- 4. TOOL LOGIC ---

        function setTool(toolName) {
            currentTool = toolName;

            document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
            document.getElementById(`btn-${toolName}`).classList.add('active');

            const canvases = document.querySelectorAll('.drawing-canvas');
            canvases.forEach(canvas => {
                canvas.style.pointerEvents = (toolName === 'hand') ? 'none' : 'auto';

                if (toolName === 'stamp') {
                    canvas.style.cursor = 'copy';
                } else if (toolName === 'eraser') {
                    canvas.style.cursor = 'cell';
                } else if (toolName === 'pen') {
                    canvas.style.cursor = 'crosshair';
                } else {
                    canvas.style.cursor = 'default';
                }
            });
        }

        function setupDrawingEvents(canvas, pageNum) {
            const ctx = canvas.getContext('2d');
            let points = [];

            const getPos = (e) => {
                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                // Support both Touch and Mouse
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                return {
                    x: (clientX - rect.left) * scaleX,
                    y: (clientY - rect.top) * scaleY
                };
            };

            const startDraw = (e) => {
                if (currentTool === 'hand') return;

                const { x, y } = getPos(e);

                // --- STAMP LOGIC (Requested #3) ---
                if (currentTool === 'stamp') {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.src = CONFIG.STAMP_URL;

                    const drawStamp = (imageSrc) => {
                        const stampToDraw = new Image();
                        stampToDraw.crossOrigin = "Anonymous"; // Ensure crossOrigin is set for the draw instance too
                        stampToDraw.src = imageSrc;

                        stampToDraw.onload = () => {
                            // --- AUTO SIZE LOGIC (แก้ไขตรงนี้) ---
                            // 1. กำหนดความกว้างฐานที่ต้องการ (เช่น 120px) แล้วคูณด้วย scale ของ PDF เพื่อให้คมชัด
                            const baseWidth = 270;
                            const scaleFactor = scale / 1.5;

                            // 2. หาขนาดจริงของรูปภาพ
                            const natW = stampToDraw.naturalWidth || 100;
                            const natH = stampToDraw.naturalHeight || 50;

                            // 3. คำนวณ Aspect Ratio (สูง / กว้าง)
                            const aspectRatio = natH / natW;

                            // 4. คำนวณขนาดที่จะวาด (กว้างตามที่ตั้ง, สูงปล่อยไหลตามสัดส่วน)
                            const stampW = baseWidth * scaleFactor;
                            const stampH = stampW * aspectRatio; // Auto Height

                            // 5. หาจุดกึ่งกลาง
                            const drawX = x - (stampW / 2);
                            const drawY = y - (stampH / 2);

                            ctx.globalCompositeOperation = 'source-over';
                            ctx.drawImage(stampToDraw, drawX, drawY, stampW, stampH);

                            if (!documentHistory[pageNum]) documentHistory[pageNum] = [];
                            documentHistory[pageNum].push({
                                tool: 'stamp',
                                x: drawX, y: drawY, w: stampW, h: stampH,
                                src: imageSrc
                            });
                        }
                    };

                    img.onload = () => drawStamp(CONFIG.STAMP_URL);
                    img.onerror = () => {
                        console.warn("Stamp CORS error, using fallback.");
                        drawStamp(FALLBACK.STAMP);
                    };
                    return;
                }

                isDrawing = true;
                lastX = x;
                lastY = y;
                points = [{ x, y }];

                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                // Adjust Pen/Eraser width based on Scale
                if (currentTool === 'eraser') {
                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.lineWidth = 20 * (scale / 1.5);
                } else {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.lineWidth = 2 * (scale / 1.5);
                    ctx.strokeStyle = '#000000'; // Black Pen
                }
            };

            const draw = (e) => {
                if (!isDrawing || currentTool === 'hand' || currentTool === 'stamp') return;
                if (e.cancelable) e.preventDefault();

                const { x, y } = getPos(e);

                ctx.quadraticCurveTo(lastX, lastY, (lastX + x) / 2, (lastY + y) / 2);
                ctx.stroke();

                points.push({ x, y });
                lastX = x;
                lastY = y;
            };

            const stopDraw = () => {
                if (!isDrawing) return;
                isDrawing = false;
                ctx.closePath();

                if (!documentHistory[pageNum]) documentHistory[pageNum] = [];
                documentHistory[pageNum].push({
                    tool: currentTool,
                    points: [...points],
                    color: '#000000',
                    width: currentTool === 'eraser' ? (20 * (scale / 1.5)) : (2 * (scale / 1.5))
                });
            };

            canvas.addEventListener('mousedown', startDraw);
            canvas.addEventListener('mousemove', draw);
            canvas.addEventListener('mouseup', stopDraw);
            canvas.addEventListener('mouseout', stopDraw);

            canvas.addEventListener('touchstart', startDraw, { passive: false });
            canvas.addEventListener('touchmove', draw, { passive: false });
            canvas.addEventListener('touchend', stopDraw);
        }

        function undoLastAction() {
            // Find last active page
            let lastPageNum = -1;
            const pages = Object.keys(documentHistory);

            // Simple approach: check all pages for history
            for (let i = pages.length - 1; i >= 0; i--) {
                const p = pages[i];
                if (documentHistory[p] && documentHistory[p].length > 0) {
                    lastPageNum = p;
                    break;
                }
            }

            if (lastPageNum !== -1) {
                documentHistory[lastPageNum].pop();
                redrawCanvas(lastPageNum);
                showToast("ย้อนกลับการกระทำล่าสุด", "info");
            } else {
                showToast("ไม่มีการกระทำที่สามารถย้อนกลับได้", "info");
            }
        }

        function redrawCanvas(pageNum) {
            const canvas = document.getElementById(`draw-layer-${pageNum}`);
            const ctx = canvas.getContext('2d');
            const actions = documentHistory[pageNum] || [];

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            actions.forEach(action => {
                if (action.tool === 'stamp') {
                    const img = new Image();
                    img.src = action.src;
                    ctx.globalCompositeOperation = 'source-over';
                    // Draw immediately if cached, otherwise wait (rare in redraw)
                    ctx.drawImage(img, action.x, action.y, action.w, action.h);
                } else {
                    ctx.beginPath();
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.lineWidth = action.width;

                    if (action.tool === 'eraser') {
                        ctx.globalCompositeOperation = 'destination-out';
                    } else {
                        ctx.globalCompositeOperation = 'source-over';
                        ctx.strokeStyle = action.color;
                    }

                    if (action.points.length > 0) {
                        ctx.moveTo(action.points[0].x, action.points[0].y);
                        let pLastX = action.points[0].x;
                        let pLastY = action.points[0].y;
                        for (let i = 1; i < action.points.length; i++) {
                            const p = action.points[i];
                            ctx.quadraticCurveTo(pLastX, pLastY, (pLastX + p.x) / 2, (pLastY + p.y) / 2);
                            pLastX = p.x;
                            pLastY = p.y;
                        }
                        ctx.stroke();
                    }
                    ctx.closePath();
                }
            });
            ctx.globalCompositeOperation = 'source-over';
        }

        // --- 5. SAVE & DOWNLOAD ---

        function getCookie(name) {
            const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.\\+*?\[\^\]$(){}=!<>|:\-]/g, '\\$&') + '=([^;]*)'));
            return match ? decodeURIComponent(match[1]) : '';
        }

        // UPDATE: Function to Save to Server (Real Implementation Logic Added)
        async function saveToServer() {
            if (!currentPDF) return;
            showLoading(true, "กำลังส่งข้อมูลไปยัง Server...");

            try {


                // 1. สร้างไฟล์ PDF (Blob)
                const blob = await generatePDFBlob();
                var year = <?= $year_json ?>;
                // 2. เตรียมข้อมูลสำหรับส่ง (FormData)
                const formData = new FormData();
                formData.append('file', blob, <?= $file_basename_json ?>); // ชื่อไฟล์
                formData.append('user_id', 'USER_123');
                formData.append('year', year);
                formData.append('Doc_Id', <?= $doc_id_int ?>);
                formData.append('revision', documentRevision || '');

                // --- ส่วนการส่งไฟล์จริง (Real Upload) ---
                // วิธีใช้: แก้ไข URL ด้านล่างให้เป็น API ของคุณ
                const SERVER_URL = "upload_pdf.php"; // ตัวอย่าง: "https://eoffice.siya.ac.th/upload_pdf.php"

                if (SERVER_URL) {
                    const response = await fetch(SERVER_URL, {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + (getCookie('User_Token') || '') },
                        body: formData
                    });

                    if (response.ok) {
                        const result = await response.json(); // อ่านค่าตอบกลับจาก Server
                        if (result.status !== 'success') throw new Error(result.message);
                        documentRevision = result.revision;
                        console.log("Server response:", result);
                        showToast("บันทึกข้อมูลเรียบร้อย!", "success");
                    } else {
                        throw new Error("Server Error: " + response.status);
                    }
                } else {
                    // --- จำลองการทำงาน (Simulation) เมื่อยังไม่มี URL ---
                    await new Promise(r => setTimeout(r, 1500)); // รอ 1.5 วินาที
                    console.log("Simulated Upload Success. Blob size:", blob.size);
                    console.log("FormData ready to send:", formData);
                    showToast("บันทึก (จำลอง) เรียบร้อย! (กรุณาใส่ URL จริงในโค้ด)", "success");
                }

            } catch (err) {
                console.error(err);
                showToast("การเชื่อมต่อ Server ล้มเหลว", "error");
            } finally {
                showLoading(false);
            }
        }

        async function downloadDocument() {
                    if (!currentPDF) return;
                    showLoading(true, "กำลังประมวลผล PDF...");

                    setTimeout(async () => {
                        try {
                            const blob = await generatePDFBlob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a'); a.href = url; a.download = 'signed_document_siya.pdf'; a.click();
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                        } catch (err) { showToast('สร้าง PDF ไม่สำเร็จ', 'error'); }
                        finally { showLoading(false); }
                    }, 100);
                }

        // Helper to merge layers for a specific page
        async function getMergedCanvas(pageNum) {
            const pdfCanvas = document.getElementById(`pdf-render-${pageNum}`);
            const drawCanvas = document.getElementById(`draw-layer-${pageNum}`);

            if (!pdfCanvas || !drawCanvas) return null;

            const mergedCanvas = document.createElement('canvas');
            mergedCanvas.width = pdfCanvas.width;
            mergedCanvas.height = pdfCanvas.height;
            const mergedCtx = mergedCanvas.getContext('2d');

            mergedCtx.drawImage(pdfCanvas, 0, 0);
            mergedCtx.drawImage(drawCanvas, 0, 0);

            return {
                imgData: mergedCanvas.toDataURL('image/jpeg', 1.0), // High quality JPEG
                width: mergedCanvas.width,
                height: mergedCanvas.height
            };
        }

        // Helper to generate Blob (for Upload)
        // Helper to generate Blob (for Upload)
                async function generatePDFBlob() {
                    const pdf = await PDFLib.PDFDocument.load(sourceBytes);
                    const pages = pdf.getPages();
                    for (let i = 0; i < pages.length; i++) {
                        const layer = document.getElementById(`draw-layer-${i + 1}`);
                        if (!layer) throw new Error('Incomplete PDF rendering');
                        const overlay = await pdf.embedPng(layer.toDataURL('image/png'));
                        const {width, height} = pages[i].getSize();
                        const rotation = pages[i].getRotation().angle;
                        const rotated = rotation === 90 || rotation === 270;
                        pages[i].drawImage(overlay, {
                            x: rotation === 90 || rotation === 180 ? width : 0,
                            y: rotation === 180 || rotation === 270 ? height : 0,
                            width: rotated ? height : width, height: rotated ? width : height,
                            rotate: PDFLib.degrees(rotation)
                        });
                    }
                    return new Blob([await pdf.save()], {type:'application/pdf'});
                }

        // --- 6. UTILS ---

        function showLoading(show, text) {
            const el = document.getElementById('loading');
            if(text) document.getElementById('loading-text').innerText = text;
            if (show) el.classList.remove('hidden');
            else el.classList.add('hidden');
        }

        function showToast(message, type = 'info') {
            const toast = document.getElementById('toast');
            const icon = document.getElementById('toast-icon');
            const msg = document.getElementById('toast-message');

            msg.innerText = message;

            // Icon Logic
            if(type === 'success') {
                icon.innerHTML = '<circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path>';
                icon.classList.value = "w-5 h-5 text-green-400";
            } else if (type === 'error') {
                icon.innerHTML = '<circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line>';
                icon.classList.value = "w-5 h-5 text-red-400";
            } else {
                icon.innerHTML = '<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>';
                icon.classList.value = "w-5 h-5 text-blue-400";
            }

            toast.classList.remove('opacity-0', 'translate-y-4');
            toast.classList.add('opacity-100', 'translate-y-0');

            setTimeout(() => {
                toast.classList.remove('opacity-100', 'translate-y-0');
                toast.classList.add('opacity-0', 'translate-y-4');
            }, 3000);
        }

        // --- 7. STAMP MODAL LOGIC ---

            let currentStampDataUrl = null; // ตัวแปรเก็บรูปแสตมป์ที่สร้างเสร็จแล้ว

            function openStampModal() {
                // เปิด Modal
                document.getElementById('stamp-modal').classList.remove('hidden');
                // รีเซ็ตค่า (ถ้าต้องการ) หรือคงค่าเดิมไว้
                // document.getElementById('stamp-text-1').value = '';
                generateStampPreview(); // สร้างพรีวิวเบื้องต้น
                document.fonts.load('22px "Sarabun"').then(() => {
                    if (!document.getElementById('stamp-modal').classList.contains('hidden')) {
                        generateStampPreview();
                    }
                });
            }

            function closeStampModal() {
                document.getElementById('stamp-modal').classList.add('hidden');
            }

            function generateDirectorStampPreview(canvas) {
                canvas.width = 460;
                canvas.height = 470;
                const ctx = canvas.getContext('2d');
                ctx.strokeStyle = '#1e40af';
                ctx.fillStyle = '#1e40af';
                ctx.lineWidth = 3;
                ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
                ctx.font = '24px "Sarabun", sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('เรียน', 30, 55);
                ctx.fillText('ผู้อำนวยการโปรดทราบ', 120, 55);
                ctx.fillText('และแจ้งกลุ่มดำเนินการ', 120, 95);

                const departments = ['บริหารวิชาการ', 'บริหารงบประมาณ', 'บริหารงานบุคคล', 'บริหารทั่วไป', 'อื่น ๆ'];
                const drawDottedLine = (x, y, endX) => {
                    ctx.save();
                    ctx.lineWidth = 2;
                    ctx.setLineDash([1, 7]);
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(endX, y);
                    ctx.stroke();
                    ctx.restore();
                };

                departments.forEach((department, index) => {
                    const y = 155 + index * 52;
                    ctx.lineWidth = 2;
                    ctx.strokeRect(48, y - 25, 30, 30);
                    ctx.fillText(department, 108, y);
                    if (index === departments.length - 1) {
                        drawDottedLine(108 + ctx.measureText(department).width + 8, y + 5, 420);
                    }
                });
                ctx.fillText('ลงชื่อ', 30, 433);
                drawDottedLine(30 + ctx.measureText('ลงชื่อ').width + 10, 438, 420);
            }

            // สลับรูปแบบตราตามฝ่ายงาน และสร้างพรีวิวแบบเรียลไทม์
            function generateStampPreview() {
    const isDirectorStamp = document.getElementById('stamp-text-1').value === 'ฝ่ายงานผู้อำนวยการ';
    document.getElementById('stamp-receipt-fields').classList.toggle('hidden', isDirectorStamp);
    document.getElementById('stamp-director-hint').classList.toggle('hidden', !isDirectorStamp);
    if (isDirectorStamp) {
        generateDirectorStampPreview(document.getElementById('stamp-preview-canvas'));
        return;
    }
    // 1. ดึงค่าจาก Input
    const label1 = ""; // บรรทัดแรกถ้าเป็นฝ่ายงาน อาจจะไม่ต้องมีหัวข้อ
    const val1 = document.getElementById('stamp-text-1').value || 'ฝ่ายงาน..........................';

    const label2 = "เลขรับ ";
    const val2 = document.getElementById('stamp-text-2').value || "";

    const label3 = "วันที่ ";
    const val3 = document.getElementById('stamp-text-3').value || "";

    const label4 = "เวลา ";
    const val4 = document.getElementById('stamp-text-4').value || "";

    const canvas = document.getElementById('stamp-preview-canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = 400;  // ขยายความกว้างให้พอสำหรับตราประทับ
    canvas.height = 200; // ขยายความสูงสำหรับ 4 บรรทัด + ระยะห่าง

    // ล้าง Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ตั้งค่าสไตล์
    const stampColor = '#1e40af'; // สีน้ำเงินตราประทับ
    ctx.strokeStyle = stampColor;
    ctx.fillStyle = stampColor;
    const fontFamily = '"Sarabun", sans-serif';

    // 2. วาดกรอบนอก
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

    // ฟังก์ชันช่วยวาดบรรทัดที่มีการเติมคำในช่องว่าง
    const drawStampLine = (label, value, y) => {
            const startX = 30;
            const endX = canvas.width - 30;

            // --- 1. วาดหัวข้อ (ใช้สีน้ำเงิน) ---
            ctx.textAlign = 'left';
            ctx.fillStyle = '#1e40af'; // สีน้ำเงินตราประทับ
            ctx.font = '20px ' + fontFamily;
            ctx.fillText(label, startX, y);

            const labelWidth = ctx.measureText(label).width;
            const lineStartX = startX + labelWidth + 5;

            // --- 2. วาดเส้นใต้ (ใช้สีน้ำเงิน) ---
            ctx.beginPath();
            ctx.strokeStyle = '#1e40af';
            ctx.lineWidth = 1.5;
            ctx.moveTo(lineStartX, y + 5);
            ctx.lineTo(endX, y + 5);
            ctx.stroke();

            // --- 3. วาดข้อมูลที่รับเข้ามา (เปลี่ยนเป็นสีดำ) ---
            if (value) {
                ctx.textAlign = 'center';
                ctx.fillStyle = '#000000'; // <--- เปลี่ยนเป็นสีดำตรงนี้
                ctx.font = '22px ' + fontFamily;
                const middleOfLine = lineStartX + ((endX - lineStartX) / 2);
                ctx.fillText(value, middleOfLine, y);

                // เปลี่ยนสีกลับเป็นน้ำเงินเผื่อบรรทัดถัดไป
                ctx.fillStyle = '#1e40af';
            }
        };

    // 3. วาดทั้ง 4 บรรทัด
    // บรรทัดที่ 1: กรณีฝ่ายงาน (อาจจะวาดตรงกลางบรรทัดเดียว)
    ctx.textAlign = 'center';
    ctx.font = '22px ' + fontFamily;
    ctx.fillText(val1, canvas.width / 2, 45);

    // บรรทัดที่ 2, 3, 4: ใช้ฟังก์ชันวาดเส้น
    drawStampLine(label2, val2, 80);
    drawStampLine(label3, val3, 115);
    drawStampLine(label4, val4, 150);
}


            // เมื่อกดปุ่ม "ตกลง" ใน Modal
            function confirmStampData() {
                generateStampPreview();
                const canvas = document.getElementById('stamp-preview-canvas');
                // แปลง Canvas เป็นรูปภาพ Base64
                currentStampDataUrl = canvas.toDataURL('image/png');

                // เปลี่ยน URL ของแสตมป์ใน CONFIG ให้เป็นรูปที่เราเพิ่งสร้าง
                CONFIG.STAMP_URL = currentStampDataUrl;

                // ปิด Modal และเลือกเครื่องมือ Stamp
                closeStampModal();
                setTool('stamp');
                showToast('เลือกจุดที่ต้องการประทับตรา', 'info');
            }

            // เพิ่ม Event Listener ให้ Input เพื่อดู Preview แบบ Realtime
            document.getElementById('stamp-text-1').addEventListener('input', generateStampPreview);
            document.getElementById('stamp-text-2').addEventListener('input', generateStampPreview);
            document.getElementById('stamp-text-3').addEventListener('input', generateStampPreview);
            document.getElementById('stamp-text-4').addEventListener('input', generateStampPreview);
            Object.assign(window, {setTool, openStampModal, closeStampModal, confirmStampData, undoLastAction, saveToServer, downloadDocument, loadServerDocument});
        });
    </script>

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
