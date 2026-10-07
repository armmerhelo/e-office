# Review fixes and verification

## Scope

Fixes address the review findings without changing Google authentication/onboarding behavior or the unrelated Boardcast system.

### Authorization after lock waits

- Document edits, receipt updates, read-status writes, deletion and signing acquire the document lock before validating current user/session/role and direct/group access.
- User/session/membership access uses committed locking reads. A revoke or logout completed during the lock wait prevents the pending write from recreating access.
- The group lock order matches administration writes (membership before group access).

### Attachment updates

- Existing attachment records are read after acquiring the document lock.
- Caption-only changes do not write a stale file path back into the database.
- The editor posts `file_version[]`; stale versions return HTTP 409. Older clients without that field still use current database paths rather than restoring deleted paths.
- Filesystem cleanup occurs after commit and outside rollback handling.
- Legacy cache writers serialize with signing and re-check document/file authorization. File responses hash and stream a single open inode.

### Public responses

- Public orders use a minimal, explicit response: document ID/number/year/title/type/date, public links/files and pagination.
- They do not return recipients, read/sign history, departments, internal receipt/action fields or upload record IDs, even if the caller happens to be logged in.

### Notifications

- Email and Push results are persisted separately in each outbox payload (`delivery.mail` / `delivery.push`).
- Successful SMTP delivery is not repeated when Push fails. A crashed/ambiguous SMTP attempt becomes `uncertain` and requires manual review.
- Push uses a persisted UUID `idempotency_key`, exponential backoff and provider Retry-After, stopping after five attempts. Uncertain retries outside the provider retention window require manual review.
- Legacy untracked/failed jobs are preserved for review instead of blindly re-sending email.
- Drive cleanup tasks are `manual`, mock traces are `recorded`, and neither can block document notification jobs at the head of the queue.
- Status index speeds pending-job selection; the worker has a per-run time budget. Staff processing API reports pending/manual/partial counts.

### Image submission

- Validate every image and optional form field before any external Drive upload. Invalid later images cannot orphan uploads from earlier images.
- External upload/DB failures still preserve orphan URLs in manual cleanup records.

## Verification

- `npm.cmd test`: workflow/API **42**, deterministic row-lock races **7**, notification failure/retry tests **17**, Google auth logic **55** plus HTTP/UI/onboarding tests, syntax and staged-secret detection tests pass.
- Race tests cover direct/group revocation, receipt/read writes after revoke, logout during sign, concurrent attachment replacement and optimistic conflict.
- Notification tests use isolated, connection-local temporary tables and injected mock transports, never real mail/Push recipients.
- Staging: run workflow and notification suites against MariaDB with mock services.
- Production: targeted file update, additive index migration and controlled smoke fixtures; temporary accounts/documents/endpoints are removed afterward.

## Final review / release results (8 October 2026)

- Reviewed each modified write path, transaction/lock ordering, public response whitelist, delivery progress persistence and retry selection after implementation.
- Second review also fixed cache/sign serialization and whole-batch image validation; the full local suite was repeated successfully.
- Staging MariaDB: **42 workflow/API tests** and **17 notification failure tests** pass.
- Production patch: checksum verification **135 application files**, no mismatches; **12 smoke tests** pass and their temporary user/document/files are removed.
- Final production counts remain 69 users, 14,491 documents, 12,244 attachment records, 24,684 access rows, 127 bookings and 13 maintenance requests; no temporary helper endpoints remain.
- No remaining known failure was found in the reviewed hotfix scenarios. Provider configuration (including the pre-existing www certificate issue) remains outside these code fixes.

Passing these checks validates the reviewed scenarios; it is not a guarantee that every possible failure mode is absent. Operational certificate/credential rotation and OAuth-provider setup are documented separately.
