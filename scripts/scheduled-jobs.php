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
            $pdo=app_pdo();$ready=(bool)$pdo->query('SELECT full_scan_at FROM eoffice_drive_state WHERE id=1')->fetchColumn();
            $pending=(int)$pdo->query("SELECT COUNT(*) FROM eoffice_drive_files f JOIN eoffice_drive_versions v ON v.id=f.version_id WHERE v.status<>'verified'")->fetchColumn();
            if($ready&&$pending===0)echo json_encode(['drive_daily'=>app_drive_archive_backup()],JSON_THROW_ON_ERROR).PHP_EOL;
            else echo json_encode(['drive_daily'=>['deferred'=>true,'reason'=>'initial_sync_pending','pending_versions'=>$pending]],JSON_THROW_ON_ERROR).PHP_EOL;
        }catch(Throwable $e){fwrite(STDERR,'Drive daily backup failed ('.get_class($e).")\n");$failed=true;}
    }
}
if($failed)exit(1);
