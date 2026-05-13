// Resize an image File to a max edge of `maxEdge` px, return JPEG Blob.
// Used to keep multimodal Gemini payloads under 18 MB cumulative.
export async function resizeImageFile(file, { maxEdge = 1280, quality = 0.85, force = false } = {}) {
    if (!file.type.startsWith('image/')) return file;
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return file;

    const { width, height } = bitmap;
    const longest = Math.max(width, height);
    if (!force && longest <= maxEdge) {
        bitmap.close?.();
        return file;
    }
    const scale = Math.min(1, maxEdge / longest);
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(targetW, targetH)
        : Object.assign(document.createElement('canvas'), { width: targetW, height: targetH });
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close?.();

    const blob = canvas.convertToBlob
        ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
        : await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

export async function resizeImagesIfNeeded(files, opts) {
    return Promise.all(files.map(f => (f.type.startsWith('image/') ? resizeImageFile(f, opts) : Promise.resolve(f))));
}

// Resize images, then progressively re-encode if cumulative size still exceeds
// `capBytes`. Only image files shrink; videos/PDFs/audio pass through. Returns
// the (possibly shrunk) file list — caller still must verify final total.
export async function fitFilesUnderCap(files, capBytes, baseOpts = { maxEdge: 1280, quality: 0.85 }) {
    const sum = (arr) => arr.reduce((n, f) => n + f.size, 0);
    let current = await resizeImagesIfNeeded(files, baseOpts);
    if (sum(current) <= capBytes) return current;

    const stages = [
        { maxEdge: 1024, quality: 0.8 },
        { maxEdge: 900, quality: 0.75 },
        { maxEdge: 768, quality: 0.7 },
        { maxEdge: 640, quality: 0.65 },
        { maxEdge: 512, quality: 0.6 },
    ];
    for (const stage of stages) {
        current = await Promise.all(current.map(f =>
            f.type.startsWith('image/')
                ? resizeImageFile(f, { ...stage, force: true })
                : Promise.resolve(f)
        ));
        if (sum(current) <= capBytes) return current;
    }
    return current;
}
