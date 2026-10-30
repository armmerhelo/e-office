const cp=require('node:child_process');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
cp.execFileSync(php,['tests/inbox-cutoff.php'],{env:process.env,stdio:'inherit'});
