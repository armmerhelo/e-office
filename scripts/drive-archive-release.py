"""Deploy only committed Drive archive files with rollback and disabled checks."""
import argparse,hashlib,importlib.util,io,json,secrets,subprocess,tarfile,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('production',Path(__file__).with_name('production-hosting.py'))
production=importlib.util.module_from_spec(spec);spec.loader.exec_module(production)
ROOT=production.hosting.ROOT
FILES=['config/drive-archive-client.php','config/drive-archive-schema.php','config/drive-archive.php','config/drive-archive-worker.php','config/database-backup.php','api/create_document.php','api/view_file.php','config/order-emails.php','e-sign/upload_pdf.php','scripts/drive-archive.php','scripts/restore-drive.php','scripts/drive-archive-cron.sh','api/drive_archive_status.php','management/drive_archive.html','assets/drive-archive-status.js']
def content(name):return subprocess.check_output(['git','show','HEAD:'+name],cwd=ROOT)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['deploy','verify','inspect']);args=parser.parse_args()
    account,_=production.credentials()
    with production.hosting.connect(account,'ftp.siya.ac.th') as ftp:
        production.hosting.webroot(ftp)
        if args.action=='inspect':
            details=[]
            for name in FILES:
                try:remote=production.hosting.retrieve(ftp,name)
                except Exception:continue
                try:local=content(name)
                except subprocess.CalledProcessError:continue
                details.append({'file':name,'matches_head':hashlib.sha256(remote).digest()==hashlib.sha256(local).digest()})
            print(json.dumps(details));return
        if args.action=='deploy':
            payload={name:content(name) for name in FILES}
            path=production.TEMP/('eoffice-drive-before-'+time.strftime('%Y%m%d-%H%M%S')+'.tar.gz');existing=[]
            with tarfile.open(path,'w:gz') as archive:
                for name in FILES:
                    try:body=production.hosting.retrieve(ftp,name)
                    except Exception:continue
                    entry=tarfile.TarInfo(name);entry.size=len(body);archive.addfile(entry,io.BytesIO(body));existing.append(name)
            production.TEMP.joinpath('eoffice-drive-rollback.private.json').write_text(json.dumps({'archive':str(path),'existing':existing,'new':[n for n in FILES if n not in existing]}),encoding='utf-8')
            for name in FILES:
                production.hosting.ensure_dir(ftp,str(Path(name).parent).replace('\\','/'))
                temporary=name+'.upload-'+secrets.token_hex(6);ftp.storbinary('STOR '+temporary,io.BytesIO(payload[name]));ftp.rename(temporary,name)
            key=secrets.token_hex(32)
            source=production.php(key)+"require __DIR__.'/config/drive-archive-schema.php';require __DIR__.'/config/drive-archive.php';if(app_settings()['database']!=='siyaacth_eoffice'||app_drive_archive_enabled())throw new RuntimeException('Expected disabled production feature');app_drive_archive_migrate(app_pdo());echo json_encode(['migrated'=>true,'enabled'=>app_drive_archive_enabled(),'eviction_enabled'=>filter_var(app_env('EOFFICE_DRIVE_EVICT_ENABLED','false'),FILTER_VALIDATE_BOOLEAN)]);"
            print(json.dumps({'rollback_archive':str(path),'rollback_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'schema':production.invoke(ftp,source,key)}))
        mismatches=[]
        for name in FILES:
            if hashlib.sha256(production.hosting.retrieve(ftp,name)).digest()!=hashlib.sha256(content(name)).digest():mismatches.append(name)
        print(json.dumps({'files_verified':len(FILES),'mismatches':mismatches}))
        if mismatches:raise RuntimeError('Drive archive release checksum mismatch')
        key=secrets.token_hex(32)
        source=production.php(key)+"require __DIR__.'/config/drive-archive.php';echo json_encode(['enabled'=>app_drive_archive_enabled(),'configured'=>app_drive_archive_configured(),'documents'=>(int)app_pdo()->query('SELECT COUNT(*) FROM t_document')->fetchColumn(),'registry_versions'=>(int)app_pdo()->query('SELECT COUNT(*) FROM eoffice_drive_versions')->fetchColumn()]);"
        print(json.dumps(production.invoke(ftp,source,key)))
if __name__=='__main__':main()
