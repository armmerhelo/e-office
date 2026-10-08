# E-Office

ระบบหนังสือราชการ: รับ/ส่งเอกสารและไฟล์แนบ ลงนาม PDF จัดการสมาชิก/กลุ่มงาน จองห้องประชุม จองเลขคำสั่ง แจ้งซ่อม และแจ้งเตือนผ่านอีเมล/Push

## Runtime

- PHP 8.1+ พร้อม PDO MySQL, mysqli/mysqlnd, mbstring, fileinfo, GD, cURL และ OpenSSL
- MySQL 8 หรือ MariaDB ที่รองรับ InnoDB และ JSON
- Node.js 22+ สำหรับ build CSS และทดสอบ
- Apache ที่เปิดใช้ `.htaccess`; สำหรับ local PHP server ใช้ `scripts/router.php`

## ตั้งค่า

1. สร้างฐานข้อมูลจาก schema/backup ของระบบ แล้วตั้งค่าใน environment หรือ `config/local.php` โดยอ้างอิง `config/local.example.php`
2. กำหนด `APP_URL` ให้ตรงกับ origin ของเว็บ และ `EOFFICE_STORAGE` เป็นโฟลเดอร์เก็บเอกสารนอก web root
3. รัน migration และสร้าง CSS:

```sh
php scripts/migrate.php
npm ci
npm run build:css
```

ไฟล์ฐานข้อมูลสำรองและข้อมูลบุคลากรไม่รวมอยู่ใน repository ต้องนำเข้าจากชุดข้อมูลที่ผู้ดูแลมีสิทธิ์ใช้งาน

## ทดสอบ

### นำเข้า PDF จาก AMSS

เมื่อเพิ่มลิงก์ไฟล์ `.pdf` จาก `https://amss.sesact.go.th/` ในฟอร์มสร้างหรือแก้ไขเอกสาร ระบบจะดาวน์โหลดเป็นไฟล์แนบโดยใช้ชื่อลิงก์เป็นชื่อเอกสาร และนำลิงก์ที่นำเข้าสำเร็จออกจากรายการลิงก์ ลิงก์ HTTP เดิมจะดาวน์โหลดผ่าน HTTPS ส่วนลิงก์หน้าเว็บทั่วไปยังเก็บเป็นลิงก์ตามปกติ

ไฟล์ต้องเป็น PDF จริงและขนาดไม่เกิน 20 MB หากดาวน์โหลดไม่ได้ ระบบจะแจ้งข้อผิดพลาดและยกเลิกการบันทึกครั้งนั้น รวมถึงไฟล์และการแจ้งเตือนที่เพิ่งเพิ่ม เพื่อให้แก้ลิงก์แล้วลองใหม่ได้

- `npm.cmd run test:amss`: ตรวจเงื่อนไข URL และเนื้อหา PDF โดยไม่เชื่อมต่อ AMSS
- `npm.cmd run test:amss -- --live`: ทดสอบนำเข้าจาก AMSS จริงผ่าน API ในฐานข้อมูลชั่วคราวและ storage ชั่วคราวที่ลบทิ้งหลังทดสอบ

### ชุดทดสอบระบบ

เตรียมฐานข้อมูลสำเนาที่มีชื่อจบด้วย `_test` ก่อนรัน tests และกำหนด `PHP_BIN` ให้ตรงกับเครื่อง:

```powershell
$env:PHP_BIN = 'C:\path\to\php.exe'
$env:TEST_DATABASE = 'eoffice_review_test'
npm.cmd test
npm.cmd run serve:test
```

- Tests ใช้บัญชี QA และเอกสารจำลองในฐานข้อมูลทดสอบเท่านั้น
- SMTP, Push, AI และ Drive ใช้ adapter จำลองระหว่าง tests
- `serve:test` เปิดเว็บที่ localhost; ใช้ `DEV_PORT` หากต้องการเปลี่ยนพอร์ต
- ข้อมูลลับ config จริง เอกสารที่อัปโหลด และข้อมูลบุคลากรถูกกันออกจาก Git

## เอกสาร

- [MEMBER_PERMISSIONS.md](MEMBER_PERMISSIONS.md): การให้สิทธิ์รายบุคคลและการจัดการสมาชิกโดย Admin สูงสุด

- [GOOGLE_LOGIN.md](GOOGLE_LOGIN.md): เปิดใช้งาน Google login และตั้งค่า OAuth Client
- [DEPLOYMENT.md](DEPLOYMENT.md): การตั้งค่า production, migration และ notification worker
- [ORDER_EMAILS.md](ORDER_EMAILS.md): คิวส่งอีเมลคำสั่งอัตโนมัติ, cron และตั้งค่า AI สำหรับ Admin สูงสุด
- [TEST_REPORT.md](TEST_REPORT.md): ผลทดสอบ local
- [STAGING_DEPLOYMENT.md](STAGING_DEPLOYMENT.md): ผล deployment และทดสอบบน staging
- [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md): ผล deployment production
- [REVIEW_FIXES.md](REVIEW_FIXES.md): บั๊กจากรีวิวที่แก้และ regression tests

## โครงสร้าง

| โฟลเดอร์ | หน้าที่ |
| --- | --- |
| `api/`, `config/` | API, authentication, permissions, configuration และ migrations |
| `assets/`, `components/` | Frontend และ CSS |
| `e-sign/` | แสดง PDF ประทับตรา วาดและลงนาม |
| `management/` | สมาชิกและกลุ่มงาน |
| `room_booking/`, `external_number_booking/` | จองห้องและเลขคำสั่ง |
| `maintenance_requests/` | แจ้งซ่อมและการจัดการของเจ้าหน้าที่ |
| `email_send/` | อีเมลคำสั่ง |
| `scripts/`, `tests/` | Deployment tools, workers และ automated tests |
