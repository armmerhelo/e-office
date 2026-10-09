<?php
require_once __DIR__.'/services.php';
require_once __DIR__.'/order-ai.php';
require_once __DIR__.'/drive-archive.php';

function app_order_audit(string $action,?int $actor=null,?int $doc=null): void {
    app_pdo()->prepare('INSERT INTO eoffice_order_audit (actor_id,doc_id,action) VALUES (?,?,?)')->execute([$actor,$doc,$action]);
}

function app_order_job(int $docId): ?array {
    $q=app_pdo()->prepare('SELECT * FROM eoffice_order_jobs WHERE doc_id=?');$q->execute([$docId]);return $q->fetch()?:null;
}

function app_order_update(int $jobId,string $status,?string $error=null): void {
    app_pdo()->prepare('UPDATE eoffice_order_jobs SET status=?,error_code=?,updated_at=NOW() WHERE id=?')->execute([$status,$error,$jobId]);
}

function app_order_clear_retry(int $jobId): void {
    app_pdo()->prepare('UPDATE eoffice_order_jobs SET retry_attempts=0,retry_at=NULL WHERE id=?')->execute([$jobId]);
}

function app_order_resume_pending(array $job): void {
    if(!in_array($job['status'],['success','partial'],true)&&!($job['status']==='review'&&in_array($job['error_code'],['no_recipients','no_pending_recipients'],true)))return;
    $q=app_pdo()->prepare("SELECT COUNT(*) FROM eoffice_order_recipients WHERE job_id=? AND status='pending'");$q->execute([$job['id']]);
    if($q->fetchColumn()){app_order_clear_retry((int)$job['id']);app_order_update((int)$job['id'],'queued');}
}

// Called inside the document transaction. Eligibility is captured at creation,
// not inferred later from editable legacy dates or an ID scan.
function app_order_saved(int $docId,bool $created,string $type,array $settings): void {
    $pdo=app_pdo();
    if($created&&$type==='External'&&$settings['activated_at']!==null){
        $pdo->prepare("INSERT IGNORE INTO eoffice_order_jobs (doc_id,source) VALUES (?,'automatic')")->execute([$docId]);
    }
    $job=app_order_job($docId);
    if(!$job)return;
    if($type!=='External'){app_order_cancel((int)$job['id'],'not_an_order');return;}
    if($job['status']==='cancelled')return;
    app_order_document_recipients($job);
    app_order_resume_pending($job);
    $q=$pdo->prepare("SELECT Doc_Upload_Path FROM t_document_upload u JOIN t_document d ON d.Doc_File_Link=u.Doc_File_Link WHERE d.Doc_Id=? ORDER BY u.Doc_Upload_Id");$q->execute([$docId]);
    $names=array_values(array_filter($q->fetchAll(PDO::FETCH_COLUMN),static fn($name)=>strtolower(pathinfo($name,PATHINFO_EXTENSION))==='pdf'));sort($names);
    $q=$pdo->prepare('SELECT file_name FROM eoffice_order_files WHERE job_id=? ORDER BY file_name');$q->execute([$job['id']]);$old=$q->fetchAll(PDO::FETCH_COLUMN);sort($old);
    if($names!==$old&&$old){
        $q=$pdo->prepare("SELECT COUNT(*) FROM eoffice_order_recipients WHERE job_id=? AND status IN ('success','sending','uncertain')");$q->execute([$job['id']]);
        app_order_update((int)$job['id'],$q->fetchColumn()?'review':($names?'analyzing':'waiting_files'),'files_changed');
    }elseif($job['status']==='waiting_files'&&$names)app_order_update((int)$job['id'],'analyzing');
}

function app_order_document(int $id): ?array {
    $q=app_pdo()->prepare("SELECT * FROM t_document WHERE Doc_Id=? AND Doc_Type='External' AND Is_Delete='active'");$q->execute([$id]);return $q->fetch()?:null;
}

// File preparation may download encrypted Drive parts only before locking the
// document. Locked revalidation uses ready local/spool/cache bytes exclusively.
function app_order_pdf_path(array $doc,string $name,?callable $archiveGet=null): string {
    if($archiveGet!==null&&(!app_settings()['mock']||!str_ends_with(app_settings()['database'],'_test')))throw new RuntimeException('Mock archive transport only');
    // Validate BEFORE shared helpers that emit HTTP failures/exit. A malformed
    // legacy row must fail only this job, never terminate the CLI batch.
    $doc['Doc_Year']=trim((string)($doc['Doc_Year']??''));
    if(!preg_match('/^\d{4}$/D',$doc['Doc_Year']))throw new AppOrderAIException('invalid_document_year');
    if($name!==basename($name)||str_contains($name,'\\'))throw new AppOrderAIException('invalid_file');
    $local=app_drive_archive_local($doc,$name,'original');
    clearstatcache(true,$local);if(is_file($local))return $local;
    $version=app_drive_archive_current((int)$doc['Doc_Id'],$name,'original');
    if(!$version)return $local;
    foreach(['spool'=>'.source','quarantine'=>'.source','cache'=>'.plain'] as $kind=>$suffix){
        $path=app_drive_archive_directory($kind).'/'.$version['id'].$suffix;clearstatcache(true,$path);
        if(is_file($path)&&filesize($path)===(int)$version['bytes']&&hash_equals($version['revision'],(string)@hash_file('sha256',$path)))return $path;
    }
    if(app_pdo()->inTransaction())throw new AppOrderAIException('pdf_cache_not_ready',true);
    return app_drive_archive_restore($version,$archiveGet);
}

function app_order_pdf_files(array $doc,?callable $archiveGet=null): array {
    $year=trim((string)$doc['Doc_Year']);
    if(!preg_match('/^\d{4}$/D',$year))throw new AppOrderAIException('invalid_document_year');
    $doc['Doc_Year']=$year;
    $q=app_pdo()->prepare('SELECT Doc_Upload_Path,Doc_Upload_Detail FROM t_document_upload WHERE Doc_File_Link=? ORDER BY Doc_Upload_Id');$q->execute([$doc['Doc_File_Link']]);
    $files=[];
    foreach($q as $file){
        $name=$file['Doc_Upload_Path'];if(strtolower(pathinfo($name,PATHINFO_EXTENSION))!=='pdf')continue;
        if($name!==basename($name)||str_contains($name,'\\'))throw new AppOrderAIException('invalid_file');
        $path=app_order_pdf_path($doc,$name,$archiveGet);
        clearstatcache(true,$path);$size=@filesize($path);$mime=@(new finfo(FILEINFO_MIME_TYPE))->file($path);$hash=@hash_file('sha256',$path);
        if($size===false||$mime===false||$hash===false){
            if(str_ends_with($path,'.plain'))throw new AppOrderAIException('pdf_cache_not_ready',true);
            throw new AppOrderAIException('pdf_unavailable');
        }
        if($size>20*1024*1024||$mime!=='application/pdf')throw new AppOrderAIException('pdf_unavailable');
        $files[$name]=['name'=>$name,'caption'=>(string)($file['Doc_Upload_Detail']??''),'hash'=>$hash,'path'=>$path];
    }
    return $files;
}

function app_order_sync_files(array $job,array $files): bool {
    $pdo=app_pdo();$owned=!$pdo->inTransaction();if($owned)$pdo->beginTransaction();
    try{
    $q=$pdo->prepare('SELECT * FROM eoffice_order_files WHERE job_id=?');$q->execute([$job['id']]);$old=[];
    foreach($q as $row)$old[$row['file_name']]=$row;
    $changed=count($old)!==count($files);
    foreach($files as $name=>$file)if(!isset($old[$name])||$old[$name]['file_hash']!==$file['hash'])$changed=true;
    if($changed){
        $q=$pdo->prepare("SELECT COUNT(*) FROM eoffice_order_recipients WHERE job_id=? AND status IN ('success','sending','uncertain')");$q->execute([$job['id']]);
        if($old&&$q->fetchColumn()){app_order_update((int)$job['id'],'review','files_changed');if($owned)$pdo->commit();return false;}
        foreach($old as $name=>$row)if(!isset($files[$name]))$pdo->prepare('DELETE FROM eoffice_order_files WHERE id=?')->execute([$row['id']]);
        foreach($files as $name=>$file){
            if(!isset($old[$name]))$pdo->prepare('INSERT INTO eoffice_order_files (job_id,file_name,caption,file_hash) VALUES (?,?,?,?)')->execute([$job['id'],$name,$file['caption'],$file['hash']]);
            elseif($old[$name]['file_hash']!==$file['hash'])$pdo->prepare("UPDATE eoffice_order_files SET file_hash=?,caption=?,status='pending',targets=NULL,attempts=0,retry_at=NULL,error_code=NULL WHERE id=?")->execute([$file['hash'],$file['caption'],$old[$name]['id']]);
        }
        $pdo->prepare("DELETE FROM eoffice_order_recipients WHERE job_id=? AND source='ai' AND status IN ('pending','failed','skipped')")->execute([$job['id']]);
    }
    if($owned)$pdo->commit();return true;
    }catch(Throwable $e){if($owned&&$pdo->inTransaction())$pdo->rollBack();throw $e;}
}

function app_order_add_recipient(array $job,array $user,string $source='ai'): void {
    $pdo=app_pdo();$email=strtolower(trim((string)$user['User_Email']));$valid=(bool)filter_var($email,FILTER_VALIDATE_EMAIL);
    $key=hash('sha256',$valid?$email:'invalid-user:'.$user['User_Id']);
    $q=$pdo->prepare('SELECT id,source FROM eoffice_order_recipients WHERE job_id=? AND email_key=?');$q->execute([$job['id'],$key]);$existing=$q->fetch();
    if($existing){
        // Selecting an AI match explicitly must survive future reanalysis.
        // Never change its delivery/cancellation state as a side effect.
        if($source==='manual'||($source==='document'&&$existing['source']==='ai'))$pdo->prepare('UPDATE eoffice_order_recipients SET source=? WHERE id=?')->execute([$source,$existing['id']]);
        return;
    }
    $q=$pdo->prepare('SELECT delivery_status FROM email_logs WHERE doc_id=? AND LOWER(recipient_email)=?');$q->execute([(string)$job['doc_id'],$email]);$history=$q->fetchAll(PDO::FETCH_COLUMN);
    $status=!$valid?'skipped':(in_array('success',$history,true)?'success':($history?'uncertain':'pending'));
    $pdo->prepare('INSERT IGNORE INTO eoffice_order_recipients (job_id,user_id,recipient_name,recipient_email,email_key,source,status,error_code) VALUES (?,?,?,?,?,?,?,?)')->execute([
        $job['id'],$user['User_Id'],$user['User_Name'],$email,$key,$source,$status,!$valid?'invalid_email':($status==='uncertain'?'legacy_delivery_unconfirmed':null)]);
}

function app_order_document_recipients(array $job): void {
    $pdo=app_pdo();
    $pdo->prepare("DELETE r FROM eoffice_order_recipients r WHERE r.job_id=? AND r.source='document' AND r.status IN ('pending','failed','skipped') AND NOT EXISTS (SELECT 1 FROM t_access_rights a WHERE a.Doc_Id=? AND a.User_Id=r.user_id)")->execute([$job['id'],$job['doc_id']]);
    $q=$pdo->prepare('SELECT u.User_Id,u.User_Name,u.User_Email FROM t_access_rights a JOIN t_user u ON u.User_Id=a.User_Id WHERE a.Doc_Id=?');$q->execute([$job['doc_id']]);
    foreach($q->fetchAll() as $user)app_order_add_recipient($job,$user,'document');
}

function app_order_cancel(int $jobId,string $reason='operator_cancelled'): void {
    $pdo=app_pdo();
    $pdo->prepare("UPDATE eoffice_order_recipients SET status='cancelled',error_code='operator_cancelled' WHERE job_id=? AND status='pending'")->execute([$jobId]);
    app_order_update($jobId,'cancelled',$reason);
}

// Prepare cold Drive caches outside the transaction, then revalidate bindings
// and exact bytes under the writer's document lock. Retry concurrent changes
// with a fresh unlocked preparation; never restore a cache while holding locks.
function app_order_snapshot(array $job,?callable $archiveGet=null): ?array {
    $pdo=app_pdo();if($pdo->inTransaction())throw new RuntimeException('Snapshot preparation requires no transaction');
    $retryReason='files_changed';
    for($attempt=0;$attempt<3;$attempt++){
        $before=app_order_document((int)$job['doc_id']);if(!$before)return null;
        try{$prepared=app_order_pdf_files($before,$archiveGet);}
        catch(AppOrderAIException $e){
            // A source missing from both local storage and Drive is a permanent
            // per-document problem. Do not disguise it as a changing revision:
            // that path requeues analysis every cron cycle and starves the batch.
            if($e->reason==='pdf_unavailable')throw $e;
            if($e->reason==='pdf_cache_not_ready'){$retryReason=$e->reason;if($attempt<2)continue;throw $e;}
            throw $e;
        }
        $pdo->beginTransaction();
        try{
            $q=$pdo->prepare('SELECT * FROM t_document WHERE Doc_Id=? FOR UPDATE');$q->execute([$job['doc_id']]);$doc=$q->fetch();
            if(!$doc||$doc['Doc_Type']!=='External'||$doc['Is_Delete']!=='active'){$pdo->commit();return null;}
            $files=app_order_pdf_files($doc);$pdo->commit();
            if(app_order_file_signature($files)===app_order_file_signature($prepared))return ['doc'=>$doc,'files'=>$files];
        }catch(Throwable $e){
            if($pdo->inTransaction())$pdo->rollBack();
            if(!($e instanceof AppOrderAIException)||!in_array($e->reason,['pdf_cache_not_ready','pdf_unavailable'],true))throw $e;
            if($e->reason==='pdf_unavailable')throw $e;
            $retryReason=$e->reason;
        }
    }
    throw new AppOrderAIException($retryReason,true);
}

function app_order_file_signature(array $files): array {
    $signature=array_map(static fn($file)=>$file['hash'],$files);ksort($signature);return $signature;
}

function app_order_retry_snapshot(array $job): void {
    $pdo=app_pdo();$pdo->beginTransaction();
    try{
        $q=$pdo->prepare('SELECT Doc_Type,Is_Delete FROM t_document WHERE Doc_Id=? FOR UPDATE');$q->execute([$job['doc_id']]);$doc=$q->fetch();
        $current=app_order_job((int)$job['doc_id']);
        if(!$current||$current['status']==='cancelled'){$pdo->commit();return;}
        if(!$doc||$doc['Doc_Type']!=='External'||$doc['Is_Delete']!=='active')app_order_cancel((int)$job['id'],'document_unavailable');
        else{
            $q=$pdo->prepare("SELECT COUNT(*) FROM eoffice_order_recipients WHERE job_id=? AND status IN ('success','sending','uncertain')");$q->execute([$job['id']]);
            if($q->fetchColumn())app_order_update((int)$job['id'],'review','files_changed');
            else{
                $pdo->prepare("DELETE FROM eoffice_order_recipients WHERE job_id=? AND source='ai' AND status IN ('pending','failed','skipped')")->execute([$job['id']]);
                app_order_update((int)$job['id'],'analyzing','files_changed');
            }
        }
        $pdo->commit();
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
}

// Cache eviction and transient cloud errors do not mean the document revision
// changed. Preserve ALL recipient markers and cached AI results; next run must
// prepare/revalidate the same snapshot before sending only pending recipients.
function app_order_retry_io(array $job,string $reason): void {
    $pdo=app_pdo();$pdo->beginTransaction();
    try{
        $q=$pdo->prepare('SELECT Doc_Type,Is_Delete FROM t_document WHERE Doc_Id=? FOR UPDATE');$q->execute([$job['doc_id']]);$doc=$q->fetch();
        $q=$pdo->prepare('SELECT * FROM eoffice_order_jobs WHERE id=? FOR UPDATE');$q->execute([$job['id']]);$current=$q->fetch();
        if(!$current||$current['status']==='cancelled'){$pdo->commit();return;}
        if(!$doc||$doc['Doc_Type']!=='External'||$doc['Is_Delete']!=='active')app_order_cancel((int)$job['id'],'document_unavailable');
        else{
            $attempt=(int)$current['retry_attempts']+1;
            if($attempt>=5){
                $pdo->prepare('UPDATE eoffice_order_jobs SET retry_attempts=?,retry_at=NULL WHERE id=?')->execute([$attempt,$job['id']]);
                app_order_update((int)$job['id'],'review',$reason==='drive_temporary_failure'?'drive_retry_exhausted':'cache_retry_exhausted');
            }else{
                $delay=min(1800,60*(2**($attempt-1)));
                $pdo->prepare("UPDATE eoffice_order_jobs SET status='queued',error_code=?,retry_attempts=?,retry_at=DATE_ADD(NOW(),INTERVAL ? SECOND),updated_at=NOW() WHERE id=?")->execute([$reason,$attempt,$delay,$job['id']]);
            }
        }
        $pdo->commit();
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
}

function app_order_missing_snapshot(array $job,array $files): void {
    $doc=app_order_document((int)$job['doc_id']);
    if(!$doc){app_order_retry_snapshot($job);return;}
    $q=app_pdo()->prepare('SELECT Doc_Upload_Path FROM t_document_upload WHERE Doc_File_Link=?');$q->execute([$doc['Doc_File_Link']]);
    $names=array_values(array_unique(array_filter($q->fetchAll(PDO::FETCH_COLUMN),static fn($name)=>strtolower(pathinfo($name,PATHINFO_EXTENSION))==='pdf')));sort($names);
    $expected=array_keys($files);sort($expected);
    if($names!==$expected)app_order_retry_snapshot($job);
    else app_order_retry_io($job,'pdf_cache_not_ready');
}

function app_order_build_recipients(array $job): void {
    app_order_document_recipients($job);
    $pdo=app_pdo();$q=$pdo->prepare("SELECT targets FROM eoffice_order_files WHERE job_id=? AND status='success'");$q->execute([$job['id']]);$targets=[];
    foreach($q as $row)$targets=array_merge($targets,json_decode($row['targets'],true)??[]);
    $targets=array_values(array_unique($targets));
    $q=$pdo->prepare('SELECT User_Id,User_Name,User_Email FROM t_user WHERE User_Id=?');
    foreach($targets as $id){$q->execute([$id]);$user=$q->fetch();if($user)app_order_add_recipient($job,$user);}
    // Keep legacy recipients when importing an old order; ambiguous attempts
    // require a deliberate operator decision instead of an automatic retry.
    if($job['source']==='manual'){
        $q=$pdo->prepare("SELECT recipient_name,recipient_email,delivery_status FROM email_logs WHERE doc_id=? ORDER BY (delivery_status='success') DESC,id");$q->execute([(string)$job['doc_id']]);
        foreach($q->fetchAll() as $log){
            $email=strtolower(trim($log['recipient_email']));if(!filter_var($email,FILTER_VALIDATE_EMAIL))continue;
            $status=$log['delivery_status']==='success'?'success':'uncertain';
            $pdo->prepare("INSERT IGNORE INTO eoffice_order_recipients (job_id,recipient_name,recipient_email,email_key,source,status,error_code) VALUES (?,?,?,?,'legacy',?,?)")->execute([$job['id'],$log['recipient_name'],$email,hash('sha256',$email),$status,$status==='uncertain'?'legacy_delivery_unconfirmed':null]);
        }
    }
}

function app_order_body(array $doc,array $files): string {
    $html='<p>'.htmlspecialchars($doc['Doc_Name'],ENT_QUOTES,'UTF-8').'</p><ul>';
    foreach($files as $file){$url=app_settings()['base_url'].'/api/view_file.php?'.http_build_query(['Doc_Id'=>$doc['Doc_Id'],'File_Path'=>$file['name'],'Year'=>trim((string)$doc['Doc_Year'])]);
        $html.='<li><a href="'.htmlspecialchars($url,ENT_QUOTES,'UTF-8').'">'.htmlspecialchars($file['caption']?:$file['name'],ENT_QUOTES,'UTF-8').'</a></li>';}
    return $html.'</ul>';
}

function app_order_finish(array $job): void {
    if(app_order_job((int)$job['doc_id'])['status']==='cancelled')return;
    $q=app_pdo()->prepare('SELECT status,COUNT(*) n FROM eoffice_order_recipients WHERE job_id=? GROUP BY status');$q->execute([$job['id']]);$counts=[];foreach($q as $row)$counts[$row['status']]=(int)$row['n'];
    // A resumed pending job must retain its I/O failure budget until it really
    // finishes. Clearing here would make repeated cache eviction retry forever.
    if(($counts['pending']??0)>0){app_order_update((int)$job['id'],'sending');return;}
    app_order_clear_retry((int)$job['id']);
    if(!$counts){app_order_update((int)$job['id'],'review','no_recipients');return;}
    if(count($counts)===1&&isset($counts['cancelled'])){app_order_update((int)$job['id'],'review','no_pending_recipients');return;}
    if(($counts['uncertain']??0)+($counts['sending']??0)+($counts['failed']??0)+($counts['skipped']??0)>0)app_order_update((int)$job['id'],'partial','recipient_attention');
    else app_order_update((int)$job['id'],'success');
}

// Caller holds the document row lock. Read the current queue source/state and
// re-check explicit document membership in BOTH phases, including the gap after
// committing the sending marker. AI/manual recipients keep their own policy.
function app_order_recipient_ready(array $doc,int $recipientId,string $expected): ?array {
    $pdo=app_pdo();if(!$pdo->inTransaction())throw new RuntimeException('Recipient check requires document transaction');
    $q=$pdo->prepare('SELECT * FROM eoffice_order_recipients WHERE id=?');$q->execute([$recipientId]);$recipient=$q->fetch();
    if(!$recipient||$recipient['status']!==$expected)return null;
    if($recipient['user_id']!==null){
        $q=$pdo->prepare('SELECT User_Email FROM t_user WHERE User_Id=? LOCK IN SHARE MODE');$q->execute([$recipient['user_id']]);$email=$q->fetchColumn();
        if($email===false||strtolower(trim($email))!==$recipient['recipient_email']){
            $pdo->prepare("UPDATE eoffice_order_recipients SET status='skipped',error_code='recipient_changed' WHERE id=?")->execute([$recipientId]);return null;
        }
    }
    if($recipient['source']==='document'){
        $q=$pdo->prepare('SELECT 1 FROM t_access_rights WHERE Doc_Id=? AND User_Id=? LIMIT 1 LOCK IN SHARE MODE');$q->execute([$doc['Doc_Id'],$recipient['user_id']]);
        if(!$q->fetchColumn()){
            $pdo->prepare("UPDATE eoffice_order_recipients SET status='cancelled',error_code='recipient_revoked' WHERE id=?")->execute([$recipientId]);return null;
        }
    }
    return $recipient;
}

function app_order_process_job(array $job,float $deadline,?array $transports=null): void {
    $pdo=app_pdo();
    // Recover an ambiguous previous SMTP attempt even if cloud preparation is
    // currently unavailable. It must never become automatically retryable.
    $pdo->prepare("UPDATE eoffice_order_recipients SET status='uncertain',error_code='smtp_result_unknown' WHERE job_id=? AND status='sending'")->execute([$job['id']]);
    $snapshot=app_order_snapshot($job,$transports['archive_get']??null);
    if(!$snapshot){app_order_cancel((int)$job['id'],'document_unavailable');return;}
    $doc=$snapshot['doc'];$files=$snapshot['files'];
    if(!$files){app_order_update((int)$job['id'],'waiting_files');return;}
    if(!app_order_sync_files($job,$files))return;
    $q=$pdo->prepare("SELECT * FROM eoffice_order_files WHERE job_id=? AND status<>'success' ORDER BY id");$q->execute([$job['id']]);$pending=$q->fetchAll();
    if($pending){
        app_order_update((int)$job['id'],'analyzing');$config=app_order_ai_config();
        if($job['model']!==null)$config['model']=$job['model'];
        $pdo->prepare('UPDATE eoffice_order_jobs SET model=? WHERE id=?')->execute([$config['model'],$job['id']]);
        foreach($pending as $file){
            if(microtime(true)>=$deadline)return;
            if(!app_order_settings()['enabled'])return;
            if($file['status']==='failed'){app_order_update((int)$job['id'],'review',$file['error_code']);return;}
            if($file['retry_at']!==null&&strtotime($file['retry_at'])>time())continue;
            $attempt=(int)$file['attempts']+1;
            $pdo->prepare("UPDATE eoffice_order_files SET status='analyzing',attempts=? WHERE id=?")->execute([$attempt,$file['id']]);
            try{
                $targets=($transports['ai']??'app_order_analyze')($files[$file['file_name']]['path'],$config,(int)$doc['Doc_Id']);
                if(!is_array($targets)||!array_is_list($targets)||count($targets)>500)throw new AppOrderAIException('invalid_ai_response',true);
                foreach($targets as $target)if(!is_int($target)||$target<=0)throw new AppOrderAIException('invalid_ai_response',true);
                // Re-check snapshot after a remote request; changed bytes must
                // never be paired with recipients from the previous version.
                $hash=@hash_file('sha256',$files[$file['file_name']]['path']);
                if($hash===false){app_order_missing_snapshot($job,$files);return;}
                if($hash!==$file['file_hash'])throw new AppOrderAIException('files_changed');
                $pdo->prepare("UPDATE eoffice_order_files SET status='success',targets=?,error_code=NULL,retry_at=NULL WHERE id=?")->execute([json_encode(array_values(array_unique($targets)),JSON_THROW_ON_ERROR),$file['id']]);
            }catch(AppOrderAIException $e){
                if($e->reason==='pdf_unavailable'&&!is_file($files[$file['file_name']]['path'])){app_order_missing_snapshot($job,$files);return;}
                if($e->reason==='files_changed'){app_order_retry_snapshot($job);return;}
                $retry=$e->retryable&&$attempt<5;$delay=max(min(3600,60*(2**min(5,$attempt-1))),$e->retryAfter);
                $pdo->prepare('UPDATE eoffice_order_files SET status=?,error_code=?,retry_at=? WHERE id=?')->execute([$retry?'pending':'failed',$e->reason,$retry?date('Y-m-d H:i:s',time()+$delay):null,$file['id']]);
                if(!$retry)app_order_update((int)$job['id'],'review',$e->reason);
                return;
            }
        }
        $q=$pdo->prepare("SELECT COUNT(*) FROM eoffice_order_files WHERE job_id=? AND status<>'success'");$q->execute([$job['id']]);if($q->fetchColumn())return;
    }
    // Detect additions/removals even if every analyzed file itself is unchanged.
    $latest=app_order_snapshot($job,$transports['archive_get']??null);
    if(!$latest){app_order_cancel((int)$job['id'],'document_unavailable');return;}
    if(app_order_job((int)$job['doc_id'])['status']==='cancelled')return;
    if(app_order_file_signature($latest['files'])!==app_order_file_signature($files)){app_order_retry_snapshot($job);return;}
    // Also recover a crash after saving the final AI result. Never overwrite
    // accepted/uncertain/cancelled recipients when rebuilding the current list.
    $pdo->beginTransaction();try{app_order_build_recipients($job);$pdo->commit();}catch(Throwable $e){$pdo->rollBack();throw $e;}
    app_order_finish($job);
    $q=$pdo->prepare("SELECT * FROM eoffice_order_recipients WHERE job_id=? AND status='pending' ORDER BY id LIMIT 50");$q->execute([$job['id']]);
    foreach($q->fetchAll() as $recipient){
        if(microtime(true)>=$deadline)return;
        if(!app_order_settings()['enabled'])return;
        if(!app_settings()['mock']&&(!app_env('SMTP_HOST')||!app_env('SMTP_USERNAME')||!app_env('SMTP_PASSWORD')))throw new AppOrderAIException('smtp_configuration_required');
        // Document writers use the same row lock. Hold it during this single
        // delivery so a replacement/deletion cannot invalidate the links.
        $marked=false;$contacted=false;
        $pdo->beginTransaction();
        try{
            $check=$pdo->prepare('SELECT * FROM t_document WHERE Doc_Id=? FOR UPDATE');$check->execute([$doc['Doc_Id']]);$current=$check->fetch();
            if(!$current||$current['Doc_Type']!=='External'||$current['Is_Delete']!=='active'){$pdo->commit();app_order_cancel((int)$job['id'],'document_unavailable');return;}
            $currentFiles=app_order_pdf_files($current);
            if(app_order_file_signature($currentFiles)!==app_order_file_signature($files)){$pdo->commit();app_order_retry_snapshot($job);return;}
            $ready=app_order_recipient_ready($current,(int)$recipient['id'],'pending');
            if(!$ready){$pdo->commit();continue;}
            $recipient=$ready;
            // Commit the marker BEFORE SMTP. Reacquire the document lock and
            // revalidate before contacting the transport below.
            $mark=$pdo->prepare("UPDATE eoffice_order_recipients SET status='sending',attempts=attempts+1,attempted_at=NOW() WHERE id=? AND status='pending'");$mark->execute([$recipient['id']]);
            if($mark->rowCount()!==1){$pdo->commit();continue;}
            $pdo->commit();$marked=true;
            $pdo->beginTransaction();$check=$pdo->prepare('SELECT * FROM t_document WHERE Doc_Id=? FOR UPDATE');$check->execute([$doc['Doc_Id']]);$current=$check->fetch();
            if(!$current||$current['Doc_Type']!=='External'||$current['Is_Delete']!=='active'||app_order_file_signature(app_order_pdf_files($current))!==app_order_file_signature($files)){
                $pdo->prepare("UPDATE eoffice_order_recipients SET status='pending' WHERE id=?")->execute([$recipient['id']]);$pdo->commit();app_order_retry_snapshot($job);return;
            }
            $ready=app_order_recipient_ready($current,(int)$recipient['id'],'sending');
            if(!$ready){$pdo->commit();continue;}
            $recipient=$ready;
            $status='success';$error=null;
            $contacted=true;
            try{if(!(($transports['mail']??'app_mail')('คำสั่ง '.$current['Doc_Number'],$recipient['recipient_email'],app_order_body($current,$currentFiles))))throw new RuntimeException('SMTP not accepted');}
            catch(Throwable $e){$status='uncertain';$error='smtp_result_unknown';}
            $pdo->prepare('UPDATE eoffice_order_recipients SET status=?,error_code=?,sent_at=? WHERE id=?')->execute([$status,$error,$status==='success'?date('Y-m-d H:i:s'):null,$recipient['id']]);
            if($status==='success')foreach($files as $file){
                $check=$pdo->prepare("SELECT id FROM email_logs WHERE doc_id=? AND file_name=? AND LOWER(recipient_email)=? AND delivery_status='success' LIMIT 1");$check->execute([(string)$doc['Doc_Id'],$file['name'],$recipient['recipient_email']]);
                if(!$check->fetchColumn())$pdo->prepare("INSERT INTO email_logs (doc_id,file_name,recipient_name,recipient_email,delivery_status) VALUES (?,?,?,?,'success')")->execute([(string)$doc['Doc_Id'],$file['name'],$recipient['recipient_name'],$recipient['recipient_email']]);
            }
            $pdo->commit();
        }catch(Throwable $e){
            if($pdo->inTransaction())$pdo->rollBack();
            // A failed cache revalidation happens before SMTP, so it is safe to
            // retain pending work instead of misclassifying it as uncertain.
            if(!$contacted&&$e instanceof AppOrderAIException&&$e->reason==='pdf_cache_not_ready'){
                if($marked)$pdo->prepare("UPDATE eoffice_order_recipients SET status='pending' WHERE id=? AND status='sending'")->execute([$recipient['id']]);
                app_order_retry_io($job,'pdf_cache_not_ready');return;
            }
            throw $e;
        }
    }
    app_order_finish($job);
}

function app_order_worker(int $seconds=90,?array $transports=null): int {
    if($transports!==null&&(!app_settings()['mock']||!str_ends_with(app_settings()['database'],'_test')))throw new RuntimeException('Mock test transports only');
    $pdo=app_pdo();if($pdo->inTransaction())throw new RuntimeException('Worker cannot run in a transaction');
    if(!$pdo->query("SELECT GET_LOCK('eoffice:orders',0)")->fetchColumn())return 0;
    $processed=0;$deadline=microtime(true)+max(1,min(240,$seconds));
    try{
        $pdo->exec('UPDATE eoffice_order_settings SET worker_at=NOW() WHERE id=1');
        if(!app_order_settings()['enabled'])return 0;
        $jobs=$pdo->query("SELECT * FROM eoffice_order_jobs WHERE status IN ('waiting_files','analyzing','sending','queued') AND (retry_at IS NULL OR retry_at<=NOW()) ORDER BY updated_at,id LIMIT 50")->fetchAll();
        foreach($jobs as $job){
            if(microtime(true)>=$deadline||!app_order_settings()['enabled'])break;
            $lock='email:'.$job['doc_id'];$q=$pdo->prepare('SELECT GET_LOCK(?,0)');$q->execute([$lock]);if(!$q->fetchColumn())continue;
            try{
                // A staff action may have cancelled/reanalyzed a job after the
                // batch SELECT but before its advisory lock became available.
                $currentJob=app_order_job((int)$job['doc_id']);
                if(!$currentJob||!in_array($currentJob['status'],['waiting_files','analyzing','sending','queued'],true))continue;
                $job=$currentJob;app_order_process_job($job,$deadline,$transports);
            }
            catch(Throwable $e){
                if($pdo->inTransaction())$pdo->rollBack();
                if($e instanceof AppDriveArchiveRetry)app_order_retry_io($job,'drive_temporary_failure');
                elseif($e instanceof AppOrderAIException&&$e->reason==='pdf_cache_not_ready')app_order_retry_io($job,'pdf_cache_not_ready');
                elseif($e instanceof AppOrderAIException&&$e->reason==='files_changed')app_order_retry_snapshot($job);
                else app_order_update((int)$job['id'],'review',$e instanceof AppOrderAIException?$e->reason:'processing_failed');
                error_log('Order job '.$job['id'].' failed ('.get_class($e).')');
            }
            finally{$pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([$lock]);}
            $processed++;
            $pdo->prepare('UPDATE eoffice_order_jobs SET updated_at=NOW() WHERE id=?')->execute([$job['id']]);
        }
    }finally{$pdo->query("SELECT RELEASE_LOCK('eoffice:orders')");}
    return $processed;
}
