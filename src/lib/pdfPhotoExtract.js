// Client-side PDF photo extractor.
// Walks the operator list of every page and emits each embedded image as a JPEG File.
// Falls back to page-render rasterization when no embedded bitmaps are found.

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_EDGE = 600;          // ignore icons/logos
const JPEG_QUALITY = 0.85;
const FALLBACK_SCALE = 2.0;

async function bitmapFromImageObj(img) {
    if (!img) return null;
    if (img.bitmap) return img.bitmap;
    // Some pdf.js versions hand back ImageData via `data` + `width`/`height` (RGBA).
    if (img.data && img.width && img.height) {
        try {
            const imgData = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
            return await createImageBitmap(imgData);
        } catch {
            return null;
        }
    }
    return null;
}

async function canvasToJpegFile(bitmap, name) {
    const c = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(bitmap.width, bitmap.height)
        : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
    const ctx = c.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const blob = c.convertToBlob
        ? await c.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
        : await new Promise(res => c.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    return new File([blob], name, { type: 'image/jpeg' });
}

async function renderPageFallback(page, pn, baseName) {
    const viewport = page.getViewport({ scale: FALLBACK_SCALE });
    const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(viewport.width, viewport.height)
        : Object.assign(document.createElement('canvas'), { width: viewport.width, height: viewport.height });
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = canvas.convertToBlob
        ? await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
        : await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    return new File([blob], `${baseName}_page${pn}.jpg`, { type: 'image/jpeg' });
}

export async function extractTextFromPdf(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const chunks = [];
    for (let pn = 1; pn <= pdf.numPages; pn++) {
        try {
            const page = await pdf.getPage(pn);
            const content = await page.getTextContent();
            const text = content.items.map(it => it.str).join(' ');
            if (text.trim()) chunks.push(`--- page ${pn} ---\n${text}`);
        } catch {
            // skip page
        }
    }
    return chunks.join('\n\n');
}

export async function extractPhotosFromPdf(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const baseName = (file.name || 'pdf').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const out = [];

    for (let pn = 1; pn <= pdf.numPages; pn++) {
        const page = await pdf.getPage(pn);
        const ops = await page.getOperatorList();
        let pageHadImage = false;

        for (let i = 0; i < ops.fnArray.length; i++) {
            const isImage = ops.fnArray[i] === pdfjs.OPS.paintImageXObject
                || ops.fnArray[i] === pdfjs.OPS.paintJpegXObject;
            if (!isImage) continue;
            const name = ops.argsArray[i][0];
            if (!name) continue;
            try {
                const img = await new Promise(resolve => {
                    try { page.objs.get(name, resolve); } catch { resolve(null); }
                });
                const bitmap = await bitmapFromImageObj(img);
                if (!bitmap) continue;
                if (bitmap.width < MIN_EDGE || bitmap.height < MIN_EDGE) {
                    bitmap.close?.();
                    continue;
                }
                const jpeg = await canvasToJpegFile(bitmap, `${baseName}_p${pn}_i${i}.jpg`);
                bitmap.close?.();
                out.push(jpeg);
                pageHadImage = true;
            } catch {
                // ignore per-image failures
            }
        }

        if (!pageHadImage && pdf.numPages <= 12) {
            // Fallback: render the page when no bitmap could be extracted (vector-only brochure).
            try {
                const rendered = await renderPageFallback(page, pn, baseName);
                out.push(rendered);
            } catch {
                // ignore
            }
        }
    }

    return out;
}
