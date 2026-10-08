# แผนสำรองและย้ายเอกสารไป Google Drive

## ข้อกำหนดที่ตกลงแล้ว

- สำรองอัตโนมัติทุกวันผ่าน Google Apps Script ที่ใช้กับ Drive อยู่เดิม
- เก็บไฟล์ถาวรบนเซิร์ฟเวอร์เฉพาะปีปัจจุบันและย้อนหลังอีก 2 ปี
- ใช้ปีเอกสาร `Doc_Year` (พ.ศ.) โดยคำนวณปีปัจจุบันตาม Asia/Bangkok
- ตัวอย่างปี 2569: เก็บปี 2567–2569 บนเซิร์ฟเวอร์; ปี 2566 และก่อนหน้าเข้าเกณฑ์ย้าย
- อ่านเอกสารผ่าน E-Office เท่านั้น; ไฟล์บน Drive เข้ารหัสและเป็นส่วนตัว
- ต้นฉบับ ไฟล์ลงนาม และเวอร์ชันที่ยังจำเป็นต้องกู้คืนต้องมีสำเนาครบ

เอกสารนี้เป็นแผน ยังไม่ได้เปิดงานอัปโหลดรายวันหรือการนำไฟล์บนเซิร์ฟเวอร์ออก

## ใช้ Apps Script เดิมอย่างไร

ใช้บัญชี Drive เดิมและโปรเจกต์ Apps Script เดิมได้ โดยเพิ่มเส้นทาง API เฉพาะ E-Office backup/archive ภายใต้ deployment ของบัญชีเจ้าของเดิม ไม่เปลี่ยนสัญญา API ภาพแจ้งซ่อมที่ใช้อยู่

สิ่งที่ต้องเพิ่ม:

1. ยืนยันตัวตนคำขอจากเซิร์ฟเวอร์ด้วย shared secret/HMAC, timestamp และ nonce; เก็บ secret ใน Script Properties และ private config ของ E-Office
2. อัปโหลด/อ่าน/ตรวจสถานะวัตถุเข้ารหัสเป็นส่วนขนาดเล็ก และเริ่มใหม่เฉพาะส่วนที่ยังไม่สำเร็จเมื่อเครือข่ายหลุด
3. ใช้ operation ID ที่คงเดิมเมื่อ retry และทำการสร้างแบบ idempotent เพื่อไม่สร้างไฟล์ซ้ำ; ล็อกการสร้าง/ตรวจสถานะด้วย LockService
4. จำกัดการอ่านและเขียนให้อยู่ใต้โฟลเดอร์ archive/backup ที่กำหนด ไม่รับ file ID หรือ folder ID ใด ๆ แล้วเข้าถึงทั้งบัญชีได้โดยอิสระ
5. เปิดใช้งานด้วยบัญชีเจ้าของ Drive ที่มีพื้นที่เพียงพอ; ตรวจ Apps Script runtime/concurrency และโควตาปัจจุบันก่อนเลือกขนาด batch

ส่วนเข้ารหัส/ถอดรหัสอยู่ที่ E-Office เท่านั้น Apps Script เก็บและส่งคืน ciphertext โดยไม่ต้องถือกุญแจถอดรหัส

ปัจจุบัน repository มีตัวเรียก Apps Script สำหรับ `create_folder` และ `create` ภาพแจ้งซ่อม แต่ไม่มี source `.gs` ของ endpoint จึงต้องตรวจ `doGet`/`doPost` และ helper เดิมก่อนรวม API ใหม่อย่างถูกต้อง

## โครงสร้างข้อมูล

แบ่งการเก็บบน Drive เป็น:

- **Archive objects:** วัตถุเข้ารหัสตามเวอร์ชันไฟล์ เปลี่ยนไฟล์แล้วสร้างเวอร์ชันใหม่ ไม่เขียนทับเนื้อหาของเวอร์ชันที่ backup เดิมอ้างอิง
- **Daily backups:** backup ฐานข้อมูลเข้ารหัสพร้อม manifest ของวัตถุและเวอร์ชันที่ต้องใช้กู้คืนชุดนั้น

เพิ่ม registry ในฐานข้อมูล เช่น `eoffice_file_versions` และ `eoffice_drive_jobs` เก็บ document/attachment identity, original/signed variant, logical revision, plaintext SHA-256, ciphertext SHA-256, ขนาด, key ID, Drive object/part IDs, สถานะ verification และสถานะ local copy

เพิ่ม run/manifest records เช่น `eoffice_backup_runs` เพื่อบอกว่างานแต่ละวันครบหรือยัง ข้อมูลอ้างอิงต้องอยู่ใน backup กู้คืนด้วยได้ กุญแจต้องมีสำเนาส่วนตัวแยกจาก ciphertext

## งานรายวัน

กำหนดเวลาเริ่มต้นที่เสนอ: 02:00 น. Asia/Bangkok บนโฮสต์ ไม่พึ่งเครื่องพีซีเปิดทิ้งไว้

1. สแกนและส่งไฟล์ใหม่/ไฟล์ที่เปลี่ยนขึ้น Drive แบบ incremental
2. บันทึก immutable version mapping และตรวจวัตถุที่อัปโหลด
3. สร้าง snapshot ฐานข้อมูลและ manifest ที่อ้างอิงเวอร์ชันไฟล์อย่างสอดคล้องกัน; ไม่ระบุ run ว่าครบหากยังมีไฟล์ใน snapshot ที่หาเวอร์ชัน verified ไม่ได้
4. ส่ง archive ฐานข้อมูลและ manifest เข้ารหัสขึ้น Drive และตรวจกลับ
5. แสดง success/failure, heartbeat, จำนวนไฟล์/bytes และ retry backlog ในหน้า Admin

ใช้ CLI worker ที่โฮสต์ผ่าน Cron ซึ่งทำงานเป็น batch สั้น ๆ และล็อกกันรันซ้อน Upload timeout ไม่ใช่หลักฐานว่าไฟล์ไม่ถูกสร้าง ต้องสอบถาม operation ID ก่อน retry

Retention เริ่มต้นที่เสนอ: daily DB/manifest 30 วัน และ monthly 12 เดือน วัตถุที่ active documents หรือ retained manifests ยังอ้างอิงอยู่ห้ามลบตามอายุ backup; ไม่ mirror การลบไฟล์บนเซิร์ฟเวอร์เป็นการลบบน Drive

## เปิดไฟล์ผ่าน E-Office

คง URL/ปุ่มเดิมโดยเพิ่ม file resolver ส่วนกลาง:

1. ตรวจ login และสิทธิ์เอกสาร/attachment ตามนโยบายเดิม รวมข้อกำหนดปัจจุบันของเอกสารสาธารณะ
2. เลือกไฟล์ variant/revision ที่ถูกต้องจาก registry
3. ถ้ามี local copy ที่ revision ตรง ใช้ local copy
4. หากไม่มี ดึง encrypted parts ผ่าน Apps Script ตรวจ ciphertext hashes และ authenticated decryption ทั้งไฟล์
5. ตรวจ permission และ revision อีกครั้งหลังการดึงที่อาจรอนาน ก่อนเผยแพร่ plaintext ให้ผู้ใช้
6. ให้บริการ PDF/download/HEAD และ HTTP Range ผ่าน E-Office โดยไม่ส่ง Drive credentials หรือเปิด public sharing

ใช้ cache ส่วนตัวนอก web root ซึ่งแยกจากโฟลเดอร์ original/e-sign และมีเพดานพื้นที่/TTL; cache key ต้องรวมเวอร์ชัน ถ้า Drive ติดต่อไม่ได้และไม่มี cache ให้แสดงข้อผิดพลาดชั่วคราว ไม่คืนไฟล์อื่นหรือ fallback ไป demo

ต้องปรับ `api/view_file.php`, จุดตรวจไฟล์ใน `e-sign/upload_pdf.php`, ตัวอ่าน PDF ใน `config/order-emails.php` และจุดแก้ไข/แทนที่เอกสารให้ใช้ registry/resolver ร่วมกัน

## ย้ายเอกสารเก่าและนำ local copy ออก

เฉพาะไฟล์ที่อายุผ่านเกณฑ์ปีและไม่ได้ติดงานแก้ไข/ลงนาม/วิเคราะห์ที่กำลังทำงาน:

1. อัปโหลดต้นฉบับและไฟล์ลงนามทุก variant ที่ใช้อยู่
2. ดาวน์โหลด ciphertext กลับ ถอดรหัสและตรวจ plaintext checksum เทียบต้นฉบับ
3. ยืนยันว่า file resolver เปิดเวอร์ชัน Drive ได้ และมี DB/registry recovery set ที่ verified
4. เริ่มช่วงเก็บสองฝั่ง 7–14 วันเป็นข้อเสนอสำหรับการ rollout
5. ภายใต้ document lock เดียวกับงานลงนาม ตรวจสิทธิ์สถานะ/version/hash อีกครั้งและนำ local copy ออกแบบ recoverable quarantine ก่อนเก็บกวาด
6. มีสถานะ `drive-only` เฉพาะเมื่อขั้นตอนสำเร็จ; เก็บประวัติและทำให้ retry หลัง worker crash ได้โดยไม่ลบไฟล์ผิดเวอร์ชัน

ไม่ลบแถวเอกสาร สิทธิ์ ผู้รับหรือประวัติ ระบบค้นหาและแสดงรายการต่อไปได้ ไฟล์ที่ใช้ร่วมหลายเอกสารต้องพิจารณาการอ้างอิงครบทุกเอกสารก่อนนำ local copy ออก

หากแก้ไข/ลงนามเอกสาร drive-only ให้ materialize เวอร์ชันปัจจุบันแบบส่วนตัว ตรวจ SHA-256 revision ภายใต้ lock แล้วบันทึกเวอร์ชันใหม่ให้เป็น local pending upload; เก็บเวอร์ชันเก่าบน Drive และยกเว้นจากการนำ local copy ออกจนงานใหม่ verified

## ลำดับ rollout และการตรวจรับ

1. รับ source Apps Script เดิมและสำรวจขนาดไฟล์ live แยกปี/variant พร้อมตรวจพื้นที่ Drive
2. เพิ่ม API authentication/idempotent encrypted-object storage และทดสอบด้วยข้อมูลสังเคราะห์
3. เปิด daily encrypted backups ก่อน พร้อมทดสอบ SQL + file recovery จาก Drive
4. เพิ่ม registry/resolver และทดสอบดู/ดาวน์โหลด/Range/ลงนาม/AI รวม permission revocation และ concurrent replacement
5. ทำ dry-run รายการเอกสารเก่าและขนาดพื้นที่ที่จะลด ทดลอง drive-only กลุ่มเล็ก
6. เปิด archive worker แบบ batch พร้อม cache sweep, dashboard และ failure alerts

กรณีตรวจรับสำคัญ: timeout หลังอัปโหลด, Apps Script quota เต็ม, Drive object ถูกย้ายเข้า Trash, ciphertext เสีย, ไม่มี key, การถอนสิทธิ์ระหว่าง fetch, การลงนามชนกับ archive, และการกู้คืน registry/manifest เมื่อเซิร์ฟเวอร์ใหม่ไม่มีไฟล์เดิม
