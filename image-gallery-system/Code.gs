/**
 * =============================================================================
 * Image Gallery & Download System
 * Backend (Google Apps Script) — Code.gs
 *
 * Database : Google Sheets  ("Images", "Downloads")
 * Storage  : Google Drive   (one dedicated folder)
 * Frontend : index.html (+ style.html, script.html included via include())
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// CONFIG
// -----------------------------------------------------------------------------
// วิธีตั้งค่า: เปิด Project Settings > Script Properties แล้วเพิ่มคีย์ต่อไปนี้
//   SPREADSHEET_ID   = ไอดีของ Google Sheet ที่ใช้เป็นฐานข้อมูล
//   DRIVE_FOLDER_ID  = ไอดีของโฟลเดอร์ Google Drive ที่ใช้เก็บไฟล์ภาพ
//   ADMIN_PASSWORD_HASH = ค่าแฮชของรหัสผ่านแอดมิน (ตั้งด้วยฟังก์ชัน setAdminPassword_ ด้านล่าง)
//   ADMIN_TOKEN_SECRET  = สตริงลับสำหรับเซ็น token ของแอดมิน (ตั้งครั้งเดียว, สุ่มค่าอะไรก็ได้ที่ยาวพอ)
// ถ้าไม่อยากใช้ Script Properties ก็แก้ค่า fallback ตรงนี้ได้โดยตรง (ไม่แนะนำสำหรับ production)
const CONFIG = {
  SPREADSHEET_ID: PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || 'PUT_YOUR_SPREADSHEET_ID_HERE',
  DRIVE_FOLDER_ID: PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID') || 'PUT_YOUR_DRIVE_FOLDER_ID_HERE',
  IMAGES_SHEET: 'Images',
  DOWNLOADS_SHEET: 'Downloads',
  PAGE_SIZE_DEFAULT: 24,
  DOWNLOAD_THROTTLE_SECONDS: 30, // กันนับดาวน์โหลดซ้ำถ้ากดรัวภายในกี่วินาที
  ADMIN_TOKEN_TTL_MS: 4 * 60 * 60 * 1000 // token ของแอดมินอยู่ได้ 4 ชั่วโมง
};

const IMAGES_HEADERS = ['id', 'fileId', 'fileName', 'title', 'description', 'tags', 'mimeType', 'fileSize', 'uploadedAt', 'downloadCount'];
const DOWNLOADS_HEADERS = ['id', 'imageId', 'downloadedAt', 'ipHash', 'userAgent'];

// -----------------------------------------------------------------------------
// WEB APP ENTRY POINT
// -----------------------------------------------------------------------------

/**
 * จุดเริ่มต้นของเว็บแอป — เสิร์ฟหน้า index.html
 * รองรับ query string ?page=admin เผื่ออยากเปิดตรงไปหน้าแอดมิน (ฝั่ง client เป็นคนอ่าน param นี้)
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('index');
  template.initialPage = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'gallery';

  return template.evaluate()
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setTitle('Image Gallery')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Helper สำหรับรวมไฟล์ HTML ย่อย (style.html, script.html) เข้ากับ index.html
 * ใช้ผ่าน template syntax: <?!= include('style'); ?>
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// -----------------------------------------------------------------------------
// SHEET HELPERS
// -----------------------------------------------------------------------------

/** เปิด Spreadsheet ตาม ID ที่ตั้งไว้ */
function getSpreadsheet_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

/**
 * คืนชีทที่ต้องการ พร้อมสร้างชีทและ header ให้อัตโนมัติถ้ายังไม่มี
 * ทำให้ deploy ครั้งแรกไม่ต้องสร้างชีทเองด้วยมือ
 */
function getSheet_(name) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  const headers = name === CONFIG.IMAGES_SHEET ? IMAGES_HEADERS : DOWNLOADS_HEADERS;
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** อ่านทั้งชีทเป็น array of object โดยอิงจาก header แถวแรก (batch read เดียว ไม่ loop ทีละ cell) */
function readSheetAsObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const rows = values.slice(1);
  return rows
    .map(function (row, idx) {
      const obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      obj._rowIndex = idx + 2; // เลขแถวจริงในชีท (สำหรับ update/delete)
      return obj;
    })
    .filter(function (obj) { return obj.id !== '' && obj.id !== null && obj.id !== undefined; });
}

/** สร้าง id ใหม่แบบไม่ซ้ำ */
function generateId_() {
  return Utilities.getUuid();
}

// -----------------------------------------------------------------------------
// PUBLIC: GALLERY (READ)
// -----------------------------------------------------------------------------

/**
 * ดึงรายการภาพ รองรับค้นหา/เรียง/แบ่งหน้า
 * @param {Object} options { search, sortBy: 'newest'|'popular'|'name', page, pageSize }
 * @return {Object} { items, total, page, pageSize, totalPages }
 */
function getImages(options) {
  options = options || {};
  const search = (options.search || '').toString().trim().toLowerCase();
  const sortBy = options.sortBy || 'newest';
  const page = Math.max(1, parseInt(options.page, 10) || 1);
  const pageSize = Math.max(1, parseInt(options.pageSize, 10) || CONFIG.PAGE_SIZE_DEFAULT);

  const sheet = getSheet_(CONFIG.IMAGES_SHEET);
  let items = readSheetAsObjects_(sheet);

  if (search) {
    items = items.filter(function (img) {
      const haystack = [img.title, img.fileName, img.tags, img.description]
        .map(function (v) { return (v || '').toString().toLowerCase(); })
        .join(' | ');
      return haystack.indexOf(search) !== -1;
    });
  }

  items.sort(function (a, b) {
    if (sortBy === 'popular') return (b.downloadCount || 0) - (a.downloadCount || 0);
    if (sortBy === 'name') return (a.title || a.fileName || '').localeCompare(b.title || b.fileName || '', 'th');
    // newest (default)
    return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
  });

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize).map(decorateImage_);

  return { items: pageItems, total: total, page: page, pageSize: pageSize, totalPages: totalPages };
}

/** ดึงรายละเอียดภาพเดียวจาก id */
function getImageById(id) {
  const sheet = getSheet_(CONFIG.IMAGES_SHEET);
  const items = readSheetAsObjects_(sheet);
  const found = items.filter(function (img) { return img.id === id; })[0];
  return found ? decorateImage_(found) : null;
}

/** เติม URL ที่ frontend ใช้แสดงผลได้ทันที (thumbnail / preview) โดยไม่ต้อง hardcode ฝั่ง client */
function decorateImage_(img) {
  return {
    id: img.id,
    fileId: img.fileId,
    fileName: img.fileName,
    title: img.title,
    description: img.description,
    tags: img.tags,
    mimeType: img.mimeType,
    fileSize: img.fileSize,
    uploadedAt: img.uploadedAt,
    downloadCount: img.downloadCount || 0,
    thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + img.fileId + '&sz=w400',
    previewUrl: 'https://drive.google.com/thumbnail?id=' + img.fileId + '&sz=w1600'
  };
}

// -----------------------------------------------------------------------------
// PUBLIC: DOWNLOAD
// -----------------------------------------------------------------------------

/**
 * คืน URL สำหรับดาวน์โหลดไฟล์ต้นฉบับ (ต้องตั้งสิทธิ์ไฟล์เป็น "ใครก็ตามที่มีลิงก์" ไว้ก่อน)
 */
function getDownloadUrl(imageId) {
  const img = getImageById(imageId);
  if (!img) throw new Error('ไม่พบไฟล์ภาพที่ต้องการ');
  return 'https://drive.google.com/uc?export=download&id=' + img.fileId;
}

/**
 * บันทึกการดาวน์โหลด: เพิ่มแถวใน Downloads + บวก downloadCount ในชีท Images
 * ป้องกันการนับซ้ำด้วยการ throttle ผ่าน CacheService (เร็วกว่าการอ่านชีททั้งหมดทุกครั้ง)
 * ใช้ Session.getTemporaryActiveUserKey() แทน IP จริง (Apps Script เข้าไม่ถึง IP ของผู้ใช้)
 * แล้วแฮชด้วย SHA-256 ก่อนเก็บ เพื่อไม่เก็บข้อมูลระบุตัวตนแบบดิบ
 */
function recordDownload(imageId) {
  const identityHash = hashIdentity_();
  const throttleKey = 'dl_' + imageId + '_' + identityHash;
  const cache = CacheService.getScriptCache();

  const alreadyDownloadedRecently = cache.get(throttleKey);
  if (alreadyDownloadedRecently) {
    // อยู่ในช่วง throttle: ไม่บวกซ้ำ แต่ยังคืนค่าจำนวนปัจจุบันให้ frontend อัปเดต UI ได้
    const img = getImageById(imageId);
    return { ok: true, throttled: true, downloadCount: img ? img.downloadCount : 0 };
  }
  cache.put(throttleKey, '1', CONFIG.DOWNLOAD_THROTTLE_SECONDS);

  const sheet = getSheet_(CONFIG.IMAGES_SHEET);
  const values = sheet.getDataRange().getValues();
  let rowIndex = -1;
  let newCount = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === imageId) {
      rowIndex = i + 1;
      newCount = (Number(values[i][9]) || 0) + 1;
      break;
    }
  }
  if (rowIndex === -1) throw new Error('ไม่พบไฟล์ภาพที่ต้องการ');

  sheet.getRange(rowIndex, 10).setValue(newCount); // คอลัมน์ downloadCount

  const downloadsSheet = getSheet_(CONFIG.DOWNLOADS_SHEET);
  downloadsSheet.appendRow([
    generateId_(),
    imageId,
    new Date(),
    identityHash,
    (Session.getActiveUser().getEmail() || 'anonymous')
  ]);

  return { ok: true, throttled: false, downloadCount: newCount };
}

/** แฮชตัวตนผู้ใช้แบบไม่ระบุตัวตนตรง ๆ สำหรับใช้ throttle/สถิติ */
function hashIdentity_() {
  const key = Session.getTemporaryActiveUserKey() || 'unknown';
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key);
  return digest.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

// -----------------------------------------------------------------------------
// PUBLIC: UPLOAD (ADMIN ONLY)
// -----------------------------------------------------------------------------

/**
 * รับไฟล์ภาพเป็น base64 จาก frontend, เซฟลง Drive แล้วบันทึกแถวใหม่ในชีท Images
 * @param {Object} fileData { base64, mimeType, fileName }
 * @param {Object} meta     { title, description, tags }
 * @param {String} adminToken token ที่ได้จาก verifyAdmin()
 */
function uploadImage(fileData, meta, adminToken) {
  requireAdmin_(adminToken);
  if (!fileData || !fileData.base64) throw new Error('ไม่มีข้อมูลไฟล์ที่จะอัปโหลด');

  const bytes = Utilities.base64Decode(fileData.base64);
  const blob = Utilities.newBlob(bytes, fileData.mimeType, fileData.fileName);

  const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const id = generateId_();
  const sheet = getSheet_(CONFIG.IMAGES_SHEET);
  sheet.appendRow([
    id,
    file.getId(),
    fileData.fileName,
    (meta && meta.title) || fileData.fileName,
    (meta && meta.description) || '',
    (meta && meta.tags) || '',
    fileData.mimeType,
    file.getSize(),
    new Date(),
    0
  ]);

  return getImageById(id);
}

/**
 * ลบภาพ: ลบไฟล์ใน Drive + แถวในชีท (เฉพาะแอดมิน)
 */
function deleteImage(id, adminToken) {
  requireAdmin_(adminToken);

  const sheet = getSheet_(CONFIG.IMAGES_SHEET);
  const values = sheet.getDataRange().getValues();
  let rowIndex = -1;
  let fileId = null;
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === id) {
      rowIndex = i + 1;
      fileId = values[i][1];
      break;
    }
  }
  if (rowIndex === -1) throw new Error('ไม่พบไฟล์ภาพที่ต้องการลบ');

  if (fileId) {
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
    } catch (err) {
      // ไฟล์อาจถูกลบไปแล้วด้วยมือ — ไม่ต้องหยุดกระบวนการลบแถวในชีท
    }
  }
  sheet.deleteRow(rowIndex);

  return { ok: true };
}

// -----------------------------------------------------------------------------
// PUBLIC: STATS / DASHBOARD (ADMIN)
// -----------------------------------------------------------------------------

/**
 * คืนข้อมูลสถิติสำหรับ dashboard: รวมยอดดาวน์โหลด, จำนวนภาพ, Top 10, และยอดดาวน์โหลดรายวัน (30 วันล่าสุด)
 */
function getStats(adminToken) {
  requireAdmin_(adminToken);

  const images = readSheetAsObjects_(getSheet_(CONFIG.IMAGES_SHEET));
  const totalImages = images.length;
  const totalDownloads = images.reduce(function (sum, img) { return sum + (Number(img.downloadCount) || 0); }, 0);

  const top10 = images
    .slice()
    .sort(function (a, b) { return (b.downloadCount || 0) - (a.downloadCount || 0); })
    .slice(0, 10)
    .map(function (img) { return { id: img.id, title: img.title || img.fileName, downloadCount: img.downloadCount || 0 }; });

  const downloads = readSheetAsObjects_(getSheet_(CONFIG.DOWNLOADS_SHEET));
  const since = new Date();
  since.setDate(since.getDate() - 29);
  const dailyMap = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    dailyMap[formatDateKey_(d)] = 0;
  }
  downloads.forEach(function (dl) {
    const d = new Date(dl.downloadedAt);
    if (isNaN(d.getTime()) || d < since) return;
    const key = formatDateKey_(d);
    if (key in dailyMap) dailyMap[key] += 1;
  });
  const dailyDownloads = Object.keys(dailyMap).sort().map(function (key) {
    return { date: key, count: dailyMap[key] };
  });

  return { totalImages: totalImages, totalDownloads: totalDownloads, top10: top10, dailyDownloads: dailyDownloads };
}

function formatDateKey_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd');
}

// -----------------------------------------------------------------------------
// ADMIN AUTH
// -----------------------------------------------------------------------------

/**
 * ตรวจสอบรหัสผ่านแอดมิน ถ้าถูกต้องคืน token ที่เซ็นด้วย HMAC (มีอายุ ADMIN_TOKEN_TTL_MS)
 * ฝั่ง frontend เก็บ token นี้ไว้แล้วแนบไปกับทุกคำขอที่ต้องใช้สิทธิ์แอดมิน (upload/delete/stats)
 */
function verifyAdmin(password) {
  const props = PropertiesService.getScriptProperties();
  const storedHash = props.getProperty('ADMIN_PASSWORD_HASH');
  if (!storedHash) throw new Error('ยังไม่ได้ตั้งรหัสผ่านแอดมิน กรุณารันฟังก์ชัน setAdminPassword_ ใน Apps Script editor ก่อน');

  const inputHash = sha256Hex_(password || '');
  if (inputHash !== storedHash) {
    return { ok: false, token: null };
  }
  return { ok: true, token: createAdminToken_() };
}

function createAdminToken_() {
  const secret = getAdminSecret_();
  const expiresAt = Date.now() + CONFIG.ADMIN_TOKEN_TTL_MS;
  const payload = String(expiresAt);
  const signature = Utilities.computeHmacSha256Signature(payload, secret)
    .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
  return Utilities.base64EncodeWebSafe(payload + '.' + signature);
}

function requireAdmin_(token) {
  if (!token || !isValidAdminToken_(token)) {
    throw new Error('ไม่มีสิทธิ์ทำรายการนี้ กรุณาเข้าสู่ระบบแอดมินใหม่');
  }
}

function isValidAdminToken_(token) {
  try {
    const decoded = Utilities.newBlob(Utilities.base64DecodeWebSafe(token)).getDataAsString();
    const parts = decoded.split('.');
    if (parts.length !== 2) return false;
    const payload = parts[0];
    const signature = parts[1];

    const secret = getAdminSecret_();
    const expected = Utilities.computeHmacSha256Signature(payload, secret)
      .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
    if (expected !== signature) return false;

    const expiresAt = Number(payload);
    return Date.now() < expiresAt;
  } catch (err) {
    return false;
  }
}

function getAdminSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('ADMIN_TOKEN_SECRET');
  if (!secret) {
    // สุ่มสร้างอัตโนมัติถ้ายังไม่มี เพื่อให้ deploy ครั้งแรกใช้งานได้เลยโดยไม่ต้องตั้งเอง
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('ADMIN_TOKEN_SECRET', secret);
  }
  return secret;
}

function sha256Hex_(text) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text);
  return digest.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

// -----------------------------------------------------------------------------
// ONE-TIME SETUP HELPERS (รันเองจาก Apps Script editor เท่านั้น ไม่ได้เรียกจาก frontend)
// -----------------------------------------------------------------------------

/**
 * รันครั้งเดียวจาก editor เพื่อตั้ง/เปลี่ยนรหัสผ่านแอดมิน
 * วิธีใช้: แก้ค่าใน setAdminPassword_('รหัสผ่านใหม่') แล้วกด Run
 */
function setAdminPassword_(newPassword) {
  if (!newPassword) throw new Error('ใส่รหัสผ่านที่ต้องการก่อน เช่น setAdminPassword_("mySecret123")');
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD_HASH', sha256Hex_(newPassword));
  Logger.log('ตั้งรหัสผ่านแอดมินเรียบร้อยแล้ว');
}

/**
 * รันครั้งเดียวจาก editor เพื่อสร้างชีทและ header ทั้งหมดล่วงหน้า (ไม่จำเป็น เพราะ getSheet_ สร้างให้อัตโนมัติอยู่แล้ว
 * แต่สะดวกถ้าอยากตรวจสอบว่า SPREADSHEET_ID ที่ตั้งไว้ถูกต้องก่อน deploy จริง)
 */
function setupSpreadsheet_() {
  getSheet_(CONFIG.IMAGES_SHEET);
  getSheet_(CONFIG.DOWNLOADS_SHEET);
  Logger.log('สร้างชีท Images และ Downloads เรียบร้อยแล้ว: ' + getSpreadsheet_().getUrl());
}
