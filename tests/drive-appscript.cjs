const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const secret=crypto.randomBytes(32).toString('hex'),files=[],nonces=new Map();let locked=false;
function blob(data){const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);return {getBytes:()=>[...bytes],getDataAsString:()=>bytes.toString('utf8')};}
function iterator(values){let index=0;return {hasNext:()=>index<values.length,next:()=>values[index++]};}
const root={isTrashed:()=>false,getSharingAccess:()=> 'PRIVATE',getFilesByName:name=>iterator(files.filter(f=>f.name===name)),createFile(data,text){const name=typeof data==='string'?data:null,b=name?blob(text):data;const file={name:name||data.name,isTrashed:()=>false,getSize:()=>b.getBytes().length,getBlob:()=>b};files.push(file);return file;}};
const context={PropertiesService:{getScriptProperties:()=>({getProperty:key=>({EOFFICE_ARCHIVE_SECRET:secret,EOFFICE_ARCHIVE_ROOT_ID:'private-root'}[key])})},
 Utilities:{Charset:{UTF_8:'utf8'},DigestAlgorithm:{SHA_256:'sha256'},computeHmacSha256Signature:(text,key)=>[...crypto.createHmac('sha256',key).update(text).digest()],computeDigest:(type,data)=>[...crypto.createHash('sha256').update(Buffer.from(data)).digest()],base64Decode:text=>[...Buffer.from(text,'base64')],base64Encode:bytes=>Buffer.from(bytes).toString('base64'),newBlob(data,type,name){const b=blob(typeof data==='string'?Buffer.from(data):Buffer.from(data));b.name=name;return b;}},
 LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true;},releaseLock:()=>locked=false})},CacheService:{getScriptCache:()=>({get:key=>nonces.get(key),put:(key,value)=>nonces.set(key,value)})},DriveApp:{Access:{PRIVATE:'PRIVATE'},getFolderById:id=>{assert.equal(id,'private-root');return root;}},ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},Date,JSON,Number,String,Error};
vm.createContext(context);vm.runInContext(fs.readFileSync('integrations/google-drive/EOfficeArchive.gs','utf8'),context);
function envelope(input){const payload=Buffer.from(JSON.stringify(input)).toString('base64'),timestamp=Math.floor(Date.now()/1000),nonce=crypto.randomBytes(16).toString('hex');return {route:'eoffice-archive-v1',timestamp,nonce,payload,signature:crypto.createHmac('sha256',secret).update(timestamp+'\n'+nonce+'\n'+payload).digest('hex')};}
function send(request){return context.eofficeArchiveHandle({postData:{contents:JSON.stringify(request)}});}
assert.equal(send(envelope({action:'health'})).status,'success');
const invalid=envelope({action:'health'});invalid.signature='0'.repeat(64);assert.equal(send(invalid).code,'unauthorized');
const replay=envelope({action:'health'});assert.equal(send(replay).status,'success');assert.equal(send(replay).code,'replayed_request');
const data=crypto.randomBytes(5000),object=crypto.createHash('sha256').update(data).digest('hex');
assert.equal(send(envelope({action:'put',object,data:data.toString('base64')})).sha256,object);
assert.equal(send(envelope({action:'put',object,data:data.toString('base64')})).status,'success');assert.equal(files.length,1);
assert.deepEqual(Buffer.from(send(envelope({action:'get',object})).data,'base64'),data);
assert.equal(send(envelope({action:'put',object,data:Buffer.from('tamper').toString('base64')})).code,'checksum_mismatch');
assert.equal(send(envelope({action:'get',object:'../escape'})).code,'invalid_object');
assert.equal(send(envelope({action:'delete',object})).code,'invalid_action');
assert.equal(send(envelope({action:'checkpoint',date:'2026-10-08',descriptor:object})).descriptor,object);
assert.equal(send(envelope({action:'run',date:'2026-10-08'})).descriptor,object);
assert.equal(send(envelope({action:'checkpoint',date:'2026-10-08',descriptor:'f'.repeat(64)})).code,'ambiguous_object');
console.log('PASS Apps Script authentication/replay protection, immutable retry, integrity, root confinement and recovery checkpoint');
