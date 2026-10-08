# Production deployment — E-Office

## Automatic order email release (8 October 2026)

Targeted release verified **18 files**, added the order queue/settings tables, and configured the persistent Admin-secret encryption key in private `config/local.php` (`0600`). Existing Gemini key/model settings are preserved: **gemini-3.6-flash** passes real synthetic-PDF plus JSON-output testing, and the protected Admin model-list API returns 45 models.

**9 production HTTP smoke checks pass**. Temporary verification account and two synthetic orders were removed, with baseline counts restored: users **69**, documents **14,494**, email logs **3,463**. Staff emails were not sent during verification. Temporary deployment helpers and incomplete upload files were cleaned up.

The owner configured cron through DirectAdmin every five minutes. `scripts/order-cron.sh` recorded its first real heartbeat at **8 October 2026, 14:20:02 Asia/Bangkok**, logging `0 order jobs processed` without errors. Automatic delivery was enabled at **14:20:51 Asia/Bangkok**. Orders created before that activation boundary were not enrolled.

Two post-activation production smoke checks pass: enabled settings with a real cron heartbeat, and automatic enrollment of a new offline-signed order into `waiting_files`. Its temporary job/document/account were removed; staff mail was not sent. See [ORDER_EMAILS.md](ORDER_EMAILS.md#hosting-panel-cron-entry) for scheduling and operating instructions.

Confirmed the next scheduled cycle after activation at **14:25:01 Asia/Bangkok**; its log contains `0 order jobs processed`, no errors, and enabled status remains true.

Private rollback archive: `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-orders-before-20261008-104514.tar.gz`. The encryption-key configuration backup is outside Git at `eoffice-orders-config-after.private.php` in the same approved temporary directory.

## AMSS PDF import hotfix (8 October 2026)

- Source commit: `3b7a620` (`fix: restore automatic AMSS PDF imports`), pushed to `origin/main`.
- Restored the legacy behavior found in `e-office backup/api/create_document.php`: direct AMSS PDF links become document-bound attachments on create/edit, with the link caption retained as the attachment title. Successfully imported links are removed from `Doc_Url`.
- Review tightened public IPv4 checks and standard-port URL normalization. AMSS HTTP links download over verified HTTPS; redirects are not followed, PDF bytes are validated and each file is limited to 20 MB. Failed imports roll back document, file and notification changes.
- The staged release was tested independently of concurrent working-tree changes. Full committed regression suite passed; AMSS validation **33 passed**, live AMSS HTTP checks **7 passed**. The checkout with order integration also passed its additional AMSS-to-AI queue check.
- Targeted deployment verified SHA-256 for **2 files**: `config/amss-links.php` and `api/create_document.php`. The deployed document API retains its existing order-email integration. No database migration was required.
- Production downloaded the AMSS sample successfully: **62,188 bytes**, SHA-256 `3cd5c7a41eef1b3801552229770c734479d137a359943fbdb160dc5fae1851b9`.
- Production API smoke **5 passed**: link-only import, PDF bytes/MIME/revision, guest denial, edit without duplication, and failed-download rollback. Synthetic user/session/document/attachment were removed; no recipients or notifications were created.
- Post-deploy checks: **0 checksum mismatches**, **0 temporary release helpers**.
- Backup: `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-amss-before-20261008-112721.tar.gz` (SHA-256 `bd0e29397ac1b1b3859bc95bd43dfae0aef37353fc444542d7a7255165cc4d61`). The release metadata and smoke cleanup record are stored privately in Temp/opencode.
- Targeted deployment/check/rollback tooling: `python scripts/amss-release.py inspect|deploy|verify|smoke|cleanup-smoke|rollback`.

## Review hotfix (8 October 2026)

Applied the authorization/attachment/public-data and notification fixes documented in `REVIEW_FIXES.md`. Local regression: 42 workflow, 7 lock-race and 17 queue tests; staging: 42 workflow and 17 queue tests. Production checksum verification covers 135 files with no mismatches, and 12 controlled smoke tests pass. Temporary smoke records and endpoints were removed; original data counts are unchanged.

Notifications now persist separate Email/Push outcomes, safe Push retries and manual uncertain SMTP states. Cleanup records no longer occupy the head of the delivery queue. Google Login/onboarding source is preserved and its local regression suites pass.

วันที่: 7 ตุลาคม 2026

## ผล deployment

- URL: **https://e-office.siya.ac.th/**
- PHP 8.3.33 / MariaDB 10.6.28; FTPS ตรวจ certificate ผ่าน
- ฐานข้อมูลจริง: `siyaacth_eoffice` ผ่าน localhost:3306
- อัปโหลด/ตรวจ checksum application **129 ไฟล์** และรัน migration สำเร็จ
- บริการ production เปิดจริง (`EOFFICE_MOCK_SERVICES=false`)
- วันที่เอกสารไทยเดิมยังแก้ไขได้; แก้ query dashboard ให้รองรับ collation ของฐานข้อมูลจริง
- Sidebar เป็น sticky flex column ไม่ทับเนื้อหาบน desktop
- โฟลเดอร์ `Boardcast` ไม่เกี่ยวกับ E-Office: ลบออกจาก source ตามผู้ใช้ และไม่อัปโหลด/แก้ไขโฟลเดอร์ดังกล่าวบน production

## ข้อมูลเดิมและสำรอง

ตรวจหลังลบข้อมูล smoke test:

| ข้อมูล | จำนวน |
| --- | ---: |
| ผู้ใช้เดิม | 69 |
| เอกสารเดิม | 14,491 |
| ไฟล์แนบในฐานข้อมูล | 12,244 |
| สิทธิ์เอกสาร | 24,684 |
| รายการจองห้อง | 127 |
| ใบแจ้งซ่อม | 13 |
| Email logs | 3,463 |

ไฟล์จริง **5,431 ไฟล์ / 7,128,788,382 bytes** ถูกย้ายด้วย directory rename ไป private storage นอก web root ตรวจ inode/device/size หลังย้าย: **missing 0 / changed 0**. ไม่แปลงหรือเขียนทับ bytes ของไฟล์เดิม

- Application backup: `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-production-app-before-20261007-160638.tar.gz`
- Database snapshot ณ maintenance: `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-production-db-before-20261007-175856.json.gz`
- Document snapshot บนโฮสต์: `/home/siyaacth/domains/e-office.siya.ac.th/private/rollback-20261007-175627/file_document`
- Storage ที่ใช้งานจริง: `/home/siyaacth/domains/e-office.siya.ac.th/private/file_document`
- Private rollback metadata / release manifest อยู่ในโฟลเดอร์ Temp/opencode บนเครื่องและ config ที่เข้าถึงไม่ได้จากเว็บ

Document snapshot ใช้ hard links ไม่ใช่ off-site copy; การเขียนเอกสารของ release ใช้การแทนที่ไฟล์แบบ atomic เพื่อรักษา inode เดิมใน snapshot ไม่ควรแก้ไขไฟล์ snapshot หรือเขียน PDF เดิมแบบ in-place. การตรวจ SHA-256 ทั้ง 7 GB ติดข้อจำกัด I/O ของ shared host จึงยืนยัน snapshot ด้วย inode/device/size และใช้ SHA-256 สำหรับซอร์สและ database backup

## การทดสอบ

- Local regression **39 ผ่าน**
- Staging regression **39 ผ่าน**
- Production smoke **12 ผ่าน**: login, Secure/HttpOnly cookie, role API, สร้าง/แนบ PDF, วันที่ไทย, private-file access, อ่าน/ลงนาม/revision conflict, dashboard, booking, maintenance และ logout
- ใช้บัญชี Admin/เอกสารสังเคราะห์ชั่วคราวเฉพาะ smoke test; ลบทั้งบัญชี session และไฟล์/เอกสารหลังทดสอบแล้ว
- ไม่ส่ง notification จาก smoke documents และไม่ส่ง test mail ให้บุคลากร
- SMTP authentication ผ่าน; ส่ง self-test เพียงหนึ่งฉบับไป mailbox ของบริการ SMTP สำเร็จในระดับการรับส่งของ SMTP
- OneSignal API credential check HTTP 200; ไม่ทดสอบ broadcast จริง
- Gemini ใช้ model เดิมของ production **gemini-3.6-flash**; ทดสอบ generate JSON จริง HTTP 200
- Google Drive endpoint HTTPS/redirect ส่งกลับ HTTP 200 และ JSON; ไม่สร้างภาพจริงใน Drive ระหว่าง production smoke
- เปิด PDF ตัวอย่างคำสั่งจริงปี 2569 ผ่าน API ได้ HTTP 200, MIME application/pdf และมี revision
- ลบ temporary deployment endpoints แล้ว

## หลัง deployment

ผู้ใช้เดิมต้องเข้าสู่ระบบใหม่หนึ่งครั้ง เพราะ session/token เดิมไม่ถูกยอมรับ. บัญชีและข้อมูลเดิมไม่ถูก reset; plaintext password จะย้ายเป็น hash หลัง login ที่ถูกต้อง

Credential ของบริการเดิมถูกย้ายไป protected `config/local.php` (600) โดยไม่รวมใน Git. การหมุนเวียน credentials ที่เคยฝังใน source ยังต้องทำที่บริการต้นทางแยกต่างหาก

ใช้ URL หลักด้านบน: certificate ของ alias `www.e-office.siya.ac.th` ยังไม่ผ่านการตรวจ trust chain จากเครื่องทดสอบ ต้องตั้ง certificate/alias เพิ่มที่ control panel ของโฮสต์; redirect ของแอปไม่สามารถแก้ TLS handshake ที่เกิดก่อนเข้า PHP ได้

## Google login — อัปเดต 7 ตุลาคม 2026

- เปิดปุ่ม **เข้าสู่ระบบด้วย Google** บน `https://e-office.siya.ac.th/` แล้ว โดยใช้ OAuth Client ที่ผู้ดูแลให้มา
- อัปเดตและตรวจ SHA-256 ไฟล์ที่เกี่ยวข้อง **9 ไฟล์**; ตรวจ release manifest ทั้งเว็บ **134 ไฟล์** ไม่พบ mismatch
- เพิ่ม OAuth keys ใน protected `config/local.php` แบบ atomic พร้อม permission `600` และตรวจว่าค่า database/storage/บริการอื่นยังตรงกับค่าเดิม
- รัน migration สำเร็จ เพิ่มตาราง `eoffice_google_accounts`; ยังไม่มีการผูกบัญชีจริงระหว่าง deployment
- Redirect URI: `https://e-office.siya.ac.th/api/auth_google_callback.php`
- ตรวจใน browser แล้วปุ่มเปิดหน้า **Sign in with Google** ได้ ไม่พบ redirect URI error ในขั้นส่งคำขอเริ่มต้น
- Google token endpoint รับ Client ID/Secret ของเซิร์ฟเวอร์แล้วปฏิเสธ code จำลองด้วย `invalid_grant` ตามคาด; verified TLS ผ่าน
- Production Google/password smoke **12 ผ่าน**: UI enabled, PKCE/secure OAuth cookie, missing/malformed/wrong state, replay, cancellation/document return, arbitrary return rejection, invalid code, private config access denied, password login/shared role/logout และ cleanup
- บัญชีสังเคราะห์สำหรับตรวจ password login ถูกลบพร้อม session แล้ว; ไม่สร้างเอกสารหรือส่ง notification ในรอบนี้
- หลังตรวจ ผู้ใช้เดิม **69**, เอกสาร **14,491**, ไฟล์แนบ **12,244**, สิทธิ์เอกสาร **24,684** ตรงกับก่อนอัปเดต
- ไม่มี temporary `.release-*` helpers เหลือบนเซิร์ฟเวอร์
- Backup เฉพาะไฟล์ก่อนอัปเดต: `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-google-before-20261007-212340`

การเลือกบัญชี Google Workspace `@siya.ac.th` และ consent จนกลับเข้า E-Office ต้องให้เจ้าของบัญชีทดสอบเอง หาก Audience เป็น External / Testing บัญชีที่ทดสอบต้องอยู่ใน Test users รายละเอียดตั้งค่าอยู่ใน [GOOGLE_LOGIN.md](GOOGLE_LOGIN.md)

### ปรับเงื่อนไข Google login และ onboarding

- อัปเดตไฟล์ที่เกี่ยวข้อง 8 ไฟล์พร้อม backup แบบ targeted; SHA-256 ตรงทั้งหมด
- บัญชี Workspace `@siya.ac.th` ใหม่เข้าสู่หน้าลงทะเบียนพร้อมชื่อจาก Google แก้ไขชื่อและยอมรับข้อตกลงแล้วสร้างสมาชิกสิทธิ์ User
- อีเมลนอกโรงเรียนใช้ Google login ได้เมื่อมีบัญชีเดิมในระบบ โดยไม่สร้างบัญชีภายนอกอัตโนมัติ
- อีเมลภายนอกที่ Google ไม่ได้ดูแลโดยตรงต้องยืนยันรหัสผ่าน E-Office ครั้งแรกก่อนผูก Google; มี rate limit ร่วมกับ password login
- เพิ่ม scope `profile` และเอา domain hint ออกจาก account chooser; Google Cloud Audience ต้องเป็น External เพื่อให้ผู้ใช้นอกองค์กรเข้าได้
- การสร้าง user/binding/session ใช้ transaction และ user row lock; onboarding ใช้ CSRF token และ pending session อายุ 10 นาที
- แก้ stale callback ให้ไม่ลบคำขอล็อกอินปัจจุบัน และขยาย secret scanner ให้ตรวจไฟล์ YAML/extension อื่นด้วย
- Local Google auth checks 55 ผ่าน พร้อม HTTP onboarding/linking/rate-limit tests; ทดสอบฟอร์มและสร้าง/เข้าสู่ระบบบัญชี QA บน local browser แล้วลบบัญชี QA หลังตรวจ
- Production smoke 12 ผ่านหลังอัปเดต; original counts ยังเป็นผู้ใช้ 69 และเอกสาร 14,491 ไม่มี temporary helpers เหลือ
- Backup: `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-google-before-20261007-231700`
