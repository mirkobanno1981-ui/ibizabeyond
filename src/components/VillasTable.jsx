import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import VillaEditModal from './VillaEditModal';
import { fetchICal, parseICal, isAvailable } from '../lib/calendar';

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=400&q=60';

const filterOptions = {
    sort: ['Name A-Z', 'Price: Low-High', 'Price: High-Low', 'Guests'],
};

const PAGE_SIZE = 20;

export default function VillasTable() {
    const { role } = useAuth();
    const isMounted = useRef(true);
    const [villas, setVillas] = useState([]);
    const [totalCount, setTotalCount] = useState(0);
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [margins, setMargins] = useState({ invenioToAdmin: 0, adminToAgent: 0 });
    
    // Filters
    const [search, setSearch] = useState('');
    const [guestsFilter, setGuestsFilter] = useState('Any');
    const [budgetFilter, setBudgetFilter] = useState('');
    const [sortBy, setSortBy] = useState('Name A-Z');
    const [checkIn, setCheckIn] = useState('');
    const [checkOut, setCheckOut] = useState('');
    const [selectedFeatures, setSelectedFeatures] = useState([]);
    const [availableFeatures, setAvailableFeatures] = useState([]);
    
    // UI State
    const [isFeaturesOpen, setIsFeaturesOpen] = useState(false);
    const [editVilla, setEditVilla] = useState(null);
    const featuresMenuRef = useRef(null);

    useEffect(() => {
        isMounted.current = true;
        fetchData();
        return () => { isMounted.current = false; };
    }, [role, page, search, guestsFilter, budgetFilter, sortBy, checkIn, checkOut, selectedFeatures]);

    useEffect(() => {
        // Fetch unique features once
        async function fetchFeatures() {
            const { data } = await supabase.from('invenio_properties').select('features');
            const feats = new Set();
            data?.forEach(v => (v.features || []).forEach(f => feats.add(f)));
            setAvailableFeatures(Array.from(feats).sort());
        }
        fetchFeatures();

        // Close dropdown when clicking outside
        function handleClickOutside(event) {
            if (featuresMenuRef.current && !featuresMenuRef.current.contains(event.target)) {
                setIsFeaturesOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    async function fetchData() {
        try {
            if (isMounted.current) setLoading(true);

            const { data: marginData } = await supabase
                .from('margin_settings')
                .select('invenio_to_admin_margin, admin_to_agent_margin')
                .limit(1)
                .maybeSingle();

            let currentMargins = { invenioToAdmin: 0, adminToAgent: 0 };
            if (marginData) {
                currentMargins = {
                    invenioToAdmin: parseFloat(marginData.invenio_to_admin_margin) || 0,
                    adminToAgent: parseFloat(marginData.admin_to_agent_margin) || 0,
                };
                if (isMounted.current) setMargins(currentMargins);
            }

            // Build Base Query with Filters
            let query = supabase.from('invenio_properties').select(`
                    v_uuid, villa_name, bedrooms, bathrooms, sleeps,
                    minimum_price, maximum_price,
                    areaname, district, allow_shortstays, features, ical_url
                `, { count: 'exact' });

            if (search) {
                query = query.or(`villa_name.ilike.%${search}%,areaname.ilike.%${search}%`);
            }

            if (guestsFilter !== 'Any') {
                query = query.gte('sleeps', parseInt(guestsFilter));
            }

            // Features Filter (Multi-select)
            if (selectedFeatures.length > 0) {
                // PostgREST 'cs' for JSONB requires a JSON string of the array
                query = query.filter('features', 'cs', JSON.stringify(selectedFeatures));
            }

            // Budget filter - reverse the margin calculation to filter the base price
            if (budgetFilter) {
                const maxBudget = parseFloat(budgetFilter);
                let reverseMargin = 1 + (currentMargins.invenioToAdmin / 100);
                if (role !== 'admin') {
                    reverseMargin *= (1 + (currentMargins.adminToAgent / 100));
                }
                const baseMax = maxBudget / reverseMargin;
                query = query.lte('minimum_price', baseMax);
            }

            // Apply Sorting
            if (sortBy === 'Name A-Z') query = query.order('villa_name', { ascending: true });
            else if (sortBy === 'Price: Low-High') query = query.order('minimum_price', { ascending: true });
            else if (sortBy === 'Price: High-Low') query = query.order('minimum_price', { ascending: false });
            else if (sortBy === 'Guests') query = query.order('sleeps', { ascending: false });

            const { data: villasData, count, error: villasError } = await query
                .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

            if (villasError) throw villasError;
            if (!isMounted.current) return;

            setTotalCount(count || 0);

            const villaUuids = (villasData || []).map(v => v.v_uuid);
            const { data: photosData } = await supabase
                .from('invenio_photos')
                .select('v_uuid, thumbnail_url')
                .in('v_uuid', villaUuids)
                .eq('sort_order', 0);

            const photoMap = {};
            (photosData || []).forEach(p => {
                if (p.v_uuid && p.thumbnail_url) {
                    photoMap[p.v_uuid] = p.thumbnail_url;
                }
            });

            // Parallel availability check if dates are selected
            let processedVillas = villasData || [];
            if (checkIn && checkOut) {
                const availabilityResults = await Promise.all(
                    processedVillas.map(async villa => {
                        if (!villa.ical_url) return true;
                        const icalData = await fetchICal(villa.ical_url);
                        if (!icalData) return true;
                        const events = parseICal(icalData);
                        return isAvailable(events, checkIn, checkOut);
                    })
                );
                processedVillas = processedVillas.filter((_, idx) => availabilityResults[idx]);
            }

            const formatted = processedVillas.map(villa => {
                const basePrice = parseFloat(villa.minimum_price || villa.maximum_price) || 0;
                let displayPrice = basePrice;
                if (role === 'admin') {
                    displayPrice = basePrice * (1 + currentMargins.invenioToAdmin / 100);
                } else {
                    const adminPrice = basePrice * (1 + currentMargins.invenioToAdmin / 100);
                    displayPrice = adminPrice * (1 + currentMargins.adminToAgent / 100);
                }

                return {
                    ...villa,
                    thumbnail: photoMap[villa.v_uuid] || null,
                    displayPrice: Math.round(displayPrice),
                };
            });

            setVillas(formatted);
        } catch (err) {
            console.error('Error fetching villas:', err);
            if (isMounted.current) setError('Unable to load villa inventory. ' + (err.message || ''));
        } finally {
            if (isMounted.current) setLoading(false);
        }
    }

    // Server-side filtering applied in fetchData
    const filtered = villas;

    const handleSaved = (updatedVilla) => {
        setVillas(prev => prev.map(v => v.v_uuid === updatedVilla.v_uuid ? { ...v, ...updatedVilla } : v));
        setEditVilla(null);
    };

    return (
        <div className="p-6 md:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">Villa Inventory</h1>
                    <p className="text-slate-500 text-sm mt-0.5">
                        {loading ? 'Loading...' : `${totalCount} exclusive properties in Ibiza`}
                    </p>
                </div>
                {role === 'admin' && (
                    <button className="btn-primary flex items-center gap-2 text-sm self-start">
                        <span className="material-symbols-outlined text-[16px]">add</span>
                        Add Villa
                    </button>
                )}
            </div>

            {error && (
                <div className="glass-card p-4 border-red-500/30 text-red-400 text-sm flex items-start gap-3">
                    <span className="material-symbols-outlined text-[20px] flex-shrink-0">error</span>
                    <div>
                        <p className="font-semibold">Failed to load villas</p>
                        <p className="text-xs text-red-400/70 mt-0.5">{error}</p>
                        <button
                            className="mt-2 text-xs text-primary hover:underline"
                            onClick={() => { setError(null); fetchData(); }}
                        >Retry</button>
                    </div>
                </div>
            )}

            {!error && (
                <div className="flex flex-wrap gap-4 items-end bg-surface-dark/40 p-6 rounded-xl border border-border-dark">
                    <div className="flex-1 min-w-[300px] space-y-1.5">
                        <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Search</label>
                        <div className="relative">
                            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[18px]">search</span>
                            <input
                                className="input-dark w-full pl-10"
                                placeholder="Villa name or area..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="w-40 space-y-1.5">
                        <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Check-in</label>
                        <input
                            type="date"
                            className="input-dark w-full py-2 text-sm"
                            value={checkIn}
                            onChange={e => setCheckIn(e.target.value)}
                        />
                    </div>

                    <div className="w-40 space-y-1.5">
                        <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Check-out</label>
                        <input
                            type="date"
                            className="input-dark w-full py-2 text-sm"
                            value={checkOut}
                            onChange={e => setCheckOut(e.target.value)}
                        />
                    </div>
                    
                    <div className="w-44 space-y-1.5">
                        <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Guests</label>
                        <select
                            className="input-dark w-full py-2 text-sm"
                            value={guestsFilter}
                            onChange={e => setGuestsFilter(e.target.value)}
                        >
                            <option value="Any">Any Guests</option>
                            {[2,4,6,8,10,12,14,16].map(n => (
                                <option key={n} value={n}>{n}+ Guests</option>
                            ))}
                        </select>
                    </div>

                    <div className="w-40 space-y-1.5">
                        <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Budget</label>
                        <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">€</span>
                            <input
                                type="number"
                                className="input-dark w-full py-2 text-sm pl-6"
                                placeholder="Max Budget"
                                value={budgetFilter}
                                onChange={e => setBudgetFilter(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="w-48 space-y-1.5 relative" ref={featuresMenuRef}>
                        <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Features</label>
                        <div 
                            className="input-dark w-full flex items-center justify-between cursor-pointer py-2 text-sm"
                            onClick={() => setIsFeaturesOpen(!isFeaturesOpen)}
                        >
                            <span className="text-slate-400 truncate">
                                {selectedFeatures.length > 0 
                                    ? `${selectedFeatures.length} selected` 
                                    : 'Select features...'}
                            </span>
                            <span className="material-symbols-outlined text-slate-500 text-[18px]">
                                {isFeaturesOpen ? 'expand_less' : 'expand_more'}
                            </span>
                        </div>
                        {isFeaturesOpen && (
                            <div className="absolute bottom-full mb-2 left-0 w-full bg-surface-dark2 border border-border-dark rounded-xl shadow-2xl z-50 p-2 max-h-60 overflow-y-auto space-y-1 animate-in slide-in-from-bottom-2 duration-200">
                                {availableFeatures.map(f => (
                                    <label key={f} className="flex items-center gap-3 p-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors">
                                        <input 
                                            type="checkbox" 
                                            className="accent-primary"
                                            checked={selectedFeatures.includes(f)}
                                            onChange={() => {
                                                const newFeats = selectedFeatures.includes(f)
                                                    ? selectedFeatures.filter(x => x !== f)
                                                    : [...selectedFeatures, f];
                                                setSelectedFeatures(newFeats);
                                            }}
                                        />
                                        <span className="text-sm text-slate-300">{f}</span>
                                    </label>
                                ))}
                                {availableFeatures.length === 0 && <p className="text-xs text-slate-500 p-2">Loading features...</p>}
                            </div>
                        )}
                    </div>

                    <div className="w-40 space-y-1.5">
                        <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Sort</label>
                        <select
                            className="input-dark w-full py-2 text-sm"
                            value={sortBy}
                            onChange={e => setSortBy(e.target.value)}
                        >
                            {filterOptions.sort.map(s => <option key={s}>{s}</option>)}
                        </select>
                    </div>

                    {(search || guestsFilter !== 'Any' || budgetFilter || checkIn || checkOut || selectedFeatures.length > 0) && (
                        <button
                            className="h-10 px-4 text-xs text-slate-400 hover:text-red-400 transition-colors flex items-center gap-2 bg-red-400/5 border border-red-400/10 rounded-lg"
                            onClick={() => { 
                                setSearch(''); 
                                setGuestsFilter('Any'); 
                                setBudgetFilter(''); 
                                setCheckIn(''); 
                                setCheckOut(''); 
                                setSelectedFeatures([]);
                            }}
                        >
                            <span className="material-symbols-outlined text-[16px]">refresh</span> 
                            Clear All
                        </button>
                    )}
                </div>
            )}

            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                    {[...Array(8)].map((_, i) => (
                        <div key={i} className="glass-card animate-pulse h-80" />
                    ))}
                </div>
            ) : !error && filtered.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <span className="material-symbols-outlined text-4xl text-slate-600 block mb-2">sentiment_dissatisfied</span>
                    <p className="text-slate-200 font-medium">No villas match your filters.</p>
                    <p className="text-slate-500 text-sm mt-1">Try adjusting your guest count or budget.</p>
                </div>
            ) : !error ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                    {filtered.map(villa => (
                        <VillaCard
                            key={villa.v_uuid}
                            villa={villa}
                            role={role}
                            onEdit={() => setEditVilla(villa)}
                        />
                    ))}
                </div>
            ) : null}

            {!loading && !error && totalCount > PAGE_SIZE && (
                <div className="flex items-center justify-center gap-3 pt-6">
                    <button
                        className="px-4 py-2 rounded-lg border border-border-dark text-sm text-slate-400 hover:text-primary hover:border-primary/30 transition-all disabled:opacity-40"
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                    >
                        ← Previous
                    </button>
                    <span className="text-xs text-slate-500">
                        Page {page + 1} of {Math.ceil(totalCount / PAGE_SIZE)}
                    </span>
                    <button
                        className="px-4 py-2 rounded-lg border border-border-dark text-sm text-slate-400 hover:text-primary hover:border-primary/30 transition-all disabled:opacity-40"
                        onClick={() => setPage(p => p + 1)}
                        disabled={(page + 1) * PAGE_SIZE >= totalCount}
                    >
                        Next →
                    </button>
                </div>
            )}

            {editVilla && (
                <VillaEditModal
                    villa={editVilla}
                    onClose={() => setEditVilla(null)}
                    onSaved={handleSaved}
                />
            )}
        </div>
    );
}

function VillaCard({ villa, role, onEdit }) {
    return (
        <div className="glass-card overflow-hidden group hover:border-primary/30 transition-all flex flex-col">
            <div className="relative aspect-[4/3] overflow-hidden bg-surface-dark2">
                <img
                    src={villa.thumbnail || FALLBACK_IMG}
                    alt={villa.villa_name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    onError={e => { e.currentTarget.src = FALLBACK_IMG; }}
                    loading="lazy"
                />
                <div className="absolute bottom-3 left-3 bg-background-dark/80 backdrop-blur-sm border border-border-dark px-2.5 py-1 rounded-lg">
                    <span className="text-primary font-bold text-sm">
                        {villa.displayPrice > 0 ? `€${villa.displayPrice.toLocaleString()}` : 'POA'}
                    </span>
                    {villa.displayPrice > 0 && <span className="text-slate-400 text-[10px]">/wk</span>}
                </div>
                {villa.allow_shortstays === 'yes' && (
                    <div className="absolute top-3 right-3 bg-primary/90 text-background-dark text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                        Short Stay
                    </div>
                )}
            </div>

            <div className="p-4 flex-1 flex flex-col">
                <h3 className="font-semibold text-sm text-white truncate mb-0.5">
                    {villa.villa_name || 'Unnamed Villa'}
                </h3>
                <div className="flex items-center gap-1 text-slate-500 text-xs mb-3">
                    <span className="material-symbols-outlined text-[12px]">location_on</span>
                    <span>{villa.areaname || villa.district || 'Ibiza'}</span>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 mt-auto">
                    <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">bed</span>
                        {villa.bedrooms || '—'}
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">shower</span>
                        {villa.bathrooms || '—'}
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">group</span>
                        {villa.sleeps || '—'}
                    </span>
                </div>

                <div className="mt-3 flex gap-2">
                    {role === 'admin' ? (
                        <>
                            <button
                                onClick={onEdit}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border-dark text-xs font-semibold text-slate-300 hover:border-primary/40 hover:text-primary transition-all"
                            >
                                <span className="material-symbols-outlined text-[13px]">edit</span>
                                Edit
                            </button>
                            <button 
                                onClick={() => window.location.href = `/villas/${villa.v_uuid}`}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary/10 text-xs font-semibold text-primary hover:bg-primary/20 transition-all"
                            >
                                <span className="material-symbols-outlined text-[13px]">visibility</span>
                                View
                            </button>
                        </>
                    ) : (
                        <button 
                            onClick={() => window.location.href = `/villas/${villa.v_uuid}`}
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
