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

// Sample frames across a video, score by luminance variance (detail proxy),
// keep top `count`. Returned files are JPEG with kind=image downstream so the
// model treats them as photos. Drops original video bytes (often the bulk of
// the payload).
export async function extractVideoFrames(file, { count = 6, maxEdge = 1280, quality = 0.82, sampleMultiplier = 2 } = {}) {
    if (!file.type.startsWith('video/')) return [];
    if (typeof document === 'undefined') return [];

    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = url;

    try {
        await new Promise((resolve, reject) => {
            const onMeta = () => { cleanup(); resolve(); };
            const onErr = () => { cleanup(); reject(new Error('video metadata load failed')); };
            const cleanup = () => {
                video.removeEventListener('loadedmetadata', onMeta);
                video.removeEventListener('error', onErr);
            };
            video.addEventListener('loadedmetadata', onMeta);
            video.addEventListener('error', onErr);
            setTimeout(() => { cleanup(); reject(new Error('video metadata timeout')); }, 15000);
        });

        const duration = video.duration;
        if (!duration || !isFinite(duration) || duration < 0.1) return [];

        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;
        const longest = Math.max(vw, vh);
        const scale = longest > maxEdge ? maxEdge / longest : 1;
        const w = Math.max(1, Math.round(vw * scale));
        const h = Math.max(1, Math.round(vh * scale));

        const canvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(w, h)
            : Object.assign(document.createElement('canvas'), { width: w, height: h });
        const ctx = canvas.getContext('2d');

        const sampleCount = Math.min(count * sampleMultiplier, 24);
        const timestamps = [];
        for (let i = 1; i <= sampleCount; i++) {
            timestamps.push((duration * i) / (sampleCount + 1));
        }

        const candidates = [];
        for (const t of timestamps) {
            const seekOk = await new Promise(resolve => {
                const onSeeked = () => { cleanup(); resolve(true); };
                const onErr = () => { cleanup(); resolve(false); };
                const cleanup = () => {
                    video.removeEventListener('seeked', onSeeked);
                    video.removeEventListener('error', onErr);
                };
                video.addEventListener('seeked', onSeeked);
                video.addEventListener('error', onErr);
                setTimeout(() => { cleanup(); resolve(false); }, 5000);
                try { video.currentTime = Math.min(t, Math.max(0, duration - 0.05)); }
                catch { cleanup(); resolve(false); }
            });
            if (!seekOk) continue;

            try { ctx.drawImage(video, 0, 0, w, h); } catch { continue; }
            const score = scoreFrameVariance(ctx, w, h);
            const blob = canvas.convertToBlob
                ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
                : await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
            if (blob) candidates.push({ score, blob, t });
        }

        if (!candidates.length) return [];
        candidates.sort((a, b) => b.score - a.score);
        const picked = candidates.slice(0, count).sort((a, b) => a.t - b.t);

        const base = file.name.replace(/\.[^.]+$/, '');
        return picked.map((c, i) => new File(
            [c.blob],
            `${base}_frame_${String(i + 1).padStart(2, '0')}.jpg`,
            { type: 'image/jpeg' }
        ));
    } finally {
        URL.revokeObjectURL(url);
        video.removeAttribute('src');
        try { video.load(); } catch { /* ignore */ }
    }
}

function scoreFrameVariance(ctx, w, h) {
    try {
        const img = ctx.getImageData(0, 0, w, h);
        const data = img.data;
        let sum = 0, sumSq = 0, n = 0;
        for (let i = 0; i < data.length; i += 32) {
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            sum += lum;
            sumSq += lum * lum;
            n++;
        }
        if (!n) return 0;
        const mean = sum / n;
        return sumSq / n - mean * mean;
    } catch {
        return Math.random();
    }
}

// Replace each video in `files` with extracted JPEG frames. If extraction
// fails or yields nothing, the original video is kept so the upstream model
// still receives some signal.
export async function expandVideosToFrames(files, opts) {
    const out = [];
    for (const f of files) {
        if (!f.type.startsWith('video/')) { out.push(f); continue; }
        try {
            const frames = await extractVideoFrames(f, opts);
            if (frames.length) out.push(...frames);
            else out.push(f);
        } catch {
            out.push(f);
        }
    }
    return out;
}
