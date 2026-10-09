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

## Review hotfix — 8 October 2026

- Order recipients now include the document's explicitly selected individual recipients as well as AI matches. Their `document` source survives AI reanalysis; revoked unsent document-only recipients are removed. Explicit selection of an existing AI recipient promotes it to `manual` without resetting its accepted, uncertain or cancelled delivery state.
- Cancelling a job cancels its pending recipients. Adding or retrying recipients cannot implicitly restart a cancelled job; an explicit confirmed reanalysis is required first, and previously cancelled recipients remain cancelled unless individually retried.
- Admin settings expose a monotonic `revision`. Save requests must carry the revision they loaded, and the API checks it again after AI validation under the settings lock. Stale saves return HTTP 409, including concurrent pause/save and same-second changes. Reload the settings page before saving if it was open during the upgrade.
- Replacing or adding PDFs during AI analysis automatically queues a fresh snapshot before any email is accepted. A file change after accepted/uncertain delivery still requires manual review. File snapshot synchronization is transactional, and document bindings are locked while obtaining the snapshot, not during the AI request.
- Local verification: **47 order-email regressions**, **3 UI regressions**, and the full `npm.cmd test` suite pass. Production: **6 controlled HTTP checks**, **9 release files** verified with no checksum mismatches. Temporary account/document/job were removed; no staff mail was sent by the verification.
- Queue delivery was paused only for the patch rollout and restored to its previous enabled state. The original activation boundary remains **2026-10-08 14:20:51 Asia/Bangkok**. The repair pass found no existing queued jobs requiring correction.
- Post-patch cron heartbeat confirmed at **20:55:02 Asia/Bangkok**, with no logged errors and delivery enabled.

## Missing-source fix — 9 October 2026

- A PDF missing from local storage with no readable Drive copy now fails only its own job with `review / pdf_unavailable`. It is not converted to `files_changed` or requeued indefinitely. Temporary cloud/cache errors retain their separate bounded retry policy.
- Regression checks verify the missing order moves to review, a later healthy order still completes in the same batch, and the next cron does not repeat the broken order. The current order suite passes **70 checks** (45 behavior / 25 HTTP).
- Targeted production update of `config/order-emails.php` was checksum-verified after pausing and draining the worker. Delivery was restored with the first activation boundary unchanged. Heartbeat confirmed at **2026-10-09 08:30:01 Asia/Bangkok**; no logged errors, mismatches or temporary helpers remained.
- Private rollback: `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-order-review-before-20261009-082947.tar.gz`, SHA-256 `a95abe479e68a33fbc00bd0661db7b0653d44a9606f918ae78d3a3109b964200`. Published worker SHA-256: `60b88ee99347b7fd00a2d059c0beb36c7c779644965241d264a0dcf4a41d9390`.

## Second review hotfix — 8 October 2026

- Before SMTP, the worker re-reads the queue row's current source/state and, for a `document` recipient, its direct document grant under the document lock. This happens before and after committing `sending`. A grant revoked in that gap becomes `cancelled / recipient_revoked` without contacting SMTP; AI/manual recipients retain their separate recipient policy.
- Cold Drive PDF restoration now runs before the snapshot transaction. The worker then locks the document and checks current bindings and hashes using already available local/spool/cache bytes. A concurrent replacement triggers fresh preparation; no archive download starts inside a document transaction.
- An active job whose recipients are all cancelled ends in `review / no_pending_recipients`, allowing a deliberate individual retry. Explicitly cancelled jobs still require confirmed reanalysis first, and restarting the job never resets cancelled recipients automatically.
- Local checks: **54 order-email regressions**, full `npm.cmd test`, and the Drive archive suite pass (including **24 archive behavior checks**). The order tests now isolate their Drive cache/spool beneath each disposable fixture root, preventing cache reuse between test runs.
- Production: **2 targeted files** checksum-verified, **5 controlled checks** passed, and the temporary account/document/job removed. SMTP was not called by the smoke checks. The queue was paused and its previous worker drained before publishing, then restored to enabled without changing the original activation boundary.
- Rollback archive: `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-order-review-before-20261008-220822.tar.gz`, SHA-256 `ed96cbb8276203ce10253796ef8d607d82f2ca28314dee612cf1d8858eb97955`.
- Post-release heartbeat confirmed at **22:10:01 Asia/Bangkok**, with delivery enabled and no logged errors.

## Third review hotfix — 8 October 2026

- Legacy document years are trimmed and validated before worker path helpers. Invalid metadata throws a per-job exception rather than an HTTP-style process exit. Canonical-year PDF links also normalize years during HTTP revalidation, including cloud reads.
- Adding recipients or saving a new explicit document recipient resumes both `no_recipients` and `no_pending_recipients` reviews. Previously cancelled recipients remain cancelled.
- Transient `AppDriveArchiveRetry` failures and cache preparation use persisted job-level `retry_attempts` / `retry_at` with exponential backoff, stopping after five failures. A confirmed reanalysis or individual retry resets this budget. Integrity failures remain manual review and are not silently retried.
- Cache eviction after one accepted email preserves cached AI results and every accepted/uncertain/cancelled recipient marker; the next due run restores the same snapshot and sends only pending recipients. An actual hash/revision change after delivery still requires review.
- Local verification: **67 order-email checks**, full `npm.cmd test`, **42 workflow checks** after final year-normalization changes, and the Drive archive suite pass (**44 archive behavior checks** plus HTTP/cache/signing/scheduler and Apps Script checks).
- Production: **6 targeted files**, additive retry-column migration, **4 controlled checks** passed, **0 checksum mismatches**, **0 temporary helpers**. Synthetic account/recipient/document/job/file were removed. No AI, SMTP or remote Drive calls were made by this smoke verification.
- The prior enabled state and activation boundary (**2026-10-08 14:20:51 Asia/Bangkok**) were preserved. Post-release cron heartbeat confirmed at **23:20:02 Asia/Bangkok**, with no logged errors.
- Main rollback archive: `C:\Users\arm_m\AppData\Local\Temp\opencode\eoffice-order-review-before-20261008-231254.tar.gz`, SHA-256 `73e8367b73ced37bfb1840f92aa70f7fc42729fbb2d38a46060b7d81fc00ebaa`. Shared file changes publish only reviewed year normalization over current production source; additional private backup metadata is recorded in the release state.
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
