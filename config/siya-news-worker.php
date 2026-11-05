<?php
require_once __DIR__.'/siya-news-drive.php';
function app_siya_news_archive_images(int $seconds=90,?array $transport=null): array {
    if($transport!==null&&(!app_settings()['mock']||!str_ends_with(app_settings()['database'],'_test')))throw new RuntimeException('Test transports only');
    if(!app_siya_news_drive_enabled())return ['enabled'=>false,'archived'=>0,'retry_pending'=>0,'removed'=>0];
    $pdo=app_pdo();if(!$pdo->query("SELECT GET_LOCK('eoffice:siya-news-archive',0)")->fetchColumn())return ['skipped'=>true,'archived'=>0,'retry_pending'=>0,'removed'=>0];
    $deadline=microtime(true)+max(1,min(180,$seconds));$archived=0;$retry=0;$removed=0;$error=null;
    try{
        if($transport===null)app_siya_news_drive_health();
        $images=$pdo->query("SELECT * FROM eoffice_siya_news_images WHERE storage_state='local' AND uploaded_at<=DATE_SUB(NOW(),INTERVAL 30 DAY) AND (retry_at IS NULL OR retry_at<=NOW()) ORDER BY uploaded_at,id LIMIT 10")->fetchAll();
        foreach($images as $image){
            if(microtime(true)>=$deadline)break;
            $path=app_siya_news_image_path($image['id'],$image['extension']);
            try{
                if(!app_siya_news_file_matches($path,$image)){ $pdo->prepare("UPDATE eoffice_siya_news_images SET storage_state='review',error_code='local_integrity_failed' WHERE id=? AND storage_state='local'")->execute([$image['id']]);continue;}
                $parts=json_decode($image['drive_parts']??'[]',true,32,JSON_THROW_ON_ERROR);if(!is_array($parts)||!array_is_list($parts))throw new RuntimeException('archive_manifest_invalid');
                $in=fopen($path,'rb');if(!$in)throw new RuntimeException('archive_source_unavailable');$offset=0;
                try{
                    $remoteHash=hash_init('sha256');$verifiedParts=0;
                    foreach($parts as $index=>$part){if(microtime(true)>=$deadline)break;if(!is_array($part)||($part['offset']??null)!==$offset||!is_int($part['bytes']??null)||$part['bytes']<1||$part['bytes']>524288||$offset+$part['bytes']>(int)$image['bytes']||!preg_match('/^[a-f0-9]{64}$/D',$part['sha256']??'')||!is_string($part['file_id']??null))throw new RuntimeException('archive_manifest_invalid');
                        if(fseek($in,$offset)!==0)throw new RuntimeException('archive_source_unavailable');$existing=app_siya_news_read_exact($in,$part['bytes']);if(!hash_equals($part['sha256'],hash('sha256',$existing)))throw new RuntimeException('archive_source_changed');
                        if($transport!==null){$saved=($transport['put']??static fn($asset,$index,$bytes)=>['file_id'=>'mock-'.$asset.'-'.$index,'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes)])($image['id'],$index,$existing);$remote=($transport['get']??static fn($asset,$index,$part,$bytes)=>$bytes)($image['id'],$index,$saved,$existing);}
                        else{$saved=app_siya_news_drive_put_part($image['id'],$index,$existing);$remote=app_siya_news_drive_get_part($image['id'],$index,$saved);}
                        if(!is_string($remote)||$remote!==$existing||!hash_equals($part['sha256'],hash('sha256',$remote)))throw new RuntimeException('archive_integrity_failed');$saved['offset']=$offset;$parts[$index]=$saved;hash_update($remoteHash,$remote);$offset+=$part['bytes'];unset($remote,$existing);
                        $pdo->prepare('UPDATE eoffice_siya_news_images SET drive_parts=? WHERE id=? AND storage_state=\'local\'')->execute([json_encode($parts,JSON_THROW_ON_ERROR),$image['id']]);$verifiedParts++;}
                    if($verifiedParts<count($parts))continue;
                    while($offset<(int)$image['bytes']||!$parts){if(microtime(true)>=$deadline)break;$length=min(524288,(int)$image['bytes']-$offset);if(fseek($in,$offset)!==0)throw new RuntimeException('archive_source_unavailable');$chunk=app_siya_news_read_exact($in,$length);
                        if($transport!==null){$saved=($transport['put']??static fn($asset,$index,$bytes)=>['file_id'=>'mock-'.$asset.'-'.$index,'bytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes)])($image['id'],count($parts),$chunk);$remote=($transport['get']??static fn($asset,$index,$part,$bytes)=>$bytes)($image['id'],count($parts),$saved,$chunk);
                            if(!is_string($remote)||$remote!==$chunk)throw new RuntimeException('remote_readback_failed');}
                        else{$saved=app_siya_news_drive_put_part($image['id'],count($parts),$chunk);$remote=app_siya_news_drive_get_part($image['id'],count($parts),$saved);if(!hash_equals(hash('sha256',$chunk),hash('sha256',$remote))||$remote!==$chunk)throw new RuntimeException('remote_readback_failed');}
                        hash_update($remoteHash,$remote);unset($remote);$saved['offset']=$offset;$parts[]=$saved;$offset+=$length;$pdo->prepare('UPDATE eoffice_siya_news_images SET drive_parts=? WHERE id=? AND storage_state=\'local\'')->execute([json_encode($parts,JSON_THROW_ON_ERROR),$image['id']]);if($length===0)break;}
                }finally{fclose($in);}
                if($offset<(int)$image['bytes'])continue;
                if(!hash_equals($image['sha256'],hash_file('sha256',$path)))throw new RuntimeException('archive_source_changed');
                if(!hash_equals($image['sha256'],hash_final($remoteHash)))throw new RuntimeException('archive_integrity_failed');
                $pdo->beginTransaction();$q=$pdo->prepare("SELECT id FROM eoffice_siya_news_images WHERE id=? AND storage_state='local' AND sha256=? AND bytes=? FOR UPDATE");$q->execute([$image['id'],$image['sha256'],(int)$image['bytes']]);
                if($q->fetchColumn()){$pdo->prepare("UPDATE eoffice_siya_news_images SET storage_state='archived',drive_verified_at=NOW(),retry_at=NULL,attempts=0,error_code=NULL WHERE id=?")->execute([$image['id']]);$pdo->commit();$archived++;}else $pdo->rollBack();
            }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();if($e instanceof PDOException)throw $e;
                if(str_contains($e->getMessage(),'changed')||str_contains($e->getMessage(),'integrity')||str_contains($e->getMessage(),'manifest_invalid')){$pdo->prepare("UPDATE eoffice_siya_news_images SET storage_state='review',error_code='integrity_review' WHERE id=? AND storage_state='local'")->execute([$image['id']]);$error=$e;continue;}
                $attempt=(int)$image['attempts']+1;$delay=min(86400,(int)(300*(2**min(8,$attempt-1))));
                $pdo->prepare("UPDATE eoffice_siya_news_images SET attempts=?,retry_at=?,error_code='archive_retry_pending' WHERE id=? AND storage_state='local'")->execute([$attempt,date('Y-m-d H:i:s',time()+$delay),$image['id']]);$retry++;$error=$e;
            }
        }
        $quarantine=app_siya_news_root().'/quarantine';if(!is_dir($quarantine)&&!@mkdir($quarantine,0700)&&!is_dir($quarantine))throw new RuntimeException('SIYA NEWS quarantine unavailable');
        $q=$pdo->query("SELECT * FROM eoffice_siya_news_images WHERE storage_state='archived' AND drive_verified_at<=DATE_SUB(NOW(),INTERVAL 1 DAY) AND (retry_at IS NULL OR retry_at<=NOW()) ORDER BY drive_verified_at LIMIT 10");
        foreach($q->fetchAll() as $image){if(microtime(true)>=$deadline)break;$path=app_siya_news_image_path($image['id'],$image['extension']);$held=$quarantine.'/'.$image['id'].'.'.$image['extension'];
            try{$remote=app_siya_news_drive_image_bytes($image);unset($remote);}catch(Throwable $e){$code='evict_retry_pending';if(!is_file($path)&&is_file($held)){if(app_siya_news_file_matches($held,$image))@rename($held,$path);else $code='local_integrity_failed';}app_siya_news_defer_eviction($pdo,$image,$code);$error=$e;continue;}
            if(is_file($path)){if(!app_siya_news_file_matches($path,$image)){app_siya_news_defer_eviction($pdo,$image,'local_integrity_failed');continue;}if(!is_file($held)&&!@rename($path,$held)){app_siya_news_defer_eviction($pdo,$image,'evict_retry_pending');continue;}}
            if(is_file($held)){if(!app_siya_news_file_matches($held,$image)){app_siya_news_defer_eviction($pdo,$image,'local_integrity_failed');continue;}if(@unlink($held))$removed++;else{app_siya_news_defer_eviction($pdo,$image,'evict_retry_pending');continue;}}
            if(!is_file($path)&&!is_file($held))$pdo->prepare("UPDATE eoffice_siya_news_images SET storage_state='remote',retry_at=NULL,attempts=0,error_code=NULL WHERE id=? AND storage_state='archived'")->execute([$image['id']]);
        }
    }finally{$pdo->query("SELECT RELEASE_LOCK('eoffice:siya-news-archive')");}
    if($error)error_log('SIYA NEWS image archival deferred after '.get_class($error));
    return ['enabled'=>true,'archived'=>$archived,'retry_pending'=>$retry,'removed'=>$removed];
}
function app_siya_news_read_exact($stream,int $bytes): string {
    $result='';while(strlen($result)<$bytes){$chunk=fread($stream,min(262144,$bytes-strlen($result)));if($chunk===false||$chunk==='')throw new RuntimeException('archive_source_unavailable');$result.=$chunk;}return $result;
}
function app_siya_news_file_matches(string $path,array $image): bool {
    if(!is_file($path)||filesize($path)!==(int)$image['bytes'])return false;
    $hash=hash_file('sha256',$path);return is_string($hash)&&hash_equals((string)$image['sha256'],$hash);
}
function app_siya_news_defer_eviction(PDO $pdo,array $image,string $code): void {
    $attempt=(int)$image['attempts']+1;$delay=min(86400,(int)(300*(2**min(8,$attempt-1))));
    $pdo->prepare('UPDATE eoffice_siya_news_images SET attempts=?,retry_at=?,error_code=? WHERE id=? AND storage_state=\'archived\'')->execute([$attempt,date('Y-m-d H:i:s',time()+$delay),$code,$image['id']]);
}
