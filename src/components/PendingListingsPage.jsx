import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function PendingListingsPage() {
    const { role, loading: authLoading } = useAuth();
    const [tab, setTab] = useState('villas');
    const [villas, setVillas] = useState([]);
    const [boats, setBoats] = useState([]);
    const [services, setServices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(null);
    const [message, setMessage] = useState(null);

    const isAdmin = role === 'admin' || role === 'super_admin';

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [vRes, bRes, sRes] = await Promise.all([
                supabase
                    .from('properties')
                    .select('v_uuid, villa_name, property_type, areaname, destination, owner_id, created_by, created_at, thumbnail_url, source, ingestion_source')
                    .eq('is_active', false)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('boats')
                    .select('v_uuid, boat_name, type, owner_id, created_by, created_at, is_active')
                    .eq('is_active', false)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('services')
                    .select('id, name, provider, price, currency, created_by, created_at, is_active')
                    .eq('is_active', false)
                    .order('created_at', { ascending: false }),
            ]);
            if (vRes.error) throw vRes.error;
            if (bRes.error) throw bRes.error;
            if (sRes.error) throw sRes.error;

            const allUserIds = new Set([
                ...(vRes.data || []).map(r => r.created_by).filter(Boolean),
                ...(bRes.data || []).map(r => r.created_by).filter(Boolean),
                ...(sRes.data || []).map(r => r.created_by).filter(Boolean),
            ]);
            let creatorMap = {};
            if (allUserIds.size > 0) {
                const { data: agentsData } = await supabase
                    .from('agents')
                    .select('id, company_name, email')
                    .in('id', Array.from(allUserIds));
                creatorMap = Object.fromEntries((agentsData || []).map(a => [a.id, a]));
            }

            const enrich = (rows) => (rows || []).map(r => ({ ...r, _creator: r.created_by ? creatorMap[r.created_by] : null }));
            setVillas(enrich(vRes.data));
            setBoats(enrich(bRes.data));
            setServices(enrich(sRes.data));
        } catch (err) {
            console.error('Pending listings fetch error:', err);
            setMessage({ type: 'error', text: err.message });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!authLoading && isAdmin) fetchAll();
        else if (!authLoading) setLoading(false);
    }, [authLoading, isAdmin, fetchAll]);

    async function approve(kind, idField, id) {
        setBusy(`${kind}:${id}`);
        setMessage(null);
        try {
            const table = kind === 'villa' ? 'properties' : kind === 'boat' ? 'boats' : 'services';
            const { error } = await supabase.from(table).update({ is_active: true }).eq(idField, id);
            if (error) throw error;
            setMessage({ type: 'success', text: `${kind} approved` });
            await fetchAll();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setBusy(null);
        }
    }

    async function reject(kind, idField, id, name) {
        if (!confirm(`Delete ${kind} "${name}"? This cannot be undone.`)) return;
        setBusy(`${kind}:${id}`);
        setMessage(null);
        try {
            const table = kind === 'villa' ? 'properties' : kind === 'boat' ? 'boats' : 'services';
            const { error } = await supabase.from(table).delete().eq(idField, id);
            if (error) throw error;
            setMessage({ type: 'success', text: `${kind} rejected and deleted` });
            await fetchAll();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setBusy(null);
        }
    }

    if (authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className="h-screen flex items-center justify-center p-6 text-center">
                <div className="max-w-md space-y-4">
                    <div className="size-16 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 mx-auto">
                        <span className="material-symbols-outlined notranslate text-3xl">lock</span>
                    </div>
                    <h1 className="text-xl font-bold text-text-primary uppercase tracking-tight">Access Denied</h1>
                    <p className="text-text-muted text-sm">Approval queue is admin-only.</p>
                </div>
            </div>
        );
    }

    const counts = { villas: villas.length, boats: boats.length, services: services.length };
    const list = tab === 'villas' ? villas : tab === 'boats' ? boats : services;

    return (
        <div className="p-6 md:p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary">Pending Approvals</h1>
                    <p className="text-text-muted text-sm mt-0.5">Review and approve user-submitted listings before they become visible to everyone.</p>
                </div>
                <button onClick={fetchAll} className="btn-secondary text-xs flex items-center gap-2 px-4 py-2">
                    <span className="material-symbols-outlined notranslate text-[18px]">refresh</span>
                    Refresh
                </button>
            </div>

            {message && (
                <div className={`p-4 rounded-xl border ${message.type === 'success' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                    {message.text}
                </div>
            )}

            <div className="flex border-b border-border">
                {[
                    { id: 'villas', label: 'Villas', icon: 'villa' },
                    { id: 'boats', label: 'Boats', icon: 'directions_boat' },
                    { id: 'services', label: 'Services', icon: 'concierge' },
                ].map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`px-6 py-3 text-sm font-bold uppercase tracking-widest transition-all border-b-2 flex items-center gap-2 ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-primary'}`}
                    >
                        <span className="material-symbols-outlined notranslate text-[18px]">{t.icon}</span>
                        {t.label}
                        <span className="text-[10px] bg-surface-2 px-2 py-0.5 rounded-full">{counts[t.id]}</span>
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="text-center text-text-muted py-12">Loading...</div>
            ) : list.length === 0 ? (
                <div className="text-center text-text-muted text-sm italic py-16 border border-dashed border-border rounded-xl">
                    No pending {tab}.
                </div>
            ) : (
                <div className="glass-card overflow-hidden">
                    <div className="divide-y divide-border-dark">
                        {list.map(item => {
                            const id = tab === 'services' ? item.id : item.v_uuid;
                            const idField = tab === 'services' ? 'id' : 'v_uuid';
                            const kind = tab === 'villas' ? 'villa' : tab === 'boats' ? 'boat' : 'service';
                            const name = item.villa_name || item.boat_name || item.name || '—';
                            const subtitle = tab === 'villas'
                                ? [item.property_type, item.areaname || item.destination].filter(Boolean).join(' · ')
                                : tab === 'boats'
                                    ? item.type
                                    : item.provider;
                            const detailHref = tab === 'villas' ? `/villas/${id}` : tab === 'boats' ? `/boats/${id}` : null;
                            const busyKey = `${kind}:${id}`;

                            return (
                                <div key={id} className="flex items-center gap-4 p-4 hover:bg-white/2 transition-colors">
                                    <div className="size-12 rounded-xl bg-surface-2 overflow-hidden flex items-center justify-center text-text-muted">
                                        {item.thumbnail_url ? (
                                            <img src={item.thumbnail_url} alt={name} className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="material-symbols-outlined notranslate">{tab === 'villas' ? 'villa' : tab === 'boats' ? 'directions_boat' : 'concierge'}</span>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-bold text-text-primary">{name}</span>
                                            <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-full font-black uppercase">Pending</span>
                                            {item.source && (
                                                <span className="text-[9px] px-1.5 py-0.5 bg-surface-2 text-text-muted rounded-full font-black uppercase">{item.source}</span>
                                            )}
                                        </div>
                                        {subtitle && <p className="text-xs text-text-muted mt-1">{subtitle}</p>}
                                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-text-muted/70">
                                            <span className="material-symbols-outlined notranslate text-[12px]">person</span>
                                            <span>{item._creator?.company_name || item._creator?.email || (item.created_by ? `User ${item.created_by.slice(0, 8)}…` : 'Unknown creator')}</span>
                                            <span>·</span>
                                            <span>{item.created_at ? new Date(item.created_at).toLocaleString() : '-'}</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        {detailHref && (
                                            <Link to={detailHref} className="p-2 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-all" title="View details">
                                                <span className="material-symbols-outlined notranslate text-[20px]">visibility</span>
                                            </Link>
                                        )}
                                        <button
                                            onClick={() => approve(kind, idField, id)}
                                            disabled={busy === busyKey}
                                            className="px-3 py-2 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1.5 disabled:opacity-50"
                                        >
                                            <span className="material-symbols-outlined notranslate text-[16px]">check</span>
                                            Approve
                                        </button>
                                        <button
                                            onClick={() => reject(kind, idField, id, name)}
                                            disabled={busy === busyKey}
                                            className="px-3 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1.5 disabled:opacity-50"
                                        >
                                            <span className="material-symbols-outlined notranslate text-[16px]">close</span>
                                            Reject
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
