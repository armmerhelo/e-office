/*
 * Flatten e-sign v2 annotations into the PDF.
 *
 * Pen and whiteout strokes are written as real PDF paths (vector), not as a
 * page-sized PNG. Stamps stay PNG because their source is a generated raster,
 * but they are embedded once and placed with the page rotation taken into
 * account. The result keeps the original text selectable.
 */
const { simplifyRdp, smoothStroke } = window.EsignGeometry;

export async function buildSignedPdf({ sourceBytes, pages, queue }) {
    if (!window.PDFLib) throw new Error('PDF-lib ไม่พร้อมใช้งาน');
    const { PDFDocument, LineCapStyle, rgb } = window.PDFLib;
    if (queue && queue.wait) await queue.wait();

    const pdf = await PDFDocument.load(sourceBytes);
    const pdfPages = pdf.getPages();
    const embedded = new Map();

    const embedStamp = async (action, rotation) => {
        const key = `${rotation}:${action.dataUrl}`;
        if (embedded.has(key)) return embedded.get(key);
        let dataUrl = action.dataUrl;
        if (rotation % 360 !== 0) dataUrl = await rotateDataUrl(action, rotation);
        const image = await pdf.embedPng(dataUrl);
        embedded.set(key, image);
        return image;
    };

    for (const pageState of pages) {
        const page = pdfPages[pageState.num - 1];
        if (!page) continue;
        const viewport = pageState.viewport1;
        if (!viewport) continue;
        const rotation = page.getRotation().angle % 360;

        for (const action of pageState.actions) {
            if (action.type === 'stroke' && action.points.length) {
                const display = action.points.map(([x, y]) => [x * pageState.baseW, y * pageState.baseH]);
                const smoothed = smoothStroke(display, 3);
                const simplified = simplifyRdp(smoothed, 0.35);
                const pdfPoints = simplified.map(([x, y]) => viewport.convertToPdfPoint(x, y));
                const color = action.tool === 'whiteout' ? rgb(1, 1, 1) : rgb(0, 0, 0);
                const thickness = Math.max(0.5, action.width);
                if (pdfPoints.length === 1) {
                    page.drawCircle({
                        x: pdfPoints[0][0],
                        y: pdfPoints[0][1],
                        size: Math.max(0.3, thickness / 2),
                        color,
                    });
                } else {
                    for (let i = 1; i < pdfPoints.length; i++) {
                        page.drawLine({
                            start: { x: pdfPoints[i - 1][0], y: pdfPoints[i - 1][1] },
                            end: { x: pdfPoints[i][0], y: pdfPoints[i][1] },
                            thickness,
                            color,
                            lineCap: LineCapStyle.Round,
                        });
                    }
                }
            } else if (action.type === 'stamp') {
                const x0 = action.x * pageState.baseW;
                const y0 = action.y * pageState.baseH;
                const x1 = (action.x + action.w) * pageState.baseW;
                const y1 = (action.y + action.h) * pageState.baseH;
                const [ax, ay] = viewport.convertToPdfPoint(x0, y0);
                const [bx, by] = viewport.convertToPdfPoint(x1, y1);
                const left = Math.min(ax, bx);
                const bottom = Math.min(ay, by);
                const width = Math.abs(bx - ax);
                const height = Math.abs(by - ay);
                if (width < 0.5 || height < 0.5) continue;
                const image = await embedStamp(action, rotation);
                page.drawImage(image, { x: left, y: bottom, width, height });
            }
        }
    }

    const bytes = await pdf.save();
    return new Blob([bytes], { type: 'application/pdf' });
}

async function rotateDataUrl(action, rotation) {
    const image = await loadImage(action);
    const angle = ((rotation % 360) + 360) % 360;
    const swap = angle === 90 || angle === 270;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? image.naturalHeight : image.naturalWidth;
    canvas.height = swap ? image.naturalWidth : image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    // The PDF page is rotated clockwise for display. Pre-rotate the image the
    // other way so it appears upright to the reader.
    ctx.rotate((-angle * Math.PI) / 180);
    ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    return canvas.toDataURL('image/png');
}

function loadImage(action) {
    if (action.image && action.image.complete && action.image.naturalWidth) {
        return Promise.resolve(action.image);
    }
    if (action.imagePromise) return action.imagePromise;
    action.imagePromise = new Promise((resolve, reject) => {
        const image = new Image();
        const timeout = setTimeout(() => {
            image.onload = null;
            image.onerror = null;
            reject(new Error('โหลดรูปตราเกินเวลา'));
        }, 15000);
        image.onload = () => {
            clearTimeout(timeout);
            action.image = image;
            resolve(image);
        };
        image.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('โหลดรูปตราไม่สำเร็จ'));
        };
        image.src = action.dataUrl;
    });
    return action.imagePromise;
}
