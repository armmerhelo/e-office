const cp=require('node:child_process');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const result=cp.spawnSync(php,['tests/member-version.php'],{encoding:'utf8'});
process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
if(result.status!==0)process.exitCode=1;
