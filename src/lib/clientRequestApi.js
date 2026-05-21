import { supabase } from './supabase';

export async function parseClientRequest(rawText) {
    const { data, error } = await supabase.functions.invoke('client-request-parse', {
        body: { raw_text: rawText },
    });
    if (error) throw new Error(error.message || 'parse failed');
    if (data?.error) throw new Error(data.error);
    return data; // { parsed, confidence }
}

export async function createClientRequest({ rawText, parsed, confidence }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase
        .from('client_requests')
        .insert({
            created_by: user.id,
            raw_text: rawText,
            parsed,
            ai_confidence: confidence ?? null,
            status: parsed ? 'parsed' : 'new',
        })
        .select('*')
        .single();
    if (error) throw error;
    return data;
}

export async function updateClientRequest(id, patch) {
    const { data, error } = await supabase
        .from('client_requests')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();
    if (error) throw error;
    return data;
}

export async function listClientRequests({ status } = {}) {
    let q = supabase
        .from('client_requests')
        .select('*')
        .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
}

export async function getClientRequest(id) {
    const { data, error } = await supabase
        .from('client_requests')
        .select('*')
        .eq('id', id)
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function deleteClientRequest(id) {
    const { error } = await supabase
        .from('client_requests')
        .delete()
        .eq('id', id);
    if (error) throw error;
}
