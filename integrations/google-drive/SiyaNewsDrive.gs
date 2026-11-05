/**
 * Dedicated private SIYA NEWS image store. In a merged E-Office deployment,
 * UnifiedDrive.gs dispatches the authenticated route to this handler.
 * Script Properties: SIYA_NEWS_DRIVE_ROOT_ID and SIYA_NEWS_DRIVE_SECRET.
 * The secret is 64 random lowercase hex characters and is not a Drive password.
 */
function eofficeSiyaNewsHandle(e) {
  try {
    var envelope = JSON.parse(e.postData.contents || '{}');
    var properties = PropertiesService.getScriptProperties();
    var secret = properties.getProperty('SIYA_NEWS_DRIVE_SECRET') || '';
    if (!/^[a-f0-9]{64}$/.test(secret) || envelope.route !== 'eoffice-news-v1' ||
        !Number.isInteger(envelope.timestamp) || Math.abs(Date.now()/1000-envelope.timestamp)>300 ||
        !/^[a-f0-9]{32}$/.test(envelope.nonce || '') || typeof envelope.payload !== 'string' || envelope.payload.length > 1600000)
      throw Error('unauthorized');
    var signed = envelope.route+'\n'+envelope.timestamp+'\n'+envelope.nonce+'\n'+envelope.payload;
    var expected = newsHex(Utilities.computeHmacSha256Signature(signed,secret,Utilities.Charset.UTF_8));
    var supplied = String(envelope.signature || ''), mismatch = expected.length ^ supplied.length;
    for (var i=0;i<expected.length;i++) mismatch |= expected.charCodeAt(i) ^ (supplied.charCodeAt(i) || 0);
    if (mismatch) throw Error('unauthorized');
    var input = JSON.parse(Utilities.newBlob(Utilities.base64Decode(envelope.payload)).getDataAsString('UTF-8'));
    var lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) throw Error('busy');
    try {
      var cache = CacheService.getScriptCache();
      if (cache.get('siya-news-nonce-'+envelope.nonce)) throw Error('replayed_request');
      cache.put('siya-news-nonce-'+envelope.nonce,'1',600);
      var rootId = properties.getProperty('SIYA_NEWS_DRIVE_ROOT_ID') || '';
      if (!rootId) throw Error('not_configured');
      var root = DriveApp.getFolderById(rootId);
      if (root.isTrashed() || root.getSharingAccess() !== DriveApp.Access.PRIVATE) throw Error('root_unavailable');
      var archiveId=properties.getProperty('EOFFICE_ARCHIVE_ROOT_ID')||'';
      if (typeof CUSTOM_ROOT_FOLDER_ID !== 'undefined' && CUSTOM_ROOT_FOLDER_ID) {
        if (rootId===CUSTOM_ROOT_FOLDER_ID || driveObjectUnderRoot(root,CUSTOM_ROOT_FOLDER_ID) || driveObjectUnderRoot(DriveApp.getFolderById(CUSTOM_ROOT_FOLDER_ID),rootId)) throw Error('root_overlap');
      }
      if (archiveId) {
        if (rootId===archiveId || driveObjectUnderRoot(root,archiveId) || driveObjectUnderRoot(DriveApp.getFolderById(archiveId),rootId)) throw Error('root_overlap');
      }
      if (input.action === 'health') return newsJson({status:'success',protocol:1,private_storage:true});
      if (!/^[a-f0-9]{32}$/.test(input.asset || '') || !Number.isInteger(input.index) || input.index < 0 || input.index > 1000 ||
          !Number.isInteger(input.bytes) || input.bytes < 1 || input.bytes > 524288 || !/^[a-f0-9]{64}$/.test(input.sha256 || '')) throw Error('invalid_object');
      var name = input.asset+'-'+input.index+'-'+input.sha256+'.part';
      if (input.action === 'put-part') {
        if (typeof input.data !== 'string' || input.data.length > 720000) throw Error('invalid_size');
        var bytes = Utilities.base64Decode(input.data);
        if (bytes.length !== input.bytes || newsHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes)) !== input.sha256) throw Error('checksum_mismatch');
        var matches = root.getFilesByName(name), file = null;
        while (matches.hasNext()) { var candidate=matches.next(); if (!candidate.isTrashed()) { if (file) throw Error('ambiguous_object'); file=candidate; } }
        if (file) {
          if (file.getSize() !== input.bytes || newsHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,file.getBlob().getBytes())) !== input.sha256) throw Error('checksum_mismatch');
        } else file = root.createFile(Utilities.newBlob(bytes,'application/octet-stream',name));
        return newsJson({status:'success',file_id:file.getId(),bytes:input.bytes,sha256:input.sha256});
      }
      if (input.action === 'get-part') {
        if (typeof input.file_id !== 'string' || input.file_id.length > 255) throw Error('invalid_object');
        var file = DriveApp.getFileById(input.file_id), parents=file.getParents();
        if (file.isTrashed() || file.getName() !== name || !parents.hasNext() || parents.next().getId() !== rootId || parents.hasNext()) throw Error('object_missing');
        var data=file.getBlob().getBytes(), digest=newsHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,data));
        if (data.length !== input.bytes || digest !== input.sha256) throw Error('checksum_mismatch');
        return newsJson({status:'success',file_id:file.getId(),bytes:data.length,sha256:digest,data:Utilities.base64Encode(data)});
      }
      throw Error('invalid_action');
    } finally { lock.releaseLock(); }
  } catch (error) {
    var allowed=['unauthorized','busy','replayed_request','not_configured','root_unavailable','root_overlap','invalid_object','invalid_size','checksum_mismatch','ambiguous_object','object_missing','invalid_action'];
    return newsJson({status:'error',code:allowed.indexOf(error.message)>=0?error.message:'storage_failed'});
  }
}
function newsHex(bytes) { return bytes.map(function(value){return ('0'+((value+256)%256).toString(16)).slice(-2);}).join(''); }
function newsJson(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
