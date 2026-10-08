<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/backup-stream.php';
$dir=sys_get_temp_dir().'/opencode';if(!is_dir($dir))mkdir($dir,0700,true);
$prefix=$dir.'/encrypted-test-'.bin2hex(random_bytes(8));$key=random_bytes(32);$data=random_bytes(140000).str_repeat('Eoffice backup fixture ',9000);$passed=0;
function check_backup(bool $ok,string $name): void {global $passed;if(!$ok)throw new RuntimeException('FAIL '.$name);echo 'PASS '.$name.PHP_EOL;$passed++;}
function rejects_backup(callable $test,string $name): void {try{$test();}catch(Throwable $e){check_backup(true,$name);return;}throw new RuntimeException('FAIL '.$name);}
try{
    $writer=new AppBackupWriter($prefix,$key,'test');$writer->write(substr($data,0,100));$writer->write(substr($data,100));$writer->finish();unset($writer);$plain='';
    $result=app_backup_verify($prefix,$key,static function($chunk)use(&$plain){$plain.=$chunk;});
    check_backup($result['verified']&&$plain===$data,'chunked encrypted backup round-trip');
    check_backup(!str_contains(file_get_contents($prefix),'Eoffice backup fixture'),'ciphertext contains no fixture plaintext');
    rejects_backup(static fn()=>app_backup_verify($prefix,random_bytes(32)),'wrong key rejected');
    $bytes=file_get_contents($prefix);$tampered=$bytes;$tampered[100]=chr(ord($tampered[100])^1);file_put_contents($prefix.'.bad',$tampered);
    rejects_backup(static fn()=>app_backup_verify($prefix.'.bad',$key),'header tampering rejected');
    $tampered=$bytes;$tampered[strlen($tampered)-100]=chr(ord($tampered[strlen($tampered)-100])^1);file_put_contents($prefix.'.bad',$tampered);
    rejects_backup(static fn()=>app_backup_verify($prefix.'.bad',$key),'ciphertext tampering rejected');
    file_put_contents($prefix.'.bad',substr($bytes,0,-20));rejects_backup(static fn()=>app_backup_verify($prefix.'.bad',$key),'truncated backup rejected');
    file_put_contents($prefix.'.bad',$bytes.'tail');rejects_backup(static fn()=>app_backup_verify($prefix.'.bad',$key),'trailing data rejected');
    $writer=new AppBackupWriter($prefix.'.empty',$key);$writer->finish();unset($writer);check_backup(app_backup_verify($prefix.'.empty',$key)['bytes']===0,'empty archive authenticated');
    putenv('EOFFICE_BACKUP_KEY='.base64_encode($key));
    $cli=static function(array $args):int{$process=proc_open(array_merge([PHP_BINARY,__DIR__.'/../scripts/encrypted-file.php'],$args),[['file','NUL','r'],['file','NUL','w'],['file','NUL','w']],$pipes);return proc_close($process);};
    check_backup($cli(['decrypt',$prefix,$prefix.'.restored'])===0&&file_get_contents($prefix.'.restored')===$data,'CLI restores authenticated bytes atomically');
    check_backup($cli(['decrypt',$prefix.'.bad',$prefix.'.rejected'])!==0&&!file_exists($prefix.'.rejected')&&!file_exists($prefix.'.rejected.partial'),'invalid archive never publishes restored plaintext');
    file_put_contents($prefix.'.reserved.partial','other worker');
    check_backup($cli(['encrypt',$prefix.'.empty',$prefix.'.reserved'])!==0&&file_get_contents($prefix.'.reserved.partial')==='other worker','encryption preserves another worker partial');
    check_backup($cli(['decrypt',$prefix,$prefix.'.restored'])!==0&&file_get_contents($prefix.'.restored')===$data,'restore refuses existing destination');
    file_put_contents($prefix.'.publish.partial','encrypted fixture');file_put_contents($prefix.'.publish','concurrent owner');
    rejects_backup(static fn()=>app_backup_publish($prefix.'.publish.partial',$prefix.'.publish'),'atomic publication rejects concurrent destination');
    check_backup(file_get_contents($prefix.'.publish')==='concurrent owner'&&file_get_contents($prefix.'.publish.partial')==='encrypted fixture','publication never replaces the competing file');
    echo "Encrypted backup: $passed passed\n";
}finally{foreach([$prefix,$prefix.'.bad',$prefix.'.empty',$prefix.'.restored',$prefix.'.reserved.partial',$prefix.'.publish.partial',$prefix.'.publish'] as $file)if(is_file($file))unlink($file);}
