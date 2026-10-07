<?php
require_once __DIR__.'/bootstrap.php';
class AppPushDeliveryException extends RuntimeException {
    public function __construct(public readonly int $retryAfter=0){parent::__construct('Push delivery failed');}
}

function app_notification_key(): string {
    $bytes=random_bytes(16);$bytes[6]=chr((ord($bytes[6])&15)|64);$bytes[8]=chr((ord($bytes[8])&63)|128);
    $hex=bin2hex($bytes);
    return substr($hex,0,8).'-'.substr($hex,8,4).'-'.substr($hex,12,4).'-'.substr($hex,16,4).'-'.substr($hex,20);
}

function app_queue(array $payload): void {
    $type=$payload['type']??'';
    $status=$type==='drive_cleanup_required'?'manual':(app_settings()['mock']&&$type!=='document_notification'?'recorded':'pending');
    if($type==='document_notification')$payload['idempotency_key']=app_notification_key();
    app_pdo()->prepare('INSERT INTO eoffice_outbox (payload,status) VALUES (?,?)')->execute([json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),$status]);
    if($type==='document_notification'&&!app_settings()['mock']) {
        static $scheduled=false;
        if(!$scheduled){$scheduled=true;register_shutdown_function(static function(){
            if(app_pdo()->inTransaction()||http_response_code()>=400)return;
            if(function_exists('fastcgi_finish_request'))fastcgi_finish_request();
            elseif(function_exists('litespeed_finish_request'))litespeed_finish_request();
            try{set_time_limit(120);app_process_notifications(20);}catch(Throwable $e){error_log((string)$e);}
        });}
    }
}

function app_mail(string $subject,string $email,string $body): bool {
    if(!filter_var($email,FILTER_VALIDATE_EMAIL))throw new RuntimeException('Invalid recipient');
    if(app_settings()['mock']){app_queue(['type'=>'mail','subject'=>$subject,'email'=>$email,'body'=>$body]);return true;}
    require_once __DIR__.'/../src/Exception.php';require_once __DIR__.'/../src/PHPMailer.php';require_once __DIR__.'/../src/SMTP.php';
    $mail=new PHPMailer\PHPMailer\PHPMailer(true);
    $mail->isSMTP();$mail->Host=app_env('SMTP_HOST');$mail->SMTPAuth=true;
    $mail->Username=app_env('SMTP_USERNAME');$mail->Password=app_env('SMTP_PASSWORD');
    if(!$mail->Host||!$mail->Username||!$mail->Password)throw new RuntimeException('SMTP configuration required');
    $mail->SMTPSecure=PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;$mail->Port=(int)app_env('SMTP_PORT',587);
    $mail->CharSet='UTF-8';$mail->Timeout=20;$mail->setFrom(app_env('SMTP_FROM',$mail->Username),'E-Office');
    $mail->addAddress($email);$mail->isHTML(true);$mail->Subject=$subject;$mail->Body=$body;
    return $mail->send();
}

function app_push(int $userId,int $docId,string $title,string $url,string $key): string {
    if(app_settings()['mock']){app_queue(['type'=>'push','user_id'=>$userId,'doc_id'=>$docId,'idempotency_key'=>$key]);return 'success';}
    $q=app_pdo()->prepare('SELECT target_Id FROM t_target_id WHERE User_Id=?');$q->execute([$userId]);$targets=$q->fetchAll(PDO::FETCH_COLUMN);
    if(!$targets)return 'skipped';
    $apiKey=app_env('ONESIGNAL_REST_API_KEY');$appId=app_env('ONESIGNAL_APP_ID');
    if(!$apiKey||!$appId)throw new RuntimeException('Push configuration required');
    $ch=curl_init('https://api.onesignal.com/notifications');
    $retryAfter=0;
    curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>20,
        CURLOPT_HEADERFUNCTION=>static function($curl,string $header)use(&$retryAfter):int{
            if(preg_match('/^Retry-After:\s*(.+)$/i',trim($header),$m))$retryAfter=ctype_digit($m[1])?(int)$m[1]:max(0,(int)strtotime($m[1])-time());
            return strlen($header);
        },
        CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: Key '.$apiKey],
        CURLOPT_POSTFIELDS=>json_encode(['app_id'=>$appId,'include_subscription_ids'=>$targets,'contents'=>['en'=>$title,'th'=>$title],
            'url'=>$url,'idempotency_key'=>$key])]);
    $response=curl_exec($ch);$code=curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);
    $result=is_string($response)?json_decode($response,true):null;
    if($response===false||$code<200||$code>=300||!is_array($result)||empty($result['id']))throw new AppPushDeliveryException($retryAfter);
    return 'success';
}

function app_outbox_progress(int $id,array $payload,string $status='pending'): void {
    app_pdo()->prepare('UPDATE eoffice_outbox SET payload=?,status=? WHERE id=?')->execute([json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),$status,$id]);
}

function app_document_notification(int $id,array $payload,?array $transports=null): string {
    $pdo=app_pdo();$userId=(int)($payload['user_id']??0);$docId=(int)($payload['doc_id']??0);
    $q=$pdo->prepare('SELECT User_Name,User_Email,User_Status FROM t_user WHERE User_Id=?');$q->execute([$userId]);$recipient=$q->fetch();
    $q=$pdo->prepare("SELECT Doc_Name FROM t_document WHERE Doc_Id=? AND Is_Delete='active'");$q->execute([$docId]);$title=$q->fetchColumn();
    if(!$recipient||!$title)return 'cancelled';
    if($recipient['User_Status']!=='Admin'){
        $q=$pdo->prepare("SELECT 1 FROM t_document d WHERE d.Doc_Id=? AND (d.Doc_Type='External' OR d.User_Id=? OR EXISTS(SELECT 1 FROM t_access_rights a WHERE a.Doc_Id=d.Doc_Id AND a.User_Id=?) OR EXISTS(SELECT 1 FROM t_access_rights_department a JOIN t_user_department u ON u.Department_Id=a.Department_Id WHERE a.Doc_Id=d.Doc_Id AND u.User_Id=?))");
        $q->execute([$docId,$userId,$userId,$userId]);if(!$q->fetchColumn())return 'cancelled';
    }
    $payload['idempotency_key']??=app_notification_key();
    $payload['delivery']??=[];unset($payload['retry_at']);
    $url=app_settings()['base_url'].'/?id='.$docId;
    foreach(['mail','push'] as $channel){
        $state=$payload['delivery'][$channel]??['status'=>'pending','attempts'=>0];
        if(in_array($state['status'],['success','skipped','uncertain','failed'],true))continue;
        if($channel==='push'&&(int)($state['attempts']??0)>0&&(!isset($state['first_attempt_at'])||$state['first_attempt_at']<time()-29*86400)){
            $state['status']='uncertain';$payload['delivery'][$channel]=$state;app_outbox_progress($id,$payload);continue;
        }
        // A crashed mail send may already have been accepted by SMTP. Never
        // resend it automatically. Push is retryable with a persisted UUID.
        if($channel==='mail'&&$state['status']==='sending'){
            $state['status']='uncertain';$payload['delivery'][$channel]=$state;app_outbox_progress($id,$payload);continue;
        }
        $state['status']='sending';$state['attempts']=(int)($state['attempts']??0)+1;
        $state['first_attempt_at']??=time();
        $payload['delivery'][$channel]=$state;app_outbox_progress($id,$payload);
        try{
            if($channel==='mail'){
                if(!(($transports['mail']??'app_mail')((string)$title,$recipient['User_Email'],'<a href="'.htmlspecialchars($url,ENT_QUOTES).'">เปิดเอกสาร</a>')))throw new RuntimeException('Mail not accepted');
                $state['status']='success';
            }else{
                $result=($transports['push']??'app_push')($userId,$docId,(string)$title,$url,$payload['idempotency_key']);
                if(!in_array($result,['success','skipped'],true))throw new RuntimeException('Invalid push result');
                $state['status']=$result;
            }
            unset($state['error_class']);
        }catch(Throwable $e){
            error_log('Notification job '.$id.' '.$channel.' failed ('.get_class($e).')');$state['error_class']=get_class($e);
            if($channel==='mail')$state['status']='uncertain';
            elseif($state['attempts']<5){$state['status']='pending';$delay=min(1800,60*(2**($state['attempts']-1)));if($e instanceof AppPushDeliveryException)$delay=max($delay,min(86400,$e->retryAfter));$payload['retry_at']=time()+$delay;}
            else $state['status']='failed';
        }
        $payload['delivery'][$channel]=$state;app_outbox_progress($id,$payload);
    }
    $states=array_column($payload['delivery'],'status');
    $status=in_array('pending',$states,true)?'pending':(in_array('uncertain',$states,true)?'manual':(in_array('failed',$states,true)?'partial':'success'));
    app_outbox_progress($id,$payload,$status);
    return $status;
}

function app_process_notifications(int $limit=100,?array $transports=null): int {
    if($transports!==null&&(!app_settings()['mock']||!str_ends_with(app_settings()['database'],'_test')))throw new RuntimeException('Transport injection is restricted to mock tests');
    $pdo=app_pdo();if($pdo->inTransaction())return 0;
    $q=$pdo->query("SELECT GET_LOCK('eoffice:outbox',0)");if(!$q->fetchColumn())return 0;
    $count=0;$deadline=microtime(true)+45;
    try{
        // Preserve cleanup work for an operator; never let it occupy the head
        // of the document-notification queue. Mock traces are already records.
        $pdo->exec("UPDATE eoffice_outbox SET status='manual' WHERE status='pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.type'))='drive_cleanup_required'");
        $pdo->exec("UPDATE eoffice_outbox SET status='manual' WHERE status='failed' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.type'))='document_notification' AND JSON_EXTRACT(payload,'$.delivery') IS NULL");
        $pdo->exec("UPDATE eoffice_outbox SET status='manual' WHERE status='pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.type'))='document_notification' AND JSON_EXTRACT(payload,'$.idempotency_key') IS NULL");
        if(app_settings()['mock'])$pdo->exec("UPDATE eoffice_outbox SET status='recorded' WHERE status='pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.type')) IN ('mail','push','ai','drive_image')");
        $limit=max(1,min(100,$limit));
        $rows=$pdo->query("SELECT * FROM eoffice_outbox WHERE status='pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.type'))='document_notification' AND COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.retry_at')) AS UNSIGNED),0)<=UNIX_TIMESTAMP() ORDER BY id LIMIT $limit")->fetchAll();
        foreach($rows as $row){
            if(microtime(true)>=$deadline)break;
            try{
                $status=app_document_notification((int)$row['id'],json_decode($row['payload'],true,512,JSON_THROW_ON_ERROR),$transports);
                if($status==='cancelled')$pdo->prepare("UPDATE eoffice_outbox SET status='cancelled' WHERE id=?")->execute([$row['id']]);
            }catch(Throwable $e){error_log('Notification job '.$row['id'].' processing failed ('.get_class($e).')');$pdo->prepare("UPDATE eoffice_outbox SET status='manual' WHERE id=?")->execute([$row['id']]);}
            $count++;
        }
    }finally{$pdo->query("SELECT RELEASE_LOCK('eoffice:outbox')");}
    return $count;
}
