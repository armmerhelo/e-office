<?php
require_once __DIR__.'/siya-news.php';
function app_siya_news_drive_enabled(): bool {return filter_var(app_env('EOFFICE_SIYA_NEWS_DRIVE_ENABLED','false'),FILTER_VALIDATE_BOOLEAN);}
function app_siya_news_drive_configured(): bool {try{app_siya_news_drive_credentials();return true;}catch(Throwable $e){return false;}}
function app_siya_news_drive_credentials(): array {
    $url=(string)app_env('EOFFICE_SIYA_NEWS_DRIVE_URL')?: (string)app_env('EOFFICE_DRIVE_ARCHIVE_URL');
    $secret=(string)app_env('EOFFICE_SIYA_NEWS_DRIVE_SECRET');
    $parts=parse_url($url);
    if(!$url||!preg_match('/^[a-f0-9]{64}$/D',$secret)||!$parts||($parts['scheme']??'')!=='https'||($parts['host']??'')!=='script.google.com'||!preg_match('#^/macros/s/[A-Za-z0-9_-]+/exec$#D',$parts['path']??'')||isset($parts['user'])||isset($parts['port'])||isset($parts['query'])||isset($parts['fragment']))throw new RuntimeException('SIYA NEWS Drive bridge not configured');
    return [$url,$secret];
}
function app_siya_news_drive_call(array $payload): array {
    [$original,$secret]=app_siya_news_drive_credentials();$encoded=base64_encode(json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR));
    $deadline=microtime(true)+150;
    for($attempt=0;$attempt<3;$attempt++){
        $url=$original;$timestamp=time();$nonce=bin2hex(random_bytes(16));
        $route='eoffice-news-v1';$request=json_encode(['route'=>$route,'timestamp'=>$timestamp,'nonce'=>$nonce,'payload'=>$encoded,'signature'=>hash_hmac('sha256',$route."\n".$timestamp."\n".$nonce."\n".$encoded,$secret)],JSON_THROW_ON_ERROR);
        if(strlen($request)>40*1024*1024)throw new RuntimeException('SIYA NEWS Drive request too large');
        for($redirect=0;$redirect<3;$redirect++){
            $remaining=(int)ceil($deadline-microtime(true));if($remaining<=0)break;
            $location='';$body='';$ch=curl_init($url);
            curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>false,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>min(15,$remaining),CURLOPT_TIMEOUT=>min(90,$remaining),CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,
                CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_HTTPHEADER=>['Content-Type: application/json'],
                CURLOPT_HEADERFUNCTION=>static function($ch,$line)use(&$location){if(str_starts_with(strtolower($line),'location:'))$location=trim(substr($line,9));return strlen($line);},
                CURLOPT_WRITEFUNCTION=>static function($ch,$bytes)use(&$body){if(strlen($body)+strlen($bytes)>32*1024*1024)return 0;$body.=$bytes;return strlen($bytes);}]);
            if($redirect===0)curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$request]);
            $ok=curl_exec($ch);$status=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);
            if($ok===false)break;
            if(in_array($status,[302,303],true)){
                $target=parse_url($location);
                if($redirect>0&&$location===$original)break;
                if(($target['scheme']??'')!=='https'||($target['host']??'')!=='script.googleusercontent.com'||isset($target['user'])||isset($target['port']))throw new RuntimeException('Unexpected SIYA NEWS Drive redirect');
                $url=$location;continue;
            }
            if(in_array($status,[404,429,500,502,503,504],true))break;
            $data=json_decode($body,true,32,JSON_THROW_ON_ERROR);
            if(($data['status']??'')!=='success'){
                if(in_array($data['code']??'', ['busy','storage_failed'],true))break;
                throw new RuntimeException('SIYA NEWS Drive request failed');
            }
            return $data;
        }
        if($attempt<2)usleep(500000*($attempt+1));
    }
    throw new RuntimeException('SIYA NEWS Drive service temporarily unavailable');
}
function app_siya_news_drive_health(): array {return app_siya_news_drive_call(['action'=>'health']);}
function app_siya_news_drive_put_part(string $asset,int $index,string $bytes): array {
    $sha=hash('sha256',$bytes);$result=app_siya_news_drive_call(['action'=>'put-part','asset'=>$asset,'index'=>$index,'bytes'=>strlen($bytes),'sha256'=>$sha,'data'=>base64_encode($bytes)]);
    if(!is_string($result['file_id']??null)||$result['bytes']!==strlen($bytes)||!hash_equals($sha,(string)$result['sha256']))throw new RuntimeException('SIYA NEWS Drive upload verification failed');
    return ['file_id'=>$result['file_id'],'bytes'=>strlen($bytes),'sha256'=>$sha];
}
function app_siya_news_drive_get_part(string $asset,int $index,array $part): string {
    if(!is_string($part['file_id']??null)||$part['file_id']==='')throw new RuntimeException('SIYA NEWS Drive file reference unavailable');
    $result=app_siya_news_drive_call(['action'=>'get-part','asset'=>$asset,'index'=>$index,'file_id'=>$part['file_id'],'bytes'=>(int)$part['bytes'],'sha256'=>$part['sha256']]);
    $bytes=base64_decode($result['data']??'',true);
    if($bytes===false||strlen($bytes)!==(int)$part['bytes']||!hash_equals($part['sha256'],hash('sha256',$bytes))||!hash_equals($part['sha256'],(string)($result['sha256']??'')))throw new RuntimeException('SIYA NEWS Drive image integrity check failed');
    return $bytes;
}
function app_siya_news_drive_image_bytes(array $image): string {
    $parts=json_decode($image['drive_parts']??'null',true,32,JSON_THROW_ON_ERROR);
    if(!is_array($parts)||!array_is_list($parts)||!$parts)throw new RuntimeException('SIYA NEWS Drive manifest unavailable');
    $out='';$index=0;$offset=0;foreach($parts as $part){if(!is_array($part)||($part['offset']??null)!==$offset||!is_int($part['bytes']??null)||$part['bytes']<1||$part['bytes']>524288||!preg_match('/^[a-f0-9]{64}$/D',$part['sha256']??''))throw new RuntimeException('SIYA NEWS Drive manifest invalid');$chunk=app_siya_news_drive_get_part($image['id'],$index++,$part);$out.=$chunk;$offset+=strlen($chunk);if(strlen($out)>(int)$image['bytes'])throw new RuntimeException('SIYA NEWS Drive manifest size mismatch');}
    if(strlen($out)!==(int)$image['bytes']||!hash_equals($image['sha256'],hash('sha256',$out)))throw new RuntimeException('SIYA NEWS Drive image integrity check failed');
    return $out;
}
function app_siya_news_image_bytes(array $image): string {
    $path=app_siya_news_image_path($image['id'],$image['extension']);
    if(is_file($path)){$bytes=@file_get_contents($path);if(is_string($bytes)&&strlen($bytes)===(int)$image['bytes']&&hash_equals($image['sha256'],hash('sha256',$bytes)))return $bytes;if(!in_array(($image['storage_state']??''),['archived','remote'],true))throw new RuntimeException('SIYA NEWS local image integrity check failed');}
    if(!in_array(($image['storage_state']??''),['archived','remote'],true))throw new AppSiyaNewsError('ภาพยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ',503);
    try{return app_siya_news_drive_image_bytes($image);}catch(Throwable $e){error_log('SIYA NEWS Drive image retrieval failed ('.get_class($e).')');throw new AppSiyaNewsError('ดึงภาพจาก Google Drive ไม่สำเร็จชั่วคราว กรุณาลองใหม่',503);}
}
function app_siya_news_materialize_image(array $image): string {
    if((int)$image['bytes']<1||(int)$image['bytes']>20*1024*1024)throw new RuntimeException('SIYA NEWS image size invalid');
    $target=tempnam(app_siya_news_root(),'export-image-');if($target===false)throw new RuntimeException('SIYA NEWS temporary image unavailable');@chmod($target,0600);
    $out=@fopen($target,'wb');if(!$out){@unlink($target);throw new RuntimeException('SIYA NEWS temporary image unavailable');}
    $hash=hash_init('sha256');$written=0;
    try{
        $local=app_siya_news_image_path($image['id'],$image['extension']);
        $localVerified=is_file($local)&&filesize($local)===(int)$image['bytes']&&hash_equals($image['sha256'],hash_file('sha256',$local));
        if($localVerified){
            $in=@fopen($local,'rb');if(!$in)throw new RuntimeException('SIYA NEWS local image unavailable');
            try{while(!feof($in)){$chunk=fread($in,262144);if($chunk===false)throw new RuntimeException('SIYA NEWS local image read failed');if($chunk===''){if(feof($in))break;throw new RuntimeException('SIYA NEWS local image read failed');}$written+=strlen($chunk);if($written>(int)$image['bytes'])throw new RuntimeException('SIYA NEWS local image size mismatch');hash_update($hash,$chunk);$offset=0;while($offset<strlen($chunk)){$n=fwrite($out,substr($chunk,$offset));if($n===false||$n===0)throw new RuntimeException('SIYA NEWS temporary image write failed');$offset+=$n;}}}finally{fclose($in);}
        }else{
            if(!in_array(($image['storage_state']??''),['archived','remote'],true))throw new AppSiyaNewsError('ภาพยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ',503);
            $parts=json_decode($image['drive_parts']??'null',true,32,JSON_THROW_ON_ERROR);if(!is_array($parts)||!array_is_list($parts)||!$parts)throw new RuntimeException('SIYA NEWS Drive manifest unavailable');
            $offset=0;foreach($parts as $index=>$part){if(!is_array($part)||($part['offset']??null)!==$offset||!is_int($part['bytes']??null)||$part['bytes']<1||$part['bytes']>524288||$offset+$part['bytes']>(int)$image['bytes']||!is_string($part['file_id']??null)||!preg_match('/^[a-f0-9]{64}$/D',$part['sha256']??''))throw new RuntimeException('SIYA NEWS Drive manifest invalid');$chunk=app_siya_news_drive_get_part($image['id'],$index,$part);hash_update($hash,$chunk);$length=strlen($chunk);$position=0;while($position<$length){$n=fwrite($out,substr($chunk,$position));if($n===false||$n===0)throw new RuntimeException('SIYA NEWS temporary image write failed');$position+=$n;}$written+=$length;$offset+=$length;unset($chunk);}
        }
        if(!fflush($out)||$written!==(int)$image['bytes']||!hash_equals($image['sha256'],hash_final($hash)))throw new RuntimeException('SIYA NEWS image integrity check failed');
        fclose($out);$out=null;return $target;
    }catch(Throwable $e){if(is_resource($out))fclose($out);@unlink($target);throw $e;}
}
