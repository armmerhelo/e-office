# ผลการแก้ไขและทดสอบ E-Office

วันที่: 7 ตุลาคม 2026

## สภาพแวดล้อม

- Windows, PHP 8.3.33, Node.js 22.21.1, MySQL 8.4.3
- ฐานข้อมูลต้นทาง: `document2`; ฐานข้อมูลสำเนาทดสอบ: `eoffice_review_test`
- สำรองก่อนแก้: `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-before-fixes.tar` และ `document2-before-fixes.sql`
- ทดสอบ API ด้วย PHP server 3 process แยกกัน (8081–8083) ใช้ฐานข้อมูลสำเนาและ storage ชั่วคราว
- เว็บที่เปิดสำหรับทดสอบด้วย browser: `http://localhost/` ใช้ฐานข้อมูล **eoffice_review_test** และบริการจำลอง
- รัน migration แบบเพิ่มตาราง/index ให้ `document2` แล้ว โดยไม่สร้าง QA accounts หรือข้อมูลทดสอบในฐานข้อมูลต้นทาง

## ผลอัตโนมัติ

คำสั่ง: `npm.cmd test`

| รายการ | ผล |
| --- | --- |
| PHP syntax 81 ไฟล์ รวม vendor | ผ่านทั้งหมด |
| JavaScript/CJS syntax 14 ไฟล์ | ผ่านทั้งหมด |
| Inline scripts 32 blocks ที่ตรวจด้วย parser | ผ่านทั้งหมด |
| Integration/security/workflow tests | 37 ผ่าน, 0 ล้มเหลว |
| npm audit --omit=dev | 0 vulnerabilities |
| npm run build:css | สร้าง CSS สำเร็จ |

กรณีทดสอบครอบคลุม:
- Boolean password bypass, รหัสผ่านผิด, HttpOnly session, logout/revoke
- Guest/User/Admin authorization และ cross-site origin rejection
- สมัคร/ยืนยัน/ใช้ token ซ้ำ, hash รหัสผ่าน, เพิ่ม/แก้/ลบผู้ใช้และ revoke หลัง reset
- pagination และการเพิ่มกลุ่มงาน
- ปฏิเสธ PHP ที่ปลอมเป็น PDF, ไฟล์ของเอกสารอื่น, URL/file proxy และ endpoint เก่า
- ภาพ PNG จริงถูกบันทึกด้วยชื่อที่เซิร์ฟเวอร์กำหนด แม้ผู้เรียกเสนอชื่อ `.php`
- เอกสารใหม่ + PDF + ผู้รับ, private-file access, read status, receipt fields
- ลงนามสำเร็จ, stale revision 409 และ upload ที่ถูกปฏิเสธไม่ทำลายไฟล์/สถานะเดิม
- transaction rollback เมื่อผู้รับผิด, ส่งกลุ่มงาน, revoke สิทธิ์โดยเก็บประวัติลงนาม
- แก้เอกสารปีก่อนแล้วไฟล์ยังอยู่ในปีที่ถูกต้อง
- ตรวจเวลา/เจ้าของการจอง, overlap, อนุมัติสองรายการพร้อมกันผ่านคนละ PHP process ได้เพียงหนึ่งรายการ
- จองเลขคำสั่งพร้อมกันผ่านสาม process ได้เลขไม่ซ้ำ
- ผู้แจ้งซ่อมกำหนดสถานะเจ้าหน้าที่ไม่ได้, mock Drive upload, เจ้าหน้าที่บันทึกผลซ่อม
- AI output ตรวจกลับกับฐานข้อมูล, mock SMTP/email retry ไม่ส่งซ้ำ, mock notification worker
- ปิด static private paths และ SQL injection ใน notification input

## ผล browser

- ล็อกอินด้วยฟอร์มจริง และแสดงเมนูตามสิทธิ์จาก server
- สร้างเอกสารจากฟอร์ม เลือกผู้รับ แนบ PDF บันทึกแล้วแสดงในทะเบียน
- เปิด PDF.js 4.10.38, เลือกตราและวางบน canvas, บันทึกผ่าน API สำเร็จ
- PDF ที่บันทึกยังเป็นหน้าแนวนอน **842 × 595 points** และดึงข้อความเดิม `E-OFFICE TEST DOCUMENT` ได้
- หน้าจัดการกลุ่มงานแสดง apostrophe/HTML-looking text เป็นข้อความ เปิด modal แก้ไขได้
- หน้าจัดการแจ้งซ่อมและจองห้องแสดง `<img ...>` ที่อยู่ในข้อมูลเป็นข้อความ ไม่สร้าง injected images
- โหลดหน้าสมาชิกและ pagination สำเร็จ
- หน้าหลัก mobile 390 × 844 ไม่มี horizontal overflow และปุ่มเมนูแสดง
- หยุดเว็บเซิร์ฟเวอร์จริงแล้ว navigation ไป `index.php` แสดงหน้า offline ผ่าน service worker จากนั้นเปิดเซิร์ฟเวอร์กลับและเข้าเว็บได้

## สิ่งที่ยังไม่ได้ยืนยันกับบริการจริง

- SMTP, OneSignal, Google Drive, Gemini และอุปกรณ์ Sensor/Parking: ทดสอบ adapter/mock ตามที่ตกลง ยังไม่ได้ส่งไปยังผู้รับจริงหรือใช้อุปกรณ์จริง
- การตั้งค่า Apache/Nginx production และไฟล์ PDF เก่าบน legacy server ต้องตรวจใน deployment จริง
- การหมุนเวียน credentials เดิมต้องดำเนินการที่บริการต้นทาง; ซอร์สแอปเปลี่ยนเป็นอ่าน environment แล้ว
- สิทธิ์ staff เดิมถูกย้ายเป็นข้อมูลใน `eoffice_permissions` (migration ทำครั้งเดียว) เพื่อคง workflow เดิม

รายละเอียดการตั้งค่า/migration/notification worker อยู่ใน `DEPLOYMENT.md`.
