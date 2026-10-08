<?php
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../config/bootstrap.php';
putenv('EOFFICE_DRIVE_ARCHIVE_URL=https://script.google.com/macros/s/SYNTHETIC_DEPLOYMENT/exec');putenv('EOFFICE_DRIVE_ARCHIVE_SECRET='.str_repeat('a',64));
eval('namespace DriveClientFixture;use \RuntimeException;'.substr(str_replace("require_once __DIR__.'/bootstrap.php';",'',file_get_contents(__DIR__.'/../config/drive-archive-client.php')),5));
eval(<<<'PHP'
namespace DriveClientFixture;
function curl_init($url){$ch=new \stdClass();$ch->url=$url;$ch->options=[];return $ch;}
function curl_setopt_array($ch,$options){$ch->options=array_replace($ch->options,$options);return true;}
function curl_exec($ch){
 $response=array_shift($GLOBALS['responses']);if(!$response)throw new \RuntimeException('Unexpected transport call');
 $GLOBALS['requests'][]=['url'=>$ch->url,'post'=>$ch->options[CURLOPT_POSTFIELDS]??null];$ch->status=$response['status'];
 if(isset($response['location']))($ch->options[CURLOPT_HEADERFUNCTION])($ch,'Location: '.$response['location']."\r\n");
 $body=$response['body']??'';if($body!=='')($ch->options[CURLOPT_WRITEFUNCTION])($ch,$body);return true;
}
function curl_getinfo($ch,$type){return $ch->status;}
function curl_close($ch){}
PHP);
$original='https://script.google.com/macros/s/SYNTHETIC_DEPLOYMENT/exec';$content='https://script.googleusercontent.com/macros/echo?synthetic=1';
$GLOBALS['requests']=[];$GLOBALS['responses']=[['status'=>302,'location'=>$content],['status'=>302,'location'=>$original],['status'=>302,'location'=>$content],['status'=>404,'body'=>'expired'],['status'=>302,'location'=>$content],['status'=>200,'body'=>'{"status":"success","protocol":1}']];
$result=DriveClientFixture\app_drive_archive_call(['action'=>'health']);if($result['protocol']!==1)throw new RuntimeException('Retry did not recover response');
$nonces=[];foreach($GLOBALS['requests'] as $request)if($request['post']){$json=json_decode($request['post'],true);$nonces[]=$json['nonce'];if($request['url']!==$original)throw new RuntimeException('Signature forwarded to another host');}
if(count($nonces)!==3||count(array_unique($nonces))!==3)throw new RuntimeException('Retry must use a fresh nonce');
echo "PASS expired ContentService responses retry signed POST with fresh nonces; signatures never forwarded\n";
foreach(['https://accounts.google.com/signin','https://example.com/','https://script.google.com/macros/s/OTHER/exec'] as $target){
 $GLOBALS['requests']=[];$GLOBALS['responses']=[['status'=>302,'location'=>$content],['status'=>302,'location'=>$target]];$rejected=false;
 try{DriveClientFixture\app_drive_archive_call(['action'=>'health']);}catch(RuntimeException $e){$rejected=true;}
 if(!$rejected||count($GLOBALS['requests'])!==2)throw new RuntimeException('Unexpected redirect accepted');
}
echo "PASS auth/untrusted/other-deployment redirects rejected without following them\n";
