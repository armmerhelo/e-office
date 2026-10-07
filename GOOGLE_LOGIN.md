# ตั้งค่าการเข้าสู่ระบบด้วย Google

บัญชี Google ที่มีอีเมลตรงกับบัญชี E-Office เดิมเข้าสู่ระบบได้ทุกโดเมน โดยคงชื่อ สิทธิ์ กลุ่มงาน และข้อมูลเดิม บัญชี Google Workspace `@siya.ac.th` ที่ยังไม่มีข้อมูลจะเข้าสู่หน้าลงทะเบียน โดยดึงชื่อจาก Google ให้แก้ไขได้ และสร้างสมาชิกสิทธิ์ `User` หลังผู้ใช้ยืนยันชื่อและยอมรับข้อตกลง อีเมลโดเมนอื่นที่ยังไม่มีบัญชีไม่สามารถสมัครสมาชิกผ่าน Google ได้

สำหรับบัญชีเดิมที่ใช้ Gmail หรือ Google Workspace ที่มี `hd` ตรงกับโดเมนอีเมล ระบบผูกบัญชีได้ทันที ส่วน Google Account ที่ใช้อีเมลจากผู้ให้บริการภายนอกและไม่มี Workspace domain ต้องยืนยันรหัสผ่าน E-Office ครั้งแรกก่อนผูกบัญชี เนื่องจาก `email_verified` เพียงอย่างเดียวไม่ยืนยันการครอบครองอีเมลภายนอกในปัจจุบัน หลังผูกแล้วเข้าสู่ระบบด้วย Google ได้โดยไม่ต้องกรอกรหัสผ่านอีก

**สถานะ production (7 ตุลาคม 2026):** เปิดใช้งานบน `https://e-office.siya.ac.th/` แล้ว ตั้งค่า OAuth และ migration สำเร็จ ตรวจปุ่มเปิดหน้า Google ได้ และ production smoke ผ่าน 12 รายการ การลงชื่อเข้าใช้ด้วยบัญชี Google จริงจนกลับเข้าเว็บรอเจ้าของบัญชีทดลอง

## 1. สร้าง OAuth Client

1. เปิด [Google Cloud Console](https://console.cloud.google.com/) แล้วเลือก/สร้างโปรเจกต์ของโรงเรียน
2. ไปที่ **Google Auth Platform** ตั้งค่า **Branding** (ชื่อ E-Office, support email และข้อมูลติดต่อ)
3. ตั้งค่า **Audience เป็น External** เพื่อรองรับบัญชีอีเมลนอกโรงเรียน หากยังเป็น **Testing** ให้เพิ่มบัญชีที่จะทดลองใน Test users; Internal จะอนุญาตเฉพาะบัญชีขององค์กรเดียวกัน
4. เลือก scope `openid`, `email` และ `profile` ใน **Data Access** เพื่ออ่านอีเมลและชื่อ
5. ไปที่ **Clients → Create client** แล้วเลือก **Web application**
6. เพิ่ม **Authorized redirect URIs** ให้ตรงกับเว็บที่จะใช้งาน:

   | เว็บ | Redirect URI |
   | --- | --- |
   | Production | `https://e-office.siya.ac.th/api/auth_google_callback.php` |
   | Staging | `https://e-office-test.siya.ac.th/api/auth_google_callback.php` |
   | Local (ตัวอย่างพอร์ต 8080) | `http://localhost:8080/api/auth_google_callback.php` |

   ต้องตรงทั้ง scheme, hostname, port และ path ไม่เติม `/` ท้าย callback ใช้ `localhost` ให้สอดคล้องกันทั้งตอนเปิดเว็บและ `APP_URL`
7. เก็บ **Client ID** และ **Client secret** ไว้ตั้งค่าบนเซิร์ฟเวอร์

## 2. ตั้งค่าเซิร์ฟเวอร์

ใส่ค่าใน environment หรือ `config/local.php` ที่มีอยู่ โดยเพิ่ม keys เหล่านี้เข้าไปใน array เดิม:

```php
'APP_URL' => 'https://e-office.siya.ac.th',
'GOOGLE_CLIENT_ID' => 'YOUR_CLIENT_ID.apps.googleusercontent.com',
'GOOGLE_CLIENT_SECRET' => 'YOUR_CLIENT_SECRET',
```

สำหรับ local เปลี่ยน `APP_URL` เป็น URL พร้อมพอร์ตที่ใช้งานจริง เช่น `http://localhost:8080` ดูตัวอย่าง config ใน `config/local.example.php` และ `config/production.example.php` เก็บ secret เฉพาะ environment หรือ `config/local.php` ไม่ใส่ใน JavaScript หรือ commit ลง Git

รัน migration บนฐานข้อมูลของ environment นั้น:

```sh
php scripts/migrate.php
```

Migration เพิ่มตาราง `eoffice_google_accounts` สำหรับผูก Google ID (`sub`) กับบัญชี ครั้งถัดไปตรวจ Google ID และอีเมลตรงกับบัญชีเดิม ป้องกัน Google ID ใหม่เข้าบัญชีที่เคยผูกไว้ เมื่อผู้ดูแลลบบัญชี E-Office การผูกจะถูกลบตาม หากต้องเปลี่ยนบัญชี Google ที่ผูกอยู่ ผู้ดูแลต้องตรวจสอบตัวตนและลบการผูกเก่าจากตารางนี้ก่อน

ผู้ใช้โรงเรียนใหม่จะได้รับรหัสผ่าน hash จากค่า random ที่ไม่เปิดเผย โดยเข้าใช้ผ่าน Google ได้ทันทีหลังลงทะเบียน หากต้องการเข้าใช้ด้วยรหัสผ่าน ผู้ดูแลสามารถตั้งรหัสผ่านผ่านระบบจัดการสมาชิกเดิมได้

PHP ต้องมี session และ cURL พร้อม CA certificates ที่ใช้งานได้ และเซิร์ฟเวอร์ต้องเชื่อมต่อ HTTPS ไปที่ `oauth2.googleapis.com` ได้ หากมีหลาย web servers ให้ใช้ session storage ร่วมกันหรือ sticky sessions

ปุ่ม **เข้าสู่ระบบด้วย Google** จะแสดงเมื่อมีทั้ง Client ID และ Client secret แล้ว ไม่ขึ้นกับ `EOFFICE_MOCK_SERVICES` การล็อกอิน Google ใช้บริการจริงเสมอ

## 3. ตรวจสอบหลังตั้งค่า

1. เปิดเว็บแบบยังไม่ล็อกอิน กด **เข้าสู่ระบบด้วย Google** และเลือกบัญชีโรงเรียนที่ลงทะเบียนไว้
2. ตรวจว่ากลับมาหน้าเว็บพร้อมชื่อและสิทธิ์เดิม ทั้งผู้ใช้ทั่วไปและ Admin
3. ทดลองยกเลิกหน้า Google แล้วตรวจข้อความที่หน้าล็อกอิน
4. ทดลองบัญชีโรงเรียนใหม่: ชื่อจาก Google ต้องแสดงให้แก้ไข และต้องยอมรับข้อตกลงก่อนสร้างสมาชิกสิทธิ์ User
5. ทดลองบัญชีนอกโรงเรียนที่มีในระบบ: ต้องใช้สิทธิ์เดิม; อีเมลภายนอกที่ Google ไม่ได้ดูแลต้องยืนยันรหัสผ่าน E-Office ครั้งแรก ส่วนอีเมลนอกโรงเรียนที่ไม่มีข้อมูลต้องเข้าไม่ได้
6. ทดลองเข้าจากลิงก์เอกสาร `/?id=123` หลังล็อกอิน/ลงทะเบียนต้องกลับมาที่เอกสารเดิม
7. ออกจากระบบแล้วตรวจว่า session เข้า API ไม่ได้ รวมถึงทดลองล็อกอินด้วยรหัสผ่านเดิม

## การป้องกันที่ใช้

- Authorization Code flow พร้อม PKCE S256, state และ nonce แบบสุ่ม อายุคำขอ 10 นาที ใช้ callback ได้ครั้งเดียว
- รับ ID token เฉพาะจาก token endpoint ของ Google ผ่าน verified TLS โดยเซิร์ฟเวอร์แลก code ด้วย Client secret ตาม [แนวทาง Google สำหรับ server flow](https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo) ไม่รับ ID token หรืออีเมลจาก browser เพื่อใช้ล็อกอิน
- ตรวจ issuer, audience, authorized presenter, expiration, nonce, verified email และ Workspace domain (`hd`) สำหรับบัญชีโรงเรียน
- Onboarding เก็บอีเมล/Google ID ใน server session อายุ 10 นาที ใช้ CSRF token และไม่รับ role, email หรือ Google ID จากข้อมูลฟอร์ม การสร้าง user, binding และ authenticated session ทำใน transaction เดียวกัน
- การผูกอีเมลภายนอกครั้งแรกใช้ password verification และ rate limit เดียวกับ password login
- ใช้ session token แบบ HttpOnly ของระบบเดิม ไม่บันทึก Google access/ID token และไม่ขอสิทธิ์ Drive หรือ refresh token
- Redirect กลับเฉพาะ `APP_URL` ไม่รับ URL ปลายทางจากผู้ใช้

## ทดสอบโค้ด

```sh
npm run test:google
npm test
```

`test:google` ทดสอบ state/replay, PKCE, claims และการผูกบัญชีด้วย SQLite ชั่วคราว รวมถึง onboarding/linking ผ่าน HTTP บนฐานข้อมูล `_test` โดยสร้าง verified pending session เฉพาะจาก CLI fixture ที่เข้าถึงไม่ได้จากเว็บ ไม่ใช้ credentials จริง การเลือกบัญชีและ consent จริงต้องทดสอบด้วย OAuth Client ที่ตั้งค่าตามขั้นตอนด้านบน

`npm test` ตรวจ secrets ด้วย repository จำลองด้วย เพื่อยืนยันว่า Google Client Secret ถูกปฏิเสธจาก staged blobs โดยไม่พิมพ์ค่าลับ และ `config/local.php` ไม่สามารถผ่านตัวตรวจ staged files ได้ PHP สำหรับรัน tests ต้องมี PDO SQLite เพิ่มเติมจาก extensions ที่ production ใช้
