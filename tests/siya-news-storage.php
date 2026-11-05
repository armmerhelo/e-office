<?php
// Isolated storage/retention regression. No real Drive requests or existing data changes.
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/siya-news-worker.php';
$settings=app_settings();
if(!$settings['mock']||!preg_match('/^eoffice_siya_news_[a-z0-9_]+_test$/D',$settings['database'])||!in_array($settings['host'],['127.0.0.1','localhost'],true))throw new RuntimeException('Isolated SIYA NEWS test database required');
if(app_siya_news_drive_configured())throw new RuntimeException('Real Drive must not be configured for storage tests');
$pdo=app_pdo();$newsId=0;$files=[];$original=getenv('EOFFICE_SIYA_NEWS_DRIVE_ENABLED');
if((int)$pdo->query("SELECT COUNT(*) FROM eoffice_siya_news_images WHERE (storage_state='local' AND uploaded_at<=DATE_SUB(NOW(),INTERVAL 30 DAY)) OR (storage_state='archived' AND drive_verified_at<=DATE_SUB(NOW(),INTERVAL 1 DAY))")->fetchColumn())throw new RuntimeException('Existing worker-eligible images present; use a clean isolated test database');
$owner=(int)$pdo->query('SELECT User_Id FROM t_user ORDER BY User_Id LIMIT 1')->fetchColumn();if(!$owner)throw new RuntimeException('Synthetic owner required');
function checkNewsStorage(bool $condition,string $name): void {if(!$condition)throw new RuntimeException($name);echo 'PASS ',$name,PHP_EOL;}
try{
    putenv('EOFFICE_SIYA_NEWS_DRIVE_ENABLED=true');
    $pdo->prepare("INSERT INTO eoffice_siya_news(owner_id,title,body) VALUES(?,'Synthetic retention regression','synthetic')")->execute([$owner]);$newsId=(int)$pdo->lastInsertId();
    $make=static function(int $age)use($pdo,$newsId,$owner,&$files): array {
        $id=bin2hex(random_bytes(16));$bytes=random_bytes(524400);$path=app_siya_news_image_path($id,'png');file_put_contents($path,$bytes);$files[]=$path;
        $pdo->prepare('INSERT INTO eoffice_siya_news_images(id,news_id,uploaded_by,original_name,extension,mime_type,bytes,sha256,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?)')->execute([$id,$newsId,$owner,'synthetic.png','png','image/png',strlen($bytes),hash('sha256',$bytes),date('Y-m-d H:i:s',time()-$age*86400)]);
        return [$id,$path,$bytes];
    };
    [$young,$youngPath]=$make(29);[$old,$oldPath,$oldBytes]=$make(31);
    $remote=[];$transport=['put'=>static function($asset,$index,$bytes)use(&$remote): array {$remote[$asset][$index]=$bytes;return ['file_id'=>'mock-'.$asset.'-'.$index,'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes)];},'get'=>static fn($asset,$index,$part,$bytes)=>$bytes];
    app_siya_news_archive_images(30,$transport);
    $state=static function(string $id)use($pdo): array {$q=$pdo->prepare('SELECT * FROM eoffice_siya_news_images WHERE id=?');$q->execute([$id]);return $q->fetch();};
    checkNewsStorage($state($young)['storage_state']==='local'&&is_file($youngPath),'images younger than 30 days remain local');
    $archived=$state($old);checkNewsStorage($archived['storage_state']==='archived'&&hash_equals(hash('sha256',$oldBytes),hash('sha256',implode('',$remote[$old]))),'30-day archival verifies every chunk and full SHA-256');
    checkNewsStorage(is_file($oldPath),'verified archival retains local source for an extra day');
    [$bad,$badPath]=$make(31);$corrupt=$transport;$corrupt['get']=static fn($asset,$index,$part,$bytes)=>'corrupt';
    app_siya_news_archive_images(30,$corrupt);
    checkNewsStorage($state($bad)['storage_state']!=='archived'&&is_file($badPath),'failed readback never marks verified or deletes source');
    $pdo->prepare('UPDATE eoffice_siya_news_images SET drive_verified_at=DATE_SUB(NOW(),INTERVAL 2 DAY) WHERE id=?')->execute([$old]);
    app_siya_news_archive_images(30,$transport);
    checkNewsStorage(is_file($oldPath)&&$state($old)['storage_state']==='archived','eviction preserves local source when remote re-verification is unavailable');
    checkNewsStorage(hash_equals(hash('sha256',$oldBytes),hash_file('sha256',$oldPath)),'retained original bytes are unchanged');
}finally{
    if($newsId)$pdo->prepare('DELETE FROM eoffice_siya_news WHERE id=?')->execute([$newsId]);
    foreach($files as $file)if(is_file($file))unlink($file);
    if($original===false)putenv('EOFFICE_SIYA_NEWS_DRIVE_ENABLED');else putenv('EOFFICE_SIYA_NEWS_DRIVE_ENABLED='.$original);
}
