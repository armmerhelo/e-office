<?php
require_once __DIR__.'/../config/drive-archive.php';app_method('GET');app_admin();
if(!app_drive_archive_enabled())app_json(['status'=>'success','enabled'=>false,'configured'=>app_drive_archive_configured()]);
$pdo=app_pdo();$state=$pdo->query('SELECT * FROM eoffice_drive_state WHERE id=1')->fetch();
$counts=$pdo->query('SELECT status,COUNT(*) files,COALESCE(SUM(bytes),0) bytes FROM eoffice_drive_versions GROUP BY status')->fetchAll();
$backups=$pdo->query('SELECT backup_date,status,created_at,completed_at,error_code FROM eoffice_drive_backups ORDER BY backup_date DESC LIMIT 30')->fetchAll();
$retry=$pdo->query("SELECT COUNT(*) deferred,MIN(retry_at) next_retry FROM eoffice_drive_versions WHERE status='pending' AND retry_at IS NOT NULL")->fetch();
app_json(['status'=>'success','enabled'=>true,'configured'=>app_drive_archive_configured(),'eviction_enabled'=>filter_var(app_env('EOFFICE_DRIVE_EVICT_ENABLED','false'),FILTER_VALIDATE_BOOLEAN),'state'=>$state,'counts'=>$counts,'backups'=>$backups,'retry'=>$retry]);
