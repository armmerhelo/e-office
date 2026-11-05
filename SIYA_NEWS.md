# SIYA NEWS

SIYA NEWS is an internal intake and proofreading workspace. It collects school-news text and original photos so the journal team can download approved material and create graphics outside E-Office. It is **not a public news page or graphic-design/publishing tool**.

## Access and workflow

An E-Office Admin grants one or more SIYA NEWS permissions in **จัดการสมาชิก → สิทธิ์**:

- `news_submit` — create drafts, upload photos, edit owned drafts/returned items, and resubmit.
- `news_editor` — view submitted items, directly edit/save copy and photo details, or mark it approved. The workspace no longer offers a return-to-author button.
- `news_producer` — view approved items, copy text, open/download original images, export a ZIP, and mark material as used.

Admin keeps the existing all-access behavior. There is no general internal viewer, separate approver, SIYA NEWS manager role, public page, journal-issue layout, or graphic editor. Every API and image request checks the current server-side permission. Revocation takes effect on the next request.

Workflow: `draft → review → approved`; reviewers correct the submitted copy directly. Legacy `changes_requested` records and the return API remain supported for compatibility. A content or image change after approval clears approval and puts the item back into review. Saves use a version number to reject stale forms. Each change and review transition retains a restricted snapshot; producers receive only the approved news and its approved image set. The ZIP contains `ข่าว.txt`, original files under `images/`, and `รายการภาพ.csv` with captions and credits.

### Workspace UX

- Visual styling follows the E-Office indigo/slate palette, Prompt typography, white module cards and neutral form controls. Static and dynamically rendered actions use the shared `assets/ui-buttons.css` / `eo-btn` components; news status colors remain semantic rather than branding accents.
- Existing articles open in reading mode. Authorized users select **แก้ไขข่าว** to edit; an approved item shows a warning that saving changes returns it to review. An unchanged UI save does not send a mutation or revoke approval.
- **บันทึกและผ่านตรวจ** and **บันทึกและส่งตรวจคำ** save current article and image metadata before the transition. A failed write stops the transition and keeps the form available to retry. These are sequential, version-checked writes, not a single database transaction; a failed approval may leave saved changes in review.
- Review notes are committed by approve/return, not by the ordinary content save. They remain in the form after a content save. Leaving an edited article, switching tabs, or creating another draft asks before discarding unsaved input; cancel returns to the form to save first. There is no autosave.
- Approved articles expose the ZIP action near the title. Mobile switches between list/detail with an explicit back button; image actions use larger touch targets, and tabs support arrow/Home/End navigation.
- Review notes and review/submit actions follow the image section, with approval/submission as the primary action and ordinary saves secondary. History starts collapsed. In reading mode, captions and credits are plain text, not disabled fields. Feedback appears inline in the detail panel without programmatically scrolling to the page header.
- A secondary save action next to the article content saves current content and image metadata without approving. Toolbar/content/image/review feedback is placed next to its action group. Image previews open an authenticated full-image modal with uncropped rendering, loading/error feedback, close/Escape support and focus return; the shell's session-verification restrictions still apply.
- The full-image modal uses current caption/credit inputs (including cleared values), identifies unsaved metadata, and does not save on open. Image removal reports both errors and success in the image section.
- Batch uploads show per-file states. The UI validates count/type/size before starting, stops on failure and has a two-minute timeout per file. Retry sends only explicitly failed or not-yet-sent files; successful files are skipped. Network errors, timeouts and server/proxy errors are treated as ambiguous receipts: the UI refreshes the article and asks the user to inspect images before manually selecting that file again. It never silently retries an ambiguous upload. The queue exists in browser memory only, not after a full reload; incomplete queues trigger a departure warning. This is not resumable/chunked uploading.
- File inputs reset after success, failure or cancelled queue replacement, so selecting the same file again works. A new selection cannot replace a pending queue without confirmation. Each ambiguous receipt offers **ตรวจแล้ว พบภาพในรายการ** (a manual acknowledgement, not server integrity verification) or **ยกเลิกจากคิว**. Failed/queued files can also be cancelled. These actions never upload or delete server files. Resolved/cancelled entries no longer trigger departure warnings; confirming departure explicitly discards the pending in-memory queue and unsaved edits.
- State transitions are blocked until pending image queues are resolved. Controls created by an upload refresh stay locked until the operation finishes, and pending queues participate in the shared shell's departure guard. Each API request has a two-minute response/body deadline. Unknown mutation receipts and version conflicts block further writes until the user explicitly reviews the latest article; unsaved form text stays available to copy. Only explicit application-level 4xx rejections (not proxy pages/timeouts) are treated as definite upload failures.
- Lists support loading older articles beyond the first 100. Invalid image metadata is checked before article writes begin. The browser suite selects the exact article ID for each run, not an overlapping title prefix.

### Optional AI spelling assistance

- In edit mode, **ช่วยตรวจคำผิด** asks for confirmation before sending only the current title/body to Gemini. Uses the existing order AI key/model settings and usage tracking (`siya_news_proofread` purpose); no new key is exposed to the browser or configured automatically.
- Suggestions show source text, replacement and explanation. Each is anchored to its original first literal occurrence and consumed once when applied in the local form; other suggestion positions are adjusted and overlapping suggestions removed. Saving and approval remain explicit. Manual title/body changes invalidate old suggestions. AI does not certify spelling, names or facts.
- After consuming or removing overlapping suggestions, the UI asks for another check for repeated/overlapping text rather than claiming the changed article was rechecked. Replacement newlines are normalized; a title replacement cannot contain a newline. Invalid/truncated/blocked provider responses are rejected instead of being shown as a successful empty check. Output is capped at 8,192 tokens and 60 suggestions.
- The endpoint requires editing rights (or submit rights for a new draft) and an explicit captured `_expected_owner` matching the authenticated account. It enforces input/output limits and a 20-second per-account cooldown, and validates every suggestion against the source. News text is not stored in the throttle file. Failures leave the form unchanged and do not retry automatically.
- Mock mode returns synthetic suggestions only (currently `อนุญาติ` → `อนุญาต`) without contacting Google. Live Gemini proofreading needs separate verification with the configured service before claiming real-cloud success.

## Image handling

- Accepts JPEG, PNG and WebP originals, up to 20 MB per image, 10 images per news item and 100 megapixels per image. SVG is not accepted. There are no generated thumbnails; previews use the original image.
- Files have random server-generated names and are stored outside the web root with private permissions. Set `EOFFICE_SIYA_NEWS_STORAGE` to an absolute private directory if the server's default private location is not writable; otherwise the app uses a private sibling of `EOFFICE_STORAGE` when it is outside the web root, then falls back to a private sibling of the web root. Browsers cannot address the image directory directly. The image API authorizes each read and sends `Cache-Control: private, no-store`.
- The age is measured from each image upload. Once an image is at least **30 days old**, the scheduled worker copies it to a dedicated private Google Drive folder in 512 KiB chunks. Every chunk is read back and SHA-256 checked; the complete image is checked again before the database marks it archived.
- Failed transfers keep the server original and retry with backoff. Integrity problems move the image to an investigation state and never delete its server file. After a verified cloud copy, the server original is retained for one extra day before removal; completed removals are tracked separately so the worker will not repeatedly download old photos. Old approved material remains available through the authenticated image API and can be exported from Drive.
- There is no public link and no cloud-delete operation. The ZIP download requires PHP `ext-zip`.

## Migration and Google Apps Script activation

The additive migration runs as part of the normal migration command:

```sh
php scripts/migrate.php
```

This creates the SIYA NEWS article, revision and image tables. Then an Admin assigns the three permissions to the intended staff. No existing member receives a SIYA NEWS role automatically.

Drive transfer is deliberately **off until the owner installs and verifies the Apps Script bridge**. This avoids deleting the only original if the destination is not ready.

1. Create a private Drive folder dedicated to SIYA NEWS. Do not share it by public link. Keep it separate from both the legacy maintenance folder and the E-Office document archive.
2. Build the merged Apps Script source with `node scripts/build-drive-appscript.cjs`. It contains a single `doGet`/`doPost`; deploy the reviewed merged source as the existing private/authorized E-Office Apps Script web app. The new route is HMAC-authenticated and does not change the legacy maintenance API.
3. In Apps Script Project Settings set `SIYA_NEWS_DRIVE_ROOT_ID` to the new folder ID and `SIYA_NEWS_DRIVE_SECRET` to a fresh 64-character lowercase-hex secret. If using the merged existing project, retain its existing legacy/archive properties and ensure the SIYA NEWS root is a private separate sibling, not nested with either other root.
4. In private server config set `EOFFICE_SIYA_NEWS_DRIVE_URL` to the deployed `/exec` URL and `EOFFICE_SIYA_NEWS_DRIVE_SECRET` to the matching SIYA NEWS secret. The URL may use the existing merged deployment URL, but the SIYA NEWS secret must match `SIYA_NEWS_DRIVE_SECRET` and is intentionally separate from the document-archive secret. Never put IDs or secrets in Git or this document.
5. Verify the route with `php scripts/siya-news-drive.php health`, inspect counters with `php scripts/siya-news-drive.php status`, and run a real upload/read-back/recovery check before enabling `EOFFICE_SIYA_NEWS_DRIVE_ENABLED=true`.
6. The current five-minute `scripts/scheduled-jobs.php` Cron runs the image archival worker when enabled. Monitor `php scripts/siya-news-drive.php status` and server logs. For a flagged integrity item, preserve/repair its original first, then use `php scripts/siya-news-drive.php retry <image-id>` to requeue it.

The worker does not evict any local source unless the private bridge is enabled, responds to health, and exact remote bytes pass integrity checks. Production activation still requires the Apps Script owner to deploy/configure the bridge and the hosting operator to enable the private setting; source code alone does not mean Drive archival is live.

## Tests

```powershell
npm.cmd run test:modules
npm.cmd run test:members
npm.cmd test
```

The integration suite covers role gating, return/resubmit/approve, approved-only access, original-image delivery, ZIP output where `ext-zip` is installed, and cleanup in its isolated `*_test` database/storage.

Optional real-browser UX checks: run `node tests/siya-news-ux-browser.cjs` against an already-running isolated localhost preview with `EOFFICE_MOCK_SERVICES=true`, setting `EOFFICE_QA_BROWSER_URL`, `EOFFICE_QA_EMAIL` and `EOFFICE_QA_PASSWORD` in the process environment. The account needs all three news roles. The image test expects synthetic article #1 with an image. The checks create synthetic articles/images, exercise cancellation, latest-content/metadata approval, no-op saves, failed approval recovery, mobile layout and keyboard tabs, and save desktop/mobile screenshots in an isolated Temp browser profile. Do not point this write-enabled check at a real-data database.

Set `EOFFICE_QA_ROLES=1` to include separate submit/editor/producer/unassigned accounts, long copy with ten images, and deterministic delayed/rejected/lost-upload-response scenarios. Set the CLI `DB_*` environment to the **same isolated database** as the preview server. `tests/siya-news-role-fixture.php` adds synthetic accounts without deleting existing preview data and requires a local mock database matching `eoffice_siya_news_*_test`. These checks simulate network failure conditions; they are not a bandwidth benchmark or a production-network test.

`php tests/siya-news-storage.php` checks minimum retention, chunk/full-hash verification, corrupt readback rejection, the extra local-retention day, and preserving originals when remote re-verification fails. It requires the same local/mock database guard, no configured real Drive bridge and no pre-existing worker-eligible images. Only the synthetic rows/files it creates are removed. Successful real-cloud eviction still needs a separate staging check with the deployed private bridge; this suite deliberately never contacts real Drive.
