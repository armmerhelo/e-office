<?php
require_once __DIR__ . '/bootstrap.php';
function app_queue(array $payload): void {
    app_pdo()->prepare('INSERT INTO eoffice_outbox (payload) VALUES (?)')->execute([json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
}
function app_mail(string $subject, string $email, string $body): bool {
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new RuntimeException('Invalid recipient');
    if (app_settings()['mock']) { app_queue(['type'=>'mail','subject'=>$subject,'email'=>$email,'body'=>$body]); return true; }
    require_once __DIR__ . '/../src/Exception.php'; require_once __DIR__ . '/../src/PHPMailer.php'; require_once __DIR__ . '/../src/SMTP.php';
    $mail = new PHPMailer\PHPMailer\PHPMailer(true);
    $mail->isSMTP(); $mail->Host = app_env('SMTP_HOST'); $mail->SMTPAuth = true;
    $mail->Username = app_env('SMTP_USERNAME'); $mail->Password = app_env('SMTP_PASSWORD');
    if (!$mail->Host || !$mail->Username || !$mail->Password) throw new RuntimeException('SMTP configuration required');
    $mail->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS; $mail->Port = (int)app_env('SMTP_PORT',587);
    $mail->CharSet = 'UTF-8'; $mail->Timeout = 20; $mail->setFrom(app_env('SMTP_FROM',$mail->Username), 'E-Office');
    $mail->addAddress($email); $mail->isHTML(true); $mail->Subject=$subject; $mail->Body=$body;
    return $mail->send();
}
function app_document_notification(int $userId, int $docId): void {
    $pdo=app_pdo();$q=$pdo->prepare('SELECT User_Name,User_Email,User_Status FROM t_user WHERE User_Id=?');$q->execute([$userId]);$recipient=$q->fetch();
    $q=$pdo->prepare("SELECT Doc_Name FROM t_document WHERE Doc_Id=? AND Is_Delete='active'");$q->execute([$docId]);$title=$q->fetchColumn();
    if(!$recipient||!$title)return;
    if($recipient['User_Status']!=='Admin'){
        $q=$pdo->prepare("SELECT 1 FROM t_document d WHERE d.Doc_Id=? AND (d.Doc_Type='External' OR d.User_Id=? OR EXISTS(SELECT 1 FROM t_access_rights a WHERE a.Doc_Id=d.Doc_Id AND a.User_Id=?) OR EXISTS(SELECT 1 FROM t_access_rights_department a JOIN t_user_department u ON u.Department_Id=a.Department_Id WHERE a.Doc_Id=d.Doc_Id AND u.User_Id=?))");
        $q->execute([$docId,$userId,$userId,$userId]);if(!$q->fetchColumn())return;
    }
    $url=app_settings()['base_url'].'/?id='.$docId;
    app_mail((string)$title,$recipient['User_Email'],'<a href="'.htmlspecialchars($url,ENT_QUOTES).'">เปิดเอกสาร</a>');
    if(app_settings()['mock']){app_queue(['type'=>'push','user_id'=>$userId,'doc_id'=>$docId]);return;}
    $key=app_env('ONESIGNAL_REST_API_KEY');$appId=app_env('ONESIGNAL_APP_ID');
    if(!$key||!$appId)return;
    $q=$pdo->prepare('SELECT target_Id FROM t_target_id WHERE User_Id=?');$q->execute([$userId]);$targets=$q->fetchAll(PDO::FETCH_COLUMN);if(!$targets)return;
    $ch=curl_init('https://api.onesignal.com/notifications');curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>20,CURLOPT_HTTPHEADER=>['Content-Type: application/json','Authorization: Key '.$key],CURLOPT_POSTFIELDS=>json_encode(['app_id'=>$appId,'include_subscription_ids'=>$targets,'contents'=>['en'=>$title,'th'=>$title],'url'=>$url])]);
    $result=curl_exec($ch);$code=curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);if($result===false||$code>=400)throw new RuntimeException('Push delivery failed');
}
