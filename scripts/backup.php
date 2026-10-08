<?php
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
ini_set('zend.exception_ignore_args','1');
require __DIR__.'/../config/database-backup.php';
echo json_encode(app_database_backup(),JSON_THROW_ON_ERROR).PHP_EOL;
