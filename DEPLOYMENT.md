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
| ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY | OneSignal application ID shared by browser registration and notification worker / private worker API key. Configure the matching HTTPS site origin and allow notifications in the browser. |
| GEMINI_API_KEY / GEMINI_MODEL | Production PDF recipient matching; model default gemini-2.5-flash |
| EOFFICE_SETTINGS_KEY | Base64-encoded 32-byte encryption key for Admin-managed Gemini credentials; same value for web and cron |
| DRIVE_APPS_SCRIPT_URL | HTTPS Drive adapter deployment for production image upload |
| EOFFICE_SIGN_ROUTES | Initial JSON secretary-to-deputy map, imported once by migration into `eoffice_sign_routes`; Admin manages later changes in member rights. The assigned secretary explicitly confirms registering receipt before saving; receipt audit, deputy access and notifications commit together. |

All exposed database, mail, AI and push credentials from the previous source must be rotated by their owner. Setting new environment variables does not revoke the old credentials.

## Migration and rollout

### Inbox delivery cutoff (31 October 2026, Bangkok)

- Received documents delivered before **2026-10-31 00:00 Asia/Bangkok** complete on read under the old rule. Deliveries at/after that instant require a successful signature/stamp save. The completed category is “ดำเนินการแล้ว”; legacy reads are labeled “อ่านแล้วตามเกณฑ์เดิม”, never falsely marked signed.
- `config/inbox-completion.php` compares UTC delivery timestamps with `2026-10-30 17:00:00`. Run `php scripts/migrate.php` before publishing the changed endpoints: it adds nullable `Inbox_Delivered_At` columns to direct grants, group grants and group memberships without changing read/sign history. Existing NULL timestamps are intentionally grandfathered; they are not document dates or migration time.
- Roll out the migration and **all delivery writers together under a maintenance gate before the cutoff**. New direct/group/automatic deputy grants and memberships record UTC time; unchanged recipient/group assignments retain their timestamps. Read, receipt-edit and signature endpoints materialize group-derived access using the original delivery time, not the time of opening/signing. A group's delivery is the later of its grant and membership time; the earliest active access path determines the rule.
- If rollout happens after the cutoff, stop and reconcile deliveries in the gap using verified records before proceeding. The old schema cannot reconstruct those delivery times, and silently grandfathering all of them would violate the cutoff. Never infer them from printed document dates or mutable read dates.
- Verify both legacy read-but-unsigned and post-cutoff unsigned recipients, group recipients, red dots, completed/pending filters, Back and public-response isolation. `npm run test:integration`, `npm run test:inbox-cutoff`, and `npm run test:sign-browser` cover these rules locally. This section documents rollout requirements, not a claim of production deployment.

1. Back up source, database and document files.
2. Configure the database/origin/storage. Existing original PDFs belong under `original/{year}/`; existing signed files under `e-sign/{year}/`.
3. Run `php scripts/migrate.php` using the same environment as the app. The migration is additive/idempotent and adds sessions, counters, signed-file revisions, an outbox and access-history archive.
4. Existing users must log in again. Legacy database tokens are no longer accepted over HTTP. Plaintext passwords are rehashed only after successful, type-safe authentication. Password resets revoke all sessions for that user.
5. Document notifications are processed after successful responses; authenticated email staff also drain the queue from the browser. Schedule `php scripts/notifications.php` as an additional fallback for unattended delivery. Uncertain/exhausted deliveries remain visible as `manual`/`partial`; inspect the per-channel result before retrying. It is not safe to blindly retry SMTP jobs after an ambiguous delivery failure.
   Push registration uses `eoffice_push_subscriptions`, bound to the current server session. Run the migration before publishing the new registration API/worker. Existing devices must reopen/reload the home page while signed in and allow notifications; legacy `t_target_id` entries are preserved but are no longer delivery targets. Logout, expiry and session revocation exclude that session's bindings without affecting other devices. Logging in again replaces only the previous session cookie's session.
6. Verify Apache blocks config, scripts, tests, backups, staff JSON and direct document storage. On non-Apache hosts, implement equivalent web-server restrictions before rollout.

Recipients can update only their own receipt number/date, not document content, file attachments or recipients. Owners/Admins manage the shared document. Group membership grants access dynamically. Revoked direct access is archived in eoffice_access_history, preserving read/sign data.

Staff privileges are stored in `eoffice_permissions`. The first migration imports the existing room/maintenance/email staff (IDs 1,14) and external-number staff (IDs 1,18) without changing their global role. Admins have all capabilities. Later staff assignments should be changed in this table; the migration marker prevents re-granting revoked legacy privileges on reruns.

When legacy remote reads are explicitly enabled, document-bound files from the fixed trusted origin are cached atomically in EOFFICE_STORAGE before signing. Revision-checked saves use those same authoritative bytes. Public orders remain public by design.

## Automated tests

Automatic order delivery has a separate CLI worker, activation boundary and highest-Admin AI settings. See [ORDER_EMAILS.md](ORDER_EMAILS.md) for setup, cron and operating instructions. It remains disabled until explicitly enabled by an Admin; old orders are imported manually.

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
