<?php
if(PHP_SAPI!=='cli')exit;
require_once __DIR__.'/../config/drive-archive.php';
if(!app_settings()['mock']||!preg_match('/^drive_archive_[a-f0-9]+_test$/D',app_settings()['database']))throw new RuntimeException('Disposable cache fixture only');
$cache=app_drive_archive_directory('cache');$path=$cache.'/'.str_repeat('d',64).'.plain';
file_put_contents($path,'authenticated-cache-fixture');touch($path,time()-7200);clearstatcache();
$GLOBALS['sweep_refreshed_path']=$path;
// Exercise the real sweep, refreshing activity after it sampled the old mtime
// but before its nonblocking cache-lock acquisition finishes.
$source=file_get_contents(__DIR__.'/../config/drive-archive.php');
$start=strpos($source,'function app_drive_archive_cache_sweep(): int {');
eval('namespace CacheSweepFixture;'.substr($source,$start));
eval(<<<'PHP'
namespace CacheSweepFixture;
function flock($stream,$operation){
    $locked=\flock($stream,$operation);
    if($locked&&($operation&LOCK_EX)&&isset($GLOBALS['sweep_refreshed_path'])&&\stream_get_meta_data($stream)['uri']===substr($GLOBALS['sweep_refreshed_path'],0,-6).'.lock'){
        \touch($GLOBALS['sweep_refreshed_path']);unset($GLOBALS['sweep_refreshed_path']);
    }
    return $locked;
}
PHP);
try {
    CacheSweepFixture\app_drive_archive_cache_sweep();clearstatcache(true,$path);
    if(!is_file($path)||file_get_contents($path)!=='authenticated-cache-fixture')throw new RuntimeException('Sweep removed recently refreshed cache');
    echo "PASS sweep rechecks activity under the cache mutex instead of evicting from its stale mtime snapshot\n";
}finally{if(is_file($path))unlink($path);unset($GLOBALS['sweep_refreshed_path']);}
