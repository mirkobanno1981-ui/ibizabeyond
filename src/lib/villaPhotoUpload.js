import { supabase } from './supabase';

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_SIZE_MB = 8;
const BUCKET = 'villa-photos';

export function validatePhoto(file) {
    if (!ALLOWED_MIME.includes(file.type)) {
        return `Unsupported type: ${file.type || 'unknown'}`;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        return `File ${file.name} exceeds ${MAX_SIZE_MB} MB`;
    }
    return null;
}

export async function uploadVillaPhoto(file, vUuid) {
    const err = validatePhoto(file);
    if (err) throw new Error(err);

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${vUuid}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });

    if (error) throw error;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, storage_path: path };
}

export async function deleteVillaPhotoFromStorage(storagePath) {
    if (!storagePath) return;
    await supabase.storage.from(BUCKET).remove([storagePath]);
}
