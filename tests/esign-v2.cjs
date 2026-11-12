// Static contract + geometry checks for the isolated e-sign v2 page.
// Run with: node tests/esign-v2.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const cp = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const geometry = require('../e-sign/v2/geometry.js');

let checks = 0;
function check(name, fn) {
    fn();
    checks++;
    console.log('PASS ' + name);
}

const php = read('e-sign/esign-v2.php');
const app = read('e-sign/v2/app.js');
const annotations = read('e-sign/v2/annotations.js');
const viewer = read('e-sign/v2/viewer.js');
const exporter = read('e-sign/v2/export-pdf.js');
const stamp = read('e-sign/v2/stamp.js');
const css = read('e-sign/v2/ui.css');

check('v2 is a separate entry file', () => {
    assert.ok(php.includes('ESIGN_V2_CONFIG'));
    assert.ok(php.includes("app_user(false)"));
    assert.ok(php.includes('Doc_Upload_Path'));
    assert.ok(php.includes('t_access_rights'));
    assert.ok(php.includes('JSON_HEX_TAG'));
});

check('v1 files are untouched in this worktree', () => {
    const diff = cp.execFileSync('git', [
        'diff', '--name-only', '--',
        'e-sign/e-sign.php',
        'e-sign/upload_pdf.php',
        'e-sign/receipt_scopes.php'
    ], { cwd: root, encoding: 'utf8' }).trim();
    assert.equal(diff, '', 'v1 files must not be modified');
});

check('save contract keeps the existing endpoint fields', () => {
    for (const field of ['confirm_signature', 'confirm_pen_signature', 'revision', 'receipt_departments', 'confirm_receipt', 'signature_method', 'signature_departments']) {
        assert.ok(app.includes(`formData.append('${field}'`), `missing ${field}`);
    }
    assert.ok(app.includes("saveUrl"));
    assert.ok(!app.includes('e-sign.php?'));
});

check('palm rejection uses pointer type, contact size and multi-touch guards', () => {
    assert.ok(annotations.includes('pointerType'));
    assert.ok(annotations.includes('penSeen'));
    assert.ok(annotations.includes('event.width'));
    assert.ok(annotations.includes('event.height'));
    assert.ok(annotations.includes('this.pointers.size'));
    assert.ok(annotations.includes('getCoalescedEvents'));
});

check('strokes are stored as page-normalised vectors', () => {
    assert.ok(annotations.includes('points: [[point.x, point.y]]'));
    assert.ok(exporter.includes('simplifyRdp'));
    assert.ok(exporter.includes('smoothStroke'));
    assert.ok(exporter.includes('drawLine'));
    assert.ok(exporter.includes('convertToPdfPoint'));
});

check('export does not flatten a full page to PNG', () => {
    assert.ok(exporter.includes('embedPng'));
    assert.ok(!exporter.includes('embedPng(layer.toDataURL'));
    assert.ok(!exporter.includes('getMergedCanvas'));
    assert.ok(!exporter.includes('toDataURL(\'image/jpeg\''));
});

check('viewer is lazy and DPR aware', () => {
    assert.ok(viewer.includes('IntersectionObserver'));
    assert.ok(viewer.includes('unloadPage'));
    assert.ok(viewer.includes('pixelScale'));
    assert.ok(viewer.includes('inkPixelScale'));
    assert.ok(viewer.includes('visualViewport'));
    assert.ok(viewer.includes('devicePixelRatio'));
    assert.ok(viewer.includes('maxCanvasPixels'));
});

check('assets are local and the module resolves the worker from import.meta.url', () => {
    assert.ok(!php.includes('cdn.tailwindcss.com'));
    assert.ok(!php.includes('unpkg.com'));
    assert.ok(app.includes("from './vendor/pdf.min.js'"));
    assert.ok(app.includes("new URL('./vendor/pdf.worker.min.js', import.meta.url)"));
    assert.ok(php.includes('v2/ui.css'));
});

check('stamp preview supports receipt and director layouts', () => {
    assert.ok(stamp.includes('drawReceiptStamp'));
    assert.ok(stamp.includes('drawDirectorStamp'));
    assert.ok(stamp.includes('ฝ่ายงานผู้อำนวยการ'));
    assert.ok(php.includes('app_sign_departments()'));
});

check('responsive layout has mobile toolbar rules', () => {
    assert.ok(css.includes('@media (max-width: 720px)'));
    assert.ok(css.includes('@media (max-width: 390px)'));
    assert.ok(css.includes('touch-action: none'));
});

check('UI layout fixes are present', () => {
    assert.ok(css.includes('--toolbar-height'));
    assert.ok(css.includes('#stamp-close'));
    assert.ok(css.includes('safe-area-inset-top'));
    assert.ok(css.includes('font-size: 16px'));
    assert.ok(app.includes('ResizeObserver'));
    assert.ok(app.includes('updateZoomControls'));
    assert.ok(app.includes("els.save.disabled = saving || !sourceBytes"));
    assert.ok(app.includes("els.save.setAttribute('aria-busy'"));
    assert.ok(stamp.includes('this.lastFocus'));
    assert.ok(stamp.includes('this.select.focus()'));
});

check('RDP simplification keeps endpoints', () => {
    const line = [[0, 0], [1, 0.01], [2, 0], [3, 0.01], [4, 0]];
    const simplified = geometry.simplifyRdp(line, 0.1);
    assert.deepEqual(simplified[0], [0, 0]);
    assert.deepEqual(simplified[simplified.length - 1], [4, 0]);
    assert.ok(simplified.length < line.length);
});

check('smoothStroke preserves the first and last points', () => {
    const points = [[0, 0], [10, 20], [20, 0], [30, 20]];
    const smooth = geometry.smoothStroke(points, 4);
    assert.deepEqual(smooth[0], [0, 0]);
    assert.deepEqual(smooth[smooth.length - 1], [30, 20]);
    assert.ok(smooth.length > points.length);
});

check('strokeHit finds ink on the line and ignores far points', () => {
    const points = [[0.2, 0.2], [0.8, 0.8]];
    assert.equal(geometry.strokeHit(points, 0.5, 0.5, 1000, 1000, 8), true);
    assert.equal(geometry.strokeHit(points, 0.5, 0.1, 1000, 1000, 8), false);
});

check('distanceToSegment clamps to the segment ends', () => {
    assert.equal(Math.round(geometry.distanceToSegment(-3, 0, 0, 0, 10, 0)), 3);
    assert.equal(Math.round(geometry.distanceToSegment(13, 4, 0, 0, 10, 0)), 5);
});

check('uid returns unique values', () => {
    const ids = new Set(Array.from({ length: 50 }, () => geometry.uid('s')));
    assert.equal(ids.size, 50);
});

console.log(`\n${checks} e-sign v2 checks passed.`);
