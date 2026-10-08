# Google Drive encrypted backup/archive

## Implemented policy

Keep the current Buddhist calendar document year plus the previous two years on the server. In 2569 this means 2567–2569; 2566 and earlier are candidates for Drive-only storage. Files on Drive are encrypted, and users continue through E-Office's existing URLs/permissions. Original files and signed variants have separate immutable revisions.

The feature and local eviction default to **off**. Installation requires a compatible authenticated Apps Script deployment and a verified first complete backup. The existing maintenance image adapter is not changed.

## Apps Script setup (owner action)

Source: `integrations/google-drive/EOfficeArchive.gs`.

1. Use the existing Google account. Create a private archive root folder with enough space. Avoid link-public sharing. Keep the encryption key outside Drive in protected recovery storage.
2. Add the `.gs` file to the existing Apps Script project and route `eoffice-archive-v1` requests to `eofficeArchiveHandle(e)` before the legacy handler. **Review the legacy source first:** its public list/delete/update actions must not expose or modify the archive root. The original `.gs` is not present in this repository, so that merge cannot be performed from E-Office alone.
3. If the legacy project's broad public API cannot be isolated, create a dedicated Apps Script project/deployment using the **same Google account and Drive**, with this entrypoint:

   ```javascript
   function doPost(e) { return eofficeArchiveHandle(e); }
   ```

4. Set Script Properties `EOFFICE_ARCHIVE_ROOT_ID` and `EOFFICE_ARCHIVE_SECRET`. The latter is a newly generated 64-character lowercase hex shared authentication secret, **not** the backup encryption key.
5. Deploy a Web App executing as the owner. Its URL can accept server requests; every archive operation is HMAC-authenticated. Put its `/exec` URL and matching authentication secret in E-Office private config.

Requests use HMAC SHA-256 over timestamp, nonce and base64 payload. The script verifies signatures, time windows and replay nonces, confines storage to the configured root, and names immutable objects by ciphertext SHA-256. Duplicate retry returns the existing object after checksum verification. There is no cloud deletion API. Apps Script receives ciphertext, not the encryption key.

The bridge handles 1 MiB plaintext slices (under 2 MiB ciphertext objects) to avoid large request bodies and long single executions. Apps Script still has execution/concurrency/storage quotas. Check the hosting runtime and Google's current quotas before setting batch sizes or claiming a daily completion SLA. The bridge's script-wide lock serializes object operations.

## E-Office setup

Private configuration:

```php
'EOFFICE_DRIVE_ARCHIVE_ENABLED' => 'false',
'EOFFICE_DRIVE_ARCHIVE_URL' => 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec',
'EOFFICE_DRIVE_ARCHIVE_SECRET' => '<64 lowercase hex>',
'EOFFICE_DRIVE_EVICT_ENABLED' => 'false',
'EOFFICE_DRIVE_EVICT_GRACE_DAYS' => '14',
```

Use the existing persistent `EOFFICE_BACKUP_KEY`. Retain old keys when rotating it; optional `EOFFICE_BACKUP_OLD_KEYS` is a JSON object mapping the old 16-character key ID to its base64 master key. Never place real keys in Git or Apps Script.

Run the additive registry migration once:

```sh
/verified/php /absolute/site/scripts/drive-archive.php migrate
```

After config and migration, enable `EOFFICE_DRIVE_ARCHIVE_ENABLED`, then run `health` and `worker`. Keep eviction off during the initial upload/recovery trial. File writers pin pending immutable revisions with private same-filesystem hard links before committing; ensure the spool is on the same filesystem as document storage.

Spool, bounded-TTL cache and recoverable quarantine are outside the web root, under the private storage parent's `drive-archive`. Cache defaults: 1 hour / 256 MiB; `EOFFICE_DRIVE_CACHE_TTL` and `EOFFICE_DRIVE_CACHE_BYTES` override those values. The worker performs cache/quarantine cleanup.

Admin status page: `/management/drive_archive.html`. Its API is Admin-only and does not return Drive credentials or ciphertext.

## Cron

Set these through the hosting panel after confirming its timezone and CLI launcher health:

```cron
*/5 * * * * /bin/sh /home/siyaacth/domains/e-office.siya.ac.th/public_html/scripts/drive-archive-cron.sh worker >> /home/siyaacth/domains/e-office.siya.ac.th/private/drive-archive-worker.log 2>&1
0 2 * * * /bin/sh /home/siyaacth/domains/e-office.siya.ac.th/public_html/scripts/drive-archive-cron.sh backup >> /home/siyaacth/domains/e-office.siya.ac.th/private/drive-archive-backup.log 2>&1
```

The worker scans existing documents in batches and captures changes from upload/sign transactions. Daily backup only completes after the first complete scan and when **every active document variant referenced by its DB snapshot is verified on Drive**. Pending files cause a failed/incomplete backup instead of a false success. A retry on that day uses the captured run manifest; if a daily job fails due to backlog, run the backup command again after the upload worker catches up. Inspect heartbeat/errors each day.

Daily recovery manifests are captured inside the same consistent transaction as DB backup. Ciphertext DB and manifest archives are uploaded and read back by SHA-256. A dated private bootstrap JSON file on Drive points to a content-addressed descriptor, allowing recovery without the lost server registry. Bootstrap metadata has object IDs/date only, no staff/document contents.

No automatic Drive retention or garbage collection is enabled: current Drive-only files and versions referenced by retained daily manifests must never be removed by backup age. A later retention job needs full reachability accounting before deleting cloud objects. This release keeps all cloud recovery sets.

## Enable server cleanup only after verification

Run a real cloud recovery drill first. Then set `EOFFICE_DRIVE_EVICT_ENABLED=true`.

Each local eviction requires: eligible document year, verified version older than at least 7 days (default 14), a complete cloud backup within 48 hours containing that exact version, fresh authenticated cloud read-back, unchanged file/hash/current mapping under the same document lock used by signing, and no active order analysis/send job. Shared legacy filenames are skipped. DB document/access/history rows remain. Signing after eviction first retrieves the current revision and checks it under the document lock before saving.

Files move to a one-day private quarantine before final cleanup. A crash before the DB commit leaves a recoverable file; the worker restores uncommitted quarantines under document lock. New edits/signatures are pinned and queued again instead of reusing old cloud content.

Opening Drive-only files validates permission again after the cloud fetch. Full AEAD/footer/checksum verification happens before plaintext publication. Cloud failure returns a temporary error; it does not fall back to an unrelated legacy/demo file. PDF byte-range requests and document revision headers remain supported.

## Recovery without the old DB

On an isolated machine configure the bridge URL/authentication secret and retained backup keys, then:

```sh
php scripts/restore-drive.php 2026-10-08 /new/private/recovery-directory
```

The tool reads the dated checkpoint, authenticates the encrypted DB/manifest archives and reconstructs original/signed documents with verified hashes. It does **not** import into the production database. Use `scripts/restore-backup.py` with the recovered `database.ebak` to import into an empty isolated `_test` database. Only a complete cloud reconstruction publishes `restore-completed.json`. Partial recovery directories contain sensitive plaintext and must be removed after a failed/completed drill.

## Remaining activation dependency

The Apps Script owner's source/deployment access is needed to install the authenticated handler and configure Script Properties. Merely reusing the old maintenance `DRIVE_APPS_SCRIPT_URL` will not enable this protocol. Daily cloud backup/eviction must not be reported as active until a real Apps Script health, upload/download and recovery drill succeeds and the hosting Cron entries are confirmed.
