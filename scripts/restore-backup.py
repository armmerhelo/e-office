"""Authenticate/unpack a database archive; optional import into an empty _test DB."""
import argparse
import gzip
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHP = os.environ.get('PHP_BIN', 'C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe')

def unpack_database(archive, key_file, destination, database=None):
    keys = json.loads(Path(key_file).read_text(encoding='utf-8'))
    key = keys.get('backup_key') or keys.get('key_b64')
    if not key:
        raise RuntimeError('Backup key missing from private key vault')
    env = {**os.environ, 'EOFFICE_BACKUP_KEY': key}
    destination = Path(destination)
    if destination.exists():
        raise RuntimeError('Restore destination must not exist')
    destination.mkdir(mode=0o700)
    encrypted_stream = destination / 'database.jsonl.gz'
    jsonl = destination / 'database.jsonl'
    result = subprocess.run([PHP, str(ROOT / 'scripts/encrypted-file.php'), 'decrypt', str(archive), str(encrypted_stream)], env=env, capture_output=True, check=True)
    verified = json.loads(result.stdout)
    if verified['encoding'] != 'jsonl-gzip':
        raise RuntimeError('Not a database snapshot')
    tables = rows = 0
    started = ended = False
    try:
        # gzip.GzipFile reads concatenated gzip members produced by the backup.
        with gzip.open(encrypted_stream, 'rt', encoding='utf-8') as source, open(jsonl, 'x', encoding='utf-8', newline='\n') as output:
            os.chmod(jsonl, 0o600)
            for line in source:
                record = json.loads(line)
                kind = record.get('kind')
                if ended:
                    raise RuntimeError('Data after end record')
                if not started:
                    if kind != 'metadata' or record.get('version') not in (1, 2):
                        raise RuntimeError('Invalid snapshot metadata')
                    started = True
                elif kind == 'schema':
                    tables += 1
                elif kind == 'row':
                    rows += 1
                elif kind == 'end':
                    if record['tables'] != tables or record['rows'] != rows:
                        raise RuntimeError('Snapshot counts mismatch')
                    ended = True
                else:
                    raise RuntimeError('Unknown snapshot record')
                output.write(line)
        if not ended:
            raise RuntimeError('Incomplete database snapshot')
    except Exception:
        jsonl.unlink(missing_ok=True)
        raise
    if database:
        with open(jsonl, 'rb') as source:
            restored = subprocess.run([PHP, str(ROOT / 'scripts/restore-database.php')], stdin=source, env={**env, 'DB_DATABASE': database}, capture_output=True, check=True)
        return json.loads(restored.stdout)
    return {'verified': True, 'tables': tables, 'rows': rows, 'directory': str(destination)}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('archive')
    parser.add_argument('--key-file', required=True)
    parser.add_argument('--output', required=True, help='New, private recovery directory')
    parser.add_argument('--database', help='Import into an existing EMPTY isolated _test database')
    args = parser.parse_args()
    try:
        print(json.dumps(unpack_database(args.archive, args.key_file, args.output, args.database)))
    except Exception as error:
        # Avoid exposing SQL, personnel data or secrets from subprocess errors.
        raise SystemExit('Recovery failed (' + type(error).__name__ + '); any partial test database must be discarded') from None

if __name__ == '__main__':
    main()
