# E-Office: setup and verification

## Runtime

- PHP 8.1+ with PDO MySQL, mysqli/mysqlnd, mbstring, fileinfo, GD, cURL, OpenSSL.
- MySQL 8 / compatible InnoDB. Apache must honor `.htaccess` (`AllowOverride All`).
- Serve this directory at the web root. For PHP's development server use `scripts/router.php` so private paths are blocked.

## Configuration

Use environment variables or copy `config/local.example.php` to `config/local.php` (private, ignored by Git). Production requires DB_DATABASE, DB_USERNAME and DB_PASSWORD. No credentials are included in application code.

| Setting | Meaning |
| --- | --- |
| DB_HOST / DB_PORT / DB_DATABASE / DB_USERNAME / DB_PASSWORD | Database connection |
| APP_URL | Exact public origin, including development port; used for Origin checks and email links |
| EOFFICE_STORAGE | Absolute document storage directory, preferably outside the web root |
| EOFFICE_MOCK_SERVICES | Explicitly set `true` for test/development; mail, push and AI recorded in eoffice_outbox. Defaults false, including CLI workers. |
| EOFFICE_REMOTE_FILES | Explicitly permit reads from the fixed legacy `https://eoffice.siya.ac.th` host; default false |
| SMTP_HOST / SMTP_PORT / SMTP_USERNAME / SMTP_PASSWORD / SMTP_FROM | Production SMTP with TLS verification |
| ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY | Notification worker configuration |
| GEMINI_API_KEY / GEMINI_MODEL | Production PDF recipient matching; model default gemini-2.5-flash |
| DRIVE_APPS_SCRIPT_URL | HTTPS Drive adapter deployment for production image upload |
| EOFFICE_SIGN_ROUTES | JSON assistant-to-supervisor map; default preserves the existing routing |

All exposed database, mail, AI and push credentials from the previous source must be rotated by their owner. Setting new environment variables does not revoke the old credentials.

## Migration and rollout

1. Back up source, database and document files.
2. Configure the database/origin/storage. Existing original PDFs belong under `original/{year}/`; existing signed files under `e-sign/{year}/`.
3. Run `php scripts/migrate.php` using the same environment as the app. The migration is additive/idempotent and adds sessions, counters, signed-file revisions, an outbox and access-history archive.
4. Existing users must log in again. Legacy database tokens are no longer accepted over HTTP. Plaintext passwords are rehashed only after successful, type-safe authentication. Password resets revoke all sessions for that user.
5. Document notifications are processed after successful responses; authenticated email staff also drain the queue from the browser. Schedule `php scripts/notifications.php` as an additional fallback for unattended delivery. Uncertain/exhausted deliveries remain visible as `manual`/`partial`; inspect the per-channel result before retrying. It is not safe to blindly retry SMTP jobs after an ambiguous delivery failure.
6. Verify Apache blocks config, scripts, tests, backups, staff JSON and direct document storage. On non-Apache hosts, implement equivalent web-server restrictions before rollout.

Recipients can update only their own receipt number/date, not document content, file attachments or recipients. Owners/Admins manage the shared document. Group membership grants access dynamically. Revoked direct access is archived in eoffice_access_history, preserving read/sign data.

Staff privileges are stored in `eoffice_permissions`. The first migration imports the existing room/maintenance/email staff (IDs 1,14) and external-number staff (IDs 1,18) without changing their global role. Admins have all capabilities. Later staff assignments should be changed in this table; the migration marker prevents re-granting revoked legacy privileges on reruns.

When legacy remote reads are explicitly enabled, document-bound files from the fixed trusted origin are cached atomically in EOFFICE_STORAGE before signing. Revision-checked saves use those same authoritative bytes. Public orders remain public by design.

## Automated tests

Create a separate database whose name ends with `_test`, populated with a copy of the application's schema/data. Never run the test seeder on the production database.

```powershell
$env:PHP_BIN = 'C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe'
$env:TEST_DATABASE = 'eoffice_review_test'
npm.cmd test
npm.cmd run build:css
npm.cmd run serve:test
```

The runner starts three independent PHP workers on ports 8081–8083, uses temporary document storage, mock services, and dedicated QA accounts. It verifies authentication, role/ownership boundaries, file validation and binding, document/read/sign flows, stale revision conflicts, concurrent booking approval, concurrent number allocation, maintenance state protection, email deduplication and logout. Test fixtures remain only in the test database/storage for inspection. `serve:test` opens a browser-test server at localhost (DEV_PORT overrides the port); `-- --detach` leaves it running.

QA account emails: qa-admin / qa-owner / qa-recipient / qa-outsider at siya.ac.th. Test password: `Review-Test-2026!` (test database only).

Browser checks additionally cover actual landscape PDF rendering/stamping/export, preservation of searchable text, escaped malicious-looking data in administration tables, login UI and mobile layouts. Real SMTP/OneSignal/Google Drive/AI, live Sensor devices and legacy remote PDFs require their configured sandbox integrations for end-to-end acceptance.

## Verified shared-host staging

See `STAGING_DEPLOYMENT.md` for the verified staging deployment and `PRODUCTION_DEPLOYMENT.md` for the production release at `https://e-office.siya.ac.th/`. The host uses FTPS on `ftp.siya.ac.th:2121` and MySQL/MariaDB through **localhost:3306** from PHP. `config/production.example.php` remains a credential-free template.

Service settings support either process environment variables or the protected `config/local.php`; environment variables take precedence. FTP credentials are read only by the local staging deployment tool from the user's external credential file and are not bundled with the application.

## Review hotfix and queue states

See `REVIEW_FIXES.md` for authorization/attachment/public-response and notification regression coverage. Notification channel results are stored under `payload.delivery`. `pending` jobs with a due `retry_at` are eligible; `manual` includes orphan-image cleanup and uncertain SMTP/legacy sends; `partial` means one channel exhausted retries; `recorded` is a mock trace. Accepted email is never automatically repeated for a Push retry. Investigate manual/partial records before changing their state; do not bulk-reset SMTP-uncertain jobs to pending.
