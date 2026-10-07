<?php
// report.php
if (isset($_POST['data_json'])) {
    $data = json_decode($_POST['data_json'], true);
} else {
    // ถ้าเปิดมาเฉยๆ โดยไม่มีการส่งค่า
    die("ไม่พบข้อมูลสำหรับการออกรายงาน");
}

$reportTitle = $data['title'] ?? 'รายงาน';
$items = $data['reportData'] ?? [];
?>
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        @page { size: A4 landscape; margin: 10; }
        @media print {
            body { background: none !important; padding: 0 !important; }
            .no-print { display: none !important; }
            .page { box-shadow: none !important; margin: 10 !important; width: 100% !important; padding: 10mm 15mm !important; page-break-after: always; }
            thead { display: table-header-group; }
        }
        .page { width: 297mm; min-height: 210mm; box-sizing: border-box; background: white; }
        tr { page-break-inside: avoid; }
        body { font-family: 'Sarabun', sans-serif; }
    </style>
</head>
<body class="bg-slate-600 p-10 flex flex-col items-center">

    <button onclick="window.print()" class="no-print fixed bottom-8 right-8 bg-blue-600 hover:bg-blue-900 text-white w-16 h-16 rounded-full shadow-2xl flex items-center justify-center z-50">
        <i class="fas fa-print text-2xl"></i>
    </button>

    <div class="report-container space-y-8">
        <div class="page shadow-2xl p-[15mm_20mm] relative overflow-hidden">
            <header class="flex justify-between items-start border-b-2 border-blue-800 pb-4 mb-6">
                <div class="flex items-center gap-4">
                        <img src="img/icon_app_xl.png" width="70px">                    <div>
                        <h1 class="text-2xl font-bold text-blue-900 leading-tight">โรงเรียนศรียานุสรณ์</h1>
                        <h2 class="text-sm font-medium text-gray-500">ระบบหนังสือราชการ E-Office | สารบรรณกลาง</h2>
                    </div>
                </div>
                <div class="text-right text-xs text-gray-500 leading-relaxed">
                    <p><strong>วันที่พิมพ์:</strong> <?php echo date("d M Y | H:i"); ?> น.</p>
                    <!-- <p><strong>เลขอ้างอิง:</strong> <?php echo $reportDate; ?></p> -->
                </div>
            </header>

            <!-- <h3 class="text-center text-xl font-bold mb-6 text-gray-800 underline underline-offset-8">
                <?php echo htmlspecialchars($reportTitle); ?>
            </h3> -->

            <table class="w-full border-collapse border border-gray-300 text-[12px] pb-10">
                <thead class="bg-blue-800 text-white">
                    <tr>
                        <th class="border border-gray-400 p-2 w-[110px]">วันที่</th>
                        <th class="border border-gray-400 p-2 w-[100px]">เลขทะเบียนรับ</th>
                        <th class="border border-gray-400 p-2 w-[100px]">ที่</th>
                        <th class="border border-gray-400 p-2 w-[100px]">ลงวันที่</th>
                        <th class="border border-gray-400 p-2 w-[130px]">จาก</th>
                        <th class="border border-gray-400 p-2 text-center">ชื่อเรื่อง</th>
                        <th class="border border-gray-400 p-2 w-[90px]">การปฏิบัติ</th>
                    </tr>
                </thead>
                <tbody class="text-gray-700">
                    <?php if (empty($items)): ?>
                        <tr>
                            <td colspan="6" class="p-10 text-center text-gray-400">--- ไม่พบข้อมูลสำหรับออกรายงาน ---</td>
                        </tr>
                    <?php else: ?>
                        <?php foreach (array_reverse($items) as $index => $row): ?>
                            <tr class="<?php echo $index % 2 === 0 ? 'bg-white' : 'bg-slate-50'; ?>">
                                <td class="border border-gray-300 p-2 text-center">
                                    <?php echo htmlspecialchars($row['วันที่'] ?? '-', ENT_QUOTES, 'UTF-8'); ?>
                                </td>

                                <td class="border border-gray-300 p-2 text-center">
                                    <?php echo htmlspecialchars($row['เลขทะเบียนรับ'] ?? '-', ENT_QUOTES, 'UTF-8'); ?>
                                </td>
                                <td class="border border-gray-300 p-2 text-center font-semibold text-blue-800">
                                    <?php echo htmlspecialchars($row['ที่'] ?? '-', ENT_QUOTES, 'UTF-8'); ?>
                                </td>
                                <td class="border border-gray-300 p-2 text-center">
                                    <?php echo htmlspecialchars($row['ลงวันที่'] ?? '-', ENT_QUOTES, 'UTF-8'); ?>
                                </td>
                                <td class="border border-gray-300 p-2 text-center">
                                    <?php echo htmlspecialchars($row['จาก'] ?? '-', ENT_QUOTES, 'UTF-8'); ?>
                                </td>
                                <td class="border border-gray-300 p-2 text-left">
                                    <div class="font-medium text-gray-900"><?php echo htmlspecialchars($row['ชื่อเรื่อง'] ?? '-', ENT_QUOTES, 'UTF-8'); ?></div>
                                </td>
                                <td class="border border-gray-300 p-2 text-center">
                                    <?php echo htmlspecialchars($row['การปฏิบัติ'] ?? ' ', ENT_QUOTES, 'UTF-8'); ?>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </tbody>
            </table>

            <footer class="absolute bottom-[5mm] left-[20mm] right-[20mm] border-t border-gray-200 pt-0 flex justify-between text-[11px] text-gray-400">
                <p>สร้างโดยระบบสารบรรณอิเล็กทรอนิกส์ (E-Office) - โรงเรียนศรียานุสรณ์</p>
                <p>จำนวนทั้งหมด <?php echo count($items); ?> รายการ</p>
            </footer>
        </div>
    </div>
</body>
</html>
