<?php
require_once __DIR__.'/drive-archive.php';
require_once __DIR__.'/database-backup.php';

function app_drive_archive_upload_version(array $version,float $deadline,?array $transport=null): bool {
    if($transport!==null&&(!app_settings()['mock']||!str_ends_with(app_settings()['database'],'_test')))throw new RuntimeException('Test transports only');
    $pdo=app_pdo();$heartbeat=static function()use($pdo):void{$pdo->query('SELECT 1')->fetchColumn();};
    $get=$transport['get']??static fn(string $id)=>app_drive_archive_get($id,$heartbeat);$put=$transport['put']??static fn(string $bytes)=>app_drive_archive_put($bytes,$heartbeat);
    $spool=app_drive_archive_directory('spool');$source=$spool.'/'.$version['id'].'.source';$key=app_drive_archive_key($version['key_id']);
    if(!is_file($source)||filesize($source)!==(int)$version['bytes']||!hash_equals($version['revision'],hash_file('sha256',$source)))throw new RuntimeException('Archive upload source unavailable');
    $saved=$version;$saved['parts']=$version['parts']??'[]';$parts=app_drive_archive_parts($saved,true);$offset=0;
    $in=fopen($source,'rb');if(!$in)throw new RuntimeException('Archive upload source unavailable');
    try{
        // Upgrade old checkpoints by authenticating their remote bytes. Persist
        // each successful check so a resumed large file does not start over.
        foreach($parts as $index=>$part){
            $plain=app_backup_read_exact($in,$part['bytes']);
            if(!hash_equals($part['sha256'],hash('sha256',$plain)))throw new RuntimeException('Saved part differs from source');
            if(($part['readback_verified']??false)!==true){
                if(microtime(true)>=$deadline)return false;
                app_drive_archive_verify_slice($get($part['object']),$part,$key);
                $parts[$index]['readback_verified']=true;
                $pdo->prepare('UPDATE eoffice_drive_versions SET parts=? WHERE id=?')->execute([json_encode($parts,JSON_THROW_ON_ERROR),$version['id']]);
            }
            $offset+=$part['bytes'];
        }
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
            if(!is_string($object)||!hash_equals(hash('sha256',$cipher),$object))throw new RuntimeException('Upload object mismatch');
            $part=['offset'=>$offset,'bytes'=>$length,'sha256'=>$verification['sha256'],'object'=>$object];
            $remote=$get($object);if($remote!==$cipher)throw new RuntimeException('Remote encrypted part differs');
            app_drive_archive_verify_slice($remote,$part,$key);unset($cipher,$remote);
            $part['readback_verified']=true;$parts[]=$part;$offset+=$length;
            $pdo->prepare('UPDATE eoffice_drive_versions SET parts=? WHERE id=?')->execute([json_encode($parts,JSON_THROW_ON_ERROR),$version['id']]);
            if($length===0)break;
        }
    }finally{fclose($in);}
    // Every slice is authenticated before its checkpoint commit. Validate the
    // complete manifest/source without trusting a pre-existing plaintext cache.
    $candidate=$version;$candidate['parts']=json_encode($parts,JSON_THROW_ON_ERROR);$candidate['status']='verified';
    app_drive_archive_parts($candidate);
    if(!hash_equals($version['revision'],hash_file('sha256',$source)))throw new RuntimeException('Archive source changed during upload');
    $pdo->prepare("UPDATE eoffice_drive_versions SET status='verified',verified_at=NOW(),retry_at=NULL,attempts=0,error_code=NULL WHERE id=?")->execute([$version['id']]);
    if(is_file($source))unlink($source);
    foreach(glob($spool.'/'.$version['id'].'.*.ebak')?:[] as $part)unlink($part);
    return true;
}
function app_drive_archive_verify_slice(string $cipher,array $part,string $key): void {
    if(strlen($cipher)>2097152||!hash_equals($part['object'],hash('sha256',$cipher)))throw new RuntimeException('Remote ciphertext mismatch');
    $temporary=app_drive_archive_directory('spool').'/verify-'.bin2hex(random_bytes(16)).'.ebak';
    try{
        if(file_put_contents($temporary,$cipher)!==strlen($cipher))throw new RuntimeException('Verification staging failed');chmod($temporary,0600);
        $result=app_backup_verify($temporary,$key);
        if($result['bytes']!==$part['bytes']||!hash_equals($part['sha256'],$result['sha256']))throw new RuntimeException('Remote plaintext mismatch');
    }finally{if(is_file($temporary))unlink($temporary);}
}
function app_drive_archive_upload_batch(float $deadline,?array $transport=null): array {
    if($transport!==null&&(!app_settings()['mock']||!str_ends_with(app_settings()['database'],'_test')))throw new RuntimeException('Test transports only');
    $pdo=app_pdo();$uploaded=0;$retry=0;$review=0;
    $versions=$pdo->query("SELECT * FROM eoffice_drive_versions WHERE status='pending' AND (retry_at IS NULL OR retry_at<=NOW()) ORDER BY attempts,created_at,id LIMIT 20")->fetchAll();
    foreach($versions as $version){
        if(microtime(true)>=$deadline)break;
        try{
            if(app_drive_archive_upload_version($version,$deadline,$transport)){$uploaded++;$pdo->exec('UPDATE eoffice_drive_state SET uploaded=uploaded+1 WHERE id=1');}
        }catch(AppDriveArchiveRetry $e){
            $attempt=(int)($version['attempts']??0)+1;$delay=min(21600,300*(2**min(6,$attempt-1)));
            $pdo->prepare("UPDATE eoffice_drive_versions SET attempts=?,retry_at=?,error_code='cloud_retry_pending' WHERE id=? AND status='pending'")->execute([$attempt,date('Y-m-d H:i:s',time()+$delay),$version['id']]);$retry++;
        }catch(PDOException $e){throw $e;}
        catch(Throwable $e){
            // Broken source/key/manifest/ciphertext needs investigation, not an
            // endless FIFO retry that blocks every later attachment.
            $pdo->prepare("UPDATE eoffice_drive_versions SET status='review',retry_at=NULL,error_code='verification_failed' WHERE id=? AND status='pending'")->execute([$version['id']]);$review++;
        }
    }return ['uploaded'=>$uploaded,'retry_pending'=>$retry,'review_required'=>$review];
}
function app_drive_archive_legacy_fetch(array $doc,string $name,bool $signed,float $deadline,?int &$http=null): ?string {
    if($name!==basename($name)||str_contains($name,'\\')||!preg_match('/^\d{4}$/D',(string)$doc['Doc_Year']))throw new RuntimeException('Invalid legacy archive identity');
    $http=0;$remaining=(int)floor($deadline-microtime(true));if($remaining<2)return null;
    $body='';$ch=curl_init('https://eoffice.siya.ac.th/file_request.php?File_Path='.rawurlencode($doc['Doc_Year'].'/'.$name).'&Type='.($signed?'signed':''));
    curl_setopt_array($ch,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>min(10,$remaining),CURLOPT_TIMEOUT=>min(20,$remaining),CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,
        CURLOPT_WRITEFUNCTION=>static function($ch,$bytes)use(&$body){if(strlen($body)+strlen($bytes)>20*1024*1024)return 0;$body.=$bytes;return strlen($bytes);}]);
    $ok=curl_exec($ch);$status=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);$http=$status;
    if($ok===false||$status!==200||$body==='')return null;
    $mime=(new finfo(FILEINFO_MIME_TYPE))->buffer($body);
    if($signed&&$mime!=='application/pdf')return null;
    if(!in_array($mime,['application/pdf','image/jpeg','image/png','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],true))return null;
    $path=app_drive_archive_directory('spool').'/legacy-'.bin2hex(random_bytes(16)).'.tmp';
    if(file_put_contents($path,$body)!==strlen($body)){if(is_file($path))unlink($path);throw new RuntimeException('Legacy staging failed');}chmod($path,0600);return $path;
}
function app_drive_archive_scan(int $limit=10,?float $deadline=null): int {
    $pdo=app_pdo();$cursor=(int)$pdo->query('SELECT scan_doc FROM eoffice_drive_state WHERE id=1')->fetchColumn();
    $query=$pdo->prepare("SELECT DISTINCT d.Doc_Id FROM t_document d JOIN t_document_upload u ON u.Doc_File_Link=d.Doc_File_Link WHERE d.Is_Delete='active' AND d.Doc_Id>? ORDER BY d.Doc_Id LIMIT ".max(1,min(100,$limit)));$query->execute([$cursor]);$ids=$query->fetchAll(PDO::FETCH_COLUMN);
    if(!$ids){$pdo->exec('UPDATE eoffice_drive_state SET scan_doc=0,full_scan_at=NOW() WHERE id=1');return 0;}
    foreach($ids as $id){
        if($deadline!==null&&microtime(true)>=$deadline)break;
        $staged=[];$legacyIncomplete=false;
        // Old attachments are still served by the trusted legacy origin. Fetch
        // outside document locks, then install only still-bound absent paths.
        if(app_settings()['remote_files']){
            $q=$pdo->prepare("SELECT * FROM t_document WHERE Doc_Id=? AND Is_Delete='active'");$q->execute([$id]);$candidate=$q->fetch();
            if($candidate){$q=$pdo->prepare('SELECT Doc_Upload_Path FROM t_document_upload WHERE Doc_File_Link=?');$q->execute([$candidate['Doc_File_Link']]);
                foreach($q->fetchAll(PDO::FETCH_COLUMN) as $name){
                    $original=app_drive_archive_local($candidate,$name,'original');
                    $known=app_drive_archive_current((int)$id,$name,'original');$plain=is_file($original)?$original:null;
                    if(!$plain&&!$known){
                        $plain=app_drive_archive_legacy_fetch($candidate,$name,false,$deadline??microtime(true)+60,$http);
                        if($plain)$staged[]=[$name,'original',$plain,(string)$candidate['Doc_Year']];elseif($http===0||$http>=500)$legacyIncomplete=true;
                    }
                    $originalRevision=$plain?hash_file('sha256',$plain):($known['revision']??null);
                    if($originalRevision&&strtolower(pathinfo($name,PATHINFO_EXTENSION))==='pdf'&&!is_file(app_drive_archive_local($candidate,$name,'signed'))&&!app_drive_archive_current((int)$id,$name,'signed')){
                        $signed=app_drive_archive_legacy_fetch($candidate,$name,true,$deadline??microtime(true)+60,$http);
                        if($signed){if(hash_file('sha256',$signed)!==$originalRevision)$staged[]=[$name,'signed',$signed,(string)$candidate['Doc_Year']];else unlink($signed);}elseif($http===0||$http>=500)$legacyIncomplete=true;
                    }
                    if($deadline!==null&&microtime(true)>=$deadline){$legacyIncomplete=true;break;}
                }
            }
        }
        $fileLock=app_document_file_lock((int)$id);
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
            if(!$legacyIncomplete)$pdo->prepare('UPDATE eoffice_drive_state SET scan_doc=? WHERE id=1')->execute([$id]);$pdo->commit();
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        finally{foreach($staged as $part)if(is_file($part[2]))unlink($part[2]);$fileLock->release();}
        if($legacyIncomplete)break;
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
    // Holding the cache lock inside restore prevents a concurrent reader from
    // repopulating the cache and bypassing fresh remote verification.
    app_drive_archive_restore($version,$transport['get']??null,true);
    $fileLock=app_document_file_lock((int)$version['doc_id']);
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
    finally{$fileLock->release();}
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
        $batch=app_drive_archive_upload_batch($deadline,$transport);$uploaded=$batch['uploaded'];
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
                    if($current&&$current['id']===$id&&hash_equals($version['revision'],hash_file('sha256',$path))){
                        if(!is_file($local))app_backup_publish($path,$local);
                        elseif(hash_equals($version['revision'],hash_file('sha256',$local))&&!unlink($path))throw new RuntimeException('Duplicate quarantine cleanup failed');
                    }
                }$pdo->commit();
            }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        }
        $referenced=array_fill_keys($pdo->query('SELECT id FROM eoffice_drive_versions')->fetchAll(PDO::FETCH_COLUMN),true);
        foreach(glob(app_drive_archive_directory('spool').'/*.source')?:[] as $path){$id=basename($path,'.source');if(filemtime($path)<time()-86400&&!isset($referenced[$id]))unlink($path);}
        $pendingRetry=(int)$pdo->query("SELECT COUNT(*) FROM eoffice_drive_versions WHERE status='pending' AND retry_at IS NOT NULL")->fetchColumn();
        $pendingReview=(int)$pdo->query("SELECT COUNT(*) FROM eoffice_drive_versions WHERE status='review'")->fetchColumn();
        $code=$pendingReview?'verification_review_required':($pendingRetry?'cloud_retry_pending':null);
        $pdo->prepare('UPDATE eoffice_drive_state SET error_code=? WHERE id=1')->execute([$code]);
        return ['enabled'=>true,'uploaded'=>$uploaded,'evicted'=>$evicted,'retry_pending'=>$pendingRetry,'review_required'=>$pendingReview,'cache_removed'=>app_drive_archive_cache_sweep()];
    }catch(AppDriveArchiveRetry $e){
        if($pdo->inTransaction())$pdo->rollBack();$pdo->exec("UPDATE eoffice_drive_state SET error_code='cloud_retry_pending' WHERE id=1");
        return ['enabled'=>true,'uploaded'=>$uploaded,'evicted'=>$evicted,'retry_pending'=>true,'error_code'=>'cloud_retry_pending'];
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();$pdo->exec("UPDATE eoffice_drive_state SET error_code='worker_failed' WHERE id=1");throw $e;}
    finally{$pdo->query("SELECT RELEASE_LOCK('eoffice:drive-archive')");}
}
function app_drive_archive_snapshot(PDO $pdo,bool $allowInitial=false): array {
    $scanned=(bool)$pdo->query('SELECT full_scan_at FROM eoffice_drive_state WHERE id=1')->fetchColumn();
    if(!$scanned&&!$allowInitial)throw new RuntimeException('Initial archive scan incomplete');
    $manifest=['version'=>1,'created_at'=>gmdate('c'),'versions'=>[],'documents'=>[],'pending_files'=>0,'complete_recovery_set'=>$scanned];
    $files=$pdo->query("SELECT d.Doc_Id,d.Doc_Year,u.Doc_Upload_Path FROM t_document d JOIN t_document_upload u ON u.Doc_File_Link=d.Doc_File_Link WHERE d.Is_Delete='active' ORDER BY d.Doc_Id,u.Doc_Upload_Id")->fetchAll();
    foreach($files as $file){
        foreach(['original','signed'] as $variant){
            $q=$pdo->prepare('SELECT v.* FROM eoffice_drive_files f JOIN eoffice_drive_versions v ON v.id=f.version_id WHERE f.doc_id=? AND f.file_name=? AND f.variant=?');$q->execute([$file['Doc_Id'],$file['Doc_Upload_Path'],$variant]);$version=$q->fetch();
            $expectedSigned=null;
            if($variant==='signed'){
                $q=$pdo->prepare('SELECT revision FROM eoffice_signed_files WHERE Doc_Id=? AND file_name=?');$q->execute([$file['Doc_Id'],$file['Doc_Upload_Path']]);$expectedSigned=$q->fetchColumn()?:null;
                if(!$version&&!$expectedSigned&&!is_file(app_drive_archive_local($file,$file['Doc_Upload_Path'],'signed')))continue;
            }
            if(!$version||$version['status']!=='verified'||($expectedSigned&&!hash_equals($expectedSigned,$version['revision']))){
                if(!$allowInitial)throw new RuntimeException('Snapshot references files not verified on Drive');
                $manifest['pending_files']++;$manifest['complete_recovery_set']=false;continue;
            }
            app_drive_archive_parts($version);
            if(app_drive_archive_id((int)$file['Doc_Id'],$file['Doc_Upload_Path'],$variant,$version['revision'])!==$version['id'])throw new RuntimeException('Snapshot version identity mismatch');
            $manifest['versions'][$version['id']]=$version;
            $manifest['documents'][]=['doc_id'=>(int)$file['Doc_Id'],'year'=>$file['Doc_Year'],'name'=>$file['Doc_Upload_Path'],'variant'=>$variant,'version'=>$version['id']];
        }
    }return $manifest;
}
function app_drive_archive_backup(?array $transport=null): array {
    if($transport!==null&&(!app_settings()['mock']||!str_ends_with(app_settings()['database'],'_test')))throw new RuntimeException('Test transports only');
    if(!app_drive_archive_enabled()||(!app_drive_archive_configured()&&$transport===null))return ['enabled'=>false];
    $pdo=app_pdo();if(!$pdo->query("SELECT GET_LOCK('eoffice:drive-daily',0)")->fetchColumn())return ['skipped'=>true];
    $heartbeat=static function()use($pdo):void{$pdo->query('SELECT 1')->fetchColumn();};
    $call=$transport['call']??static fn(array $payload)=>app_drive_archive_call($payload,$heartbeat);
    $put=$transport['put']??static fn(string $bytes)=>app_drive_archive_put($bytes,$heartbeat);$get=$transport['get']??static fn(string $id)=>app_drive_archive_get($id,$heartbeat);
    $date=date('Y-m-d');
    try{
        $q=$pdo->prepare('SELECT * FROM eoffice_drive_backups WHERE backup_date=?');$q->execute([$date]);$run=$q->fetch();
        if($run&&in_array($run['status'],['completed','database_only'],true))return ['already_completed'=>true,'date'=>$date,'complete_recovery_set'=>$run['status']==='completed'];
        $call(['action'=>'health']);
        $pdo->prepare("INSERT IGNORE INTO eoffice_drive_backups (backup_date) VALUES (?)")->execute([$date]);
        if(!$run||!$run['manifest']){
            $backup=app_database_backup(static fn(PDO $pdo)=>app_drive_archive_snapshot($pdo,true));if(!($backup['created']??false))return ['skipped'=>true];
            $manifest=$backup['snapshot'];unset($backup['snapshot']);$manifest['database']=$backup;$manifest['key_id']=substr(hash('sha256',app_drive_archive_key()),0,16);
            $pdo->prepare('UPDATE eoffice_drive_backups SET manifest=? WHERE backup_date=?')->execute([json_encode($manifest,JSON_THROW_ON_ERROR),$date]);
        }else $manifest=json_decode($run['manifest'],true,128,JSON_THROW_ON_ERROR);
        // Both envelopes are retained as per-run archives. Upload ciphertext
        // pieces by content hash; interrupted retry simply reuses known objects.
        $spool=app_drive_archive_directory('spool');$file=$spool.'/daily-'.$date.'.ebak';
        $manifestPlain=json_encode($manifest,JSON_THROW_ON_ERROR);$manifestKey=app_drive_archive_key($manifest['key_id']);
        if(is_file($file)){
            $checked=app_backup_verify($file,$manifestKey);
            if($checked['encoding']!=='eoffice-drive-manifest'||$checked['bytes']!==strlen($manifestPlain)||!hash_equals($checked['sha256'],hash('sha256',$manifestPlain)))throw new RuntimeException('Daily manifest does not match captured snapshot');
        }
        if(!is_file($file)){
            if(is_file($file.'.partial'))unlink($file.'.partial');
            $writer=new AppBackupWriter($file.'.partial',$manifestKey,'eoffice-drive-manifest');$writer->write($manifestPlain);$writer->finish();unset($writer);app_backup_publish($file.'.partial',$file);
        }
        unset($manifestPlain);
        if(!is_file($manifest['database']['path'])||!hash_equals($manifest['database']['archive_sha256'],hash_file('sha256',$manifest['database']['path'])))throw new RuntimeException('Daily database archive differs from captured snapshot');
        $databaseVerification=app_backup_verify($manifest['database']['path'],$manifestKey);
        if(!hash_equals($manifest['database']['stream_sha256'],$databaseVerification['sha256']))throw new RuntimeException('Daily database plaintext differs from captured snapshot');
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
        $complete=$manifest['complete_recovery_set']??true;
        $pdo->prepare('UPDATE eoffice_drive_backups SET status=?,objects=?,completed_at=NOW(),error_code=NULL WHERE backup_date=?')->execute([$complete?'completed':'database_only',json_encode($objects,JSON_THROW_ON_ERROR),$date]);
        return ['completed'=>$complete,'database_backed_up'=>true,'complete_recovery_set'=>$complete,'pending_files'=>$manifest['pending_files']??0,'date'=>$date,'descriptor'=>$index,'versions'=>count($manifest['versions'])];
    }catch(Throwable $e){$pdo->prepare("UPDATE eoffice_drive_backups SET error_code='backup_failed' WHERE backup_date=?")->execute([$date]);throw $e;}
    finally{$pdo->query("SELECT RELEASE_LOCK('eoffice:drive-daily')");}
}
