// Generates one paste-ready script without credentials or private Drive IDs.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const target=process.argv[2]||path.join(root,'integrations/google-drive/EOfficeDrive-Combined.gs');
if(!fs.statSync(path.dirname(target)).isDirectory())throw Error('Existing output directory required');
const source=['UnifiedDrive.gs','EOfficeArchive.gs'].map(name=>fs.readFileSync(path.join(root,'integrations/google-drive',name),'utf8')).join('\n\n');
const doPosts=[...source.matchAll(/function\s+doPost\s*\(/g)];const doGets=[...source.matchAll(/function\s+doGet\s*\(/g)];
if(doPosts.length!==1||doGets.length!==1)throw Error('Apps Script entrypoint collision');
fs.writeFileSync(target,source.replace(/\r\n/g,'\n'),'utf8');
console.log(JSON.stringify({generated:target,credentials_embedded:false,entrypoints:2}));
