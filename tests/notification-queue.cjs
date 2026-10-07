const cp=require('node:child_process');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const env={...process.env,DB_DATABASE:process.env.TEST_DATABASE||'eoffice_review_test',EOFFICE_MOCK_SERVICES:'true'};
if(!env.DB_DATABASE.endsWith('_test'))throw Error('Only test databases allowed');
for(const file of ['scripts/migrate.php','tests/seed.php','tests/notification-queue.php']){
    const result=cp.spawnSync(php,[file],{env,encoding:'utf8'});
    if(file==='tests/notification-queue.php')process.stdout.write(result.stdout);
    if(result.status!==0)throw Error(result.stdout+result.stderr);
}
