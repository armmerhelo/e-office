<?php
// Only this disposable local server substitutes the external Drive transport.
namespace DriveReadFixture;
require_once __DIR__.'/../config/drive-archive.php';
if(PHP_SAPI!=='cli-server'||!\app_settings()['mock']||!preg_match('/^drive_archive_[a-f0-9]+_test$/D',\app_settings()['database'])||getenv('EOFFICE_DRIVE_HTTP_FIXTURE')!=='1'){http_response_code(404);exit;}

function app_document_file_lock(int $id) { return \app_document_file_lock($id,0.25); }
function app_drive_archive_restore(array $version): string {
    return \app_drive_archive_restore($version,static function(string $object): string {
        $directory=dirname(\app_settings()['storage']).'/mock-cloud';
        if(file_put_contents($directory.'/requests',$object."\n",FILE_APPEND)===false)throw new \RuntimeException('Fixture request counter unavailable');
        if(isset($_GET['pause_cloud'])){
            if(file_put_contents($directory.'/waiting','ready')===false)throw new \RuntimeException('Fixture marker unavailable');
            $deadline=microtime(true)+15;
            while(!is_file($directory.'/release')){if(microtime(true)>$deadline)throw new \RuntimeException('Fixture cloud wait timeout');usleep(20000);clearstatcache();}
        }
        $path=$directory.'/'.$object.'.ebak';
        $bytes=file_get_contents($path);if($bytes===false)throw new \RuntimeException('Fixture cloud part unavailable');return $bytes;
    });
}

$path=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH);
if($path==='/api/view_file.php'){
    $source=file_get_contents(__DIR__.'/../api/view_file.php');
    $source=str_replace("__DIR__.'/../config/drive-archive.php'",var_export(realpath(__DIR__.'/../config/drive-archive.php'),true),$source);
    eval('namespace DriveReadFixture;use \\Throwable;use \\finfo;'.substr($source,5));
    return true;
}
return require __DIR__.'/../scripts/router.php';
