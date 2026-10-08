<?php
ini_set('zend.exception_ignore_args','1');
require_once __DIR__.'/../config/bootstrap.php';
$expected=(string)app_env('EOFFICE_CRON_TOKEN');$header=$_SERVER['HTTP_AUTHORIZATION']??'';
if(!preg_match('/^[a-f0-9]{64}$/',$expected)||!hash_equals('Bearer '.$expected,$header))app_fail('Not found',404);
app_method('POST');$data=app_input();$action=app_text($data,'action',32,true);
if($action==='notifications'){
    require __DIR__.'/../config/services.php';set_time_limit(120);app_json(['status'=>'success','processed'=>app_process_notifications()]);
}
if($action==='database-backup'){
    require __DIR__.'/../config/database-backup.php';set_time_limit(180);$result=app_database_backup();
    unset($result['path']);app_json(['status'=>'success','backup'=>$result]);
}
if($action==='health')app_json(['status'=>'success','php'=>PHP_VERSION,'sapi'=>PHP_SAPI,'database_reachable'=>(bool)app_pdo()->query('SELECT 1')->fetchColumn(),'backup_key_configured'=>strlen(base64_decode((string)app_env('EOFFICE_BACKUP_KEY'),true)?:'')===32]);
app_fail('Invalid cron action');
