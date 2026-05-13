// Resize an image File to a max edge of `maxEdge` px, return JPEG Blob.
// Used to keep multimodal Gemini payloads under 18 MB cumulative.
export async function resizeImageFile(file, { maxEdge = 1280, quality = 0.85 } = {}) {
    if (!file.type.startsWith('image/')) return file;
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return file;

    const { width, height } = bitmap;
    const longest = Math.max(width, height);
    if (longest <= maxEdge) {
        bitmap.close?.();
        return file;
    }
    const scale = maxEdge / longest;
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

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
