<?php
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require __DIR__.'/../config/services.php';
echo app_process_notifications()." jobs processed\n";
