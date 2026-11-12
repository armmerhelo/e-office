# e-sign v2 (ทดลอง)

หน้าลงนามเวอร์ชันทดลองแบบแยกไฟล์ ทำงานคู่กับหน้าลงนามเดิมโดยไม่แก้ไข
`e-sign/e-sign.php` หรือ `e-sign/upload_pdf.php`

## เปิดใช้งาน

ใช้พารามิเตอร์ชุดเดียวกับหน้าเดิม:

```text
e-sign/esign-v2.php?Doc_Id=<ID>&File_Path=<FILE>&Year=<YEAR>
```

ถ้าไม่ส่ง `File_Path` ระบบจะเลือกไฟล์แนบแรกของเอกสาร และ `Year` จะถูกอ่านจาก
ฐานข้อมูลเพื่อป้องกันปีที่ไม่ตรงกับเอกสารจริง

## สิ่งที่ต่างจากหน้าเดิม

- PDF แต่ละหน้าถูก render เมื่อใกล้พื้นที่มองเห็นเท่านั้น หน้าที่ย้ายออกไกลจะถูก
  คืนหน่วยความจำและ render ใหม่เมื่อกลับมา
- ลายเซ็น/เส้นปากกาเก็บเป็นจุดในหน่วย page-normalised และ export เป็นเส้นเวกเตอร์
  ใน PDF ด้วย PDF-lib ไม่มีการฝัง PNG เต็มหน้า
- ยางลบเป็นแบบลบทั้งเส้น (vector 100%) ไม่ใช่ลบเป็นพิกเซล
- ตราประทับยังเป็น PNG ที่สร้างจาก canvas แต่จัดตำแหน่งและหมุนตาม page rotation
  0/90/180/270
- ตรวจจับปากกา/นิ้ว/ฝ่ามือ:
  - ปากกาวาดได้เสมอ
  - เมื่อตรวจพบปากกาครั้งแรก จะรับเฉพาะปากกา (นิ้วใช้เลื่อน/ซูม) จนกว่าจะกดปุ่ม
    “นิ้ววาดได้” ในหัวหน้า
  - touch ที่มีพื้นที่สัมผัสใหญ่หรือมีหลายจุดพร้อมกันจะไม่สร้างเส้น
- ใช้ asset local (`assets/fonts`, `assets/ui-buttons.css`, `stamp-render-queue.js`)
  และ vendor PDF.js/PDF-lib ไว้ใต้ `e-sign/v2/vendor/`

## ข้อจำกัด

- หน้า PDF ยังถูกวาดลง canvas โดย PDF.js (ไม่ใช่ SVG) แต่ overlay ลายเซ็นเป็น
  vector และ export เป็น vector
- การทดสอบฝ่ามือจริงต้องใช้ iPad/แท็บเล็ตที่มีปากกา ไม่สามารถจำลองด้วยเมาส์ได้
- ตราประทับยังไม่เป็น vector เพราะต้นฉบับเป็นภาพ PNG

## ทดสอบในเครื่อง

ต้องมี PHP และ MySQL ตาม `config/local.php` หรือ environment variables:

```powershell
$env:DB_DATABASE='eoffice_review_test'
$env:APP_URL='http://localhost:8313'
$env:EOFFICE_MOCK_SERVICES='true'
php -S localhost:8313 scripts/router.php
```

จากนั้นเปิด URL ข้างต้นด้วยบัญชีทดสอบ และรัน:

```powershell
php -l e-sign/esign-v2.php
node tests/esign-v2.cjs
node tests/check-syntax.cjs
```

## Deployment

ไฟล์ที่ต้อง publish:

- `e-sign/esign-v2.php`
- `e-sign/v2/*.js`
- `e-sign/v2/ui.css`
- `e-sign/v2/vendor/*.js`
- `assets/ui-buttons.css` และ `assets/fonts/sarabun/Sarabun-{Regular,Bold}.ttf`
  (ถ้าเซิร์ฟเวอร์ปลายทางยังไม่มี)

ชื่อไฟล์ต้องขึ้นต้นด้วย `esign-` ไม่ใช่ `e-sign-` เพราะตัวกรอง deployment
ข้ามไฟล์ `e-sign/e-sign*.php` และ `.htaccess` บล็อกไฟล์ legacy บางชื่อ
