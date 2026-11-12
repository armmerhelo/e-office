/*
 * Stamp composer for e-sign v2. It mirrors the receipt/director layouts from
 * the original page, but keeps the generated image in memory as a vector-safe
 * overlay action instead of mutating a shared CONFIG global.
 */
export class StampComposer {
    constructor({ config, onConfirm, toast }) {
        this.config = config;
        this.onConfirm = onConfirm;
        this.toast = toast || (() => {});
        this.modal = document.getElementById('stamp-modal');
        this.select = document.getElementById('stamp-text-1');
        this.inputs = [2, 3, 4].map((n) => document.getElementById(`stamp-text-${n}`));
        this.canvas = document.getElementById('stamp-preview-canvas');
        this.receiptFields = document.getElementById('stamp-receipt-fields');
        this.directorHint = document.getElementById('stamp-director-hint');
        this.lastData = null;
        this.bound = false;
    }

    mount() {
        if (this.bound) return;
        this.bound = true;
        [this.select, ...this.inputs].forEach((input) => {
            input.addEventListener('input', () => this.generate());
            input.addEventListener('change', () => this.generate());
        });
        document.getElementById('stamp-close').addEventListener('click', () => this.close());
        document.getElementById('stamp-cancel').addEventListener('click', () => this.close());
        document.getElementById('stamp-confirm').addEventListener('click', () => this.confirm());
        this.modal.addEventListener('click', (event) => {
            if (event.target === this.modal) this.close();
        });
        this.modal.addEventListener('keydown', (event) => {
            if (event.key !== 'Tab') return;
            const focusables = [...this.modal.querySelectorAll('button, select, input')]
                .filter((element) => !element.disabled && element.getBoundingClientRect().width > 0);
            if (!focusables.length) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !this.modal.classList.contains('hidden')) this.close();
        });
    }

    open() {
        this.lastFocus = document.activeElement;
        this.modal.classList.remove('hidden');
        this.generate();
        this.select.focus();
        if (document.fonts && document.fonts.load) {
            document.fonts.load('22px "Sarabun"').then(() => {
                if (!this.modal.classList.contains('hidden')) this.generate();
            }).catch(() => {});
        }
    }

    close() {
        this.modal.classList.add('hidden');
        const target = this.lastFocus && this.lastFocus !== document.body
            ? this.lastFocus
            : document.getElementById('btn-stamp');
        if (target && typeof target.focus === 'function') target.focus();
    }

    department() {
        return (this.select.value || '').trim();
    }

    generate() {
        const department = this.department();
        const isDirector = department === 'ฝ่ายงานผู้อำนวยการ';
        this.receiptFields.classList.toggle('hidden', isDirector);
        this.directorHint.classList.toggle('hidden', !isDirector);
        if (isDirector) {
            this.drawDirectorStamp();
            return;
        }
        this.drawReceiptStamp(department);
    }

    drawReceiptStamp(department) {
        const canvas = this.canvas;
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

        const drawLine = (label, value, y) => {
            const startX = 30;
            const endX = canvas.width - 30;
            ctx.textAlign = 'left';
            ctx.fillStyle = stampColor;
            ctx.font = '20px ' + fontFamily;
            ctx.fillText(label, startX, y);
            const labelWidth = ctx.measureText(label).width;
            const lineStartX = startX + labelWidth + 5;
            ctx.beginPath();
            ctx.strokeStyle = stampColor;
            ctx.lineWidth = 1.5;
            ctx.moveTo(lineStartX, y + 5);
            ctx.lineTo(endX, y + 5);
            ctx.stroke();
            if (value) {
                ctx.textAlign = 'center';
                ctx.fillStyle = '#000000';
                ctx.font = '22px ' + fontFamily;
                ctx.fillText(value, lineStartX + ((endX - lineStartX) / 2), y);
                ctx.fillStyle = stampColor;
            }
        };

        ctx.textAlign = 'center';
        ctx.fillStyle = stampColor;
        ctx.font = '22px ' + fontFamily;
        ctx.fillText(department || 'ฝ่ายงาน..........................', canvas.width / 2, 45);
        drawLine('เลขรับ ', this.inputs[0].value.trim(), 80);
        drawLine('วันที่ ', this.inputs[1].value.trim(), 115);
        drawLine('เวลา ', this.inputs[2].value.trim(), 150);
    }

    drawDirectorStamp() {
        const canvas = this.canvas;
        const ctx = canvas.getContext('2d');
        canvas.width = 460;
        canvas.height = 470;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const color = '#1e40af';
        const fontFamily = '"Sarabun", sans-serif';
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
        ctx.font = '24px ' + fontFamily;
        ctx.textAlign = 'left';
        ctx.fillText('เรียน', 30, 55);
        ctx.fillText('ผู้อำนวยการโปรดทราบ', 120, 55);
        ctx.fillText('และแจ้งกลุ่มดำเนินการ', 120, 95);

        const departments = ['บริหารวิชาการ', 'บริหารงบประมาณ', 'บริหารงานบุคคล', 'บริหารทั่วไป', 'อื่น ๆ'];
        const dottedLine = (x, y, endX) => {
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

        departments.forEach((label, index) => {
            const y = 155 + index * 52;
            ctx.lineWidth = 2;
            ctx.strokeRect(48, y - 25, 30, 30);
            ctx.fillText(label, 108, y);
            if (index === departments.length - 1) {
                dottedLine(108 + ctx.measureText(label).width + 8, y + 5, 420);
            }
        });
        ctx.fillText('ลงชื่อ', 30, 433);
        dottedLine(30 + ctx.measureText('ลงชื่อ').width + 10, 438, 420);
    }

    confirm() {
        const department = this.department();
        if (!department) {
            this.toast('กรุณาเลือกฝ่ายงานก่อนประทับตรา', 'error');
            this.select.focus();
            return;
        }
        this.generate();
        const dataUrl = this.canvas.toDataURL('image/png');
        this.lastData = {
            dataUrl,
            department,
            naturalWidth: this.canvas.width,
            naturalHeight: this.canvas.height,
        };
        this.close();
        this.onConfirm(this.lastData);
    }
}
