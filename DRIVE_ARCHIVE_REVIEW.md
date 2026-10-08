# Drive archive live review — 8 October 2026

## Confirmed defects and fixes

1. **Cached plaintext could mask lost/corrupted cloud bytes.** Upload completion now checkpoints an authenticated remote read-back for every encrypted slice. Old pending checkpoints without that marker are re-read and upgraded. Fresh verification/eviction explicitly bypasses cache under its mutex; a failed remote check preserves the previous valid cache and the local original.
2. **FIFO retry could starve the queue.** Each version now stores attempts, retry time and error code. Temporary Google failures back off from five minutes to six hours; healthy/unattempted uploads can proceed. Source/key/manifest integrity failures become `review`, retaining pinned/local bytes rather than silently accepting or repeatedly blocking later files.
3. **Snapshots could pair a stale signed pointer with newer signing metadata.** The snapshot checks the signed ledger revision and canonical document/name/variant/version identity. Missing local legacy signatures count as incomplete even if no modern ledger row exists.
4. **A same-day leftover envelope could belong to a different captured DB snapshot.** Retries authenticate the saved manifest and compare its bytes/hash with the persisted capture; the encrypted DB checksum and authenticated stream hash must match the same captured metadata before upload/checkpoint publication.
5. **Crash quarantine could overwrite a concurrent recreated path.** Recovery publishes exclusively; a duplicate identical quarantine is cleaned up safely instead of permanently blocking a later eviction.
6. **Recovery mappings were not cross-checked against authenticated version identity.** Both recovery tools now check document ID, attachment name, variant and canonical version hash. Existing checksum/AEAD/path restrictions still apply.

## Verification

- `tests/drive-review.php` runs inside an isolated synthetic database/object-store fixture. The archive behavior suite has **44 passing checks**, including missing cloud bytes with warm cache, checkpoint upgrade, failed eviction preserving bytes, healthy-file progress behind retry/broken files, backoff/idempotency, additive migration without data loss, and mismatched daily snapshot pairs.
- Existing archive HTTP permission/revision/range/signing tests and Apps Script authentication/root-isolation tests pass.
- Backup encryption/database recovery regressions and project syntax checks pass. No private production documents/keys are committed or printed.

## Operation after this review

- Recurring server synchronization remains enabled; eviction remains disabled while the initial scan/recovery set is incomplete.
- `review` versions require repairing the pinned source, retaining the required key or restoring the immutable Drive object as appropriate. Then run the CLI-only `php scripts/drive-archive.php retry <version-id>` command. It refuses a missing/changed pinned source and acquires the normal archive worker lock.
- A database-only daily set is never promoted to a complete document recovery set, and never satisfies eviction's complete-backup guard.
- No Apps Script redeployment is required for these PHP/queue fixes. The existing 1 MiB slice/encrypted object protocol is retained.

Detailed setup/activation: [GOOGLE_DRIVE_ARCHIVE.md](GOOGLE_DRIVE_ARCHIVE.md).
