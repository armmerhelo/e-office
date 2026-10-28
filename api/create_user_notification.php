<?php
require_once __DIR__ . '/../config/bootstrap.php';
app_method('POST'); $user = app_user(); $data = app_input();
app_expected_owner($data, $user);
$target = app_text($data, 'target_Id', 100, true);
if (!preg_match('/^[a-zA-Z0-9-]{10,100}$/', $target)) app_fail('Invalid subscription');
if (array_key_exists('active',$data) && !is_bool($data['active'])) app_fail('Invalid subscription state');
$token=$_COOKIE['User_Token']??'';
if($token===''&&preg_match('/^Bearer ([a-f0-9]{64})$/i',$_SERVER['HTTP_AUTHORIZATION']??'',$match))$token=$match[1];
$pdo=app_pdo();$pdo->beginTransaction();
try {
    // Hold the current session until the binding commits. Logout/revocation
    // either wins first (401), or waits and invalidates the committed binding.
    $current=app_user(false,true);
    if(!$current){$pdo->rollBack();app_fail('กรุณาเข้าสู่ระบบใหม่',401);}
    if((int)$current['User_Id']!==(int)$user['User_Id']){$pdo->rollBack();app_fail('บัญชีผู้ใช้เปลี่ยนแล้ว',409);}
    $hash=hash('sha256',$token);
    if(($data['active']??true)===false){
        $q=$pdo->prepare('DELETE FROM eoffice_push_subscriptions WHERE subscription_id=? AND User_Id=? AND session_hash=?');
        $q->execute([$target,$current['User_Id'],$hash]);
    }else{
        $q=$pdo->prepare('INSERT INTO eoffice_push_subscriptions (subscription_id,User_Id,session_hash) VALUES (?,?,?) ON DUPLICATE KEY UPDATE User_Id=VALUES(User_Id),session_hash=VALUES(session_hash),updated_at=NOW()');
        $q->execute([$target,$current['User_Id'],$hash]);
    }
    $pdo->commit();
}catch(Throwable $error){if($pdo->inTransaction())$pdo->rollBack();throw $error;}
app_json(['status'=>'success']);
