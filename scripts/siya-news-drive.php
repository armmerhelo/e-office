<?php
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
ini_set('zend.exception_ignore_args','1');
require __DIR__.'/../config/siya-news-worker.php';
$action=$argv[1]??'status';
try{
    if($action==='worker')$result=app_siya_news_archive_images();
    elseif($action==='health')$result=['enabled'=>app_siya_news_drive_enabled(),'bridge'=>app_siya_news_drive_health()];
    elseif($action==='retry'){
        $id=$argv[2]??'';if(!preg_match('/^[a-f0-9]{32}$/D',$id))throw new RuntimeException('Image ID required');$pdo=app_pdo();
        $q=$pdo->prepare("SELECT * FROM eoffice_siya_news_images WHERE id=? AND storage_state='review'");$q->execute([$id]);$image=$q->fetch();if(!$image)throw new RuntimeException('Image in integrity review required');
        $path=app_siya_news_image_path($id,$image['extension']);if(!is_file($path)||filesize($path)!==(int)$image['bytes']||!hash_equals($image['sha256'],hash_file('sha256',$path)))throw new RuntimeException('Repair/preserve the original server file before retry');
        $pdo->prepare("UPDATE eoffice_siya_news_images SET storage_state='local',drive_parts='[]',drive_verified_at=NULL,retry_at=NULL,attempts=0,error_code=NULL WHERE id=?")->execute([$id]);$result=['requeued'=>true,'image_id'=>$id];
    }
    elseif($action==='status'){
        $q=app_pdo()->query("SELECT storage_state,COUNT(*) count,COALESCE(SUM(bytes),0) bytes FROM eoffice_siya_news_images GROUP BY storage_state");
        $result=['enabled'=>app_siya_news_drive_enabled(),'configured'=>app_siya_news_drive_configured(),'images'=>$q->fetchAll()];
    }else throw new RuntimeException('Invalid action');
    echo json_encode($result,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR).PHP_EOL;
}catch(Throwable $e){fwrite(STDERR,'SIYA NEWS Drive operation failed ('.get_class($e).')'.PHP_EOL);exit(1);}
