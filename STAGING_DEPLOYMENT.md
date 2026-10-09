# Staging deployment — E-Office

## Pending release completed — 9 October 2026

- Updated **85 pending application/CLI launcher files** at **https://e-office-test.siya.ac.th/** from commit `60a23f577b2a40876745fbdea0041eabf99fb809`; verified **180 deployable paths** against committed source and the published SHA-256 manifest.
- Applied the additive application/order/routing/Drive registry migrations. Provisioned a persistent private member-version key before publishing the HMAC runtime; existing private runtime settings were preserved and `config/local.php` remains `0600`.
- Hosted integration/workflow tests: **42 passed**. Removed the temporary QA helper afterward; final verification found **0 mismatches / 0 temporary uploads or helpers**. The isolated staging QA data remains available for inspection.
- Source/config/manifest rollback archive: `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-pending-staging-before-20261009-095940.tar.gz`, SHA-256 `9fe476b91c87397e26e76cec0a05a947e049efe3e20734f2daca9b93768030ed`.
- Pre-migration database snapshot: `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-staging-db-before-20261009-095940.json.gz` (**25 tables**).

The older sections below describe the initial staging deployment. Current production status is documented in `PRODUCTION_DEPLOYMENT.md`.

## Sidebar layout fix

- เอา stylesheet Tailwind ชุดเก่าที่ component โหลดซ้ำออก (ทำให้ `.fixed` override desktop sticky)
- Desktop sidebar เป็น sticky flex column กว้าง 256 CSS px; พื้นที่เนื้อหาเริ่มถัดจาก sidebar
- Mobile/tablet ซ่อน drawer เริ่มต้น เปิดผ่านปุ่มเมนู และปิดผ่าน overlay/Escape/เลือกเมนู
- เปลี่ยน breakpoint แล้วล้างสถานะ drawer/overlay และคืนการเลื่อนหน้า
- ตรวจ local ที่ 390, 768, 1024 และ desktop; ตรวจ staging ที่ 1440 และ 390 pixels: ไม่มีการทับบน desktop, ไม่มี horizontal overflow, เปิด/ปิด mobile ผ่าน

วันที่ทดสอบ: 7 ตุลาคม 2026

## สถานะ

- URL: **https://e-office-test.siya.ac.th/**
- อัปโหลดเฉพาะ FTP บัญชีทดสอบ ไม่ได้เชื่อมต่อหรืออัปโหลดบัญชี production
- FTPS: `ftp.siya.ac.th:2121` ตรวจ certificate ตามปกติผ่าน ทั้ง control/data connection ใช้ TLS
- PHP: 8.3.33; ฐานข้อมูล: MariaDB 10.6.28
- PHP เชื่อมฐานข้อมูลด้วย **localhost:3306** ไม่ใช่พอร์ต FTP 2121
- ฐานข้อมูล: `siyaacth_eoffice_test` มี schema เดิมครบ ก่อนทดสอบไม่มีข้อมูล
- Migration ใหม่ทำงานสำเร็จบนฐานข้อมูลทดสอบ
- ไฟล์เอกสารเก็บใน `/home/siyaacth/domains/e-office-test.siya.ac.th/private/file_document` นอก web root
- Config จริงอยู่ที่ `config/local.php` บนโฮสต์ ถูกปิดการเข้าถึงผ่านเว็บและตั้ง permission 600
- SMTP, OneSignal, AI และ Drive เป็น mock; ปิด analytics และ OneSignal browser SDK บน staging

## ผลทดสอบ

| รายการ | ผล |
| --- | --- |
| SHA-256 ของไฟล์อัปโหลด 140 ไฟล์เทียบซอร์ส local | ตรงทั้งหมด |
| Integration/workflow/security บนโฮสต์ staging | **37 ผ่าน, 0 ล้มเหลว** |
| Local regression หลังปรับ deploy/config | **37 ผ่าน, 0 ล้มเหลว** |
| Syntax ล่าสุด | PHP 83 ไฟล์, JS/CJS 14 ไฟล์, inline script 33 blocks ผ่านทั้งหมด |
| Browser login | สำเร็จ, session และสิทธิ์จาก API ถูกต้อง |
| Browser PDF render/วาด/บันทึก | สำเร็จบนโฮสต์จริง |
| PDF หลังบันทึก | หน้าแนวนอน 842 × 595 points; ยังอ่านข้อความ `E-OFFICE TEST DOCUMENT` ได้ |
| Browser ข้อมูล XSS-looking ในแจ้งซ่อม/กลุ่มงาน | แสดงเป็นข้อความ ไม่มี injected images |
| Temporary migration/QA endpoints | ลบแล้ว ตรวจ FTP ไม่เหลือ `.deploy-*`/`.qa-*` |

โฮสต์มี WAF/bot verification: การยิงคำขอเร็วติดหน้า verification ชุดทดสอบ remote จึงเว้นระยะ 2 วินาทีและไม่นับหน้า challenge เป็นผลผ่าน การอ่าน private paths บางรายการถูกโฮสต์ปฏิเสธด้วย redirect ไปหน้า access-denied ของ control panel (พอร์ต 2222) แทน HTTP 403; runner ไม่ตาม redirect นี้และตรวจว่าไม่ใช่ response ของแอป

## บัญชีทดสอบ

- Admin: `qa-admin@siya.ac.th`
- Owner / Recipient / Outsider: `qa-owner@siya.ac.th`, `qa-recipient@siya.ac.th`, `qa-outsider@siya.ac.th`
- รหัสผ่านสุ่มเก็บเฉพาะไฟล์ private บนเครื่อง:
  `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-staging-accounts.private.json`
- ไม่ใช้รหัสผ่านมาตรฐานของ test database local บนเว็บสาธารณะ
- มีข้อมูล QA จาก integration tests สำหรับทดลอง workflow; ไม่ได้คัดลอกข้อมูลผู้ใช้หรือเอกสาร production

## สำรองก่อน deployment

- เว็บเดิม: `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-staging-before-20261007-112135.tar.gz`
- ฐานข้อมูลเดิม (schema + rows): `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-staging-db-before-20261007-112136.json.gz`
- Release manifest: `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-staging-manifest.json`

## การทดสอบซ้ำและ production

`scripts/staging-hosting.py` ใช้เฉพาะบัญชี staging จากไฟล์ credentials ที่ผู้ใช้ระบุ โค้ดไม่ล็อกอิน production โดยคำสั่งตรวจ/อัปโหลดนี้ การทดสอบ remote ต้องเตรียม helper แบบสุ่มพร้อม header secret แล้วลบเมื่อเสร็จ:

```powershell
python scripts/staging-hosting.py prepare-tests
$env:EOFFICE_STAGING_TEST = '1'
$env:EOFFICE_REMOTE_DELAY_MS = '2000'
node tests/integration.cjs
python scripts/staging-hosting.py finish-tests
```

คำสั่งตรวจชุดไฟล์: `python scripts/staging-hosting.py verify`

ณ การติดตั้ง staging ครั้งแรก production ยังไม่ได้ deploy; ปัจจุบันเผยแพร่ production แล้ว ดูสถานะล่าสุดใน `PRODUCTION_DEPLOYMENT.md` มี template `config/production.example.php` สำหรับเตรียมค่าบนโฮสต์ และขั้นตอนใน `DEPLOYMENT.md`
