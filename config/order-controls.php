<?php
// Order-specific controls. Ordinary notifications retain their server SMTP setup.
function app_order_options(?array $row=null): array {
    $row??=app_order_settings();
    return array_replace([
        'analysis_only'=>false,'require_approval'=>false,'smtp_source'=>'server',
        'smtp_host'=>'','smtp_port'=>587,'smtp_security'=>'starttls','smtp_username'=>'',
        'smtp_from'=>'','smtp_name'=>'E-Office','smtp_reply_to'=>'',
        'subject'=>'คำสั่ง {doc_number}','intro'=>"เรียน {recipient_name}\nแจ้งคำสั่ง: {doc_name}",
        'signature'=>'E-Office','input_price'=>0,'output_price'=>0,
    ],json_decode($row['options_json']??'{}',true)?:[]);
}

function app_order_event(string $event,array $details=[],?int $actor=null): void {
    app_pdo()->prepare('INSERT INTO eoffice_order_events (actor_id,event,details) VALUES (?,?,?)')->execute([$actor,$event,json_encode($details,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);
}

function app_order_smtp(?array $row=null,?array $options=null,?string $password=null): array {
    $row??=app_order_settings();$o=$options??app_order_options($row);
    if($o['smtp_source']==='server')return [
        'host'=>(string)app_env('SMTP_HOST'),'port'=>(int)app_env('SMTP_PORT',587),'security'=>'starttls',
        'username'=>(string)app_env('SMTP_USERNAME'),'password'=>(string)app_env('SMTP_PASSWORD'),
        'from'=>(string)app_env('SMTP_FROM',app_env('SMTP_USERNAME')),'name'=>$o['smtp_name'],'reply_to'=>$o['smtp_reply_to'],
    ];
    return ['host'=>$o['smtp_host'],'port'=>$o['smtp_port'],'security'=>$o['smtp_security'],
        'username'=>$o['smtp_username'],'password'=>$password??(!empty($row['smtp_password_cipher'])?app_order_decrypt($row['smtp_password_cipher']):''),
        'from'=>$o['smtp_from'],'name'=>$o['smtp_name'],'reply_to'=>$o['smtp_reply_to']];
}

function app_order_smtp_ready(array $c): bool {
    return $c['host']!==''&&$c['username']!==''&&$c['password']!==''&&(bool)filter_var($c['from'],FILTER_VALIDATE_EMAIL);
}

function app_order_mailer(array $c): object {
    require_once __DIR__.'/../src/Exception.php';require_once __DIR__.'/../src/PHPMailer.php';require_once __DIR__.'/../src/SMTP.php';
    if(!app_order_smtp_ready($c))throw new AppOrderAIException('smtp_configuration_required');
    $mail=new PHPMailer\PHPMailer\PHPMailer(true);$mail->isSMTP();$mail->Host=$c['host'];$mail->Port=$c['port'];
    $mail->SMTPAuth=true;$mail->Username=$c['username'];$mail->Password=$c['password'];
    $mail->SMTPSecure=$c['security']==='tls'?'ssl':'tls';$mail->CharSet='UTF-8';$mail->Timeout=20;
    $mail->setFrom($c['from'],$c['name']);if($c['reply_to']!=='')$mail->addReplyTo($c['reply_to']);
    return $mail;
}

function app_order_send_mail(string $subject,string $email,string $body,?array $config=null): bool {
    if(app_settings()['mock'])return app_mail($subject,$email,$body);
    try{$mail=app_order_mailer($config??app_order_smtp());$mail->addAddress($email);$mail->isHTML(true);$mail->Subject=$subject;$mail->Body=$body;$mail->AltBody=strip_tags(str_replace(['</p>','<br>','</li>'],"\n",$body));return $mail->send();}
    catch(AppOrderAIException $e){throw $e;}
    catch(Throwable $e){throw new AppOrderAIException('smtp_connection_failed');}
}

function app_order_template(string $text,array $doc,string $name=''): string {
    return strtr($text,['{doc_number}'=>(string)$doc['Doc_Number'],'{doc_name}'=>(string)$doc['Doc_Name'],
        '{doc_year}'=>(string)$doc['Doc_Year'],'{recipient_name}'=>$name]);
}

function app_order_approval_hash(int $job): string {
    $q=app_pdo()->prepare('SELECT file_name,file_hash FROM eoffice_order_files WHERE job_id=? ORDER BY file_name');$q->execute([$job]);$files=$q->fetchAll();
    $q=app_pdo()->prepare("SELECT id,recipient_email FROM eoffice_order_recipients WHERE job_id=? AND status<>'cancelled' ORDER BY id");$q->execute([$job]);
    return hash('sha256',json_encode([$files,$q->fetchAll()],JSON_THROW_ON_ERROR));
}

// Match the settings writer's lock order: settings -> job. Reading policy and
// publishing a hold are one transaction, so reconciliation cannot pass between
// them and leave a stale hold after an automatic-mode save has committed.
function app_order_hold_for_policy(array $job): bool {
    $pdo=app_pdo();if($pdo->inTransaction())throw new RuntimeException('Policy decision requires its own transaction');
    $pdo->beginTransaction();
    try{
        $settings=app_order_settings(true);$options=app_order_options($settings);
        $q=$pdo->prepare('SELECT * FROM eoffice_order_jobs WHERE id=? FOR UPDATE');$q->execute([$job['id']]);$current=$q->fetch();
        if(!$current||!in_array($current['status'],['queued','analyzing','sending'],true)||!$settings['enabled']){$pdo->commit();return true;}
        $reason=$options['analysis_only']?'analysis_only':($options['require_approval']&&($current['approval_hash']??null)!==app_order_approval_hash((int)$current['id'])?'approval_required':null);
        if($reason!==null)app_order_update((int)$current['id'],'awaiting_approval',$reason);
        $pdo->commit();return $reason!==null;
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
}

function app_order_validate_options(array $input,array $before): array {
    $o=array_replace($before,array_intersect_key($input,$before));
    foreach(['analysis_only','require_approval'] as $k)if(!is_bool($o[$k]))app_fail('ข้อมูลนโยบายไม่ถูกต้อง');
    if(!in_array($o['smtp_source'],['server','admin'],true)||!in_array($o['smtp_security'],['starttls','tls'],true))app_fail('รูปแบบ SMTP ไม่ถูกต้อง');
    if(!is_int($o['smtp_port'])||$o['smtp_port']<1||$o['smtp_port']>65535)app_fail('SMTP Port ไม่ถูกต้อง');
    foreach(['smtp_host'=>253,'smtp_username'=>255,'smtp_from'=>255,'smtp_name'=>150,'smtp_reply_to'=>255,'subject'=>250,'intro'=>4000,'signature'=>2000] as $k=>$max){
        if(!is_string($o[$k])||mb_strlen($o[$k])>$max||str_contains($o[$k],"\0"))app_fail('ข้อมูลไม่ถูกต้อง: '.$k);
        $o[$k]=trim($o[$k]);
        if(!in_array($k,['intro','signature'],true)&&preg_match('/[\r\n]/',$o[$k]))app_fail('ข้อมูลไม่ถูกต้อง: '.$k);
    }
    if($o['smtp_host']!==''&&!preg_match('/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/D',$o['smtp_host']))app_fail('SMTP Host ต้องเป็นชื่อโฮสต์หรือ IPv4');
    foreach(['smtp_from','smtp_reply_to'] as $k)if($o[$k]!==''&&!filter_var($o[$k],FILTER_VALIDATE_EMAIL))app_fail('อีเมลไม่ถูกต้อง: '.$k);
    if($o['subject']==='')app_fail('กรุณากำหนดหัวเรื่องอีเมล');
    foreach(['subject','intro','signature'] as $k){
        preg_match_all('/\{[^{}]+\}/',$o[$k],$matches);
        foreach($matches[0] as $token)if(!in_array($token,['{doc_number}','{doc_name}','{doc_year}','{recipient_name}'],true))app_fail('ไม่รู้จักตัวแปร '.$token);
    }
    foreach(['input_price','output_price'] as $k)if(!is_numeric($o[$k])||!is_finite((float)$o[$k])||$o[$k]<0||$o[$k]>10000)app_fail('ราคาประเมินไม่ถูกต้อง');else $o[$k]=(float)$o[$k];
    return $o;
}

function app_order_diagnostics(array $row): array {
    $age=$row['worker_at']?max(0,time()-strtotime($row['worker_at'])):null;
    $smtp=[];$smtpError=null;try{$smtp=app_order_smtp($row);}catch(AppOrderAIException $e){$smtpError=$e->reason;}
    $q=app_pdo()->query("SELECT status,COUNT(*) n FROM eoffice_order_jobs GROUP BY status");$counts=[];foreach($q as $item)$counts[$item['status']]=(int)$item['n'];
    $pending=(int)app_pdo()->query("SELECT COUNT(*) FROM eoffice_order_recipients r JOIN eoffice_order_jobs j ON j.id=r.job_id WHERE r.status='pending' AND j.status<>'cancelled'")->fetchColumn();
    $q=app_pdo()->query('SELECT e.id,e.event,e.details,e.created_at,u.User_Name actor FROM eoffice_order_events e LEFT JOIN t_user u ON u.User_Id=e.actor_id ORDER BY e.id DESC LIMIT 30');$events=$q->fetchAll();
    foreach($events as &$event)$event['details']=json_decode($event['details'],true);unset($event);
    $usage=app_pdo()->query('SELECT model, SUM(prompt_tokens) input_tokens,SUM(output_tokens) output_tokens,SUM(total_tokens) total_tokens,COUNT(*) requests FROM eoffice_order_ai_usage WHERE created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) GROUP BY model')->fetchAll();
    $o=app_order_options($row);foreach($usage as &$u)$u['estimated_usd']=round(((int)$u['input_tokens']*$o['input_price']+(int)$u['output_tokens']*$o['output_price'])/1000000,6);unset($u);
    $q=app_pdo()->prepare('SELECT User_Name FROM t_user WHERE User_Id=?');$q->execute([$row['updated_by']]);
    $publicSmtp=$smtp;unset($publicSmtp['password']);
    return ['cron'=>['state'=>$age===null?'missing':($age>900?'offline':($age>420?'late':'healthy')),'age_seconds'=>$age,'finished_at'=>$row['worker_finished_at']??null,'result'=>json_decode($row['worker_result']??'null',true)],
        'smtp'=>['configured'=>$smtp!==[]&&app_order_smtp_ready($smtp),'error'=>$smtpError,'effective'=>$publicSmtp],
        'counts'=>$counts,'pending_recipients'=>$pending,'events'=>$events,'usage'=>$usage,'updated_by'=>$q->fetchColumn()?:null,
        'base_url'=>app_settings()['base_url'],'mock'=>app_settings()['mock']];
}
