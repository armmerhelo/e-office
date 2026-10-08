<?php
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require_once __DIR__.'/../config/order-emails.php';
try{echo app_order_worker()." order jobs processed\n";}
catch(Throwable $e){fwrite(STDERR,'Order worker failed ('.get_class($e).")\n");exit(1);}
