import * as pdfjs from './vendor/pdf.min.js';
import { PdfViewer } from './viewer.js?v=20261112-3';
import { AnnotationLayer } from './annotations.js?v=20261112-3';
import { StampComposer } from './stamp.js?v=20261112-3';
import { buildSignedPdf } from './export-pdf.js?v=20261112-3';

const config = window.ESIGN_V2_CONFIG || {};
window.pdfjsLib = pdfjs;
if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.js', import.meta.url).href;
}
const stampQueue = new StampRenderQueue();
const $ = (id) => document.getElementById(id);

let viewer = null;
let annotations = null;
let composer = null;
let sourceBytes = null;
let pdfRevision = null;
let saving = false;
let savedOnce = false;
let loadingTimer = null;
let toastTimer = null;
let firstRenderResolve = null;

const els = {
    pages: $('pages'),
    scroll: $('viewer-scroll'),
    empty: $('empty-state'),
    loading: $('loading'),
    loadingText: $('loading-text'),
    error: $('error-banner'),
    errorTitle: $('error-title'),
    errorMessage: $('error-message'),
    errorRetry: $('error-retry'),
    errorDismiss: $('error-dismiss'),
    saveState: $('save-state'),
    pageIndicator: $('page-indicator'),
    zoomLabel: $('zoom-label'),
    prev: $('btn-prev'),
    next: $('btn-next'),
    save: $('btn-save'),
    download: $('btn-download'),
    zoomFit: $('btn-zoom-fit'),
    finger: $('btn-finger'),
    toast: $('toast'),
    toastMessage: $('toast-message'),
};

function toast(message, type = 'info') {
    if (!els.toast) return;
    els.toastMessage.textContent = message;
    els.toast.classList.remove('hidden', 'is-success', 'is-error');
    if (type === 'success') els.toast.classList.add('is-success');
    if (type === 'error') els.toast.classList.add('is-error');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 3600);
}

function showLoading(show, text) {
    if (!els.loading) return;
    if (text) els.loadingText.textContent = text;
    els.loading.classList.toggle('hidden', !show);
    if (show) {
        clearTimeout(loadingTimer);
        loadingTimer = setTimeout(() => els.loading.classList.add('hidden'), 20000);
    } else {
        clearTimeout(loadingTimer);
    }
}

function showError(message, { title = 'เกิดข้อผิดพลาด', retry = false } = {}) {
    if (!els.error) return;
    els.errorTitle.textContent = title;
    els.errorMessage.textContent = message;
    els.error.classList.remove('hidden');
    els.errorRetry.classList.toggle('hidden', !retry);
}

function hideError() {
    els.error.classList.add('hidden');
}

function updateSaveState() {
    if (!els.saveState) return;
    if (saving) {
        els.saveState.textContent = 'กำลังบันทึก...';
        els.saveState.className = 'save-state';
        return;
    }
    const hasInk = annotations && annotations.hasVisibleSignature();
    if (!hasInk) {
        els.saveState.textContent = 'พร้อมลงนาม';
        els.saveState.className = 'save-state';
        return;
    }
    if (savedOnce) {
        els.saveState.textContent = 'บันทึกแล้ว';
        els.saveState.className = 'save-state is-saved';
    } else {
        els.saveState.textContent = 'ยังไม่บันทึก';
        els.saveState.className = 'save-state is-dirty';
    }
}

function updatePenMode(penSeen) {
    if (!els.finger) return;
    els.finger.classList.toggle('hidden', !penSeen);
    els.finger.textContent = annotations.fingerDrawing ? 'นิ้ววาดได้' : 'รับเฉพาะปากกา';
    els.finger.classList.toggle('is-active', annotations.fingerDrawing);
}

function updateToolButtons(tool) {
    document.querySelectorAll('.tool-btn').forEach((button) => {
        button.classList.toggle('is-active', button.id === `btn-${tool}`);
    });
}

function setTool(tool) {
    if (!annotations) return;
    if (tool === 'stamp' && !annotations.pendingStamp) {
        openStampModal();
        return;
    }
    annotations.setTool(tool);
    updateToolButtons(tool);
}

function openStampModal() {
    if (composer) composer.open();
}

function undo() {
    if (!annotations || saving) return;
    annotations.undo();
    updateSaveState();
}

async function fetchDocument() {
    const urls = [config.primaryUrl, config.secondaryUrl].filter(Boolean);
    if (!urls.length) throw new Error('ไม่พบที่อยู่ไฟล์เอกสาร');
    let lastError = null;
    for (let index = 0; index < urls.length; index++) {
        try {
            if (index > 0) showLoading(true, 'กำลังลองเซิร์ฟเวอร์สำรอง...');
            const response = await fetch(urls[index], {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buffer = await response.arrayBuffer();
            if (buffer.byteLength < 5) throw new Error('ไฟล์เอกสารว่างหรือเสียหาย');
            const revision = response.headers.get('X-Document-Revision') || '';
            return { bytes: new Uint8Array(buffer), revision };
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('โหลดเอกสารไม่สำเร็จ');
}

async function loadDocument() {
    hideError();
    if (viewer) {
        viewer.destroy();
        viewer = null;
    }
    annotations = null;
    sourceBytes = null;
    pdfRevision = null;
    savedOnce = false;
    firstRenderResolve = null;
    if (els.empty) els.empty.classList.add('hidden');
    showLoading(true, 'กำลังเชื่อมต่อเซิร์ฟเวอร์...');
    try {
        const { bytes, revision } = await fetchDocument();
        sourceBytes = bytes;
        pdfRevision = revision;
        if (!pdfRevision) {
            showError('ไม่พบข้อมูลรุ่นเอกสาร (revision) ระบบจะไม่สามารถบันทึกได้ กรุณาโหลดหน้าใหม่', { title: 'คำเตือน', retry: true });
        }
        viewer = new PdfViewer({
            scrollEl: els.scroll,
            pagesEl: els.pages,
            onPageReady: (state) => {
                annotations.attachPage(state);
                if (state.num === 1 && firstRenderResolve) firstRenderResolve();
            },
            onPageUnload: () => {},
            onCurrentPage: (num, total) => {
                els.pageIndicator.textContent = `หน้า ${num} / ${total}`;
                els.prev.disabled = num <= 1;
                els.next.disabled = num >= total;
            },
            onZoom: (zoom, fit) => {
                els.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
                els.zoomFit.classList.toggle('is-active', fit);
            },
        });
        annotations = new AnnotationLayer({
            viewer,
            queue: stampQueue,
            onChange: () => {
                savedOnce = false;
                updateSaveState();
            },
            onToast: toast,
            onZoom: (zoom) => viewer.setZoom(zoom, { fit: false }),
            onPenMode: (seen) => {
                updatePenMode(seen);
                if (seen && !annotations.fingerDrawing) {
                    toast('ตรวจพบปากกา: รับเฉพาะปากกา นิ้วใช้เลื่อน/ซูม', 'info');
                }
            },
        });
        const firstRender = new Promise((resolve) => { firstRenderResolve = resolve; });
        const result = await viewer.load(sourceBytes);
        await Promise.race([firstRender, new Promise((resolve) => setTimeout(resolve, 9000))]);
        showLoading(false);
        if (!viewer.pages.length) throw new Error('ไม่พบหน้าเอกสาร');
        hideError();
        setTool('hand');
        updateSaveState();
        toast(`โหลดเอกสาร ${result.pages} หน้าแล้ว`, 'success');
    } catch (error) {
        console.error(error);
        showLoading(false);
        if (els.empty) els.empty.classList.remove('hidden');
        showError(error.message || 'โหลดเอกสารไม่สำเร็จ กรุณาลองใหม่', { title: 'เปิดเอกสารไม่ได้', retry: true });
    }
}

async function loadReceiptScopes() {
    if (!annotations || !annotations.stampActions().some((action) => !action.receiptRegistered)) return [];
    const response = await fetch(`${config.receiptScopesUrl}?Doc_Id=${encodeURIComponent(config.docId)}`, {
        cache: 'no-store',
        credentials: 'same-origin',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== 'success' || !Array.isArray(result.departments)) {
        throw new Error(result.message || 'โหลดขอบเขตเลขาฝ่ายไม่สำเร็จ กรุณากดบันทึกอีกครั้ง');
    }
    return result.departments;
}

async function saveToServer() {
    if (!annotations || saving || !sourceBytes) return;
    saving = true;
    annotations.setLocked(true);
    updateSaveState();
    showLoading(true, 'กำลังส่งข้อมูลไปยังเซิร์ฟเวอร์...');
    try {
        await stampQueue.wait();
        if (!annotations.hasVisibleSignature()) throw new Error('กรุณาลงนามหรือประทับตราก่อนบันทึก');
        if (!pdfRevision) throw new Error('ไม่พบรุ่นเอกสาร กรุณาโหลดหน้าใหม่ก่อนบันทึก');
        const stamps = annotations.stampActions();
        const pending = stamps.filter((action) => action.department && !action.receiptRegistered);
        let registeredDepartments = [];
        if (pending.length) {
            const scopes = await loadReceiptScopes();
            registeredDepartments = [...new Set(pending.map((action) => action.department))]
                .filter((department) => scopes.includes(department));
            if (registeredDepartments.length) {
                const confirmed = confirm(
                    'ยืนยันลงทะเบียนรับเอกสารในนามเลขาฝ่าย:\n' +
                    registeredDepartments.join('\n') +
                    '\nระบบจะบันทึกประวัติการรับและเพิ่มรองฝ่ายอัตโนมัติเมื่อบันทึกสำเร็จ'
                );
                if (!confirmed) {
                    showLoading(false);
                    toast('ยกเลิกการบันทึกแล้ว ลายเซ็นยังอยู่บนหน้า', 'info');
                    return;
                }
            }
        }
        const blob = await buildSignedPdf({
            sourceBytes,
            pages: annotations.exportPages(),
            queue: stampQueue,
        });
        const formData = new FormData();
        formData.append('file', blob, config.fileBaseName);
        formData.append('year', config.year);
        formData.append('Doc_Id', String(config.docId));
        formData.append('revision', pdfRevision);
        formData.append('confirm_signature', '1');
        const penSignature = annotations.hasVisiblePenSignature();
        if (penSignature) formData.append('confirm_pen_signature', '1');
        formData.append('receipt_departments', JSON.stringify(registeredDepartments));
        if (registeredDepartments.length) formData.append('confirm_receipt', '1');
        const signatureDepartments = [...new Set(stamps.map((action) => action.department).filter(Boolean))];
        formData.append('signature_method', penSignature && stamps.length ? 'mixed' : penSignature ? 'pen' : 'stamp');
        formData.append('signature_departments', JSON.stringify(signatureDepartments));

        const response = await fetch(config.saveUrl, {
            method: 'POST',
            credentials: 'same-origin',
            body: formData,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.status !== 'success') {
            throw new Error(result.message || `บันทึกไม่สำเร็จ (HTTP ${response.status})`);
        }
        pdfRevision = result.revision || pdfRevision;
        annotations.markSaved(result.registered_receipt_departments || []);
        savedOnce = true;
        const badge = document.getElementById('doc-status');
        if (badge) {
            badge.textContent = 'ลงนามแล้ว';
            badge.classList.add('status-badge--signed');
        }
        const autoSent = Array.isArray(result.auto_sent_user_ids) ? result.auto_sent_user_ids.length : 0;
        toast(autoSent ? `บันทึกเรียบร้อย และเพิ่มรองฝ่ายอัตโนมัติ ${autoSent} คน` : 'บันทึกการลงนามเรียบร้อย', 'success');
        if (result.revision) {
            els.saveState.textContent = 'บันทึกแล้ว';
            els.saveState.className = 'save-state is-saved';
        }
    } catch (error) {
        console.error(error);
        toast(error.message || 'การเชื่อมต่อเซิร์ฟเวอร์ล้มเหลว', 'error');
    } finally {
        saving = false;
        if (annotations) annotations.setLocked(false);
        showLoading(false);
        updateSaveState();
    }
}

async function downloadDocument() {
    if (!annotations || saving || !sourceBytes) return;
    showLoading(true, 'กำลังสร้าง PDF...');
    try {
        await stampQueue.wait();
        const blob = await buildSignedPdf({
            sourceBytes,
            pages: annotations.exportPages(),
            queue: stampQueue,
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `signed_${config.fileBaseName || 'document.pdf'}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (error) {
        toast(error.message || 'สร้าง PDF ไม่สำเร็จ', 'error');
    } finally {
        showLoading(false);
    }
}

function bindUi() {
    document.querySelectorAll('.tool-btn').forEach((button) => {
        button.addEventListener('click', () => {
            const tool = button.id.replace('btn-', '');
            setTool(tool);
        });
    });
    $('btn-undo').addEventListener('click', undo);
    $('btn-save').addEventListener('click', saveToServer);
    $('btn-download').addEventListener('click', downloadDocument);
    $('btn-prev').addEventListener('click', () => viewer && viewer.goToPage(viewer.current - 1));
    $('btn-next').addEventListener('click', () => viewer && viewer.goToPage(viewer.current + 1));
    $('btn-zoom-in').addEventListener('click', () => viewer && viewer.zoomBy(0.15));
    $('btn-zoom-out').addEventListener('click', () => viewer && viewer.zoomBy(-0.15));
    $('btn-zoom-fit').addEventListener('click', () => viewer && viewer.fitWidth());
    els.finger.addEventListener('click', () => {
        if (!annotations) return;
        annotations.setFingerDrawing(!annotations.fingerDrawing);
        updatePenMode(annotations.penSeen);
        toast(annotations.fingerDrawing ? 'เปิดโหมดใช้นิ้ววาด' : 'รับเฉพาะปากกา นิ้วใช้เลื่อน/ซูม', 'info');
    });
    els.errorDismiss.addEventListener('click', hideError);
    els.errorRetry.addEventListener('click', () => loadDocument());

    composer = new StampComposer({
        config,
        toast,
        onConfirm: (data) => {
            annotations.setPendingStamp(data);
            updateToolButtons('stamp');
            toast('แตะตำแหน่งที่ต้องการประทับตรา', 'info');
        },
    });
    composer.mount();

    window.addEventListener('beforeunload', (event) => {
        if (annotations && annotations.hasVisibleSignature() && !savedOnce) {
            event.preventDefault();
            event.returnValue = '';
        }
    });
    window.addEventListener('keydown', (event) => {
        const tag = (event.target && event.target.tagName) || '';
        if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            undo();
        }
    });
}

function exposeApi() {
    window.esignV2 = {
        setTool,
        openStampModal,
        undo,
        saveToServer,
        downloadDocument,
        reload: loadDocument,
        getState: () => ({
            pages: viewer ? viewer.pages.length : 0,
            currentPage: viewer ? viewer.current : 0,
            zoom: viewer ? viewer.zoom : 0,
            actions: annotations ? annotations.actionsSnapshot() : 0,
            hasSignature: annotations ? annotations.hasVisibleSignature() : false,
            hasPen: annotations ? annotations.hasVisiblePenSignature() : false,
            revision: pdfRevision,
            saving,
            savedOnce,
            sourceBytes: sourceBytes ? sourceBytes.byteLength : 0,
        }),
        debug: () => ({ viewer, annotations, config }),
    };
}

document.addEventListener('DOMContentLoaded', () => {
    bindUi();
    exposeApi();
    loadDocument();
});
