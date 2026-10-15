<?php
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require_once __DIR__.'/../config/order-key-rotation.php';
try{
    $old=app_order_secret_key();$new=base64_decode((string)getenv('EOFFICE_SETTINGS_NEW_KEY'),true);
    if($new===false||strlen($new)!==32)throw new InvalidArgumentException('EOFFICE_SETTINGS_NEW_KEY must be a base64-encoded 32-byte key');
    $count=app_order_rotate_settings_key($old,$new);
    echo "Re-encrypted $count credentials. Keep web/cron stopped until EOFFICE_SETTINGS_KEY is replaced with the new key in both processes. No config files were changed.\n";
}catch(Throwable $e){fwrite(STDERR,'Rotation failed ('.get_class($e)."): verify key configuration, pause processing and ensure no worker is running. Database changes rolled back.\n");exit(1);}
