/** Existing maintenance API plus the authenticated encrypted archive route.
 * Add EOfficeArchive.gs to the SAME Apps Script project.
 * Script Property EOFFICE_LEGACY_ROOT_ID = the previous CUSTOM_ROOT_FOLDER_ID.
 * Archive root must be a separate PRIVATE sibling outside the legacy tree.
 */
var CUSTOM_ROOT_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('EOFFICE_LEGACY_ROOT_ID') || '';

function doGet(e) {
  try {
    var parameters = (e && e.parameter) || {};
    if ((parameters.action || 'read') !== 'read' || !parameters.id) throw legacyDriveError('กรุณาระบุ action=read และ id');
    var file = DriveApp.getFileById(parameters.id);
    assertLegacyDriveObject(file, false);
    if (file.getSize() > 20 * 1024 * 1024) throw legacyDriveError('ไฟล์มีขนาดเกิน 20 MB');
    return sendJsonResponse({status:'success', action:'read', filename:file.getName(), mimeType:file.getMimeType(), base64Data:Utilities.base64Encode(file.getBlob().getBytes())});
  } catch (error) { return legacyDriveErrorResponse(error); }
}
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (!data || typeof data !== 'object') throw legacyDriveError('คำขอไม่ถูกต้อง');
    if (data.route !== undefined) {
      if (data.route !== 'eoffice-archive-v1' || typeof eofficeArchiveHandle !== 'function') return sendJsonResponse({status:'error', code:'invalid_route'});
      return eofficeArchiveHandle(e);
    }
    switch (data.action) {
      case 'create': return handleCreate(data);
      case 'create_folder': return handleCreateFolder(data);
      case 'update': return handleUpdate(data);
      case 'delete': return handleDelete(data);
      default: throw legacyDriveError('ไม่รองรับ action');
    }
  } catch (error) { return legacyDriveErrorResponse(error); }
}
function handleCreateFolder(data) {
  if (typeof data.folderName !== 'string' || !data.folderName || data.folderName.length > 255) throw legacyDriveError('ชื่อโฟลเดอร์ไม่ถูกต้อง');
  var parent = DriveApp.getFolderById(data.parentFolderId || CUSTOM_ROOT_FOLDER_ID);
  assertLegacyDriveObject(parent, true);
  var folder = parent.createFolder(data.folderName);
  return sendJsonResponse({status:'success', action:'create_folder', message:'สร้างโฟลเดอร์ย่อยสำเร็จแล้ว', folderId:folder.getId(), folderUrl:folder.getUrl()});
}
function handleCreate(data) {
  var name = data.filename || 'Untitled_File';
  if (typeof name !== 'string' || name.length > 255 || typeof data.base64Data !== 'string' || data.base64Data.length > 28000000) throw legacyDriveError('ข้อมูลไฟล์ไม่ถูกต้อง');
  var folder = DriveApp.getFolderById(data.folderId || CUSTOM_ROOT_FOLDER_ID);
  assertLegacyDriveObject(folder, true);
  var bytes = Utilities.base64Decode(data.base64Data);
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw legacyDriveError('ไฟล์มีขนาดไม่ถูกต้อง');
  var file = folder.createFile(Utilities.newBlob(bytes, data.mimeType || 'application/octet-stream', name));
  return sendJsonResponse({status:'success', action:'create', message:'อัปโหลดและเพิ่มไฟล์สำเร็จ', fileId:file.getId(), fileUrl:file.getUrl()});
}
function handleUpdate(data) {
  if (!data.fileId) throw legacyDriveError('กรุณาระบุ fileId');
  var file = DriveApp.getFileById(data.fileId);
  assertLegacyDriveObject(file, false);
  if ((data.base64Data || data.content) && !/^text\/|^application\/json$/.test(file.getMimeType())) throw legacyDriveError('ไฟล์ไบนารีต้องอัปโหลดเป็นไฟล์ใหม่');
  if (data.filename) file.setName(data.filename);
  if (data.content) file.setContent(data.content);
  else if (data.base64Data) file.setContent(Utilities.newBlob(Utilities.base64Decode(data.base64Data)).getDataAsString());
  return sendJsonResponse({status:'success', action:'update', message:'แก้ไขไฟล์เรียบร้อยแล้ว', fileId:file.getId()});
}
function handleDelete(data) {
  if (!data.fileId) throw legacyDriveError('กรุณาระบุ fileId');
  var file = DriveApp.getFileById(data.fileId);
  assertLegacyDriveObject(file, false);
  file.setTrashed(true);
  return sendJsonResponse({status:'success', action:'delete', message:'ย้ายไฟล์ไปที่ถังขยะสำเร็จแล้ว', fileId:file.getId()});
}
function assertLegacyDriveObject(object, allowRoot) {
  if (!CUSTOM_ROOT_FOLDER_ID) throw legacyDriveError('ยังไม่ได้ตั้งค่า EOFFICE_LEGACY_ROOT_ID');
  var archiveId = PropertiesService.getScriptProperties().getProperty('EOFFICE_ARCHIVE_ROOT_ID');
  if (archiveId) {
    var archive = DriveApp.getFolderById(archiveId), legacy = DriveApp.getFolderById(CUSTOM_ROOT_FOLDER_ID);
    if (driveObjectUnderRoot(archive, CUSTOM_ROOT_FOLDER_ID) || driveObjectUnderRoot(legacy, archiveId)) throw legacyDriveError('โฟลเดอร์ backup ต้องแยกจากโฟลเดอร์งานเดิม');
    if (driveObjectUnderRoot(object, archiveId)) throw legacyDriveError('ไม่มีสิทธิ์เข้าถึงคลัง backup ผ่าน API เดิม');
  }
  if ((!allowRoot && object.getId() === CUSTOM_ROOT_FOLDER_ID) || object.isTrashed() || !driveObjectUnderRoot(object, CUSTOM_ROOT_FOLDER_ID)) throw legacyDriveError('ไฟล์หรือโฟลเดอร์อยู่นอกพื้นที่ที่อนุญาต');
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
function sendJsonResponse(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function legacyDriveError(message) { var error = new Error(message); error.eoffice = true; return error; }
function legacyDriveErrorResponse(error) { return sendJsonResponse({status:'error', message:error.eoffice ? error.message : 'ไม่สามารถดำเนินการกับไฟล์หรือโฟลเดอร์นี้ได้'}); }
