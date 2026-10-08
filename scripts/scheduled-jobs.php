<?php
// Existing five-minute order Cron also services the incremental Drive queue.
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
ini_set('zend.exception_ignore_args','1');
require __DIR__.'/../config/order-emails.php';
require __DIR__.'/../config/drive-archive-worker.php';
$failed=false;
try{echo app_order_worker()." order jobs processed\n";}catch(Throwable $e){fwrite(STDERR,'Order scheduler failed ('.get_class($e).")\n");$failed=true;}
if(app_drive_archive_enabled()){
    try{echo json_encode(['drive_worker'=>app_drive_archive_worker()],JSON_THROW_ON_ERROR).PHP_EOL;}
    catch(Throwable $e){fwrite(STDERR,'Drive worker failed ('.get_class($e).")\n");$failed=true;}
    if((int)date('G')>=2){
        try{
            echo json_encode(['drive_daily'=>app_drive_archive_backup()],JSON_THROW_ON_ERROR).PHP_EOL;
        }catch(Throwable $e){fwrite(STDERR,'Drive daily backup failed ('.get_class($e).")\n");$failed=true;}
    }
}
if($failed)exit(1);
