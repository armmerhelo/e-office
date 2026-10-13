# ผลการแก้ไขและทดสอบ E-Office

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
