<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__.'/../config/bootstrap.php';
require __DIR__.'/../config/migrations.php';
app_migrate(app_pdo());
echo 'Migration complete: '.app_settings()['database'].PHP_EOL;
