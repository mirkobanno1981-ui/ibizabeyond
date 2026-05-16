import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import ServiceEditModal from './ServiceEditModal';

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1521334884684-d80222895322?auto=format&fit=crop&w=800&q=80';

export default function ServicesPage() {
    const { role, canView, canAdd } = useAuth();
    const queryClient = useQueryClient();

    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [editService, setEditService] = useState(null);

    const isAdmin = role === 'admin' || role === 'super_admin';
    const isSuperAdmin = role === 'super_admin';
    const canManageServices = isAdmin;
    const canAddServices = isAdmin || canAdd('service');
    const canViewServices = isAdmin || canView('service');

    const { data: categories = [] } = useQuery({
        queryKey: ['service_categories'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('service_categories')
                .select('*')
                .order('sort_order', { ascending: true });
            if (error) throw error;
            return data || [];
        },
        staleTime: 1000 * 60 * 30,
    });

    const { data: services = [], isLoading: loading } = useQuery({
        queryKey: ['services', search, categoryFilter, isSuperAdmin],
        queryFn: async () => {
            let query = supabase
                .from('services')
                .select('*, service_categories(id, name, icon)');

            if (!isSuperAdmin) {
                query = query.eq('is_active', true);
            }
            if (search) {
                query = query.or(`name.ilike.%${search}%,provider.ilike.%${search}%`);
            }
            if (categoryFilter !== 'All') {
                query = query.eq('category_id', categoryFilter);
            }

            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) throw error;
            return data || [];
        },
        staleTime: 1000 * 60 * 5,
    });

    const handleSaved = () => {
        setEditService(null);
        queryClient.invalidateQueries({ queryKey: ['services'] });
        queryClient.invalidateQueries({ queryKey: ['service_categories'] });
    };

    const handleToggleActive = async (svc) => {
        if (!isAdmin) return;
        const { error } = await supabase
            .from('services')
            .update({ is_active: !svc.is_active })
            .eq('id', svc.id);
        if (error) { alert(error.message); return; }
        queryClient.invalidateQueries({ queryKey: ['services'] });
    };

    const handleDelete = async (svc) => {
        if (!isAdmin) return;
        if (!confirm(`Permanently delete "${svc.name}"?`)) return;
        const { error } = await supabase.from('services').delete().eq('id', svc.id);
        if (error) { alert(error.message); return; }
        queryClient.invalidateQueries({ queryKey: ['services'] });
    };

    return (
        <div className="p-6 md:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary">Services Catalog</h1>
                    <p className="text-text-muted text-sm mt-0.5">
                        {loading ? 'Loading...' : `${services.length} services available`}
                    </p>
                </div>
                {canAddServices && (
                    <button
                        onClick={() => setEditService({})}
                        className="btn-primary flex items-center gap-2 text-sm self-start"
                    >
                        <span className="material-symbols-outlined notranslate text-[16px]">add</span>
                        Add Service
                    </button>
                )}
            </div>

            <div className="bg-white/90 backdrop-blur-2xl p-6 rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/40">
                <div className="flex flex-wrap gap-4 items-end">
                    <div className="flex-1 min-w-[280px]">
                        <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] ml-1 block mb-2">Search</label>
                        <div className="relative">
                            <span className="material-symbols-outlined notranslate absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">search</span>
                            <input
                                className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-primary/40 rounded-2xl pl-12 pr-4 py-3.5 text-sm text-slate-800 outline-none transition-all"
                                placeholder="Search services or providers..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="w-56">
                        <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] ml-1 block mb-2">Category</label>
                        <select
                            className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-sm text-slate-800 outline-none cursor-pointer"
                            value={categoryFilter}
                            onChange={e => setCategoryFilter(e.target.value)}
                        >
                            <option value="All">All Categories</option>
                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>

                    {(search || categoryFilter !== 'All') && (
                        <button
                            className="h-12 px-4 text-[10px] font-black uppercase tracking-widest text-[#ff4b4b] hover:bg-[#ff4b4b]/5 rounded-xl transition-all"
                            onClick={() => { setSearch(''); setCategoryFilter('All'); }}
                        >
                            Clear
                        </button>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="text-text-muted text-sm">Loading...</div>
            ) : services.length === 0 ? (
                <div className="text-center py-16 text-text-muted">
                    <span className="material-symbols-outlined notranslate text-5xl text-slate-300 block mb-3">concierge</span>
                    No services found.
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                    {services.map(svc => (
                        <div
                            key={svc.id}
                            className={`group bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-xl transition-all ${!svc.is_active ? 'opacity-60' : ''}`}
                        >
                            <div className="relative h-44 bg-slate-100 overflow-hidden">
                                <img
                                    src={svc.photo_url || FALLBACK_IMG}
                                    alt={svc.name}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                    onError={(e) => { e.currentTarget.src = FALLBACK_IMG; }}
                                />
                                {svc.service_categories && (
                                    <div className="absolute top-3 left-3 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                                        <span className="material-symbols-outlined notranslate text-[14px] text-primary">{svc.service_categories.icon || 'concierge'}</span>
                                        {svc.service_categories.name}
                                    </div>
                                )}
                                {!svc.is_active && (
                                    <div className="absolute top-3 right-3 bg-red-500/90 text-white text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">Inactive</div>
                                )}
                            </div>

                            <div className="p-5 space-y-3">
                                <div>
                                    <h3 className="font-bold text-slate-900 text-base truncate">{svc.name}</h3>
                                    {svc.provider && (
                                        <p className="text-xs text-text-muted truncate mt-0.5">{svc.provider}</p>
                                    )}
                                </div>

                                {svc.description && (
                                    <p className="text-xs text-slate-600 line-clamp-2">{svc.description}</p>
                                )}

                                {svc.price != null && (
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-lg font-black text-primary">{svc.currency || 'EUR'} {Number(svc.price).toFixed(2)}</span>
                                        <span className="text-[10px] text-text-muted">/ {svc.price_unit || 'session'}</span>
                                    </div>
                                )}

                                <div className="flex items-center gap-2 text-[11px] text-text-muted">
                                    {svc.contact_phone && (
                                        <a href={`tel:${svc.contact_phone}`} className="flex items-center gap-1 hover:text-primary">
                                            <span className="material-symbols-outlined notranslate text-[14px]">call</span>
                                            {svc.contact_phone}
                                        </a>
                                    )}
                                    {svc.contact_email && (
                                        <a href={`mailto:${svc.contact_email}`} className="flex items-center gap-1 hover:text-primary truncate">
                                            <span className="material-symbols-outlined notranslate text-[14px]">mail</span>
                                            <span className="truncate">{svc.contact_email}</span>
                                        </a>
                                    )}
                                </div>

                                {canAddServices && (
                                    <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                                        <button
                                            onClick={() => setEditService(svc)}
                                            className="flex-1 text-[10px] font-bold uppercase tracking-wider py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                                        >
                                            Edit
                                        </button>
                                        {isAdmin && (
                                            <>
                                                <button
                                                    onClick={() => handleToggleActive(svc)}
                                                    className="text-[10px] font-bold uppercase tracking-wider py-2 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                                                    title={svc.is_active ? 'Deactivate' : 'Activate'}
                                                >
                                                    <span className="material-symbols-outlined notranslate text-[14px]">{svc.is_active ? 'visibility_off' : 'visibility'}</span>
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(svc)}
                                                    className="text-[10px] font-bold uppercase tracking-wider py-2 px-3 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 transition-colors"
                                                    title="Delete"
                                                >
                                                    <span className="material-symbols-outlined notranslate text-[14px]">delete</span>
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {editService !== null && (
                <ServiceEditModal
                    service={editService}
                    categories={categories}
                    onClose={() => setEditService(null)}
                    onSaved={handleSaved}
                />
            )}
        </div>
    );
}
