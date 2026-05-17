// Client-side PDF photo extractor.
// Walks the operator list of every page and emits each embedded image as a JPEG File.
// Falls back to page-render rasterization when no embedded bitmaps are found.

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_EDGE = 600;          // ignore icons/logos
const JPEG_QUALITY = 0.82;
const FALLBACK_SCALE = 1.5;    // raster fallback only for vector-only brochures; 1.5 ≈ 1080p equivalent

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

export async function extractTextFromPdf(file, onProgress) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const chunks = [];
    try {
        for (let pn = 1; pn <= pdf.numPages; pn++) {
            let page;
            try {
                page = await pdf.getPage(pn);
                const content = await withTimeout(page.getTextContent(), PAGE_TIMEOUT_MS, `page ${pn} text`);
                const text = content.items.map(it => it.str).join(' ');
                if (text.trim()) chunks.push(`--- page ${pn} ---\n${text}`);
            } catch {
                // skip page
            } finally {
                try { page?.cleanup(); } catch { /* noop */ }
            }
            onProgress?.({ phase: 'text', page: pn, totalPages: pdf.numPages });
            await yieldToUi();
        }
    } finally {
        try { await pdf.cleanup(); } catch { /* noop */ }
        try { await pdf.destroy(); } catch { /* noop */ }
    }
    return chunks.join('\n\n');
}

const MAX_PHOTOS = 20;
const PAGE_TIMEOUT_MS = 20000;

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms)),
    ]);
}

const yieldToUi = () => new Promise(r => setTimeout(r, 0));

async function processPhotosOnPage(pdf, pn, baseName, remaining) {
    const collected = [];
    const page = await pdf.getPage(pn);
    try {
        const ops = await withTimeout(page.getOperatorList(), PAGE_TIMEOUT_MS, `page ${pn} ops`);
        let pageHadImage = false;

        for (let i = 0; i < ops.fnArray.length && collected.length < remaining; i++) {
            const isImage = ops.fnArray[i] === pdfjs.OPS.paintImageXObject
                || ops.fnArray[i] === pdfjs.OPS.paintJpegXObject;
            if (!isImage) continue;
            const name = ops.argsArray[i][0];
            if (!name) continue;
            try {
                const img = await withTimeout(
                    new Promise(resolve => {
                        try { page.objs.get(name, resolve); } catch { resolve(null); }
                    }),
                    PAGE_TIMEOUT_MS,
                    `page ${pn} img ${name}`,
                );
                const bitmap = await bitmapFromImageObj(img);
                if (!bitmap) continue;
                if (bitmap.width < MIN_EDGE || bitmap.height < MIN_EDGE) {
                    bitmap.close?.();
                    continue;
                }
                const jpeg = await canvasToJpegFile(bitmap, `${baseName}_p${pn}_i${i}.jpg`);
                bitmap.close?.();
                collected.push(jpeg);
                pageHadImage = true;
            } catch {
                // ignore per-image failures
            }
        }

        if (!pageHadImage && pdf.numPages <= 12 && collected.length < remaining) {
            try {
                const rendered = await withTimeout(
                    renderPageFallback(page, pn, baseName),
                    PAGE_TIMEOUT_MS,
                    `page ${pn} fallback render`,
                );
                collected.push(rendered);
            } catch {
                // ignore
            }
        }
    } finally {
        try { page.cleanup(); } catch { /* noop */ }
    }
    return collected;
}

export async function extractPhotosFromPdf(file, onProgress) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const baseName = (file.name || 'pdf').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const out = [];

    onProgress?.({ phase: 'photos', page: 0, totalPages: pdf.numPages, photosFound: 0 });

    try {
        for (let pn = 1; pn <= pdf.numPages && out.length < MAX_PHOTOS; pn++) {
            try {
                const pagePhotos = await processPhotosOnPage(pdf, pn, baseName, MAX_PHOTOS - out.length);
                out.push(...pagePhotos);
            } catch (e) {
                onProgress?.({ phase: 'photos', page: pn, totalPages: pdf.numPages, photosFound: out.length, skipped: true, error: e.message });
            }
            onProgress?.({ phase: 'photos', page: pn, totalPages: pdf.numPages, photosFound: out.length });
            await yieldToUi();
        }
    } finally {
        try { await pdf.cleanup(); } catch { /* noop */ }
        try { await pdf.destroy(); } catch { /* noop */ }
    }

    return out;
}
