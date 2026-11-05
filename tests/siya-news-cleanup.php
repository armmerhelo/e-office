<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/siya-news.php';
if(!str_ends_with(app_settings()['database'],'_test'))throw new RuntimeException('SIYA NEWS cleanup requires a *_test database');
$id=filter_var($argv[1]??'0',FILTER_VALIDATE_INT,['options'=>['min_range'=>0]]);if($id===false)throw new RuntimeException('Invalid QA article ID');
$pdo=app_pdo();if($id>0){$q=$pdo->prepare('SELECT id,extension FROM eoffice_siya_news_images WHERE news_id=?');$q->execute([$id]);
    foreach($q->fetchAll() as $image){$path=app_siya_news_image_path($image['id'],$image['extension']);if(is_file($path))unlink($path);$held=app_siya_news_root().'/quarantine/'.$image['id'].'.'.$image['extension'];if(is_file($held))unlink($held);}
    $pdo->prepare('DELETE FROM eoffice_siya_news WHERE id=?')->execute([$id]);}
