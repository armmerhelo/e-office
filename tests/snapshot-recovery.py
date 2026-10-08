"""Offline recovery test: ordered multi-part document, empty file, corruption."""
import base64
import hashlib
import importlib.util
import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('restore', ROOT / 'scripts/restore-snapshot.py')
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)
temp = Path(tempfile.gettempdir()) / 'opencode'
with tempfile.TemporaryDirectory(prefix='snapshot-recovery-', dir=temp) as directory:
    folder = Path(directory)
    key = base64.b64encode(os.urandom(32)).decode()
    vault = folder / 'key.private.json'
    vault.write_text(json.dumps({'key_b64': key}), encoding='utf-8')
    env = {**os.environ, 'EOFFICE_BACKUP_KEY': key}
    def encrypt(data, name):
        source = folder / 'input'
        source.write_bytes(data)
        archive = folder / name
        process = subprocess.run([restore.PHP, str(ROOT / 'scripts/encrypted-file.php'), 'encrypt', str(source), str(archive)], env=env, capture_output=True, check=True)
        return json.loads(process.stdout)
    original = os.urandom(80000)
    parts = []
    for index, data in enumerate([original[:40000], original[40000:]]):
        name = f'{index}.ebak'
        result = encrypt(data, name)
        parts.append({'archive': name, 'offset': index * 40000, 'length': len(data), 'archive_sha256': restore.digest(folder / name), 'plaintext_sha256': result['sha256']})
    result = encrypt(b'', 'empty.ebak')
    manifest = {'version': 1, 'snapshot': '/home/example/private/rollback/file_document', 'entries': [
        {'remote': '/private/rollback/file_document/nested/document.pdf', 'size': len(original), 'parts': parts},
        {'remote': '/private/rollback/file_document/empty', 'size': 0, 'parts': [{'archive': 'empty.ebak', 'offset': 0, 'length': 0, 'archive_sha256': restore.digest(folder / 'empty.ebak'), 'plaintext_sha256': result['sha256']}]}
    ]}
    encrypt(json.dumps(manifest).encode(), 'manifest.ebak')
    destination = folder / 'restored'
    result = restore.restore_snapshot(folder, vault, destination)
    assert result == {'restored': True, 'files': 2, 'bytes': len(original)}
    assert (destination / 'file_document/nested/document.pdf').read_bytes() == original
    assert (destination / 'file_document/empty').read_bytes() == b''
    (folder / '1.ebak').write_bytes(b'corrupt')
    try:
        restore.restore_snapshot(folder, vault, folder / 'rejected')
        raise AssertionError('Corrupted snapshot accepted')
    except RuntimeError:
        assert not (folder / 'rejected/restore-completed.json').exists()
    manifest['entries'][0]['remote']='/private/rollback/file_document/../escape.pdf'
    (folder/'manifest.ebak').unlink();encrypt(json.dumps(manifest).encode(),'manifest.ebak')
    try:
        restore.restore_snapshot(folder,vault,folder/'unsafe')
        raise AssertionError('Unsafe snapshot path accepted')
    except RuntimeError:
        assert not (folder/'escape.pdf').exists()
    print('PASS multi-part/empty document recovery, chroot mapping, and corrupted-part rejection')
