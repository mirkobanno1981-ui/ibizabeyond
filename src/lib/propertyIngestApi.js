import { supabase } from './supabase';
import { fitFilesUnderCap, expandVideosToFrames } from './imageResize';

const TMP_BUCKET = 'villa-ingest-tmp';
const MAX_CUMULATIVE_BYTES = 18 * 1024 * 1024;

// MIME types Gemini 2.5 Flash accepts as multimodal inputs.
export const ALLOWED_INGEST_MIME = [
    // Images
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    // Documents
    'application/pdf',
    'text/plain', 'text/csv', 'text/html', 'text/markdown', 'text/x-markdown',
    // Audio
    'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
    'audio/ogg', 'audio/webm', 'audio/aac', 'audio/flac', 'audio/aiff', 'audio/x-aiff',
    // Video (inline limit: 18 MB cumulative — short clips work; longer clips need compressing)
    'video/mp4', 'video/quicktime', 'video/webm', 'video/mpeg',
    'video/x-msvideo', 'video/x-flv', 'video/3gpp', 'video/x-ms-wmv',
];

function inferKind(mime) {
    if (!mime) return 'text';
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf') return 'pdf';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    return 'text';
}

export async function uploadIngestFiles(files, { userId, jobId } = {}) {
    const id = jobId || crypto.randomUUID();
    if (!userId) throw new Error('userId required for ingest upload');

    const expanded = await expandVideosToFrames(files, { count: 6, maxEdge: 1280, quality: 0.82 });
    const processed = await fitFilesUnderCap(expanded, MAX_CUMULATIVE_BYTES);

    let totalBytes = 0;
    for (const f of processed) totalBytes += f.size;
    if (totalBytes > MAX_CUMULATIVE_BYTES) {
        throw new Error(`Total files ${(totalBytes / 1024 / 1024).toFixed(1)} MB still exceed the 18 MB limit after compression. Reduce image count or trim/re-encode long videos.`);
    }

    // Upload with bounded concurrency (4 at a time) — sequential was the main wall-clock cost.
    const CONCURRENCY = 4;
    const refs = new Array(processed.length);
    const ts = Date.now();
    let cursor = 0;
    async function worker() {
        while (cursor < processed.length) {
            const i = cursor++;
            const f = processed[i];
            const ext = (f.name.split('.').pop() || 'bin').toLowerCase();
            const path = `${userId}/${id}/${ts}_${i}.${ext}`;
            const { error } = await supabase.storage.from(TMP_BUCKET).upload(path, f, {
                contentType: f.type,
                upsert: false,
            });
            if (error) throw new Error(`Upload failed (${f.name}): ${error.message}`);
            refs[i] = { path, mime: f.type, kind: inferKind(f.type), size: f.size, name: f.name };
        }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, processed.length) }, worker));
    return { jobId: id, files: refs };
}

export async function extractProperty({ text, files, jobId }) {
    const { data, error } = await supabase.functions.invoke('property-ingest', {
        body: { action: 'extract', text, files, jobId },
    });
    if (error) throw new Error(error.message || 'extract failed');
    if (data?.error) throw new Error(data.error);
    return data; // { jobId, extracted, confidence }
}

export async function commitProperty({ jobId, edited }) {
    const { data, error } = await supabase.functions.invoke('property-ingest', {
        body: { action: 'commit', jobId, edited },
    });
    if (error) throw new Error(error.message || 'commit failed');
    if (data?.error) throw new Error(data.error);
    return data; // { v_uuid, embedding_ok }
}
