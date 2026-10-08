# Backup/recovery review — 8 October 2026

## Fixed findings

1. **Historical timestamp loss:** MySQL marks normal default-expression columns with `DEFAULT_GENERATED`. Recovery previously omitted every column containing `GENERATED`, replacing stored dates with defaults. Only actual virtual/stored generated columns are now omitted.
2. **Binary snapshot failure:** arbitrary BLOB bytes cannot always be represented as UTF-8 JSON. JSONL v2 records explicitly tagged base64 cells; the importer decodes them. v1 archives remain supported.
3. **Timezone and ID drift:** timestamps were exported in the source session timezone without recording it, and auto-increment ID `0` could become a new ID. New snapshots use explicit UTC and recovery enables `NO_AUTO_VALUE_ON_ZERO`.
4. **Publication race:** checking existence before `rename` could still replace a destination created between those operations. Backup and plaintext publication now use exclusive hard-link creation.
5. **Resume trust:** a saved manifest's filenames, offsets, lengths and plaintext digest were not fully revalidated before skipping/downloading. Resume now checks every saved slice against canonical filenames and authenticated contents.
6. **Shared worker state:** a per-snapshot lock alone did not protect the single shared job-state file from another snapshot start. Job preparation and workers now share a coordination lock; workers retain the per-snapshot lock. Managed stop recognizes foreground workers, and detached runs receive the configured pause budget.
7. **Unbuffered DB failure cleanup:** an active SELECT cursor could obstruct rollback/lock release after a serialization failure. Backup closes the cursor first and restores its DB session settings.

## Verification

- Authenticated archive regression: **14 passed**, including concurrent publication rejection with both competing files preserved.
- Database fixtures restore binary bytes, original default timestamps, computed values, NULLs and auto-increment ID zero exactly; capture in a different DB session timezone preserves the same instants. Non-InnoDB capture fails safely and releases its advisory lock.
- The actual saved **v1 production archive** still restores **30 tables / 65,251 rows** in an isolated local database; decrypted data and the test database are removed after verification.
- Scheduler authentication/cross-site/action dispatch, synthetic multi-part recovery, FTPS EOF/control-session handling, worker exclusivity and invalid resume-manifest cases pass.
- Project PHP/JavaScript syntax and changed Python compilation checks pass.

Production deployment uses a targeted rollback archive and checksum verification for server-side files. Python transfer/recovery tools are workstation utilities. Operational instructions: [BACKUP_OPERATIONS.md](BACKUP_OPERATIONS.md).
