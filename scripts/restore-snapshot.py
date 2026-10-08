"""Verify and reconstruct an encrypted deployment document snapshot offline."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
PHP = os.environ.get('PHP_BIN', 'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe')

def digest(path):
    value = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(1048576), b''):
            value.update(chunk)
    return value.hexdigest()

def decrypt(source, destination, env):
    process = subprocess.run([PHP, str(ROOT / 'scripts/encrypted-file.php'), 'decrypt', str(source), str(destination)], env=env, capture_output=True, check=True)
    return json.loads(process.stdout)

def restore_snapshot(folder, key_file, destination):
    folder, destination = Path(folder), Path(destination)
    key = json.loads(Path(key_file).read_text(encoding='utf-8'))['key_b64']
    env = {**os.environ, 'EOFFICE_BACKUP_KEY': key}
    if destination.exists():
        raise RuntimeError('Restore destination must not exist')
    destination.mkdir(mode=0o700)
    metadata = destination / 'snapshot-manifest.private.json'
    decrypt(folder / 'manifest.ebak', metadata, env)
    manifest = json.loads(metadata.read_text(encoding='utf-8'))
    if manifest.get('version') != 1:
        raise RuntimeError('Unsupported snapshot manifest')
    remote_root = manifest.get('ftp_snapshot', manifest['snapshot'])
    # Version-1 snapshots created before ftp_snapshot was recorded use a
    # chroot-relative /private path in their entries.
    if 'ftp_snapshot' not in manifest and '/private/' in remote_root:
        remote_root = '/private/' + remote_root.split('/private/', 1)[1]
    prefix = remote_root.rstrip('/') + '/'
    work = destination / '.restore-work'
    work.mkdir(mode=0o700)
    files = total = 0
    try:
        for entry in manifest['entries']:
            if not entry['remote'].startswith(prefix):
                raise RuntimeError('Unexpected snapshot path')
            relative = entry['remote'][len(prefix):]
            path = PurePosixPath(relative)
            if not relative or path.is_absolute() or '\\' in relative or ':' in relative or any(p in ('', '.', '..') or p.endswith((' ', '.')) for p in relative.split('/')):
                raise RuntimeError('Unsafe restore path')
            target = destination / 'file_document' / Path(*path.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            # New directory and exclusive creation prevent replacing existing files.
            temporary = work / 'file.partial'
            offset = 0
            with open(temporary, 'xb') as output:
                os.chmod(temporary, 0o600)
                if not entry['parts']:
                    raise RuntimeError('Missing snapshot parts')
                for part in entry['parts']:
                    name = part['archive']
                    if Path(name).name != name or '/' in name or '\\' in name or ':' in name or not name.endswith('.ebak'):
                        raise RuntimeError('Unsafe archive path')
                    if part['offset'] != offset or part['length'] < 0 or offset + part['length'] > entry['size']:
                        raise RuntimeError('Invalid snapshot offsets')
                    archive = folder / name
                    if digest(archive) != part['archive_sha256']:
                        raise RuntimeError('Encrypted part checksum mismatch')
                    plain = work / 'part'
                    result = decrypt(archive, plain, env)
                    if result['bytes'] != part['length'] or result['sha256'] != part['plaintext_sha256']:
                        raise RuntimeError('Authenticated part mismatch')
                    with open(plain, 'rb') as source:
                        shutil.copyfileobj(source, output, 1048576)
                    plain.unlink()
                    offset += part['length']
            if offset != entry['size']:
                raise RuntimeError('Incomplete document')
            # Hard-link publication is exclusive even for case-insensitive duplicates.
            os.link(temporary, target)
            temporary.unlink()
            files += 1
            total += offset
        result = {'restored': True, 'files': files, 'bytes': total}
        (destination / 'restore-completed.json').write_text(json.dumps(result), encoding='utf-8')
        return result
    finally:
        shutil.rmtree(work)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('folder')
    parser.add_argument('--key-file', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(restore_snapshot(args.folder, args.key_file, args.output)))
    except Exception as error:
        raise SystemExit('Snapshot recovery failed (' + type(error).__name__ + '); no completion marker was published') from None

if __name__ == '__main__':
    main()
