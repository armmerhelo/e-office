# Agent Notes

## Project Shape
- This folder is a standalone PHP/browser tool, not a packaged app: there is no `package.json`, Composer file, CI config, or local test runner here.
- `e-sign.php` is the main UI and contains the PHP parameter handling plus all HTML/CSS/JS for PDF viewing, drawing, stamping, saving, and downloading.
- `upload_pdf.php` is the save endpoint; it requires `../config/config.php` and assumes the parent app provides `$conn`, `get_name_from_id()`, `get_target_from_id()`, and `mail_sender()`.

## Runtime Coupling
- `e-sign.php` expects query params `Doc_Id`, `File_Path`, `Year`, and optional `url`.
- PDFs load first from `../api/view_file.php?Type=signed&Year=...&File_Path=...`, then fall back to `../api/cors.php?url=...`, then a built-in demo PDF.
- Browser dependencies include PDF.js `4.10.38` (module), PDF-lib `1.17.1`, Lucide and Google Font `Sarabun`. PDF-lib preserves original page dimensions and text while adding drawing overlays.
- The default stamp image is `e-stamp/template_stamp.png`; custom stamp previews are generated client-side on a canvas.

## Save/Upload Behavior
- `saveToServer()` posts a generated PDF blob to `upload_pdf.php` with `file`, `year`, and `Doc_Id` form fields.
- Uploaded PDFs use `EOFFICE_STORAGE/e-sign/$Year/signed_{Doc_Id}_{original-basename}`. A mandatory SHA-256 revision from `view_file.php` prevents stale uploads; bytes are validated before file or DB changes.
- `upload_pdf.php` requires an unexpired HttpOnly session in `eoffice_sessions`, authorizes the document/file, and updates `t_access_rights` after installing the validated file in a transaction.
- Auto send uses an explicit receipt declaration: `receipt_departments` plus `confirm_receipt=1`. The UI waits for queued stamp image rendering and asks the assigned secretary to confirm registering receipt before saving. `config/sign-routing.php` revalidates secretary scopes, records `eoffice_document_receipts` against the saved revision, adds deputy access and queues notifications in the save transaction. Nonempty legacy `stamp_departments` is rejected. This records an authorized receipt declaration, not server verification of stamp pixels. Pen-only saves do not auto-send; existing deputy read/sign state is preserved.
- The editor reloads receipt scopes on each save with pending receipts; failed requests are retryable on the next Save without discarding annotations. Stamp `saved` tracks PDF persistence separately from `receiptRegistered`, which is set only for departments acknowledged in `registered_receipt_departments` after the server commits. Saved stamps without registered receipts remain eligible if a secretary assignment changes while the editor stays open.
- Undo redraws a complete layer offscreen, awaits stamp image decoding through `stampRenderQueue`, then commits the visible layer and history together. Drawing and further Undo are blocked while a render is pending. Failed redraw leaves the previous layer/history intact and blocks that save attempt; stale redraw after document reload is discarded.
- Receipt history prevents secretary account deletion: the API returns `409` and the receipt/user FK uses `ON DELETE RESTRICT`. Migration upgrades older cascade FKs in one ALTER without removing receipt rows.
- Signing holds `AppDocumentFileLock` from `config/document-files.php` across DB commit/rollback and filesystem compensation. Restore the previous PDF before an explicit rollback; the independent file mutex still prevents publishers/readers from racing an implicit InnoDB deadlock rollback. File publishers, cache reads/writes and archive scan/eviction share this lock, acquired before DB transactions. Lock files live permanently in private `EOFFICE_STORAGE/.document-locks` so the inode identity stays stable.
- Receipt saves acquire the routing gate shared before document/user/route locks and validate the secretary scope before installing bytes. Member mutations acquire the same gate exclusively before the Admin roster, preventing opposing Admin-parent FK and routing lock orders. SQL deadlock/lock-timeout failures return retryable `409` after restoring bytes; they are not blindly replayed after sending notifications.
- `view_file.php` snapshots local/registry state under a short file mutex, releases it before any Drive/legacy download or cloud-cache lock wait, then reacquires it to recheck access, binding and the selected revision before opening an inode. Changed cloud-only revisions fail `409`; current local/pinned bytes win over a prepared stale cache. Document mutex timeouts return HTTP `503` with `Retry-After: 2` rather than generic `500`.
- Warm-cache HTTP reads refresh activity through `app_drive_archive_touch_cache()` only after opening the authenticated inode. It uses the cache maintenance mutex nonblocking and checks dev/inode before touching; deleted/replaced caches are never recreated/refreshed from an old handle. Cache sweeping rechecks mtime after taking the same mutex so a stale sweep snapshot cannot evict a recently used cache below the byte limit.
- Credentials are configured externally. Notifications use `eoffice_outbox` and `scripts/notifications.php`; see `DEPLOYMENT.md` at the project root.

## Verification
- Focused PHP syntax checks: `php -l e-sign.php` and `php -l upload_pdf.php`.
- Full behavior requires serving this folder from within the parent E-Office app so `../api`, `../config`, and `../file_document` paths resolve.
- PHP variables are case-sensitive; check the existing `Doc_Id`/`doc_id` naming carefully when editing notification or access-right logic.
