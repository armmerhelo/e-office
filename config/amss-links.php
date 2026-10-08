<?php
// Import direct AMSS PDFs as document-bound attachments, never as an open proxy.
class AppAmssException extends RuntimeException {}

function app_amss_pdf_url(string $url): ?string {
    $url=trim($url);$parts=parse_url($url);
    if(!$parts||!filter_var($url,FILTER_VALIDATE_URL)
        ||strtolower($parts['host']??'')!=='amss.sesact.go.th'
        ||!in_array(strtolower($parts['scheme']??''),['http','https'],true)
        ||isset($parts['user'])||isset($parts['pass'])
        ||(isset($parts['port'])&&$parts['port']!==(strtolower($parts['scheme'])==='http'?80:443))
        ||strtolower(pathinfo(rawurldecode($parts['path']??''),PATHINFO_EXTENSION))!=='pdf')return null;
    // Legacy HTTP links are fetched over verified HTTPS too.
    return 'https://amss.sesact.go.th'.($parts['path']??'').(isset($parts['query'])?'?'.$parts['query']:'');
}

function app_amss_public_ip(string $ip): bool {
    if(filter_var($ip,FILTER_VALIDATE_IP,FILTER_FLAG_IPV4|FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)===false)return false;
    $bytes=array_map('intval',explode('.',$ip));
    // PHP 8.1's range flags omit shared, benchmarking and documentation networks.
    if($bytes[0]===100&&$bytes[1]>=64&&$bytes[1]<=127)return false;
    if($bytes[0]===169&&$bytes[1]===254)return false;
    if($bytes[0]===192&&($bytes[1]===0||($bytes[1]===88&&$bytes[2]===99)))return false;
    if($bytes[0]===198&&($bytes[1]===18||$bytes[1]===19||($bytes[1]===51&&$bytes[2]===100)))return false;
    if($bytes[0]===203&&$bytes[1]===0&&$bytes[2]===113)return false;
    return $bytes[0]<224;
}

function app_amss_validate_pdf(string $body): void {
    if(strlen($body)>20*1024*1024)throw new AppAmssException('ไฟล์ PDF จาก AMSS เกิน 20 MB');
    if(!str_starts_with($body,'%PDF-')||(new finfo(FILEINFO_MIME_TYPE))->buffer($body)!=='application/pdf'
        ||!str_contains(substr($body,-2048),'%%EOF'))
        throw new AppAmssException('ลิงก์ AMSS ไม่ได้ส่งไฟล์ PDF ที่สมบูรณ์ กรุณาตรวจสอบลิงก์ไฟล์โดยตรง');
}

function app_amss_download_pdf(string $url, int $timeout = 30): string {
    $url=app_amss_pdf_url($url);
    if($url===null)throw new AppAmssException('ลิงก์ไฟล์ PDF จาก AMSS ไม่ถูกต้อง');
    if(!function_exists('curl_init'))throw new AppAmssException('เซิร์ฟเวอร์ยังไม่พร้อมดาวน์โหลด PDF จาก AMSS');
    $ips=gethostbynamel('amss.sesact.go.th');
    if(!$ips)throw new AppAmssException('ไม่สามารถเชื่อมต่อ AMSS กรุณาลองใหม่');
    foreach($ips as $ip)if(!app_amss_public_ip($ip))throw new AppAmssException('ที่อยู่เซิร์ฟเวอร์ AMSS ไม่ถูกต้อง');
    $body='';$tooLarge=false;$ch=curl_init($url);
    curl_setopt_array($ch,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,
        CURLOPT_PROXY=>'',CURLOPT_RESOLVE=>['amss.sesact.go.th:443:'.$ips[0]],
        CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,
        CURLOPT_CONNECTTIMEOUT=>min(10,$timeout),CURLOPT_TIMEOUT=>$timeout,
        CURLOPT_HTTPHEADER=>['Accept: application/pdf'],CURLOPT_USERAGENT=>'E-Office AMSS PDF Import',
        CURLOPT_WRITEFUNCTION=>static function($ch,string $chunk)use(&$body,&$tooLarge):int {
            if(strlen($body)+strlen($chunk)>20*1024*1024){$tooLarge=true;return 0;}
            $body.=$chunk;return strlen($chunk);
        }]);
    $ok=curl_exec($ch);$status=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);$error=curl_errno($ch);curl_close($ch);
    if($tooLarge)throw new AppAmssException('ไฟล์ PDF จาก AMSS เกิน 20 MB');
    if($ok===false){error_log('AMSS PDF download failed: curl '.$error);throw new AppAmssException('ดาวน์โหลด PDF จาก AMSS ไม่สำเร็จ กรุณาลองใหม่');}
    if($status!==200)throw new AppAmssException('AMSS ไม่ส่งไฟล์ PDF (HTTP '.$status.') กรุณาตรวจสอบลิงก์ไฟล์โดยตรง');
    app_amss_validate_pdf($body);return $body;
}
