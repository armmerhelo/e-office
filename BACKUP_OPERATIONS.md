# Production backup and operations

## Verified on 8 October 2026

- Google Login: the owner confirmed a successful sign-in using a normal browser.
- Push: OneSignal accepted a single explicitly selected browser subscription (HTTP 200); that browser received the matching notification ID.
- Drive: a synthetic PNG was uploaded to a separate test folder. Both the file and folder were subsequently moved to Trash.
- Encrypted database backup: **30 tables / 65,251 rows**, **2,200,908 bytes**. Archive SHA-256: `10bac5c2cdaa5c82df2248d1246590bd33323ca2d8c453363282a9bb462adea5`.
- Recovery drill: the actual downloaded database archive was authenticated, decompressed and imported into an empty isolated local `_test` database. All table/row counts matched. The temporary database and decrypted personnel data were removed.
- Full local `npm test` passed, including encryption, database recovery, protected scheduler dispatch and synthetic multi-part document recovery.

The document transfer covers the immutable **7 October deployment rollback snapshot**, **5,431 files / 7,128,788,382 bytes**. It **completed on 8 October 2026 at 15:53:52 workstation time**. A full recovery drill authenticated the manifest and every part, reconstructed all 5,431 files with the exact original byte count, and authenticated the supporting database/application archives. Decrypted drill files were removed after verification.

Completed set: `backups/snapshot-20261008-113251-900ad6f2`; private progress and recovery-drill records are in that directory. Its key vault is `backups/keys/snapshot-snapshot-20261008-113251-900ad6f2.key.private.json`. This snapshot predates subsequent production changes. Future transfers are complete only when private progress says `completed` and `manifest.ebak` is authenticated.

## Private settings and storage

Production `config/local.php` contains:

| Setting | Purpose |
| --- | --- |
| `EOFFICE_CRON_TOKEN` | 64 lowercase hexadecimal characters; authenticates the HTTP scheduler |
| `EOFFICE_BACKUP_KEY` | Base64-encoded random 32-byte backup master key |
| `EOFFICE_BACKUP_DIRECTORY` | Optional absolute directory outside the web root; defaults to the private storage parent's `backups` directory |

Existing production settings were preserved when the operations keys were added. Archives are created outside `public_html`, with `.partial` output and atomic publication. AES-256-GCM records authenticate the header, record order, contents and final size/hash. Each archive derives its own key from a fresh random salt.

Database snapshots require InnoDB tables and reject non-transactional engines. Keep schema migrations/DDL paused during capture. This format covers base-table schemas and rows; views, stored routines, triggers and DB grants must be inventoried/exported separately if introduced.

Local encrypted archives are stored in `backups/`. Private key vaults are in `backups/keys/`. Git ignores all contents except `backups/README.md`; staging/deployment scanners also exclude backup payloads, and HTTP access to `/backups` is denied. Preserve a protected copy of the keys on a separate device. Filesystem permissions on Windows should be restricted to the owner's account using Windows ACLs; POSIX mode bits alone do not provide that restriction.

## Hosting-panel Cron entries

The owner manages hosting-panel schedules. The existing **order-email** Cron is documented separately in [ORDER_EMAILS.md](ORDER_EMAILS.md#hosting-panel-cron-entry); the entries below cover ordinary notification processing and database backup.

The following curl configuration files already exist outside the web root with server permissions `0600`:

```text
/home/siyaacth/domains/e-office.siya.ac.th/private/operations/cron-notifications.curl
/home/siyaacth/domains/e-office.siya.ac.th/private/operations/cron-database-backup.curl
/home/siyaacth/domains/e-office.siya.ac.th/private/operations/cron-health.curl
```

They contain the Bearer token and JSON body. The token is not placed in the Cron command, query string or public file. HTTPS certificate verification remains enabled.

Confirm the host's curl executable path and hosting timezone. With `/usr/bin/curl` confirmed, enter:

```cron
*/5 * * * * /usr/bin/curl --config /home/siyaacth/domains/e-office.siya.ac.th/private/operations/cron-notifications.curl >> /home/siyaacth/domains/e-office.siya.ac.th/private/operations/notifications.log 2>&1
15 2 * * * /usr/bin/curl --config /home/siyaacth/domains/e-office.siya.ac.th/private/operations/cron-database-backup.curl >> /home/siyaacth/domains/e-office.siya.ac.th/private/operations/database-backup.log 2>&1
```

Run the health configuration once first. Require HTTP success, `database_reachable: true` and `backup_key_configured: true`. After saving each schedule, confirm a real scheduled run in its private log. The database worker rejects overlapping runs using an advisory lock. This document does not claim those two schedules have been saved in the panel.

If the host confirms a compatible PHP CLI path, the equivalent commands are:

```sh
/verified/path/to/php /home/siyaacth/domains/e-office.siya.ac.th/public_html/scripts/cron-health.php
/verified/path/to/php /home/siyaacth/domains/e-office.siya.ac.th/public_html/scripts/notifications.php
/verified/path/to/php /home/siyaacth/domains/e-office.siya.ac.th/public_html/scripts/backup.php
```

Use the same DB/storage/key configuration as the website. CLI health checks PHP 8.1+, PDO MySQL, mysqli, mbstring, fileinfo, GD, cURL, OpenSSL and zlib. Web `open_basedir` restrictions prevent reliable executable discovery from PHP HTTP requests; validate the CLI path from the hosting account/Cron itself.

## Off-host copies and resumable documents

From the project root on this workstation:

```powershell
python scripts/live-operations.py cron-backup
python scripts/live-operations.py fetch-database-backup
python scripts/live-operations.py store-backups
python scripts/offsite-snapshot.py status
```

Database copy commands use the current private operations key metadata. Archive SHA-256 and authenticated plaintext SHA-256 are checked before a local verification record is written.

The document worker uses verified FTPS on `ftp.siya.ac.th:2121`. It encrypts slices of at most 32 MiB, verifies them before committing the manifest, and resumes from the last committed offset. Complete transfers reuse the control connection; intentionally interrupted slices discard the connection. Network/protocol errors get three attempts per slice, then the job stops with verified parts retained.

```powershell
python scripts/offsite-snapshot.py stop
python scripts/offsite-snapshot.py resume
```

`stop` checks the recorded Windows worker identity before stopping it. Resume verifies saved archive checksums and replaces an uncommitted slice. Active job coordination lives in the approved temporary directory; durable, key-free progress is mirrored into the snapshot folder. Keep that coordination directory until the active transfer finishes. Recovery from a completed set uses the encrypted manifest and key vault, without temporary job state.

For supervised runs in terminals that clean up detached processes, use bounded foreground runs:

```powershell
python scripts/offsite-snapshot.py resume --foreground --seconds 600
```

The worker stops between committed slices with status `paused` when that budget expires; repeat the command until `completed`. An exclusive per-snapshot file lock prevents two workers from writing the same backup.

## Recovery

Recover into a new private local directory. These commands create decrypted sensitive data; remove it after the drill or completed recovery.

### Database JSONL archive

```powershell
python scripts/restore-backup.py "backups/<database-archive>.ebak" --key-file "backups/keys/eoffice-operations-keys.private.json" --output "backups/recovery-db"
```

This authenticates the complete archive, reads all concatenated gzip members, validates JSONL metadata and table/row counts, and produces `database.jsonl`. To exercise SQL recovery, create an empty local database ending in `_test`, set `DB_HOST`, `DB_PORT`, `DB_USERNAME` and `DB_PASSWORD` for that isolated server, and add `--database recovery_test`. The importer refuses production-style names and non-empty targets. Failed imports must be discarded; table creation is not transactionally reversible.

The automated local-only production archive drill is:

```powershell
python scripts/verify-offsite-database.py
```

It uses loopback port 3307 by default (`LOCAL_TEST_DB_PORT` overrides it), creates a uniquely named test database, verifies the actual saved snapshot, then deletes the test database and plaintext. `--cleanup-stale` removes only this tool's uniquely named stale drill databases/directories after an interrupted run.

### Document snapshot

After its status is `completed`:

```powershell
python scripts/restore-snapshot.py "backups/<snapshot-folder>" --key-file "backups/keys/<snapshot-key-vault>.private.json" --output "backups/recovery-documents"
```

The tool authenticates `manifest.ebak`, verifies each encrypted/plaintext checksum and contiguous offset, rejects unsafe paths, and reconstructs files into `file_document`. Only successful full recovery publishes `restore-completed.json`. Existing destinations are refused.

To repeat the full drill and remove reconstructed plaintext automatically (requires at least the snapshot size plus 128 MiB free disk space):

```powershell
python scripts/verify-offsite-snapshot.py "backups/<snapshot-folder>" --key-file "backups/keys/<snapshot-key-vault>.private.json"
```

Successful drills save a key-free private verification record in the completed snapshot folder.

The snapshot also includes `database.ebak` and `application.ebak`: these wrap the original deployment rollback database/application archives, rather than the newer JSONL database backup. Decrypt each using `scripts/encrypted-file.php decrypt` and the snapshot key supplied through `EOFFICE_BACKUP_KEY`, then inspect/import the original archive format on an isolated recovery system. Restore a consistent DB/application/document point in time and reconcile later changes before a production cutover.

## Retention and ongoing coverage

- Suggested retention: 7 daily, 4 weekly and 3 monthly verified database backups, plus a matched application/document/config recovery set for each production release.
- Copy completed archives to a second protected device/location; this workstation copy protects against host failure but still depends on its own disk.
- Retain old encryption keys as long as any retained archive uses them. Losing a key makes its archives unrecoverable.
- Remove old sets only after a replacement is fully verified and copied off-host. Do not apply retention to active `.partial` files or snapshots by age alone.
- No automatic pruning is enabled. Monitor private hosting backup disk usage and Cron logs.
- The deployment rollback snapshot is historical. Establish periodic fresh document/application/config snapshots alongside current database backups for continuing protection.

## Owner-managed SSL and credential rotation

1. In DirectAdmin, confirm DNS/hosting aliases for the canonical domain and `www.e-office.siya.ac.th`, then issue/renew a certificate covering every enabled HTTPS hostname. Verify HTTPS for the alias before relying on its canonical redirect; TLS happens before HTTP redirection.
2. Back up the current private configuration and record the replacement credentials in protected storage.
3. Rotate FTP, DB, SMTP, Google client secret, OneSignal REST key and other service credentials one service at a time. Update the hosting environment/private configuration and private workstation tooling metadata without overwriting unrelated settings.
4. Test DB access, normal Google Login and targeted service delivery after each change, then revoke the old credential.
5. If rotating the scheduler token, update all private `.curl` configurations together and verify health/scheduled runs.
6. Backup master keys and `EOFFICE_SETTINGS_KEY` are encryption keys: preserve historical backup keys; re-encrypt saved AI settings before retiring their settings key. Do not treat them as ordinary replace-and-forget API passwords.

SSL changes and credential rotation remain owner-managed; the steps above are prepared instructions.
