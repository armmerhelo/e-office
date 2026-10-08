const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const php = process.env.PHP_BIN || 'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe';
let phpCount = 0, jsCount = 0, inlineCount = 0, failures = [];
function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
        const file = path.join(dir,entry.name);
        if (entry.isDirectory()) { if (!['node_modules','test-results','file_document','backups','.git'].includes(entry.name)) walk(file); continue; }
        if (file.endsWith('.php')) {
            phpCount++;
            const r=cp.spawnSync(php,['-l',file],{encoding:'utf8'});
            if(r.status!==0)failures.push({file,error:r.stdout+r.stderr});
        }
        if (file.endsWith('.js') || file.endsWith('.cjs')) {
            jsCount++;
            const r=cp.spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
            if(r.status!==0)failures.push({file,error:r.stderr});
        }
        if(/\.(php|html)$/.test(file)){
            const text=fs.readFileSync(file,'utf8').replace(/<\?=[\s\S]*?\?>/g,'null').replace(/<\?php\s+echo[\s\S]*?\?>/g,'null').replace(/<\?php[\s\S]*?\?>/g,'').replace(/<!--[\s\S]*?-->/g,'');
            for(const m of text.matchAll(/<script\b([^>]*?)>([\s\S]*?)<\/script\s*>/gi)){
                if(/\bsrc\s*=/.test(m[1])||!/\S/.test(m[2])||/type="module"/.test(m[1]))continue;
                inlineCount++;
                try{new vm.Script(m[2],{filename:file});}catch(e){failures.push({file,error:e.message});}
            }
        }
    }
}
walk('.');console.log(JSON.stringify({phpCount,jsCount,inlineCount,failures},null,2));if(failures.length)process.exitCode=1;
