# Google Drive encrypted backup/archive

## Implemented policy

Keep the current Buddhist calendar document year plus the previous two years on the server. In 2569 this means 2567–2569; 2566 and earlier are candidates for Drive-only storage. Files on Drive are encrypted, and users continue through E-Office's existing URLs/permissions. Original files and signed variants have separate immutable revisions.

The feature and local eviction default to **off**. Installation requires a compatible authenticated Apps Script deployment and a verified first complete backup. The existing maintenance image adapter is not changed.

## Apps Script setup (owner action)

Source: `integrations/google-drive/EOfficeArchive.gs`.

1. Use the existing Google account. Create a private archive root folder with enough space. Avoid link-public sharing. Keep the encryption key outside Drive in protected recovery storage.
2. The original `appscript.gs` has now been reviewed and merged. Use `UnifiedDrive.gs` plus `EOfficeArchive.gs` in the same project, replacing its existing `doGet`/`doPost` file. Do not leave duplicate entrypoints or the old unrestricted helper functions. Set `EOFFICE_LEGACY_ROOT_ID` to the previous maintenance root ID. Legacy read/create/update/delete now require an item beneath that root and cannot access the archive.
3. If the legacy project's broad public API cannot be isolated, create a dedicated Apps Script project/deployment using the **same Google account and Drive**, with this entrypoint:

   ```javascript
   function doPost(e) { return eofficeArchiveHandle(e); }
   ```

4. Set Script Properties `EOFFICE_LEGACY_ROOT_ID`, `EOFFICE_ARCHIVE_ROOT_ID` and `EOFFICE_ARCHIVE_SECRET`. The archive root must be a separate private sibling outside the legacy root: equal, nested or ancestor roots fail closed. The secret is a newly generated 64-character lowercase hex shared authentication secret, **not** the backup encryption key.
5. Deploy a Web App with **Execute as: Me** and **Who has access: Anyone**, so the hosting server can call it without an interactive Google sign-in. Archive operations are HMAC-authenticated and legacy operations are limited to their existing root. If organizational policy disallows this access setting, the deployment needs a different authenticated server integration before activation. Put its `/exec` URL and matching authentication secret in E-Office private config.

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

Activation uses the already configured five-minute `order-cron.sh` entry: the launcher now calls `scripts/scheduled-jobs.php`, which runs the existing order worker, then the bounded Drive queue independently. After 02:00 Asia/Bangkok it checks the current day's cloud backup and retries when initial synchronization is ready. An overlapping run uses the existing per-worker locks. Separate Drive Cron entries are therefore optional; avoid adding duplicate schedules unless intentionally changing this arrangement.

The initial scan also imports missing document-bound bytes from the existing trusted legacy host, with fixed HTTPS URL/MIME/size limits. Downloads occur outside document locks and are installed only if the same attachment remains bound and its local path is still absent. Current files are never overwritten. Pending uploads are throttled to avoid unbounded spool growth; signed legacy copies are captured when they differ from originals.

ContentService responses sometimes expire (404) or redirect back to the exact deployment URL. The client retries the original signed POST with a fresh nonce and a total request budget; it never follows a sign-in/foreign host or forwards authentication to a redirected endpoint. Each ciphertext slice is read back and compared before committing its upload manifest.

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

### Paste-ready merged script

```sh
node scripts/build-drive-appscript.cjs
python scripts/drive-archive-configure.py prepare
```

The builder produces `integrations/google-drive/EOfficeDrive-Combined.gs`, with exactly one `doGet`/`doPost` and no embedded credentials/folder IDs. It is generated and Git-ignored. Paste it in place of the old Apps Script code, removing duplicate old entrypoints/helpers from other `.gs` files.

The prepare command records the existing deployment URL, original maintenance root ID and a persistent authentication secret in `backups/keys/drive-appscript-setup.private.json`. Keep this private; do not paste the secret into chat or Git. Copy the three `script_properties` values into Apps Script Project Settings, replacing the archive-folder placeholder with the new private sibling folder ID.

Save a new Apps Script version and update the existing Web App deployment to that version (same `/exec` URL). Then run:

```sh
python scripts/drive-archive-configure.py configure
```

Configuration is written to production only after the actual signed private bridge health check succeeds. It preserves other site settings and keeps upload/eviction disabled pending a real cloud recovery trial. If the owner changes the deployment URL, update the private handoff file first.

## Installation results — 8 October 2026

- Server implementation commit `0bff3b0`: 15 targeted files deployed and verified against committed bytes with no checksum mismatches.
- Four additive registry/run/state tables installed in production; activation and local eviction remain **false**, no Drive objects uploaded or production files archived.
- Local archive behavior: 19 checks pass with a mocked object store, including late upload after replacement and incomplete-snapshot rejection, plus HTTP permission/range/revision, Drive-only signing and Apps Script HMAC/idempotency/checkpoint tests. Existing full `npm test` passes.
- Production synthetic smoke: 8 checks pass for guest rejection, authorized PDF/revision, Range, HEAD, protected Admin status, signature save and signed-file delivery. Temporary account/document/files were removed; no staff notifications sent.
- Rollback archive: `eoffice-drive-before-20261008-193707.tar.gz` in the approved temporary directory; SHA-256 `f4a1f9064fd1dbc3bf8f995a4fcb2fb300b052832530c3e53d96b24431f7afa9`.
- The original `.gs` source has now been received and merged. Actual Apps Script installation/version deployment, real cloud recovery and hosting Cron activation remain pending.
