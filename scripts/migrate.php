<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
if (in_array('--test', $argv, true)) {
    $database=getenv('TEST_DATABASE');
    if(!is_string($database)||!preg_match('/^[A-Za-z0-9_]+_test$/D',$database)||getenv('EOFFICE_MOCK_SERVICES')!=='true') {
        fwrite(STDERR,"--test requires TEST_DATABASE ending in _test and EOFFICE_MOCK_SERVICES=true\n");exit(1);
    }
    putenv('DB_DATABASE='.$database);
} elseif(getenv('TEST_DATABASE')!==false && (getenv('DB_DATABASE')===false || getenv('DB_DATABASE')==='')) {
    fwrite(STDERR,"TEST_DATABASE is set but DB_DATABASE is missing. Use --test to migrate only the test database.\n");exit(1);
}
require __DIR__.'/../config/bootstrap.php';
require __DIR__.'/../config/migrations.php';
app_migrate(app_pdo());
echo 'Migration complete: '.app_settings()['database'].PHP_EOL;
