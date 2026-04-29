import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function EntityVisibilityTab({ entityType, entityId }) {
    const [users, setUsers] = useState([]);
    const [hiddenSet, setHiddenSet] = useState(new Set());
    const [originalHiddenSet, setOriginalHiddenSet] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        if (!entityId) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const { data: roleRows } = await supabase
                    .from('user_roles')
                    .select('user_id, role')
                    .in('role', ['agent', 'editor', 'editor-boat']);

                const userIds = roleRows?.map(r => r.user_id) || [];
                const roleMap = new Map((roleRows || []).map(r => [r.user_id, r.role]));

                let usersList = [];
                if (userIds.length > 0) {
                    const { data: agents } = await supabase
                        .from('agents')
                        .select('id, company_name, phone_number')
                        .in('id', userIds);

                    usersList = userIds.map(id => {
                        const agent = agents?.find(a => a.id === id);
                        return {
                            id,
                            label: agent?.company_name || agent?.phone_number || id.slice(0, 8),
                            role: roleMap.get(id) || 'agent',
                        };
                    }).sort((a, b) => a.label.localeCompare(b.label));
                }

                const { data: overrides } = await supabase
                    .from('entity_visibility_overrides')
                    .select('user_id')
                    .eq('entity_type', entityType)
                    .eq('entity_id', entityId)
                    .eq('hidden', true);

                const hiddenIds = new Set((overrides || []).map(o => o.user_id));

                if (!cancelled) {
                    setUsers(usersList);
                    setHiddenSet(hiddenIds);
                    setOriginalHiddenSet(new Set(hiddenIds));
                }
            } catch (err) {
                console.error('Visibility load error:', err);
                if (!cancelled) setMessage({ type: 'error', text: 'Unable to load users.' });
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [entityType, entityId]);

    const toggle = (userId) => {
        setHiddenSet(prev => {
            const next = new Set(prev);
            if (next.has(userId)) next.delete(userId);
            else next.add(userId);
            return next;
        });
    };

    const dirty = useMemo(() => {
        if (hiddenSet.size !== originalHiddenSet.size) return true;
        for (const id of hiddenSet) if (!originalHiddenSet.has(id)) return true;
        return false;
    }, [hiddenSet, originalHiddenSet]);

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const toAdd = [...hiddenSet].filter(id => !originalHiddenSet.has(id));
            const toRemove = [...originalHiddenSet].filter(id => !hiddenSet.has(id));

            if (toAdd.length > 0) {
                const rows = toAdd.map(user_id => ({
                    user_id,
                    entity_type: entityType,
                    entity_id: entityId,
                    hidden: true,
                }));
                const { error } = await supabase
                    .from('entity_visibility_overrides')
                    .upsert(rows, { onConflict: 'user_id,entity_type,entity_id' });
                if (error) throw error;
            }

            if (toRemove.length > 0) {
                const { error } = await supabase
                    .from('entity_visibility_overrides')
                    .delete()
                    .eq('entity_type', entityType)
                    .eq('entity_id', entityId)
                    .in('user_id', toRemove);
                if (error) throw error;
            }

            setOriginalHiddenSet(new Set(hiddenSet));
            setMessage({ type: 'success', text: 'Visibility updated.' });
        } catch (err) {
            console.error('Visibility save error:', err);
            setMessage({ type: 'error', text: err.message || 'Save failed.' });
        } finally {
            setSaving(false);
        }
    };

    if (!entityId) {
        return (
            <p className="text-xs text-text-muted italic">
                Save the record first to manage per-user visibility.
            </p>
        );
    }

    return (
        <section className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary flex items-center gap-2">
                    <span className="material-symbols-outlined notranslate text-sm">visibility_off</span>
                    Per-User Visibility
                </p>
                {dirty && (
                    <span className="text-[10px] font-bold text-amber-500 uppercase">Unsaved</span>
                )}
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed">
                Hidden users will not see this {entityType} in their inventory list. Default = visible.
            </p>

            {message && (
                <div className={`text-xs p-2 rounded-lg ${message.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                    {message.text}
                </div>
            )}

            {loading ? (
                <p className="text-xs text-text-muted italic">Loading users...</p>
            ) : users.length === 0 ? (
                <p className="text-xs text-text-muted italic">No agent/editor users found.</p>
            ) : (
                <div className="border border-border rounded-xl divide-y divide-border max-h-72 overflow-y-auto">
                    {users.map(u => {
                        const hidden = hiddenSet.has(u.id);
                        return (
                            <label
                                key={u.id}
                                className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-surface-2 cursor-pointer"
                            >
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-text-primary truncate">{u.label}</p>
                                    <p className="text-[10px] text-text-muted uppercase tracking-wider">{u.role}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`text-[10px] font-bold uppercase ${hidden ? 'text-red-400' : 'text-emerald-400'}`}>
                                        {hidden ? 'Hidden' : 'Visible'}
                                    </span>
                                    <input
                                        type="checkbox"
                                        checked={!hidden}
                                        onChange={() => toggle(u.id)}
                                        className="size-4 accent-primary"
                                    />
                                </div>
                            </label>
                        );
                    })}
                </div>
            )}

            <button
                type="button"
                onClick={handleSave}
                disabled={saving || !dirty}
                className="btn-primary w-full justify-center text-sm flex items-center gap-2 disabled:opacity-40"
            >
                <span className="material-symbols-outlined notranslate text-[16px]">save</span>
                {saving ? 'Saving...' : 'Save Visibility'}
            </button>
        </section>
    );
}
