# ผลการแก้ไขและทดสอบ E-Office

## ตรวจรอบสุดท้ายก่อน commit ชุด AI/อีเมล — 15 ตุลาคม 2026

- รีวิว diff ครบทั้ง migration, Key vault/rotation, SMTP, policy holds, approval snapshot, UI และ regression tests ไม่พบข้อผิดพลาดใหม่ที่ยืนยันได้ในขอบเขตที่ตรวจ
- รัน `npm.cmd test` ซ้ำผ่านครบ: order **35 HTTP + 77 behavior = 112**, integration **44**, document races **12**, notifications **17**, syntax PHP **146**, JS/CJS **72**, inline **23** พร้อมชุดอื่นทั้งหมด
- รัน `npm.cmd run test:spa` ซ้ำผ่าน **43 กรณี**; ใช้ MySQL 3307, ฐาน QA `_test` และ mock services
- รอบนี้ไม่มีการแก้โค้ดเพิ่มเติมจากผลรีวิว ใช้ผลตรวจเพื่อเตรียม commit; ยังไม่ได้ deploy production

## แก้ policy-hold race และอนุมัติ PDF จาก cold Drive cache — 15 ตุลาคม 2026

- เพิ่ม `app_order_hold_for_policy()` ให้การอ่านนโยบายล่าสุดและเขียนเหตุผลพักงานเป็น transaction เดียว ใช้ lock order settings → job เหมือน Admin reconciliation; worker ไม่สามารถเขียน stale hold หลัง automatic-mode save ผ่านไปแล้ว
- เพิ่ม SQL-trigger/advisory-gate regression: หยุด worker ตอนเขียน awaiting_approval ให้ Admin save มาชน ยืนยันว่า save รอ settings lock แล้วคืนงานเข้าคิว จากนั้นส่งจบในรอบ worker ถัดไป
- แยกการอนุมัติเป็น `app_order_prepare_approval()` (เตรียม/กู้ cache โดยไม่มี SQL transaction) และ `app_order_approve_prepared()` (ตรวจใต้ document lock ด้วย settings/job current reads, review token และ hash ของ PDF ที่วิเคราะห์)
- ทดสอบ cold Drive จริงด้วย encrypted fixture/mocked transport: ดาวน์โหลดก่อน transaction, ไม่สร้าง original คืน, approve → queued สำเร็จ; รายชื่อและ PDF ที่เปลี่ยนหลังเตรียมถูกปฏิเสธ
- API จัดการ PDF/Drive failure แบบ structured 409/503 พร้อมปล่อย advisory lock รักษางานรออนุมัติไว้; เพิ่มข้อความ UI ขอให้ยืนยันใหม่ แทนข้อความว่าจะลองให้อัตโนมัติ
- `npm.cmd test` ผ่านครบ: order **35 HTTP + 77 behavior = 112**, integration **44**, document races **12**, notifications **17**, syntax PHP **146**, JS/CJS **72**, inline **23** และชุดอื่นใน npm test
- ใช้ฐาน disposable `_test`, synthetic files และ mock transports ไม่มีการส่ง SMTP/เรียก Gemini หรือ Drive จริง งานยังไม่ได้ commit หรือ deploy production

## แก้ 3 จุดจากรีวิว AI/Key — 15 ตุลาคม 2026

- ยืนยัน failing regression ก่อนแก้: เมื่อ Admin commit pause หลัง SMTP transaction เปิด snapshot แล้ว worker ยังส่งด้วยค่าเก่า ภายใต้ REPEATABLE READ
- แก้ final check เป็น current locking read (`LOCK IN SHARE MODE`) และยึด SMTP config/แม่แบบจาก settings row เดียวกัน ถือ share lock จนจบการส่งนั้น; ตรวจลำดับ lock ว่าระยะนี้ไม่ถือ job-row lock ซึ่ง Admin reconciliation ต้องอัปเดต
- เพิ่ม deterministic mock interleaving หลัง document/recipient reads ก่อน final check: pause, analysis-only, require-approval ต้องหยุด SMTP และคืนผู้รับเป็น pending; รอบถัดไปพักงานตามนโยบาย นอกจากนี้ยืนยัน settings writer รอระหว่าง delivery และทำต่อได้หลังปล่อย share lock
- แก้คืนคิวด้วยนโยบายปลายทางทุกครั้ง จึงไม่ค้างเมื่อเปลี่ยน review → analysis-only พร้อมปิด review → automatic; มี regression ตรวจทั้งกลับไป review และกลับไปส่งจนสำเร็จ
- บังคับ identity `key_server` เป็น 0 ป้องกัน request ที่แนบ vault ID เขียนผลทดสอบผิด Key; regression ยืนยัน tested_at/model/code ของ Key สำรองที่ไม่เคยทดสอบไม่เปลี่ยน
- `npm.cmd test` ผ่านครบหลังแก้: order **33 HTTP + 72 behavior = 105**, integration **44**, document races **12**, notification queue **17**, syntax PHP **146** / JS/CJS **72** / inline **23** พร้อมชุดอื่นทั้งหมด
- ทดสอบด้วยฐาน `_test` และ mock services ไม่มี SMTP/Gemini จริง งานยังอยู่ใน working tree ยังไม่ได้ commit หรือ deploy

## คลัง API Key และการหมุนเวียนกุญแจ — 15 ตุลาคม 2026

- เพิ่มคลัง Gemini หลาย Key (สูงสุด 50) ชื่อเรียก/รหัสสุ่ม สถานะพร้อมใช้/พักใช้ รอบเตือน 1–730 วัน และการลบ ciphertext โดยรักษาประวัติการใช้งาน
- ย้าย Key เดิมเข้าคลังแบบ idempotent โดยไม่ถอดรหัส; เก็บการเลือกเดิม ไม่สลับกลับ server เองเมื่อ Key ถูกพักใช้หรือถอดรหัสไม่ได้
- ทดสอบก่อนสลับตัวหลักทุกครั้ง ตรวจ revision/สิทธิ์ซ้ำหลัง remote test; ห้ามพักใช้/ลบตัวหลักจนกว่าจะสลับหรือหยุดใช้ มีปุ่มกลับไปใช้ GEMINI_API_KEY ของเซิร์ฟเวอร์แยกต่างหาก
- เพิ่ม health/usage แยกราย Key, แจ้งเตือนหมุนเวียนตามอายุ และอ่าน Key ใหม่ก่อนทุก PDF request แม้เป็นงานวิเคราะห์รอบเดิม ไม่มี automatic quota cycling
- เพิ่ม CLI `scripts/rotate-order-settings-key.php`: ต้องหยุดระบบและได้ worker lock, เข้ารหัสคลัง/API/SMTP ใหม่ทั้งชุดแบบ transaction พร้อม rollback ถ้ามี ciphertext ที่อ่านไม่ได้ ขั้นตอนสำรอง/เปลี่ยน env อยู่ใน ORDER_EMAILS.md
- `npm.cmd test` ผ่านครบหลังเพิ่มระบบคลัง; ชุด order ตรวจซ้ำล่าสุด **32 HTTP + 62 behavior**, UI **5**, Browser SPA **43**, syntax PHP **146**, JS/CJS **72**, inline **23**
- Browser mock จริงบนพอร์ตชั่วคราว 8202: เพิ่ม Key → ล้างช่อง secret → ทดสอบ/เลือกตัวหลัก → ปุ่มพักใช้/ลบหายสำหรับตัวหลัก → กลับ server → ลบ Key ผ่านครบ; mobile ไม่มี horizontal overflow และไม่มี console error/warning
- ทดสอบใช้ค่า synthetic และกุญแจเข้ารหัสชั่วคราวใน process; ลบ credential ทดลองแล้ว (`cipher=NULL`), คืนโหมด server/ปิด worker ตามเดิม และหยุดเซิร์ฟเวอร์ 8202 แล้ว เว็บ QA 8198 ยังเปิดอยู่ ไม่มีการเรียก Google/ส่งเมลจริง
- เพิ่ม regression สำหรับ rotation atomic rollback, migration ซ้ำ, key-specific usage, inactive-key fail-closed, key rotation ระหว่าง PDF, และ Admin pause ชนการ activate ซึ่งต้องได้ 409 และไม่เปิดระบบกลับ
- งานอยู่ใน working tree ยังไม่ได้ commit หรือ deploy production

## ตั้งค่า AI และอีเมลครบกระบวนการ — 15 ตุลาคม 2026

- เพิ่ม SMTP จาก server/Admin, STARTTLS/implicit TLS, ผู้ส่ง/Reply-To, รหัสผ่านเข้ารหัส, ตรวจการเชื่อมต่อและส่งเมลทดสอบ พร้อมผลผูกกับชุดค่าที่ทดสอบและ cooldown
- เพิ่มแม่แบบข้อความและ preview ด้วย safe text nodes, ทดลอง PDF สูงสุด 5 MB พร้อมรายชื่อที่จับคู่/ไม่มั่นใจ, นโยบายวิเคราะห์อย่างเดียวและรอตรวจผู้รับก่อนส่ง พร้อมปุ่มอนุมัติในหน้าติดตาม
- Approval ผูกกับ snapshot ของไฟล์/ผู้รับที่เจ้าหน้าที่เปิดดู และตรวจซ้ำก่อน SMTP; รายชื่อหรือไฟล์เปลี่ยนต้องตรวจใหม่ คงการป้องกันส่งซ้ำและสถานะ uncertain
- เพิ่ม Cron age/จบรอบ/จำนวนงาน, checklist ความพร้อม, ผู้แก้ไขและประวัติเปลี่ยนค่า/ทดสอบ, usage tokens 30 วันและราคาประเมินจากอัตราที่ Admin กรอก โดยไม่เปิดเผย secret/fingerprint ใน API
- `npm.cmd test` ผ่านครบ: syntax PHP **142**, JS/CJS **71**, inline **23**; order HTTP **30** + behavior **51**, integration **44**, document races **12**, notification queue **17** และชุดอื่นใน npm test
- `npm.cmd run test:spa` ผ่าน **43 กรณี**; ตรวจ browser เพิ่มที่ desktop/mobile 390px: ไม่มี horizontal overflow, save/discard ถูกต้อง, ประวัติผู้แก้ไขอัปเดต, preview ทำงาน และไม่มี console error/warning
- ใช้ MySQL loopback **3307**, ฐาน `eoffice_module_qa_20261009_test` และฐาน disposable ของ order tests พร้อม mock services; migrate ฐาน QA แล้ว ค่า sender ที่ทดลองใน browser คืนเป็น `E-Office` แล้ว ไม่มีการส่งเมลหรือเรียก Gemini จริงจาก QA
- Production ต้อง migrate ก่อนใช้งานตาม `ORDER_EMAILS.md`; รอบนี้เป็นการพัฒนาและทดสอบ local ยังไม่ได้ deploy หรือ commit

## วนรีวิวและแก้จนรอบตรวจสะอาด — 15 ตุลาคม 2026

- แก้ `tests/booking-edit-ui.cjs` ที่ยังตัด inline script/เรียก `fetchMyDocuments()` จาก HTML เก่า ให้รัน `email_send/my-dashboard.js` ปัจจุบันทั้งไฟล์ผ่าน public refresh hook และตรวจ DOM ที่ renderer สร้างจริง
- คง coverage ลิงก์ PDF ที่ root/`/eoffice/`, ชื่อไฟล์ที่ต้อง encode พร้อมตรวจ latest response, stale network failure และการรักษารายการเดิมเมื่อ background refresh ล้มเหลว
- พบและยืนยัน failing regression เพิ่ม: กดหน้าถัดไปแล้วอัปเดตระหว่างรอ เมื่อ refresh ล้มเหลว state เดิมนับ skeleton เป็นผลลัพธ์ที่เก็บไว้ จึงค้าง loading rows ทั้งที่ aria-busy จบแล้ว
- แก้ให้ยกเลิก `hasResult` เมื่อเปลี่ยนเนื้อหาเป็น skeleton; error/retry จึงแทนที่ loading rows อย่างถูกต้อง อัปเดต cache version สคริปต์แล้ว
- หลังแก้ Browser QA ผ่าน **41 กรณี** และ `npm.cmd test` ผ่านครบ รวม integration **44**, document/session races **12**, order HTTP **26**, syntax PHP **140**, JS/CJS **67**, inline **24**; ใช้ฐาน QA และ mock services
- รีวิวซ้ำหลังแก้ไม่พบบั๊กเพิ่มเติมในขอบเขตที่ตรวจ จบลูปตามคำสั่ง งานยังอยู่ใน working tree และเปิด QA server 8198 ไว้สำหรับทดลอง

## แก้ late booking save และลิงก์ PDF ใต้ subdirectory — 15 ตุลาคม 2026

- เปิดเว็บทดลอง `http://localhost:8198/` ด้วยฐาน `eoffice_module_qa_20261009_test` และ mock services
- หน้าแก้ไขการจองจับ generation/revision/field snapshot ก่อนส่ง ปิดและล้างเฉพาะฟอร์มชุดที่บันทึกจริง จึงรักษาค่าที่แก้เพิ่มหรือฟอร์มรายการอื่นที่เปิดระหว่างรอ; ป้องกัน submit ซ้ำ ตรวจ HTTP success และรักษาตัวกรองตารางหลังบันทึก
- ป้องกัน timer ปิด modal เก่า reset ฟอร์มที่เปิดใหม่ และแจ้ง shared form guard เมื่อเปิด snapshot ใหม่หรือบันทึกสำเร็จ
- ลิงก์ PDF ที่สร้างในหน้าประวัติคำสั่งใช้ `new URL(..., document.baseURI)` จึงอ้างอิง URL ของโมดูลได้ทั้ง standalone และ same-document host รวม installation ใต้ subdirectory
- เพิ่ม `tests/booking-edit-ui.cjs` ใน `npm test`/`test:modules`: success, rejected/HTTP-failed responses, duplicate submit, later/silent/same-text edits, reopened form, stale close timer และ renderer PDF จริงที่ root/`/eoffice/` พร้อมชื่อไฟล์ที่ต้อง encode
- Browser QA ผ่าน **40 กรณี** รวม late edit success ขณะซ่อนโมดูลและกลับมาแก้ต่อ; `npm.cmd test` ผ่านครบ รวม integration **44**, races **12**, syntax PHP **140**, JS/CJS **66**, inline **25**

## วนรีวิว → แก้ → ตรวจซ้ำก่อนปิดเครื่อง — 15 ตุลาคม 2026

- รีวิวชุด same-document navigation, loading, modal lifecycle และ recipient save รวมการ refresh ของโมดูลรายการ
- พบเพิ่ม 1 จุดใน `email_send/my_dashboard.html`: catch ของคำขอเก่าเปลี่ยนข้อความชื่อผู้ใช้ก่อนตรวจ request sequence ทำให้ network failure เก่าทับ identity จากคำขอใหม่ที่สำเร็จแล้ว
- เพิ่ม browser regression ที่ปล่อยคำขอใหม่สำเร็จก่อน reject คำขอเก่า ยืนยัน fail ก่อนแก้ แล้วเลื่อน sequence guard ให้อยู่ก่อนการเปลี่ยน UI ทุกจุดใน catch
- หลังแก้ Browser QA ผ่าน **39 กรณี** และ `npm.cmd test` ผ่านทุกชุด รวม integration **44**, document/session races **12**, syntax PHP **140**, JS/CJS **65**, inline **25**; ใช้ฐาน QA เดิมและ mock services
- รีวิวหลังแก้ไม่พบบั๊กเพิ่มเติมในขอบเขตที่ตรวจ งานบันทึกอยู่ใน working tree ยังไม่ได้ commit/push หรือ deploy production

## แก้ overlay, ผู้รับอีเมล และ guest loading — 15 ตุลาคม 2026

- ปิด export overlay และรายละเอียดเอกสารผ่าน cleanup กลางเมื่อเปลี่ยน view รวม Back กลับเข้าโมดูล จึงไม่ค้างทับพื้นที่งานใหม่
- รายละเอียดอีเมลที่ถูกพักใช้ค่าจาก input ใน cached DOM แทนสำเนาอีเมลก่อนพัก; successful save ล้างเฉพาะ snapshot ที่ generation/revision/value ยังตรงกับตอนส่ง จึงไม่คืนค่าที่บันทึกแล้วหรือทับค่าที่แก้เพิ่ม
- Guest ในแท็บคำสั่งสาธารณะยังเห็น table skeleton ระหว่างรอ API แทนการซ่อน loading เพราะไม่มี User_Token
- Browser QA ผ่าน **38 กรณี** รวม export overlay หลัง Back, guest API ที่หน่วง response และ pending recipient POST ระหว่างสลับหน้า ทั้งสำเร็จ ล้มเหลว และสำเร็จหลังแก้ค่าเพิ่ม โดยตรวจ dirty state ของค่าที่ยังค้างด้วย
- `npm.cmd test` ผ่านครบทุกชุด รวม integration **44**, document/session race regressions **12**, syntax PHP **140**, JS/CJS **65**, inline scripts **25**; ใช้ฐาน `eoffice_module_qa_20261009_test`, mock services และ signing port 8211 แยกจากเว็บ QA 8198
- อัปเดต cache version ของ `order-dashboard.js`; การทดสอบใช้ local QA ไม่ได้ deploy production

## แก้ไอคอนและตำแหน่งห้องประชุม — 14 ตุลาคม 2026

- เพิ่ม failing browser assertion ยืนยันว่าปุ่มแก้ไข/พิมพ์ในรายการจองเป็นปุ่มสีที่ไม่มี glyph แสดง ก่อนแก้
- เปลี่ยน icon fonts ของสองหน้าจองห้องเป็น SVG ใน `assets/booking-icons.js` ภายในโมดูล จึงไม่พึ่ง CSS/ฟอนต์ Phosphor หรือ Font Awesome ที่ไม่ข้าม Shadow DOM; รองรับทั้ง markup เดิม แถวตารางใหม่ และการเปลี่ยนไอคอน toast ขณะใช้งาน
- เพิ่ม aria-label ให้ปุ่มแก้ไขและพิมพ์ และ disconnect icon observer เมื่อ dispose context
- ปรับ preview ห้องสารภี/กันเกราเป็น **อาคาร 3** และห้องโสตทัศนศึกษาเป็น **อาคาร 5**
- Browser QA ผ่าน **36 กรณี** รวมขนาด SVG ของปุ่มจัดการ การเปิด modal แก้ไข ไอคอนหัวข้อ/preview การเปลี่ยน toast และตำแหน่งอาคารครบ 3 ห้อง พร้อมตรวจ screenshot จริง
- `test:modules`, `test:syntax` และ `git diff --check` ผ่าน; syntax PHP **140**, JS/CJS **65**, inline **25**; ไม่เปลี่ยน API หรือข้อมูล booking ใน production

## เพิ่ม skeleton loading ตอนเปลี่ยนหน้า — 14 ตุลาคม 2026

- เพิ่ม `assets/page-loading.js` และ CSS shimmer กลางสำหรับพื้นที่เนื้อหาโมดูล/รายการเอกสาร โดย sidebar และ document เดิมคงอยู่
- แสดง skeleton ระหว่างโหลด HTML/scripts และ refresh ของ cached module; เตรียมข้อมูลขณะที่ DOM เดิมยังซ่อนอยู่ แล้วค่อย activate/resume modal หลังข้อมูลพร้อม เพื่อไม่ทับฟอร์มหรือแสดงรายการเก่าระหว่างรอ
- Document APIs ทั้ง 4 เส้นทางใช้ table skeleton และ aria-busy; ซ่อนตาราง/เลขหน้าเดิมชั่วคราว และจบ loading เฉพาะ response sequence ปัจจุบัน
- เพิ่มการตรวจ browser แบบหน่วง HTML/API: cold navigation, cached refresh, สลับหน้าเร็วพร้อม late response, document table loading, error/retry, mobile overflow และ prefers-reduced-motion
- `npm.cmd run test:spa` ผ่าน **35 กรณี**, `test:modules`, `test:syntax` และ `git diff --check` ผ่าน; syntax PHP **140**, JS/CJS **64**, inline **25** พร้อมตรวจ screenshot skeleton จริง
- ไม่มี delay ขั้นต่ำเพื่อบังคับให้ผู้ใช้รอ: หน้าที่ข้อมูลพร้อมทันทีอาจไม่เห็น animation ขณะหน้าที่ยังโหลดจะแสดง skeleton จนพร้อม

## แก้ controls งานเอกสารค้างเหนือโมดูล — 14 ตุลาคม 2026

- เพิ่ม failing browser assertion ยืนยันว่าเข้าหน้าจัดการสมาชิกหลังทะเบียนหนังสือรับแล้ว `main-content-area` และ `doc_type_div` ยังแสดงอยู่
- เมื่อเข้าโมดูล ซ่อนและตั้ง inert ทั้งกรอบ `main-content-area` พร้อม content mode ของ main_div และ CSS guard จึงครอบคลุมแถบหนังสือ/คำสั่ง/ประทับตรา สถานะอ่าน ค้นหา รายงาน และส่วนควบคุมเอกสารทั้งหมด
- เมื่อกลับแท็บเอกสาร คืนกรอบและการรับ input แล้วให้ document renderer เดิมเลือก controls ตาม view; ยืนยันว่าทะเบียนแสดงแถบประเภท แต่คำสั่งสาธารณะ/หนังสือส่งถึงไม่แสดงแถบดังกล่าว
- Browser QA เริ่มจากทะเบียนที่เปิดแถบประเภทอยู่แล้ว ตรวจทั้ง 11 โมดูลว่าไม่มี document-only UI ปรากฏ รวมอยู่ในชุด **32 กรณีผ่าน**; modules/syntax และ `git diff --check` ผ่าน

## แก้ lifecycle ตามผลรีวิว same-document router — 14 ตุลาคม 2026

- เพิ่ม browser regression ของทั้ง 4 ประเด็น และยืนยัน failing case ของ cache ที่ยัง inert หลังสลับหน้าระหว่าง session pending ก่อนแก้
- `activate()` ปลด inert หลังตรวจบัญชี/สิทธิ์ล่าสุด จึงกลับมา focus/input/click หน้าเดิมได้แม้พักหน้าระหว่างตรวจ session
- เพิ่ม refresh hooks ในโมดูลรายการ โดยโหลดครั้งแรก/กลับหน้าและเมื่อมี write สำเร็จจากอีกโมดูล รักษาฟอร์ม/ตัวกรองเดิม เพิ่ม request revision guards ป้องกันผลอ่านเก่าย้อนทับผลใหม่
- ตรวจ fingerprint ของบัญชี/ระดับ/สิทธิ์: cache ของหน้าที่ขึ้นกับสิทธิ์จะไม่กลับมาแสดงข้อมูลแบบผู้ดูแลเดิมหลังลดสิทธิ์; สร้าง context ใหม่ตามสิทธิ์ปัจจุบัน และให้ยืนยันก่อนทิ้งฟอร์มค้าง ส่วน create drafts ที่ไม่ขึ้นกับสิทธิ์ดูแลงานยังเป็น DOM/ข้อมูลชุดเดิม
- ปิด native dialogs ก่อนพัก/ซ่อน/ระงับโมดูล รวม popup ที่โมดูลเป็นเจ้าของ; เก็บ dirty ของฟอร์มที่ถูกพัก และ resume รายละเอียดอีเมลพร้อมอีเมลผู้รับที่ยังไม่ส่ง โดย explicit close ยังทิ้ง warning ได้ตามปกติ
- `npm.cmd run test:spa` ผ่าน **32 กรณี** รวม late-save refresh ของ dashboard ที่เปิดอยู่, modal Back/pending/resume, ยกเลิก/ยืนยัน reload หลังลดสิทธิ์ และร่างที่คงอยู่ กรณี role/read fixtures ใช้ response จำลองใน browser ส่วนการสร้างข้อมูล workflow หลักใช้ local QA APIs
- `npm.cmd test` ผ่านครบทุกชุด รวม integration **44**, race regressions **12**, PHP syntax **140**, JS/CJS **63**, inline scripts **25**; ใช้ฐาน QA และ mock services พร้อม signing ports 8211 แยกจากเว็บ QA 8198

## เปลี่ยนโมดูลเป็น same-document navigation — 14 ตุลาคม 2026

- เพิ่ม `assets/module-router.js` และเชื่อม `showView()` ให้โหลดโมดูลในพื้นที่กลางของ index โดยไม่เปลี่ยน document/sidebar และไม่สร้าง iframe
- แยก CSS/IDs ด้วย Shadow DOM และรันสคริปต์ใน module closure/window/document facade; resolve fetch/assets ตาม URL โมดูลเดิม รองรับ DOMContentLoaded/load และ inline handlers ของเนื้อหาที่สร้างทีหลัง
- เก็บ module DOM/context ไว้เมื่อสลับหน้า จึงรักษาฟอร์ม/ไฟล์และไม่ติดตั้ง handlers ซ้ำ; interval หยุดทำงานเมื่อไม่ active, failed mount cleanup และ retry โหลดหน้าได้
- รวม dirty guards ของ cached forms สำหรับก่อน reload/logout; ระหว่าง session pending รักษา geometry ของโมดูลไว้แต่ตั้ง inert, หากตรวจบัญชี/สิทธิ์ใช้ไม่ได้หรือสลับบัญชีจึงซ่อน private content และไม่ปล่อย cached owner เดิม POST ต่อ
- Direct/bookmarked module URL นำเข้า `index.php?view=...`; Back/Forward, เมนูมือถือ และ document tabs ใช้ shell เดิม
- เพิ่ม `npm.cmd run test:spa` เป็น opt-in Chrome QA กับ local mock server: **26 กรณีผ่าน** รวม 11 โมดูล, DOM/sidebar identity, ไม่มี iframe, cached fields, API writes ของเอกสาร/สมาชิก/กลุ่ม/จองเลข/ห้อง/แจ้งซ่อม, dynamic inline calendar, history/rapid routes, drawer, modal focus trap, pending-session inert, dirty-exit, failed fetch retry และ account-switch rejection โดยไม่มี uncaught exceptions
- ปรับการใช้ Tailwind build ใน shadow ให้สอดคล้องกับ utility cascade ของหน้าเดิม และเพิ่ม browser assertion ป้องกัน global reset ของโมดูลทับ spacing utilities; ตรวจ screenshot จองเลขคำสั่ง/ปฏิทินจริงแล้ว
- `npm.cmd test` ผ่านครบทุกชุด รวม integration **44**, race regressions **12**, syntax PHP **140**, JS/CJS **63**, inline **25**; หลังปรับ active menu, callback binding, focus/scroll และ CSS cascade รัน browser QA ซ้ำผ่าน 26 กรณี พร้อม modules/syntax ผ่าน
- ใช้ฐาน `eoffice_module_qa_20261009_test`, mock services และ signing test ports เริ่ม 8211 เพื่อไม่ชน local QA server 8198; ไม่ deploy production

## ลด layout flash ตอนเปิดหน้าโมดูล — 14 ตุลาคม 2026

- ทั้ง 11 หน้าโหลด `app-navigation.css` และ `sidebar.css` ใน head พร้อม body class และ content/view wrapper ตั้งแต่ HTML เริ่มต้น
- ย้าย navigation script มาทำงานแบบ parser-blocking ต้น body ก่อนเนื้อหาโมดูล; reuse wrapper เดิมและไม่เพิ่ม stylesheet ซ้ำ โดยคง fallback สำหรับ markup เดิม
- จองพื้นที่ header 64px บนมือถือ/sidebar 256px บน desktop ระหว่างรอ shell script และถอด placeholder เมื่อ shell พร้อม ไม่ใช้การซ่อนหรือ fade ทั้งหน้า
- Regression ตรวจตำแหน่ง CSS/script/wrappers, ใช้ DOM/input nodes เดิม, ไม่มี stylesheet ซ้ำ และ session initialization ผ่าน
- Browser QA เทียบ 11 โมดูลกับหน้าหลักที่ 1440px/390px ผ่าน **22 กรณี** พร้อม drawer Escape/inert checks
- หน่วง network request ของ navigation script จริง: desktop content อยู่ที่ x=256,y=0 และ mobile x=0,y=64 ทั้งก่อน/หลัง script; ไม่เห็น form ก่อน shell script, wrapper เป็น node เดิม และ stylesheet มีชุดเดียว
- หลังย้าย script ทดสอบส่งใบแจ้งซ่อมและจองสถานที่ผ่านฟอร์มจริงด้วย local QA สำเร็จ; `test:modules`, `test:syntax` และ `git diff --check` ผ่าน
- เป็นการลด flash จาก layout/CSS ที่มาช้า การเปิดหน้า HTML ใหม่ยังเป็น full-document navigation

## รวมดีไซน์ sidebar หน้าหลักและโมดูล — 14 ตุลาคม 2026

- เพิ่ม `assets/sidebar.css` เป็นกติกาดีไซน์กลางของ sidebar ทั้งสองแบบ และนำกติกาที่ซ้ำออกจาก `app-navigation.css`
- ใช้ Prompt, ความกว้าง 256px, padding 16px/12px, แถวเมนู 48px, สี active และ scrollbar เดียวกัน พร้อมจัด identity/group/footer ให้ตำแหน่งตรงกัน
- ปรับ SVG ของโมดูลให้ตรงกับหน้าหลัก รวมไอคอน login/logout และเพิ่มเมนูขอใช้สถานที่/ตั้งค่า AI บนหน้าหลักให้สอดคล้องกับโมดูล โดยคงการตรวจสิทธิ์ Admin สำหรับ AI
- ตรวจผ่าน Chrome แยกสำหรับ QA: 11 หน้าโมดูลเทียบหน้าหลักที่ 1440px และ 390px รวม **22 กรณีผ่าน** โดย assert computed styles/geometry ของ sidebar, identity, group headings, ลำดับ/ชื่อ/ไอคอน/ขนาดเมนูตรงกัน พร้อมตรวจ Escape และ content inert ของ drawer บนมือถือ
- ตรวจบัญชี QA owner บนหน้าหลัก/จองเลขคำสั่ง/แจ้งซ่อม/หน้า AI ว่า typography และ scrollbar ตรงกัน; การตรวจ 22 กรณีใช้บัญชี QA Admin
- `npm.cmd run test:modules` และ `npm.cmd run test:syntax` ผ่าน; ไม่แก้ API และไม่ deploy production ในรอบนี้

## ตรวจซ้ำก่อน commit — 13 ตุลาคม 2026

- รีวิวแพตช์ dirty lifecycle ล่าสุด ไม่พบข้อบกพร่องที่ยืนยันได้เพิ่มเติมในขอบเขตที่ตรวจ
- รัน `npm.cmd test` ผ่านครบทุกชุดหลังแก้หน้าแจ้งซ่อมฝ่ายงาน รวม regression ใหม่, integration **44**, document/session races **12**, syntax PHP **140**, JS/CJS **61**, inline scripts **25**
- ใช้ฐาน `eoffice_module_qa_20261009_test` โดยกำหนดทั้ง `DB_DATABASE` และ `TEST_DATABASE` พร้อม mock services; เริ่ม MySQL ที่ 3307 ชั่วคราวและหยุดคืนหลังตรวจ

## แก้ dirty lifecycle ของหน้าแจ้งซ่อมฝ่ายงาน — 13 ตุลาคม 2026

- เพิ่ม failing regression ยืนยันว่าลบวัสดุเดิมแล้วไม่มีสัญญาณ dirty ก่อนแก้
- การเพิ่ม/ลบวัสดุโดยผู้ใช้ส่ง `eoffice:form-dirty`; การเติมวัสดุตอนเปิด snapshot ไม่ถูกนับเป็นการแก้
- เปิด snapshot ใหม่และบันทึกสำเร็จส่ง `eoffice:form-saved` จึงไม่เตือนข้อมูลเก่าหลังเปิดฟอร์มอีกครั้ง
- ตรวจ revision/generation/snapshot ก่อนล้าง dirty และปิด modal; ผล save เก่าไม่ปิดฟอร์มที่แก้เพิ่มหรือเปิดใหม่ พร้อมป้องกัน submit ซ้ำและตรวจ HTTP success
- เพิ่ม `tests/maintenance-admin-ui.cjs` ใน `npm test` และ `test:modules` ครอบคลุมวัสดุ, successful/rejected/HTTP-failed saves, duplicate submit, later/silent edits และ reopened forms
- Browser ใช้ API จำลอง: เปิดฟอร์มไม่เตือน, เพิ่ม/ลบวัสดุเตือน, save สำเร็จแล้วเปิดใหม่ไม่เตือน และข้อความที่แก้ระหว่าง save ยังคงอยู่พร้อม modal เปิดและคำเตือน
- `npm.cmd run test:modules`, `npm.cmd run test:syntax` และ `git diff --check` ผ่าน; syntax PHP **140**, JS/CJS **61**, inline scripts **25** รอบแก้นี้ใช้ focused UI tests ไม่ได้รัน API/MySQL เต็มซ้ำจากรอบรีวิวก่อนหน้า

## อัปเดต date bounds เมื่อหน้าจองค้างข้ามวัน — 13 ตุลาคม 2026

- เพิ่ม refresh min ของ startDate/endDate เมื่อ focus, pageshow/BFCache, visibilitychange กลับมาเห็นหน้า และ input/focus ช่องวันที่
- ตรวจ bounds และ native validity ซ้ำก่อน submit รวม direct booking handlers จึงไม่ส่งวันเก่าถ้าหน้าเปิดค้างข้ามเที่ยงคืน แม้ไม่มี focus event ก่อนส่ง
- เปลี่ยนเฉพาะ min ไม่ทับ value ที่ผู้ใช้เลือกหรือกู้จากร่าง วันที่เก่าจะกลายเป็น invalid และรายงานให้ผู้ใช้แก้เอง
- Browser จำลอง 13 ต.ค. 23:59 → 14 ต.ค. 00:01: min เปลี่ยนเป็น **2026-10-14**, value เดิม **2026-10-13** ยังอยู่, validation false และ POST **0**; ก่อน submit ข้ามไปวันที่ 15 ก็ยังป้องกันได้ และแก้วันถูกต้องแล้ว POST สำเร็จ **1**
- เพิ่ม regression ของ document เดิมที่เปลี่ยนวันสำหรับ focus/pageshow/visibility/input/submit; `npm.cmd test` ผ่านทุกชุด รวม integration **44**, race regressions **12**, PHP syntax **140**, JS/CJS **60**, inline scripts **25** และ `git diff --check` ผ่าน

## แก้วันที่ไทยและเวลาจองข้ามเที่ยงคืน — 12 ตุลาคม 2026

- เพิ่ม `assets/form-dates.js` ใช้ Intl/Asia/Bangkok/ปฏิทิน Gregorian สำหรับวันที่เริ่มต้นและ min รวมวันที่แจ้งซ่อมหลังบันทึกสำเร็จและ reset จึงไม่ใช้วันที่ UTC ของวันก่อนหน้าในช่วง 00:00–06:59 ไทย
- การบวก 1 ชั่วโมงคำนวณ date-only แบบ UTC arithmetic แล้วเลื่อนวันสิ้นสุดเมื่อข้ามเที่ยงคืน รวมข้ามเดือน/ปีและ leap day
- ติดตั้ง listeners เพียงครั้งเดียว รักษา end date/time ที่ผู้ใช้กรอกเองหรือกู้จากร่าง และ reset ล้างสถานะข้อเสนออัตโนมัติ
- กันการเสนอเวลาใหม่ก่อน draft initialized และคำนวณเมื่อกู้ fields ครบ เพื่อไม่ให้ end date อัตโนมัติไปทับวันที่จาก baseline เดิม; legacy display-name cookie ที่ decode ไม่ได้ไม่ทำให้ initialization หยุด
- Browser จำลอง 13 ต.ค. 2026 เวลา 00:30 ไทย: start/end/min เป็น **2026-10-13**; เริ่ม **23:30** ได้สิ้นสุด **2026-10-14 00:30** และ POST ช่วงเวลาที่ถูกต้องโดยไม่มี validation alert
- Browser แจ้งซ่อมยืนยันว่าวันเริ่มต้นและวันหลัง successful reset เป็น **2026-10-13** เช่นกัน
- เพิ่ม `tests/form-dates.cjs` ใน test:modules และ npm test; `npm.cmd test` ผ่านทุกชุด รวม integration **44**, race regressions **12**, PHP syntax **140**, JS/CJS **60**, inline scripts **25** และ `git diff --check` ผ่าน

## รีวิวและแก้ queued create/session revoke + image retry — 12 ตุลาคม 2026

- เพิ่ม failing regression และแก้กรณี FileReader error ถูกล้างโดยการเลือกไฟล์ผิดชนิด/เกินขนาด ทำให้ส่งโดยไม่มีภาพที่ตั้งใจแนบได้ ตอนนี้เฉพาะการเลือกไฟล์ที่ยอมรับได้หรือ reset จึงปลด error
- เพิ่ม tests ที่รอ table metadata lock จริง แล้ว revoke session ก่อนปล่อย lock ยืนยันว่าเดิม API แจ้งซ่อมยัง INSERT สำเร็จ 200
- แก้ create transaction ของแจ้งซ่อม/จองสถานที่: รับ metadata lock ก่อนล็อก user/session ตรวจบัญชีล่าสุด และถือ share locks ผ่าน INSERT/commit; session ที่ revoked ระหว่าง queue ได้ 401 และไม่สร้างแถวใหม่ ทั้ง guarded และ legacy authenticated requests
- ผิดพลาดระหว่างเตรียม environment: CLI migration ครั้งหนึ่งชี้ฐานเริ่มต้น document2 เพราะไม่ได้กำหนด DB_DATABASE แม้มี TEST_DATABASE อยู่ ยืนยันผู้ใช้ให้สำรองและย้อนเฉพาะส่วนที่เพิ่มแล้ว
- Backup ก่อนย้อน: `C:\Users\arm_m\AppData\Local\Temp\opencode\document2-before-migration-revert-20261012-220547.sql` (private, ไม่อยู่ใน Git) ตรวจเวลา create/จำนวนแถว/route defaults ก่อนลบ 8 ตารางที่เพิ่มใหม่, managed-sign-routes marker, sign-routes-lock counter และ index ที่เพิ่มบน outbox โดยรักษาตาราง outbox เดิม
- ตรวจ checksum ก่อน/หลังของตารางเดิม **22 ตาราง** ตรงกัน จึงไม่มีการ restore ทับข้อมูลเดิมของฐาน document2
- เพิ่ม `scripts/migrate.php --test` ที่ตรวจ suffix `_test` และ mock services; หากมี TEST_DATABASE แต่ไม่มี DB_DATABASE แล้วไม่ใช้ --test จะปฏิเสธก่อนเข้าฐาน เพื่อกัน fallback ผิดฐานซ้ำ
- MySQL เดิมหยุดอยู่ เริ่มชั่วคราวที่ 3307; ฐาน QA เดิมไม่มีใน instance นี้ จึงสร้างใหม่จาก schema-only ของ eoffice_review_test (ก่อน seed ผู้ใช้ 0 แถว) การ seed/HTTP race tests หลังเตรียมฐานใช้เฉพาะ eoffice_module_qa_20261009_test
- `npm.cmd test` รอบล่าสุดผ่านทั้งหมด: PHP syntax **140**, JS/CJS **58**, inline scripts **25**, integration **44**, document/session race regressions **12** รวม migration CLI guard และชุดอื่นทั้งหมด; `git diff --check` ผ่าน

## รีวิวและแก้ metadata storage failure + API owner binding — 10 ตุลาคม 2026

- เพิ่ม failing regressions และแก้กรณี editor/version metadata เขียนไม่ได้ชั่วคราวแล้วถูกตีความว่าเป็นหน้าเก่า จนบันทึกลง API ไม่ได้
- แยกสิทธิ์ใช้งานในหน่วยความจำกับสิทธิ์เขียน/ลบร่างที่ persist แล้ว: หน้า active บันทึกลง API ได้เมื่อ baseline ยังไม่ถูกแทนที่ แต่ไม่ทับร่างของ editor เดิมก่อนยืนยันผลสำเร็จ
- Receipt ที่ persist ได้ทำหน้าที่เป็น editor/version handoff เมื่อ slot ปกติยัง read-only; reset ล้างข้อความที่ส่งไปแต่รักษา handoff จน slot ปกติเขียนได้
- เพิ่ม regression delayed receipt หลังมี editor ใหม่แล้ว เพื่อกัน handoff ของ response เก่าแย่ง slot/reset ร่างล่าสุด และกัน older version handoff ทับเวอร์ชันปัจจุบัน
- Browser จำลอง QuotaExceededError เฉพาะ editor slot: ร่างเดิมไม่ถูกทับก่อนส่ง แต่ POST สำเร็จและฟอร์ม reset ได้ พร้อม metadata-only handoff ที่กัน editor เก่า
- เพิ่ม `_expected_owner` ในคำขอของฟอร์มใหม่ และตรวจเทียบ session จริงบน server ก่อนเขียนข้อมูล; ยืนยัน failing HTTP test ว่าเดิม wrong-owner request ถูกบันทึก 200 แล้วแก้ให้เป็น 409, unverified session เป็น 401 และค่า owner ผิดชนิดเป็น 400
- ตรวจบัญชีซ้ำหลัง slow upload/room lock สำหรับ guarded requests; client กระตุ้น session refresh เมื่อได้ 401/owner mismatch
- `npm.cmd test` รอบล่าสุดผ่านทุกชุด รวม integration **44**, PHP syntax **139**, JS/CJS **58**, inline scripts **25**, และ `git diff --check` ผ่าน

## รีวิวและแก้ input ก่อน deferred draft script พร้อม — 10 ตุลาคม 2026

- เพิ่ม failing regression และแก้กรณีข้อความที่พิมพ์หลัง lifecycle พร้อมแต่ก่อน module-drafts โหลด ถูกค่าร่างเก่าทับ โดยส่งต่อ per-field early edits/conditional clears/radio peers ให้ draft consumer และรักษาช่องที่ยังไม่แตะจาก baseline เดิม
- ส่งต่อ dirty state พร้อมสัญญาณ replay จึงเตือนก่อนออกแม้แก้ตั้งแต่ช่วงเริ่มหน้า แต่ไม่ยกเลิกคำอนุมัติออกจากหน้าที่ผู้ใช้ยืนยันไปแล้ว
- Draft consumer ที่โหลดหลังการสลับบัญชี 7 → 8 → 7 รับ historical owner conflict จาก boundary ร่วม ไม่เขียน buffered text ข้ามบัญชีลง storage
- Fieldset เริ่ม disabled จน lifecycle ติดตั้ง listeners และปุ่มส่งเริ่ม disabled จน handlers พร้อม; early native submit ถูกยกเลิกจน draft initialized หรือมีสถานะ storage unavailable ที่แจ้งแล้ว เพื่อไม่ fall through เป็น GET ก่อน DOMContentLoaded
- ภาพที่เลือกก่อน handlers พร้อมถูกส่งต่อให้ FileReader หลัง DOMContentLoaded ไม่หายจาก payload
- Browser จำลอง draft script ที่มาช้า: ข้อความใหม่ยังอยู่ ช่อง department ที่ไม่แก้กู้ค่าร่างเดิม early beforeunload เตือนและ submit ถูกยกเลิก; ตรวจ normal save หลังเพิ่ม bootstrap fieldset ผ่าน
- เพิ่ม regressions early text/untouched fields/dirty replay/submit, historical owner conflict, bootstrap controls และ early file selection; `npm.cmd test` รอบล่าสุดผ่านทั้งหมด รวม integration **43**, PHP syntax **139**, JS/CJS **58**, inline scripts **25** และ `git diff --check` ผ่าน

## รีวิวและแก้สิทธิ์เจ้าของหน้าแก้ไขร่าง — 10 ตุลาคม 2026

- ยืนยัน failing regression ว่าการเปิดหน้าใหม่ตามปกติใช้ draft version เดิม ทำให้หน้าที่กลับจาก cache autosave ข้อความเก่าทับร่างล่าสุดได้
- แยก editor identity ออกจาก logical draft version: ทุกหน้าแก้ไขที่ตรวจบัญชีแล้วรับ editor slot ใหม่ หน้าที่เก่าไม่สามารถ autosave/reset/POST หรือ reset หลัง save ทับข้อมูลของ editor ล่าสุด
- คง commit marker ของ request เดิมไว้สำหรับกันส่งซ้ำ แต่ response ของ editor เก่าไม่ทับ marker ที่ editor ใหม่เขียนแล้ว; อ่านค่าปัจจุบันจาก storage ก่อน cache ในหน่วยความจำ
- เมื่อ storage ถูกล้าง editor/version ที่เคย persist สำเร็จจะไม่ฟื้นจาก memory fallback; fallback ใช้เฉพาะกรณี storage อ่าน/เขียนไม่ได้จริง
- Browser จริงได้ `pageshow.persisted = true`: หน้า A กลับจาก BFCache หลังหน้า B แก้ร่างแล้ว ข้อความล่าสุดของ B ยังคงเดิมทั้งหลัง session refresh และ reset ของ A; หน้า A แจ้งให้ reload และสถานะ unavailable
- เพิ่ม regressions ordinary new editor, stale reset/submit, out-of-order commit markers และ cleared storage; `npm.cmd test` ผ่านครบทุกชุด รวม integration **43**, PHP syntax **139**, JS/CJS **58**, inline scripts **25**; `git diff --check` ผ่าน

## กันกู้คำขอที่บันทึกแล้วกลับมาส่งซ้ำหลัง reload — 10 ตุลาคม 2026

- เพิ่ม commit marker ใน sessionStorage แยกบัญชี/หน้า/form พร้อมลายเซ็นข้อมูลร่างและ draft version เมื่อได้รับ save success; ไม่เก็บ password, hidden controls หรือ file bytes
- เมื่อ reload และยืนยันบัญชีแล้ว จะไม่กู้เฉพาะร่าง version/ข้อมูลชุดที่บันทึกสำเร็จแล้ว ส่วนร่างใหม่ที่ยังไม่ส่งหรืออีกบัญชีไม่ถูกลบ
- Reset/เริ่มร่างใหม่ใช้ version ใหม่ แม้ข้อความเหมือนคำขอเดิมก็เป็นคนละร่าง; หน้าที่เก่าหรือถูกคืนจาก cache ไม่สามารถเขียนทับ/reset ร่างใหม่กว่าได้
- เพิ่มปุ่มล้างฟอร์มแจ้งซ่อมเพื่อเริ่มคำขอใหม่ และรองรับ reset ก่อนสคริปต์ร่างพร้อม; หากเก็บ commit marker ไม่ได้จะแจ้งให้ตรวจรายการก่อน reload/ส่งซ้ำ
- Browser API จำลองผ่านทั้งแจ้งซ่อมและจองสถานที่: save success + session 503 → reload → กดส่งอีกครั้ง จำนวน POST ยังคง **1** และร่างที่ completed ไม่ถูกกู้กลับ
- Regression tests ผ่านกรณี newer/identical drafts, different account, stale editor/reset, reload, secret/file exclusions รวมชุดเดิม; `npm.cmd test` ผ่านทุกชุด (integration **43**, PHP syntax **139**, JS/CJS **58**, inline scripts **25**), `git diff --check` ผ่าน

## รักษา committed receipt เมื่อการตรวจ session ล้มเหลว — 10 ตุลาคม 2026

- หลังได้รับ save success เก็บ result/receipt ในหน่วยความจำของหน้าและคงสถานะ busy ระหว่าง session pending/unavailable/guest ไม่เปิดทางส่ง create ชุดเดิมซ้ำ
- แสดงข้อความสถานะว่าบันทึกสำเร็จแล้วและกำลังรอยืนยันบัญชีเดิม เมื่อยืนยันได้จะซิงก์ doc ID/file version หรือ reset ตาม snapshot เดิมเพียงครั้งเดียว
- reset/ยืนยันทิ้ง/เปิดฟอร์มใหม่และ account conflict ยกเลิกการใช้ receipt เก่า พร้อมถอด listeners/ข้อความสถานะ; การแก้ข้อความใหม่ยังคง dirty และไม่ถูกทับ
- ใช้ callback ซิงก์/reset ในจังหวะเดียวกับการตรวจ owner/generation ครั้งสุดท้าย เพื่อกัน session check ใหม่ที่แทรกระหว่าง microtasks ทำให้ทิ้งผล save หรือใช้ข้อมูลกับบัญชีผิด
- Browser API จำลองยืนยัน: save success + me 503 ส่ง create เพียง **1 ครั้ง** ระหว่างรอ; เมื่อบัญชีเดิมกลับมา ฟอร์มเอกสารรับ ID 99 และ POST ถัดไปเป็น edit_document ส่วนแจ้งซ่อม reset หลัง recovery โดยไม่มี POST ซ้ำ
- เพิ่ม regressions ของ repeated failure/guest/recovery, late edits, different owner, reset/discard และ intervening verification; `npm.cmd test` ผ่านครบทุกชุด รวม integration **43**, syntax PHP **139**, JS/CJS **57**, inline scripts **25** และ `git diff --check` ผ่าน

## ผูกฟอร์มกับเจ้าของและล็อก account conflict — 10 ตุลาคม 2026

- เพิ่ม owner boundary ร่วมสำหรับฟอร์มเอกสาร แจ้งซ่อม และจองสถานที่ โดยจำบัญชีแรกและประวัติการเปลี่ยนบัญชี เมื่อเปลี่ยนเป็นบัญชีอื่นแล้วต้อง reload; การสลับกลับบัญชีเดิม/reset/ยืนยันทิ้งไม่ปลดล็อก
- ตรวจเจ้าของก่อน POST และก่อนนำผล save ไปซิงก์/reset/ล้าง dirty state; response หลังบัญชีเปลี่ยนไม่แก้ doc ID/type/ไฟล์หรือเคลียร์ร่าง
- หน้าหลักเผยแพร่ session snapshots ของคำขอล่าสุด และตรวจใหม่เมื่อ focus/BFCache return; startup รอผลตรวจล่าสุดแทน cached initial reply
- หากผล save กลับมาขณะ session pending จะรอผลยืนยัน หากยังเป็นบัญชีเดิมจึงใช้ receipt/reset ได้ ไม่ทิ้ง file version ใหม่โดยไม่จำเป็น
- Browser จำลองบัญชี/API ยืนยันว่าเอกสารจากบัญชี 7 ไม่ POST เมื่อเป็นบัญชี 8 และยังไม่ POST หลังกลับบัญชี 7; แจ้งซ่อม 7 → 8 → 7 ไม่ POST โดยรักษาข้อความไว้และแจ้ง reload
- เพิ่ม regressions สำหรับ main document POST/late response, create-form switch/return/reset, same-owner reauthentication และ pending checks หลัง save
- `npm.cmd test` ผ่านครบทุกชุด รวม integration **43** และ syntax PHP **139**, JS/CJS **57**, inline scripts **25**; หลังเพิ่ม main BFCache listener รัน `test:modules`, syntax และ `git diff --check` ผ่านอีกครั้ง

## วนแก้และรีวิว save/session lifecycle รอบสุดท้าย — 10 ตุลาคม 2026

- เพิ่ม lifecycle ร่วมสำหรับแจ้งซ่อม/ขอใช้สถานที่: ล็อก controls ระหว่างส่ง กัน submit ซ้ำ และตรวจ revision/generation/snapshot/เจ้าของก่อน reset; response เก่าไม่ล้างข้อมูลหรือร่างที่เปลี่ยนใหม่
- รออ่านรูปภาพก่อนส่ง อ่านไม่สำเร็จไม่ส่งโดยเงียบ และ reset ยกเลิกผลอ่านเก่า; การลบภาพแจ้ง dirty โดยตรง ข้อความ toast แสดงผ่าน textContent
- การแก้เพิ่มยกเลิกคำอนุมัติออกจากหน้าทันที รวม AI settings; logout ตรวจคำอนุมัติใหม่ก่อนล้าง storage หากมีการแก้ระหว่างรอ และเตือนร่างที่อยู่หน้าอื่นในแท็บเดียวกันด้วย
- เมื่อ server logout สำเร็จ จะยกเลิก session checks เก่าของทั้ง shared navigation และหน้าหลัก เพื่อไม่ให้ response ก่อน logout เปิดสิทธิ์/เริ่มเก็บร่างกลับมา; network/HTTP logout failure ไม่ล้างร่าง
- Browser ยืนยันทั้งสองฟอร์ม: controls ถูกล็อก และการเปลี่ยนข้อมูลที่จำลองระหว่าง save ยังคงอยู่ใน DOM/storage พร้อม beforeunload warning หลัง response สำเร็จ; logout ที่มีการแก้เพิ่มเตือนอีกครั้ง ยกเลิกแล้วอยู่หน้าเดิมพร้อมร่างและ guest state
- เพิ่ม `tests/create-form-lifecycle.cjs` รันทุกรอบใน `npm.cmd test` และ `test:modules`; ครอบคลุม handlers จริง, duplicate submit, success/failure, reset/เปลี่ยนบัญชี, image read wait/reset/failure และการคืน disabled state เดิม
- `npm.cmd test` รอบสุดท้ายผ่านทุกชุด: syntax PHP **139**, JS/CJS **56**, inline scripts **25**, integration **43**, member permissions **21**, sign routing **18**, signing concurrency **6**, document races **7**, notification queue **17**, order behavior/HTTP **45/25**; `git diff --check` ผ่าน
- หลังวนรีวิวซ้ำไม่พบข้อบกพร่องที่ยืนยันได้เพิ่มเติมในขอบเขต form/draft/attachment/navigation/session lifecycle ที่ตรวจรอบนี้ การเปลี่ยนแปลงยังอยู่ใน working tree

## รีวิวซ้ำหลังแก้ attachment lifecycle — 10 ตุลาคม 2026

- เพิ่ม failing regressions และแก้สองกรณี: ชื่อไฟล์นำเข้าที่ผู้ใช้ล้างระหว่าง save ถูกค่าเดิมทับกลับ และ response ของ save ที่ค้างอยู่ยังเปลี่ยนฟอร์มหลังผู้ใช้ยืนยันทิ้ง
- เก็บ caption ที่ส่งไปเพื่อแยกค่าปกติของ server จากการแก้/ล้างใหม่ และเพิ่ม form generation เมื่อยืนยันทิ้งเพื่อกัน response เก่า; หากยกเลิกคำยืนยันทิ้งจะไม่เปลี่ยน generation
- Browser จริงร่วมกับ API response จำลองยืนยันว่า caption ว่างยังคงว่างและฟอร์มยัง dirty; ฟอร์มที่ยืนยันทิ้งยังปิดและ clean โดย doc ID/type ไม่ถูก response เก่าแก้
- `npm.cmd test` รอบล่าสุดผ่านทั้งหมด รวม integration **43**, syntax PHP **139**, JS/CJS **54**, inline scripts **25**; หลังตรวจซ้ำไม่พบข้อบกพร่องที่ยืนยันได้เพิ่มเติมในกรณีซิงก์ไฟล์/ยืนยันทิ้งที่ตรวจรอบนี้

## แก้ native click dirty และ attachment save receipts — 10 ตุลาคม 2026

- เปลี่ยน handlers เพิ่ม/ลบไฟล์ ลิงก์ ผู้รับ และกลุ่มงานให้แจ้ง `eoffice:form-dirty` โดยตรง ไม่พึ่ง microtask ของ capture click; การเติม snapshot เดิมใช้โหมด passive จึงไม่ทำให้ฟอร์ม dirty
- API save ส่ง file ID/path ที่บันทึกสำเร็จพร้อม input index และปีของเอกสาร รวม mapping สำหรับ PDF นำเข้าจาก AMSS โดยไม่ลดการตรวจ file version เดิม
- Frontend ซิงก์ ID/version เฉพาะแถวจาก request นั้น ล้างเฉพาะ File ที่ส่งสำเร็จ และรักษาไฟล์ที่เลือกใหม่ ชื่อที่แก้เพิ่ม แถวที่เพิ่ม/ลบภายหลัง และฟอร์มที่เปิดใหม่
- Browser จริง: คลิกเพิ่ม/ลบไฟล์แล้ว revision เปลี่ยนและ beforeunload เตือน; หลังเปลี่ยนไฟล์ + แก้ชื่อระหว่าง save ได้ version ใหม่ ไฟล์ upload ถูกล้าง และ request ถัดไปส่ง version ใหม่โดยไม่ upload ซ้ำ จบบันทึกครั้งถัดไปแล้วฟอร์ม clean
- เพิ่ม tests ของ handlers จริงและ reconciliation; integration HTTP ยืนยัน create → replace PDF → text-only save ด้วย receipt ใหม่สำเร็จ ขณะที่ version เก่ายังถูกปฏิเสธ 409
- `npm.cmd test` ผ่านทุกชุดหลังแก้; integration **43 กรณี**, syntax PHP **139**, JS/CJS **54**, inline scripts **25** และ `git diff --check` ผ่าน

## แก้ผลรีวิวฟอร์มเอกสารและ conditional drafts — 10 ตุลาคม 2026

- เพิ่ม guard ฟอร์มเอกสารบนหน้าหลักสำหรับก่อนออกจากหน้า/เปิดโมดูล/ออกจากระบบและการยืนยันทิ้งข้อมูล ตรวจทั้ง input และการเพิ่ม/ลบ hidden recipient controls; ยกเลิกแล้วคงข้อมูลไว้
- บันทึกสำเร็จล้าง dirty state เฉพาะ snapshot ที่ส่งไป หากผู้ใช้แก้เพิ่มระหว่าง save หรือเปิดฟอร์มใหม่ response เดิมจะไม่ล้างหรือปิดฟอร์มใหม่; failed save และปัญหาไฟล์แนบยังคงคำเตือน
- ช่อง “อื่น ๆ” ของแจ้งซ่อมและสถานที่เก็บเจตนาล้าง แม้ค่า DOM ยังว่างขณะรอ authentication จึงไม่กู้ข้อความที่ยกเลิกแล้วกลับมาเมื่อเปิดตัวเลือกใหม่
- ฟอร์มประกาศ `eoffice:form-ready`/`eofficeDraftReady` เมื่อ handlers พร้อม และกู้ค่าพร้อม conditional visibility/required ก่อนรอรูปหรือฟอนต์โหลดครบ การกู้ไม่ย้าย focus และไม่ถูกนับเป็น user edit
- Browser จริงยืนยันครบสามกรณี: main document warning/cancel, maintenance clear/re-enable ระหว่าง pending (storage เดิมไม่เปลี่ยน), booking “อื่นๆ” แสดงพร้อม required ที่ `readyState = 'interactive'`
- เพิ่ม regression tests สำหรับ guard + save lifecycle และ conditional checkbox/select + form readiness; `npm.cmd test` ผ่านทั้งหมดด้วยฐาน QA และ environment เดิม Syntax ล่าสุด PHP **139**, JS/CJS **53**, inline scripts **25**; `git diff --check` ผ่าน

## รีวิวร่างอุปกรณ์และยืนยันซ้ำ — 10 ตุลาคม 2026

- ยืนยัน regression ด้วย `toggleOtherEquip()` จริงร่วมกับ draft manager: ติ๊ก LED ก่อนกู้ร่างครบทำให้ข้อความอุปกรณ์ที่พิมพ์เองหาย
- แก้ให้ conditional handlers เห็นค่าร่างที่รวมแล้วเมื่อยืนยันเจ้าของได้ และแยกการเปลี่ยนข้อความที่ระบบประกอบจากการแก้ข้อความโดยตรง การยกเลิก “อื่น ๆ” ยังล้างข้อความเองอย่างชัดเจน แม้ยกเลิกแล้วติ๊กกลับก่อนกู้ร่าง
- เพิ่ม regression สำหรับ session ที่มาช้า, LED ไม่ซ้ำ, การพิมพ์ข้อความใหม่ และ radio-group semantics เพื่อไม่ให้การเติมค่าร่างของปุ่มคู่กันย้อนการเลือกใหม่
- Browser จริงผ่านทั้งคลิก LED ที่ `document.readyState = 'interactive'` ก่อน `load` และคลิกขณะ authentication pending: ข้อความเองยังอยู่, label LED แต่ละชนิดมีครั้งเดียว, storage ไม่ถูกเขียนระหว่าง pending และเปลี่ยนเป็น `saved` หลังยืนยันบัญชีเดิม
- รัน `npm.cmd test` หลังแก้ **ผ่านทุกชุด** ด้วย environment/ฐาน QA ด้านล่าง รวม syntax PHP **139 ไฟล์**, JS/CJS **52 ไฟล์**, inline scripts **25 blocks**, integration **42**, member permissions **21**, sign routing **18**, signing concurrency **6**, document races **7**, notification queue **17** และ order behavior/HTTP **45/25**
- `git diff --check` ผ่าน หลังรีวิวซ้ำไม่พบข้อบกพร่องที่ยืนยันได้เพิ่มเติมในขอบเขต navigation/draft merge ที่ตรวจรอบนี้

## ยืนยันการเปลี่ยนหน้าแบบไม่มี iframe — 9 ตุลาคม 2026

รัน `npm.cmd test` ใน working tree ล่าสุด **ผ่านครบทุกชุด** รวมการนำทาง/ร่าง/BFCache, สมาชิก, ลงนาม, integration, document races, notifications, อีเมลคำสั่ง และ backup โดยใช้บริการภายนอกจำลอง

- MySQL 8.4.3 local สำหรับทดสอบฟังที่ `127.0.0.1:3307`; สาเหตุ connection refused รอบก่อนคือใช้ default port `3306`
- ใช้ฐานใหม่ `eoffice_module_qa_20261009_test` จาก **schema-only** ของ `eoffice_security_test`; ก่อน seed มีผู้ใช้และเอกสาร **0 แถว**
- เติมเฉพาะฐาน QA ให้ตรงกับ fixture/API: `t_access_rights.alert_to`, defaults ของสถานะลงนาม/อ่าน, foreign keys ของผู้รับและเอกสาร, ชื่อ primary key `t_register_check.register_check_id` และ `t_user.Phone_Number`
- ผ่าน syntax: PHP **139 ไฟล์**, JS/CJS **52 ไฟล์**, inline scripts **25 blocks**; integration **42 กรณี**, member permissions **21 กรณี**, sign routing **18 กรณี**, signing concurrency **6 กรณี**, document races **7 กรณี**, notification queue **17 กรณี**, order behavior/HTTP **45/25 กรณี**
- ไม่แก้ค่าพอร์ตใน private config และไม่เปลี่ยนฐาน schema ต้นทาง; ฐาน QA เก็บเฉพาะข้อมูลสังเคราะห์ที่ใช้ทดสอบ

ค่ารอบตรวจนี้:

```powershell
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '3307'
$env:DB_USERNAME = 'root'
$env:DB_PASSWORD = ''
$env:TEST_DATABASE = 'eoffice_module_qa_20261009_test'
$env:EOFFICE_MOCK_SERVICES = 'true'
$env:EOFFICE_STAGING_TEST = '0'
$env:SIGN_RACE_TEST_PORT = '8197'
npm.cmd test
```

ผลนี้ยืนยันชุดทดสอบใน local ไม่ใช่การเผยแพร่ขึ้น production การเปลี่ยนแปลงยังอยู่ใน working tree

---

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
