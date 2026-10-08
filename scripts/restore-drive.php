<?php
// Offline cloud recovery: reconstruct encrypted DB + all document variants.
// Reads Drive via Apps Script; never imports into or modifies the source DB.
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
ini_set('zend.exception_ignore_args','1');
require __DIR__.'/../config/drive-archive.php';
$date=$argv[1]??'';$root=$argv[2]??'';
if(!preg_match('/^\d{4}-\d{2}-\d{2}$/D',$date)||$root===''||file_exists($root))throw new RuntimeException('Date and NEW private recovery directory required');
if(!mkdir($root,0700,true))throw new RuntimeException('Recovery directory unavailable');
function drive_restore_write($handle,string $bytes): void {$offset=0;while($offset<strlen($bytes)){$n=fwrite($handle,substr($bytes,$offset));if(!$n)throw new RuntimeException('Recovery write failed');$offset+=$n;}}
try{
    $run=app_drive_archive_call(['action'=>'run','date'=>$date]);$descriptor=json_decode(app_drive_archive_get($run['descriptor']),true,32,JSON_THROW_ON_ERROR);
    if(($descriptor['version']??null)!==1||($descriptor['date']??'')!==$date)throw new RuntimeException('Invalid recovery descriptor');
    $key=app_drive_archive_key($descriptor['key_id']);
    foreach(['database','manifest'] as $label){
        $metadata=$descriptor['archives'][$label];$target=$root.'/'.$label.'.ebak';$handle=fopen($target.'.partial','xb');if(!$handle)throw new RuntimeException('Recovery write unavailable');chmod($target.'.partial',0600);
        try{foreach($metadata['parts'] as $id)drive_restore_write($handle,app_drive_archive_get($id));if(!fflush($handle))throw new RuntimeException('Recovery flush failed');}finally{fclose($handle);}
        if(filesize($target.'.partial')!==$metadata['bytes']||!hash_equals($metadata['sha256'],hash_file('sha256',$target.'.partial')))throw new RuntimeException('Recovery archive mismatch');
        app_backup_verify($target.'.partial',$key);app_backup_publish($target.'.partial',$target);
    }
    $manifest='';app_backup_verify($root.'/manifest.ebak',$key,static function($bytes)use(&$manifest){if(strlen($manifest)+strlen($bytes)>64*1024*1024)throw new RuntimeException('Manifest too large');$manifest.=$bytes;});
    $manifest=json_decode($manifest,true,128,JSON_THROW_ON_ERROR);$count=0;
    foreach($manifest['documents'] as $document){
        $year=$document['year'];$name=$document['name'];$variant=$document['variant'];$doc=(int)$document['doc_id'];
        if(!preg_match('/^\d{4}$/D',$year)||$name!==basename($name)||str_contains($name,'\\')||str_contains($name,':')||$doc<=0||!in_array($variant,['original','signed'],true))throw new RuntimeException('Unsafe restore filename');
        $version=$manifest['versions'][$document['version']];$parts=app_drive_archive_parts($version);$fileKey=app_drive_archive_key($version['key_id']);
        $directory=$root.'/file_document/'.($variant==='signed'?'e-sign':'original').'/'.$year;if(!is_dir($directory)&&!mkdir($directory,0700,true))throw new RuntimeException('Restore directory unavailable');
        $target=$directory.'/'.($variant==='signed'?'signed_'.$doc.'_':'').$name;
        if(is_file($target)){if(hash_file('sha256',$target)===$version['revision'])continue;throw new RuntimeException('Conflicting recovery identity');}
        $out=fopen($target.'.partial','xb');if(!$out)throw new RuntimeException('Restore file unavailable');chmod($target.'.partial',0600);$hash=hash_init('sha256');$total=0;
        try{
            foreach($parts as $part){
                $encrypted=$root.'/part.ebak';$bytes=app_drive_archive_get($part['object']);if(file_put_contents($encrypted,$bytes)!==strlen($bytes))throw new RuntimeException('Restore write failed');chmod($encrypted,0600);
                $result=app_backup_verify($encrypted,$fileKey,static function($plain)use($out,$hash,&$total){drive_restore_write($out,$plain);hash_update($hash,$plain);$total+=strlen($plain);});
                if($result['bytes']!==$part['bytes']||$result['sha256']!==$part['sha256'])throw new RuntimeException('Restore part mismatch');unlink($encrypted);
            }
            if($total!==(int)$version['bytes']||hash_final($hash)!==$version['revision']||!fflush($out))throw new RuntimeException('Restore file mismatch');
        }finally{fclose($out);}
        app_backup_publish($target.'.partial',$target);$count++;
    }
    $result=['restored'=>true,'date'=>$date,'files'=>$count,'database_archive'=>$root.'/database.ebak'];
    file_put_contents($root.'/restore-completed.json',json_encode($result,JSON_THROW_ON_ERROR));echo json_encode($result,JSON_THROW_ON_ERROR).PHP_EOL;
}catch(Throwable $e){fwrite(STDERR,'Drive recovery failed ('.get_class($e).'); no completion marker published'.PHP_EOL);exit(1);}
