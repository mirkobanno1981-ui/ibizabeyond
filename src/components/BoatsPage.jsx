import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import BoatEditModal from './BoatEditModal';
import BoatIngestModal from './BoatIngestModal';
import BoatQuoteModal from './BoatQuoteModal';
import { getStartingFromPrice, getTotalForRange } from '../lib/boatPricing';
import { useFavoriteSet, useToggleFavorite } from '../lib/favorites';

const FALLBACK_BOAT_IMG = 'https://images.unsplash.com/photo-1567899534071-723d01397ad0?auto=format&fit=crop&w=800&q=80';

const boatTypes = ['Motor', 'Sail', 'Catamaran', 'Superyacht'];

export default function BoatsPage() {
    const { role, user, canView, canAdd } = useAuth();
    const isAdmin = role === 'admin' || role === 'super_admin';
    const canAddBoats = isAdmin || canAdd('boat');
    const canViewBoats = isAdmin || canView('boat');
    const queryClient = useQueryClient();
    const { set: favoriteSet } = useFavoriteSet(user?.id, 'boat');
    const toggleFavorite = useToggleFavorite();
    
    // UI State
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState('All');
    const [editBoat, setEditBoat] = useState(null);
    const [showIngest, setShowIngest] = useState(false);
    const [selectedBoatIds, setSelectedBoatIds] = useState([]);
    const [boatScope, setBoatScope] = useState('mine'); // 'mine' | 'all' for editor-boat tab
    const [showQuoteModal, setShowQuoteModal] = useState(false);
    const [checkIn, setCheckIn] = useState('');
    const [checkOut, setCheckOut] = useState('');
    const [guests, setGuests] = useState('');
    const [budget, setBudget] = useState('');

    const { data: boats = [], isLoading: loading } = useQuery({
        queryKey: ['boats', role, user?.id, search, typeFilter, guests, boatScope],
        queryFn: async () => {
            let query = supabase.from('boats').select(`
                *,
                owners (name, company_name)
            `);

            if (role === 'owner' && user?.id) {
                query = query.eq('owner_id', user.id);
            } else if (canAddBoats && !isAdmin && user?.id) {
                // Users with boat-add permission see all platform boats, with "mine"/"all" toggle
                if (boatScope === 'mine') {
                    query = query.eq('created_by', user.id);
                }
            } else if (role === 'agent' && user?.id) {
                // agents.id IS the auth user uuid (no separate user_id column).
                const { data: managedOwners } = await supabase
                    .from('owners')
                    .select('id')
                    .eq('agent_id', user.id);

                const ownerIds = managedOwners?.map(o => o.id) || [];
                if (ownerIds.length > 0) {
                    query = query.or(`owner_id.in.(${ownerIds.join(',')}),created_by.eq.${user.id}`);
                } else {
                    query = query.eq('created_by', user.id);
                }
            }
            if (search) {
                query = query.ilike('boat_name', `%${search}%`);
            }
            if (typeFilter !== 'All') {
                query = query.eq('type', typeFilter);
            }
            if (guests) {
                query = query.gte('guest_capacity_day', parseInt(guests));
            }

            const { data: dataAll, error } = await query.order('created_at', { ascending: false });
            if (error) throw error;
            if (!dataAll) return [];

            // Apply per-user visibility overrides (skip for super_admin)
            let data = dataAll;
            if (role !== 'super_admin' && user?.id) {
                const { data: hides } = await supabase
                    .from('entity_visibility_overrides')
                    .select('entity_id')
                    .eq('user_id', user.id)
                    .eq('entity_type', 'boat')
                    .eq('hidden', true);
                const hiddenIds = new Set((hides || []).map(h => h.entity_id));
                if (hiddenIds.size > 0) {
                    data = dataAll.filter(b => !hiddenIds.has(b.v_uuid));
                }
            }

            // 1. Fetch thumbnails + seasonal prices in parallel
            const boatUuids = data.map(b => b.v_uuid);
            const [photosRes, ratesRes] = await Promise.all([
                supabase
                    .from('property_photos')
                    .select('boat_uuid, thumbnail_url')
                    .in('boat_uuid', boatUuids)
                    .eq('sort_order', 0),
                supabase
                    .from('seasonal_prices')
                    .select('v_uuid, amount, start_date, end_date')
                    .in('v_uuid', boatUuids),
            ]);

            const photoMap = {};
            photosRes.data?.forEach(p => { if (p.boat_uuid) photoMap[p.boat_uuid] = p.thumbnail_url; });

            const ratesMap = {};
            ratesRes.data?.forEach(r => {
                if (!ratesMap[r.v_uuid]) ratesMap[r.v_uuid] = [];
                ratesMap[r.v_uuid].push(r);
            });

            // 2. Map thumbnails + startingFromPrice + per-boat rates for downstream budget filter
            return data.map(b => {
                let thumbnail = photoMap[b.v_uuid] || b.thumbnail_url || null;
                if (!thumbnail && b.photo_urls) {
                    const first = b.photo_urls.split(',')[0]?.trim();
                    if (first && first.length > 5) thumbnail = first;
                }
                const rates = ratesMap[b.v_uuid] || [];
                return {
                    ...b,
                    thumbnail,
                    startingFromPrice: getStartingFromPrice(b, rates),
                    _seasonalRates: rates,
                };
            });
        },
        enabled: !!user?.id,
        staleTime: 1000 * 60 * 5, // 5 mins
    });


    // Budget filter (client-side). With dates: estimated total for stay <= budget.
    // Without dates: startingFromPrice <= budget. Boats with no priced day are filtered out.
    const filteredBoats = useMemo(() => {
        const budgetNum = parseFloat(budget);
        if (!budgetNum || budgetNum <= 0) return boats;
        return boats.filter(b => {
            if (checkIn) {
                const total = getTotalForRange(b, b._seasonalRates || [], checkIn, checkOut || checkIn);
                return total > 0 && total <= budgetNum;
            }
            return b.startingFromPrice != null && b.startingFromPrice <= budgetNum;
        });
    }, [boats, budget, checkIn, checkOut]);

    const handleSaved = () => {
        setEditBoat(null);
        queryClient.invalidateQueries({ queryKey: ['boats'] });
    };

    const canManageBoat = (boat) =>
        isAdmin
        || role === 'agent'
        || (canAddBoats && boat.created_by === user?.id)
        || (role === 'owner' && boat.owner_id === user?.id);

    const handleToggleActive = async (boat) => {
        if (!canManageBoat(boat)) { alert('Access denied.'); return; }
        const { error } = await supabase
            .from('boats')
            .update({ is_active: !boat.is_active })
            .eq('v_uuid', boat.v_uuid);
        if (error) { alert(error.message); return; }
        queryClient.invalidateQueries({ queryKey: ['boats'] });
    };

    const handleHardDelete = async (boat) => {
        if (!canManageBoat(boat)) { alert('Access denied.'); return; }
        if (!confirm(`Permanently delete "${boat.boat_name}"? This action is irreversible.`)) return;
        await supabase.from('seasonal_prices').delete().eq('v_uuid', boat.v_uuid);
        await supabase.from('property_photos').delete().eq('boat_uuid', boat.v_uuid);
        const { error } = await supabase.from('boats').delete().eq('v_uuid', boat.v_uuid);
        if (error) { alert(error.message); return; }
        queryClient.invalidateQueries({ queryKey: ['boats'] });
    };

    return (
        <div className="p-6 md:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary">Boat Charter Inventory</h1>
                    <p className="text-text-muted text-sm mt-0.5">
                        {loading ? 'Loading...' : `${filteredBoats.length} premium vessels available`}
                    </p>
                    {canAddBoats && !isAdmin && (
                        <div className="mt-3 inline-flex bg-surface-2 border border-border rounded-xl p-1 gap-1">
                            <button
                                onClick={() => setBoatScope('mine')}
                                className={`px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest rounded-lg transition-all ${
                                    boatScope === 'mine'
                                        ? 'bg-primary text-white shadow'
                                        : 'text-text-muted hover:text-text-primary'
                                }`}
                            >
                                My boats
                            </button>
                            <button
                                onClick={() => setBoatScope('all')}
                                className={`px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest rounded-lg transition-all ${
                                    boatScope === 'all'
                                        ? 'bg-primary text-white shadow'
                                        : 'text-text-muted hover:text-text-primary'
                                }`}
                            >
                                All on platform
                            </button>
                        </div>
                    )}
                </div>
                {canAddBoats && (
                    <div className="flex gap-2 self-start">
                        <button
                            onClick={() => setShowIngest(true)}
                            className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl border border-primary/30 bg-primary/10 text-primary font-bold hover:bg-primary/20 transition-all"
                        >
                            <span className="material-symbols-outlined notranslate text-[16px]">auto_awesome</span>
                            Add with AI
                        </button>
                        <button
                            onClick={() => setEditBoat({})}
                            className="btn-primary flex items-center gap-2 text-sm"
                        >
                            <span className="material-symbols-outlined notranslate text-[16px]">add</span>
                            Add Boat
                        </button>
                    </div>
                )}
            </div>

            <div className="bg-white/90 backdrop-blur-2xl p-6 md:p-8 rounded-[2.5rem] border border-slate-200 shadow-2xl shadow-slate-200/50 relative z-30">
                <div className="flex flex-wrap gap-6 items-end">
                    <div className="flex-1 min-w-[320px] space-y-2">
                        <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] ml-1">Boat Name</label>
                        <div className="relative group">
                            <span className="material-symbols-outlined notranslate absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-[20px] group-focus-within:text-primary transition-colors">search</span>
                            <input
                                className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-primary/40 rounded-2xl pl-12 pr-4 py-4 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400"
                                placeholder="Search premium vessels..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="w-full md:w-auto flex flex-wrap gap-4">
                        <div className="w-44 space-y-2">
                            <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] ml-1">Charter From</label>
                            <input
                                type="date"
                                className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-primary/40 rounded-2xl px-5 py-4 text-sm text-slate-800 outline-none transition-all [color-scheme:light]"
                                value={checkIn}
                                min={new Date().toISOString().split('T')[0]}
                                onChange={e => {
                                    const val = e.target.value;
                                    setCheckIn(val);
                                    if (checkOut && val > checkOut) {
                                        setCheckOut('');
                                    }
                                }}
                            />
                        </div>

                        <div className="w-44 space-y-2">
                            <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] ml-1">Charter To</label>
                            <input
                                type="date"
                                className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-primary/40 rounded-2xl px-5 py-4 text-sm text-slate-800 outline-none transition-all [color-scheme:light]"
                                value={checkOut}
                                min={checkIn || new Date().toISOString().split('T')[0]}
                                onChange={e => setCheckOut(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-5 mt-8 pt-6 border-t border-slate-100">
                    <div className="w-48 space-y-1.5">
                        <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Vessel Type</label>
                        <select
                            className="w-full bg-white border border-slate-200 hover:border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all cursor-pointer"
                            value={typeFilter}
                            onChange={e => setTypeFilter(e.target.value)}
                        >
                            <option value="All">All Types</option>
                            {boatTypes.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>

                    <div className="w-32 space-y-1.5">
                        <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Day Guests</label>
                        <input
                            type="number"
                            min="1"
                            placeholder="1+"
                            className="w-full bg-white border border-slate-200 hover:border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
                            value={guests}
                            onChange={e => setGuests(e.target.value)}
                        />
                    </div>

                    <div className="w-40 space-y-1.5">
                        <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Budget (€)</label>
                        <input
                            type="number"
                            min="0"
                            placeholder="Max total"
                            title={checkIn ? 'Total for selected stay' : 'Starting price'}
                            className="w-full bg-white border border-slate-200 hover:border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all"
                            value={budget}
                            onChange={e => setBudget(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center gap-3 ml-auto pt-4">
                        {(search || typeFilter !== 'All' || guests || checkIn || checkOut || budget) && (
                            <button
                                className="h-10 px-4 text-[10px] font-black uppercase tracking-widest text-[#ff4b4b] hover:bg-[#ff4b4b]/5 transition-all flex items-center gap-2 rounded-xl"
                                onClick={() => {
                                    setSearch('');
                                    setTypeFilter('All');
                                    setGuests('');
                                    setCheckIn('');
                                    setCheckOut('');
                                    setBudget('');
                                    setSelectedBoatIds([]);
                                }}
                            >
                                <span className="material-symbols-outlined notranslate text-[16px]">refresh</span> 
                                Reset
                            </button>
                        )}
                        {selectedBoatIds.length > 0 && (
                            <button
                                className="h-10 px-6 bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 shadow-lg"
                                onClick={() => setShowQuoteModal(true)}
                            >
                                <span className="material-symbols-outlined notranslate text-[18px]">add_task</span>
                                Create Quote ({selectedBoatIds.length})
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="glass-card animate-pulse h-80" />
                    ))}
                </div>
            ) : filteredBoats.length === 0 ? (
                <div className="glass-card p-12 text-center opacity-50">
                    <span className="material-symbols-outlined notranslate text-4xl block mb-2">directions_boat</span>
                    <p className="text-sm font-bold uppercase tracking-widest">No boats found</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                    {filteredBoats.map(boat => (
                        <BoatCard
                            key={boat.v_uuid}
                            boat={boat}
                            onEdit={() => setEditBoat(boat)}
                            role={role}
                            canAddBoats={canAddBoats}
                            canManage={canManageBoat(boat)}
                            onToggleActive={() => handleToggleActive(boat)}
                            onHardDelete={() => handleHardDelete(boat)}
                            isFavorite={favoriteSet.has(boat.v_uuid)}
                            onToggleFavorite={() => toggleFavorite.mutate({
                                userId: user?.id,
                                entityType: 'boat',
                                entityId: boat.v_uuid,
                                isFav: favoriteSet.has(boat.v_uuid),
                            })}
                            isSelected={selectedBoatIds.includes(boat.v_uuid)}
                            onSelect={() => {
                                setSelectedBoatIds(prev =>
                                    prev.includes(boat.v_uuid)
                                        ? prev.filter(id => id !== boat.v_uuid)
                                        : [...prev, boat.v_uuid]
                                );
                            }}
                        />
                    ))}
                </div>
            )}

            {editBoat && (
                <BoatEditModal
                    boat={editBoat}
                    onClose={() => setEditBoat(null)}
                    onSaved={handleSaved}
                />
            )}

            {showIngest && (
                <BoatIngestModal
                    onClose={() => setShowIngest(false)}
                    onSaved={() => {
                        setShowIngest(false);
                        queryClient.invalidateQueries({ queryKey: ['boats'] });
                    }}
                />
            )}

            {showQuoteModal && (
                <BoatQuoteModal 
                    selectedBoats={boats.filter(b => selectedBoatIds.includes(b.v_uuid))}
                    checkIn={checkIn}
                    checkOut={checkOut}
                    onClose={() => setShowQuoteModal(null)}
                    onCreated={() => {
                        setShowQuoteModal(false);
                        setSelectedBoatIds([]);
                        alert('Boat quotes created successfully!');
                    }}
                />
            )}
        </div>
    );
}

function BoatCard({ boat, onEdit, role, canAddBoats, isSelected, onSelect, canManage, onToggleActive, onHardDelete, isFavorite, onToggleFavorite }) {
    const isActive = boat.is_active !== false;
    return (
        <div className={`glass-card overflow-hidden group transition-all flex flex-col relative ${isSelected ? 'border-primary shadow-lg shadow-primary/10 scale-[1.01]' : 'hover:border-primary/30'} ${!isActive ? 'opacity-60' : ''}`}>
            {/* Selection Checkbox Overlay */}
            <div 
                onClick={(e) => { e.stopPropagation(); onSelect(); }}
                className={`absolute top-3 left-3 z-20 size-6 rounded-lg border-2 flex items-center justify-center cursor-pointer transition-all ${isSelected ? 'bg-primary border-primary text-black' : 'bg-black/20 border-white/50 hover:border-white text-transparent'}`}
            >
                <span className="material-symbols-outlined notranslate text-[18px] font-bold">check</span>
            </div>

            <div className="relative aspect-[16/10] overflow-hidden bg-surface-2">
                <img
                    src={boat.thumbnail || FALLBACK_BOAT_IMG}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    alt={boat.boat_name}
                />
                <div className="absolute top-3 right-3 flex items-center gap-1.5">
                    {!isActive && (
                        <span className="bg-amber-500/90 px-2 py-1 rounded text-[10px] font-bold text-white uppercase tracking-wider">Inactive</span>
                    )}
                    <span className="bg-black/60 backdrop-blur-md px-2 py-1 rounded text-[10px] font-bold text-white uppercase tracking-wider">
                        {boat.type}
                    </span>
                    {onToggleFavorite && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
                            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                            className={`size-7 rounded-full flex items-center justify-center transition-all backdrop-blur-md ${isFavorite ? 'bg-red-500/90 text-white' : 'bg-black/40 text-white/80 hover:bg-black/60 hover:text-white'}`}
                        >
                            <span className="material-symbols-outlined notranslate text-[16px]" style={{ fontVariationSettings: isFavorite ? "'FILL' 1" : "'FILL' 0" }}>favorite</span>
                        </button>
                    )}
                </div>
                {boat.startingFromPrice != null && (
                    <div className="absolute bottom-3 left-3 bg-background/80 backdrop-blur-md border border-border px-2.5 py-1 rounded-lg">
                        <span className="text-text-muted text-[9px] uppercase tracking-widest font-bold mr-1.5">From</span>
                        <span className="text-primary font-bold text-sm">
                            €{boat.startingFromPrice.toLocaleString()}
                        </span>
                    </div>
                )}
            </div>

            <div className="p-4 flex-1 flex flex-col">
                <div className="flex justify-between items-start mb-2">
                    <div>
                        <h3 className="font-bold text-text-primary truncate">{boat.boat_name}</h3>
                        <p className="text-[10px] text-text-muted uppercase font-medium tracking-wide">
                            {boat.manufacturer} {boat.model} ({boat.year})
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-4 py-3 border-y border-border/50">
                    <div className="text-center">
                        <p className="text-[10px] text-text-muted font-bold uppercase tracking-tighter">Length</p>
                        <p className="text-xs font-black text-text-primary">{boat.length_ft}ft</p>
                    </div>
                    <div className="text-center border-x border-border/50">
                        <p className="text-[10px] text-text-muted font-bold uppercase tracking-tighter">Guests</p>
                        <p className="text-xs font-black text-text-primary">{boat.guest_capacity_day}</p>
                    </div>
                    <div className="text-center">
                        <p className="text-[10px] text-text-muted font-bold uppercase tracking-tighter">Cabins</p>
                        <p className="text-xs font-black text-text-primary">{boat.cabins || '—'}</p>
                    </div>
                </div>

                <div className="mt-4 flex flex-col gap-2">
                    {(role === 'admin' || role === 'super_admin' || role === 'owner' || role === 'agent' || canAddBoats) ? (
                        <>
                            <div className="flex gap-2">
                                <button
                                    onClick={onEdit}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:border-primary/40 hover:text-primary transition-all"
                                >
                                    <span className="material-symbols-outlined notranslate text-[13px]">edit</span>
                                    Manage
                                </button>
                                <button
                                    onClick={() => window.location.href = `/boats/${boat.v_uuid}`}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary/10 text-xs font-semibold text-primary hover:bg-primary/20 transition-all"
                                >
                                    <span className="material-symbols-outlined notranslate text-[13px]">visibility</span>
                                    View
                                </button>
                            </div>
                            {canManage && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={onToggleActive}
                                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all ${
                                            isActive
                                                ? 'border border-amber-500/40 text-amber-500 hover:bg-amber-500/10'
                                                : 'border border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10'
                                        }`}
                                    >
                                        <span className="material-symbols-outlined notranslate text-[13px]">{isActive ? 'visibility_off' : 'visibility'}</span>
                                        {isActive ? 'Disable' : 'Activate'}
                                    </button>
                                    <button
                                        onClick={onHardDelete}
                                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10 text-[11px] font-bold uppercase tracking-wider transition-all"
                                    >
                                        <span className="material-symbols-outlined notranslate text-[13px]">delete</span>
                                        Delete
                                    </button>
                                </div>
                            )}
                        </>
                    ) : (
                        <button
                            onClick={() => window.location.href = `/boats/${boat.v_uuid}`}
                            className="w-full py-2 rounded-lg bg-primary text-background-dark text-xs font-bold hover:bg-primary/90 transition-all"
                        >
                            View Details
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
