<?php
if(PHP_SAPI!=='cli')exit;
ini_set('zend.exception_ignore_args','1');
require __DIR__.'/../config/backup-stream.php';
$key=base64_decode(getenv('EOFFICE_BACKUP_KEY')?:'',true);if($key===false||strlen($key)!==32)throw new RuntimeException('Private backup key required');
$action=$argv[1]??'';$input=$argv[2]??'';$output=$argv[3]??'';
if($action==='verify'){echo json_encode(app_backup_verify($input,$key),JSON_THROW_ON_ERROR).PHP_EOL;exit;}
if($action==='encrypt'){
    if($output===''||file_exists($output))throw new RuntimeException('New output path required');$temporary=$output.'.partial';
    $handle=$input==='-'?STDIN:fopen($input,'rb');if(!$handle)throw new RuntimeException('Input unavailable');
    try{$writer=new AppBackupWriter($temporary,$key,getenv('EOFFICE_BACKUP_ENCODING')?:'opaque');while(!feof($handle)){$bytes=fread($handle,65536);if($bytes===false)throw new RuntimeException('Input read failed');$writer->write($bytes);}$result=$writer->finish();if(is_file($output)||!rename($temporary,$output))throw new RuntimeException('Output cannot be published');echo json_encode($result).PHP_EOL;}
    catch(Throwable $e){$owned=isset($writer);unset($writer);if($owned&&is_file($temporary))unlink($temporary);throw $e;}
    finally{if($handle!==STDIN)fclose($handle);}exit;
}
if($action==='decrypt'){
    if($output===''||file_exists($output))throw new RuntimeException('New output path required');$temporary=$output.'.partial';
    $handle=fopen($temporary,'xb');if(!$handle)throw new RuntimeException('Output unavailable');chmod($temporary,0600);
    try{
        $result=app_backup_verify($input,$key,static function(string $bytes)use($handle):void{
            $offset=0;while($offset<strlen($bytes)){$count=fwrite($handle,substr($bytes,$offset));if($count===false||$count===0)throw new RuntimeException('Restore write failed');$offset+=$count;}
        });
        if(!fflush($handle))throw new RuntimeException('Restore flush failed');fclose($handle);$handle=null;
        if(file_exists($output)||!rename($temporary,$output))throw new RuntimeException('Restore publication failed');
        echo json_encode($result,JSON_THROW_ON_ERROR).PHP_EOL;
    }catch(Throwable $e){if(is_resource($handle))fclose($handle);if(is_file($temporary))unlink($temporary);throw $e;}
    exit;
}
throw new RuntimeException('Unknown encrypted-file operation');
