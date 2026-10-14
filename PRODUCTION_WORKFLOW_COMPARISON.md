# เปรียบเทียบ Workflow ระดับโค้ด: Local กับ Production

**ระบบ:** E-Office โรงเรียนศรียานุสรณ์

**วันที่ตรวจ source บน production:** 14 ตุลาคม 2569

**Production:** https://e-office.siya.ac.th/

**Local:** `461af0c13224e76e1d1acf64a131ee84edee837c`

**Production manifest:** `60a23f577b2a40876745fbdea0041eabf99fb809`

> ข้อสรุป: workflow ธุรกิจหลักยังเป็นระบบเดิม แต่ local เปลี่ยนการนำทาง การจัดการ session ในหน้าเว็บ และ lifecycle ของฟอร์มอย่างมีนัยสำคัญ พร้อมแก้ API สร้างเอกสาร/จองห้อง/แจ้งซ่อมบางส่วน จึงไม่ใช่การเปลี่ยนหน้าตาเพียงอย่างเดียว

เอกสารภาพรวมสำหรับนำเสนอ: [WORKFLOW_PRESENTATION.md](WORKFLOW_PRESENTATION.md)

## 1. วิธีเทียบและขอบเขตหลักฐาน

### 1.1 Source ที่ใช้เทียบ

1. อ่านไฟล์ production ผ่าน FTPS ที่ตรวจ certificate โดยไม่อัปโหลด helper หรือแก้ไฟล์บนเซิร์ฟเวอร์
2. เทียบเนื้อหากับไฟล์ local โดย normalize line endings และบันทึก SHA-256 ของ production
3. เมื่อไฟล์ต่าง ตรวจซ้ำว่า production ตรงกับ Git baseline ใด
4. ตรวจ directory listing เพื่อแยกไฟล์ที่ไม่มีจริงออกจากข้อผิดพลาดการดาวน์โหลด
5. ตรวจ PHP/shell scripts ของ worker และ scheduler เพิ่มจากไฟล์หน้าเว็บ

**เวลาจบ snapshot:** ไฟล์เว็บ `2026-10-14 05:39 UTC` และ CLI `05:40 UTC` หรือประมาณ `12:39–12:40 Asia/Bangkok`

| กลุ่ม | จำนวน | ตรงกับ local | ต่างจาก local | ไม่มีบน production |
|---|---:|---:|---:|---:|
| PHP/HTML/JS/CSS/.htaccess นอก `scripts/` | 152 | 111 | 31 | 10 |
| PHP/shell ใน `scripts/` | 13 | 12 | 1 | 0 |
| **รวมเส้นทางที่ตรวจ** | **165** | **123** | **32** | **10** |

- จาก 31 ไฟล์เว็บที่ต่าง มี **29 ไฟล์ตรงกับ baseline `60a23f5`** และอีก 2 ไฟล์เป็น legacy drift แยกต่างหาก
- ไฟล์ใหม่ที่ไม่มีบน production แบ่งเป็น **runtime 9 ไฟล์** และ template `config/production.example.php` 1 ไฟล์
- CLI ที่ต่างมีเพียง `scripts/migrate.php`
- ตัวเลขนี้เป็นขอบเขตเส้นทางที่เลือกตรวจ ไม่ใช่จำนวนไฟล์ทั้งหมดบน hosting

### 1.2 สิ่งที่ผลเปรียบเทียบนี้บอกได้

- ยืนยันว่าโค้ดใดเปลี่ยนจริง และไล่ผลกระทบผ่าน caller/dependency ได้
- ใช้หลักฐานการทดสอบ local และการอ่าน production จากรอบก่อนประกอบได้
- การที่ไฟล์หนึ่งตรงกันไม่ได้แปลว่าผลทุกกรณีตรงกัน หากไฟล์นั้นเรียก dependency ที่เปลี่ยน เช่น `config/bootstrap.php`
- ไม่ได้อ่าน private config, ทดสอบเขียนข้อมูลบุคลากรบน production หรือยืนยัน Google OAuth/SMTP/Push/Gemini/Drive จริงครบวงจรในรอบนี้
- Source Apps Script ใน repository ไม่ใช่หลักฐานว่า deployment ฝั่ง Google ใช้ source เดียวกัน เพราะไม่ได้ดึง deployment ฝั่ง Google มาตรวจรอบนี้

## 2. สรุปความต่างตาม Workflow

| Workflow | Production | Local ปัจจุบัน | ประเภทการเปลี่ยน |
|---|---|---|---|
| เปิดโมดูลจากเมนู | สร้าง iframe ในหน้าหลัก | เปลี่ยนเป็นหน้าเว็บปลายทางและ shell ร่วม | เปลี่ยนโครงสร้างการนำทาง |
| Back/Forward/refresh ของแท็บเอกสาร | พึ่ง state เดิมและ `currentPage` | URL `?view=...` และ History API | เปลี่ยน state หน้าเว็บ |
| Login/Google/signup | API และการยืนยันตัวตนเดิม | API เดิม เพิ่มการกลับเมนูและ session snapshots | หน้าเว็บเปลี่ยน |
| Logout | หน้าเว็บเดิมอาจล้าง storage ใน catch | ยืนยันข้อมูลค้าง ตรวจ HTTP success และรักษาร่างเมื่อผิดพลาด | เปลี่ยนผลต่อข้อมูลใน browser |
| รายการหนังสือ/คำสั่ง | Query และสิทธิ์เดิม | Query เดิม ทำ response เก่าหมดสิทธิ์อัปเดตเมื่อสลับ view | ป้องกัน stale response |
| สร้าง/แก้เอกสาร | Save แล้วปิด modal ตามผลสำเร็จ | ผูก owner/revision/generation และซิงก์ file receipts | เปลี่ยนทั้ง client และ API |
| AMSS | นำเข้า PDF และตรวจไฟล์อยู่แล้ว | นำเข้าเดิม เพิ่ม mapping กลับไปยังแถวลิงก์ | ขยาย response |
| อ่าน/ลงนาม PDF | สิทธิ์และ revision checks เดิม | ตัวอ่านและตัวบันทึกลายเซ็นตรงกับ production | Core เดิม |
| Auto send เลขา → รอง | Routing/receipt เดิม | Routing เดิม เพิ่ม dirty/clean ของหน้าตั้งค่า | หน้าเว็บเปลี่ยน |
| สมาชิก/กลุ่มงาน | CRUD/permissions เดิม | API เดิม เปลี่ยน shell และ event บางส่วน | หน้าเว็บเปลี่ยน |
| จองเลขคำสั่ง | Counter/transaction เดิม | API เดิม เพิ่ม clean notification หลังจอง | หน้าเว็บเปลี่ยน |
| AI/อีเมลคำสั่ง | Queue/worker/retry เดิม | Worker เดิม ปรับฟอร์มผู้รับและคำเตือนตั้งค่า | หน้าเว็บเปลี่ยน |
| คำสั่งของฉัน | Query จาก email logs เดิม | Query เดิม เพิ่ม navigation ร่วม | Shell เปลี่ยน |
| สร้างคำขอห้อง/สถานที่ | ฟอร์มและ INSERT เดิม | Draft/date/owner guard และ auth-locked transaction | เปลี่ยนทั้ง client และ API |
| แก้/อนุมัติการจอง | Ownership/overlap checks เดิม | API เดิม เพิ่ม shell ของหน้า | Core เดิม |
| สร้างใบแจ้งซ่อม | อ่านภาพและส่งข้อมูลเดิม | รออ่านภาพครบ มี draft/owner guard และ transaction | เปลี่ยนทั้ง client และ API |
| แจ้งซ่อมฝ่ายงาน | API สถานะเดิม | API เดิม ป้องกัน dirty/late response/submit ซ้ำ | หน้าเว็บเปลี่ยน |
| Drive/backup/cron | Worker และ launcher เดิม | Source ที่ตรวจตรงกัน | Core เดิม |
| Migration | รันตาม database config | เพิ่ม `--test` และ guard เมื่อเลือกฐานไม่ชัด | เครื่องมือ CLI เปลี่ยน |

## 3. การนำทาง: iframe → standalone pages

### Production

```text
index.php
  → assets/main.js: showView(...)
  → เลือก container ของโมดูล
  → สร้าง <iframe src="...">
  → โหลด HTML/JS ของโมดูลใน document ลูก
  → ปรับความสูงผ่าน on_iframe_loaded / fit_iframe_height
```

### Local

```text
index.php
  → assets/main.js: showView(...)
  → ตรวจ MODULE_ROUTES และสิทธิ์
  → ตรวจข้อมูลเอกสารที่ยังไม่บันทึก
  → window.location.assign(moduleRoute)
  → HTML ปลายทางโหลด app-navigation.js
  → สร้าง sidebar/header/content wrapper และตรวจ session ของหน้า
```

**ไฟล์หลัก:** [main.js](assets/main.js), [index.php](index.php), [app-navigation.js](assets/app-navigation.js), [app-navigation.css](assets/app-navigation.css)

| จุดเปรียบเทียบ | Production | Local |
|---|---|---|
| Browser URL | โดยหลักยังอยู่หน้าหลักขณะเปิด iframe | เปลี่ยนเป็น URL ของโมดูล |
| Document context | หน้าแม่และหน้า iframe แยกกัน | โมดูลเป็น top-level document |
| เมนูโมดูล | ใช้เมนูจากหน้าแม่ | แต่ละโมดูลมี sidebar/hamburger ร่วม |
| สื่อสารหลังแก้สิทธิ์สมาชิก | `window.parent.postMessage(...)` | `window.dispatchEvent('eoffice:permissions-changed')` |
| Scroll/responsive | ต้องจัดการความสูง iframe | ใช้ shell layout และ container queries ในหน้าที่เกี่ยวข้อง |
| ข้อมูลที่ยังไม่ส่ง | อาจอยู่ใน DOM ของ iframe ที่ยังคงไว้ ขึ้นกับสาขาของ router | เปลี่ยนหน้าแล้ว DOM เดิมไม่ได้คงไว้เสมอ จึงใช้ guard และร่างเฉพาะฟอร์มที่รองรับ |

### เส้นทางที่ local ใช้

| Route key | หน้า |
|---|---|
| `members` | `management/user_manage.html` |
| `groups` | `management/department_manage.html` |
| `book` | `external_number_booking/external_number_booking.html` |
| `send_email` | `email_send/doc_send_email.html` |
| `my_public` | `email_send/my_dashboard.html` |
| `room_booking` | `room_booking/index.html` |
| `room_booking2` | `room_booking/new_room.html` |
| `edit_room_booking` | `room_booking/edit_room_booking.html` |
| `maintenance` | `maintenance_requests/index.html` |
| `maintenance_admin` | `maintenance_requests/admin.html` |

หน้า `email_send/ai_settings.html` ใช้ shell ร่วมเช่นกัน แต่ไม่ได้เป็น key ใน `MODULE_ROUTES` ของ main router รวมหน้าโมดูลที่ใช้ shell **11 หน้า**

### แท็บเอกสารบนหน้าหลัก

- `DOCUMENT_VIEWS` ครอบคลุม `received`, `send`, `public`, `send_table`
- `requestedViewFromUrl()`, `navigateView()` และ `popstate` ใช้ URL/History API ให้ refresh และ Back/Forward กลับ view ที่เกี่ยวข้อง
- `eoffice-login-view` เก็บปลายทางโมดูลสำหรับ guest ที่ต้อง login แล้วนำมาใช้ครั้งเดียว
- ค่า route ที่ไม่อยู่ในรายการจะกลับไป view ที่รองรับ ไม่ใช้ชื่อ property ใด ๆ เป็นปลายทางโดยตรง

## 4. Login, session, logout และการเปลี่ยนบัญชี

### 4.1 Authentication ฝั่ง server

ไฟล์ `api/auth_login.php`, `api/logout.php`, `api/me.php`, Google auth endpoints และ `config/auth.php` **ตรงกับ production** จึงไม่ได้เปลี่ยนวิธีตรวจรหัสผ่านหรือ Google OAuth ใน release นี้

`config/bootstrap.php` เพิ่ม helper ใหม่ แต่ body ของ authentication/authorization หลัก เช่น `app_user()`, `app_can()` และการตรวจสิทธิ์เอกสารเดิมไม่ได้ถูกแทนด้วยระบบใหม่

### 4.2 Session state ในหน้าเว็บ

| เรื่อง | Production | Local |
|---|---|---|
| สถานะที่ส่วนอื่นอ่าน | ตัวแปรผู้ใช้และ session promise เดิม | `eofficeSessionState` พร้อม revision/status/user/pageOwnerId |
| ตรวจหลายคำขอซ้อน | ไม่มี sequence guard ชุดใหม่นี้ | ใช้ผลคำขอล่าสุดเท่านั้น |
| ระหว่างตรวจ session | ไม่มี draft consumer ชุดใหม่ | ประกาศ `pending` ทันทีเพื่อพักการเขียนร่าง |
| กลับจาก BFCache | พฤติกรรมเดิม | `pageshow.persisted` ตรวจบัญชีใหม่และปลดสถานะ drawer/scroll ที่ค้าง |
| ตรวจบัญชีไม่ได้ | พฤติกรรมเดิมของหน้า | สถานะ `unavailable`; owner เดิมเป็นขอบเขต ไม่ใช่สิทธิ์อนุญาตส่ง |

**สถานะ local:** `pending → authenticated / guest / unavailable` และตรวจซ้ำเมื่อ focus หรือมี event เปลี่ยนสิทธิ์

### 4.3 Owner boundary

`assets/form-owner-boundary.js` ใช้กับฟอร์มเอกสารหน้าหลัก ใบแจ้งซ่อม และคำขอใช้สถานที่:

1. จำ owner แรกที่ยืนยันได้
2. `capture()` อนุญาตเริ่มส่งเมื่อบัญชีปัจจุบันตรงและตรวจแล้ว
3. ถ้าเห็นบัญชีอื่น จะ latch conflict จน reload แม้สลับกลับบัญชีเดิม
4. หลัง server save สำเร็จ `applyVerified()` ตรวจ owner/generation ก่อนซิงก์ UI
5. หากกำลังตรวจหรือ session ใช้ไม่ได้ชั่วคราว จะรอยืนยันบัญชีเดิมพร้อมสถานะ `awaiting-session`
6. Reset/discard หรือ owner conflict ยกเลิกการนำผลเก่ามาใช้

**ขอบเขต:** owner boundary ชุดนี้ไม่ได้ครอบทุกฟอร์มของทุกโมดูล ฟอร์มอื่นยังใช้ authorization ของ API และ lifecycle ของหน้าตนเอง

### 4.4 Logout

| กรณี | Production `logOut()` | Local |
|---|---|---|
| มีข้อมูลค้าง | ไม่มี shared guard ชุดใหม่ | เตือน รวมร่างที่เก็บจากหน้าอื่นในแท็บ |
| HTTP response ที่ไม่สำเร็จ | ตรวจ `data.status` โดยไม่ได้ใช้ `response.ok` เป็นเงื่อนไขร่วม | ต้องผ่านทั้ง HTTP success และ result success |
| Network/JSON exception | catch เดิมล้าง storage แล้วกลับหน้าหลัก | ไม่ล้างร่าง แจ้งข้อผิดพลาดและคืนคำเตือนก่อนออก |
| Server logout สำเร็จ | ล้าง storage และเปลี่ยนหน้า | ยกเลิก session checks เก่า แล้วตรวจคำอนุมัติอีกครั้งก่อนล้าง |
| แก้ข้อมูลเพิ่มระหว่างรอ logout | ไม่มีการยืนยันซ้ำชุดนี้ | การแก้ใหม่ยกเลิกคำอนุมัติเดิม |

หาก server logout สำเร็จแล้ว แต่ผู้ใช้ปฏิเสธการล้างข้อมูลในการยืนยันครั้งหลัง หน้าอาจอยู่ต่อเพื่อรักษาข้อมูล **แต่ session ฝั่ง server ถูกออกแล้ว** ไม่ใช่การย้อน logout ให้กลับมา login อัตโนมัติ

## 5. รายการเอกสาร ค้นหา และสลับ view

**API core ที่ตรงกัน:** `api/document_list.php`, `get_data_received.php`, `get_data_send.php`, `get_data_public.php`, `update_read_status.php`, `report.php` และ `api_soft_delete_doc.php`

ทั้งสองเวอร์ชันยังใช้ query/ownership/recipient/group-access เดิมในการแสดงรายการ รวมการจำกัดข้อมูลส่วนตัวใน public orders

**ส่วนที่เปลี่ยน:** `assets/api-service.js` เพิ่ม `invalidateDocumentRequests()` และ `showView()` เรียกก่อนสลับ view

```text
เริ่มโหลด received A
  → ผู้ใช้เปลี่ยนไป public
  → invalidate sequence ของ document requests
  → เริ่มโหลด public B
  → A กลับมาทีหลัง: ไม่ใช้ผล A เขียน DOM/loader/pagination ของ B
```

มี sequence แยกสำหรับ `get_data_api_received`, `get_data_api_send_table`, `get_data_api_send`, `get_data_api_public` และการลบ `id` จาก URL ปรับให้รักษา query อื่น เช่น `view`

**ผลต่อ workflow:** ข้อมูลที่แสดงไม่ถูก response ของ view เก่าย้อนทับ โดยไม่เปลี่ยนเงื่อนไขการค้นหาหรือสิทธิ์ฝั่ง SQL

## 6. สร้าง/แก้เอกสาร และไฟล์แนบ

### 6.1 การส่งและใช้ผลบันทึกใน browser

| ขั้นตอน | Production | Local |
|---|---|---|
| ก่อน POST | สร้าง FormData และซ่อนปุ่ม | ตรวจ `documentSavePending`, owner แล้วจับ revision/generation/file snapshot |
| ข้อมูลเพิ่มใน request | ไม่มี `_expected_owner` | เพิ่ม owner ที่ capture ได้ |
| Server success | แจ้งสำเร็จ ปิด modal และโหลดรายการ | รอตรวจ owner ก่อนซิงก์ ID/type/ไฟล์ |
| แก้ข้อความระหว่างรอ | ไม่มี snapshot-aware close ชุดใหม่ | บันทึกชุดที่ส่งไป แต่รักษาการแก้ใหม่และไม่ปิด modal |
| เปิดฟอร์มใหม่/ทิ้งฟอร์มเดิม | ไม่มี generation guard ชุดใหม่ | ผลเก่าไม่แก้ form ใหม่หรือ clean การแก้ใหม่ |
| การกดซ้ำ | ปุ่มถูกซ่อน แต่ไม่มี singleton ชุดใหม่ | `documentSavePending` ป้องกัน handler เริ่ม request ซ้ำ |

อ้างอิง: `assets/main.js` submit handler ของ `document-form`; `assets/document-form-guard.js`

**ข้อแตกต่างจากสอง create forms อื่น:** ฟอร์มเอกสารหลักยังรองรับการแก้เพิ่มเติมระหว่างรอ save ไม่ได้ใช้การล็อกทุก control แบบ `create-form-lifecycle.js`

### 6.2 Dirty state ของโครงสร้างฟอร์ม

`assets/utils.js` เพิ่ม `notifyDocumentEdit()` และ `removeDocumentRow()` พร้อม `userChange` flag ใน:

- `addNewInputFile()`
- `addNewLink()`
- `add_user_send()`
- `add_group_send()`

ผลคือการเพิ่ม/ลบไฟล์ ลิงก์ และ hidden recipient rows เป็นการแก้ที่เตือนได้จริง ส่วนการเติมข้อมูลเดิมตอนเปิดเอกสารใช้ passive mode ไม่ถูกนับเป็น user edit

### 6.3 API `POST api/create_document.php`

**ยังเหมือนเดิม:** ตรวจสิทธิ์เอกสาร แยก receipt-only update ของผู้รับ ตรวจข้อมูล/ไฟล์/เวอร์ชัน ดำเนินการใน transaction บันทึกผู้รับ เรียก order enrollment และ archive tracking

**เพิ่มใหม่:** ตรวจ `_expected_owner` และสร้าง file-save receipts ที่ frontend ใช้ซิงก์แถว

Production response ของการบันทึกข้อมูลเอกสารส่วนกลาง:

```json
{
  "status": "success",
  "doc_id": 123,
  "files": {"status": "success"}
}
```

Local response ของเส้นทางเดียวกัน (ตัด message ออกเพื่อให้อ่านง่าย):

```json
{
  "status": "success",
  "doc_id": 123,
  "files": {
    "status": "success",
    "year": "2569",
    "entries": [
      {"input_index": 0, "file_id": 456, "path": "saved.pdf", "detail": "ไฟล์หลัก"}
    ],
    "imported": [
      {"link_index": 0, "file_id": 457, "path": "imported.pdf", "detail": "ไฟล์ AMSS"}
    ]
  }
}
```

ID และชื่อไฟล์ในตัวอย่างเป็นค่าประกอบคำอธิบาย ไม่ใช่ข้อมูลเอกสารจริง

**คำว่า receipt ในหัวข้อนี้หมายถึงผลอ้างอิงไฟล์หลัง save** ไม่ใช่การยืนยันรับหนังสือของเลขาใน Auto send และเส้นทาง receipt-only ของผู้รับยังอาจไม่มี `files` object ตามเดิม

### 6.4 ซิงก์ไฟล์หลัง save

`captureDocumentFileState()` / `reconcileDocumentFiles()` ใน `assets/document-file-state.js`:

1. จับ DOM row และ File object ที่ส่ง
2. ตรวจ mapping ใน response ให้ครบและไม่ซ้ำ
3. อัปเดต `file_id[]` และ `file_version[]` ของแถวที่ยังอยู่
4. ล้างเฉพาะ File ที่ส่งใน request นั้น ไม่ล้าง File ใหม่ที่เลือกภายหลัง
5. รักษาชื่อที่แก้เพิ่มและแถวที่ผู้ใช้ลบ
6. อัปเดตลิงก์เปิดลงนามให้ชี้ไฟล์ที่บันทึกแล้ว
7. เปลี่ยน AMSS link ที่ยังตรงกับ request เป็นไฟล์แนบ พร้อมรักษา caption ที่แก้ใหม่

**ผลต่อ workflow:** หลังเปลี่ยนไฟล์แล้วแก้ข้อความต่อ บันทึกครั้งถัดไปใช้ version ใหม่ ไม่ใช้ path ก่อน replacement

## 7. AMSS: สิ่งที่เหมือนและต่าง

`config/amss-links.php` ตรงกับ production จึงใช้เงื่อนไข URL, HTTPS, PDF validation และขอบเขตดาวน์โหลดเดิม

| จุด | Production | Local |
|---|---|---|
| ลิงก์ที่รองรับ | AMSS PDF ตาม validator เดิม | เหมือนเดิม |
| ดาวน์โหลด/ตรวจไฟล์ | มีอยู่แล้ว | เหมือนเดิม |
| Rollback เมื่อผิดพลาด | มีอยู่แล้ว | เหมือนเดิม |
| ข้อมูลใน staging array | detail + temporary handle | เพิ่ม source link index |
| ผลกลับ frontend | status ไฟล์ | เพิ่ม imported file ID/path/detail และ link index |
| นำมาใช้กับฟอร์มที่แก้ระหว่าง save | ไม่มี reconciliation ชุดใหม่ | ใช้ mapping เพื่อรักษาการแก้ใหม่ |

นี่เป็นการปรับการรับผลนำเข้าและบันทึกต่อ ไม่ใช่การเพิ่ม AMSS integration เป็นครั้งแรก

## 8. อ่าน PDF, ลงนาม และ Auto send

### Core ที่ตรงกับ production

- `api/view_file.php`
- `e-sign/e-sign.php`, `e-sign/upload_pdf.php`, `e-sign/receipt_scopes.php`
- `config/sign-routing.php` และ APIs ตั้งค่า routing
- กลไก archive resolver และ signed-file tracking ที่เกี่ยวข้อง

Workflow ทั้งสองเวอร์ชัน:

```text
เปิดไฟล์ที่มีสิทธิ์ → อ่าน PDF/revision → เขียนหรือประทับตรา
  → บันทึกพร้อม revision
  → ตรวจสิทธิ์/เวอร์ชัน/receipt scopes
  → บันทึก PDF ลงนาม
  → ถ้ามีการยืนยันรับของเลขาที่ตรง assignment: เพิ่มสิทธิ์ให้รอง/เข้าคิวแจ้งเตือน
```

**ส่วนที่เปลี่ยน:** `assets/sign-routing-management.js` ใช้ `setDirty()` ส่ง `eoffice:form-dirty` / `eoffice:form-saved` เมื่อเพิ่ม/ลบคู่ เปลี่ยน select โหลดข้อมูลใหม่ หรือ save สำเร็จ

**ขอบเขตความต่าง:** ไม่ได้เปลี่ยนความหมายของตรา การตรวจ revision เงื่อนไขคู่เลขา/รอง หรือจำนวนผู้รับที่ควรเพิ่ม

## 9. สมาชิก กลุ่มงาน และสิทธิ์

### API และข้อมูล

Member CRUD, status/permissions APIs, department APIs, `config/permissions.php` และ version helpers ที่ใช้อยู่ตรงกับ production

จึงยังเป็นกติกาเดิม: สิทธิ์ดูแลงาน 6 ด้าน, เปลี่ยนสิทธิ์/ระดับโดย Admin, ป้องกัน last Admin และใช้ version token ป้องกัน snapshot ล้าสมัย

### Client ที่เปลี่ยน

| ส่วน | Local เพิ่ม/เปลี่ยน |
|---|---|
| `member-management.js: notifySessionChange()` | เปลี่ยน parent postMessage เป็น event ใน window ปัจจุบัน |
| `showDialog()` | เริ่ม dirty state ใหม่ตาม snapshot ของ modal |
| เพิ่ม/ถอนกลุ่มงาน | แจ้ง dirty โดยตรงจาก handler ของ chip |
| Save profile/status/permissions/delete สำเร็จ | ส่ง clean event ให้ guard ร่วม |
| Save ผิดพลาด | ไม่ส่ง clean event |
| `department_manage.html` | เพิ่ม shell script; CRUD functions ไม่เปลี่ยน |

**ข้อจำกัดที่ต้องอ่านให้ตรงโค้ด:** การเพิ่ม shared guard ไม่ได้แปลว่าฟอร์มสมาชิกมี owner boundary/commit-marker หรือ snapshot-save protection เหมือนฟอร์มสร้างใบแจ้งซ่อมทุกอย่าง

## 10. จองเลขคำสั่ง

`external_number_booking/external_number_booking.php` ตรงกับ production:

```text
ผู้ใช้ login → เลือกปี/รายละเอียด → POST
  → lock counter ของปี → คำนวณเลขถัดไป → INSERT → commit
  → แสดงเลขที่จอง
```

- Ownership/สิทธิ์ดูแลเลขคำสั่งและ PUT/DELETE ใช้กติกาเดิม
- ฝั่ง HTML เพิ่ม shell และ dispatch `eoffice:form-saved` หลังจองสำเร็จ
- ไม่มีการสร้างเลขใหม่ด้วยวิธีอื่น และไม่ได้รวมการจองเลขเข้ากับการสร้างเอกสารเป็น transaction เดียว

## 11. AI/อีเมลคำสั่ง และคำสั่งของฉัน

### Core ที่ตรงกับ production

`config/order-emails.php`, settings/AI helpers, `email_send/order_jobs.php`, `email_send/ai_settings.php`, `email_send/api_get_my_docs.php`, `scripts/order-emails.php`

ยังคงใช้ activation boundary, รอ PDF, วิเคราะห์ครบทุกไฟล์, รวมผู้รับ, queue, retry/backoff, uncertain SMTP และ duplicate-delivery protection เดิม

### ฟอร์มผู้รับ

`email_send/order-dashboard.js` เพิ่ม `resetRecipientForm()`:

- Production ล้างอีเมลภายในขั้นตอน refresh/detail หลัง save
- Local ล้างและแจ้ง clean ทันทีเมื่อ write `add_recipient` สำเร็จ แม้ list/detail refresh ถัดมาผิดพลาด
- เปิดรายละเอียดคำสั่งใหม่เริ่ม recipient form แบบ clean
- Write ที่ถูกปฏิเสธไม่ล้างข้อความผู้รับ

### ตั้งค่า AI

`email_send/ai-settings.js`:

- API key/model/enabled/revision protocol เดิม
- Save สำเร็จส่ง clean event
- รับ `eoffice:leaving-confirmed` / `eoffice:leaving-cancelled` เพื่อประสานคำเตือนกับ shell
- การแก้เพิ่มเพิกถอนคำยืนยันออกจากหน้าเดิม
- CSS ของ AI/dashboard เปลี่ยน media queries ที่เกี่ยวข้องเป็น container queries เพื่ออ้างความกว้างเนื้อหาหลังหัก sidebar

### คำสั่งของฉัน

`email_send/my_dashboard.html` เพิ่ม shell; API และเงื่อนไขค้นจาก email logs ที่ส่งสำเร็จถึงอีเมลผู้ใช้ไม่เปลี่ยน

## 12. จองห้อง/ขอใช้สถานที่

### 12.1 ฟอร์มและเวลา

| ขั้นตอน | Production | Local |
|---|---|---|
| เปิดให้กรอก | ฟอร์มเดิมพร้อมใช้งาน | fieldset รอ early listeners; ปุ่มส่งรอ handlers/draft |
| วันที่เริ่มต้น/min | ใช้ `toISOString()` ตอน window load | `eofficeDates.today()` ตาม Asia/Bangkok และเติมเฉพาะช่องว่าง |
| ชื่อจาก cookie | เติมใน onload | ไม่ทับชื่อที่กรอกแล้ว และรองรับ cookie ที่ decode ไม่ได้ |
| เวลาเริ่ม 23:30 | บวกชั่วโมงแบบ modulo โดยไม่เลื่อนวัน | `afterOneHour()` ได้วันถัดไป 00:30 |
| เวลาสิ้นสุดที่แก้เอง | logic เดิมอาจเติมทับเมื่อวันตรงกัน | รักษา manual/restored end range |
| เปิดค้างข้ามวัน | min ที่ตั้งตอนโหลด | refresh min เมื่อ focus/pageshow/visibility และก่อน submit |
| ส่งซ้ำ | การปิดปุ่มตาม handler เดิม | busy flag, control lock และ commit marker |
| Save สำเร็จ | reset/เปิด success modal โดยตรง | ใช้ผลเฉพาะ snapshot/owner/editor/version เดิม |

อ้างอิง: `room_booking/new_room.html: initializeBookingForm(), handleBooking(), submit_bookingroom()` และ `assets/form-dates.js`

**Date bounds เป็น client validation:** API ยังใช้ `app_times()` ตรวจรูปแบบ/ลำดับช่วงเวลา ไม่ได้เพิ่มเงื่อนไข server ใหม่เพื่อปฏิเสธวันที่ย้อนหลังจาก caller โดยตรง

### 12.2 POST `room_booking/api/room_booking.php`

```text
Production:
อ่าน user แบบ optional → validate → GET_LOCK ของห้อง
  → ตรวจ confirmed overlap → INSERT pending → RELEASE_LOCK

Local (caller มี owner field หรือ login อยู่):
อ่าน user → ตรวจ expected owner → validate → GET_LOCK ของห้อง
  → READ COMMITTED transaction
  → รับ metadata lock ของ room_bookings ก่อน auth locks
  → lock user/session และตรวจบัญชีอีกครั้ง
  → ตรวจ confirmed overlap → INSERT pending → commit
  → rollback ถ้ายังค้าง transaction และ RELEASE_LOCK ใน finally
```

- เพิ่ม `app_lock_create_owner()` และเส้นทาง error หลังตรวจ session ที่ค้างใน queue
- การ revoke ที่ commit ก่อน request ได้ auth locks จะถูกเห็นในการตรวจซ้ำ; หาก request ถือ auth locks แล้ว logout/revoke อาจต้องรอให้ transaction บันทึกจบ ไม่ใช่การยกเลิก write ที่เริ่มถือสิทธิ์แล้วทุกกรณี
- รูปแบบ response สำเร็จยังเป็น `status/message/id`
- กติกา overlap และสถานะเริ่มต้น `pending` ไม่เปลี่ยน
- APIs `get_bookings.php`, `my_bookings.php`, `update_booking.php`, `update_status.php` ตรงกับ production
- หน้าปฏิทินและรายการจองเปลี่ยน shell ไม่ได้เปลี่ยนระบบอนุมัติเป็นอัตโนมัติ

### 12.3 Guest/direct URL: ความต่างที่มีผลต่อการใช้งาน

- Production API เดิมอ่าน user แบบ optional และสามารถบันทึก `User_Id = null` ได้ โดยหน้าเว็บเดิมที่เปิดตรงไม่มี owner capture ชุดใหม่นี้
- Local create-form UI ต้องยืนยันบัญชีก่อนส่งผ่าน `lifecycle.begin()`
- Local API ยังรองรับ legacy guest ที่ไม่ส่ง `_expected_owner` ตามเดิม
- ดังนั้น **หน้าเว็บใหม่บังคับเงื่อนไข login ชัดขึ้น แต่ API ไม่ได้เปลี่ยนเป็น authenticated-only สำหรับ caller ทุกแบบ**

## 13. แจ้งซ่อม: สร้างคำขอ

### 13.1 Browser และภาพประกอบ

Production:

```text
เลือกภาพ → FileReader อ่านแบบ async → เพิ่ม selectedImages เมื่ออ่านเสร็จ
กดส่ง → สร้าง payload จาก selectedImages ที่มีในเวลานั้น → fetch
สำเร็จ → reset ฟอร์ม/ภาพ
```

Local:

```text
เลือกภาพ → validate ชนิด/ขนาด → pendingImages
  → อ่านสำเร็จ: ตรวจ imageGeneration แล้วเพิ่มภาพและแจ้ง dirty
  → อ่านล้มเหลว: เก็บ error และไม่ส่งโดยเงียบ
กดส่ง → รอให้ไม่มี pending/error → ตรวจฟอร์ม → lifecycle.begin()
  → lock controls → ส่ง payload + expected owner
สำเร็จ → recordCommitted() → ยืนยัน session/snapshot → reset เฉพาะชุดเดิม
```

รายละเอียดใหม่ใน `maintenance_requests/script.js`:

- Reset ยกเลิกผล FileReader เก่า ภาพที่อ่านทีหลังไม่กลับมาโผล่ในฟอร์มใหม่
- การลบภาพแจ้ง dirty และไม่อนุญาตเปลี่ยนภาพขณะ busy
- ไฟล์ที่ไม่ผ่าน validation ไม่ล้าง error ของภาพที่อ่านล้มเหลวก่อนหน้า
- ภาพที่เลือกก่อน DOMContentLoaded ถูกส่งให้ handler หลังติดตั้งแล้ว
- หากกดส่งตอนยังอ่านภาพไม่ครบ handler จะแจ้งให้รอและ return; ผู้ใช้กดส่งใหม่หลังอ่านครบ ไม่ได้ auto-submit ต่อเอง
- วันที่เริ่มต้นและวันที่หลัง reset ใช้ Bangkok date
- ข้อความ toast ใส่ผ่าน `textContent`

### 13.2 POST `maintenance_requests/api/submit_maintenance.php`

**เหมือนเดิม:** ตรวจข้อมูล/ทุกภาพก่อนอัปโหลด ใช้ Drive adapter เดิม บันทึกสถานะเริ่มต้น `pending/pending`

**เปลี่ยน:**

1. ตรวจ `_expected_owner` ก่อนงานหลัก
2. คง slow Drive I/O ไว้นอก auth transaction
3. หลังอัปโหลด ตรวจ user/session อีกครั้งผ่าน `app_lock_create_owner(..., 'maintenance_requests')`
4. INSERT และ commit ภายใต้ auth locks สำหรับ guarded/authenticated callers
5. หาก session ถูก revoke สำเร็จก่อนตรวจ/ถือ auth locks ไม่ INSERT และบันทึกงาน `drive_cleanup_required` สำหรับภาพที่อัปโหลดไปแล้ว

การสร้าง cleanup job ไม่ใช่หลักฐานว่าไฟล์ Drive ถูกลบทันที

Guest/direct URL มีขอบเขตเดียวกับข้อ 12.3: UI ใหม่ต้องยืนยันบัญชี แต่ legacy API caller ที่ไม่ส่ง owner ยังมีเส้นทาง anonymous ตามโค้ดเดิม

## 14. แจ้งซ่อม: เจ้าหน้าที่พิจารณาและบันทึกผล

`maintenance_requests/api/update_maintenance.php` ตรงกับ production; การพิจารณา ผู้รับผิดชอบ วัสดุ ผลการซ่อม และ permission เดิมไม่เปลี่ยน

**Client `maintenance_requests/admin.js` เปลี่ยนดังนี้:**

| ส่วน | Production | Local |
|---|---|---|
| เพิ่ม/ลบวัสดุ | เปลี่ยน DOM | ส่ง `eoffice:form-dirty` ด้วย |
| เติมวัสดุจาก snapshot | เติม DOM | passive ไม่ถูกนับเป็นการแก้ |
| เปิด modal ใหม่ | เติมข้อมูล | เพิ่ม generation และแจ้ง clean |
| ส่งซ้ำ | ปิดปุ่ม | มี `savePending` ป้องกัน handler ซ้ำด้วย |
| ตรวจ success | `result.status` | ต้องผ่าน `response.ok` ด้วย |
| ผล save มาหลังแก้เพิ่ม | ปิด modal โดยตรง | ตรวจ revision/generation/snapshot ก่อน clean/close |
| ผล save มาหลังเปิดอีกฟอร์ม | ไม่มี generation guard ใหม่นี้ | ไม่ปิดหรือ clean ฟอร์มใหม่ |

Modal generation เปลี่ยนทั้งตอนเปิดและปิด การยกเลิกหน้าหนึ่งจึงไม่ทำให้ response ของหน้านั้นมีสิทธิ์ควบคุมการเปิดครั้งถัดไป

**ขอบเขต:** เจ้าหน้าที่ form นี้ไม่มี persisted draft หรือ owner boundary ชุดเดียวกับ create forms

## 15. ร่างฟอร์มและการกันส่งซ้ำ: ขอบเขตจริง

### 15.1 ฟอร์มที่รองรับร่าง

มีเฉพาะ `maintenanceForm` และ `bookingForm` บน `/room_booking/new_room.html`

```text
early listeners พร้อม → เปิด controls ให้กรอก
  → ตรวจ session และ claim editor
  → อ่าน baseline draft
  → merge เฉพาะช่องที่ผู้ใช้แก้ก่อน restore
  → sync conditional UI ภายใต้ eofficeDraftRestoring
  → initialized → autosave ข้อความ/ตัวเลือกในแท็บ
```

ไฟล์หลัก: `create-form-lifecycle.js`, `module-drafts.js`, `draft-commits.js`, `form-owner-boundary.js`

### 15.2 Storage keys

```text
eoffice-draft:{owner}:{pathname}:{formId}
eoffice-draft-version:{owner}:{pathname}:{formId}
eoffice-draft-editor:{owner}:{pathname}:{formId}
eoffice-committed:{owner}:{pathname}:{formId}
```

- เก็บใน `sessionStorage` ไม่ใช่ฐานข้อมูลร่างส่วนกลาง
- เก็บข้อความ/select/checkbox/radio; ไม่เก็บ password, hidden fields หรือ file bytes
- ระหว่าง pending/unavailable ไม่เขียนหรือล้างร่างของ owner เดิม จนยืนยันได้
- Editor identity กันหน้าเก่าจาก BFCache เขียนทับร่างของหน้าใหม่ในแท็บเดียวกัน
- Version แยกคำขอใหม่หลัง reset แม้ข้อความจะเหมือนเดิม
- เก็บ commit marker หลังได้รับผล save สำเร็จ เพื่อไม่กู้ร่างชุดที่เสร็จแล้วกลับมาส่งใหม่
- Metadata storage ที่เขียนไม่ได้มี fallback ในหน่วยความจำและข้อความแจ้ง ไม่รับประกันว่าร่างจะทนต่อ reload เมื่อ storage ใช้ไม่ได้

### 15.3 การกันส่งซ้ำไม่ใช่ server idempotency ทุกกรณี

| การป้องกัน | ขอบเขต |
|---|---|
| Busy/singleton | กัน handler ของหน้าเดียวกันเริ่ม request ซ้อน |
| Control lock | ใช้กับสอง create forms ไม่ใช่ทุกฟอร์ม |
| Commit marker | ใช้เมื่อได้รับ success และเก็บสถานะได้ ในแท็บ/owner/form/version นั้น |
| `_expected_owner` | ผูกบัญชีกับ request ไม่ใช่ request UUID สำหรับ deduplicate |

ถ้า server commit แล้วเครือข่ายขาดก่อน browser รับ success หรือผู้ใช้ส่งจากคนละแท็บ ไม่ควรอ้างว่ากลไกนี้รับประกัน exactly-once creation ฝั่ง server

## 16. API contract และฐานข้อมูล

### 16.1 `_expected_owner`

| เงื่อนไข | Local response/พฤติกรรม |
|---|---|
| ค่า owner ที่ส่งเป็นชนิด/รูปแบบไม่ถูกต้อง และผ่าน auth ขั้นต้นที่ endpoint กำหนดแล้ว | `400` |
| มี owner field แต่ไม่มี session ใช้งานได้ | `401` |
| Session เป็นอีกบัญชี | `409`, `code: form_owner_changed` |
| ค้าง auth-guarded create แล้ว session หาย | `401`, `code: session_required` ใน maintenance/booking error path |
| ไม่ส่ง owner field | คง protocol caller เดิม; API เอกสารยังต้อง login ตามเดิม |

Client ใหม่กระตุ้น session refresh เมื่อพบ 401 หรือ owner mismatch

### 16.2 ตารางที่เกี่ยวข้อง

| Workflow | ตารางหลักที่ยังใช้เดิม |
|---|---|
| เอกสาร/ไฟล์/ผู้รับ | `t_document`, `t_document_upload`, `t_access_rights`, `t_access_rights_department` |
| User/session | `t_user`, `eoffice_sessions` |
| ห้อง/สถานที่ | `room_bookings` |
| แจ้งซ่อม | `maintenance_requests` |
| สมาชิก/กลุ่ม/สิทธิ์ | ตารางสมาชิก กลุ่มงาน และ `eoffice_permissions` เดิม |
| Routing/อีเมล/คลัง | ตารางของระบบเดิม โดย core migrations ตรงกับ production |

**ไม่มี schema migration ใหม่จาก workflow patch นี้:** `config/migrations.php` ตรงกับ production ส่วน `scripts/migrate.php` เพิ่ม CLI guard ไม่ได้เพิ่ม DDL ใหม่

## 17. งานเบื้องหลังและบริการภายนอก

ตรวจ source PHP/shell ใน `scripts/` จริงอีก 13 เส้นทาง พบ 12 เส้นทางตรงกับ local:

- `backup.php`, `cron-health.php`
- `drive-archive-cron.sh`, `drive-archive.php`
- `encrypted-file.php`
- `notifications.php`
- `order-cron.sh`, `order-emails.php`
- `restore-database.php`, `restore-drive.php`
- `router.php`, `scheduled-jobs.php`

Workflow scheduler ที่ยังเหมือนเดิม:

```text
Cron launcher → scheduled-jobs.php
  → order worker
  → ถ้าเปิด Drive archive: drive worker
  → หลัง 02:00 ตามเวลาของ runtime: ตรวจ/ทำ daily backup
```

`config/services.php`, `config/order-emails.php`, archive helpers/worker และ APIs สถานะที่อยู่ในขอบเขตตรวจตรงกัน

**ผล:** ไม่พบการเปลี่ยนโมเดล AI, SMTP transport, Push worker, policy backup/eviction หรือรอบ cron ใน source patch นี้ แต่ค่าตั้งจริง/สถานะ heartbeat ปัจจุบันไม่ได้ยืนยันจาก private config หรือการเรียกงานจริงรอบนี้

### CLI migration ที่เปลี่ยน

- เพิ่ม `php scripts/migrate.php --test`
- ต้องมี `TEST_DATABASE` ลงท้าย `_test` และ `EOFFICE_MOCK_SERVICES=true`
- หากตั้ง `TEST_DATABASE` แต่ไม่มี `DB_DATABASE` และไม่ใช้ `--test` จะปฏิเสธก่อนเข้า bootstrap
- คำสั่งปกติที่เลือก environment ชัดเจนยังใช้ migration engine เดิม

## 18. ความเข้ากันได้เมื่อเผยแพร่

| Frontend | Backend | ผลจาก contract ที่อ่านได้ |
|---|---|---|
| เก่า | เก่า | Production ปัจจุบัน |
| เก่า | ใหม่ | รองรับ protocol เดิมที่ไม่ส่ง owner; response ไฟล์มี fields เพิ่ม |
| ใหม่ | ใหม่ | ชุดที่ทดสอบใน local |
| ใหม่ | เก่า | ไม่ใช่ชุดที่สมบูรณ์: owner ไม่ถูกตรวจแบบใหม่และ file receipts ยังไม่มี |

**ตัวอย่างที่เป็น dependency จริง:** frontend ใหม่เรียก `reconcileDocumentFiles()` ซึ่งต้องได้ `files.entries` / `files.imported` แต่ API เก่าส่งเพียง `files.status` จึงอาจบันทึก server ไปแล้ว แต่ frontend แจ้งว่าซิงก์ผลไม่ครบ

ดังนั้นขอบเขต release ต้องรวม:

1. Backend ที่เปลี่ยน: bootstrap และสาม create/save APIs
2. Runtime helper ใหม่ 9 ไฟล์
3. HTML/JS/CSS ที่อ้าง helper และ shell ชุดใหม่
4. CLI migration guard หากต้องการให้ tooling ตรงกับ commit

คง private config/storage และ legacy drift เป็นคนละส่วนจากไฟล์ patch; rollback ต้องคำนึงถึง frontend/API contract ที่เข้าคู่กันด้วย

## 19. หลักฐานการทดสอบและสิ่งที่ยังไม่สรุปเกินขอบเขต

### ผลในรอบเปรียบเทียบก่อนหน้า โดย runtime ยังเป็น commit เดียวกัน

| หลักฐาน | ผล |
|---|---|
| Integration script ของ baseline `60a23f5` กับ baseline runtime | 42/42 ผ่าน |
| Script เดียวกันกับ local runtime ปัจจุบัน | 42/42 ผ่าน |
| `npm.cmd test` ของ candidate | ผ่านครบ รวม integration 44, document/session races 12 |
| `npm.cmd run test:drive` | 45 archive behavior checks และชุด HTTP/cache/signing/scheduler/Apps Script ผ่าน |
| Browser local | เปิด 11 หน้าและ same-origin assets ได้; สร้างเอกสาร จองห้อง และแจ้งซ่อมผ่านฟอร์มจริงสำเร็จ |
| Production read-only | หน้าหลัก/โมดูลตอบได้, public API ไม่ส่ง private fields และ protected APIs ปฏิเสธ guest |

ในรอบเปรียบเทียบล่าสุดนี้ดึง source ใหม่และยืนยันว่า production ยังเป็นชุดเดิม จึงแยกผล source inspection วันที่ 14 ต.ค. ออกจากผล integration/browser ที่บันทึกไว้ในรอบก่อน

### ยังไม่ใช่หลักฐานต่อไปนี้

- ไม่ใช่ UAT ของบุคลากรทุกบทบาทกับข้อมูลจริงทั้งหมด
- ไม่ใช่การส่งอีเมล/Push หรืออัปโหลด Drive จริงบน candidate ที่ deploy แล้ว
- ไม่ใช่การยืนยัน Google consent/callback ด้วยบัญชีจริงครบวงจร
- ไม่ใช่การวัด load/performance ของ hosting หลัง deploy
- การเทียบ `.htaccess` ไม่เท่ากับการตรวจ hosting configuration ทั้งหมด

**ข้อสรุป:** ฟังก์ชันธุรกิจเดิมที่มีหลักฐานทดสอบยังทำงานได้ ส่วนความต่างหลักอยู่ที่ navigation, client session/dirty/draft state และการคุ้มครอง create/save ไม่ควรสรุปเพียงว่า “เปลี่ยน UI แต่ทุกอย่างเหมือนเดิม”

## ภาคผนวก A — รายการไฟล์ที่ต่างจริงจาก production

### A.1 ไฟล์เดิมที่ต่างและ production ตรงกับ `60a23f5` — 29 ไฟล์

| กลุ่ม | ไฟล์ |
|---|---|
| Main/navigation | `index.php`, `assets/main.js`, `assets/api-service.js`, `assets/style_main.css` |
| เอกสาร | `api/create_document.php`, `assets/utils.js` |
| Shared backend | `config/bootstrap.php` |
| สมาชิก/กลุ่ม/Auto send | `management/user_manage.html`, `management/department_manage.html`, `assets/member-management.js`, `assets/sign-routing-management.js` |
| จองเลขคำสั่ง | `external_number_booking/external_number_booking.html` |
| อีเมล/AI | `email_send/doc_send_email.html`, `email_send/my_dashboard.html`, `email_send/ai_settings.html`, `email_send/order-dashboard.js`, `email_send/order-dashboard.css`, `email_send/ai-settings.js`, `email_send/ai-settings.css` |
| ห้อง/สถานที่ | `room_booking/index.html`, `room_booking/new_room.html`, `room_booking/edit_room_booking.html`, `room_booking/api/room_booking.php` |
| แจ้งซ่อม | `maintenance_requests/index.html`, `maintenance_requests/script.js`, `maintenance_requests/style.css`, `maintenance_requests/api/submit_maintenance.php`, `maintenance_requests/admin.html`, `maintenance_requests/admin.js` |

### A.2 Runtime ใหม่ที่ไม่มีบน production — 9 ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `assets/app-navigation.js` | Shared shell, session publishing, navigation/dirty/logout guards |
| `assets/app-navigation.css` | Layout/sidebar/mobile/container styling |
| `assets/create-form-lifecycle.js` | Early edits, busy/control locks, snapshot-aware create flow |
| `assets/document-file-state.js` | Capture/reconcile file-save receipts |
| `assets/document-form-guard.js` | Dirty/revision/generation ของฟอร์มเอกสารหลัก |
| `assets/draft-commits.js` | Draft version/editor/commit-marker authority |
| `assets/form-dates.js` | Bangkok date, date arithmetic และ booking bounds |
| `assets/form-owner-boundary.js` | Owner conflict และรอยืนยันบัญชีก่อนใช้ผล save |
| `assets/module-drafts.js` | Restore/merge/persist สอง create forms |

### A.3 CLI ที่ต่าง — 1 ไฟล์

`scripts/migrate.php` — เพิ่ม guard การเลือกฐานทดสอบ; production ตรงกับ `60a23f5`

### A.4 Legacy drift — 2 ไฟล์

- `assets/php_function.php`
- `email_send/process_pdf_bup.php`

Source production ของสองไฟล์นี้ไม่ตรงทั้ง local และ baseline ที่ใช้เทียบ จึงไม่รวมเป็น workflow change ใหม่ของ `461af0c` และไม่ควรนำไป overwrite จากสมมติฐานว่าเป็นส่วนของ patch ปัจจุบัน

ไม่พบ active caller ที่อ้างชื่อสองไฟล์นี้ใน application source ที่ตรวจ และ `.htaccess` มี rule ปิด `email_send/process_pdf_bup.php` โดยตรง รายงานนี้ไม่คัดลอก legacy source หรือค่าลับมาไว้ใน repository

### A.5 Template ที่ไม่มีบน production — 1 ไฟล์

`config/production.example.php` เป็นตัวอย่าง configuration ไม่ใช่ private config ที่ใช้งานจริง และไม่ใช่ runtime dependency ที่ต้องสร้างบน production เพื่อให้ workflow นี้ทำงาน

## ภาคผนวก B — หลักฐานและไฟล์อ้างอิง

ไฟล์ snapshot/source ที่ดึงอยู่ในพื้นที่ Temp ส่วนตัว ไม่อยู่ใน Git:

- `eoffice-workflow-code-comparison-20261014/comparison.json` — 152 เส้นทางเว็บพร้อม SHA-256
- `eoffice-workflow-code-comparison-20261014/metadata.json` — manifest commit และผล directory listing
- `eoffice-workflow-cli-comparison-20261014/comparison.json` — 13 เส้นทาง CLI

โฟลเดอร์ฐาน: `C:\Users\arm_m\AppData\Local\Temp\opencode`

Tests ที่อ้างอิงพฤติกรรมใหม่โดยตรง:

- [module-navigation.cjs](tests/module-navigation.cjs)
- [create-form-lifecycle.cjs](tests/create-form-lifecycle.cjs)
- [form-dates.cjs](tests/form-dates.cjs)
- [maintenance-admin-ui.cjs](tests/maintenance-admin-ui.cjs)
- [integration.cjs](tests/integration.cjs)
- [document-races.cjs](tests/document-races.cjs)
- [member-ui.cjs](tests/member-ui.cjs)
- [order-email-ui.cjs](tests/order-email-ui.cjs)

ภาพรวมการทำงาน: [WORKFLOW_PRESENTATION.md](WORKFLOW_PRESENTATION.md)

ผลทดสอบโครงการ: [TEST_REPORT.md](TEST_REPORT.md)

ประวัติ deployment: [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md)
