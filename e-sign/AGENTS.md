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
- Credentials are configured externally. Notifications use `eoffice_outbox` and `scripts/notifications.php`; see `DEPLOYMENT.md` at the project root.

## Verification
- Focused PHP syntax checks: `php -l e-sign.php` and `php -l upload_pdf.php`.
- Full behavior requires serving this folder from within the parent E-Office app so `../api`, `../config`, and `../file_document` paths resolve.
- PHP variables are case-sensitive; check the existing `Doc_Id`/`doc_id` naming carefully when editing notification or access-right logic.
