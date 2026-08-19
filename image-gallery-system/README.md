# Image Gallery & Download System (Google Apps Script)

ระบบจัดการและเก็บภาพ ใช้ **Google Sheets** เป็นฐานข้อมูล และ **Google Drive** เก็บไฟล์ภาพ
รองรับผู้ใช้หลายคนเข้าดู/ดาวน์โหลดพร้อมกัน และมี Dashboard สถิติการดาวน์โหลดสำหรับแอดมิน

## ไฟล์ในโปรเจกต์

| ไฟล์ | หน้าที่ |
|---|---|
| `Code.gs` | Backend ทั้งหมด (อ่าน/เขียน Sheets, อัปโหลด/ลบไฟล์ใน Drive, auth แอดมิน, `doGet()`) |
| `index.html` | โครงหน้าเว็บหลัก (gallery, lightbox, หน้าแอดมิน) |
| `style.html` | CSS ทั้งหมด — ถูก include เข้า `index.html` |
| `script.html` | JavaScript ฝั่ง client ทั้งหมด — ถูก include เข้า `index.html` |
| `appsscript.json` | Manifest ของโปรเจกต์ (scopes, webapp config) |

---

## ขั้นตอนติดตั้ง

### 1. สร้าง Google Sheet สำหรับเป็นฐานข้อมูล
1. ไปที่ [sheets.google.com](https://sheets.google.com) สร้างสเปรดชีทใหม่ ตั้งชื่อเช่น `Image Gallery DB`
2. ไม่ต้องสร้างชีท/หัวตารางเอง — ระบบจะสร้างชีท `Images` และ `Downloads` พร้อม header ให้อัตโนมัติในการรันครั้งแรก
3. คัดลอก **Spreadsheet ID** จาก URL (ส่วนที่อยู่ระหว่าง `/d/` กับ `/edit`)
   ```
   https://docs.google.com/spreadsheets/d/  SPREADSHEET_ID_ตรงนี้  /edit
   ```

### 2. สร้างโฟลเดอร์ Google Drive สำหรับเก็บไฟล์ภาพ
1. ไปที่ [drive.google.com](https://drive.google.com) สร้างโฟลเดอร์ใหม่ เช่น `Image Gallery Files`
2. เปิดโฟลเดอร์แล้วคัดลอก **Folder ID** จาก URL
   ```
   https://drive.google.com/drive/folders/  FOLDER_ID_ตรงนี้
   ```

### 3. สร้างโปรเจกต์ Apps Script
1. ไปที่ [script.google.com](https://script.google.com) → New project
2. ตั้งชื่อโปรเจกต์ เช่น `Image Gallery`
3. สร้างไฟล์ตามรายการด้านบน แล้ววางเนื้อหาจากแต่ละไฟล์ในโฟลเดอร์นี้ให้ตรงกัน:
   - `Code.gs` (ไฟล์เริ่มต้นของโปรเจกต์ แก้ชื่อ/แทนที่เนื้อหาไฟล์ `Code.gs` เดิมได้เลย)
   - เพิ่มไฟล์ HTML ใหม่ 3 ไฟล์ชื่อ `index`, `style`, `script` (เลือกประเภทไฟล์เป็น HTML ตอนสร้าง)
   - เปิด **Project Settings → Show "appsscript.json" manifest file** แล้ววางเนื้อหาจาก `appsscript.json`

### 4. ตั้งค่า Script Properties (แทนการฝังค่าไว้ในโค้ด)
ไปที่ **Project Settings (⚙️) → Script Properties → Add script property** แล้วเพิ่ม:

| Key | Value |
|---|---|
| `SPREADSHEET_ID` | ไอดีจากขั้นตอนที่ 1 |
| `DRIVE_FOLDER_ID` | ไอดีจากขั้นตอนที่ 2 |

*(ค่า `ADMIN_TOKEN_SECRET` ระบบจะสุ่มสร้างให้อัตโนมัติในการรันครั้งแรก ไม่ต้องตั้งเอง)*

### 5. ตั้งรหัสผ่านแอดมิน
1. กลับไปที่ไฟล์ `Code.gs` ในตัวแก้ไข Apps Script
2. เลือกฟังก์ชัน `setAdminPassword_` จาก dropdown ด้านบน (ข้าง Run/Debug)
3. แก้บรรทัดล่างสุดของไฟล์ชั่วคราว (หรือใช้ตัว **Execution log**) โดยรันคำสั่งนี้ผ่านแท็บ **Execute function** ชั่วคราว:
   - วิธีง่ายสุด: ไปที่เมนู `Editor → Execute → setAdminPassword_` แล้วในหน้าต่างที่เปิดขึ้นให้ใส่พารามิเตอร์เป็นรหัสผ่านที่ต้องการ เช่น `"MySecret123"`
   - หรือแก้โค้ดชั่วคราวเพิ่มบรรทัด `setAdminPassword_('MySecret123');` ไว้นอกฟังก์ชันแล้วรันครั้งเดียว จากนั้นลบทิ้ง
4. อนุมัติสิทธิ์ (OAuth consent) ที่ Google ถามตอนรันครั้งแรก (ต้องใช้สิทธิ์ Sheets/Drive)
5. ตรวจใน Script Properties ว่ามีคีย์ `ADMIN_PASSWORD_HASH` ถูกสร้างขึ้นแล้ว

### 6. ตรวจสอบการเชื่อมต่อ Spreadsheet (ทางเลือก)
รันฟังก์ชัน `setupSpreadsheet_` หนึ่งครั้งเพื่อให้ระบบสร้างชีท `Images`/`Downloads` ล่วงหน้า และยืนยันว่า `SPREADSHEET_ID` ถูกต้อง (ดู URL ที่พิมพ์ใน Execution log)

### 7. Deploy เป็น Web App
1. มุมขวาบน กด **Deploy → New deployment**
2. เลือกประเภท **Web app**
3. ตั้งค่า:
   - **Execute as**: Me (บัญชีของคุณ — เพื่อให้ทุกคนที่เข้าเว็บใช้สิทธิ์เดียวกันในการอ่าน Sheet/Drive)
   - **Who has access**: Anyone
4. กด **Deploy** แล้วอนุมัติสิทธิ์อีกครั้งถ้าถูกถาม
5. คัดลอก **Web app URL** ที่ได้ — นี่คือลิงก์เว็บแอปสำหรับผู้ใช้ทั่วไป

> ทุกครั้งที่แก้โค้ดแล้วต้องการให้ผู้ใช้เห็นเวอร์ชันใหม่ ต้องทำ **Deploy → Manage deployments → Edit (ไอคอนดินสอ) → Version: New version → Deploy** ใหม่ (แก้โค้ดอย่างเดียวโดยไม่ deploy ใหม่จะไม่มีผลกับ URL เดิม)

### 8. ทดสอบใช้งาน
- เปิด Web app URL → ควรเห็นหน้าแกลเลอรี (ว่างเปล่าในตอนแรก)
- เข้าสู่โหมดแอดมิน: กดปุ่ม **แอดมิน** มุมขวาบน หรือเปิด `WEB_APP_URL?page=admin` เพื่อให้เปิดหน้าล็อกอินอัตโนมัติ ใส่รหัสผ่านที่ตั้งไว้ในขั้นตอนที่ 5
- ทดลองอัปโหลดภาพ → ไฟล์จะถูกอัปโหลดเข้าโฟลเดอร์ Drive ที่ตั้งไว้ และตั้งสิทธิ์เป็น "ใครก็ตามที่มีลิงก์ดูได้" ให้อัตโนมัติ
- กลับหน้าแกลเลอรีสาธารณะ ลองค้นหา/เรียงลำดับ/ดาวน์โหลด ดูว่ายอดดาวน์โหลดขึ้นถูกต้อง

---

## หมายเหตุด้านความปลอดภัยและข้อจำกัดของ Apps Script

- **Token แอดมิน**: หลังใส่รหัสผ่านถูกต้อง ระบบจะออก token ที่เซ็นด้วย HMAC (อายุ 4 ชั่วโมง) เก็บไว้ในหน่วยความจำฝั่ง client เท่านั้น (ไม่เก็บใน localStorage) ทุกคำสั่งที่ต้องใช้สิทธิ์แอดมิน (อัปโหลด/ลบ/ดูสถิติ) ต้องแนบ token นี้ และถูกตรวจสอบซ้ำที่ฝั่งเซิร์ฟเวอร์ทุกครั้ง
- **ป้องกันนับดาวน์โหลดซ้ำ**: ใช้ `CacheService` ทำ throttle ต่อผู้ใช้ + ต่อภาพ (ค่าเริ่มต้น 30 วินาที ปรับได้ที่ `CONFIG.DOWNLOAD_THROTTLE_SECONDS` ใน `Code.gs`) โดยใช้ `Session.getTemporaryActiveUserKey()` (Apps Script เข้าไม่ถึง IP จริงของผู้ใช้) แล้วแฮชด้วย SHA-256 ก่อนบันทึกลงคอลัมน์ `ipHash`
- **ขนาดไฟล์/เวลาทำงาน**: ฝั่ง frontend อัปโหลดไฟล์ **ทีละไฟล์ตามลำดับ** (ไม่ใช่พร้อมกัน) เพื่อเลี่ยงข้อจำกัด payload และ execution time 6 นาทีของ Apps Script — ถ้าอัปโหลดไฟล์ใหญ่มากหรือหลายสิบไฟล์พร้อมกัน อาจต้องรอสักครู่
- **การอ่าน/เขียนชีท**: ทุกฟังก์ชันอ่าน/เขียนแบบ batch (`getValues()` / `setValues()` ครั้งเดียว) ไม่ loop เขียนทีละ cell เพื่อความเร็ว

## การปรับแต่งเพิ่มเติม
- เปลี่ยนจำนวนภาพต่อหน้า: แก้ `CONFIG.PAGE_SIZE_DEFAULT` ใน `Code.gs`
- เปลี่ยนอายุ token แอดมิน: แก้ `CONFIG.ADMIN_TOKEN_TTL_MS`
- เปลี่ยนรหัสผ่านแอดมินภายหลัง: รัน `setAdminPassword_('รหัสใหม่')` อีกครั้งได้ทุกเมื่อ
