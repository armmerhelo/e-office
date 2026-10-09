// =================================================================
// UNIFIED DRIVE API - GOOGLE APPS SCRIPT (FULL VERSION)
// =================================================================

// กำหนด ID โฟลเดอร์เดิมใน Script Property EOFFICE_LEGACY_ROOT_ID ก่อนใช้งาน
// เพิ่ม EOfficeArchive.gs ในโปรเจกต์เดียวกันเพื่อเปิดใช้ authenticated archive route
var CUSTOM_ROOT_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('EOFFICE_LEGACY_ROOT_ID') || '';

// 1. [GET] API สำหรับ "ดึงข้อมูล/ดาวน์โหลดไฟล์" (Read)
function doGet(e) {
  try {
    var parameters = (e && e.parameter) || {};
    var action = parameters.action || "read";
    var fileId = parameters.id;

    if (action === "read") {
      if (!fileId) {
        throw new Error("กรุณาระบุ Parameter 'id' (File ID) ที่ต้องการดาวน์โหลด");
      }

      var file = DriveApp.getFileById(fileId);
      assertLegacyDriveObject(file, false);
      if (file.getSize() > 20 * 1024 * 1024) throw legacyDriveError('ไฟล์มีขนาดเกิน 20 MB');
      var blob = file.getBlob();

      // แปลงไฟล์เป็น Base64 สำหรับส่งไปให้ Server ใช้งาน
      var base64Data = Utilities.base64Encode(blob.getBytes());

      return sendJsonResponse({
        status: "success",
        action: "read",
        filename: file.getName(),
        mimeType: file.getMimeType(),
        base64Data: base64Data
      });
    }
    throw new Error("ไม่รองรับ action สำหรับ GET Request");
  } catch (error) {
    return legacyDriveErrorResponse(error);
  }
}

// 2. [POST] API สำหรับ "เพิ่มไฟล์, แก้ไข, ลบ และ สร้างโฟลเดอร์"
function doPost(e) {
  try {
    var requestData = JSON.parse(e.postData.contents);
    if (!requestData || typeof requestData !== 'object') throw legacyDriveError('คำขอไม่ถูกต้อง');
    // Archive payloads have their own HMAC authentication and immutable API.
    // Never let a malformed/unknown archive route fall through to legacy CRUD.
    if (requestData && requestData.route !== undefined) {
      if (requestData.route !== 'eoffice-archive-v1' || typeof eofficeArchiveHandle !== 'function') {
        return sendJsonResponse({status:'error', code:'invalid_route'});
      }
      return eofficeArchiveHandle(e);
    }
    var action = requestData.action;

    if (!action) {
      throw new Error("กรุณาระบุ 'action' ใน JSON");
    }

    switch (action) {
      case "create":        // เพิ่มไฟล์
        return handleCreate(requestData);
      case "create_folder": // สร้างโฟลเดอร์ย่อย
        return handleCreateFolder(requestData);
      case "update":        // แก้ไขไฟล์
        return handleUpdate(requestData);
      case "delete":        // ลบไฟล์
        return handleDelete(requestData);
      default:
        throw new Error("ไม่รองรับ action: " + action);
    }
  } catch (error) {
    return legacyDriveErrorResponse(error);
  }
}

// =================================================================
// ฟังก์ชันย่อยสำหรับจัดการแต่ละ Action (POST)
// =================================================================

// ฟังก์ชัน: สำหรับสร้างโฟลเดอร์ย่อย
function handleCreateFolder(data) {
  var folderName = data.folderName;
  var parentFolderId = data.parentFolderId;

  if (!folderName) {
    throw new Error("กรุณาระบุ 'folderName' ที่ต้องการสร้าง");
  }

  // ถ้าไม่ระบุ parentFolderId จะสร้างใน Custom Root ที่ตั้งไว้ทันที
  var parentFolder = parentFolderId ? DriveApp.getFolderById(parentFolderId) : DriveApp.getFolderById(CUSTOM_ROOT_FOLDER_ID);
  assertLegacyDriveObject(parentFolder, true);
  if (typeof folderName !== 'string' || folderName.length > 255) throw legacyDriveError('ชื่อโฟลเดอร์ไม่ถูกต้อง');
  var newFolder = parentFolder.createFolder(folderName);

  return sendJsonResponse({
    status: "success",
    action: "create_folder",
    message: "สร้างโฟลเดอร์ย่อยสำเร็จแล้ว",
    folderId: newFolder.getId(),
    folderUrl: newFolder.getUrl()
  });
}

// ฟังก์ชัน: เพิ่มไฟล์ใหม่
function handleCreate(data) {
  var base64Data = data.base64Data;
  var filename = data.filename || "Untitled_File";
  var mimeType = data.mimeType || "application/octet-stream";
  var folderId = data.folderId;

  if (!base64Data) throw new Error("ไม่พบข้อมูลไฟล์ (base64Data)");

  var decodedData = Utilities.base64Decode(base64Data);
  if (decodedData.length === 0 || decodedData.length > 20 * 1024 * 1024) throw legacyDriveError('ไฟล์มีขนาดไม่ถูกต้อง');
  if (typeof filename !== 'string' || filename.length > 255) throw legacyDriveError('ชื่อไฟล์ไม่ถูกต้อง');
  var blob = Utilities.newBlob(decodedData, mimeType, filename);

  // ถ้าไม่ระบุ folderId ไฟล์จะถูกเซฟลงใน Custom Root ที่ตั้งไว้ทันที
  var folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getFolderById(CUSTOM_ROOT_FOLDER_ID);
  assertLegacyDriveObject(folder, true);
  var file = folder.createFile(blob);

  return sendJsonResponse({
    status: "success",
    action: "create",
    message: "อัปโหลดและเพิ่มไฟล์สำเร็จ",
    fileId: file.getId(),
    fileUrl: file.getUrl()
  });
}

// ฟังก์ชัน: แก้ไขไฟล์
function handleUpdate(data) {
  var fileId = data.fileId;
  if (!fileId) throw new Error("กรุณาระบุ 'fileId' ที่ต้องการแก้ไข");

  var file = DriveApp.getFileById(fileId);
  assertLegacyDriveObject(file, false);
  // setContent is a text API. Reject binary replacements before changing the
  // name, instead of silently corrupting an image/PDF into decoded text.
  if ((data.base64Data || data.content) && !/^text\/|^application\/json$/.test(file.getMimeType())) throw legacyDriveError('ไฟล์ไบนารีต้องอัปโหลดเป็นไฟล์ใหม่');

  // แก้ไขชื่อไฟล์
  if (data.filename) {
    file.setName(data.filename);
  }

  // แก้ไขเนื้อหา (กรณีไฟล์ข้อความ)
  if (data.content) {
    file.setContent(data.content);
  } else if (data.base64Data) {
    var decoded = Utilities.base64Decode(data.base64Data);
    file.setContent(Utilities.newBlob(decoded).getDataAsString());
  }

  return sendJsonResponse({
    status: "success",
    action: "update",
    message: "แก้ไขไฟล์เรียบร้อยแล้ว",
    fileId: file.getId()
  });
}

// ฟังก์ชัน: ลบไฟล์
function handleDelete(data) {
  var fileId = data.fileId;
  if (!fileId) throw new Error("กรุณาระบุ 'fileId' ที่ต้องการลบ");

  var file = DriveApp.getFileById(fileId);
  assertLegacyDriveObject(file, false);
  file.setTrashed(true); // ย้ายลงถังขยะ

  return sendJsonResponse({
    status: "success",
    action: "delete",
    message: "ย้ายไฟล์ไปที่ถังขยะสำเร็จแล้ว",
    fileId: fileId
  });
}

// ฟังก์ชันเสริม: จัดฟอร์แมตข้อมูลส่งกลับเป็น JSON
function sendJsonResponse(objectData) {
  return ContentService.createTextOutput(JSON.stringify(objectData))
                       .setMimeType(ContentService.MimeType.JSON);
}

// Only the existing maintenance root and its descendants belong to legacy
// CRUD. The encrypted archive root MUST be a separate sibling, not a child or
// ancestor of this root, otherwise deleting a parent could trash every backup.
function assertLegacyDriveObject(object, allowRoot) {
  var archiveId = PropertiesService.getScriptProperties().getProperty('EOFFICE_ARCHIVE_ROOT_ID');
  if (archiveId) {
    var archive = DriveApp.getFolderById(archiveId);
    var legacy = DriveApp.getFolderById(CUSTOM_ROOT_FOLDER_ID);
    if (driveObjectUnderRoot(archive, CUSTOM_ROOT_FOLDER_ID) || driveObjectUnderRoot(legacy, archiveId)) {
      throw legacyDriveError('โฟลเดอร์ backup ต้องแยกจากโฟลเดอร์งานเดิม');
    }
    if (driveObjectUnderRoot(object, archiveId)) throw legacyDriveError('ไม่มีสิทธิ์เข้าถึงคลัง backup ผ่าน API เดิม');
  }
  if ((!allowRoot && object.getId() === CUSTOM_ROOT_FOLDER_ID) || object.isTrashed() || !driveObjectUnderRoot(object, CUSTOM_ROOT_FOLDER_ID)) {
    throw legacyDriveError('ไฟล์หรือโฟลเดอร์อยู่นอกพื้นที่ที่อนุญาต');
  }
}
function driveObjectUnderRoot(object, rootId) {
  var pending = [object], visited = {}, count = 0;
  while (pending.length) {
    if (++count > 100) throw legacyDriveError('โครงสร้างโฟลเดอร์ลึกเกินกำหนด');
    var current = pending.shift(), id = current.getId();
    if (visited[id]) continue;
    visited[id] = true;
    if (current.isTrashed()) continue;
    if (id === rootId) return true;
    var parents = current.getParents();
    while (parents.hasNext()) pending.push(parents.next());
  }
  return false;
}
function legacyDriveError(message) { var error = new Error(message); error.eoffice = true; return error; }
function legacyDriveErrorResponse(error) {
  return sendJsonResponse({status:'error', message:error.eoffice ? error.message : 'ไม่สามารถดำเนินการกับไฟล์หรือโฟลเดอร์นี้ได้'});
}
