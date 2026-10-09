<?php
if (PHP_SAPI !== 'cli') exit;
require __DIR__.'/../config/member-management.php';

$passed=0;
function check(bool $condition,string $name): void {
    global $passed;
    if(!$condition)throw new RuntimeException('FAILED '.$name);
    $passed++;echo 'PASS '.$name.PHP_EOL;
}
function rejects_key(string $value,string $name): void {
    putenv('EOFFICE_MEMBER_VERSION_KEY='.$value);
    try{app_member_version_key();throw new LogicException('Accepted invalid key');}
    catch(RuntimeException $error){check(true,$name);}
}

// The password is synthetic legacy fixture data, never a real user's password.
$user=['User_Id'=>42,'User_Name'=>'สมาชิกทดสอบ','User_Email'=>'fixture@example.test','User_Status'=>'User','User_Password'=>' Review-Legacy-2026! '];
$departments=[['Department_Id'=>7,'Department_Name'=>'Test']];
$key=base64_encode(random_bytes(32));
putenv('EOFFICE_MEMBER_VERSION_KEY='.$key);putenv('EOFFICE_SETTINGS_KEY=');
$version=app_member_version($user,$departments);
check((bool)preg_match('/^[a-f0-9]{64}$/D',$version),'opaque version retains the API token format');
check($version===app_member_version($user,$departments),'unchanged data has a stable version');
foreach(['wrong-password',$user['User_Password']] as $guess){
    $offline=hash('sha256',json_encode([$user['User_Id'],$user['User_Name'],$user['User_Email'],$user['User_Status'],$guess,[7]],JSON_THROW_ON_ERROR));
    check($version!==$offline,'plain offline password guesses do not match the version');
}
foreach(['User_Name'=>'Changed name','User_Email'=>'changed@example.test','User_Status'=>'Admin','User_Password'=>'Changed password'] as $field=>$value){
    $changed=$user;$changed[$field]=$value;
    check(app_member_version($changed,$departments)!==$version,'version invalidates on change: '.$field);
}
$changed=$user;$changed['User_Password']=password_hash($user['User_Password'],PASSWORD_DEFAULT);
check(app_member_version($changed,$departments)!==$version,'legacy password migration invalidates the snapshot');
check(app_member_version($user,[['Department_Id'=>8]])!==$version,'group assignments invalidate the snapshot');
putenv('EOFFICE_MEMBER_VERSION_KEY='.base64_encode(random_bytes(32)));
check(app_member_version($user,$departments)!==$version,'key rotation invalidates older tokens');
putenv('EOFFICE_SETTINGS_KEY='.$key);putenv('EOFFICE_MEMBER_VERSION_KEY=');
check(app_member_version($user,$departments)===$version,'settings key fallback is stable and domain separated');
putenv('EOFFICE_SETTINGS_KEY='.base64_encode(random_bytes(32)));putenv('EOFFICE_MEMBER_VERSION_KEY='.$key);
check(app_member_version($user,$departments)===$version,'dedicated version key takes precedence');
rejects_key('not-base64','invalid dedicated key never falls back to another key');
rejects_key(base64_encode(random_bytes(16)),'undersized version keys are rejected');
putenv('EOFFICE_SETTINGS_KEY=');rejects_key('','missing configuration fails closed without an unkeyed version');
echo 'Member version: '.$passed.' passed'.PHP_EOL;
