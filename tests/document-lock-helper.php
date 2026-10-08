<?php
if(PHP_SAPI!=='cli')exit;
require_once __DIR__.'/../config/document-files.php';
if(!app_settings()['mock']||!preg_match('/^drive_archive_[a-f0-9]+_test$/D',app_settings()['database']))throw new RuntimeException('Disposable cloud-read fixture only');
$cacheLock=null;$lock=null;
if(($argv[2]??'')==='cache'){
    $name=$argv[1]??'';if(!preg_match('/^[a-f0-9]{64}\.plain$/D',$name))throw new RuntimeException('Invalid fixture cache');
    require_once __DIR__.'/../config/drive-archive.php';
    $cacheLock=fopen(app_drive_archive_directory('cache').'/'.substr($name,0,-6).'.lock','c+b');
    if(!$cacheLock||!flock($cacheLock,LOCK_EX))throw new RuntimeException('Fixture cache lock unavailable');
}else{$id=(int)($argv[1]??0);$lock=app_document_file_lock($id);}
echo "LOCKED\n";flush();
if(trim((string)fgets(STDIN))!=='release')throw new RuntimeException('Expected release command');
$lock?->release();if($cacheLock){flock($cacheLock,LOCK_UN);fclose($cacheLock);}
