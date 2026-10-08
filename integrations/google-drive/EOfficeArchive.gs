/**
 * Private ciphertext store for E-Office. No decryption keys are stored here.
 * Script Properties: EOFFICE_ARCHIVE_ROOT_ID, EOFFICE_ARCHIVE_SECRET (64 hex).
 * New dedicated deployment: doPost(e) { return eofficeArchiveHandle(e); }
 * Existing project: dispatch requests with route=eoffice-archive-v1 to this
 * handler before the legacy handler. Review legacy permissions before sharing
 * its deployment: legacy public delete/list must not reach the archive root.
 */
function eofficeArchiveHandle(e) {
  try {
    const request = JSON.parse(e.postData.contents);
    const settings = PropertiesService.getScriptProperties();
    const secret = settings.getProperty('EOFFICE_ARCHIVE_SECRET') || '';
    if (!/^[a-f0-9]{64}$/.test(secret)) throw Error('not_configured');
    if (request.route !== 'eoffice-archive-v1' || !Number.isInteger(request.timestamp) ||
        Math.abs(Date.now() / 1000 - request.timestamp) > 300 ||
        !/^[a-f0-9]{32}$/.test(request.nonce || '') || typeof request.payload !== 'string' || request.payload.length > 3000000) throw Error('unauthorized');
    const message = request.timestamp + '\n' + request.nonce + '\n' + request.payload;
    const bytes = Utilities.computeHmacSha256Signature(message, secret, Utilities.Charset.UTF_8);
    const expected = bytes.map(v => ('0' + ((v + 256) % 256).toString(16)).slice(-2)).join('');
    let mismatch = expected.length ^ String(request.signature || '').length;
    for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ String(request.signature || '').charCodeAt(i);
    if (mismatch) throw Error('unauthorized');
    const input = JSON.parse(Utilities.newBlob(Utilities.base64Decode(request.payload)).getDataAsString('UTF-8'));
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw Error('busy');
    try {
      const cache = CacheService.getScriptCache();
      if (cache.get('eo-nonce-' + request.nonce)) throw Error('replayed_request');
      cache.put('eo-nonce-' + request.nonce, '1', 600);
      const rootId = settings.getProperty('EOFFICE_ARCHIVE_ROOT_ID');
      if (!rootId) throw Error('not_configured');
      const root = DriveApp.getFolderById(rootId);
      if (root.isTrashed()) throw Error('root_unavailable');
      if (root.getSharingAccess() !== DriveApp.Access.PRIVATE) throw Error('root_not_private');
      if (input.action === 'health') return eoArchiveJSON({status:'success', protocol:1, private_storage:true});
      if (input.action === 'checkpoint' || input.action === 'run') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) throw Error('invalid_action');
        const name = 'eoffice-' + input.date + '.bootstrap.json';
        const matches = root.getFilesByName(name);let file = null;
        while (matches.hasNext()) { const found = matches.next();if (!found.isTrashed()) {if (file) throw Error('ambiguous_object');file = found;} }
        if (input.action === 'checkpoint') {
          if (!/^[a-f0-9]{64}$/.test(input.descriptor || '')) throw Error('invalid_object');
          const text = JSON.stringify({date:input.date, descriptor:input.descriptor});
          if (file && file.getBlob().getDataAsString() !== text) throw Error('ambiguous_object');
          if (!file) file = root.createFile(name, text, 'application/json');
        }
        if (!file) throw Error('object_missing');
        const result = JSON.parse(file.getBlob().getDataAsString());return eoArchiveJSON({status:'success', date:result.date, descriptor:result.descriptor});
      }
      if (!/^[a-f0-9]{64}$/.test(input.object || '')) throw Error('invalid_object');
      const name = input.object + '.ebak';
      const matches = root.getFilesByName(name);
      const files = [];
      while (matches.hasNext()) { const file = matches.next(); if (!file.isTrashed()) files.push(file); }
      if (files.length > 1) throw Error('ambiguous_object');
      let file = files[0];
      if (input.action === 'put') {
        if (typeof input.data !== 'string' || input.data.length > 2800000) throw Error('invalid_size');
        const contents = Utilities.base64Decode(input.data);
        if (contents.length < 1 || contents.length > 2097152 || eoArchiveSHA(contents) !== input.object) throw Error('checksum_mismatch');
        if (!file) file = root.createFile(Utilities.newBlob(contents, 'application/octet-stream', name));
      } else if (input.action !== 'get' && input.action !== 'stat') throw Error('invalid_action');
      if (!file) throw Error('object_missing');
      if (file.getSize() > 2097152) throw Error('invalid_size');
      const contents = file.getBlob().getBytes();
      const hash = eoArchiveSHA(contents);
      if (hash !== input.object) throw Error('checksum_mismatch');
      const result = {status:'success', object:input.object, bytes:contents.length, sha256:hash};
      if (input.action === 'get') result.data = Utilities.base64Encode(contents);
      return eoArchiveJSON(result);
    } finally { lock.releaseLock(); }
  } catch (error) {
    // Do not return raw Drive exception messages, IDs, credentials or filenames.
    const allowed = ['not_configured','unauthorized','busy','replayed_request','root_unavailable','root_not_private','invalid_object','ambiguous_object','invalid_size','checksum_mismatch','invalid_action','object_missing'];
    return eoArchiveJSON({status:'error', code:allowed.indexOf(error.message) >= 0 ? error.message : 'storage_failed'});
  }
}
function eoArchiveSHA(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(v => ('0' + ((v + 256) % 256).toString(16)).slice(-2)).join('');
}
function eoArchiveJSON(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
