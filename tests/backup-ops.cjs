const cp=require('node:child_process');
const php=process.env.PHP_BIN||'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
const stream=cp.spawnSync(php,['tests/backup-stream.php'],{encoding:'utf8'});process.stdout.write(stream.stdout);if(stream.status!==0)throw Error(stream.stdout+stream.stderr);
for(const file of ['tests/database-backup.cjs','tests/database-backup-cases.cjs','tests/cron.cjs']){const result=cp.spawnSync(process.execPath,[file],{encoding:'utf8'});process.stdout.write(result.stdout);if(result.status!==0)throw Error(result.stdout+result.stderr);}
const snapshot=cp.spawnSync('python',['tests/snapshot-recovery.py'],{encoding:'utf8'});process.stdout.write(snapshot.stdout);if(snapshot.status!==0)throw Error(snapshot.stdout+snapshot.stderr);
const transfer=cp.spawnSync('python',['tests/offsite-transfer.py'],{encoding:'utf8'});process.stdout.write(transfer.stdout);if(transfer.status!==0)throw Error(transfer.stdout+transfer.stderr);
