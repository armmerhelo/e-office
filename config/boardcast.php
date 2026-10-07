<?php
require_once __DIR__.'/bootstrap.php';
function boardcast_writer(): void {
    $key=app_env('BOARDCAST_DEVICE_KEY');
    $provided=$_SERVER['HTTP_AUTHORIZATION']??'';
    if($key===''||!hash_equals('Bearer '.$key,$provided))app_fail('Unauthorized device',401);
}
function boardcast_db(): PDO {
    $s=app_settings();$db=app_env('BOARDCAST_DB_DATABASE');if($db==='')app_fail('Boardcast database configuration required',503);
    return new PDO("mysql:host={$s['host']};port={$s['port']};dbname=$db;charset=utf8mb4",app_env('BOARDCAST_DB_USERNAME',$s['username']),app_env('BOARDCAST_DB_PASSWORD',$s['password']),[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
}
