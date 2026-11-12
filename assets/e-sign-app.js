/* E-Office signing workspace.
 * Kept in a separate classic script so the page can be cached/versioned and
 * the browser-only flow can be syntax-checked independently. */
'use strict';

const CONFIG = Object.assign({
    PDF_URL: '',
    PDF_URL_1: '',
    SCALE: 2.5,
    STAMP_URL: 'e-stamp/template_stamp.png',
    workerUrl: '../assets/vendor/pdfjs/pdf.worker.min.js'
}, window.ESIGN_CONFIG || {});
const DOC = CONFIG.document || {};
const DEPARTMENTS = Array.isArray(CONFIG.departments) ? CONFIG.departments : [];
const ESIGN_DOC_ID = Number(DOC.id) || 0;

let currentPDF = null;
let sourceBytes = null;
let documentRevision = null;
let scale = Number(CONFIG.SCALE) || 2.5;
let currentTool = 'hand';
let whiteoutWarningAccepted = false;
const TOOL_WIDTHS = {pen: 2, whiteout: 12, eraser: 20};
const TOOL_COLORS = {pen: '#000000', whiteout: '#ffffff'};
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let documentHistory = {};
let pageMetrics = {};
let renderedPages = new Set();
let renderTasks = {};
let renderGeneration = 0;
let pageObserver = null;
let currentPage = 1;
let zoomLevel = 1;
let currentStampDepartment = '';
let stampOpener = null;
let stampIntentConfirmed = false;
let stampIntentResolver = null;
let stampIntentOpener = null;
const dialogOpeners = new Map();
let savingDocument = false;
let loadingDocument = false;
let dirty = false;
let savedAt = null;
let savedRevision = null;
let lastRetry = null;
let receiptScopes = null;
let appStarted = false;
let scrollFrame = 0;
const stampRenderQueue = new StampRenderQueue();

function byId(id) { return document.getElementById(id); }

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function shortRevision(value) {
    const text = String(value || '');
    return text ? text.slice(0, 10) : '—';
}

function formatDisplayDate(value) {
    if (!value) return '';
    const text = String(value);
    const normalized = text.includes('T') ? text : text.replace(' ', 'T');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return text;
    try {
        return new Intl.DateTimeFormat('th-TH', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok'
        }).format(date);
    } catch (error) {
        return text;
    }
}

function formatThaiDate(date = new Date()) {
    try {
        return new Intl.DateTimeFormat('th-TH', {
            day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Bangkok'
        }).format(date);
    } catch (error) {
        return date.toLocaleDateString('th-TH');
    }
}

function formatClock(date = new Date()) {
    try {
        return new Intl.DateTimeFormat('th-TH', {
            hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok'
        }).format(date);
    } catch (error) {
        return date.toTimeString().slice(0, 5);
    }
}

function currentScopeDepartments() {
    return Object.values(documentHistory).flat().filter(action => action.tool === 'stamp' && action.department);
}

function pendingReceiptCount() {
    return currentScopeDepartments().filter(action => !action.receiptRegistered && (receiptScopes === null || receiptScopes.includes(action.department))).length;
}

function markDirty() {
    dirty = true;
    stampIntentConfirmed = false;
    byId('save-success')?.classList.add('hidden');
    positionToast();
    updateSaveState();
}

async function loadReceiptScopes() {
    const docId = (typeof ESIGN_DOC_ID !== 'undefined') ? ESIGN_DOC_ID : 0;
    const response = await fetch(`receipt_scopes.php?Doc_Id=${encodeURIComponent(docId)}`, {cache: 'no-store', credentials: 'same-origin'});
    const result = await response.json();
    if (!response.ok || result.status !== 'success' || !Array.isArray(result.departments)) {
        const failure = new Error(result.message || 'โหลดบทบาทเลขาไม่สำเร็จ กรุณาลองบันทึกอีกครั้ง');
        failure.status = response.status;
        throw failure;
    }
    if (typeof receiptScopes !== 'undefined') receiptScopes = result.departments;
    return result.departments;
}

        // --- 2. INITIALIZATION ---

function updateSaveState() {
    const button = byId('btn-save');
    const state = byId('save-state');
    if (!button || !state) return;
    const pending = pendingReceiptCount();
    const pdfLibReady = typeof PDFLib !== 'undefined';
    const download = byId('btn-download');
    if (download) download.disabled = !pdfLibReady || !currentPDF || savingDocument;
    const canSave = Boolean(pdfLibReady && currentPDF && documentRevision && !savingDocument && (dirty || pending > 0));
    button.disabled = !canSave;
    button.setAttribute('aria-busy', savingDocument ? 'true' : 'false');
    state.classList.remove('save-state--dirty', 'save-state--saved');

    let text = 'พร้อมลงนาม';
    if (savingDocument) {
        text = 'กำลังบันทึก...';
    } else if (!pdfLibReady) {
        text = 'ตัวสร้าง PDF ไม่พร้อม กรุณาโหลดหน้าใหม่';
    } else if (!currentPDF) {
        text = 'ยังไม่มีเอกสาร';
    } else if (!documentRevision) {
        text = 'ไม่พบ revision ของเอกสาร';
    } else if (dirty) {
        text = `ยังไม่บันทึก${pending ? ` • receipt ค้าง ${pending}` : ''}`;
        state.classList.add('save-state--dirty');
    } else if (savedAt) {
        text = `บันทึกล่าสุด ${formatDisplayDate(savedAt)} • ${shortRevision(savedRevision)}${pending ? ` • receipt ค้าง ${pending}` : ''}`;
        state.classList.add(pending ? 'save-state--dirty' : 'save-state--saved');
    } else if (pending > 0) {
        text = `receipt ค้างลงทะเบียน ${pending}`;
        state.classList.add('save-state--dirty');
    } else if (DOC.mySigned) {
        text = `คุณลงนามแล้ว${DOC.mySignedDate ? ` • ${DOC.mySignedDate}` : ''}`;
        state.classList.add('save-state--saved');
    } else {
        text = 'แตะปากกาหรือประทับตราเพื่อลงนาม';
    }
    state.textContent = text;
    state.title = text;
    button.title = canSave ? 'ลงนามและบันทึกเอกสาร' : 'ยังไม่มีลายเซ็นใหม่ที่ต้องบันทึก';
}

function hydrateDocumentHeader() {
    if (!DOC || !DOC.id) return;
    const number = byId('doc-number');
    const name = byId('doc-name');
    const badge = byId('doc-status-badge');
    if (number) number.textContent = DOC.number || 'ไม่มีเลขที่หนังสือ';
    if (name) name.textContent = DOC.name || 'เอกสาร';
    if (badge) {
        badge.textContent = DOC.mySigned ? 'ลงนามแล้ว' : 'รอลงนาม';
        badge.classList.toggle('status-badge--signed', Boolean(DOC.mySigned));
    }
    document.title = `${DOC.number ? DOC.number + ' • ' : ''}${DOC.name || 'ลงนามเอกสาร'} | E-Office`;
}

function startApp() {
    if (appStarted) return;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startApp, {once: true});
        return;
    }
    if (!window.pdfjsLib) return;
    appStarted = true;
    try {
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    } catch (error) {
        console.warn('Icon rendering unavailable', error);
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = window.pdfjsWorkerUrl || CONFIG.workerUrl;
    hydrateDocumentHeader();
    bindUi();
    loadServerDocument();
}

function visibleDialogs() {
    return [...document.querySelectorAll('[role="dialog"]')].filter(dialog => !dialog.classList.contains('hidden'));
}

function focusableElements(container) {
    return [...container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.hidden && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
}

function rememberDialogOpener(id) {
    if (!dialogOpeners.has(id)) dialogOpeners.set(id, document.activeElement);
}

function restoreDialogFocus(id) {
    const opener = dialogOpeners.get(id);
    dialogOpeners.delete(id);
    if (opener && typeof opener.focus === 'function') opener.focus();
}

function focusFirstDialogControl(dialog) {
    if (!dialog || dialog.classList.contains('hidden')) return;
    const first = focusableElements(dialog)[0];
    if (first) first.focus();
}

function bindUi() {
    const stampSelect = byId('stamp-text-1');
    if (stampSelect) {
        stampSelect.addEventListener('change', () => {
            byId('stamp-department-error')?.classList.add('hidden');
            generateStampPreview();
        });
    }
    ['stamp-text-2', 'stamp-text-3', 'stamp-text-4'].forEach(id => {
        byId(id)?.addEventListener('input', generateStampPreview);
    });
    document.addEventListener('keydown', event => {
        const dialogs = visibleDialogs();
        if (dialogs.length && event.key === 'Tab') {
            const dialog = dialogs.at(-1);
            const items = focusableElements(dialog);
            if (!items.length) { event.preventDefault(); return; }
            const first = items[0];
            const last = items.at(-1);
            const active = document.activeElement;
            if (event.shiftKey) {
                if (active === first || !dialog.contains(active)) { event.preventDefault(); last.focus(); }
            } else if (active === last || !dialog.contains(active)) {
                event.preventDefault();
                first.focus();
            }
        }
        if (event.key === 'Escape') {
            const dialog = dialogs.at(-1);
            if (!dialog) return;
            event.preventDefault();
            if (dialog.id === 'stamp-intent-modal') resolveStampIntent(false);
            else if (dialog.id === 'stamp-modal') closeStampModal();
            else if (dialog.id === 'conflict-modal') hideConflictModal();
            else if (dialog.id === 'audit-overlay') closeAuditDrawer();
        }
        if (!dialogs.length && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.target.matches('input,textarea,select')) {
            event.preventDefault();
            undoLastAction();
        }
    });
    byId('document-container')?.addEventListener('scroll', () => {
        if (scrollFrame) return;
        scrollFrame = requestAnimationFrame(() => {
            scrollFrame = 0;
            updatePageFromScroll();
        });
    }, {passive: true});
    updateSaveState();
    setZoom(1);
    window.addEventListener('focus', refreshReceiptScopesIfNeeded);
    window.addEventListener('load', updateSaveState);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshReceiptScopesIfNeeded(); });
    window.addEventListener('resize', positionToast, {passive: true});
}

async function refreshReceiptScopesIfNeeded() {
    const savedStamps = currentScopeDepartments().filter(action => action.saved && !action.receiptRegistered);
    if (!savedStamps.length) return;
    try {
        await loadReceiptScopes();
        updateSaveState();
    } catch (error) { /* keep the last known scopes */ }
}

window.addEventListener('pdfjsready', startApp);
window.addEventListener('pdfjsfailed', () => {
    const showFailure = () => {
        showLoading(false);
        showLoadFailure('โหลดโปรแกรมอ่าน PDF ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่');
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showFailure, {once: true});
    else showFailure();
});
document.addEventListener('DOMContentLoaded', () => {
    if (window.pdfjsLib) startApp();
    else setTimeout(() => {
        if (!appStarted) {
            startApp();
            if (!window.pdfjsLib) showLoadFailure('โหลดโปรแกรมอ่าน PDF ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่');
        }
    }, 8000);
});
window.addEventListener('load', () => { if (window.pdfjsLib) startApp(); });
window.addEventListener('beforeunload', event => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
    return '';
});

/* --- Loading and rendering ------------------------------------------------ */

async function fetchPDF(url) {
    const response = await fetch(url, {method: 'GET', credentials: 'include', cache: 'no-store'});
    if (!response.ok) {
        let message = `โหลดเอกสารไม่สำเร็จ (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data && typeof data.message === 'string' && data.message) message = data.message;
        } catch (error) { /* response was not JSON */ }
        const failure = new Error(message);
        failure.status = response.status;
        throw failure;
    }
    documentRevision = response.headers.get('X-Document-Revision');
    const blob = await response.blob();
    return new Uint8Array(await blob.arrayBuffer());
}

async function loadServerDocument() {
    if (savingDocument || loadingDocument) return;
    loadingDocument = true;
    hideErrorBanner();
    hideSessionBanner();
    showLoading(true, 'กำลังดึงไฟล์จาก Server...');
    try {
        const data = await fetchPDF(CONFIG.PDF_URL || CONFIG.PDF_URL_1);
        await renderPDF(data);
        if (!documentRevision) {
            showErrorBanner('ไม่พบ revision ของเอกสาร', 'ระบบแสดงเอกสารได้ แต่จะไม่สามารถบันทึกได้จนกว่าจะโหลดหน้าใหม่สำเร็จ', loadServerDocument);
        }
    } catch (error) {
        showLoadFailure(error.message, error.status);
    } finally {
        loadingDocument = false;
        showLoading(false);
        updateSaveState();
    }
}

function showLoadFailure(message, status) {
    renderGeneration++;
    currentPDF = null;
    sourceBytes = null;
    documentRevision = null;
    loadingDocument = false;
    if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
    byId('pages-wrapper')?.replaceChildren();
    showLoading(false);
    byId('empty-state')?.classList.remove('hidden');
    if (Number(status) === 401) showSessionBanner();
    showErrorBanner('โหลดเอกสารไม่สำเร็จ', message || 'ไม่สามารถโหลดเอกสารได้', loadServerDocument);
    updateSaveState();
}

async function renderPDF(data) {
    const generation = ++renderGeneration;
    const container = byId('pages-wrapper');
    if (!container) throw new Error('ไม่พบพื้นที่แสดงเอกสาร');
    if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
    container.innerHTML = '';
    byId('document-container')?.scrollTo({top: 0, left: 0});
    documentHistory = {};
    dirty = false;
    stampIntentConfirmed = false;
    savedAt = null;
    savedRevision = null;
    receiptScopes = null;
    updateSaveState();
    pageMetrics = {};
    renderedPages = new Set();
    renderTasks = {};
    currentPage = 1;
    resetZoom();
    sourceBytes = data.slice();
    const loadedPdf = await pdfjsLib.getDocument({data: data.slice(), isEvalSupported: false}).promise;
    if (generation !== renderGeneration) return;
    currentPDF = loadedPdf;
    const pdf = currentPDF;
    byId('empty-state')?.classList.add('hidden');
    const firstViewport = (await pdf.getPage(1)).getViewport({scale: 1});
    const pixelBudget = 8000000;
    const adaptiveScale = Math.sqrt(pixelBudget / Math.max(1, firstViewport.width * firstViewport.height));
    scale = Math.min(Number(CONFIG.SCALE) || 2.5, Math.max(1, adaptiveScale));
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        if (generation !== renderGeneration) return;
        const page = await pdf.getPage(pageNum);
        if (generation !== renderGeneration) return;
        const viewport = page.getViewport({scale});
        pageMetrics[pageNum] = {
            width: viewport.width,
            height: viewport.height,
            widthPt: viewport.width / scale,
            heightPt: viewport.height / scale,
            rotation: Number(page.rotate) || 0
        };
        createPagePlaceholder(pageNum, viewport, generation);
    }
    updatePageIndicator(1);
    await renderPage(1, generation);
    if (generation !== renderGeneration) return;
    setupPageObserver();
    setTool('hand');
}

function createPagePlaceholder(pageNum, viewport, generation = renderGeneration) {
    const wrapper = document.createElement('div');
    wrapper.className = 'page-container bg-white page-placeholder';
    wrapper.id = `page-wrap-${pageNum}`;
    wrapper.dataset.page = String(pageNum);
    wrapper.dataset.generation = String(generation);
    wrapper.style.maxWidth = `${viewport.width}px`;
    wrapper.style.width = '100%';
    wrapper.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
    wrapper.innerHTML = `<span>หน้า ${pageNum}</span>`;
    byId('pages-wrapper').appendChild(wrapper);
}

async function renderPage(pageNum, generation = renderGeneration) {
    if (!currentPDF || renderedPages.has(pageNum) || generation !== renderGeneration) return;
    const taskKey = `${generation}:${pageNum}`;
    if (renderTasks[taskKey]) return renderTasks[taskKey];
    const wrapper = byId(`page-wrap-${pageNum}`);
    const metrics = pageMetrics[pageNum];
    if (!wrapper || !metrics) return;
    renderTasks[taskKey] = (async () => {
        const page = await currentPDF.getPage(pageNum);
        if (generation !== renderGeneration) return;
        const viewport = page.getViewport({scale});
        wrapper.classList.remove('page-placeholder');
        wrapper.style.aspectRatio = '';
        wrapper.innerHTML = '';

        const pdfCanvas = document.createElement('canvas');
        pdfCanvas.className = 'pdf-canvas';
        pdfCanvas.id = `pdf-render-${pageNum}`;
        pdfCanvas.height = viewport.height;
        pdfCanvas.width = viewport.width;

        const drawCanvas = document.createElement('canvas');
        drawCanvas.className = 'drawing-canvas';
        drawCanvas.id = `draw-layer-${pageNum}`;
        drawCanvas.height = viewport.height;
        drawCanvas.width = viewport.width;
        drawCanvas.setAttribute('data-page', String(pageNum));

        if (generation !== renderGeneration) return;
        wrapper.appendChild(pdfCanvas);
        wrapper.appendChild(drawCanvas);
        await page.render({canvasContext: pdfCanvas.getContext('2d'), viewport}).promise;
        if (generation !== renderGeneration) return;
        setupDrawingEvents(drawCanvas, pageNum);
        if (documentHistory[pageNum]?.length) await redrawCanvas(pageNum, documentHistory[pageNum]);
        if (generation !== renderGeneration) return;
        renderedPages.add(pageNum);
        wrapper.dataset.rendered = '1';
    })();
    try {
        await renderTasks[taskKey];
    } finally {
        delete renderTasks[taskKey];
    }
}

function setupPageObserver() {
    if (pageObserver) pageObserver.disconnect();
    const wrappers = [...document.querySelectorAll('#pages-wrapper .page-container')];
    if (!('IntersectionObserver' in window)) {
        wrappers.forEach(wrapper => renderPage(Number(wrapper.dataset.page)));
        return;
    }
    const observerGeneration = renderGeneration;
    pageObserver = new IntersectionObserver(entries => {
        if (observerGeneration !== renderGeneration) return;
        entries.forEach(entry => {
            const pageNum = Number(entry.target.dataset.page);
            if (entry.isIntersecting) {
                renderPage(pageNum).catch(error => showToast(error.message || 'โหลดหน้าเอกสารไม่สำเร็จ', 'error'));
            } else {
                releasePage(pageNum);
            }
        });
    }, {root: byId('document-container'), rootMargin: '1200px 0px'});
    wrappers.forEach(wrapper => pageObserver.observe(wrapper));
}

function releasePage(pageNum) {
    if (!renderedPages.has(pageNum) || documentHistory[pageNum]?.length) return;
    const wrapper = byId(`page-wrap-${pageNum}`);
    const metrics = pageMetrics[pageNum];
    if (!wrapper || !metrics || wrapper.dataset.generation !== String(renderGeneration)) return;
    wrapper.classList.add('page-placeholder');
    wrapper.style.aspectRatio = `${metrics.width} / ${metrics.height}`;
    wrapper.innerHTML = `<span>หน้า ${pageNum}</span>`;
    renderedPages.delete(pageNum);
}

function updatePageIndicator(pageNum) {
    currentPage = Math.min(Math.max(1, pageNum), currentPDF?.numPages || 1);
    const total = currentPDF?.numPages || 1;
    const indicator = byId('page-indicator');
    if (indicator) indicator.textContent = `หน้า ${currentPage} / ${total}`;
    const prev = byId('page-prev'), next = byId('page-next');
    if (prev) prev.disabled = currentPage <= 1;
    if (next) next.disabled = currentPage >= total;
}

function updatePageFromScroll() {
    if (!currentPDF) return;
    const container = byId('document-container');
    if (!container) return;
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4) {
        updatePageIndicator(currentPDF.numPages);
        return;
    }
    const top = container.getBoundingClientRect().top + 40;
    let visible = 1;
    for (const wrapper of document.querySelectorAll('#pages-wrapper .page-container')) {
        const rect = wrapper.getBoundingClientRect();
        if (rect.bottom > top) { visible = Number(wrapper.dataset.page); break; }
    }
    updatePageIndicator(visible);
}

function goToRelativePage(delta) {
    const target = Math.min(Math.max(1, currentPage + delta), currentPDF?.numPages || 1);
    byId(`page-wrap-${target}`)?.scrollIntoView({behavior: 'auto', block: 'start'});
    updatePageIndicator(target);
}

function goToLastPage() {
    if (!currentPDF) return;
    byId(`page-wrap-${currentPDF.numPages}`)?.scrollIntoView({behavior: 'auto', block: 'start'});
    updatePageIndicator(currentPDF.numPages);
}

function setZoom(value) {
    zoomLevel = Math.min(2.5, Math.max(0.5, Number(value) || 1));
    const wrapper = byId('pages-wrapper');
    if (wrapper) wrapper.style.zoom = String(zoomLevel);
}

function changeZoom(delta) { setZoom(zoomLevel + delta); }
function resetZoom() { setZoom(1); }

/* --- Tool logic ----------------------------------------------------------- */

function setTool(toolName) {
    if (toolName === 'whiteout' && !whiteoutWarningAccepted) {
        const accepted = confirm(
            'ปากกาสีขาวใช้ "ปิดทับ" ข้อความเท่านั้น ไม่ได้ลบข้อมูลจริง\n\n' +
            '- ข้อความเดิมยังอยู่ในไฟล์ PDF และยังค้นหาคัดลอกได้\n' +
            '- พื้นหลังเอกสารที่ไม่ขาวสนิทจะเห็นรอยปิดทับ\n' +
            '- เอกสารราชการควรแก้ไขที่ต้นฉบับก่อนนำมาเซ็น\n\n' +
            'หากต้องการลบลายเส้นที่เขียนเอง ให้ใช้ยางลบ\n\n' +
            'ยืนยันเปิดใช้ปากกาสีขาว?'
        );
        if (!accepted) return;
        whiteoutWarningAccepted = true;
        showToast('ปากกาสีขาว: ปิดทับข้อความเท่านั้น ไม่ได้ลบข้อความจริง', 'info');
    }

    currentTool = toolName;
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    const button = byId(`btn-${toolName}`);
    if (button) button.classList.add('active');

    document.querySelectorAll('.drawing-canvas').forEach(canvas => {
        canvas.style.pointerEvents = toolName === 'hand' ? 'none' : 'auto';
        if (toolName === 'stamp') canvas.style.cursor = 'copy';
        else if (toolName === 'eraser') canvas.style.cursor = 'cell';
        else if (toolName === 'pen' || toolName === 'whiteout') canvas.style.cursor = 'crosshair';
        else canvas.style.cursor = 'default';
    });
}

function setupDrawingEvents(canvas, pageNum) {
    const ctx = canvas.getContext('2d');
    let points = [];
    let penActive = false;
    let gesture = null;
    let pendingStamp = null;

    const touchDistance = touches => Math.hypot(
        (touches[0]?.clientX || 0) - (touches[1]?.clientX || 0),
        (touches[0]?.clientY || 0) - (touches[1]?.clientY || 0)
    );
    const touchCenter = touches => ({
        x: ((touches[0]?.clientX || 0) + (touches[1]?.clientX || 0)) / 2,
        y: ((touches[0]?.clientY || 0) + (touches[1]?.clientY || 0)) / 2
    });
    const beginGesture = event => {
        pendingStamp = null;
        if (isDrawing) {
            isDrawing = false;
            redrawCanvas(pageNum, documentHistory[pageNum] || []).catch(error => showToast(error.message, 'error'));
        }
        const center = touchCenter(event.touches);
        const container = typeof byId === 'function' ? byId('document-container') : null;
        gesture = {
            distance: Math.max(1, touchDistance(event.touches)),
            zoom: zoomLevel,
            center,
            scrollLeft: container?.scrollLeft || 0,
            scrollTop: container?.scrollTop || 0
        };
    };

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY};
    };

    const startDraw = (e) => {
        if (currentTool === 'hand' || savingDocument || stampRenderQueue.pending.size) return;
        if (e.cancelable) e.preventDefault();
        const {x, y} = getPos(e);

        if (currentTool === 'stamp') {
            const stampSource = CONFIG.STAMP_URL;
            const stampDepartment = currentStampDepartment;
            const pageHistory = documentHistory;
            stampRenderQueue.add(() => new Promise((resolve, reject) => {
                const stampToDraw = new Image();
                const timeout = setTimeout(() => {
                    stampToDraw.onload = null;
                    stampToDraw.onerror = null;
                    reject(new Error('โหลดรูปตราเกินเวลา กรุณาวางตราใหม่'));
                }, 15000);
                stampToDraw.crossOrigin = 'Anonymous';
                stampToDraw.onerror = () => {
                    clearTimeout(timeout);
                    reject(new Error('โหลดรูปตราไม่สำเร็จ กรุณาวางตราใหม่ก่อนบันทึก'));
                };
                stampToDraw.onload = () => {
                    clearTimeout(timeout);
                    try {
                        if (pageHistory !== documentHistory) { resolve(); return; }
                        const pageWidth = (typeof pageMetrics !== 'undefined' && pageMetrics[pageNum]?.width) || canvas.width || 1488;
                        const pageHeight = (typeof pageMetrics !== 'undefined' && pageMetrics[pageNum]?.height) || canvas.height || 2105;
                        const natW = stampToDraw.naturalWidth || 100;
                        const natH = stampToDraw.naturalHeight || 50;
                        const aspectRatio = natH / natW;
                        const stampW = pageWidth * 0.30;
                        const stampH = stampW * aspectRatio;
                        const drawX = x - (stampW / 2);
                        const drawY = y - (stampH / 2);
                        ctx.globalCompositeOperation = 'source-over';
                        ctx.drawImage(stampToDraw, drawX, drawY, stampW, stampH);
                        if (!documentHistory[pageNum]) documentHistory[pageNum] = [];
                        documentHistory[pageNum].push({
                            tool: 'stamp', x: drawX / pageWidth, y: drawY / pageHeight, w: stampW / pageWidth, h: stampH / pageHeight,
                            src: stampSource, department: stampDepartment,
                            saved: false, receiptRegistered: false
                        });
                        if (typeof markDirty === 'function') markDirty();
                        resolve();
                    } catch (error) { reject(error); }
                };
                stampToDraw.src = stampSource;
            })).catch(error => showToast(error.message, 'error'));
            return;
        }

        isDrawing = true;
        lastX = x;
        lastY = y;
        points = [{x, y}];
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const toolWidth = (TOOL_WIDTHS[currentTool] || TOOL_WIDTHS.pen) * (scale / 1.5);
        if (currentTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = toolWidth;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.lineWidth = toolWidth;
            ctx.strokeStyle = TOOL_COLORS[currentTool] || TOOL_COLORS.pen;
        }
        if (typeof markDirty === 'function') markDirty();
    };

    const draw = (e) => {
        if (!isDrawing || savingDocument || currentTool === 'hand' || currentTool === 'stamp') return;
        if (e.cancelable) e.preventDefault();
        const {x, y} = getPos(e);
        ctx.quadraticCurveTo(lastX, lastY, (lastX + x) / 2, (lastY + y) / 2);
        ctx.stroke();
        points.push({x, y});
        lastX = x;
        lastY = y;
    };

    const stopDraw = () => {
        if (!isDrawing) return;
        isDrawing = false;
        ctx.closePath();
        if (!documentHistory[pageNum]) documentHistory[pageNum] = [];
        const pageWidth = canvas.width || 1;
        const pageHeight = canvas.height || 1;
        documentHistory[pageNum].push({
            tool: currentTool,
            points: points.map(point => ({x: point.x / pageWidth, y: point.y / pageHeight})),
            color: TOOL_COLORS[currentTool] || TOOL_COLORS.pen,
            width: ((TOOL_WIDTHS[currentTool] || TOOL_WIDTHS.pen) * (scale / 1.5)) / pageWidth
        });
        if (typeof markDirty === 'function') markDirty();
    };

    canvas.addEventListener('mousedown', event => { if (!penActive) startDraw(event); });
    canvas.addEventListener('mousemove', event => { if (!penActive) draw(event); });
    canvas.addEventListener('mouseup', event => { if (!penActive) stopDraw(event); });
    canvas.addEventListener('mouseout', stopDraw);
    canvas.addEventListener('touchstart', event => {
        if (penActive) return;
        if ((event.touches?.length || 0) >= 2) {
            event.preventDefault();
            if (!gesture) beginGesture(event);
            return;
        }
        if ((event.touches?.length || 0) === 1) {
            if (currentTool === 'stamp') pendingStamp = {clientX: event.touches[0].clientX, clientY: event.touches[0].clientY};
            else startDraw(event);
        }
    }, {passive: false});
    canvas.addEventListener('touchmove', event => {
        const count = event.touches?.length || 0;
        if (count >= 2) {
            event.preventDefault();
            if (!gesture) beginGesture(event);
            if (!gesture) return;
            const ratio = touchDistance(event.touches) / gesture.distance;
            setZoom(gesture.zoom * ratio);
            const center = touchCenter(event.touches);
            const container = typeof byId === 'function' ? byId('document-container') : null;
            if (container) {
                container.scrollLeft = gesture.scrollLeft - (center.x - gesture.center.x);
                container.scrollTop = gesture.scrollTop - (center.y - gesture.center.y);
            }
            return;
        }
        if (gesture) return;
        if (count === 1) draw(event);
    }, {passive: false});
    canvas.addEventListener('touchend', event => {
        if (gesture) {
            if ((event.touches?.length || 0) < 2) gesture = null;
            return;
        }
        if (pendingStamp) {
            const stamp = pendingStamp;
            pendingStamp = null;
            startDraw({clientX: stamp.clientX, clientY: stamp.clientY, cancelable: false});
            return;
        }
        stopDraw();
    });
    canvas.addEventListener('touchcancel', event => {
        gesture = null;
        pendingStamp = null;
        stopDraw();
    });
    // Stylus support without duplicating compatibility mouse events.
    canvas.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'pen') return;
        penActive = true;
        try { canvas.setPointerCapture?.(event.pointerId); } catch (error) { /* optional */ }
        startDraw(event);
    });
    canvas.addEventListener('pointermove', event => { if (event.pointerType === 'pen' && penActive) draw(event); });
    const endPen = event => {
        if (event.pointerType !== 'pen') return;
        penActive = false;
        stopDraw(event);
    };
    canvas.addEventListener('pointerup', endPen);
    canvas.addEventListener('pointercancel', endPen);
}

function undoLastAction() {
    if (savingDocument || isDrawing || stampRenderQueue.pending.size) return;
    let lastPageNum = -1;
    for (const page of Object.keys(documentHistory)) {
        if (documentHistory[page] && documentHistory[page].length > 0) lastPageNum = page;
    }
    if (lastPageNum === -1) {
        showToast('ไม่มีการกระทำที่สามารถย้อนกลับได้', 'info');
        return;
    }
    const actions = documentHistory[lastPageNum];
    const lastAction = actions[actions.length - 1];
    if (lastAction?.saved && !confirm('รายการนี้ถูกบันทึกไปแล้ว การย้อนกลับจะแก้ไฟล์ PDF แต่ไม่ยกเลิก receipt ที่ลงทะเบียนไว้ ต้องการดำเนินการต่อหรือไม่?')) return;
    const remaining = actions.slice(0, -1);
    redrawCanvas(lastPageNum, remaining)
        .then(applied => {
            if (applied) {
                if (typeof markDirty === 'function') markDirty();
                showToast('ย้อนกลับการกระทำล่าสุด', 'info');
            }
        })
        .catch(error => showToast(error.message, 'error'));
}

function redrawCanvas(pageNum, actions = (documentHistory[pageNum] || []).slice()) {
    const canvas = document.getElementById(`draw-layer-${pageNum}`);
    const history = documentHistory;
    const generation = (typeof renderGeneration !== 'undefined') ? renderGeneration : null;
    return stampRenderQueue.add(async () => {
        if (!canvas) throw new Error('ไม่พบหน้าที่ต้องวาดใหม่');
        const layer = document.createElement('canvas');
        layer.width = canvas.width;
        layer.height = canvas.height;
        const ctx = layer.getContext('2d');
        const pageWidth = canvas.width || 1;
        const pageHeight = canvas.height || 1;
        for (const action of actions) {
            if (action.tool === 'stamp') {
                const img = await new Promise((resolve, reject) => {
                    const image = new Image();
                    const timeout = setTimeout(() => {
                        image.onload = null;
                        image.onerror = null;
                        reject(new Error('โหลดรูปตราเกินเวลา ย้อนกลับไม่สำเร็จ'));
                    }, 15000);
                    image.onload = () => { clearTimeout(timeout); resolve(image); };
                    image.onerror = () => { clearTimeout(timeout); reject(new Error('โหลดรูปตราไม่สำเร็จ ย้อนกลับไม่สำเร็จ')); };
                    image.src = action.src;
                });
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(img, action.x * pageWidth, action.y * pageHeight, action.w * pageWidth, action.h * pageHeight);
            } else {
                ctx.beginPath();
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.lineWidth = (action.width || 0.001) * pageWidth;
                if (action.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
                else {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.strokeStyle = action.color;
                }
                if (action.points.length > 0) {
                    const firstX = action.points[0].x * pageWidth;
                    const firstY = action.points[0].y * pageHeight;
                    ctx.moveTo(firstX, firstY);
                    let pLastX = firstX;
                    let pLastY = firstY;
                    for (let i = 1; i < action.points.length; i++) {
                        const p = action.points[i];
                        const px = p.x * pageWidth;
                        const py = p.y * pageHeight;
                        ctx.quadraticCurveTo(pLastX, pLastY, (pLastX + px) / 2, (pLastY + py) / 2);
                        pLastX = px;
                        pLastY = py;
                    }
                    ctx.stroke();
                }
                ctx.closePath();
            }
        }
        if ((generation !== null && generation !== renderGeneration) || history !== documentHistory || canvas !== document.getElementById(`draw-layer-${pageNum}`)) return false;
        const visible = canvas.getContext('2d');
        visible.globalCompositeOperation = 'source-over';
        visible.clearRect(0, 0, canvas.width, canvas.height);
        visible.drawImage(layer, 0, 0);
        documentHistory[pageNum] = actions;
        return true;
    });
}

// --- 5. SAVE & DOWNLOAD ---

/* --- Signature validation ------------------------------------------------- */

function hasVisibleNonWhitePixel(pixels) {
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] > 0 && (pixels[i] < 251 || pixels[i + 1] < 251 || pixels[i + 2] < 251)) return true;
    }
    return false;
}

function hasVisibleSignature() {
    return Object.entries(documentHistory).some(([page, actions]) => {
        const hasInkAction = actions.some(action => action.tool === 'stamp' ||
            (action.tool === 'pen' && action.points?.some(point =>
                point.x !== action.points[0].x || point.y !== action.points[0].y)));
        if (!hasInkAction) return false;
        const canvas = document.getElementById(`draw-layer-${page}`);
        if (!canvas) return false;
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        return hasVisibleNonWhitePixel(pixels);
    });
}

function hasVisiblePenSignature() {
    return Object.entries(documentHistory).some(([page, actions]) => {
        if (!actions.some(action => action.tool === 'pen' && action.points?.some(point =>
            point.x !== action.points[0].x || point.y !== action.points[0].y))) return false;
        const visible = document.getElementById(`draw-layer-${page}`);
        if (!visible) return false;
        const layer = document.createElement('canvas');
        layer.width = visible.width;
        layer.height = visible.height;
        const pageWidth = layer.width || 1;
        const pageHeight = layer.height || 1;
        const ctx = layer.getContext('2d');
        for (const action of actions) {
            if (!['pen', 'eraser', 'whiteout'].includes(action.tool) || !action.points?.length) continue;
            ctx.beginPath();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = (action.width || 0.001) * pageWidth;
            ctx.globalCompositeOperation = action.tool === 'eraser' ? 'destination-out' : 'source-over';
            ctx.strokeStyle = action.color || '#000000';
            let last = {x: action.points[0].x * pageWidth, y: action.points[0].y * pageHeight};
            ctx.moveTo(last.x, last.y);
            for (const point of action.points.slice(1)) {
                const px = point.x * pageWidth;
                const py = point.y * pageHeight;
                ctx.quadraticCurveTo(last.x, last.y, (last.x + px) / 2, (last.y + py) / 2);
                last = {x: px, y: py};
            }
            ctx.stroke();
            ctx.closePath();
        }
        return hasVisibleNonWhitePixel(ctx.getImageData(0, 0, layer.width, layer.height).data);
    });
}

/* --- Save and export ------------------------------------------------------ */

// UPDATE: Function to Save to Server
async function sha256Blob(blob) {
    try {
        if (!blob || typeof blob.arrayBuffer !== 'function' || !globalThis.crypto?.subtle) return '';
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    } catch (error) {
        console.warn('SHA-256 unavailable', error);
        return '';
    }
}

async function saveToServer() {
    if (!currentPDF || savingDocument || (typeof loadingDocument !== 'undefined' && loadingDocument) || isDrawing) return;
    if (!documentRevision) {
        if (typeof showErrorBanner === 'function') showErrorBanner('ไม่พบ revision ของเอกสาร', 'กรุณาโหลดหน้าใหม่ก่อนบันทึก', loadServerDocument);
        return;
    }
    savingDocument = true;
    if (typeof updateSaveState === 'function') updateSaveState();
    showLoading(true, 'กำลังส่งข้อมูลไปยัง Server...');

    try {
        await stampRenderQueue.wait();
        if (!hasVisibleSignature()) throw new Error('กรุณาลงนามหรือประทับตราก่อนบันทึก');
        const penSignature = hasVisiblePenSignature();
        const hasStampInk = Object.values(documentHistory).flat().some(action => action.tool === 'stamp');
        if (hasStampInk && !penSignature && typeof requestStampOnlyConfirmation === 'function') {
            const accepted = await requestStampOnlyConfirmation();
            if (!accepted) return;
        }
        const stamps = Object.values(documentHistory).flat().filter(action => action.tool === 'stamp' && action.department);
        const pendingReceipts = stamps.filter(action => !action.receiptRegistered);
        let registeredDepartments = [];
        if (pendingReceipts.length) {
            const scopes = await loadReceiptScopes();
            registeredDepartments = [...new Set(pendingReceipts.map(action => action.department))]
                .filter(department => scopes.includes(department));
            if (registeredDepartments.length && !confirm(`ยืนยันลงทะเบียนรับเอกสารในนามเลขาฝ่าย:\n${registeredDepartments.join('\n')}\nระบบจะบันทึกประวัติการรับและเพิ่มรองฝ่ายอัตโนมัติเมื่อบันทึกสำเร็จ`)) return;
        }

        const blob = await generatePDFBlob();
        const config = (typeof CONFIG !== 'undefined' && CONFIG) ? CONFIG : {};
        const doc = (typeof DOC !== 'undefined' && DOC) ? DOC : {};
        const year = config.year || doc.year || '';
        const formData = new FormData();
        formData.append('file', blob, config.fileName || doc.fileName || 'signed_document.pdf');
        formData.append('year', year);
        formData.append('Doc_Id', String(config.docId || doc.id || 0));
        formData.append('expected_user_id', String(doc.userId || 0));
        formData.append('revision', documentRevision || '');
        formData.append('confirm_signature', '1');
        if (penSignature) formData.append('confirm_pen_signature', '1');
        formData.append('receipt_departments', JSON.stringify(registeredDepartments));
        if (registeredDepartments.length) formData.append('confirm_receipt', '1');

        const stampDepartments = [...new Set(stamps.map(action => action.department))];
        const signatureMethod = penSignature ? (stampDepartments.length ? 'mixed' : 'pen') : (stampDepartments.length ? 'stamp' : '');
        formData.append('signature_method', signatureMethod);
        formData.append('signature_departments', JSON.stringify(stampDepartments));
        const clientHash = typeof sha256Blob === 'function' ? await sha256Blob(blob) : '';
        if (clientHash) formData.append('client_sha256', clientHash);

        const SERVER_URL = 'upload_pdf.php';
        showLoading(true, 'กำลังส่งข้อมูลไปยัง Server...');
        const response = await fetch(SERVER_URL, {method: 'POST', body: formData});
        let result = {};
        try { result = await response.json(); } catch (error) { /* handled below */ }
        if (!response.ok) {
            const failure = new Error(result.message || `Server Error: ${response.status}`);
            failure.status = response.status;
            failure.code = result.code;
            throw failure;
        }
        if (result.status !== 'success') throw new Error(result.message || 'บันทึกไม่สำเร็จ');

        documentRevision = result.revision || documentRevision;
        const confirmedReceipts = result.registered_receipt_departments || [];
        stamps.forEach(action => {
            action.saved = true;
            if (confirmedReceipts.includes(action.department)) action.receiptRegistered = true;
        });
        if (typeof markDocumentSaved === 'function' && typeof byId === 'function') markDocumentSaved(result);
        showToast(result.auto_sent_user_ids?.length ? `บันทึกเรียบร้อย และเพิ่มรองฝ่ายอัตโนมัติ ${result.auto_sent_user_ids.length} คน` : 'บันทึกการลงนามเรียบร้อย!', 'success');
    } catch (error) {
        if (typeof handleSaveError === 'function') handleSaveError(error);
        else showToast(error.message || 'การเชื่อมต่อ Server ล้มเหลว', 'error');
    } finally {
        savingDocument = false;
        showLoading(false);
        if (typeof updateSaveState === 'function') updateSaveState();
    }
}

function handleSaveError(error) {
    const message = error?.message || 'การเชื่อมต่อ Server ล้มเหลว';
    if (error?.code === 'user_changed') {
        if (typeof showErrorBanner === 'function') showErrorBanner('บัญชีผู้ใช้เปลี่ยนแล้ว', message, () => { if (typeof dirty !== 'undefined') dirty = false; window.location.reload(); });
        return;
    }
    if (Number(error?.status) === 401) {
        if (typeof showSessionBanner === 'function') showSessionBanner();
        if (typeof showErrorBanner === 'function') showErrorBanner('เซสชันหมดอายุ', message, null);
    } else if (Number(error?.status) === 403) {
        if (typeof showErrorBanner === 'function') showErrorBanner('ไม่มีสิทธิ์บันทึกเอกสาร', message, null);
    } else if (Number(error?.status) === 409 && /ใช้งานพร้อมกัน/.test(message)) {
        if (typeof showErrorBanner === 'function') showErrorBanner('เอกสารกำลังถูกใช้งาน', message, () => saveToServer());
    } else if (Number(error?.status) === 409) {
        if (typeof hideErrorBanner === 'function') hideErrorBanner();
        if (typeof showConflictModal === 'function') showConflictModal();
        if (typeof showToast === 'function') showToast(message, 'error');
    } else {
        if (typeof showErrorBanner === 'function') showErrorBanner('บันทึกไม่สำเร็จ', message, () => saveToServer());
        else if (typeof showToast === 'function') showToast(message, 'error');
    }
}

function markDocumentSaved(result) {
    dirty = false;
    savedAt = result.signed_at || new Date().toISOString();
    savedRevision = result.revision || documentRevision;
    const badge = byId('doc-status-badge');
    if (badge) {
        badge.textContent = 'ลงนามแล้ว';
        badge.classList.add('status-badge--signed');
    }
    hideSessionBanner();
    hideErrorBanner();
    showSaveSuccess(result);
    if (!byId('audit-overlay')?.classList.contains('hidden')) loadSignStatus();
    updateSaveState();
}

function showSaveSuccess(result) {
    const panel = byId('save-success');
    const detail = byId('save-success-detail');
    if (!panel || !detail) return;
    const pieces = [];
    if (result?.signed_at) pieces.push(`เวลา ${formatDisplayDate(result.signed_at)}`);
    if (result?.revision) pieces.push(`revision ${shortRevision(result.revision)}`);
    if (result?.registered_receipt_departments?.length) pieces.push(`ลงทะเบียนรับ ${result.registered_receipt_departments.join(', ')}`);
    detail.textContent = pieces.join(' • ') || 'ระบบบันทึกไฟล์ลงนามเรียบร้อย';
    panel.classList.remove('hidden');
    positionToast();
}

function dismissSaveSuccess() {
    byId('save-success')?.classList.add('hidden');
    positionToast();
}

async function downloadDocument() {
    if (!currentPDF || savingDocument) return;
    showLoading(true, 'กำลังประมวลผล PDF...');
    try {
        const blob = await generatePDFBlob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const base = String(CONFIG.fileName || DOC.fileName || 'signed_document.pdf').replace(/[\\/:*?"<>|]+/g, '_');
        const number = String(DOC.number || '').replace(/[\\/:*?"<>|]+/g, '_');
        anchor.href = url;
        anchor.download = (number ? `${number}_` : '') + base;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
        showErrorBanner('สร้าง PDF ไม่สำเร็จ', error.message || 'ไม่สามารถสร้างไฟล์ได้', () => downloadDocument());
    } finally {
        showLoading(false);
    }
}

async function canvasToPngBytes(canvas) {
    if (typeof canvas.toBlob === 'function') {
        return new Promise((resolve, reject) => {
            canvas.toBlob(async blob => {
                try {
                    if (!blob) { reject(new Error('สร้างภาพ overlay ไม่สำเร็จ')); return; }
                    resolve(new Uint8Array(await blob.arrayBuffer()));
                } catch (error) { reject(error); }
            }, 'image/png');
        });
    }
    const data = canvas.toDataURL('image/png');
    const binary = atob(data.split(',')[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function actionBounds(action, metrics) {
    const pageWidth = metrics?.width || 1;
    const pageHeight = metrics?.height || 1;
    if (action.tool === 'stamp') {
        return {x: action.x * pageWidth, y: action.y * pageHeight, w: action.w * pageWidth, h: action.h * pageHeight};
    }
    if (!action.points?.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of action.points) {
        const x = point.x * pageWidth;
        const y = point.y * pageHeight;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    const pad = Math.max(2, ((action.width || 0.001) * pageWidth) / 2 + 2);
    return {x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2};
}

function overlayBounds(actions, metrics) {
    let box = null;
    for (const action of actions) {
        const bounds = actionBounds(action, metrics);
        if (!bounds) continue;
        if (!box) box = {...bounds};
        else {
            const right = Math.max(box.x + box.w, bounds.x + bounds.w);
            const bottom = Math.max(box.y + box.h, bounds.y + bounds.h);
            box.x = Math.min(box.x, bounds.x);
            box.y = Math.min(box.y, bounds.y);
            box.w = right - box.x;
            box.h = bottom - box.y;
        }
    }
    if (!box) return null;
    const pad = 4;
    const x = Math.max(0, Math.floor(box.x - pad));
    const y = Math.max(0, Math.floor(box.y - pad));
    const right = Math.min(metrics.width, Math.ceil(box.x + box.w + pad));
    const bottom = Math.min(metrics.height, Math.ceil(box.y + box.h + pad));
    return {x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y)};
}

async function drawActionsToContext(ctx, actions, metrics) {
    const pageWidth = metrics?.width || 1;
    const pageHeight = metrics?.height || 1;
    for (const action of actions) {
        if (action.tool === 'stamp') {
            const image = await new Promise((resolve, reject) => {
                const stamp = new Image();
                const timeout = setTimeout(() => reject(new Error('โหลดรูปตราเกินเวลา')), 15000);
                stamp.onload = () => { clearTimeout(timeout); resolve(stamp); };
                stamp.onerror = () => { clearTimeout(timeout); reject(new Error('โหลดรูปตราไม่สำเร็จ')); };
                stamp.src = action.src;
            });
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(image, action.x * pageWidth, action.y * pageHeight, action.w * pageWidth, action.h * pageHeight);
        } else if (action.points?.length) {
            ctx.beginPath();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = (action.width || 0.001) * pageWidth;
            ctx.globalCompositeOperation = action.tool === 'eraser' ? 'destination-out' : 'source-over';
            ctx.strokeStyle = action.color || (action.tool === 'whiteout' ? '#ffffff' : '#000000');
            let last = {x: action.points[0].x * pageWidth, y: action.points[0].y * pageHeight};
            ctx.moveTo(last.x, last.y);
            for (const point of action.points.slice(1)) {
                const px = point.x * pageWidth;
                const py = point.y * pageHeight;
                ctx.quadraticCurveTo(last.x, last.y, (last.x + px) / 2, (last.y + py) / 2);
                last = {x: px, y: py};
            }
            ctx.stroke();
            ctx.closePath();
        }
    }
}

async function buildOverlay(pageNum, actions, metrics, crop = true) {
    if (!actions.length || !metrics) return null;
    const box = crop ? overlayBounds(actions, metrics) : {x: 0, y: 0, w: metrics.width, h: metrics.height};
    if (!box) return null;
    const canvas = document.createElement('canvas');
    canvas.width = box.w;
    canvas.height = box.h;
    const ctx = canvas.getContext('2d', {alpha: true});
    ctx.translate(-box.x, -box.y);
    await drawActionsToContext(ctx, actions, metrics);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!hasVisibleNonWhitePixel(pixels)) return null;
    return {bytes: await canvasToPngBytes(canvas), bbox: box};
}

async function generatePDFBlob() {
    await stampRenderQueue.wait();
    if (!sourceBytes) throw new Error('ไม่พบไฟล์ต้นฉบับ');
    const pdf = await PDFLib.PDFDocument.load(sourceBytes, {updateMetadata: false});
    try {
        if (!pdf.getTitle()) pdf.setTitle(DOC.name || 'E-Office document');
        if (!pdf.getAuthor()) pdf.setAuthor(DOC.userName || 'E-Office');
        if (!pdf.getSubject()) pdf.setSubject('E-Office signed document');
        pdf.setKeywords(['E-Office', `revision:${documentRevision || ''}`, `signer:${DOC.userName || ''}`]);
        if (!pdf.getCreator()) pdf.setCreator('E-Office');
        if (!pdf.getProducer()) pdf.setProducer('E-Office');
    } catch (error) {
        console.warn('PDF metadata update skipped', error);
    }
    const pages = pdf.getPages();
    for (let index = 0; index < pages.length; index++) {
        const pageNum = index + 1;
        const actions = documentHistory[pageNum] || [];
        if (!actions.length) continue;
        if (typeof showLoading === 'function') showLoading(true, `กำลังสร้าง PDF หน้า ${pageNum}/${pages.length}...`);
        const metrics = pageMetrics[pageNum];
        if (!metrics) throw new Error('ข้อมูลหน้าลายเซ็นไม่ครบ กรุณาโหลดเอกสารใหม่');
        const page = pages[index];
        const {width, height} = page.getSize();
        const rotation = page.getRotation().angle;
        const overlay = await buildOverlay(pageNum, actions, metrics, rotation === 0);
        if (!overlay) continue;
        const png = await pdf.embedPng(overlay.bytes);
        if (rotation === 0) {
            const factorX = width / metrics.width;
            const factorY = height / metrics.height;
            page.drawImage(png, {
                x: overlay.bbox.x * factorX,
                y: height - (overlay.bbox.y + overlay.bbox.h) * factorY,
                width: overlay.bbox.w * factorX,
                height: overlay.bbox.h * factorY
            });
        } else {
            const rotated = rotation === 90 || rotation === 270;
            page.drawImage(png, {
                x: rotation === 90 || rotation === 180 ? width : 0,
                y: rotation === 180 || rotation === 270 ? height : 0,
                width: rotated ? height : width,
                height: rotated ? width : height,
                rotate: PDFLib.degrees(rotation)
            });
        }
    }
    return new Blob([await pdf.save()], {type: 'application/pdf'});
}

/* --- UI helpers ----------------------------------------------------------- */

function showLoading(show, text) {
    const element = byId('loading');
    if (!element) return;
    if (text) {
        const label = byId('loading-text');
        if (label) label.textContent = text;
    }
    element.classList.toggle('hidden', !show);
}

function positionToast() {
    const toast = byId('toast');
    const panel = byId('save-success');
    if (!toast) return;
    const panelVisible = panel && !panel.classList.contains('hidden');
    const bottom = panelVisible
        ? Math.ceil(window.innerHeight - panel.getBoundingClientRect().top + 12)
        : 24;
    toast.style.setProperty('--toast-bottom-offset', `${bottom}px`);
}

function showToast(message, type = 'info') {
    const toast = byId('toast');
    const icon = byId('toast-icon');
    const label = byId('toast-message');
    if (!toast || !label) return;
    positionToast();
    label.textContent = message;
    if (icon) {
        if (type === 'success') {
            icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>';
            icon.setAttribute('class', 'w-5 h-5 text-green-400');
        } else if (type === 'error') {
            icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line></svg>';
            icon.setAttribute('class', 'w-5 h-5 text-red-400');
        } else {
            icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>';
            icon.setAttribute('class', 'w-5 h-5 text-blue-400');
        }
    }
    toast.classList.remove('opacity-0', 'translate-y-4');
    toast.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', 'translate-y-4');
    }, 3600);
}

function showErrorBanner(title, message, retry) {
    lastRetry = typeof retry === 'function' ? retry : null;
    const banner = byId('error-banner');
    if (!banner) return;
    byId('error-title').textContent = title || 'เกิดข้อผิดพลาด';
    byId('error-message').textContent = message || '';
    byId('error-retry')?.classList.toggle('hidden', !lastRetry);
    banner.classList.remove('hidden');
}

function hideErrorBanner() {
    byId('error-banner')?.classList.add('hidden');
    lastRetry = null;
}

function retryLastAction() {
    if (lastRetry) lastRetry();
}

function showSessionBanner() { byId('session-banner')?.classList.remove('hidden'); }
function hideSessionBanner() { byId('session-banner')?.classList.add('hidden'); }

function requestStampOnlyConfirmation() {
    if (stampIntentConfirmed) return Promise.resolve(true);
    const modal = byId('stamp-intent-modal');
    if (!modal) return Promise.resolve(false);
    stampIntentOpener = document.activeElement;
    if (typeof showLoading === 'function') showLoading(false);
    modal.classList.remove('hidden');
    byId('stamp-intent-accept')?.focus();
    return new Promise(resolve => { stampIntentResolver = resolve; });
}

function resolveStampIntent(accepted) {
    byId('stamp-intent-modal')?.classList.add('hidden');
    const resolve = stampIntentResolver;
    stampIntentResolver = null;
    if (accepted) stampIntentConfirmed = true;
    if (stampIntentOpener && typeof stampIntentOpener.focus === 'function') stampIntentOpener.focus();
    stampIntentOpener = null;
    if (resolve) resolve(Boolean(accepted));
}

function showConflictModal() {
    const modal = byId('conflict-modal');
    if (!modal) return;
    rememberDialogOpener('conflict-modal');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => focusFirstDialogControl(modal));
}

function hideConflictModal() {
    byId('conflict-modal')?.classList.add('hidden');
    restoreDialogFocus('conflict-modal');
}

function reloadLatestDocument() {
    dirty = false;
    window.location.reload();
}

/* --- Signing history drawer ---------------------------------------------- */

async function openAuditDrawer() {
    const overlay = byId('audit-overlay');
    if (!overlay) return;
    rememberDialogOpener('audit-overlay');
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => focusFirstDialogControl(overlay));
    await loadSignStatus();
}

function closeAuditDrawer() {
    byId('audit-overlay')?.classList.add('hidden');
    restoreDialogFocus('audit-overlay');
}

async function loadSignStatus() {
    const content = byId('audit-content');
    if (!content) return;
    content.innerHTML = '<p class="muted">กำลังโหลด...</p>';
    try {
        const response = await fetch(`sign_status.php?Doc_Id=${encodeURIComponent(ESIGN_DOC_ID)}`, {cache: 'no-store', credentials: 'same-origin'});
        const result = await response.json();
        if (!response.ok || result.status !== 'success') throw new Error(result.message || 'โหลดประวัติไม่สำเร็จ');
        renderSignStatus(result);
    } catch (error) {
        content.innerHTML = `<p class="muted">${escapeHtml(error.message || 'โหลดประวัติไม่สำเร็จ')}</p>`;
    }
}

function methodLabel(method) {
    return method === 'pen' ? 'ลงลายมือชื่อ' : method === 'stamp' ? 'ประทับตรา' : method === 'mixed' ? 'ลงลายมือชื่อ + ประทับตรา' : 'ไม่ระบุวิธี';
}

function renderSignStatus(data) {
    const content = byId('audit-content');
    if (!content) return;
    const signers = Array.isArray(data.signers) ? data.signers : [];
    const receipts = Array.isArray(data.receipts) ? data.receipts : [];
    const files = Array.isArray(data.files) ? data.files : [];
    const audit = Array.isArray(data.audit) ? data.audit : [];
    const sections = [];

    sections.push('<section class="audit-section"><h3>ผู้ลงนาม</h3>' + (signers.length
        ? signers.map(row => `<div class="audit-row"><strong>${escapeHtml(row.User_Name || 'ไม่ระบุชื่อ')}</strong><br><small>${escapeHtml(row.Date || '')}</small></div>`).join('')
        : '<p class="audit-empty">ยังไม่มีผู้ลงนาม</p>') + '</section>');

    sections.push('<section class="audit-section"><h3>การลงทะเบียนรับ / Auto send</h3>' + (receipts.length
        ? receipts.map(row => `<div class="audit-row"><strong>${escapeHtml(row.department || 'ไม่ระบุฝ่าย')}</strong> โดย ${escapeHtml(row.User_Name || 'ไม่ระบุชื่อ')}<br><small>${escapeHtml(formatDisplayDate(row.received_at))} • ${escapeHtml(shortRevision(row.revision))}</small></div>`).join('')
        : '<p class="audit-empty">ยังไม่มีการลงทะเบียนรับ</p>') + '</section>');

    sections.push('<section class="audit-section"><h3>ไฟล์ลงนามล่าสุด</h3>' + (files.length
        ? files.map(row => `<div class="audit-row"><strong>${escapeHtml(row.file_name || '')}</strong><br><small>${escapeHtml(formatDisplayDate(row.signed_at))} • revision ${escapeHtml(shortRevision(row.revision))}</small></div>`).join('')
        : '<p class="audit-empty">ยังไม่มีไฟล์ลงนาม</p>') + '</section>');

    sections.push('<section class="audit-section"><h3>เหตุการณ์ลงนาม</h3>' + (audit.length
        ? audit.map(row => `<div class="audit-row"><strong>${escapeHtml(row.actor_name || 'ไม่ระบุชื่อ')}</strong> <span class="audit-method">${escapeHtml(methodLabel(row.method))}</span><br><small>${escapeHtml(formatDisplayDate(row.occurred_at))}</small>${row.departments?.length ? `<br><small>ฝ่าย: ${escapeHtml(row.departments.join(', '))}</small>` : ''}</div>`).join('')
        : '<p class="audit-empty">ยังไม่มีเหตุการณ์ลงนาม</p>') + '</section>');

    content.innerHTML = sections.join('');
}

/* --- Stamp modal ---------------------------------------------------------- */

function openStampModal() {
    const modal = byId('stamp-modal');
    if (!modal) return;
    stampOpener = document.activeElement;
    modal.classList.remove('hidden');
    let last = {};
    try { last = JSON.parse(sessionStorage.getItem(`eoffice-stamp-last:${ESIGN_DOC_ID}`) || '{}') || {}; } catch (error) { last = {}; }
    const dateField = byId('stamp-text-3');
    const timeField = byId('stamp-text-4');
    const receiptField = byId('stamp-text-2');
    const departmentField = byId('stamp-text-1');
    const today = formatThaiDate();
    if (departmentField && !departmentField.value && last.department && [...departmentField.options].some(option => option.value === last.department)) departmentField.value = last.department;
    if (dateField && !dateField.value) dateField.value = last.date === today ? last.date : today;
    if (timeField && !timeField.value) timeField.value = (last.date === today && last.time) ? last.time : formatClock();
    if (receiptField && !receiptField.value && last.receipt) receiptField.value = last.receipt;
    byId('stamp-department-error')?.classList.add('hidden');
    generateStampPreview();
    document.fonts?.load('22px "Sarabun"').then(() => {
        if (!modal.classList.contains('hidden')) generateStampPreview();
    }).catch(() => {});
    byId('stamp-text-1')?.focus();
}

function closeStampModal() {
    byId('stamp-modal')?.classList.add('hidden');
    byId('stamp-department-error')?.classList.add('hidden');
    if (stampOpener && typeof stampOpener.focus === 'function') stampOpener.focus();
    stampOpener = null;
}

function generateDirectorStampPreview(canvas) {
    canvas.width = 460;
    canvas.height = 470;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#1e40af';
    ctx.fillStyle = '#1e40af';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    ctx.font = '24px "Sarabun", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('เรียน', 30, 55);
    ctx.fillText('ผู้อำนวยการโปรดทราบ', 120, 55);
    ctx.fillText('และแจ้งกลุ่มดำเนินการ', 120, 95);

    const departments = DEPARTMENTS
        .filter(department => department !== 'โรงเรียนศรียานุสรณ์' && department !== 'ฝ่ายงานผู้อำนวยการ')
        .map(department => department.replace(/^กลุ่มบริหาร/, 'บริหาร'));
    departments.push('อื่น ๆ');
    const drawDottedLine = (x, y, endX) => {
        ctx.save();
        ctx.lineWidth = 2;
        ctx.setLineDash([1, 7]);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
        ctx.restore();
    };

    departments.forEach((department, index) => {
        const y = 155 + index * 52;
        ctx.lineWidth = 2;
        ctx.strokeRect(48, y - 25, 30, 30);
        ctx.fillText(department, 108, y);
        if (index === departments.length - 1) drawDottedLine(108 + ctx.measureText(department).width + 8, y + 5, 420);
    });
    ctx.fillText('ลงชื่อ', 30, 433);
    drawDottedLine(30 + ctx.measureText('ลงชื่อ').width + 10, 438, 420);
}

function generateStampPreview() {
    const select = byId('stamp-text-1');
    if (!select) return;
    const isDirectorStamp = select.value === 'ฝ่ายงานผู้อำนวยการ';
    byId('stamp-receipt-fields')?.classList.toggle('hidden', isDirectorStamp);
    byId('stamp-director-hint')?.classList.toggle('hidden', !isDirectorStamp);
    const canvas = byId('stamp-preview-canvas');
    if (!canvas) return;
    if (isDirectorStamp) {
        generateDirectorStampPreview(canvas);
        return;
    }
    const val1 = select.value || 'ฝ่ายงาน..........................';
    const val2 = byId('stamp-text-2')?.value || '';
    const val3 = byId('stamp-text-3')?.value || '';
    const val4 = byId('stamp-text-4')?.value || '';
    const ctx = canvas.getContext('2d');
    canvas.width = 400;
    canvas.height = 200;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const stampColor = '#1e40af';
    const fontFamily = '"Sarabun", sans-serif';
    ctx.strokeStyle = stampColor;
    ctx.fillStyle = stampColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

    const drawStampLine = (label, value, y) => {
        const startX = 30;
        const endX = canvas.width - 30;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#1e40af';
        ctx.font = '20px ' + fontFamily;
        ctx.fillText(label, startX, y);
        const labelWidth = ctx.measureText(label).width;
        const lineStartX = startX + labelWidth + 5;
        ctx.beginPath();
        ctx.strokeStyle = '#1e40af';
        ctx.lineWidth = 1.5;
        ctx.moveTo(lineStartX, y + 5);
        ctx.lineTo(endX, y + 5);
        ctx.stroke();
        if (value) {
            ctx.textAlign = 'center';
            ctx.fillStyle = '#000000';
            ctx.font = '22px ' + fontFamily;
            const middleOfLine = lineStartX + ((endX - lineStartX) / 2);
            ctx.fillText(value, middleOfLine, y);
            ctx.fillStyle = '#1e40af';
        }
    };

    ctx.textAlign = 'center';
    ctx.font = '22px ' + fontFamily;
    ctx.fillText(val1, canvas.width / 2, 45);
    drawStampLine('เลขรับ ', val2, 80);
    drawStampLine('วันที่ ', val3, 115);
    drawStampLine('เวลา ', val4, 150);
}

function confirmStampData() {
    const select = byId('stamp-text-1');
    const department = select?.value.trim() || '';
    if (!department) {
        byId('stamp-department-error')?.classList.remove('hidden');
        select?.focus();
        return;
    }
    generateStampPreview();
    const canvas = byId('stamp-preview-canvas');
    if (!canvas) return;
    CONFIG.STAMP_URL = canvas.toDataURL('image/png');
    currentStampDepartment = department;
    try {
        sessionStorage.setItem(`eoffice-stamp-last:${ESIGN_DOC_ID}`, JSON.stringify({
            department: byId('stamp-text-1')?.value || '',
            receipt: byId('stamp-text-2')?.value || '',
            date: byId('stamp-text-3')?.value || '',
            time: byId('stamp-text-4')?.value || ''
        }));
    } catch (error) { /* private mode or storage disabled */ }
    closeStampModal();
    setTool('stamp');
    showToast('เลือกจุดที่ต้องการประทับตรา', 'info');
}

Object.assign(window, {
    setTool, openStampModal, closeStampModal, confirmStampData, undoLastAction,
    saveToServer, downloadDocument, loadServerDocument, openAuditDrawer,
    closeAuditDrawer, showConflictModal, hideConflictModal, reloadLatestDocument, showErrorBanner, resolveStampIntent,
    hideErrorBanner, retryLastAction, goToRelativePage, goToLastPage,
    changeZoom, resetZoom, loadSignStatus
});
