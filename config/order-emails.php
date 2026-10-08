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

// Called inside the document transaction. Eligibility is captured at creation,
// not inferred later from editable legacy dates or an ID scan.
function app_order_saved(int $docId,bool $created,string $type,array $settings): void {
    $pdo=app_pdo();
    if($created&&$type==='External'&&$settings['activated_at']!==null){
        $pdo->prepare("INSERT IGNORE INTO eoffice_order_jobs (doc_id,source) VALUES (?,'automatic')")->execute([$docId]);
    }
    $job=app_order_job($docId);
    if(!$job)return;
    if($type!=='External'){app_order_update((int)$job['id'],'cancelled','not_an_order');return;}
    if($job['status']==='cancelled')return;
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

function app_order_pdf_files(array $doc): array {
    $year=trim((string)$doc['Doc_Year']);
    if(!preg_match('/^\d{4}$/D',$year))throw new AppOrderAIException('invalid_document_year');
    $q=app_pdo()->prepare('SELECT Doc_Upload_Path,Doc_Upload_Detail FROM t_document_upload WHERE Doc_File_Link=? ORDER BY Doc_Upload_Id');$q->execute([$doc['Doc_File_Link']]);
    $files=[];
    foreach($q as $file){
        $name=$file['Doc_Upload_Path'];if(strtolower(pathinfo($name,PATHINFO_EXTENSION))!=='pdf')continue;
        if($name!==basename($name)||str_contains($name,'\\'))throw new AppOrderAIException('invalid_file');
        $path=app_drive_archive_resolve($doc,$name,false);
        if(!is_file($path)||filesize($path)>20*1024*1024||(new finfo(FILEINFO_MIME_TYPE))->file($path)!=='application/pdf')throw new AppOrderAIException('pdf_unavailable');
        $hash=hash_file('sha256',$path);if($hash===false)throw new AppOrderAIException('pdf_unavailable');
        $files[$name]=['name'=>$name,'caption'=>(string)($file['Doc_Upload_Detail']??''),'hash'=>$hash,'path'=>$path];
    }
    return $files;
}

function app_order_sync_files(array $job,array $files): bool {
    $pdo=app_pdo();$q=$pdo->prepare('SELECT * FROM eoffice_order_files WHERE job_id=?');$q->execute([$job['id']]);$old=[];
    foreach($q as $row)$old[$row['file_name']]=$row;
    $changed=count($old)!==count($files);
    foreach($files as $name=>$file)if(!isset($old[$name])||$old[$name]['file_hash']!==$file['hash'])$changed=true;
    if($changed){
        $q=$pdo->prepare("SELECT COUNT(*) FROM eoffice_order_recipients WHERE job_id=? AND status IN ('success','sending','uncertain')");$q->execute([$job['id']]);
        if($old&&$q->fetchColumn()){app_order_update((int)$job['id'],'review','files_changed');return false;}
        foreach($old as $name=>$row)if(!isset($files[$name]))$pdo->prepare('DELETE FROM eoffice_order_files WHERE id=?')->execute([$row['id']]);
        foreach($files as $name=>$file){
            if(!isset($old[$name]))$pdo->prepare('INSERT INTO eoffice_order_files (job_id,file_name,caption,file_hash) VALUES (?,?,?,?)')->execute([$job['id'],$name,$file['caption'],$file['hash']]);
            elseif($old[$name]['file_hash']!==$file['hash'])$pdo->prepare("UPDATE eoffice_order_files SET file_hash=?,caption=?,status='pending',targets=NULL,attempts=0,retry_at=NULL,error_code=NULL WHERE id=?")->execute([$file['hash'],$file['caption'],$old[$name]['id']]);
        }
        $pdo->prepare("DELETE FROM eoffice_order_recipients WHERE job_id=? AND source='ai' AND status IN ('pending','failed','skipped')")->execute([$job['id']]);
    }
    return true;
}

function app_order_add_recipient(array $job,array $user,string $source='ai'): void {
    $pdo=app_pdo();$email=strtolower(trim((string)$user['User_Email']));$valid=(bool)filter_var($email,FILTER_VALIDATE_EMAIL);
    $key=hash('sha256',$valid?$email:'invalid-user:'.$user['User_Id']);
    $q=$pdo->prepare('SELECT id FROM eoffice_order_recipients WHERE job_id=? AND email_key=?');$q->execute([$job['id'],$key]);if($q->fetchColumn())return;
    $q=$pdo->prepare('SELECT delivery_status FROM email_logs WHERE doc_id=? AND LOWER(recipient_email)=?');$q->execute([(string)$job['doc_id'],$email]);$history=$q->fetchAll(PDO::FETCH_COLUMN);
    $status=!$valid?'skipped':(in_array('success',$history,true)?'success':($history?'uncertain':'pending'));
    $pdo->prepare('INSERT IGNORE INTO eoffice_order_recipients (job_id,user_id,recipient_name,recipient_email,email_key,source,status,error_code) VALUES (?,?,?,?,?,?,?,?)')->execute([
        $job['id'],$user['User_Id'],$user['User_Name'],$email,$key,$source,$status,!$valid?'invalid_email':($status==='uncertain'?'legacy_delivery_unconfirmed':null)]);
}

function app_order_build_recipients(array $job): void {
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
    $q=app_pdo()->prepare('SELECT status,COUNT(*) n FROM eoffice_order_recipients WHERE job_id=? GROUP BY status');$q->execute([$job['id']]);$counts=[];foreach($q as $row)$counts[$row['status']]=(int)$row['n'];
    if(!$counts){app_order_update((int)$job['id'],'review','no_recipients');return;}
    if(count($counts)===1&&isset($counts['cancelled'])){app_order_update((int)$job['id'],'cancelled','operator_cancelled');return;}
    if(($counts['pending']??0)>0)app_order_update((int)$job['id'],'sending');
    elseif(($counts['uncertain']??0)+($counts['sending']??0)+($counts['failed']??0)+($counts['skipped']??0)>0)app_order_update((int)$job['id'],'partial','recipient_attention');
    else app_order_update((int)$job['id'],'success');
}

function app_order_process_job(array $job,float $deadline,?array $transports=null): void {
    $pdo=app_pdo();$doc=app_order_document((int)$job['doc_id']);
    if(!$doc){app_order_update((int)$job['id'],'cancelled','document_unavailable');return;}
    // A persisted SMTP sending marker survives a crash and is never resent.
    $pdo->prepare("UPDATE eoffice_order_recipients SET status='uncertain',error_code='smtp_result_unknown' WHERE job_id=? AND status='sending'")->execute([$job['id']]);
    $files=app_order_pdf_files($doc);
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
                if(hash_file('sha256',$files[$file['file_name']]['path'])!==$file['file_hash'])throw new AppOrderAIException('files_changed');
                $pdo->prepare("UPDATE eoffice_order_files SET status='success',targets=?,error_code=NULL,retry_at=NULL WHERE id=?")->execute([json_encode(array_values(array_unique($targets)),JSON_THROW_ON_ERROR),$file['id']]);
            }catch(AppOrderAIException $e){
                $retry=$e->retryable&&$attempt<5;$delay=max(min(3600,60*(2**min(5,$attempt-1))),$e->retryAfter);
                $pdo->prepare('UPDATE eoffice_order_files SET status=?,error_code=?,retry_at=? WHERE id=?')->execute([$retry?'pending':'failed',$e->reason,$retry?date('Y-m-d H:i:s',time()+$delay):null,$file['id']]);
                if(!$retry)app_order_update((int)$job['id'],'review',$e->reason);
                return;
            }
        }
        $q=$pdo->prepare("SELECT COUNT(*) FROM eoffice_order_files WHERE job_id=? AND status<>'success'");$q->execute([$job['id']]);if($q->fetchColumn())return;
        $pdo->beginTransaction();try{app_order_build_recipients($job);$pdo->commit();}catch(Throwable $e){$pdo->rollBack();throw $e;}
    }else{
        // Also recover a crash between saving the last AI result and creating
        // recipients. INSERT IGNORE preserves all previous delivery markers.
        $pdo->beginTransaction();try{app_order_build_recipients($job);$pdo->commit();}catch(Throwable $e){$pdo->rollBack();throw $e;}
    }
    app_order_finish($job);
    $q=$pdo->prepare("SELECT * FROM eoffice_order_recipients WHERE job_id=? AND status='pending' ORDER BY id LIMIT 50");$q->execute([$job['id']]);
    foreach($q->fetchAll() as $recipient){
        if(microtime(true)>=$deadline)return;
        if(!app_order_settings()['enabled'])return;
        if(!app_settings()['mock']&&(!app_env('SMTP_HOST')||!app_env('SMTP_USERNAME')||!app_env('SMTP_PASSWORD')))throw new AppOrderAIException('smtp_configuration_required');
        // Document writers use the same row lock. Hold it during this single
        // delivery so a replacement/deletion cannot invalidate the links.
        $pdo->beginTransaction();
        try{
            $check=$pdo->prepare('SELECT * FROM t_document WHERE Doc_Id=? FOR UPDATE');$check->execute([$doc['Doc_Id']]);$current=$check->fetch();
            if(!$current||$current['Doc_Type']!=='External'||$current['Is_Delete']!=='active'){$pdo->commit();app_order_update((int)$job['id'],'cancelled','document_unavailable');return;}
            $currentFiles=app_order_pdf_files($current);
            if(array_map(static fn($f)=>$f['hash'],$currentFiles)!==array_map(static fn($f)=>$f['hash'],$files)){$pdo->commit();app_order_update((int)$job['id'],'review','files_changed');return;}
            if($recipient['user_id']!==null){
                $check=$pdo->prepare('SELECT User_Email FROM t_user WHERE User_Id=? LOCK IN SHARE MODE');$check->execute([$recipient['user_id']]);$email=$check->fetchColumn();
                if($email===false||strtolower(trim($email))!==$recipient['recipient_email']){
                    $pdo->prepare("UPDATE eoffice_order_recipients SET status='skipped',error_code='recipient_changed' WHERE id=?")->execute([$recipient['id']]);$pdo->commit();continue;
                }
            }
            // Commit the marker BEFORE SMTP. Reacquire the document lock and
            // revalidate before contacting the transport below.
            $pdo->prepare("UPDATE eoffice_order_recipients SET status='sending',attempts=attempts+1,attempted_at=NOW() WHERE id=? AND status='pending'")->execute([$recipient['id']]);$pdo->commit();
            $pdo->beginTransaction();$check=$pdo->prepare('SELECT * FROM t_document WHERE Doc_Id=? FOR UPDATE');$check->execute([$doc['Doc_Id']]);$current=$check->fetch();
            if(!$current||$current['Doc_Type']!=='External'||$current['Is_Delete']!=='active'||array_map(static fn($f)=>$f['hash'],app_order_pdf_files($current))!==array_map(static fn($f)=>$f['hash'],$files)){
                $pdo->prepare("UPDATE eoffice_order_recipients SET status='pending' WHERE id=?")->execute([$recipient['id']]);$pdo->commit();app_order_update((int)$job['id'],'review','files_changed');return;
            }
            if($recipient['user_id']!==null){
                $check=$pdo->prepare('SELECT User_Email FROM t_user WHERE User_Id=? LOCK IN SHARE MODE');$check->execute([$recipient['user_id']]);$email=$check->fetchColumn();
                if($email===false||strtolower(trim($email))!==$recipient['recipient_email']){
                    $pdo->prepare("UPDATE eoffice_order_recipients SET status='skipped',error_code='recipient_changed' WHERE id=?")->execute([$recipient['id']]);$pdo->commit();continue;
                }
            }
            $status='success';$error=null;
            try{if(!(($transports['mail']??'app_mail')('คำสั่ง '.$current['Doc_Number'],$recipient['recipient_email'],app_order_body($current,$currentFiles))))throw new RuntimeException('SMTP not accepted');}
            catch(Throwable $e){$status='uncertain';$error='smtp_result_unknown';}
            $pdo->prepare('UPDATE eoffice_order_recipients SET status=?,error_code=?,sent_at=? WHERE id=?')->execute([$status,$error,$status==='success'?date('Y-m-d H:i:s'):null,$recipient['id']]);
            if($status==='success')foreach($files as $file){
                $check=$pdo->prepare("SELECT id FROM email_logs WHERE doc_id=? AND file_name=? AND LOWER(recipient_email)=? AND delivery_status='success' LIMIT 1");$check->execute([(string)$doc['Doc_Id'],$file['name'],$recipient['recipient_email']]);
                if(!$check->fetchColumn())$pdo->prepare("INSERT INTO email_logs (doc_id,file_name,recipient_name,recipient_email,delivery_status) VALUES (?,?,?,?,'success')")->execute([(string)$doc['Doc_Id'],$file['name'],$recipient['recipient_name'],$recipient['recipient_email']]);
            }
            $pdo->commit();
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
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
        $jobs=$pdo->query("SELECT * FROM eoffice_order_jobs WHERE status IN ('waiting_files','analyzing','sending','queued') ORDER BY updated_at,id LIMIT 50")->fetchAll();
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
            catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();app_order_update((int)$job['id'],'review',$e instanceof AppOrderAIException?$e->reason:'processing_failed');error_log('Order job '.$job['id'].' failed ('.get_class($e).')');}
            finally{$pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([$lock]);}
            $processed++;
            $pdo->prepare('UPDATE eoffice_order_jobs SET updated_at=NOW() WHERE id=?')->execute([$job['id']]);
        }
    }finally{$pdo->query("SELECT RELEASE_LOCK('eoffice:orders')");}
    return $processed;
}
