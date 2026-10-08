# AMSS import — second review

Reviewed on 8 October 2026 against the deployed `3b7a620` importer.

## Reproduced findings and fixes

1. **Attachment-limit bypass / uneditable documents.** An edit retaining 20 existing files could import an additional AMSS PDF, save 21 attachments successfully, and then fail its next ordinary edit with `Invalid files`. The controller now counts retained attachments, new uploads and imported PDFs together before downloading and again after acquiring the document lock. The normal limit is 20. Legacy documents already above that limit remain editable but cannot grow further.
2. **Valid URL normalization rejected at the API boundary.** The helper accepted uppercase `HTTPS:` and trimmed surrounding whitespace, but the controller rejected both before invoking it. Validation now trims links and compares a normalized scheme. Missing/mismatched link-caption indices are rejected explicitly.
3. **External downloads held database locks.** Instrumentation reproduced a concurrent document write timing out with MySQL error 1205 while the importer was downloading. Downloads now complete into automatically cleaned `tmpfile()` handles before opening a write transaction. Authentication, owner/Admin authorization, attachment identities, supplied file revisions and the final attachment count are checked again under the document lock before permanent file or database changes. A complete-list replacement also conflicts if attachments were added/deleted during the download, preventing deletion of newly added files. Failed imports and aborted requests do not leave staged files in document storage.
4. **Deployment tooling did not support subsequent API hotfixes.** The original merge supported first-time installation only and rejected a changed API when AMSS was already installed. The merge now accepts exact known committed API versions, preserves the deployed order-email integration and rejects unknown concurrent edits. Offline tests cover idempotency, upgrading an earlier importer, retaining order hooks and rejecting unexpected changes.

## Verification

```powershell
npm.cmd run test:amss -- --live
python tests/amss-release.py
npm.cmd run test:integration
npm.cmd run test:races
npm.cmd run test:orders
```

The live AMSS tests use disposable databases and temporary storage, and include an isolated test router that observes the real controller's download boundary. The router requires both the mock-service flag and an `eoffice_amss_<pid>_test` database; it is not deployed. Tests exercise limit boundaries, legacy documents, concurrent attachment growth/replacement, session revocation during download, rollback and integration with the AI order queue.

Production deployment and verification use `scripts/amss-release.py`, with SHA-256 checks and a targeted private backup. Its production smoke creates an Internal document without recipients and removes the synthetic user/session/document/attachment afterward.
