<?php
require_once __DIR__.'/drive-archive.php';
require_once __DIR__.'/database-backup.php';

function app_drive_archive_upload_version(array $version,float $deadline,?array $transport=null): bool {
    if($transport!==null&&(!app_settings()['mock']||!str_ends_with(app_settings()['database'],'_test')))throw new RuntimeException('Test transports only');
    $get=$transport['get']??'app_drive_archive_get';$put=$transport['put']??'app_drive_archive_put';$pdo=app_pdo();
    $spool=app_drive_archive_directory('spool');$source=$spool.'/'.$version['id'].'.source';$key=app_drive_archive_key($version['key_id']);
    if(!is_file($source)||filesize($source)!==(int)$version['bytes']||!hash_equals($version['revision'],hash_file('sha256',$source)))throw new RuntimeException('Archive upload source unavailable');
    $parts=json_decode($version['parts']??'[]',true,32,JSON_THROW_ON_ERROR)??[];$offset=0;
    foreach($parts as $part){if(($part['offset']??null)!==$offset||!is_int($part['bytes']??null)||$part['bytes']<0||$part['bytes']>1048576||!preg_match('/^[a-f0-9]{64}$/',$part['object']??'')||!preg_match('/^[a-f0-9]{64}$/',$part['sha256']??''))throw new RuntimeException('Upload offset mismatch');$offset+=$part['bytes'];}
    if($offset>(int)$version['bytes'])throw new RuntimeException('Upload manifest exceeds source');
    $in=fopen($source,'rb');if(!$in)throw new RuntimeException('Archive upload source unavailable');
    try{
        if(fseek($in,$offset)!==0)throw new RuntimeException('Archive source seek failed');
        while($offset<(int)$version['bytes']||!$parts){
            if(microtime(true)>=$deadline)return false;
            $length=min(1048576,(int)$version['bytes']-$offset);$plain=app_backup_read_exact($in,$length);
            $encrypted=$spool.'/'.$version['id'].'.'.count($parts).'.ebak';
            if(!is_file($encrypted)){
                if(is_file($encrypted.'.partial'))unlink($encrypted.'.partial');
                $writer=new AppBackupWriter($encrypted.'.partial',$key,'eoffice-document-slice');$writer->write($plain);$writer->finish();unset($writer);app_backup_publish($encrypted.'.partial',$encrypted);
            }
            $verification=app_backup_verify($encrypted,$key);
            if($verification['bytes']!==$length||$verification['sha256']!==hash('sha256',$plain))throw new RuntimeException('Spool part mismatch');unset($plain);
            $cipher=file_get_contents($encrypted);$object=$put($cipher);
            if(!is_string($object)||!hash_equals(hash('sha256',$cipher),$object))throw new RuntimeException('Upload object mismatch');unset($cipher);
            $parts[]=['offset'=>$offset,'bytes'=>$length,'sha256'=>$verification['sha256'],'object'=>$object];$offset+=$length;
            $pdo->prepare('UPDATE eoffice_drive_versions SET parts=? WHERE id=?')->execute([json_encode($parts,JSON_THROW_ON_ERROR),$version['id']]);
            if($length===0)break;
        }
    }finally{fclose($in);}
    // Read back and authenticate the complete remote file before allowing local
    // eviction. A provider success response alone is not sufficient.
    $candidate=$version;$candidate['parts']=json_encode($parts,JSON_THROW_ON_ERROR);$candidate['status']='verified';
    app_drive_archive_restore($candidate,$transport['get']??null);
    $pdo->prepare("UPDATE eoffice_drive_versions SET status='verified',verified_at=NOW() WHERE id=?")->execute([$version['id']]);
    if(is_file($source))unlink($source);
    foreach(glob($spool.'/'.$version['id'].'.*.ebak')?:[] as $part)unlink($part);
    return true;
}
function app_drive_archive_legacy_fetch(array $doc,string $name,bool $signed,float $deadline): ?string {
    if($name!==basename($name)||str_contains($name,'\\')||!preg_match('/^\d{4}$/D',(string)$doc['Doc_Year']))throw new RuntimeException('Invalid legacy archive identity');
    $remaining=(int)floor($deadline-microtime(true));if($remaining<2)return null;
    $body='';$ch=curl_init('https://eoffice.siya.ac.th/file_request.php?File_Path='.rawurlencode($doc['Doc_Year'].'/'.$name).'&Type='.($signed?'signed':''));
    curl_setopt_array($ch,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>min(10,$remaining),CURLOPT_TIMEOUT=>min(20,$remaining),CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,
        CURLOPT_WRITEFUNCTION=>static function($ch,$bytes)use(&$body){if(strlen($body)+strlen($bytes)>20*1024*1024)return 0;$body.=$bytes;return strlen($bytes);}]);
    $ok=curl_exec($ch);$status=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);
    if($ok===false||$status!==200||$body==='')return null;
    $mime=(new finfo(FILEINFO_MIME_TYPE))->buffer($body);
    if($signed&&$mime!=='application/pdf')return null;
    if(!in_array($mime,['application/pdf','image/jpeg','image/png','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],true))return null;
    $path=app_drive_archive_directory('spool').'/legacy-'.bin2hex(random_bytes(16)).'.tmp';
    if(file_put_contents($path,$body)!==strlen($body)){if(is_file($path))unlink($path);throw new RuntimeException('Legacy staging failed');}chmod($path,0600);return $path;
}
function app_drive_archive_scan(int $limit=10,?float $deadline=null): int {
    $pdo=app_pdo();$cursor=(int)$pdo->query('SELECT scan_doc FROM eoffice_drive_state WHERE id=1')->fetchColumn();
    $query=$pdo->prepare("SELECT Doc_Id FROM t_document WHERE Is_Delete='active' AND Doc_Id>? ORDER BY Doc_Id LIMIT ".max(1,min(100,$limit)));$query->execute([$cursor]);$ids=$query->fetchAll(PDO::FETCH_COLUMN);
    if(!$ids){$pdo->exec('UPDATE eoffice_drive_state SET scan_doc=0,full_scan_at=NOW() WHERE id=1');return 0;}
    foreach($ids as $id){
        if($deadline!==null&&microtime(true)>=$deadline)break;
        $staged=[];
        // Old attachments are still served by the trusted legacy origin. Fetch
        // outside document locks, then install only still-bound absent paths.
        if(app_settings()['remote_files']){
            $q=$pdo->prepare("SELECT * FROM t_document WHERE Doc_Id=? AND Is_Delete='active'");$q->execute([$id]);$candidate=$q->fetch();
            if($candidate){$q=$pdo->prepare('SELECT Doc_Upload_Path FROM t_document_upload WHERE Doc_File_Link=?');$q->execute([$candidate['Doc_File_Link']]);
                foreach($q->fetchAll(PDO::FETCH_COLUMN) as $name){
                    $original=app_drive_archive_local($candidate,$name,'original');
                    if(is_file($original)||app_drive_archive_current((int)$id,$name,'original'))continue;
                    $plain=app_drive_archive_legacy_fetch($candidate,$name,false,$deadline??microtime(true)+60);if(!$plain)continue;
                    $staged[]=[$name,'original',$plain,(string)$candidate['Doc_Year']];
                    if((new finfo(FILEINFO_MIME_TYPE))->file($plain)==='application/pdf'&&!is_file(app_drive_archive_local($candidate,$name,'signed'))&&!app_drive_archive_current((int)$id,$name,'signed')){
                        $signed=app_drive_archive_legacy_fetch($candidate,$name,true,$deadline??microtime(true)+60);
                        if($signed){if(hash_file('sha256',$signed)!==hash_file('sha256',$plain))$staged[]=[$name,'signed',$signed,(string)$candidate['Doc_Year']];else unlink($signed);}
                    }
                    if($deadline!==null&&microtime(true)>=$deadline)break;
                }
            }
        }
        app_document_transaction();
        try{
            $q=$pdo->prepare("SELECT * FROM t_document WHERE Doc_Id=? AND Is_Delete='active' FOR UPDATE");$q->execute([$id]);$doc=$q->fetch();
            if($doc){
                foreach($staged as [$name,$variant,$temporary,$year]){
                    if((string)$doc['Doc_Year']!==$year)continue;$bound=$pdo->prepare('SELECT 1 FROM t_document_upload WHERE Doc_File_Link=? AND Doc_Upload_Path=?');$bound->execute([$doc['Doc_File_Link'],$name]);if(!$bound->fetchColumn())continue;
                    $path=app_drive_archive_local($doc,$name,$variant);if(is_file($path)||app_drive_archive_current((int)$id,$name,$variant))continue;
                    if(!is_dir(dirname($path))&&!mkdir(dirname($path),0750,true))throw new RuntimeException('Legacy archive directory unavailable');app_backup_publish($temporary,$path);
                }
                $q=$pdo->prepare('SELECT Doc_Upload_Path FROM t_document_upload WHERE Doc_File_Link=?');$q->execute([$doc['Doc_File_Link']]);
                foreach($q->fetchAll(PDO::FETCH_COLUMN) as $name)foreach(['original','signed'] as $variant){$path=app_drive_archive_local($doc,$name,$variant);if(is_file($path))app_drive_archive_track((int)$id,$name,$variant,$path);}
            }
            $pdo->prepare('UPDATE eoffice_drive_state SET scan_doc=? WHERE id=1')->execute([$id]);$pdo->commit();
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        finally{foreach($staged as $part)if(is_file($part[2]))unlink($part[2]);}
    }return count($ids);
}
function app_drive_archive_evict(array $version,?array $transport=null): bool {
    if(!filter_var(app_env('EOFFICE_DRIVE_EVICT_ENABLED','false'),FILTER_VALIDATE_BOOLEAN))return false;
    $pdo=app_pdo();if($pdo->inTransaction())throw new RuntimeException('Eviction requires its own transaction');
    if($transport!==null&&(!app_settings()['mock']||!str_ends_with(app_settings()['database'],'_test')))throw new RuntimeException('Test transports only');
    $q=$pdo->prepare("SELECT * FROM eoffice_drive_backups WHERE status='completed' ORDER BY backup_date DESC LIMIT 1");$q->execute();$backup=$q->fetch();
    if(!$backup||strtotime($backup['completed_at'])<time()-172800)return false;
        $manifest=json_decode($backup['manifest'],true,64,JSON_THROW_ON_ERROR);if(!isset($manifest['versions'][$version['id']]))return false;
    $grace=max(7,(int)app_env('EOFFICE_DRIVE_EVICT_GRACE_DAYS','14'));
    if(!$version['verified_at']||strtotime($version['verified_at'])>time()-$grace*86400)return false;
    // Force a new remote read-back, not a cached successful read, before deletion.
    $cacheRoot=app_drive_archive_directory('cache');$cache=$cacheRoot.'/'.$version['id'].'.plain';$cacheLock=fopen($cacheRoot.'/'.$version['id'].'.lock','c+b');if(!$cacheLock||!flock($cacheLock,LOCK_EX))throw new RuntimeException('Archive cache lock unavailable');
    try{if(is_file($cache))unlink($cache);}finally{flock($cacheLock,LOCK_UN);fclose($cacheLock);}
    app_drive_archive_restore($version,$transport['get']??null);
    app_document_transaction();$quarantine=null;$local=null;
    try{
        $q=$pdo->prepare("SELECT * FROM t_document WHERE Doc_Id=? AND Is_Delete='active' FOR UPDATE");$q->execute([$version['doc_id']]);$doc=$q->fetch();
        if(!$doc||!app_drive_archive_old_year((int)$doc['Doc_Year'])){$pdo->rollBack();return false;}
        $q=$pdo->prepare('SELECT 1 FROM t_document_upload WHERE Doc_File_Link=? AND Doc_Upload_Path=?');$q->execute([$doc['Doc_File_Link'],$version['file_name']]);if(!$q->fetchColumn()){$pdo->rollBack();return false;}
        $current=app_drive_archive_current((int)$version['doc_id'],$version['file_name'],$version['variant']);
        if(!$current||$current['id']!==$version['id']||$current['status']!=='verified'){$pdo->rollBack();return false;}
        $q=$pdo->prepare("SELECT 1 FROM eoffice_order_jobs WHERE doc_id=? AND status IN ('waiting_files','analyzing','sending','queued') LIMIT 1");$q->execute([$doc['Doc_Id']]);if($q->fetchColumn()){$pdo->rollBack();return false;}
        $local=app_drive_archive_local($doc,$version['file_name'],$version['variant']);
        if(!is_file($local)||!hash_equals($version['revision'],hash_file('sha256',$local))){$pdo->rollBack();return false;}
        if($version['variant']==='signed'&&$local!==app_storage('e-sign',(string)$doc['Doc_Year'],'signed_'.$doc['Doc_Id'].'_'.$version['file_name'])){$pdo->rollBack();return false;}
        // Shared legacy names can be referenced by several documents. Do not
        // remove their inode until a migration gives each document its own copy.
        $q=$pdo->prepare("SELECT COUNT(*) FROM t_document_upload u JOIN t_document d ON d.Doc_File_Link=u.Doc_File_Link WHERE u.Doc_Upload_Path=? AND d.Doc_Year=? AND d.Is_Delete='active'");$q->execute([$version['file_name'],$doc['Doc_Year']]);if((int)$q->fetchColumn()>1){$pdo->rollBack();return false;}
        $quarantine=app_drive_archive_directory('quarantine').'/'.$version['id'].'.source';
        if(is_file($quarantine))throw new RuntimeException('Unresolved archive quarantine exists');
        if(!rename($local,$quarantine))throw new RuntimeException('Archive eviction failed');
        $pdo->prepare('UPDATE eoffice_drive_versions SET evicted_at=NOW() WHERE id=?')->execute([$version['id']]);$pdo->exec('UPDATE eoffice_drive_state SET evicted=evicted+1 WHERE id=1');$pdo->commit();
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();if($quarantine&&is_file($quarantine)&&$local&&!is_file($local))rename($quarantine,$local);throw $e;}
    // Preserve a one-day recoverable quarantine after commit; the sweeper only
    // removes files whose DB eviction marker exists.
    return true;
}
function app_drive_archive_worker(int $seconds=90,?array $transport=null): array {
    if(!app_drive_archive_enabled())return ['enabled'=>false];
    if($transport!==null&&(!app_settings()['mock']||!str_ends_with(app_settings()['database'],'_test')))throw new RuntimeException('Test transports only');
    $pdo=app_pdo();if(!$pdo->query("SELECT GET_LOCK('eoffice:drive-archive',0)")->fetchColumn())return ['skipped'=>true];
    $deadline=microtime(true)+max(1,min(240,$seconds));$uploaded=0;$evicted=0;
    try{
        $pdo->exec('UPDATE eoffice_drive_state SET worker_at=NOW(),error_code=NULL WHERE id=1');
        if($transport===null)app_drive_archive_call(['action'=>'health']);
        $backlog=(int)$pdo->query("SELECT COUNT(*) FROM eoffice_drive_versions WHERE status='pending'")->fetchColumn();
        if($backlog<100){
            $scanDeadline=min($deadline,microtime(true)+max(2,$seconds*0.35));
            app_drive_archive_scan(max(1,min(100,(int)app_env('EOFFICE_DRIVE_SCAN_BATCH','100'))),$scanDeadline);
        }
        $versions=$pdo->query("SELECT * FROM eoffice_drive_versions WHERE status='pending' ORDER BY created_at,id LIMIT 20")->fetchAll();
        foreach($versions as $version){if(microtime(true)>=$deadline)break;if(app_drive_archive_upload_version($version,$deadline,$transport)){$uploaded++;$pdo->exec('UPDATE eoffice_drive_state SET uploaded=uploaded+1 WHERE id=1');}}
        $q=$pdo->prepare("SELECT v.* FROM eoffice_drive_files f JOIN eoffice_drive_versions v ON v.id=f.version_id JOIN t_document d ON d.Doc_Id=f.doc_id WHERE v.status='verified' AND v.evicted_at IS NULL AND d.Is_Delete='active' AND CAST(d.Doc_Year AS UNSIGNED)<? AND v.verified_at<DATE_SUB(NOW(),INTERVAL ".max(7,(int)app_env('EOFFICE_DRIVE_EVICT_GRACE_DAYS','14'))." DAY) ORDER BY v.verified_at LIMIT 20");$q->execute([(int)date('Y')+543-2]);$versions=$q->fetchAll();
        foreach($versions as $version){if(microtime(true)>=$deadline)break;if(app_drive_archive_evict($version,$transport))$evicted++;}
        $quarantine=app_drive_archive_directory('quarantine');
        foreach(glob($quarantine.'/*.source')?:[] as $path){
            $id=basename($path,'.source');$q=$pdo->prepare('SELECT * FROM eoffice_drive_versions WHERE id=?');$q->execute([$id]);$version=$q->fetch();if(!$version)continue;
            if($version['evicted_at']){if(strtotime($version['evicted_at'])<time()-86400)unlink($path);continue;}
            app_document_transaction();
            try{
                $q=$pdo->prepare('SELECT * FROM t_document WHERE Doc_Id=? FOR UPDATE');$q->execute([$version['doc_id']]);$doc=$q->fetch();
                if($doc){$current=app_drive_archive_current((int)$doc['Doc_Id'],$version['file_name'],$version['variant']);$local=app_drive_archive_local($doc,$version['file_name'],$version['variant']);
                    if($current&&$current['id']===$id&&!is_file($local)&&hash_equals($version['revision'],hash_file('sha256',$path)))rename($path,$local);
                }$pdo->commit();
            }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        }
        $referenced=array_fill_keys($pdo->query('SELECT id FROM eoffice_drive_versions')->fetchAll(PDO::FETCH_COLUMN),true);
        foreach(glob(app_drive_archive_directory('spool').'/*.source')?:[] as $path){$id=basename($path,'.source');if(filemtime($path)<time()-86400&&!isset($referenced[$id]))unlink($path);}
        return ['enabled'=>true,'uploaded'=>$uploaded,'evicted'=>$evicted,'cache_removed'=>app_drive_archive_cache_sweep()];
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();$pdo->exec("UPDATE eoffice_drive_state SET error_code='worker_failed' WHERE id=1");throw $e;}
    finally{$pdo->query("SELECT RELEASE_LOCK('eoffice:drive-archive')");}
}
function app_drive_archive_snapshot(PDO $pdo): array {
    if(!$pdo->query('SELECT full_scan_at FROM eoffice_drive_state WHERE id=1')->fetchColumn())throw new RuntimeException('Initial archive scan incomplete');
    $manifest=['version'=>1,'created_at'=>gmdate('c'),'versions'=>[],'documents'=>[]];
    $files=$pdo->query("SELECT d.Doc_Id,d.Doc_Year,u.Doc_Upload_Path FROM t_document d JOIN t_document_upload u ON u.Doc_File_Link=d.Doc_File_Link WHERE d.Is_Delete='active' ORDER BY d.Doc_Id,u.Doc_Upload_Id")->fetchAll();
    foreach($files as $file){
        foreach(['original','signed'] as $variant){
            $q=$pdo->prepare('SELECT v.* FROM eoffice_drive_files f JOIN eoffice_drive_versions v ON v.id=f.version_id WHERE f.doc_id=? AND f.file_name=? AND f.variant=?');$q->execute([$file['Doc_Id'],$file['Doc_Upload_Path'],$variant]);$version=$q->fetch();
            if(!$version&&$variant==='signed'){
                $q=$pdo->prepare('SELECT revision FROM eoffice_signed_files WHERE Doc_Id=? AND file_name=?');$q->execute([$file['Doc_Id'],$file['Doc_Upload_Path']]);if(!$q->fetchColumn())continue;
            }
            if(!$version||$version['status']!=='verified')throw new RuntimeException('Snapshot references files not verified on Drive');
            app_drive_archive_parts($version);
            $manifest['versions'][$version['id']]=$version;
            $manifest['documents'][]=['doc_id'=>(int)$file['Doc_Id'],'year'=>$file['Doc_Year'],'name'=>$file['Doc_Upload_Path'],'variant'=>$variant,'version'=>$version['id']];
        }
    }return $manifest;
}
function app_drive_archive_backup(?array $transport=null): array {
    if($transport!==null&&(!app_settings()['mock']||!str_ends_with(app_settings()['database'],'_test')))throw new RuntimeException('Test transports only');
    if(!app_drive_archive_enabled()||(!app_drive_archive_configured()&&$transport===null))return ['enabled'=>false];
    $call=$transport['call']??'app_drive_archive_call';$put=$transport['put']??'app_drive_archive_put';$get=$transport['get']??'app_drive_archive_get';
    $pdo=app_pdo();if(!$pdo->query("SELECT GET_LOCK('eoffice:drive-daily',0)")->fetchColumn())return ['skipped'=>true];
    $date=date('Y-m-d');
    try{
        $call(['action'=>'health']);
        $q=$pdo->prepare('SELECT * FROM eoffice_drive_backups WHERE backup_date=?');$q->execute([$date]);$run=$q->fetch();
        if($run&&$run['status']==='completed')return ['already_completed'=>true,'date'=>$date];
        $pdo->prepare("INSERT IGNORE INTO eoffice_drive_backups (backup_date) VALUES (?)")->execute([$date]);
        if(!$run||!$run['manifest']){
            $backup=app_database_backup('app_drive_archive_snapshot');if(!($backup['created']??false))return ['skipped'=>true];
            $manifest=$backup['snapshot'];unset($backup['snapshot']);$manifest['database']=$backup;$manifest['key_id']=substr(hash('sha256',app_drive_archive_key()),0,16);
            $pdo->prepare('UPDATE eoffice_drive_backups SET manifest=? WHERE backup_date=?')->execute([json_encode($manifest,JSON_THROW_ON_ERROR),$date]);
        }else $manifest=json_decode($run['manifest'],true,128,JSON_THROW_ON_ERROR);
        // Both envelopes are retained as per-run archives. Upload ciphertext
        // pieces by content hash; interrupted retry simply reuses known objects.
        $spool=app_drive_archive_directory('spool');$file=$spool.'/daily-'.$date.'.ebak';
        if(!is_file($file)){
            if(is_file($file.'.partial'))unlink($file.'.partial');
            $writer=new AppBackupWriter($file.'.partial',app_drive_archive_key($manifest['key_id']),'eoffice-drive-manifest');$writer->write(json_encode($manifest,JSON_THROW_ON_ERROR));$writer->finish();unset($writer);app_backup_publish($file.'.partial',$file);
        }
        $objects=[];
        foreach(['database'=>$manifest['database']['path'],'manifest'=>$file] as $label=>$source){
            $objects[$label]=['sha256'=>hash_file('sha256',$source),'bytes'=>filesize($source),'parts'=>[]];$handle=fopen($source,'rb');
            if(!$handle)throw new RuntimeException('Daily archive unavailable');
            try{
                while(!feof($handle)){$bytes=fread($handle,1048576);if($bytes===false)throw new RuntimeException('Daily archive read failed');if($bytes==='')continue;$id=$put($bytes);if(!hash_equals($id,hash('sha256',$get($id))))throw new RuntimeException('Daily upload verification failed');$objects[$label]['parts'][]=$id;}
            }finally{fclose($handle);}
        }
        // Small bootstrap descriptor contains no names or personnel data and
        // makes the encrypted manifests discoverable after a lost server DB.
        $descriptor=json_encode(['version'=>1,'date'=>$date,'key_id'=>$manifest['key_id'],'archives'=>$objects],JSON_THROW_ON_ERROR);
        $index=$put($descriptor);$objects['descriptor']=$index;
        $checkpoint=$call(['action'=>'checkpoint','date'=>$date,'descriptor'=>$index]);if(($checkpoint['descriptor']??'')!==$index)throw new RuntimeException('Daily recovery checkpoint mismatch');
        $pdo->prepare("UPDATE eoffice_drive_backups SET status='completed',objects=?,completed_at=NOW(),error_code=NULL WHERE backup_date=?")->execute([json_encode($objects,JSON_THROW_ON_ERROR),$date]);
        return ['completed'=>true,'date'=>$date,'descriptor'=>$index,'versions'=>count($manifest['versions'])];
    }catch(Throwable $e){$pdo->prepare("UPDATE eoffice_drive_backups SET error_code='backup_failed' WHERE backup_date=?")->execute([$date]);throw $e;}
    finally{$pdo->query("SELECT RELEASE_LOCK('eoffice:drive-daily')");}
}
