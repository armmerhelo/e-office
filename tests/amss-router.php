<?php
// Test transport observer. This router runs only in an isolated mock server;
// the real controller is evaluated unchanged except for its download call.
if(PHP_SAPI!=='cli-server'||getenv('EOFFICE_MOCK_SERVICES')!=='true'||!preg_match('/^eoffice_amss_\d+_test$/D',(string)getenv('DB_DATABASE')))return false;
if(parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH)!=='/api/create_document.php')return false;
function test_amss_download(string $url,int $timeout):string {
    if(app_pdo()->inTransaction())throw new RuntimeException('AMSS download holds a database transaction');
    $mode=$_POST['amss_test_action']??'';$pdo=app_pdo();
    if($mode==='expire_session')$pdo->prepare('DELETE FROM eoffice_sessions WHERE token_hash=?')->execute([hash('sha256',$_COOKIE['User_Token']??'')]);
    if($mode==='replace_file'){
        $doc=app_document((int)$_POST['doc_id'],app_user(),true);$fid=(int)$_POST['file_id'][0];
        $q=$pdo->prepare('SELECT * FROM t_document_upload WHERE Doc_Upload_Id=? AND Doc_File_Link=?');$q->execute([$fid,$doc['Doc_File_Link']]);$file=$q->fetch();if(!$file)throw new RuntimeException('Fixture file missing');
        $old=app_storage('original',$doc['Doc_Year'],$file['Doc_Upload_Path']);$name=bin2hex(random_bytes(16)).'.pdf';
        if(!copy($old,app_storage('original',$doc['Doc_Year'],$name)))throw new RuntimeException('Fixture replacement failed');
        $pdo->prepare('UPDATE t_document_upload SET Doc_Upload_Path=? WHERE Doc_Upload_Id=?')->execute([$name,$fid]);unlink($old);
    }
    if($mode==='grow_attachments'){
        $doc=app_document((int)$_POST['doc_id'],app_user(),true);$q=$pdo->prepare('SELECT * FROM t_document_upload WHERE Doc_File_Link=? ORDER BY Doc_Upload_Id');$q->execute([$doc['Doc_File_Link']]);$files=$q->fetchAll();
        for($i=count($files);$i<20;$i++){$name=bin2hex(random_bytes(16)).'.pdf';if(!copy(app_storage('original',$doc['Doc_Year'],$files[0]['Doc_Upload_Path']),app_storage('original',$doc['Doc_Year'],$name)))throw new RuntimeException('Fixture growth failed');$pdo->prepare('INSERT INTO t_document_upload (Doc_Upload_Detail,Doc_Upload_Path,Doc_File_Link,User_Id) VALUES (?,?,?,?)')->execute(['Concurrent PDF '.$i,$name,$doc['Doc_File_Link'],$doc['User_Id']]);}
    }
    return app_amss_download_pdf($url,$timeout);
}
$root=dirname(__DIR__);$source=file_get_contents($root.'/api/create_document.php');
$source=str_replace('__DIR__',var_export($root.'/api',true),$source);$needle='app_amss_download_pdf($url,min(30,$remaining))';
if(substr_count($source,$needle)!==1)throw new RuntimeException('Unknown AMSS controller layout');
eval(substr(str_replace($needle,'test_amss_download($url,min(30,$remaining))',$source),5));
