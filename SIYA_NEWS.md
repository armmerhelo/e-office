# SIYA NEWS

SIYA NEWS is an internal intake, proofreading and freeform layout workspace. It collects school-news text and original photos, lets the journal team download approved material, and provides a canvas for page design with PNG/PDF output. It is **not a public news page or a general-purpose graphic-design application**.

## Access and workflow

An E-Office Admin grants one or more SIYA NEWS permissions in **จัดการสมาชิก → สิทธิ์**:

- `news_submit` — create drafts, upload photos, edit owned drafts/returned items, and resubmit.
- `news_editor` — view submitted items, directly edit/save copy and photo details, or mark it approved. The workspace no longer offers a return-to-author button.
- `news_producer` — view approved items, copy text, open/download original images, export a ZIP, and mark material as used.

Admin keeps the existing all-access behavior. There is no general internal viewer, separate approver, SIYA NEWS manager role, public page or journal-issue manager. Every API and image request checks the current server-side permission. Revocation takes effect on the next request.

Workflow: `draft → review → approved`; reviewers correct the submitted copy directly. Legacy `changes_requested` records and the return API remain supported for compatibility. A content or image change after approval clears approval and puts the item back into review. Saves use a version number to reject stale forms. Each change and review transition retains a restricted snapshot; producers receive only the approved news and its approved image set. The ZIP contains `ข่าว.txt`, original files under `images/`, and `รายการภาพ.csv` with captions and credits.

### Trash and restore

- **ย้ายไปถังขยะ** is a reversible soft deletion, not a permanent file/database delete. Submitters can trash/restore only their own drafts; reviewers can trash/restore submitted or approved news; Admin can handle any existing news state. Producers have no trash access.
- The **ถังขยะ** tab contains only news the current account can restore. Deleted news is excluded from normal lists. Trash detail is read-only; image bytes, ZIP, edits, uploads, spelling checks and approval are blocked until restoration. Stored images and revision history are retained under the existing storage/retention policy.
- Drafts restore as drafts. Previously submitted or approved news restores to `review`, with approval/usage metadata cleared; producers cannot read or export until reapproved. Legacy returned items can be handled by Admin and restore to their returned state.
- Both actions require confirmation, the captured authenticated owner and a current version. Deleting does not autosave local changes: the confirmation explains that only previously saved content is recoverable. Failed/ambiguous requests preserve the form and use the existing receipt-recovery flow rather than automatically resending.
- Run the additive migration (`php scripts/migrate.php`) **before publishing** the new API/UI together. It adds nullable `deleted_at`, `deleted_by`, `deleted_from_status` to `eoffice_siya_news`; no existing news is deleted or reclassified. Trash and restore each create a revision and audit event. There is no permanent-delete or automatic trash-purge endpoint.

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

## Studio (freeform design)

- **SIYA NEWS — จัดหน้าวารสาร** is a producer-only (`news_producer`, Admin) freeform canvas built with locally vendored Konva and jsPDF. Submitters/reviewers cannot open its page or API.
- Pages support A4 portrait/landscape, presentation, square, story and poster presets, up to 40 pages. Each page has text, rectangles, circles, triangles, stars, lines, approved-news images and layer ordering; objects can be moved, scaled, rotated, resized, recoloured and hidden.
- Image decoration is non-destructive: `cropView` stores normalized pan (0–1) and zoom (1–5×), with original/current/1:1/4:3/16:9/3:4 frame presets. Enable **ลากภาพภายในกรอบ** to pan using mouse or touch; sliders provide a keyboard alternative. **คืนภาพเต็ม** resets the crop and restores the source aspect ratio; Undo restores the previous crop. Image/shape borders expose colour and 0–100 px thickness; images/rectangles also support rounded corners (0–500 px).
- Text supports line height (0.8–3), letter spacing (−20–100 px) and underline. **ล็อกวัตถุ** disables dragging, transformer, property edits, deletion and keyboard movement; unlock from the inspector or layer list. Page/template replacement still requires its existing confirmation.
- Alignment controls position an object's bounding box against the safe margins or page centre (including rotated objects). Snap uses page edges/centre/margins and visible objects' edges/centres within 5 screen pixels; hold Alt while dragging or disable **Snap** to bypass it. Safe margin guides (0–200 px) are optional per page, saved with the layout, and excluded from exports.
- The font selector includes **Sarabun — สารบรรณ** for formal-document styling (Sarabun, not TH Sarabun New). Regular/bold/italic/bold-italic TTFs are served locally from `assets/fonts/sarabun/` under the SIL OFL 1.1. The browser FontFace API registers the full family before use, including inside the shell's Shadow DOM; failed loads preserve the old font and can be retried. Existing layouts keep their font choices.
- Page rendering prepares every element before replacing the previous canvas. A failed render reports an error instead of silently omitting elements that could later be lost on save.
- The news panel exposes only approved stories. Clicking a story inserts its title, department/date, body excerpt and first approved image; image thumbnails insert only that image. Images remain private API references (`newsId` + `imageId`) and are never embedded as data URLs. Text inserted from news is a local design copy and can be edited; the server validates every referenced image against the current approved snapshot on save.
- Autosave is debounced. Saves are version-checked; an external edit stops autosave and shows **โหลดล่าสุด**. Network failures keep the work on screen without a retry loop. `Ctrl/Cmd+S` saves immediately; the shared module guard warns on departure.
- Opening a layout stages its document and approved-news pool before replacing the current canvas. Failed dependency loading preserves the previous layout. News references load in batches of 60 so layouts with more than 80 referenced stories remain usable.
- Delete/restore operations capture the target layout and lock the editor until completion. Export locks before readiness requests (including keyboard/input controls); navigation warns while an operation is pending.
- Studio automatically collapses the main menu, with a compact 36 px shell header and an explicit menu toggle. Desktop editor/work bars use 44/34 px, and the bottom page tabs use about 40 px rather than large thumbnails; leaving Studio restores the normal shell.
- Every save creates a revision (30 newest retained; 12 shown). History restore creates a new version. Layout deletion is permanent for that layout only; news/images are untouched.
- **ตรวจความพร้อม** re-fetches approved news/image references and blocks export when an image's story is no longer approved or the image is not in its approved snapshot. It also reports images that fail to load.
- **PNG** exports the current page; **PDF** renders every page with jsPDF (raster pages, no selectable text). Both render artwork layers at a fixed **2× document resolution**, independent of workspace zoom and without transformer, margin or snap guides. A4 portrait exports to 1588 × 2246 pixels (not a 300-DPI press-ready workflow). Both use authenticated same-origin images and require a successful readiness check.
- The layout JSON stores only bounded element attributes (no HTML, CSS, data URLs or arbitrary scripts). Text is drawn on canvas. The API rejects unknown element types, invalid colours, out-of-range values, duplicate IDs, overlong text, more than 2,000 elements and documents over 400 KB.
- Text/layout from the design is **not proofread automatically**; the producer is responsible for the final page. Approved-news images still obey the existing private image permissions.
- Browser libraries are pinned under `assets/vendor/` (Konva 10.9.1, jsPDF 2.5.2; MIT) and loaded locally through the module router. No CDN is required at runtime.
- Run `php scripts/migrate.php` before publishing the Studio API/UI. It adds `eoffice_siya_news_layouts` and `eoffice_siya_news_layout_revisions` only; existing news/images/history are unchanged.
- Local regression: `tests/siya-news-studio.php`, `tests/siya-news-studio-schema.php`, `tests/siya-news-studio-api.cjs`, and the opt-in `tests/siya-news-studio-browser.cjs` (mock services, isolated `*_test` database, producer QA account).
- `node tests/siya-news-studio-state.cjs` runs deterministic delayed/failing dependency, delete, restore, batched-reference and PDF-readiness race regressions without a database. Browser tests also verify compact bars on 900/600 px-tall desktops, mobile drawers, readiness locks, and actual raster PDF generation.
- Inspector numeric/text/colour, layer-name and crop-slider inputs mark the layout dirty immediately, without waiting for blur; change events retain grouped undo history. PDF cleanup always releases the editor lock even if restoring the current page fails. Image borders render after the bitmap, so their configured thickness is visible rather than half-covered. `node tests/siya-news-studio-graphics.cjs` verifies real browser border pixels, rounded clipping and export-clone consistency without a server/database.
- Canvas-to-document synchronization requires the exact page object that was successfully rendered. If PDF cleanup cannot restore that page, artwork editing and saving are blocked while the toolbar remains available; **ลองแสดงหน้าใหม่** retries the in-memory document without discarding unsaved work. Successful rendering releases the edit guard.
- Image requests have a 15-second timeout and start concurrently per page (deduplicated by image ID). Failures detach handlers, cancel the image source and show a retry control; placeholders are never cached as successful images and prevent export. A successful retry clears that image's failure state.
- Retry synchronizes unsaved canvas edits first only when the canvas belongs to the selected page and has no rendering error; stale/failed canvas contents are never imported. PDF export checks image failures immediately after rendering each page, before adding its raster, so a later successful image retry cannot mask an earlier blank image or produce a partial download.
- A server version conflict takes priority over simultaneous image/render failures: **โหลดเวอร์ชันล่าสุด** asks for confirmation before discarding unsaved changes and requesting the current server layout. Cancelling leaves the work intact. **ลองแสดงหน้าใหม่** remains an in-memory retry only when there is no version conflict.
- After a successful page render, pending edits re-arm the autosave debounce if its previous timer expired while images/fonts were loading. Resumption requires a matching rendered page and owner, with no conflict, render error or in-flight operation. It neither changes the edit revision nor repeatedly retries failed network writes.

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
