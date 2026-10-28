<?php
require_once __DIR__.'/../config/order-emails.php';
app_method('GET','POST');$actor=app_permission('email');$pdo=app_pdo();
if($_SERVER['REQUEST_METHOD']==='GET'){
    $docId=(int)($_GET['doc_id']??0);
    if($docId){
        $doc=app_order_document($docId);if(!$doc)app_fail('ไม่พบคำสั่ง',404);
        $job=app_order_job($docId);$files=[];$recipients=[];$reviewToken=null;
        if($job){
            $beforeToken=app_order_approval_hash((int)$job['id']);
            $q=$pdo->prepare('SELECT id,file_name,caption,status,attempts,retry_at,error_code FROM eoffice_order_files WHERE job_id=? ORDER BY id');$q->execute([$job['id']]);$files=$q->fetchAll();
            $q=$pdo->prepare('SELECT id,user_id,recipient_name,recipient_email,source,status,attempts,error_code,attempted_at,sent_at FROM eoffice_order_recipients WHERE job_id=? ORDER BY id');$q->execute([$job['id']]);$recipients=$q->fetchAll();
            $afterToken=app_order_approval_hash((int)$job['id']);if(hash_equals($beforeToken,$afterToken))$reviewToken=$afterToken;
        }
        // Historical logs are read-only: viewing an old order never creates a job.
        $q=$pdo->prepare("SELECT MAX(recipient_name) recipient_name,LOWER(TRIM(COALESCE(recipient_email,''))) recipient_email,
            COUNT(*) log_count,MAX(delivery_status='success') sent,
            MAX(CASE WHEN delivery_status='success' THEN created_at END) sent_at,MAX(created_at) attempted_at
            FROM email_logs WHERE doc_id=? GROUP BY LOWER(TRIM(COALESCE(recipient_email,''))) ORDER BY recipient_email");
        $q->execute([(string)$docId]);$history=$q->fetchAll();
        app_json(['status'=>'success','job'=>$job,'files'=>$files,'recipients'=>$recipients,'history'=>$history,'review_token'=>$reviewToken]);
    }
    $page=max(1,(int)($_GET['page']??1));$limit=20;$offset=($page-1)*$limit;
    $where="d.Doc_Type='External' AND d.Is_Delete='active'";$params=[];
    $year=app_text($_GET,'year',10);$search=app_text($_GET,'search',200);$status=app_text($_GET,'state',30);
    if($year!==''&&$year!=='all'){$where.=' AND TRIM(d.Doc_Year)=?';$params[]=$year;}
    if($search!==''){$where.=' AND (d.Doc_Name LIKE ? OR d.Doc_Number LIKE ?)';$params[]='%'.$search.'%';$params[]='%'.$search.'%';}
    // Explicit collation also supports legacy log tables with a different default.
    $historyDoc='l.doc_id=CAST(d.Doc_Id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci';
    $historyExists="EXISTS (SELECT 1 FROM email_logs l WHERE $historyDoc)";
    $historySent="EXISTS (SELECT 1 FROM email_logs l WHERE $historyDoc AND l.delivery_status='success')";
    if($status==='not_queued')$where.=" AND j.id IS NULL AND NOT $historyExists";
    elseif($status==='legacy_sent')$where.=" AND j.id IS NULL AND $historySent";
    elseif($status==='legacy_review')$where.=" AND j.id IS NULL AND $historyExists AND NOT $historySent";
    elseif($status!==''){$where.=' AND j.status=?';$params[]=$status;}
    $from="FROM t_document d LEFT JOIN eoffice_order_jobs j ON j.doc_id=d.Doc_Id WHERE $where";
    $q=$pdo->prepare("SELECT COUNT(*) $from");$q->execute($params);$total=(int)$q->fetchColumn();
    $q=$pdo->prepare("SELECT d.Doc_Id doc_id,d.Doc_Number doc_number,d.Doc_Name doc_name,d.Doc_Year doc_year,j.status,j.source,j.error_code,j.updated_at,
        (SELECT COUNT(*) FROM eoffice_order_recipients r WHERE r.job_id=j.id AND r.status='success') success_count,
        (SELECT COUNT(*) FROM eoffice_order_recipients r WHERE r.job_id=j.id AND r.status='pending') pending_count,
        (SELECT COUNT(*) FROM eoffice_order_recipients r WHERE r.job_id=j.id AND r.status IN ('uncertain','failed','skipped','sending') AND NOT (r.status='skipped' AND COALESCE(r.error_code,'')='executive_excluded')) attention_count,
        (SELECT COUNT(*) FROM eoffice_order_recipients r WHERE r.job_id=j.id AND r.status='skipped' AND r.error_code='executive_excluded') excluded_count,
        (SELECT COUNT(DISTINCT LOWER(TRIM(COALESCE(l.recipient_email,'')))) FROM email_logs l WHERE $historyDoc) history_count,
        (SELECT COUNT(DISTINCT LOWER(TRIM(COALESCE(l.recipient_email,'')))) FROM email_logs l WHERE $historyDoc AND l.delivery_status='success') history_success_count,
        (SELECT MAX(l.created_at) FROM email_logs l WHERE $historyDoc AND l.delivery_status='success') history_sent_at
        $from ORDER BY d.Doc_Id DESC LIMIT $limit OFFSET $offset");$q->execute($params);$rows=$q->fetchAll();
    $years=$pdo->query("SELECT DISTINCT TRIM(Doc_Year) year FROM t_document WHERE Doc_Type='External' AND Is_Delete='active' ORDER BY year DESC")->fetchAll(PDO::FETCH_COLUMN);
    $settings=app_order_settings();
    app_json(['status'=>'success','data'=>$rows,'total'=>$total,'page'=>$page,'years'=>$years,'is_admin'=>$actor['User_Status']==='Admin','worker'=>['enabled'=>(bool)$settings['enabled'],'activated_at'=>$settings['activated_at'],'last_run'=>$settings['worker_at']]]);
}
$input=app_input();$docId=(int)($input['doc_id']??0);$action=app_text($input,'action',30,true);
if($docId<=0||!in_array($action,['enqueue','reanalyze','add_recipient','cancel_recipient','retry_recipient','cancel_job','approve'],true))app_fail('คำสั่งไม่ถูกต้อง');
$lock='email:'.$docId;$q=$pdo->prepare('SELECT GET_LOCK(?,0)');$q->execute([$lock]);if(!$q->fetchColumn())app_fail('คำสั่งนี้กำลังทำงาน กรุณาลองอีกครั้ง',409);
$response=null;$failure=null;$failureStatus=409;
try{
    $prepared=null;
    if($action==='approve'){
        if(($input['confirmed']??false)!==true)throw new DomainException('กรุณาตรวจรายชื่อและยืนยันงานที่รออนุมัติ');
        $token=$input['review_token']??null;
        if(!is_string($token)||!preg_match('/^[a-f0-9]{64}$/D',$token))throw new DomainException('กรุณารีเฟรชและตรวจรายชื่อก่อนยืนยัน');
        $prepared=app_order_prepare_approval($docId,$token);
    }
    $pdo->beginTransaction();$q=$pdo->prepare("SELECT * FROM t_document WHERE Doc_Id=? AND Doc_Type='External' AND Is_Delete='active' FOR UPDATE");$q->execute([$docId]);$doc=$q->fetch();
    if(!$doc)throw new DomainException('ไม่พบคำสั่ง');
    $current=app_user(true,true);if(!app_can($current,'email'))throw new DomainException('คุณไม่มีสิทธิ์ทำรายการนี้');
    $job=app_order_job($docId);
    if($action==='enqueue'){
        app_order_enqueue_manual($docId,(int)$actor['User_Id'],($input['confirmed']??false)===true);
    }else{
        if(!$job)throw new DomainException('กรุณานำคำสั่งเข้าคิวก่อน');
        if($action==='approve'){
            app_order_approve_prepared($doc,$token,$prepared);
        }
        elseif($action==='cancel_job')app_order_cancel((int)$job['id']);
        elseif($action==='reanalyze'){
            if(($input['confirmed']??false)!==true)throw new DomainException('กรุณายืนยันการวิเคราะห์ใหม่');
            $pdo->prepare("UPDATE eoffice_order_recipients SET status='uncertain',error_code='smtp_result_unknown' WHERE job_id=? AND status='sending'")->execute([$job['id']]);
            $pdo->prepare('DELETE FROM eoffice_order_files WHERE job_id=?')->execute([$job['id']]);
            $pdo->prepare("DELETE FROM eoffice_order_recipients WHERE job_id=? AND source='ai' AND status IN ('pending','failed','skipped') AND NOT (status='skipped' AND COALESCE(error_code,'')='executive_excluded')")->execute([$job['id']]);
            $pdo->prepare('UPDATE eoffice_order_jobs SET model=NULL,approval_hash=NULL,retry_attempts=0,retry_at=NULL WHERE id=?')->execute([$job['id']]);
            app_order_update((int)$job['id'],'queued');
        }elseif($action==='add_recipient'){
            if($job['status']==='cancelled')throw new DomainException('งานถูกยกเลิกแล้ว กรุณายืนยันการวิเคราะห์ใหม่ก่อนเพิ่มผู้รับ');
            $uid=(int)($input['user_id']??0);$email=app_text($input,'email',255);$q=$pdo->prepare('SELECT User_Id,User_Name,User_Email FROM t_user WHERE '.($uid>0?'User_Id=?':'User_Email=?'));$q->execute([$uid>0?$uid:$email]);$user=$q->fetch();
            if(!$user)throw new DomainException('ไม่พบผู้ใช้ในระบบ');
            app_order_add_recipient($job,$user,'manual');
            app_order_resume_pending($job);
        }else{
            $q=$pdo->prepare('SELECT * FROM eoffice_order_recipients WHERE id=? AND job_id=? FOR UPDATE');$q->execute([(int)($input['recipient_id']??0),$job['id']]);$recipient=$q->fetch();
            if(!$recipient)throw new DomainException('ไม่พบรายการผู้รับ');
            if($action==='cancel_recipient'){
                if($recipient['status']!=='pending')throw new DomainException('ยกเลิกได้เฉพาะรายการที่ยังไม่ส่ง');
                $pdo->prepare("UPDATE eoffice_order_recipients SET status='cancelled',error_code='operator_cancelled' WHERE id=?")->execute([$recipient['id']]);
            }else{
                if($job['status']==='cancelled')throw new DomainException('งานถูกยกเลิกแล้ว กรุณายืนยันการวิเคราะห์ใหม่ก่อนส่งต่อ');
                if($recipient['status']==='success')throw new DomainException('รายการนี้ส่งสำเร็จแล้ว');
                if(app_order_executive_recipient($recipient['user_id']!==null?(int)$recipient['user_id']:null,$recipient['recipient_email'],true))throw new DomainException('ยกเว้นการส่งอีเมลคำสั่งให้ ผอ. / รอง ผอ. ตามตำแหน่งสมาชิก');
                if(in_array($recipient['status'],['uncertain','sending'],true)&&($input['confirmed']??false)!==true)throw new DomainException('กรุณายืนยันว่าได้ตรวจสอบผลส่งแล้ว การส่งใหม่อาจซ้ำ');
                if($recipient['status']==='skipped'&&$recipient['error_code']==='executive_excluded'&&$recipient['user_id']!==null){
                    $q=$pdo->prepare('SELECT User_Email FROM t_user WHERE User_Id=? LOCK IN SHARE MODE');$q->execute([$recipient['user_id']]);$currentEmail=$q->fetchColumn();
                    if($currentEmail===false)throw new DomainException('ไม่พบผู้รับในระบบ');
                    $currentEmail=strtolower(trim($currentEmail));
                    if(app_order_executive_recipient((int)$recipient['user_id'],$currentEmail,true))throw new DomainException('ยกเว้นการส่งอีเมลคำสั่งให้ ผอ. / รอง ผอ. ตามตำแหน่งสมาชิก');
                    if($currentEmail!==$recipient['recipient_email']){
                        if(!filter_var($currentEmail,FILTER_VALIDATE_EMAIL))throw new DomainException('อีเมลผู้รับไม่ถูกต้อง');
                        $q=$pdo->prepare('SELECT 1 FROM eoffice_order_recipients WHERE job_id=? AND email_key=? AND id<>?');$key=hash('sha256',$currentEmail);$q->execute([$job['id'],$key,$recipient['id']]);
                        if($q->fetchColumn())throw new DomainException('อีเมลปัจจุบันมีรายการผู้รับอยู่แล้ว กรุณาตรวจสอบก่อนส่ง');
                        $q=$pdo->prepare('SELECT recipient_email FROM email_logs WHERE doc_id=?');$q->execute([(string)$docId]);
                        foreach($q as $log)if(strtolower(trim((string)$log['recipient_email']))===$currentEmail)throw new DomainException('อีเมลปัจจุบันมีประวัติส่งแล้ว กรุณาตรวจสอบก่อนส่ง');
                        $pdo->prepare('UPDATE eoffice_order_recipients SET recipient_email=?,email_key=? WHERE id=?')->execute([$currentEmail,$key,$recipient['id']]);
                        $recipient['recipient_email']=$currentEmail;
                    }
                }
                if(!filter_var($recipient['recipient_email'],FILTER_VALIDATE_EMAIL))throw new DomainException('อีเมลผู้รับไม่ถูกต้อง');
                $pdo->prepare("UPDATE eoffice_order_recipients SET status='pending',error_code=NULL WHERE id=?")->execute([$recipient['id']]);app_order_clear_retry((int)$job['id']);app_order_update((int)$job['id'],'queued');
            }
        }
    }
    app_order_audit($action,(int)$actor['User_Id'],$docId);$pdo->commit();$response=['status'=>'success','message'=>'บันทึกงานแล้ว ระบบจะดำเนินการในรอบ cron ถัดไป'];
}catch(DomainException $e){if($pdo->inTransaction())$pdo->rollBack();$failure=['status'=>'error','message'=>$e->getMessage()];}
catch(AppOrderAIException $e){if($pdo->inTransaction())$pdo->rollBack();$failure=['status'=>'error','code'=>$action==='approve'&&$e->reason==='pdf_cache_not_ready'?'approval_cache_not_ready':$e->reason,'message'=>'ยังยืนยันงานไม่ได้ กรุณาตรวจเอกสารและลองอีกครั้ง'];}
catch(AppDriveArchiveRetry $e){if($pdo->inTransaction())$pdo->rollBack();$failureStatus=503;$failure=['status'=>'error','code'=>'approval_drive_unavailable','message'=>'Drive ขัดข้องชั่วคราว กรุณาลองยืนยันอีกครั้ง'];}
catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
finally{$pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([$lock]);}
if($failure!==null)app_json($failure,$failureStatus);
app_json($response);
