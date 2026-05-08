import { supabase } from './supabase';
import { resizeImagesIfNeeded } from './imageResize';

const TMP_BUCKET = 'villa-ingest-tmp';
const MAX_CUMULATIVE_BYTES = 18 * 1024 * 1024;

export const ALLOWED_INGEST_MIME = [
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf',
    'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/webm',
    'text/plain',
];

function inferKind(mime) {
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf') return 'pdf';
    if (mime.startsWith('audio/')) return 'audio';
    return 'text';
}

export async function uploadIngestFiles(files, { userId, jobId } = {}) {
    const id = jobId || crypto.randomUUID();
    if (!userId) throw new Error('userId required for ingest upload');

    const processed = await resizeImagesIfNeeded(files, { maxEdge: 1280, quality: 0.85 });

    let totalBytes = 0;
    for (const f of processed) totalBytes += f.size;
    if (totalBytes > MAX_CUMULATIVE_BYTES) {
        throw new Error(`File totali ${(totalBytes / 1024 / 1024).toFixed(1)} MB superano il limite di 18 MB. Riduci o comprimi.`);
    }

    const refs = [];
    for (let i = 0; i < processed.length; i++) {
        const f = processed[i];
        const ext = (f.name.split('.').pop() || 'bin').toLowerCase();
        const path = `${userId}/${id}/${Date.now()}_${i}.${ext}`;
        const { error } = await supabase.storage.from(TMP_BUCKET).upload(path, f, {
            contentType: f.type,
            upsert: false,
        });
        if (error) throw new Error(`Upload fallito (${f.name}): ${error.message}`);
        refs.push({ path, mime: f.type, kind: inferKind(f.type), size: f.size, name: f.name });
    }
    return { jobId: id, files: refs };
}

async function readErrorDetail(error, fallback) {
    try {
        const ctx = error?.context;
        if (ctx && typeof ctx.clone === 'function') {
            const txt = await ctx.clone().text();
            if (txt) {
                try {
                    const j = JSON.parse(txt);
                    if (j?.error) return j.error;
                } catch (_) { /* not JSON */ }
                return txt;
            }
        }
    } catch (_) { /* ignore */ }
    return error?.message || fallback;
}

export async function extractBoat({ text, files, jobId, wantMarketingDescription }) {
    const { data, error } = await supabase.functions.invoke('boat-ingest', {
        body: { action: 'extract', text, files, jobId, wantMarketingDescription },
    });
    if (error) throw new Error(await readErrorDetail(error, 'extract failed'));
    if (data?.error) throw new Error(data.error);
    return data;
}

export async function commitBoat({ jobId, edited }) {
    const { data, error } = await supabase.functions.invoke('boat-ingest', {
        body: { action: 'commit', jobId, edited },
    });
    if (error) throw new Error(await readErrorDetail(error, 'commit failed'));
    if (data?.error) throw new Error(data.error);
    return data;
}
