/*
 * Lazy, DPR-aware PDF viewer for e-sign v2.
 * Only pages near the viewport are rasterised; ink layers live above each page
 * and are redrawn from the vector action model at every zoom level.
 */
export class PdfViewer {
    constructor({ scrollEl, pagesEl, onPageReady, onPageUnload, onCurrentPage, onZoom }) {
        this.scrollEl = scrollEl;
        this.pagesEl = pagesEl;
        this.onPageReady = onPageReady || (() => {});
        this.onPageUnload = onPageUnload || (() => {});
        this.onCurrentPage = onCurrentPage || (() => {});
        this.onZoom = onZoom || (() => {});
        this.pdf = null;
        this.pages = [];
        this.zoom = 1;
        this.fitMode = true;
        this.current = 1;
        this.observer = null;
        this.scrollFrame = null;
        this.maxBaseWidth = 595;
        this.renderGeneration = 0;
        this.resolutionTimer = null;
        this.dprMedia = null;
        this.dprHandler = () => {
            this.watchDpr();
            this.scheduleResolutionRefresh();
        };
        this.visualViewportHandler = () => this.scheduleResolutionRefresh();
        this.watchDpr();
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', this.visualViewportHandler);
        }
        this.resizeHandler = () => {
            if (this.fitMode) this.fitWidth({ silent: true });
            this.scheduleResolutionRefresh();
        };
        window.addEventListener('resize', this.resizeHandler);
        this.scrollEl.addEventListener('scroll', () => this.scheduleScrollUpdate(), { passive: true });
    }

    watchDpr() {
        if (this.dprMedia) this.dprMedia.removeEventListener('change', this.dprHandler);
        this.dprMedia = window.matchMedia ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
        if (this.dprMedia) this.dprMedia.addEventListener('change', this.dprHandler);
    }

    async load(bytes) {
        if (!window.pdfjsLib) throw new Error('PDF.js ไม่พร้อมใช้งาน');
        if (this.pdf) {
            try { this.pdf.destroy(); } catch (_) {}
            this.pdf = null;
        }
        this.destroyPages();
        this.pdf = await window.pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
        const pageStates = [];
        for (let num = 1; num <= this.pdf.numPages; num++) {
            const page = await this.pdf.getPage(num);
            const viewport = page.getViewport({ scale: 1 });
            pageStates.push({
                num,
                pdfPage: page,
                viewport1: viewport,
                baseW: viewport.width,
                baseH: viewport.height,
                el: null,
                pdfCanvas: null,
                inkCanvas: null,
                placeholder: null,
                rendered: false,
                renderScale: 0,
                inkRenderScale: 0,
                renderTask: null,
            });
        }
        this.pages = pageStates;
        this.maxBaseWidth = Math.max(...pageStates.map((page) => page.baseW));
        this.pagesEl.innerHTML = '';
        pageStates.forEach((state) => this.createPageElement(state));
        this.fitMode = true;
        this.zoom = this.fitZoom();
        this.applySizes();
        this.current = 1;
        this.onCurrentPage(1, this.pages.length);
        this.onZoom(this.zoom, this.fitMode);
        this.observePages();
        this.scrollEl.scrollTop = 0;
        return { pages: this.pages.length, maxBaseWidth: this.maxBaseWidth };
    }

    createPageElement(state) {
        const wrapper = document.createElement('section');
        wrapper.className = 'page';
        wrapper.dataset.page = String(state.num);
        wrapper.setAttribute('aria-label', `หน้า ${state.num}`);

        const placeholder = document.createElement('div');
        placeholder.className = 'page-placeholder';
        placeholder.textContent = `หน้า ${state.num}`;

        const pdfCanvas = document.createElement('canvas');
        pdfCanvas.className = 'pdf-canvas';
        pdfCanvas.dataset.page = String(state.num);

        const inkCanvas = document.createElement('canvas');
        inkCanvas.className = 'ink-canvas is-hand-tool';
        inkCanvas.dataset.page = String(state.num);

        wrapper.append(pdfCanvas, inkCanvas, placeholder);
        state.el = wrapper;
        state.pdfCanvas = pdfCanvas;
        state.inkCanvas = inkCanvas;
        state.placeholder = placeholder;
        this.pagesEl.appendChild(wrapper);
    }

    observePages() {
        if (this.observer) this.observer.disconnect();
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                const state = this.pages.find((page) => page.el === entry.target);
                if (!state) return;
                if (entry.isIntersecting) {
                    if (!state.rendered) this.renderPage(state);
                } else if (state.rendered && entry.boundingClientRect.height > 0) {
                    this.unloadPage(state);
                }
            });
        }, {
            root: this.scrollEl,
            rootMargin: '180% 0px 180% 0px',
            threshold: 0,
        });
        this.pages.forEach((state) => this.observer.observe(state.el));
    }

    fitZoom() {
        const width = Math.max(280, this.scrollEl.clientWidth - 32);
        return Math.min(1.6, Math.max(0.25, width / this.maxBaseWidth));
    }

    applySizes() {
        this.pages.forEach((state) => {
            const width = Math.round(state.baseW * this.zoom);
            const height = Math.round(state.baseH * this.zoom);
            state.el.style.width = `${width}px`;
            state.el.style.height = `${height}px`;
            if (state.rendered && (state.renderScale !== this.pixelScale(state) || state.inkRenderScale !== this.inkPixelScale(state))) {
                state.rendered = false;
                state.el.classList.remove('is-rendered');
                if (this.isNear(state)) this.renderPage(state);
            }
        });
    }

    isNear(state) {
        const rect = state.el.getBoundingClientRect();
        const root = this.scrollEl.getBoundingClientRect();
        return rect.top < root.bottom + root.height * 1.5 && rect.bottom > root.top - root.height * 1.5;
    }

    pixelScale(state) {
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const hardCap = Math.min(
            4096 / state.baseW,
            4096 / state.baseH,
            Math.sqrt((window.ESIGN_V2_CONFIG?.maxCanvasPixels || 12000000) / (state.baseW * state.baseH))
        );
        return Math.max(0.25, Math.min(this.zoom * dpr, hardCap));
    }

    // The ink layer is redrawn from vectors, so it can use a higher bitmap
    // density than the PDF page. This keeps handwritten strokes sharp at page
    // zoom, browser zoom (devicePixelRatio) and pinch zoom (visualViewport).
    inkPixelScale(state) {
        const dpr = Math.min(window.devicePixelRatio || 1, 4);
        const visual = Math.min(window.visualViewport?.scale || 1, 3);
        const wanted = Math.max(2, this.zoom * dpr) * visual;
        const hardCap = Math.min(
            4096 / state.baseW,
            4096 / state.baseH,
            Math.sqrt((window.ESIGN_V2_CONFIG?.maxCanvasPixels || 12000000) / (state.baseW * state.baseH))
        );
        return Math.max(0.25, Math.min(wanted, 4, hardCap));
    }

    scheduleResolutionRefresh() {
        clearTimeout(this.resolutionTimer);
        this.resolutionTimer = setTimeout(() => {
            this.resolutionTimer = null;
            this.pages.forEach((state) => {
                if (!state || !state.rendered) return;
                if (state.renderScale === this.pixelScale(state) && state.inkRenderScale === this.inkPixelScale(state)) return;
                state.rendered = false;
                state.el.classList.remove('is-rendered');
                if (this.isNear(state)) this.renderPage(state);
            });
        }, 120);
    }

    async renderPage(state) {
        if (!this.pdf || !state) return;
        if (state.renderTask) {
            try { state.renderTask.cancel(); } catch (_) {}
            state.renderTask = null;
        }
        const generation = this.renderGeneration;
        const scale = this.pixelScale(state);
        const inkScale = this.inkPixelScale(state);
        const width = Math.max(1, Math.round(state.baseW * scale));
        const height = Math.max(1, Math.round(state.baseH * scale));
        const inkWidth = Math.max(1, Math.round(state.baseW * inkScale));
        const inkHeight = Math.max(1, Math.round(state.baseH * inkScale));

        state.pdfCanvas.width = width;
        state.pdfCanvas.height = height;
        state.inkCanvas.width = inkWidth;
        state.inkCanvas.height = inkHeight;
        state.renderScale = scale;
        state.inkRenderScale = inkScale;

        const viewport = state.pdfPage.getViewport({ scale });
        const context = state.pdfCanvas.getContext('2d', { alpha: false });
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);

        try {
            const task = state.pdfPage.render({ canvasContext: context, viewport });
            state.renderTask = task;
            await task.promise;
            if (generation !== this.renderGeneration) return;
            state.rendered = true;
            state.el.classList.add('is-rendered');
            state.renderTask = null;
            this.onPageReady(state, inkScale);
        } catch (error) {
            if (error && (error.name === 'RenderingCancelledException' || /cancel/i.test(error.message || ''))) return;
            console.error('PDF render failed', state.num, error);
            state.renderTask = null;
            state.placeholder.textContent = `หน้า ${state.num} (แสดงผลไม่สำเร็จ)`;
        }
    }

    unloadPage(state) {
        if (!state || !state.rendered) return;
        if (state.renderTask) {
            try { state.renderTask.cancel(); } catch (_) {}
            state.renderTask = null;
        }
        state.rendered = false;
        state.renderScale = 0;
        state.inkRenderScale = 0;
        state.el.classList.remove('is-rendered');
        state.pdfCanvas.width = 0;
        state.pdfCanvas.height = 0;
        state.inkCanvas.width = 0;
        state.inkCanvas.height = 0;
        this.onPageUnload(state);
    }

    async setZoom(value, { fit = false } = {}) {
        const next = Math.min(3, Math.max(0.25, Number(value) || 1));
        const current = this.pages[Math.max(0, this.current - 1)];
        const beforeTop = current ? current.el.offsetTop : 0;
        const beforeScroll = this.scrollEl.scrollTop;
        const ratio = current ? (beforeScroll - beforeTop) / Math.max(1, current.el.offsetHeight) : 0;
        const beforeMaxX = Math.max(0, this.scrollEl.scrollWidth - this.scrollEl.clientWidth);
        const horizontalRatio = beforeMaxX ? this.scrollEl.scrollLeft / beforeMaxX : 0;
        this.zoom = next;
        this.fitMode = fit;
        this.applySizes();
        if (current) {
            this.scrollEl.scrollTop = Math.max(0, current.el.offsetTop + ratio * current.el.offsetHeight);
        }
        const afterMaxX = Math.max(0, this.scrollEl.scrollWidth - this.scrollEl.clientWidth);
        this.scrollEl.scrollLeft = horizontalRatio * afterMaxX;
        this.onZoom(this.zoom, this.fitMode);
        this.scheduleScrollUpdate();
    }

    fitWidth(options = {}) {
        const zoom = this.fitZoom();
        this.setZoom(zoom, { fit: true });
        this.onZoom(this.zoom, true);
        if (options.silent) this.scheduleScrollUpdate();
    }

    zoomBy(delta) {
        this.setZoom(this.zoom + delta, { fit: false });
    }

    goToPage(num) {
        const state = this.pages[Math.min(this.pages.length, Math.max(1, num)) - 1];
        if (!state) return;
        this.scrollEl.scrollTo({ top: Math.max(0, state.el.offsetTop - 10), behavior: 'smooth' });
        this.current = state.num;
        this.onCurrentPage(state.num, this.pages.length);
    }

    scheduleScrollUpdate() {
        if (this.scrollFrame) return;
        this.scrollFrame = requestAnimationFrame(() => {
            this.scrollFrame = null;
            this.updateCurrentPage();
        });
    }

    updateCurrentPage() {
        if (!this.pages.length) return;
        const marker = this.scrollEl.scrollTop + Math.min(160, this.scrollEl.clientHeight * 0.3);
        let active = this.pages[0];
        for (const state of this.pages) {
            if (state.el.offsetTop <= marker) active = state;
            else break;
        }
        if (active.num !== this.current) {
            this.current = active.num;
            this.onCurrentPage(active.num, this.pages.length);
        }
    }

    destroyPages() {
        this.renderGeneration += 1;
        if (this.observer) this.observer.disconnect();
        this.observer = null;
        this.pages.forEach((state) => {
            if (state.renderTask) {
                try { state.renderTask.cancel(); } catch (_) {}
            }
        });
        this.pages = [];
        this.pagesEl.innerHTML = '';
    }

    destroy() {
        this.destroyPages();
        clearTimeout(this.resolutionTimer);
        this.resolutionTimer = null;
        window.removeEventListener('resize', this.resizeHandler);
        if (window.visualViewport) {
            window.visualViewport.removeEventListener('resize', this.visualViewportHandler);
        }
        if (this.dprMedia) this.dprMedia.removeEventListener('change', this.dprHandler);
        if (this.pdf) {
            try { this.pdf.destroy(); } catch (_) {}
            this.pdf = null;
        }
    }
}
