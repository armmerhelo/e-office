<?php
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
ini_set('zend.exception_ignore_args','1');
require __DIR__.'/../config/drive-archive-worker.php';
require __DIR__.'/../config/drive-archive-schema.php';
$action=$argv[1]??'worker';
try{
    if($action==='migrate'){app_drive_archive_migrate(app_pdo());$result=['migrated'=>true];}
    elseif($action==='worker')$result=app_drive_archive_worker();
    elseif($action==='backup')$result=app_drive_archive_backup();
    elseif($action==='retry'){
        $id=$argv[2]??'';if(!preg_match('/^[a-f0-9]{64}$/D',$id))throw new RuntimeException('Version ID required');
        $pdo=app_pdo();if(!$pdo->query("SELECT GET_LOCK('eoffice:drive-archive',0)")->fetchColumn())throw new RuntimeException('Archive worker is active');
        try{
            $q=$pdo->prepare("SELECT * FROM eoffice_drive_versions WHERE id=? AND status IN ('pending','review')");$q->execute([$id]);$version=$q->fetch();
            if(!$version)throw new RuntimeException('Pending/review version required');
            app_drive_archive_key($version['key_id']);$source=app_drive_archive_directory('spool').'/'.$id.'.source';
            if(!is_file($source)||filesize($source)!==(int)$version['bytes']||!hash_equals($version['revision'],hash_file('sha256',$source)))throw new RuntimeException('Repair/preserve pinned source before retry');
            $pdo->prepare("UPDATE eoffice_drive_versions SET status='pending',retry_at=NULL,attempts=0,error_code=NULL WHERE id=?")->execute([$id]);
            $result=['requeued'=>true,'version'=>$id];
        }finally{$pdo->query("SELECT RELEASE_LOCK('eoffice:drive-archive')");}
    }
    elseif($action==='health'){
        $result=['enabled'=>app_drive_archive_enabled(),'configured'=>app_drive_archive_configured(),'eviction_enabled'=>filter_var(app_env('EOFFICE_DRIVE_EVICT_ENABLED','false'),FILTER_VALIDATE_BOOLEAN)];
        if($result['enabled']){$result['bridge']=app_drive_archive_call(['action'=>'health']);$result['state']=app_pdo()->query('SELECT * FROM eoffice_drive_state WHERE id=1')->fetch();}
    }else throw new RuntimeException('Invalid archive command');
    echo json_encode($result,JSON_THROW_ON_ERROR).PHP_EOL;
}catch(Throwable $e){fwrite(STDERR,'Drive archive command failed ('.get_class($e).')'.PHP_EOL);exit(1);}
