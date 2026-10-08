<?php
// Development server router. Match Apache's private-path restrictions.
if (PHP_SAPI !== 'cli-server') { http_response_code(404); exit; }
$path=rawurldecode(parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH));
header('X-Content-Type-Options: nosniff');header('X-Frame-Options: SAMEORIGIN');
if(preg_match('#^/e-sign/(?:generated_images|uploads)/.*\.(?:php[0-9]?|phtml|phar|html|svg|js)$#i',$path)){http_response_code(403);exit('Forbidden');}
if(str_contains($path,'..')||preg_match('#^/(config|scripts|tests|test-results|backups|file_document|src/.*\.php|email_send/backup)(/|$)#i',$path)||preg_match('#^/email_send/User_Data.*\.json$#i',$path)||preg_match('#^/e-sign/e-sign(?:-v1|_backup|_error|_6_10_69)\.php$#',$path)) { http_response_code(403);exit('Forbidden'); }
return false;
