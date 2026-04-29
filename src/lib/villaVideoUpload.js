import { supabase } from './supabase';

export const ALLOWED_MIME = ['video/mp4', 'video/quicktime', 'video/webm'];
export const MAX_SIZE_MB = 100;
const BUCKET = 'villa-videos';

export function validateVideo(file) {
    if (!ALLOWED_MIME.includes(file.type)) {
        return `Unsupported video type: ${file.type || 'unknown'}`;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        return `File ${file.name} exceeds ${MAX_SIZE_MB} MB`;
    }
    return null;
}

export async function uploadVillaVideo(file, vUuid) {
    const err = validateVideo(file);
    if (err) throw new Error(err);

    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
    const path = `${vUuid}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });

    if (error) throw error;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, storage_path: path };
}

export async function deleteVillaVideoFromStorage(storagePath) {
    if (!storagePath) return;
    await supabase.storage.from(BUCKET).remove([storagePath]);
}
