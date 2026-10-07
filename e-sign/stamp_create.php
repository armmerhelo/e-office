<?php
// รับค่าจาก URL หรือกำหนดค่าเริ่มต้น
if (isset($_GET["Name_Department"])) {
    $Name_Department = $_GET["Name_Department"];
} else {
    $Name_Department = 'ทดสอบระบบ'; // ค่า Default
}
?>
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>สร้างรูปภาพจากเทมเพลต</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        /* Import Font Sarabun */
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');

        body {
            background-color: #f0f2f5;
            font-family: 'Sarabun', sans-serif;
        }
        canvas {
            display: block;
            max-width: 100%;
            height: auto;
            border-radius: 0.75rem;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .loader {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #3498db;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            display: none;
            margin-left: 0.5rem;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body class="flex flex-col items-center justify-center min-h-screen p-4">
    <div class="bg-white p-8 rounded-2xl shadow-xl max-w-lg w-full flex flex-col items-center space-y-6">

        <input type="url" id="templateImage" value="e-stamp/template_stamp.png" hidden>

        <textarea id="overlayText" hidden></textarea>

        <canvas id="imageCanvas" width="600" height="400" class="mb-6"></canvas>

        <div class="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4 w-full justify-center">
            <button id="generateBtn" class="bg-blue-600 text-white px-4 py-2 rounded hidden">
                <span>สร้างรูปภาพใหม่</span>
            </button>
            <div id="loader" class="loader"></div>
        </div>

        <button id="downloadBtn" class="bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105" hidden>
            บันทึกรูปภาพ
        </button>

        <div id="messageBox" class="hidden bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative w-full mt-4" role="alert">
            <strong class="font-bold" id="messageTitle">แจ้งเตือน!</strong>
            <span class="block sm:inline" id="messageText"></span>
        </div>
    </div>

    <script>
        // --- 1. การตั้งค่าตัวแปรจาก PHP สู่ JS ---
        // ใช้ json_encode เพื่อความปลอดภัยของข้อมูล
        const phpDepartmentName = <?php echo json_encode($Name_Department); ?>;

        // ข้อมูลอื่นๆ (จำลอง)
        const docNumber = "1905";
        const docDate = "16 มิ.ย. 2568";
        const docTime = "16.05 น.";

        // --- 2. ตัวแปร Canvas และ Elements ---
        const canvas = document.getElementById('imageCanvas');
        const ctx = canvas.getContext('2d');
        const templateImageInput = document.getElementById('templateImage');
        const overlayTextInput = document.getElementById('overlayText');
        const generateBtn = document.getElementById('generateBtn');
        const downloadBtn = document.getElementById('downloadBtn');
        const loader = document.getElementById('loader');
        const messageBox = document.getElementById('messageBox');
        const messageText = document.getElementById('messageText');

        let templateImg = new Image();

        // --- 3. ฟังก์ชันจัดการข้อความ (Message UI) ---
        function showMessage(msg, type = 'error') {
            messageText.textContent = msg;
            messageBox.classList.remove('hidden', 'bg-red-100', 'border-red-400', 'text-red-700', 'bg-green-100', 'border-green-400', 'text-green-700');

            if (type === 'error') {
                messageBox.classList.add('bg-red-100', 'border-red-400', 'text-red-700');
                document.getElementById('messageTitle').innerText = "ข้อผิดพลาด!";
            } else {
                messageBox.classList.add('bg-green-100', 'border-green-400', 'text-green-700');
                document.getElementById('messageTitle').innerText = "สำเร็จ!";
            }
        }

        // --- 4. ฟังก์ชันแยกส่วนข้อความและขีดเส้นใต้ (Parse Logic) ---
        function parseLineSegments(lineText, context) {
            const segments = [];
            const regex = /<u>(.*?)<\/u>|([^<]+)/g;
            let match;

            while ((match = regex.exec(lineText)) !== null) {
                if (match[1] !== undefined) {
                    segments.push({ text: match[1], isUnderlined: true });
                } else if (match[2] !== undefined) {
                    segments.push({ text: match[2], isUnderlined: false });
                }
            }

            // คำนวณความกว้าง
            for (const segment of segments) {
                segment.width = context.measureText(segment.text).width;
            }
            return segments;
        }

        // --- 5. ฟังก์ชันหลัก: วาดรูปและข้อความ ---
        async function drawImageAndText() {
            messageBox.classList.add('hidden');
            loader.style.display = 'inline-block';

            try {
                const imageUrl = templateImageInput.value;
                templateImg.src = imageUrl;

                // รอให้โหลดรูปเสร็จ
                await new Promise((resolve, reject) => {
                    templateImg.onload = resolve;
                    templateImg.onerror = () => reject(new Error("ไม่สามารถโหลดรูปภาพเทมเพลตได้"));
                });

                // ตั้งค่าขนาด Canvas ตามรูป
                canvas.width = templateImg.naturalWidth || 600;
                canvas.height = templateImg.naturalHeight || 400;

                // วาดรูปพื้นหลัง
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(templateImg, 0, 0, canvas.width, canvas.height);

                // ตั้งค่า Font
                const fontSize = 55;
                ctx.font = `normal 400 ${fontSize}px Sarabun, sans-serif`;
                ctx.fillStyle = '#000000';
                ctx.textBaseline = 'middle';

                const text = overlayTextInput.value;
                if (text) {
                    const rawLines = text.split('\n');
                    const lineHeightMultiplier = 2.1;

                    // คำนวณความสูงรวมเพื่อจัดกึ่งกลางแนวตั้ง
                    let totalBlockHeight = rawLines.length * fontSize * lineHeightMultiplier;
                    let currentY = (canvas.height / 2) - (totalBlockHeight / 2) + (fontSize * 0.5);

                    for (const line of rawLines) {
                        const segments = parseLineSegments(line, ctx);
                        let totalLineWidth = segments.reduce((sum, seg) => sum + seg.width, 0);
                        let currentX = (canvas.width / 2) - (totalLineWidth / 2); // กึ่งกลางแนวนอน

                        for (const seg of segments) {
                            ctx.fillText(seg.text, currentX, currentY);

                            if (seg.isUnderlined) {
                                ctx.beginPath();
                                ctx.strokeStyle = '#000000';
                                ctx.lineWidth = 2;
                                // วาดเส้นใต้
                                ctx.moveTo(currentX, currentY + fontSize/2 + 5);
                                ctx.lineTo(currentX + seg.width, currentY + fontSize/2 + 5);
                                ctx.stroke();
                            }
                            currentX += seg.width;
                        }
                        currentY += fontSize * lineHeightMultiplier;
                    }
                }

                console.log("วาดรูปเสร็จสิ้น");

                // *** Auto Save หลังจากวาดเสร็จ 1 วินาที ***
                setTimeout(saveImageToServer, 1000);

            } catch (error) {
                console.error(error);
                showMessage(error.message);
            } finally {
                loader.style.display = 'none';
            }
        }

        // --- 6. ฟังก์ชันบันทึกรูปไปยัง Server ---
        async function saveImageToServer() {
            downloadBtn.disabled = true;
            downloadBtn.textContent = 'กำลังบันทึก...';
            downloadBtn.hidden = false;

            try {
                const dataURL = canvas.toDataURL('image/png');
                const base64Data = dataURL.split(',')[1];

                const response = await fetch('save_template.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        image_data: base64Data,
                        // ส่งชื่อไฟล์ที่ถูกต้องไป (ใช้ตัวแปร JS ที่รับมาจาก PHP)
                        file_name: phpDepartmentName + '.png'
                    })
                });

                const result = await response.json();
                if (result.success) {
                    showMessage(`บันทึกสำเร็จ: ${result.message || phpDepartmentName + '.png'}`, 'success');
                } else {
                    throw new Error(result.message || 'Server error');
                }

            } catch (error) {
                console.error("Save error:", error);
                showMessage(`บันทึกล้มเหลว: ${error.message}`);
            } finally {
                downloadBtn.textContent = 'บันทึกรูปภาพ';
                downloadBtn.disabled = false;
            }
        }

        // --- 7. เริ่มต้นการทำงาน (Initialization) ---
        window.addEventListener('load', function() {
            // เตรียมข้อความ
            const formattedText =
                `${phpDepartmentName}\n` +
                `เลขรับ<u>                  ${docNumber}                  </u>\n` +
                `วันที่<u>                 ${docDate}                  </u>\n` +
                `เวลา<u>                       ${docTime}                       </u>`;

            // ใส่ค่าลงใน Textarea
            overlayTextInput.value = formattedText;

            // สั่งวาดรูปทันที
            drawImageAndText();
        });

        // Event Listeners เพิ่มเติม
        generateBtn.addEventListener('click', drawImageAndText);
        downloadBtn.addEventListener('click', saveImageToServer);
        overlayTextInput.addEventListener('input', drawImageAndText);

    </script>

    <script  src="assets/utils.js?v=<?php echo time(); ?>"></script>
</body>
</html>
