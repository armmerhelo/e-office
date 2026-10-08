// Read the staged Git blobs, not the working tree. Never print secret values.
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const files = cp.execFileSync('git', ['diff','--cached','--name-only','--diff-filter=ACMR','-z']).toString().split('\0').filter(Boolean);
const credentialFile = process.env.EOFFICE_CREDENTIAL_FILE || path.resolve('..', 'e-office ftp and db.txt');
const secrets = fs.existsSync(credentialFile)
    ? [...fs.readFileSync(credentialFile,'utf8').matchAll(/password\s*:\s*(\S+)/gi)].map(match => match[1]).filter(value => value.length >= 6)
    : [];
const errors = [];
const forbidden = /^(?:config\/local\.php|email_send\/(?:User_Data.*\.json|backup\/)|e-sign\/uploads\/|e-sign\/generated_images\/(?!\.htaccess$)|file_document\/(?!\.htaccess$)|node_modules\/|test-results\/|backups\/(?!README\.md$))|(?:^|\/)\.env(?:\.|$)|\.private\./i;
const keyPatterns = [
    /\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/,
    /\bAIza[A-Za-z0-9_-]{30,}/,
    /\bAQ\.[A-Za-z0-9_-]{20,}/,
    /\bGOCSPX-[A-Za-z0-9_-]{20,}/,
    /\bos_v2_app_[a-z0-9]{30,}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
for (const file of files) {
    if (forbidden.test(file)) errors.push({file,reason:'private/runtime file'});
    const blob = cp.execFileSync('git', ['show', ':' + file], {maxBuffer:64*1024*1024});
    if (secrets.some(secret => blob.includes(Buffer.from(secret)))) errors.push({file,reason:'matches a supplied credential'});
    const text = blob.toString('utf8');
    if (keyPatterns.some(pattern => pattern.test(text))) errors.push({file,reason:'embedded private key/token'});
}
console.log(JSON.stringify({stagedFiles:files.length,credentialValuesChecked:secrets.length,errors},null,2));
if (errors.length) process.exitCode=1;
