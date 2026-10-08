"""Synthetic production PDF/auth smoke; no staff notifications or Drive writes."""
import hashlib,importlib.util,json,secrets,urllib.request,urllib.error
from pathlib import Path
spec=importlib.util.spec_from_file_location('production',Path(__file__).with_name('production-hosting.py'))
production=importlib.util.module_from_spec(spec);spec.loader.exec_module(production)
account,_=production.credentials();tag=secrets.token_hex(12);token=secrets.token_hex(32);name='drive-smoke-'+tag+'.pdf';state=None
checks=[]
def request(route,cookie=None,method='GET',headers=None,body=None):
    headers={**(headers or {}),**({'Cookie':'User_Token='+cookie} if cookie else {})}
    request=urllib.request.Request(production.URL+route,data=body,method=method,headers=headers)
    try:
        with urllib.request.urlopen(request,timeout=30) as response:return response.status,response.headers,response.read()
    except urllib.error.HTTPError as error:return error.code,error.headers,error.read()
try:
    with production.hosting.connect(account,'ftp.siya.ac.th') as ftp:
        production.hosting.webroot(ftp);key=secrets.token_hex(32)
        source=production.php(key)+f"""
ini_set('zend.exception_ignore_args','1');require __DIR__.'/config/drive-archive.php';
$pdo=app_pdo();
$name={production.hosting.php_value(name)};$token={production.hosting.php_value(token)};$email={production.hosting.php_value('drive-smoke-'+tag+'@example.invalid')};$year=(string)(date('Y')+543);
$pdo->prepare('INSERT INTO t_user (User_Name,User_Email,User_Password,User_Status,User_Token) VALUES (?,?,?,?,?)')->execute(['Drive synthetic smoke',$email,password_hash(bin2hex(random_bytes(32)),PASSWORD_DEFAULT),'User','']);$user=(int)$pdo->lastInsertId();
$pdo->prepare('INSERT INTO eoffice_sessions (token_hash,User_Id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 30 MINUTE))')->execute([hash('sha256',$token),$user]);
$pdo->prepare("INSERT INTO t_document (Doc_Number,Doc_Name,Doc_Type,Doc_Year,User_Id,Doc_Date,Doc_File_Link,Is_Delete) VALUES (?,'Drive synthetic smoke','Internal',?,?,'08/10/2026 00:00','','active')")->execute([{production.hosting.php_value('DRIVE-SMOKE-'+tag)},$year,$user]);$id=(int)$pdo->lastInsertId();$pdo->prepare('UPDATE t_document SET Doc_File_Link=? WHERE Doc_Id=?')->execute([(string)$id,$id]);
$pdo->prepare('INSERT INTO t_document_upload (Doc_Upload_Path,Doc_File_Link,Doc_Upload_Detail,User_Id) VALUES (?,?,?,?)')->execute([$name,(string)$id,'Synthetic PDF',$user]);
$path=app_storage('original',$year,$name);if(!is_dir(dirname($path)))mkdir(dirname($path),0750,true);$pdf="%PDF-1.4\\n1 0 obj << /Type /Catalog >> endobj\\ntrailer << /Root 1 0 R >>\\n%%EOF\\n";file_put_contents($path,$pdf);
echo json_encode(['doc'=>$id,'user'=>$user,'year'=>$year,'revision'=>hash('sha256',$pdf)]);
"""
        state=production.invoke(ftp,source,key)
    route='/api/view_file.php?Doc_Id='+str(state['doc'])+'&File_Path='+name+'&Year='+state['year']
    code,_,_=request(route);assert code==401;checks.append('private PDF denies guests')
    code,headers,pdf=request(route,token);assert code==200 and pdf.startswith(b'%PDF-1.4') and headers.get('X-Document-Revision')==state['revision'];checks.append('authorized PDF and revision match')
    code,headers,partial=request(route,token,headers={'Range':'bytes=0-7'});assert code==206 and partial==b'%PDF-1.4';checks.append('PDF byte range response')
    code,headers,pdf=request(route,token,method='HEAD');assert code==200 and not pdf and int(headers['Content-Length'])>0;checks.append('HEAD returns file metadata only')
    code,_,_=request('/api/drive_archive_status.php');assert code==401;checks.append('archive status denies guests')
    code,_,_=request('/api/drive_archive_status.php',token);assert code==403;checks.append('archive status denies ordinary member')
    boundary='eoffice'+tag;signed=b'%PDF-1.4\n% synthetic signed smoke\n';body=b''
    for field,value in [('Doc_Id',str(state['doc'])),('year',state['year']),('revision',state['revision'])]:body+=('--'+boundary+'\r\nContent-Disposition: form-data; name="'+field+'"\r\n\r\n'+value+'\r\n').encode()
    body+=('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+name+'"\r\nContent-Type: application/pdf\r\n\r\n').encode()+signed+('\r\n--'+boundary+'--\r\n').encode()
    code,_,response=request('/e-sign/upload_pdf.php',token,method='POST',headers={'Content-Type':'multipart/form-data; boundary='+boundary},body=body);assert code==200 and json.loads(response)['status']=='success';checks.append('existing signature save remains operational')
    code,headers,response=request(route+'&Type=signed',token);assert code==200 and response==signed and headers.get('X-Document-Revision')==hashlib.sha256(signed).hexdigest();checks.append('signed bytes and revision remain consistent')
finally:
    if state:
        with production.hosting.connect(account,'ftp.siya.ac.th') as ftp:
            production.hosting.webroot(ftp);key=secrets.token_hex(32)
            source=production.php(key)+f"""
require __DIR__.'/config/bootstrap.php';$pdo=app_pdo();$id={int(state['doc'])};$user={int(state['user'])};$name={production.hosting.php_value(name)};$year={production.hosting.php_value(state['year'])};
$pdo->prepare('DELETE FROM t_access_rights WHERE Doc_Id=?')->execute([$id]);$pdo->prepare('DELETE FROM eoffice_signed_files WHERE Doc_Id=?')->execute([$id]);$pdo->prepare('DELETE FROM t_document_upload WHERE Doc_File_Link=?')->execute([(string)$id]);$pdo->prepare('DELETE FROM t_document WHERE Doc_Id=? AND User_Id=?')->execute([$id,$user]);$pdo->prepare('DELETE FROM t_user WHERE User_Id=? AND User_Email=?')->execute([$user,{production.hosting.php_value('drive-smoke-'+tag+'@example.invalid')}]);
foreach([app_storage('original',$year,$name),app_storage('e-sign',$year,'signed_'.$id.'_'.$name)] as $path)if(is_file($path))unlink($path);
$versions=$pdo->prepare('SELECT id FROM eoffice_drive_versions WHERE doc_id=?');$versions->execute([$id]);$versionIds=$versions->fetchAll(PDO::FETCH_COLUMN);
$pdo->prepare('DELETE FROM eoffice_drive_files WHERE doc_id=?')->execute([$id]);$pdo->prepare('DELETE FROM eoffice_drive_versions WHERE doc_id=?')->execute([$id]);
$archiveRoot=dirname(app_settings()['storage']).'/drive-archive';foreach($versionIds as $version){{if(!preg_match('/^[a-f0-9]{{64}}$/',$version))throw new RuntimeException('Synthetic archive identity invalid');foreach(glob($archiveRoot.'/spool/'.$version.'*')?:[] as $path)if(is_file($path))unlink($path);foreach(glob($archiveRoot.'/cache/'.$version.'*')?:[] as $path)if(is_file($path))unlink($path);}}
$q=$pdo->prepare('SELECT COUNT(*) FROM t_document WHERE Doc_Id=?');$q->execute([$id]);echo json_encode(['fixtures_removed'=>(int)$q->fetchColumn()===0]);
"""
            cleanup=production.invoke(ftp,source,key);assert cleanup['fixtures_removed']
print(json.dumps({'production_checks_passed':len(checks),'checks':checks,'synthetic_fixtures_removed':True,'staff_notifications_sent':False,'drive_uploads_started':False}))
