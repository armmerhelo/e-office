/*
 * Vector action model + canvas renderer for e-sign v2.
 *
 * Actions are stored in page-normalised coordinates, so the same data drives
 * the screen at any zoom and the vector export in export-pdf.js. Strokes are
 * never flattened into a page-sized PNG.
 */
const { clamp, strokeHit, uid } = window.EsignGeometry;

const PEN_WIDTH = 2.2;
const WHITEOUT_WIDTH = 12;
const ERASER_RADIUS = 15;

export class AnnotationLayer {
    constructor({ viewer, queue, onChange, onToast, onZoom, onPenMode }) {
        this.viewer = viewer;
        this.queue = queue;
        this.onChange = onChange || (() => {});
        this.onToast = onToast || (() => {});
        this.onZoom = onZoom || (() => {});
        this.onPenMode = onPenMode || (() => {});

        this.tool = 'hand';
        this.locked = false;
        this.penSeen = false;
        this.fingerDrawing = this.readFingerDrawing();
        this.pages = new Map();
        this.active = null;
        this.undoStack = [];
        this.pointers = new Map();
        this.pinch = null;
        this.pinchFrame = null;
        this.lastPinchZoom = 1;
        this.pendingStamp = null;
        this.toastOnce = new Set();
    }

    pageData(state, { create = true } = {}) {
        let page = this.pages.get(state.num);
        if (!page && create) {
            page = {
                num: state.num,
                baseW: state.baseW,
                baseH: state.baseH,
                viewport1: state.viewport1,
                actions: [],
                canvas: null,
                ctx: null,
                bound: false,
            };
            this.pages.set(state.num, page);
        }
        if (page) {
            page.baseW = state.baseW;
            page.baseH = state.baseH;
            page.viewport1 = state.viewport1;
            page.canvas = state.inkCanvas;
            page.ctx = state.inkCanvas.getContext('2d');
            if (!page.bound && page.canvas) {
                page.bound = true;
                this.bindCanvas(page);
            }
        }
        return page;
    }

    bindCanvas(page) {
        const canvas = page.canvas;
        canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event, page));
        canvas.addEventListener('pointermove', (event) => this.onPointerMove(event, page));
        canvas.addEventListener('pointerup', (event) => this.onPointerUp(event, page));
        canvas.addEventListener('pointercancel', (event) => this.onPointerUp(event, page, true));
        canvas.addEventListener('lostpointercapture', (event) => {
            if (this.active && this.active.pointerId === event.pointerId) this.finishPointer();
        });
        canvas.addEventListener('contextmenu', (event) => {
            if (this.tool !== 'hand') event.preventDefault();
        });
    }

    attachPage(state) {
        this.pageData(state);
        this.applyToolClasses();
        this.redrawPage(state.num);
    }

    applyToolClasses() {
        const tool = this.tool;
        this.pages.forEach((page) => {
            if (!page.canvas) return;
            page.canvas.classList.toggle('is-hand-tool', tool === 'hand');
            page.canvas.classList.toggle('is-draw-tool', tool === 'pen' || tool === 'whiteout');
            page.canvas.classList.toggle('is-eraser-tool', tool === 'eraser');
            page.canvas.classList.toggle('is-stamp-tool', tool === 'stamp');
        });
    }

    setTool(tool) {
        if (this.active) this.cancelActive();
        this.tool = tool;
        this.applyToolClasses();
    }

    setPendingStamp(data) {
        this.pendingStamp = data;
        this.setTool('stamp');
    }

    setLocked(locked) {
        this.locked = Boolean(locked);
    }

    readFingerDrawing() {
        try {
            return localStorage.getItem('esign-v2-finger-drawing') === '1';
        } catch (_) {
            return false;
        }
    }

    setFingerDrawing(enabled) {
        this.fingerDrawing = Boolean(enabled);
        try {
            localStorage.setItem('esign-v2-finger-drawing', this.fingerDrawing ? '1' : '0');
        } catch (_) {}
    }

    markPenSeen() {
        if (this.penSeen) return;
        this.penSeen = true;
        this.onPenMode(true);
    }

    shouldIgnoreForInk(event) {
        if (event.pointerType === 'pen') return false;
        if (event.pointerType === 'touch') {
            if (this.penSeen && !this.fingerDrawing) return true;
            const width = Number(event.width) || 0;
            const height = Number(event.height) || 0;
            if (width > 0 && height > 0 && (width > 45 || height > 45 || width * height > 1600)) return true;
        }
        return false;
    }

    trackPoint(event) {
        if (event.pointerType === 'pen') this.markPenSeen();
        if (event.pointerType !== 'touch') return;
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (this.pointers.size >= 2 && this.tool !== 'hand' && (!this.penSeen || this.fingerDrawing)) {
            this.cancelActive();
            const [a, b] = [...this.pointers.values()];
            this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.viewer.zoom };
        }
    }

    untrackPoint(event) {
        if (event.pointerType !== 'touch') return;
        this.pointers.delete(event.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
    }

    onPointerDown(event, page) {
        this.trackPoint(event);
        if (this.tool === 'hand' || this.locked || this.queue.pending.size) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (event.pointerType === 'pen') this.markPenSeen();
        if (this.shouldIgnoreForInk(event)) return;
        if (this.pinch) return;

        const rect = page.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const point = this.pointFromEvent(event, rect);
        if (!point) return;

        if (event.cancelable) event.preventDefault();
        try { page.canvas.setPointerCapture(event.pointerId); } catch (_) {}

        if (this.tool === 'stamp') {
            this.placeStamp(page, point);
            return;
        }
        if (this.tool === 'eraser') {
            this.active = {
                kind: 'erase',
                page,
                pointerId: event.pointerId,
                rect,
                removed: [],
                frame: null,
            };
            this.eraseAt(point);
            return;
        }
        if (this.tool !== 'pen' && this.tool !== 'whiteout') return;

        const action = {
            id: uid('stroke'),
            type: 'stroke',
            tool: this.tool,
            points: [[point.x, point.y]],
            width: this.tool === 'whiteout' ? WHITEOUT_WIDTH : PEN_WIDTH,
            color: this.tool === 'whiteout' ? '#ffffff' : '#000000',
        };
        page.actions.push(action);
        this.active = {
            kind: 'stroke',
            page,
            pointerId: event.pointerId,
            rect,
            action,
            last: point,
            moved: false,
        };
        this.drawDot(page, action, point, rect);
    }

    onPointerMove(event, page) {
        if (event.pointerType === 'pen') this.markPenSeen();
        if (event.pointerType === 'touch' && this.pointers.has(event.pointerId)) {
            this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (this.pinch && this.pointers.size >= 2) {
                this.schedulePinch();
                return;
            }
        }
        const active = this.active;
        if (!active || active.page !== page || active.pointerId !== event.pointerId) return;
        if (event.cancelable) event.preventDefault();

        if (active.kind === 'erase') {
            const point = this.pointFromEvent(event, active.rect);
            if (point) this.eraseAt(point);
            return;
        }
        if (active.kind !== 'stroke') return;

        const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
        const samples = events && events.length ? events : [event];
        for (const sample of samples) {
            const point = this.pointFromEvent(sample, active.rect);
            if (!point) continue;
            const last = active.last;
            if (Math.hypot(point.x - last.x, point.y - last.y) < 0.0004) continue;
            active.action.points.push([point.x, point.y]);
            this.drawSegment(page, active.action, last, point, active.rect);
            active.last = point;
            active.moved = true;
        }
    }

    onPointerUp(event, page, cancelled = false) {
        if (event.pointerType === 'touch') this.untrackPoint(event);
        const active = this.active;
        if (!active || active.page !== page || active.pointerId !== event.pointerId) return;
        if (cancelled) {
            this.cancelActive();
            return;
        }
        this.finishPointer();
    }

    finishPointer() {
        const active = this.active;
        this.active = null;
        if (!active) return;
        if (active.kind === 'stroke') {
            const action = active.action;
            if (!action.points.length) {
                this.removeAction(active.page, action.id);
            } else {
                this.undoStack.push({ kind: 'add', page: active.page.num, action });
                this.redrawPage(active.page.num);
                this.onChange();
            }
        } else if (active.kind === 'erase') {
            if (active.removed.length) {
                this.undoStack.push({ kind: 'erase', page: active.page.num, items: active.removed });
                this.redrawPage(active.page.num);
                this.onChange();
            }
        }
    }

    cancelActive() {
        const active = this.active;
        this.active = null;
        if (!active) return;
        if (active.kind === 'stroke') {
            this.removeAction(active.page, active.action.id);
            this.redrawPage(active.page.num);
        } else if (active.kind === 'erase') {
            this.restoreErased(active.removed);
            this.redrawPage(active.page.num);
        }
    }

    removeAction(page, id) {
        const index = page.actions.findIndex((action) => action.id === id);
        if (index !== -1) page.actions.splice(index, 1);
    }

    restoreErased(items) {
        items.slice().sort((a, b) => a.index - b.index).forEach(({ page, action, index }) => {
            if (!page.actions.some((existing) => existing.id === action.id)) {
                page.actions.splice(Math.min(index, page.actions.length), 0, action);
            }
        });
    }

    pointFromEvent(event, rect) {
        if (!rect.width || !rect.height) return null;
        return {
            x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
            y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
        };
    }

    displayScale(page, rect) {
        return rect.width / Math.max(1, page.baseW);
    }

    prepareContext(ctx, page) {
        return ctx;
    }

    drawDot(page, action, point, rect) {
        const scale = this.displayScale(page, rect);
        const ctx = page.canvas.getContext('2d');
        ctx.setTransform(page.canvas.width / rect.width, 0, 0, page.canvas.height / rect.height, 0, 0);
        ctx.fillStyle = action.color;
        ctx.beginPath();
        ctx.arc(point.x * rect.width, point.y * rect.height, Math.max(1, action.width * scale / 2), 0, Math.PI * 2);
        ctx.fill();
    }

    drawSegment(page, action, from, to, rect) {
        const scale = this.displayScale(page, rect);
        const ctx = page.canvas.getContext('2d');
        ctx.setTransform(page.canvas.width / rect.width, 0, 0, page.canvas.height / rect.height, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = action.color;
        ctx.lineWidth = Math.max(0.6, action.width * scale);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(from.x * rect.width, from.y * rect.height);
        ctx.lineTo(to.x * rect.width, to.y * rect.height);
        ctx.stroke();
    }

    redrawPage(num) {
        const page = this.pages.get(num);
        if (!page || !page.canvas || !page.canvas.width || !page.canvas.height) return;
        const rect = page.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const ctx = page.canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, page.canvas.width, page.canvas.height);
        ctx.setTransform(page.canvas.width / rect.width, 0, 0, page.canvas.height / rect.height, 0, 0);
        const scale = this.displayScale(page, rect);
        page.actions.forEach((action) => this.drawAction(ctx, page, action, rect, scale));
    }

    drawAction(ctx, page, action, rect, scale) {
        if (action.type === 'stamp') {
            if (action.image && action.image.complete && action.image.naturalWidth) {
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(
                    action.image,
                    action.x * rect.width,
                    action.y * rect.height,
                    action.w * rect.width,
                    action.h * rect.height
                );
            } else if (!action.imagePromise) {
                this.loadStamp(action).then(() => this.redrawPage(page.num)).catch((error) => {
                    if (!this.toastOnce.has(action.id)) {
                        this.toastOnce.add(action.id);
                        this.onToast(error.message || 'โหลดรูปตราไม่สำเร็จ', 'error');
                    }
                });
            }
            return;
        }
        if (action.type !== 'stroke') return;
        const points = action.points;
        if (!points.length) return;
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = action.color;
        ctx.fillStyle = action.color;
        ctx.lineWidth = Math.max(0.6, action.width * scale);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (points.length === 1) {
            ctx.beginPath();
            ctx.arc(points[0][0] * rect.width, points[0][1] * rect.height, Math.max(1, action.width * scale / 2), 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        ctx.beginPath();
        ctx.moveTo(points[0][0] * rect.width, points[0][1] * rect.height);
        for (let i = 1; i < points.length - 1; i++) {
            const control = points[i];
            const next = points[i + 1];
            const midX = (control[0] + next[0]) / 2;
            const midY = (control[1] + next[1]) / 2;
            ctx.quadraticCurveTo(control[0] * rect.width, control[1] * rect.height, midX * rect.width, midY * rect.height);
        }
        const last = points[points.length - 1];
        ctx.lineTo(last[0] * rect.width, last[1] * rect.height);
        ctx.stroke();
    }

    placeStamp(page, point) {
        if (!this.pendingStamp) {
            this.onToast('กรุณาระบุข้อมูลตราก่อนประทับ', 'error');
            return;
        }
        const data = this.pendingStamp;
        const baseWidth = Math.min(page.baseW * 0.30, 200);
        const aspect = data.naturalHeight / Math.max(1, data.naturalWidth);
        const baseHeight = baseWidth * aspect;
        const width = baseWidth / page.baseW;
        const height = baseHeight / page.baseH;
        const action = {
            id: uid('stamp'),
            type: 'stamp',
            x: clamp(point.x - width / 2, 0, 1 - width),
            y: clamp(point.y - height / 2, 0, 1 - height),
            w: width,
            h: height,
            dataUrl: data.dataUrl,
            department: data.department,
            naturalWidth: data.naturalWidth,
            naturalHeight: data.naturalHeight,
            image: null,
            imagePromise: null,
            saved: false,
            receiptRegistered: false,
        };
        page.actions.push(action);
        this.queue.add(() => this.loadStamp(action))
            .then(() => this.redrawPage(page.num))
            .catch((error) => this.onToast(error.message || 'โหลดรูปตราไม่สำเร็จ', 'error'));
        this.undoStack.push({ kind: 'add', page: page.num, action });
        this.onChange();
    }

    loadStamp(action) {
        if (action.image && action.image.complete) return Promise.resolve(action.image);
        if (action.imagePromise) return action.imagePromise;
        action.imagePromise = new Promise((resolve, reject) => {
            const image = new Image();
            const timeout = setTimeout(() => {
                image.onload = null;
                image.onerror = null;
                action.imagePromise = null;
                reject(new Error('โหลดรูปตราเกินเวลา กรุณาประทับตราใหม่'));
            }, 15000);
            image.onload = () => {
                clearTimeout(timeout);
                action.image = image;
                resolve(image);
            };
            image.onerror = () => {
                clearTimeout(timeout);
                action.imagePromise = null;
                reject(new Error('โหลดรูปตราไม่สำเร็จ กรุณาประทับตราใหม่'));
            };
            image.src = action.dataUrl;
        });
        return action.imagePromise;
    }

    eraseAt(point) {
        const active = this.active;
        if (!active || active.kind !== 'erase') return;
        const page = active.page;
        const rect = active.rect;
        const scale = this.displayScale(page, rect);
        const radius = ERASER_RADIUS / Math.max(0.25, scale);
        let changed = false;
        for (let index = page.actions.length - 1; index >= 0; index--) {
            const action = page.actions[index];
            if (action.type !== 'stroke') continue;
            if (strokeHit(action.points, point.x, point.y, page.baseW, page.baseH, radius + action.width / 2)) {
                active.removed.push({ page, action, index });
                page.actions.splice(index, 1);
                changed = true;
            }
        }
        if (changed) this.scheduleEraseRedraw(active);
    }

    scheduleEraseRedraw(active) {
        if (active.frame) return;
        active.frame = requestAnimationFrame(() => {
            active.frame = null;
            if (this.active === active) this.redrawPage(active.page.num);
        });
    }

    undo() {
        if (this.active) this.cancelActive();
        if (this.locked || this.queue.pending.size) return false;
        const command = this.undoStack.pop();
        if (!command) {
            this.onToast('ไม่มีรายการให้ย้อนกลับ', 'info');
            return false;
        }
        if (command.kind === 'add') {
            const page = this.pages.get(command.page);
            if (page) this.removeAction(page, command.action.id);
        } else if (command.kind === 'erase') {
            this.restoreErased(command.items);
        }
        this.redrawPage(command.page);
        this.onChange();
        return true;
    }

    schedulePinch() {
        if (this.pinchFrame) return;
        this.pinchFrame = requestAnimationFrame(() => {
            this.pinchFrame = null;
            if (!this.pinch || this.pointers.size < 2) return;
            const [a, b] = [...this.pointers.values()];
            const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const next = clamp(this.pinch.zoom * (distance / this.pinch.distance), 0.25, 3);
            if (Math.abs(next - this.lastPinchZoom) < 0.01) return;
            this.lastPinchZoom = next;
            this.onZoom(next);
        });
    }

    hasVisibleSignature() {
        for (const page of this.pages.values()) {
            for (const action of page.actions) {
                if (action.type === 'stamp') return true;
                if (action.type === 'stroke' && action.tool === 'pen' && action.points.length) return true;
            }
        }
        return false;
    }

    hasVisiblePenSignature() {
        for (const page of this.pages.values()) {
            for (const action of page.actions) {
                if (action.type === 'stroke' && action.tool === 'pen' && action.points.length) return true;
            }
        }
        return false;
    }

    stampActions() {
        const actions = [];
        this.pages.forEach((page) => {
            page.actions.forEach((action) => {
                if (action.type === 'stamp' && action.department) actions.push(action);
            });
        });
        return actions;
    }

    markSaved(registeredDepartments = []) {
        this.stampActions().forEach((action) => {
            action.saved = true;
            if (registeredDepartments.includes(action.department)) action.receiptRegistered = true;
        });
    }

    exportPages() {
        return [...this.pages.values()].map((page) => ({
            num: page.num,
            baseW: page.baseW,
            baseH: page.baseH,
            viewport1: page.viewport1,
            actions: page.actions,
        }));
    }

    redrawAll() {
        this.pages.forEach((page) => this.redrawPage(page.num));
    }

    actionsSnapshot() {
        return [...this.pages.values()].reduce((total, page) => total + page.actions.length, 0);
    }
}
