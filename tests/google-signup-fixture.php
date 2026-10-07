<?php
if (PHP_SAPI !== 'cli') exit;
require __DIR__.'/../config/google-auth.php';
if (!str_ends_with(app_settings()['database'], '_test')) throw new RuntimeException('Only test databases allowed');
$action=$argv[1]??'';
$email=$argv[2]??'';
if (!preg_match('/^qa-google-[0-9]+-[a-z]+@(siya\.ac\.th|example\.org)$/', $email)) throw new RuntimeException('Only isolated Google QA emails allowed');
if ($action==='pending') {
    $mode=$argv[3]??'signup';
    session_id(bin2hex(random_bytes(16)));
    app_google_session();
    $_SESSION['google_signup']=[
        'mode'=>$mode, 'identity'=>['sub'=>hash('sha256',$email), 'email'=>$email, 'name'=>'Google QA Name', 'hd'=>str_ends_with($email,'@siya.ac.th')?'siya.ac.th':''],
        'csrf'=>bin2hex(random_bytes(32)), 'expires_at'=>time()+((int)($argv[4]??600)), 'document_id'=>'123',
    ];
    $result=['cookie'=>'EOFFICE_GOOGLE='.session_id(), 'csrf'=>$_SESSION['google_signup']['csrf']];
    session_write_close();
} elseif ($action==='external') {
    app_pdo()->prepare("INSERT INTO t_user (User_Name,User_Email,User_Password,User_Token,User_Status) VALUES (?,?,?,?,'Editor')")->execute(['Existing external QA',$email,password_hash('Google-Link-Test-2026!',PASSWORD_DEFAULT),bin2hex(random_bytes(32))]);
    $result=['created'=>true];
} elseif (in_array($action,['cleanup','reset-attempts'],true)) {
    if($action==='cleanup')app_pdo()->prepare('DELETE FROM t_user WHERE User_Email=?')->execute([$email]);
    $key=hash('sha256','127.0.0.1:'.$email);
    app_pdo()->prepare('DELETE FROM eoffice_login_attempts WHERE identity_hash=?')->execute([$key]);
    $key=hash('sha256','::1:'.$email);
    app_pdo()->prepare('DELETE FROM eoffice_login_attempts WHERE identity_hash=?')->execute([$key]);
    $result=['removed'=>true];
} else throw new RuntimeException('Unknown fixture action');
echo json_encode($result);
