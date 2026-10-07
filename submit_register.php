<?php
session_start();
$config = require __DIR__ . '/config/config.php';

// ตั้งค่าตัวแปรเริ่มต้นสำหรับการเช็ค Token ฝั่ง Server
$is_valid_token = false;
$error_message = "ไม่พบข้อมูลการสมัครสมาชิกของคุณ หรือลิงก์นี้ถูกใช้งานไปแล้ว";

if (!empty($_GET['token'])) {
    try {
        $token = $_GET['token'];
        $conn = new mysqli($host, $username, $password, $database);
        $conn->set_charset('utf8mb4');

        $stmt = $conn->prepare("SELECT * FROM t_register_check WHERE register_token = ?");
        $stmt->bind_param("s", $token);
        $stmt->execute();
        $result = $stmt->get_result();

        if ($row = $result->fetch_assoc()) {
            $is_valid_token = (int)$row['time'] >= time() - 1800;
        }
    } catch (Exception $e) {
        $error_message = "เกิดข้อผิดพลาดในการเชื่อมต่อระบบ กรุณาลองใหม่ในภายหลัง";
    } finally {
        if (isset($stmt)) $stmt->close();
        if (isset($conn)) $conn->close();
    }
}
?>

<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ยืนยันการสมัครสมาชิก - ตั้งรหัสผ่านใหม่</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Kanit', sans-serif;
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
        }
        .password-strength-bar {
            height: 4px;
            transition: all 0.3s ease;
        }
        .loader {
            border-top-color: #3498db;
            animation: spinner 1.5s linear infinite;
        }
        @keyframes spinner {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">

    <?php if ($is_valid_token): ?>
    <!-- ส่วนของฟอร์มตั้งรหัสผ่าน -->
    <div id="mainView" class="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
        <div class="text-center mb-6">
            <img src="../img/icon_app_xl.png" class="w-20 mx-auto mb-4" alt="App Logo" onerror="this.src='https://via.placeholder.com/80?text=Logo'">
            <h1 class="text-2xl font-bold text-gray-800">ยืนยันการสมัครสมาชิก</h1>
            <p class="text-gray-500 mt-2">กรุณาตั้งรหัสผ่านใหม่เพื่อเริ่มใช้งาน</p>
        </div>

        <form id="confirmForm" class="space-y-6">
            <!-- ส่ง token แฝงไปด้วย -->
            <input type="hidden" id="token" name="token" value="<?php echo htmlspecialchars($_GET['token']); ?>">

            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">รหัสผ่านใหม่</label>
                <input type="password" id="newPassword" name="password"
                    class="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                    placeholder="อย่างน้อย 8 ตัวอักษร" required>

                <div class="mt-2 flex gap-1">
                    <div id="bar1" class="password-strength-bar flex-1 bg-gray-200 rounded"></div>
                    <div id="bar2" class="password-strength-bar flex-1 bg-gray-200 rounded"></div>
                    <div id="bar3" class="password-strength-bar flex-1 bg-gray-200 rounded"></div>
                </div>
                <p id="strengthText" class="text-xs mt-1 text-gray-400">ความปลอดภัยของรหัสผ่าน: ยังไม่ได้ระบุ</p>
            </div>

            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">ยืนยันรหัสผ่านอีกครั้ง</label>
                <input type="password" id="confirmPassword"
                    class="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                    placeholder="กรอกรหัสผ่านให้ตรงกัน" required>
                <p id="matchError" class="text-red-500 text-xs mt-1 hidden">รหัสผ่านไม่ตรงกัน</p>
            </div>

            <button type="submit" id="submitBtn"
                class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors duration-200 flex justify-center items-center">
                <span id="btnText">ยืนยันการสมัคร</span>
                <div id="btnLoader" class="hidden loader ease-linear rounded-full border-2 border-t-2 border-gray-200 h-5 w-5 ml-2"></div>
            </button>
        </form>

        <div id="responseMsg" class="hidden mt-6 p-4 rounded-lg text-center text-sm"></div>
    </div>

    <?php else: ?>
    <!-- ส่วนแสดง Error เมื่อลิงก์ผิดพลาด -->
    <div class="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md text-center">
        <div class="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
        </div>
        <h1 class="text-2xl font-bold text-gray-800">ลิงก์ไม่ถูกต้องหรือหมดอายุ</h1>
        <p class="text-gray-500 mt-2"><?php echo htmlspecialchars($error_message); ?></p>
        <div class="mt-8">
            <a href="/" class="inline-block w-full bg-gray-800 hover:bg-black text-white font-medium py-3 rounded-lg transition-colors duration-200">
                กลับไปยังหน้าหลัก
            </a>
        </div>
    </div>
    <?php endif; ?>

    <script>
        // ทำงานเฉพาะเมื่อมีฟอร์มแสดงผล
        const form = document.getElementById('confirmForm');
        if (form) {
            const newPass = document.getElementById('newPassword');
            const confirmPass = document.getElementById('confirmPassword');
            const bars = [document.getElementById('bar1'), document.getElementById('bar2'), document.getElementById('bar3')];
            const strengthText = document.getElementById('strengthText');
            const matchError = document.getElementById('matchError');
            const submitBtn = document.getElementById('submitBtn');
            const btnText = document.getElementById('btnText');
            const btnLoader = document.getElementById('btnLoader');
            const responseMsg = document.getElementById('responseMsg');

            // ตรวจสอบความแรงรหัสผ่าน
            newPass.addEventListener('input', () => {
                const val = newPass.value;
                let strength = 0;
                if (val.length >= 8) strength++;
                if (val.match(/[A-Z]/) && val.match(/[0-9]/)) strength++;
                if (val.match(/[^A-Za-z0-9]/)) strength++;

                bars.forEach(bar => bar.className = 'password-strength-bar flex-1 bg-gray-200 rounded');
                if (val.length === 0) {
                    strengthText.innerText = "ความปลอดภัยของรหัสผ่าน: ยังไม่ได้ระบุ";
                    strengthText.className = "text-xs mt-1 text-gray-400";
                } else if (strength === 1) {
                    bars[0].classList.add('bg-red-500');
                    strengthText.innerText = "ความปลอดภัย: อ่อน";
                    strengthText.className = "text-xs mt-1 text-red-500";
                } else if (strength === 2) {
                    bars[0].classList.add('bg-yellow-500');
                    bars[1].classList.add('bg-yellow-500');
                    strengthText.innerText = "ความปลอดภัย: ปานกลาง";
                    strengthText.className = "text-xs mt-1 text-yellow-600";
                } else {
                    bars.forEach(bar => bar.classList.add('bg-green-500'));
                    strengthText.innerText = "ความปลอดภัย: ยอดเยี่ยม";
                    strengthText.className = "text-xs mt-1 text-green-600";
                }
            });

            // ตรวจสอบรหัสผ่านตรงกัน
            confirmPass.addEventListener('input', () => {
                matchError.classList.toggle('hidden', confirmPass.value === newPass.value || confirmPass.value === "");
            });

            // ส่งข้อมูลผ่าน Fetch API
            form.addEventListener('submit', async (e) => {
                e.preventDefault();

                // Validation เบื้องต้น
                if (newPass.value !== confirmPass.value) {
                    matchError.classList.remove('hidden');
                    return;
                }
                if (newPass.value.length < 8) {
                    alert("รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร");
                    return;
                }

                // แสดงสถานะ Loading
                submitBtn.disabled = true;
                btnText.innerText = "กำลังประมวลผล...";
                btnLoader.classList.remove('hidden');
                responseMsg.classList.add('hidden');

                const formData = new FormData(form);

                try {
                    const response = await fetch('api/confirm_signup.php', {
                        method: 'POST',
                        body: formData
                    });

                    const result = await response.json();

                    if (result.status === 'success') {
                        // แสดงข้อความสำเร็จ
                        responseMsg.innerText = result.message;
                        responseMsg.className = "mt-6 p-4 bg-green-100 text-green-700 rounded-lg text-center block";
                        form.classList.add('hidden');

                        setTimeout(() => {
                            window.location.href = "index.php"; // หรือหน้า Dashboard
                        }, 2000);
                    } else {
                        // แสดงข้อความ Error จาก Server
                        throw new Error(result.message);
                    }
                } catch (error) {
                    responseMsg.innerText = error.message || "เกิดข้อผิดพลาดในการเชื่อมต่อ";
                    responseMsg.className = "mt-6 p-4 bg-red-100 text-red-700 rounded-lg text-center block";
                    submitBtn.disabled = false;
                    btnText.innerText = "ยืนยันการสมัคร";
                    btnLoader.classList.add('hidden');
                }
            });
        }
    </script>
</body>
</html>
