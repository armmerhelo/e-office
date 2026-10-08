const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
function suite(source){
    const secret=crypto.randomBytes(32).toString('hex'),properties={EOFFICE_ARCHIVE_SECRET:secret,EOFFICE_ARCHIVE_ROOT_ID:'archive-root',EOFFICE_LEGACY_ROOT_ID:'legacy-root'},objects=new Map(),nonces=new Map();let serial=0,locked=false;
    function iterator(items){let index=0;return {hasNext:()=>index<items.length,next:()=>items[index++]};}
    function blob(data,type='application/octet-stream',name=''){const bytes=Buffer.from(data);return {name,getBytes:()=>[...bytes],getDataAsString:()=>bytes.toString('utf8'),type};}
    function object(id,parent,name=id,type='folder',data=Buffer.alloc(0)){
        const item={id,parent,name,type,data,trashed:false,access:'PRIVATE',getId(){return this.id;},getParents(){return iterator(this.parent?[objects.get(this.parent)]:[]);},isTrashed(){return this.trashed;},getSharingAccess(){return this.access;},getName(){return this.name;},getMimeType(){return this.type;},getSize(){return this.data.length;},getBlob(){return blob(this.data,this.type,this.name);},getUrl(){return 'https://drive.google.com/'+this.id;},setName(name){this.name=name;},setContent(text){this.data=Buffer.from(text);},setTrashed(value){this.trashed=value;},getFilesByName(name){return iterator([...objects.values()].filter(file=>file.parent===this.id&&file.name===name&&file.type!=='folder'));},createFolder(name){return object('folder-'+(++serial),this.id,name);},createFile(data,text,type){const b=typeof data==='string'?blob(text,type,data):data;return object('file-'+(++serial),this.id,b.name,b.type||'application/octet-stream',Buffer.from(b.getBytes()));}};
        objects.set(id,item);return item;
    }
    object('my-drive',null);const legacy=object('legacy-root','my-drive'),archive=object('archive-root','my-drive');object('other-root','my-drive');object('outside','other-root','secret.txt','text/plain',Buffer.from('private outside'));
    const context={PropertiesService:{getScriptProperties:()=>({getProperty:name=>properties[name]||null})},Utilities:{Charset:{UTF_8:'utf8'},DigestAlgorithm:{SHA_256:'sha256'},computeHmacSha256Signature:(text,key)=>[...crypto.createHmac('sha256',key).update(text).digest()],computeDigest:(type,bytes)=>[...crypto.createHash('sha256').update(Buffer.from(bytes)).digest()],base64Decode:text=>[...Buffer.from(text,'base64')],base64Encode:bytes=>Buffer.from(bytes).toString('base64'),newBlob:(data,type,name)=>blob(typeof data==='string'?Buffer.from(data):data,type,name)},DriveApp:{Access:{PRIVATE:'PRIVATE'},getFolderById:id=>{const file=objects.get(id);if(!file||file.type!=='folder')throw Error('provider private ID');return file;},getFileById:id=>{if(!objects.has(id))throw Error('provider private ID');return objects.get(id);}},LockService:{getScriptLock:()=>({tryLock(){if(locked)return false;locked=true;return true;},releaseLock(){locked=false;}})},CacheService:{getScriptCache:()=>({get:key=>nonces.get(key),put:(key,value)=>nonces.set(key,value)})},ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},Date,JSON,Number,String,Error};
    vm.createContext(context);vm.runInContext(fs.readFileSync(source,'utf8'),context);vm.runInContext(fs.readFileSync('integrations/google-drive/EOfficeArchive.gs','utf8'),context);
    function post(input){return context.doPost({postData:{contents:JSON.stringify(input)}});}
    function signed(input){const payload=Buffer.from(JSON.stringify(input)).toString('base64'),timestamp=Math.floor(Date.now()/1000),nonce=crypto.randomBytes(16).toString('hex');return {route:'eoffice-archive-v1',timestamp,nonce,payload,signature:crypto.createHmac('sha256',secret).update(timestamp+'\n'+nonce+'\n'+payload).digest('hex')};}
    const folder=post({action:'create_folder',folderName:'maintenance-year'});assert.equal(folder.status,'success');
    const created=post({action:'create',filename:'sample.txt',mimeType:'text/plain',base64Data:Buffer.from('sample').toString('base64'),folderId:folder.folderId});assert.equal(created.status,'success');
    assert.equal(context.doGet({parameter:{id:created.fileId}}).base64Data,Buffer.from('sample').toString('base64'));
    assert.equal(post({action:'update',fileId:created.fileId,content:'updated',filename:'updated.txt'}).status,'success');
    assert.equal(post({action:'delete',fileId:created.fileId}).status,'success');
    for(const input of [{action:'read',id:'outside'},{action:'read',id:'archive-root'}])assert.equal(context.doGet({parameter:input}).status,'error');
    for(const action of ['update','delete'])for(const fileId of ['outside','archive-root','legacy-root'])assert.equal(post({action,fileId,filename:'no'}).status,'error');
    for(const folderId of ['archive-root','other-root'])assert.equal(post({action:'create',filename:'no',folderId,base64Data:'YQ=='}).status,'error');
    assert.equal(post({action:'create_folder',folderName:'no',parentFolderId:'other-root'}).status,'error');
    assert.equal(post({route:'unknown',action:'delete',fileId:'outside'}).code,'invalid_route');assert.equal(objects.get('outside').trashed,false);
    const image=post({action:'create',filename:'image.png',mimeType:'image/png',base64Data:'YWJj'});assert.equal(image.status,'success');
    assert.equal(post({action:'update',fileId:image.fileId,filename:'corrupt',base64Data:'eA=='}).status,'error');assert.equal(objects.get(image.fileId).name,'image.png');
    assert.equal(post({action:'update',fileId:image.fileId,content:'corrupt'}).status,'error');assert.equal(objects.get(image.fileId).data.toString(),'abc');
    const missing=context.doGet({parameter:{id:'missing-id'}});assert.equal(missing.status,'error');assert.ok(!missing.message.includes('provider private ID'));
    assert.equal(post(signed({action:'health'})).status,'success');
    const cipher=crypto.randomBytes(1000),hash=crypto.createHash('sha256').update(cipher).digest('hex');const uploaded=post(signed({action:'put',object:hash,data:cipher.toString('base64')}));assert.equal(uploaded.status,'success');
    const archived=[...objects.values()].find(file=>file.parent==='archive-root'&&file.name===hash+'.ebak');assert.ok(archived);
    assert.equal(context.doGet({parameter:{id:archived.id}}).status,'error');assert.equal(post({action:'delete',fileId:archived.id}).status,'error');assert.equal(post({action:'update',fileId:archived.id,content:'tamper'}).status,'error');
    assert.equal(post({route:'eoffice-archive-v1',action:'delete',fileId:archived.id}).status,'error');assert.equal(archived.trashed,false);assert.deepEqual(archived.data,cipher);
    archive.parent='legacy-root';assert.equal(post(signed({action:'health'})).code,'root_overlaps_legacy');assert.equal(post({action:'delete',fileId:folder.folderId}).status,'error');archive.parent='my-drive';
    legacy.parent='archive-root';assert.equal(post(signed({action:'health'})).code,'root_overlaps_legacy');legacy.parent='my-drive';
    archive.access='ANYONE';assert.equal(post(signed({action:'health'})).code,'root_not_private');
    archive.access='PRIVATE';context.CUSTOM_ROOT_FOLDER_ID='';assert.equal(post(signed({action:'health'})).code,'not_configured');
    assert.equal(objects.get('outside').data.toString(),'private outside');
    console.log('PASS '+source+': legacy CRUD compatibility, root/ancestor isolation, authenticated archive routing and ciphertext protection');
}
suite('integrations/google-drive/UnifiedDrive.gs');
if(fs.existsSync('appscript.gs'))suite('appscript.gs');
