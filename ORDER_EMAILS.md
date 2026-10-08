# Automatic order emails

## Behavior

- An order (`External`) created after the first activation is enrolled in the same transaction as its save. Orders created earlier never enroll just because they are edited. No signing/approval step is required: PDFs were signed offline.
- A new order without PDFs waits for its attachments. Pausing delivery keeps capturing new orders after activation, and resuming never resets the original activation point.
- Every original PDF is analyzed independently. Successful AI results survive retries; all PDFs must finish before delivery. Recipient IDs are checked against registered users, email addresses are deduplicated case-insensitively, and each person receives one email with links to every PDF.
- Existing successful `email_logs` prevent duplicate deliveries. Other legacy attempts are shown for manual review. Accepted SMTP means accepted by the mail server, not proof of inbox delivery/read.
- The document notification path skips Email for automatically enrolled orders while retaining Push. Order emails are delivered only by the order worker.
- File replacement before any accepted/uncertain send resets affected analysis. Replacement after delivery requires explicit reanalysis; already accepted recipients remain protected from automatic resend.

## Server setup

1. Back up the database and deploy the updated code. Run `php scripts/migrate.php` with the site's DB settings. The new tables are additive and migration is idempotent; automatic delivery starts disabled.
2. To manage API keys in the Admin page, create a persistent 32-byte encryption key. Generate it once on the server:

   ```sh
   php -r 'echo base64_encode(random_bytes(32)), PHP_EOL;'
   ```

   Store the result as `EOFFICE_SETTINGS_KEY` in the process environment or the protected, Git-ignored `config/local.php`. Never store it in source control or the database. Back up it separately; losing or rotating it without re-encrypting saved settings makes saved API keys unreadable. The web process and cron must use the same key/configuration.
3. Configure `APP_URL`, document storage, SMTP, and Gemini as in `DEPLOYMENT.md`. The Admin override is used when saved; otherwise `GEMINI_API_KEY` / `GEMINI_MODEL` remain the initial configuration. Clearing the key in the UI explicitly disables that saved key instead of silently returning to the server key.
4. Log in as `User_Status=Admin`, open **ส่งอีเมลคำสั่ง → ตั้งค่า AI และการส่งอัตโนมัติ**, configure the Gemini key/model, test the connection, and enable delivery. Saving enabled settings tests the selected model with a synthetic PDF and structured JSON output. No actual order is submitted by the connection test.
5. Use the hosting control panel to schedule a CLI command every five minutes. Substitute the real absolute PHP binary and app/log paths:

   ```cron
   */5 * * * * /absolute/path/to/php /absolute/path/to/site/scripts/order-emails.php >> /private/path/order-emails.log 2>&1
   ```

   This is a CLI-only script, not a public cron URL. Confirm PHP has PDO MySQL, cURL, fileinfo and OpenSSL, can read private PDF storage, and uses the same configuration as the website. Paths to the server's PHP binary must be verified on the hosting account.
6. Run the command once, verify the worker timestamp on the tracking page, then create a controlled new order and verify its queue state. The tracking page remains usable while paused, including importing old orders.

## Operations

- **Admin highest level:** key/model settings, enable/pause delivery, connection/model tests. Settings GET never returns the key/cipher; encrypted secrets use AES-256-GCM. Audit records contain actor/action/time, not keys.
- **Email staff:** filter by year/state, inspect per-file analysis and per-recipient delivery, enqueue selected old orders, add registered users, cancel pending recipients, cancel a job, and explicitly reanalyze. Web actions enqueue only; they do not wait for AI/SMTP.
- AI temporary failures use bounded exponential backoff and Retry-After, at most five attempts per file. A configuration or exhausted AI error needs review/reanalysis after correcting it.
- A persisted SMTP `sending` state from a crashed process becomes `uncertain`; it is never automatically repeated. A staff member must inspect the provider result before explicitly confirming a retry. The system cannot guarantee exactly-once delivery across SMTP and database failures.
- Model selection is captured for the analysis round. Changing settings applies to newly analyzed jobs; explicit reanalysis starts with the new model. Key rotation is used on the next AI request. Successfully analyzed file results do not require AI again just to send emails.
- The worker uses MySQL advisory locks, processes small batches and stops starting operations after a 90-second budget. An in-flight AI request can take up to 60 seconds; SMTP up to 20 seconds. An overlapping cron exits without starting a second worker.
- The existing `scripts/notifications.php` remains the fallback worker for ordinary document/Push notifications. Schedule it separately if required.

## Verification

```powershell
node tests/order-emails.cjs
npm.cmd run test:syntax
npm.cmd run test:integration
npm.cmd run test:notifications
```

Order tests create/drop a disposable `eoffice_orders_<pid>_test` database and temporary storage. AI/SMTP are mocked; no staff data or real email is used. Coverage includes activation boundary, later attachments, every PDF, merged recipients, API authorization, encrypted key handling, old-order imports, cancellation, AI backoff, interrupted SMTP, duplicate protection, file replacement, pause/resume and overlapping workers.

## Production rollout — 8 October 2026

- Targeted release uploaded and verified 18 files on `https://e-office.siya.ac.th/`; order tables migrated additively.
- A persistent encryption key was generated atomically in protected `config/local.php` with mode `0600`. Its post-release configuration backup is private and outside the repository.
- The existing Gemini configuration is preserved (`gemini-3.6-flash`). Real synthetic-PDF/JSON capability test passed; the Admin model-list API returns 45 supported models.
- Nine production HTTP smoke checks passed, including highest-Admin settings, cross-origin rejection, MariaDB list queries, two-PDF order save before activation and blocked worker URLs. Temporary smoke account/documents/files were removed; users/documents/email-log counts returned to the pre-release baseline (69 / 14,494 / 3,463). No staff mail was sent by these tests.
- The owner configured cron in the hosting panel, every five minutes. First real heartbeat: **2026-10-08 14:20:02 Asia/Bangkok**, with `0 order jobs processed` and no logged errors. Automatic delivery was enabled at **2026-10-08 14:20:51 Asia/Bangkok**; no old orders were enrolled.
- Two post-activation production smoke checks passed: enabled settings with a real heartbeat, and automatic enrollment of a new offline-signed order into `waiting_files`. The synthetic order/job/account were removed afterwards; staff mail was not sent by that test.
- The next scheduled cycle after activation completed at **14:25:01 Asia/Bangkok**, again logging `0 order jobs processed` without errors; delivery remains enabled.
- Hosting is Hostneverdie / DirectAdmin. The web PHP configuration disables command execution and restricts filesystem checks with `open_basedir`; a failed web-PHP executable check is not proof that the CLI binary is absent. The uploaded shell launcher tests supported PHP paths from cron itself without changing the hosting security configuration.

### Hosting panel cron entry

Set **Minute** to `*/5`, and **Hour**, **Day of Month**, **Month**, **Day of Week** to `*`.

**Command:**

```sh
/bin/sh /home/siyaacth/domains/e-office.siya.ac.th/public_html/scripts/order-cron.sh >> /home/siyaacth/domains/e-office.siya.ac.th/private/order-emails.log 2>&1
```

The shell launcher selects a compatible PHP 8.1+ CLI (preferring `/opt/alt/php83/usr/bin/php`), verifies required extensions, and invokes the CLI-only order worker. No public HTTP cron endpoint is used.

After saving cron, allow five minutes and check **Cron ล่าสุด** on the tracking/settings page. The worker records its heartbeat even while delivery is paused and should log `0 order jobs processed`. If no heartbeat appears, ask the host to inspect the private `order-emails.log`; the launcher records an explicit error if no compatible PHP CLI exists.

Only after the heartbeat appears, enable delivery from **ส่งอีเมลคำสั่ง → ตั้งค่า AI และการส่งอัตโนมัติ** as a highest Admin. That action establishes the first activation boundary. Newly created orders after that boundary enroll automatically; older orders still require explicit manual enqueueing.
