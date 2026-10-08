<?php
require_once __DIR__.'/bootstrap.php';

function app_drive_archive_configured(): bool {
    return (string)app_env('EOFFICE_DRIVE_ARCHIVE_URL')!==''&&preg_match('/^[a-f0-9]{64}$/',(string)app_env('EOFFICE_DRIVE_ARCHIVE_SECRET'))===1;
}
function app_drive_archive_call(array $payload): array {
    $secret=(string)app_env('EOFFICE_DRIVE_ARCHIVE_SECRET');$url=(string)app_env('EOFFICE_DRIVE_ARCHIVE_URL');
    if(!app_drive_archive_configured())throw new RuntimeException('Drive archive not configured');
    $parts=parse_url($url);
    if(($parts['scheme']??'')!=='https'||($parts['host']??'')!=='script.google.com'||!preg_match('#^/macros/s/[A-Za-z0-9_-]+/exec$#',$parts['path']??'')||isset($parts['user'])||isset($parts['port'])||isset($parts['query'])||isset($parts['fragment']))throw new RuntimeException('Invalid archive deployment URL');
    $encoded=base64_encode(json_encode($payload,JSON_THROW_ON_ERROR));$original=$url;$deadline=microtime(true)+90;
    // Follow ContentService's GET-only response redirect manually. Never forward
    // the signed request to an arbitrary redirect host or place secrets in URLs.
    for($attempt=0;$attempt<3;$attempt++){
      $url=$original;$timestamp=time();$nonce=bin2hex(random_bytes(16));
      $request=json_encode(['route'=>'eoffice-archive-v1','timestamp'=>$timestamp,'nonce'=>$nonce,'payload'=>$encoded,'signature'=>hash_hmac('sha256',$timestamp."\n".$nonce."\n".$encoded,$secret)],JSON_THROW_ON_ERROR);
      for($redirect=0;$redirect<3;$redirect++){
        $remaining=(int)ceil($deadline-microtime(true));if($remaining<=0)throw new RuntimeException('Drive archive request deadline exceeded');
        $location='';$body='';$ch=curl_init($url);
        curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>false,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>min(10,$remaining),CURLOPT_TIMEOUT=>min(45,$remaining),CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,
            CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_HTTPHEADER=>['Content-Type: application/json'],
            CURLOPT_HEADERFUNCTION=>static function($ch,$line)use(&$location){if(str_starts_with(strtolower($line),'location:'))$location=trim(substr($line,9));return strlen($line);},
            CURLOPT_WRITEFUNCTION=>static function($ch,$bytes)use(&$body){if(strlen($body)+strlen($bytes)>3*1024*1024)return 0;$body.=$bytes;return strlen($bytes);}]);
        if($redirect===0)curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$request]);
        $ok=curl_exec($ch);$status=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);
        if($ok===false){if($attempt<2)break;throw new RuntimeException('Drive archive transport unavailable');}
        if(in_array($status,[302,303],true)){
            $target=parse_url($location);
            // ContentService can expire/redirect its one-time response back to
            // the exact deployment. Restart a signed POST with a fresh nonce;
            // never GET the legacy route or forward a signature elsewhere.
            if($redirect>0&&$location===$original)break;
            if(($target['scheme']??'')!=='https'||($target['host']??'')!=='script.googleusercontent.com'||isset($target['user'])||isset($target['port']))throw new RuntimeException('Unexpected archive redirect');
            $url=$location;continue;
        }
        if(($redirect>0&&$status===404)||in_array($status,[429,500,502,503,504],true))break;
        $data=json_decode($body,true,32,JSON_THROW_ON_ERROR);
        if(is_array($data)&&($data['code']??'')==='busy')break;
        if($status!==200||!is_array($data)||($data['status']??'')!=='success')throw new RuntimeException('Drive archive request failed');
        return $data;
      }
      if($attempt<2)usleep(250000*($attempt+1));
    }
    throw new RuntimeException('Drive archive response unavailable after retries');
}
function app_drive_archive_put(string $bytes): string {
    $object=hash('sha256',$bytes);$data=app_drive_archive_call(['action'=>'put','object'=>$object,'data'=>base64_encode($bytes)]);
    if(($data['object']??'')!==$object||($data['sha256']??'')!==$object||($data['bytes']??null)!==strlen($bytes))throw new RuntimeException('Drive upload integrity mismatch');
    return $object;
}
function app_drive_archive_get(string $object): string {
    if(!preg_match('/^[a-f0-9]{64}$/',$object))throw new RuntimeException('Invalid archive object');
    $data=app_drive_archive_call(['action'=>'get','object'=>$object]);$bytes=base64_decode($data['data']??'',true);
    if($bytes===false||strlen($bytes)>2097152||($data['bytes']??null)!==strlen($bytes)||!hash_equals($object,hash('sha256',$bytes)))throw new RuntimeException('Drive download integrity mismatch');
    return $bytes;
}
