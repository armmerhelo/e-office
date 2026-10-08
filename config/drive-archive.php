<?php
require_once __DIR__.'/drive-archive-client.php';
require_once __DIR__.'/backup-stream.php';
require_once __DIR__.'/document-files.php';

function app_drive_archive_enabled(): bool {return filter_var(app_env('EOFFICE_DRIVE_ARCHIVE_ENABLED','false'),FILTER_VALIDATE_BOOLEAN);}
function app_drive_archive_key(?string $id=null): string {
    $current=base64_decode((string)app_env('EOFFICE_BACKUP_KEY'),true);
    $keys=json_decode((string)app_env('EOFFICE_BACKUP_OLD_KEYS','{}'),true,16,JSON_THROW_ON_ERROR);
    if($current!==false&&strlen($current)===32&&($id===null||substr(hash('sha256',$current),0,16)===$id))return $current;
    $old=base64_decode($keys[$id]??'',true);
    if($old===false||strlen($old)!==32||substr(hash('sha256',$old),0,16)!==$id)throw new RuntimeException('Archive decryption key unavailable');
    return $old;
}
function app_drive_archive_directory(string $kind): string {
    if(!in_array($kind,['spool','cache','quarantine'],true))throw new RuntimeException('Invalid archive directory');
    $root=dirname(app_settings()['storage']).'/drive-archive';
    if(!is_dir($root)&&!@mkdir($root,0700,true)&&!is_dir($root))throw new RuntimeException('Archive directory unavailable');
    $real=str_replace('\\','/',realpath($root)?:'');$web=str_replace('\\','/',realpath(dirname(__DIR__))?:'');
    if(PHP_OS_FAMILY==='Windows'){$real=strtolower($real);$web=strtolower($web);}
    if($real===''||$web===''||$real===$web||str_starts_with($real,$web.'/'))throw new RuntimeException('Archive spool/cache must be outside web root');
    $path=$root.'/'.$kind;if(!is_dir($path)&&!@mkdir($path,0700)&&!is_dir($path))throw new RuntimeException('Archive directory unavailable');return $path;
}
function app_drive_archive_id(int $doc,string $name,string $variant,string $revision): string {
    if($doc<=0||$name!==basename($name)||str_contains($name,'\\')||!in_array($variant,['original','signed'],true)||!preg_match('/^[a-f0-9]{64}$/',$revision))throw new RuntimeException('Invalid archive identity');
    return hash('sha256',$doc."\0".$name."\0".$variant."\0".$revision);
}
// File writers call this under their document lock before committing. A private
// hard link pins the immutable inode so later replacement cannot lose a version
// before the asynchronous Drive worker has uploaded it.
function app_drive_archive_track(int $doc,string $name,string $variant,string $path): void {
    if(!app_drive_archive_enabled())return;
    $pdo=app_pdo();if(!$pdo->inTransaction())throw new RuntimeException('Archive tracking requires document transaction');
    $revision=hash_file('sha256',$path);if($revision===false)throw new RuntimeException('Archive source unavailable');
    $id=app_drive_archive_id($doc,$name,$variant,$revision);$key=app_drive_archive_key();
    $source=app_drive_archive_directory('spool').'/'.$id.'.source';
    $check=$pdo->prepare('SELECT status FROM eoffice_drive_versions WHERE id=?');$check->execute([$id]);$verified=$check->fetchColumn()==='verified';
    if(!$verified){
        if(!is_file($source)&&!@link($path,$source))throw new RuntimeException('Cannot preserve archive source');
        if(!hash_equals($revision,hash_file('sha256',$source)))throw new RuntimeException('Archive source changed');
        $pdo->prepare('INSERT IGNORE INTO eoffice_drive_versions (id,doc_id,file_name,variant,revision,bytes,key_id) VALUES (?,?,?,?,?,?,?)')->execute([$id,$doc,$name,$variant,$revision,filesize($source),substr(hash('sha256',$key),0,16)]);
    }
    $pdo->prepare('UPDATE eoffice_drive_versions SET verified_at=IF(evicted_at IS NOT NULL,NOW(),verified_at),evicted_at=NULL WHERE id=?')->execute([$id]);
    $pdo->prepare('INSERT INTO eoffice_drive_files (doc_id,file_name,variant,version_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE version_id=VALUES(version_id)')->execute([$doc,$name,$variant,$id]);
}
function app_drive_archive_current(int $doc,string $name,string $variant): ?array {
    if(!app_drive_archive_enabled())return null;
    $q=app_pdo()->prepare('SELECT v.* FROM eoffice_drive_files f JOIN eoffice_drive_versions v ON v.id=f.version_id WHERE f.doc_id=? AND f.file_name=? AND f.variant=?');$q->execute([$doc,$name,$variant]);return $q->fetch()?:null;
}
function app_drive_archive_local(array $doc,string $name,string $variant): string {
    $year=(string)$doc['Doc_Year'];
    if($variant==='original')return app_storage('original',$year,$name);
    $modern=app_storage('e-sign',$year,'signed_'.$doc['Doc_Id'].'_'.$name);$legacy=app_storage('e-sign',$year,'signed_'.$name);
    return is_file($modern)?$modern:(is_file($legacy)?$legacy:$modern);
}
function app_drive_archive_parts(array $version): array {
    $parts=json_decode($version['parts']??'null',true,32,JSON_THROW_ON_ERROR);
    if(!is_array($parts)||!array_is_list($parts)||!$parts)throw new RuntimeException('Archive parts unavailable');
    $offset=0;foreach($parts as $part){
        if(!is_array($part)||($part['offset']??null)!==$offset||!is_int($part['bytes']??null)||$part['bytes']<0||$part['bytes']>1048576||($part['bytes']===0&&count($parts)!==1)||!preg_match('/^[a-f0-9]{64}$/',$part['object']??'')||!preg_match('/^[a-f0-9]{64}$/',$part['sha256']??''))throw new RuntimeException('Invalid archive part manifest');
        $offset+=$part['bytes'];
    }
    if($offset!==(int)$version['bytes'])throw new RuntimeException('Archive manifest size mismatch');return $parts;
}
function app_drive_archive_restore(array $version,?callable $get=null): string {
    if($version['status']!=='verified'||!preg_match('/^[a-f0-9]{64}$/',$version['id']))throw new RuntimeException('Verified archive required');
    if($get!==null&&(!app_settings()['mock']||!str_ends_with(app_settings()['database'],'_test')))throw new RuntimeException('Test transports only');
    $key=app_drive_archive_key($version['key_id']);$parts=app_drive_archive_parts($version);$cache=app_drive_archive_directory('cache');$path=$cache.'/'.$version['id'].'.plain';
    $lock=fopen($cache.'/'.$version['id'].'.lock','c+b');if(!$lock||!flock($lock,LOCK_EX))throw new RuntimeException('Archive cache lock unavailable');
    try{
        if(is_file($path)&&filesize($path)===(int)$version['bytes']&&hash_equals($version['revision'],hash_file('sha256',$path))){touch($path);return $path;}
        $existing=app_pdo()->inTransaction();
        if($existing)throw new RuntimeException('Archive cache must be prepared before locking document');
        if(is_file($path))unlink($path);
        $temporary=$path.'.'.bin2hex(random_bytes(8)).'.partial';$out=fopen($temporary,'xb');if(!$out)throw new RuntimeException('Archive cache unavailable');chmod($temporary,0600);
        $encrypted=null;
        try{
            $hash=hash_init('sha256');$total=0;
            foreach($parts as $part){
                $download=$get??static fn(string $id)=>app_drive_archive_get($id,static function(){app_pdo()->query('SELECT 1')->fetchColumn();});
                $bytes=$download($part['object']);
                if(!is_string($bytes)||strlen($bytes)>2097152||!hash_equals($part['object'],hash('sha256',$bytes)))throw new RuntimeException('Archive object corrupted');
                $encrypted=$temporary.'.ebak';if(file_put_contents($encrypted,$bytes)!==strlen($bytes))throw new RuntimeException('Cache write failed');chmod($encrypted,0600);unset($bytes);
                $result=app_backup_verify($encrypted,$key,static function($plain)use($out,$hash,&$total){$total+=strlen($plain);hash_update($hash,$plain);$offset=0;while($offset<strlen($plain)){$written=fwrite($out,substr($plain,$offset));if(!$written)throw new RuntimeException('Cache write failed');$offset+=$written;}});
                if($result['bytes']!==$part['bytes']||!hash_equals($part['sha256'],$result['sha256']))throw new RuntimeException('Archive plaintext mismatch');
                unlink($encrypted);$encrypted=null;
            }
            if($total!==(int)$version['bytes']||!hash_equals($version['revision'],hash_final($hash))||!fflush($out))throw new RuntimeException('Archive file integrity mismatch');
            fclose($out);$out=null;app_backup_publish($temporary,$path);return $path;
        }finally{if(is_resource($out))fclose($out);if(is_file($temporary))unlink($temporary);if($encrypted&&is_file($encrypted))unlink($encrypted);}
    }finally{flock($lock,LOCK_UN);fclose($lock);}
}
function app_drive_archive_resolve(array $doc,string $name,bool $signed=false): string {
    app_bound_file($doc,$name);
    $variant='original';$local=app_drive_archive_local($doc,$name,'original');$version=null;
    if($signed){
        $candidate=app_drive_archive_local($doc,$name,'signed');$remote=app_drive_archive_current((int)$doc['Doc_Id'],$name,'signed');
        if(is_file($candidate)||$remote){$variant='signed';$local=$candidate;$version=$remote;}
    }
    if(is_file($local))return $local;
    $version=$version??app_drive_archive_current((int)$doc['Doc_Id'],$name,$variant);
    if(!$version) return $local;
    // Pending uploads remain readable from their pinned immutable source.
    $source=app_drive_archive_directory('spool').'/'.$version['id'].'.source';
    if(is_file($source)&&hash_equals($version['revision'],hash_file('sha256',$source)))return $source;
    $quarantine=app_drive_archive_directory('quarantine').'/'.$version['id'].'.source';
    if(is_file($quarantine)&&hash_equals($version['revision'],hash_file('sha256',$quarantine)))return $quarantine;
    return app_drive_archive_restore($version);
}
function app_drive_archive_old_year(int $year,?int $current=null): bool {
    $current=$current??(int)date('Y')+543;return $year>=2400&&$year<$current-2;
}
// Refresh cache activity only for the already-open, authenticated inode. Use
// the cache sweeper/restorer's mutex without waiting under a document mutex.
// In particular, touch() must not recreate an empty file after a sweep.
function app_drive_archive_touch_cache(string $path, $handle): void {
    if (!is_resource($handle) || !preg_match('/^[a-f0-9]{64}\.plain$/D',basename($path))) return;
    $cache=app_drive_archive_directory('cache');
    if ($path!==$cache.'/'.basename($path)) return;
    $lock=@fopen(substr($path,0,-6).'.lock','c+b');
    if (!$lock) { error_log('Archive cache activity lock unavailable'); return; }
    try {
        if (!flock($lock,LOCK_EX|LOCK_NB)) return;
        clearstatcache(true,$path);
        if (!is_file($path)) return;
        $current=@stat($path);$opened=fstat($handle);
        if (!$current || !$opened || $current['dev']!==$opened['dev'] || $current['ino']!==$opened['ino']) return;
        if (!@touch($path)) error_log('Archive cache activity timestamp update failed');
    } finally { flock($lock,LOCK_UN);fclose($lock); }
}
function app_drive_archive_cache_sweep(): int {
    $cache=app_drive_archive_directory('cache');$removed=0;$files=[];$bytes=0;$ttl=max(60,(int)app_env('EOFFICE_DRIVE_CACHE_TTL','3600'));$limit=max(20971520,(int)app_env('EOFFICE_DRIVE_CACHE_BYTES','268435456'));
    foreach(glob($cache.'/*.plain')?:[] as $path){$files[$path]=filemtime($path);$bytes+=filesize($path);}asort($files);
    foreach($files as $path=>$mtime){if($mtime>=time()-$ttl&&$bytes<=$limit)continue;$lock=fopen(substr($path,0,-6).'.lock','c+b');if(!$lock)continue;
        try{if(flock($lock,LOCK_EX|LOCK_NB)){clearstatcache(true,$path);if(is_file($path)){
            // A reader may have refreshed this file since the sorted snapshot.
            if(filemtime($path)>=time()-$ttl&&$bytes<=$limit)continue;
            $size=filesize($path);if(@unlink($path)){$bytes-=$size;$removed++;}
        }}}finally{fclose($lock);}
    }return $removed;
}
