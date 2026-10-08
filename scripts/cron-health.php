<?php
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require __DIR__.'/../config/bootstrap.php';
$extensions=['pdo_mysql','mysqli','mbstring','fileinfo','gd','curl','openssl','zlib'];$missing=array_values(array_filter($extensions,static fn($ext)=>!extension_loaded($ext)));
$info=['php'=>PHP_VERSION,'sapi'=>PHP_SAPI,'php_compatible'=>PHP_VERSION_ID>=80100,'missing_extensions'=>$missing,'database_reachable'=>false];
try{$info['database_reachable']=(bool)app_pdo()->query('SELECT 1')->fetchColumn();}catch(Throwable $e){$info['database_error_class']=get_class($e);}
$directory=dirname(app_settings()['storage']).'/operations';if(!is_dir($directory))mkdir($directory,0750,true);
$info['checked_at']=gmdate('c');file_put_contents($directory.'/cron-health.json',json_encode($info,JSON_THROW_ON_ERROR));
echo json_encode($info,JSON_THROW_ON_ERROR).PHP_EOL;
if(!$info['php_compatible']||$missing||!$info['database_reachable'])exit(1);
