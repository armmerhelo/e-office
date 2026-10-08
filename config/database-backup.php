<?php
require_once __DIR__.'/bootstrap.php';
require_once __DIR__.'/backup-stream.php';

function app_database_backup(?callable $capture=null): array {
    $key=base64_decode((string)app_env('EOFFICE_BACKUP_KEY'),true);
    if($key===false||strlen($key)!==32)throw new RuntimeException('Backup encryption key required');
    $directory=(string)app_env('EOFFICE_BACKUP_DIRECTORY',dirname(app_settings()['storage']).'/backups');
    if(!is_dir($directory)&&!@mkdir($directory,0750,true)&&!is_dir($directory))throw new RuntimeException('Backup directory unavailable');
    $real=realpath($directory);$web=realpath(dirname(__DIR__));
    if(!$real||!$web||$real===$web||str_starts_with(str_replace('\\','/',$real),str_replace('\\','/',$web).'/'))throw new RuntimeException('Backup must be outside web root');
    $pdo=app_pdo();if($pdo->inTransaction())throw new RuntimeException('Backup requires its own read-only snapshot');
    $buffered=$pdo->getAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY);$timezone=(string)$pdo->query('SELECT @@SESSION.time_zone')->fetchColumn();
    if(!$pdo->query("SELECT GET_LOCK('eoffice:database-backup',0)")->fetchColumn())return ['skipped'=>true,'reason'=>'backup_already_running'];
    $name='database-'.gmdate('Ymd-His').'-'.bin2hex(random_bytes(8)).'.ebak';$temporary=$real.'/'.$name.'.partial';$final=$real.'/'.$name;
    $writer=null;$statement=null;$tables=0;$rows=0;
    try{
        $pdo->exec("SET SESSION time_zone='+00:00'");
        $schemas=[];foreach($pdo->query('SHOW FULL TABLES')->fetchAll(PDO::FETCH_NUM) as [$table,$type]){
            if($type!=='BASE TABLE')continue;$safe='`'.str_replace('`','``',$table).'`';$schemas[$table]=$pdo->query('SHOW CREATE TABLE '.$safe)->fetch(PDO::FETCH_NUM)[1];
            if(!preg_match('/\bENGINE=InnoDB\b/i',$schemas[$table]))throw new RuntimeException('Consistent backup requires InnoDB tables');
        }
        $pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');$pdo->beginTransaction();
        $snapshot=$capture?$capture($pdo):null;
        $writer=new AppBackupWriter($temporary,$key,'jsonl-gzip');$buffer='';
        $write=static function(array $record)use(&$buffer,$writer):void{$buffer.=json_encode($record,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE)."\n";if(strlen($buffer)>=131072){$gzip=gzencode($buffer,6);if($gzip===false)throw new RuntimeException('Backup compression failed');$writer->write($gzip);$buffer='';}};
        $write(['kind'=>'metadata','database'=>app_settings()['database'],'started_at'=>gmdate('c'),'version'=>2,'time_zone'=>'+00:00']);
        $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY,false);
        foreach($schemas as $table=>$schema){
            $write(['kind'=>'schema','table'=>$table,'sql'=>$schema]);$tables++;$statement=$pdo->query('SELECT * FROM `'.str_replace('`','``',$table).'`');
            while($row=$statement->fetch(PDO::FETCH_ASSOC)){
                $binary=[];foreach($row as $column=>$value)if(is_string($value)&&preg_match('//u',$value)!==1){$row[$column]=base64_encode($value);$binary[]=$column;}
                $write(['kind'=>'row','table'=>$table,'data'=>$row,'binary'=>$binary]);$rows++;
            }
            $statement->closeCursor();$statement=null;
        }
        $write(['kind'=>'end','tables'=>$tables,'rows'=>$rows,'finished_at'=>gmdate('c')]);
        if($buffer!==''){$gzip=gzencode($buffer,6);if($gzip===false)throw new RuntimeException('Backup compression failed');$writer->write($gzip);}
        $result=$writer->finish();$pdo->commit();
        app_backup_publish($temporary,$final);
        $result=['created'=>true,'format_version'=>2,'filename'=>$name,'path'=>$final,'tables'=>$tables,'rows'=>$rows,'encrypted_bytes'=>filesize($final),'archive_sha256'=>hash_file('sha256',$final),'stream_sha256'=>$result['sha256']];
        if($snapshot!==null)$result['snapshot']=$snapshot;return $result;
    }catch(Throwable $e){if($statement)$statement->closeCursor();if($pdo->inTransaction())$pdo->rollBack();unset($writer);if(is_file($temporary))unlink($temporary);throw $e;}
    finally{$pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY,$buffered);$pdo->exec('SET SESSION time_zone='.$pdo->quote($timezone));$pdo->query("SELECT RELEASE_LOCK('eoffice:database-backup')");}
}
