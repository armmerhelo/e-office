# Automatic order emails

## Behavior

- An order (`External`) created after the first activation is enrolled in the same transaction as its save. Orders created earlier never enroll just because they are edited. No signing/approval step is required: PDFs were signed offline.
- A new order without PDFs waits for its attachments. Pausing delivery keeps capturing new orders after activation, and resuming never resets the original activation point.
- Every original PDF is analyzed independently. Successful AI results survive retries; all PDFs must finish before delivery. Recipient IDs are checked against registered users, email addresses are deduplicated case-insensitively, and each person receives one email with links to every PDF.
- Existing successful `email_logs` prevent duplicate deliveries. Other legacy attempts are shown for manual review. Accepted SMTP means accepted by the mail server, not proof of inbox delivery/read.
- The tracking list reads `email_logs` even when an old order has no new queue job: **เคยส่งแล้ว (ระบบเดิม)** marks at least one recorded success, while unconfirmed-only history is marked for review. Counts deduplicate email addresses across files (trimmed, case-insensitive); the latest successful timestamp is separate from later failed attempts. These marks do not claim every intended recipient/file was delivered. Viewing history never enrolls an order. The unqueued filter excludes historical attempts; separate sent/review history filters are available. Enqueueing an order with history requires explicit confirmation, and an existing queue job retains its current status.
- Both `order_jobs.php` and the compatibility `process_pdf.php` route use the same manual-enqueue rules under document/advisory locks. A new job with any previous attempt requires JSON `confirmed: true`; active jobs remain idempotent and terminal/held jobs require the tracking page's explicit management actions. Recipient duplicate checks use the same trimmed, case-insensitive email matching as the history display, so padded successful or unconfirmed legacy addresses cannot become automatically sendable AI/document/manual recipients.
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

### Named Gemini API key vault

- Migrate before opening the new UI. A pre-existing encrypted Admin key is imported once as **Key เดิมของระบบ** without decrypting it, preserving its selection even if the encryption key needs repair. Re-running migration does not duplicate it. Server credentials remain in server configuration and are never copied into the vault.
- The vault supports up to 50 named credentials, random `key_…` references, an enabled/paused state, and rotation reminders after 1–730 days. A reminder is local policy, not a claim about Google's expiry. Each addition is a new immutable secret: rotate by adding a new entry, testing/activating it, then retiring the old one.
- **Test and activate** always tests the chosen enabled credential against the saved model before switching. The old key remains selected on a failed test. Requests carry the settings revision, and authority/revision are checked again after remote testing. Changing the active key affects the next AI request; it does not resend existing emails. There is no automatic fallback or quota-bypassing key cycling.
- Active vault entries cannot be paused or deleted. Select another entry, return to server mode, or use **หยุดใช้ API Key ปัจจุบัน** first. That stop action pauses processing and explicitly selects no key while retaining vault entries. **กลับไปใช้ Key จากเซิร์ฟเวอร์** is a separate confirmed action and tests `GEMINI_API_KEY` before removing the override.
- Delete erases the vault ciphertext and leaves a tombstone for usage attribution; it does not revoke the key in Google AI Studio or erase historical backups. Revoke the old credential at Google after confirming the replacement, and follow normal private-backup retention.
- Success/error timestamps and rate-limit/authentication codes are stored against the exact vault ID used for each live request. Successful generation usage is attributed by that ID; connection/PDF tests are included. Key ID `0` means the server configuration slot (aggregated if the environment value is changed). Older/candidate-key usage is marked unattributed rather than guessed. Mock tests never prove real provider access.
- The original single-key input remains a shortcut: saving a new key creates a new named vault entry and selects it after validation. It retains old entries for deliberate retirement. Normal history never includes secret values, ciphertexts, or credential fingerprints.

### Rotating EOFFICE_SETTINGS_KEY

1. Back up the database and old encryption key separately to private storage. Generate a different random 32-byte base64 key once; do not paste it into source, command arguments, logs or Git.
2. Pause order processing in Admin, then put the web application in maintenance and stop cron/other PHP writers. Keep the old `EOFFICE_SETTINGS_KEY` available to the CLI. Supply the new key as the protected process environment variable `EOFFICE_SETTINGS_NEW_KEY`.
3. Run `php scripts/rotate-order-settings-key.php` from the application directory. The CLI requires the paused setting and exclusive order-worker lock, decrypts all vault/API/SMTP ciphertexts with the old key, and re-encrypts them with the new key in a single transaction. An unreadable entry rolls everything back. The compatibility active-key copy stays synchronized. It never rewrites `config/local.php` or prints either key.
4. After success, update the protected `EOFFICE_SETTINGS_KEY` in **both web and cron** to the same new value before restarting either process. Clear `EOFFICE_SETTINGS_NEW_KEY` from the process environment. Verify key decryption and perform fresh AI/SMTP tests; credential-test fingerprints from before rotation are intentionally no longer valid.
5. Resume web/cron, verify heartbeat and then restore the intended processing mode. Keep the old key with its corresponding encrypted backups for the required recovery period. To roll back before reopening traffic, restore the pre-rotation DB and old configuration together; never restore only one side.

If the old encryption key is lost, there is no decryption bypass: preserve the inaccessible backup, enter new credentials and retire inaccessible entries. Rotation is a server-maintenance operation, not a browser action.

### AI and email controls (October 2026)

- Run `php scripts/migrate.php` before deploying the updated settings page/worker. This adds encrypted SMTP storage, JSON options, worker completion telemetry, review snapshots, settings/test events and AI usage tables. Existing options default to the existing server SMTP, automatic sending, and no approval requirement.
- **SMTP:** Admin may use server configuration or a separate order-email SMTP configuration. Admin passwords are AES-256-GCM encrypted with `EOFFICE_SETTINGS_KEY` and never returned by the API. Admin SMTP supports STARTTLS or implicit TLS, sender name/address and Reply-To. These controls affect order emails; ordinary notifications continue to use server SMTP.
- **Tests:** connection checks authenticate SMTP; test mail sends only to the entered address. A successful SMTP test means server acceptance, not inbox delivery. SMTP test attempts have a 30-second per-admin cooldown. Enabling/saving delivery in live mode requires a successful test for the exact SMTP configuration within 24 hours; starting a stopped worker additionally requires a heartbeat within 15 minutes. Analysis-only mode does not require SMTP. Mock mode clearly reports that providers were not contacted.
- **PDF trial:** Admin may submit a PDF up to 5 MB to Gemini with the registered name/ID directory. Results show the names in the PDF, unambiguous directory matches and unmatched/uncertain entries. Trials create no document, queue, recipient, or email and do not retain the submitted file. Connection tests remain a separate synthetic-PDF/JSON capability check. AI output still requires human judgment.
- **Policy:** the main switch pauses all work. Analysis-only runs analysis and holds pending recipients in `awaiting_approval / analysis_only`. Turning analysis-only off requeues those jobs in automatic mode, or retains them for review when review-before-send is enabled. Optional review-before-send holds every unapproved file/recipient snapshot; email staff approve from the tracking dialog. Approvals require the review token loaded with the displayed files/recipients. Changed files, recipient membership or email invalidate approval; successful/uncertain delivery markers remain protected. Disabling review releases policy-held jobs only when analysis-only is also off.
- Policy-held jobs are reconciled against the saved destination policy on every settings save: analysis-only holds take precedence, review mode retains approval holds, and automatic mode releases both policy reasons. Other review/cancelled jobs are not released. Before SMTP, the worker uses a current locking settings read rather than an earlier transaction snapshot and retains its share lock through the delivery. An Admin settings save may wait for an already-started delivery to finish; once the pause/change commits, a later submission must observe it. SMTP credentials/template options for that delivery use the same captured settings row.
- Publishing a worker policy hold also runs atomically with a current settings read, using the same `settings -> job` lock order as reconciliation. If the worker writes first, a waiting Admin save sees and reconciles that hold; if Admin commits first, the worker uses the new policy instead of publishing a stale hold.
- Approval prepares cold Drive PDFs outside the SQL transaction, then locks the document and rechecks current settings, job state, reviewed recipient/file token and exact analyzed hashes. A changed file or recipient invalidates approval even if the download succeeded. An expired cache during locked validation returns a retryable approval message without changing delivery state; Drive transport outages return HTTP 503 and ask staff to retry, rather than claiming cron will automatically approve the job.
- **Templates:** subject, intro and signature accept `{doc_number}`, `{doc_name}`, `{doc_year}`, `{recipient_name}`. Body text is escaped, not executable HTML. PDF links are generated by the system using `APP_URL`. Preview uses safe text nodes and displays a demonstration link. Confirm document access with the intended recipient account before live rollout.
- **Health:** heartbeat ages over 7 minutes are late; over 15 minutes are offline. Worker start and completed-round timestamps are separate. A completed round reports jobs visited and caught job exceptions, not proof of every recipient's success. Review the tracking page for per-job failures and recipient attention states.
- **History:** records actor, time, changed fields (never secret values), model test results and latency. Public responses omit credential fingerprints. Last-24-hour success checks are bound to the exact key/model or SMTP candidate, rather than merely the model name.
- **Usage:** records successful live Gemini generation calls after this migration, including capability/PDF tests. Displays 30-day per-model tokens, requests and an estimated USD amount from administrator-entered per-million-token rates. Output includes thinking tokens where reported. These are local estimates, not Google billing or remaining quota. Older requests and failed calls are not reconstructed.

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
