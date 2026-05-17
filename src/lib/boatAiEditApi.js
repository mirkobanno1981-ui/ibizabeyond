import { supabase } from './supabase';

async function fileToBase64(file) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

export async function requestBoatAiPatch({ currentRow, text, audioFile }) {
    const payload = {
        current: currentRow || {},
        text: text || '',
    };
    if (audioFile) {
        payload.audio_base64 = await fileToBase64(audioFile);
        payload.audio_mime = audioFile.type || 'audio/webm';
    }
    const { data, error } = await supabase.functions.invoke('boat-ai-edit', { body: payload });
    if (error) throw new Error(error.message || 'boat-ai-edit failed');
    if (data?.error) throw new Error(data.error);
    return data;
}
