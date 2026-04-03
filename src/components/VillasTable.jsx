import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import VillaEditModal from './VillaEditModal';
import { fetchICal, parseICal, isAvailable, getBlockedDates } from '../lib/calendar';
import VillaMap from './VillaMap';

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=400&q=60';

const filterOptions = {
    sort: ['Name A-Z', 'Price: Low-High', 'Price: High-Low', 'Guests'],
};

const PAGE_SIZE = 20;

export default function VillasTable() {
    const { role, user } = useAuth();
    const queryClient = useQueryClient();
    const isMounted = useRef(true);
    
    // UI State (Non-data)
    const [page, setPage] = useState(0);
    
    // Filters
    const [search, setSearch] = useState('');
    const [guestsFilter, setGuestsFilter] = useState('Any');
    const [budgetFilter, setBudgetFilter] = useState('');
    const [sortBy, setSortBy] = useState('Name A-Z');
    const [checkIn, setCheckIn] = useState('');
    const [checkOut, setCheckOut] = useState('');
    const [selectedFeatures, setSelectedFeatures] = useState([]);
    const [availableFeatures, setAvailableFeatures] = useState([]);
    const [bedroomsFilter, setBedroomsFilter] = useState('Any');
    const [bathroomsFilter, setBathroomsFilter] = useState('Any');
    const [checkInRule, setCheckInRule] = useState('Any');
    const [minStayFilter, setMinStayFilter] = useState('Any');
    
    const [viewMode, setViewMode] = useState('grid');
    const featuresMenuRef = useRef(null);
    const [isFeaturesOpen, setIsFeaturesOpen] = useState(false);
    const [editVilla, setEditVilla] = useState(null);

    // Bulk selection state
    const [selectedVillaIds, setSelectedVillaIds] = useState([]);
    const [showBulkModal, setShowBulkModal] = useState(false);

    // --- Data Queries ---
    const { data: marginDataObj } = useQuery({
        queryKey: ['margins', user?.id, role],
        queryFn: async () => {
            const { data: mData } = await supabase
                .from('margin_settings')
                .select('invenio_to_admin_margin, admin_to_agent_margin, iva_percent')
                .limit(1)
                .maybeSingle();

            let currentMargins = { 
                invenioToAdmin: parseFloat(mData?.invenio_to_admin_margin) || 0, 
                adminToAgent: parseFloat(mData?.admin_to_agent_margin) || 0,
                ivaPercent: parseFloat(mData?.iva_percent) || 21
            };

            if (user?.id && role === 'agent') {
                const { data: agentProfile } = await supabase
                    .from('agents')
                    .select('admin_margin')
                    .eq('id', user.id)
                    .single();
                
                if (agentProfile?.admin_margin > 0) {
                    currentMargins.invenioToAdmin = parseFloat(agentProfile.admin_margin);
                }
            }
            return currentMargins;
        },
        staleTime: 1000 * 60 * 30, // 30 mins
    });

    const margins = marginDataObj || { invenioToAdmin: 0, adminToAgent: 0, ivaPercent: 21 };

    const { data: villasData = { list: [], total: 0 }, isLoading: loading, error: queryError } = useQuery({
        queryKey: ['villas', role, user?.id, search, guestsFilter, budgetFilter, checkIn, checkOut, selectedFeatures, bedroomsFilter, bathroomsFilter, checkInRule, minStayFilter, sortBy],
        queryFn: async () => {
            // 1. Fetch Villas (All matching base filters)
            let query = supabase.from('invenio_properties').select('*');

            if (role === 'owner' && user?.id) {
                query = query.eq('owner_id', user.id);
            }
            if (search) {
                query = query.or(`villa_name.ilike.%${search}%,areaname.ilike.%${search}%`);
            }
            if (guestsFilter !== 'Any') {
                query = query.gte('sleeps', parseInt(guestsFilter));
            }
            if (selectedFeatures.length > 0) {
                query = query.filter('features', 'cs', JSON.stringify(selectedFeatures));
            }
            if (bedroomsFilter !== 'Any') {
                query = query.gte('bedrooms', parseInt(bedroomsFilter));
            }
            if (bathroomsFilter !== 'Any') {
                query = query.gte('bathrooms', parseInt(bathroomsFilter));
            }
            if (checkInRule !== 'Any') {
                query = query.eq('allowed_checkin_days', checkInRule);
            }
            if (minStayFilter !== 'Any') {
                query = query.eq('minimum_nights', parseInt(minStayFilter));
            }

            const { data: villasRaw, error: vErr } = await query;
            if (vErr) throw vErr;
            if (!villasRaw) return { list: [], total: 0 };

            // 2. Fetch Photos
            const villaUuids = villasRaw.map(v => v.v_uuid);
            const { data: photosData } = await supabase
                .from('invenio_photos')
                .select('v_uuid, thumbnail_url')
                .in('v_uuid', villaUuids)
                .eq('sort_order', 0);

            const photoMap = {};
            photosData?.forEach(p => { if (p.v_uuid) photoMap[p.v_uuid] = p.thumbnail_url; });

            // 3. (Optional) Fetch Seasonal Rates if dates selected
            let seasonalRatesMap = {};
            if (checkIn && checkOut) {
                const { data: ratesData } = await supabase
                    .from('invenio_seasonal_prices')
                    .select('*')
                    .in('v_uuid', villaUuids)
                    .lte('start_date', checkOut)
                    .gte('end_date', checkIn);
                
                ratesData?.forEach(r => {
                    if (!seasonalRatesMap[r.v_uuid]) seasonalRatesMap[r.v_uuid] = [];
                    seasonalRatesMap[r.v_uuid].push(r);
                });
            }

            // 4. Availability check (iCal)
            let processedVillas = villasRaw;
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

            // 5. Price Calculation Logic
            const checkInDate = checkIn ? new Date(checkIn) : null;
            const checkOutDate = checkOut ? new Date(checkOut) : null;
            const today = new Date(); today.setHours(0,0,0,0);
            const diffDays = (checkInDate && checkOutDate) ? Math.ceil(Math.abs(checkOutDate - checkInDate) / 86400000) : 7;
            const isLastMinute = checkInDate && (checkInDate - today) / 86400000 <= 7;
            const isLongStay = diffDays >= 28;
            const isShortStay = diffDays <= 6;

            let formatted = [];
            for (const villa of processedVillas) {
                let totalBase = 0;
                let isValid = true;
                let ruleViolation = '';

                if (checkIn && checkOut) {
                    const villaRates = seasonalRatesMap[villa.v_uuid] || [];
                    let stayRule = { minimum_nights: villa.minimum_nights || 7, allowed_checkin_days: villa.allowed_checkin_days || 'Flexible' };

                    // Gap Logic
                    let isGapBooking = false;
                    if (villa.ical_url) {
                        const icalData = await fetchICal(villa.ical_url);
                        if (icalData) {
                            const events = parseICal(icalData);
                            const blocked = getBlockedDates(events).sort();
                            let prevBooking = null; let nextBooking = null;
                            for (const d of blocked) {
                                if (d < checkIn) prevBooking = d;
                                if (d > checkOut && !nextBooking) nextBooking = d;
                            }
                            if (prevBooking && nextBooking) {
                                const gapStart = new Date(prevBooking); gapStart.setDate(gapStart.getDate() + 1);
                                const gapEnd = new Date(nextBooking); gapEnd.setDate(gapEnd.getDate() - 1);
                                const gapNights = Math.ceil((gapEnd - gapStart) / 86400000) + 1;
                                if (gapNights >= 3 && diffDays >= 3) isGapBooking = true;
                            }
                        }
                    }

                    for (let i = 0; i < diffDays; i++) {
                        const d = new Date(checkInDate); d.setDate(checkInDate.getDate() + i);
                        const rate = villaRates.find(r => d >= new Date(r.start_date) && d <= new Date(r.end_date));
                        if (rate && i === 0) stayRule = { minimum_nights: rate.minimum_nights || stayRule.minimum_nights, allowed_checkin_days: rate.allowed_checkin_days || stayRule.allowed_checkin_days };
                        totalBase += rate ? parseFloat(rate.amount) : (parseFloat(villa.minimum_price) / 7);
                    }
                    totalBase += parseFloat(villa.cleaning_charge || 0);

                    if (stayRule.allowed_checkin_days === 'Strictly Saturday-Saturday' && (checkInDate.getUTCDay() !== 6 || checkOutDate.getUTCDay() !== 6)) isValid = false;
                    if (isValid && !isGapBooking) {
                        const allowBypass = isLongStay || (isLastMinute && diffDays >= 3);
                        if (!allowBypass && diffDays < stayRule.minimum_nights) isValid = false;
                    } else if (isValid && diffDays < 3) isValid = false;

                    if (isValid && isShortStay && (villa.allow_shortstays === '1' || villa.allow_shortstays === 'yes')) {
                        let factor = { 3: 0.5, 4: 0.25, 5: 0.2, 6: 0.1 }[diffDays] || 0;
                        if (factor > 0) totalBase = (totalBase * (1 + factor)) + 200;
                    } else if (isValid && isShortStay) isValid = false;
                } else {
                    totalBase = parseFloat(villa.minimum_price || villa.maximum_price) || 0;
                }

                if (!isValid) continue;
                const displayPrice = totalBase * (1 + margins.invenioToAdmin / 100);
                if (isShortStay && checkIn && checkOut && displayPrice < 3500) continue;

                formatted.push({
                    ...villa,
                    thumbnail: photoMap[villa.v_uuid] || villa.thumbnail_url || null,
                    displayPrice: Math.round(displayPrice),
                    supplierPrice: totalBase,
                    priceType: (checkIn && checkOut) ? 'total' : 'weekly'
                });
            }

            // Sorting
            const sortMap = {
                'Name A-Z': (a,b) => a.villa_name.localeCompare(b.villa_name),
                'Price: Low-High': (a,b) => a.displayPrice - b.displayPrice,
                'Price: High-Low': (a,b) => b.displayPrice - a.displayPrice,
                'Guests': (a,b) => b.sleeps - a.sleeps
            };
            formatted.sort(sortMap[sortBy] || sortMap['Name A-Z']);

            if (budgetFilter) {
                formatted = formatted.filter(v => v.displayPrice <= parseFloat(budgetFilter));
            }

            return { list: formatted, total: formatted.length };
        },
        enabled: !!user?.id,
        staleTime: 1000 * 60 * 5, // 5 mins
    });

    const villas = villasData.list;
    const totalCount = villasData.total;
    const error = queryError?.message || null;


    useEffect(() => {
        // Fetch unique features once
        async function fetchFeatures() {
            try {
                const { data, error } = await supabase.from('invenio_properties').select('features');
                if (error) throw error;
                const feats = new Set();
                data?.forEach(v => (v.features || []).forEach(f => feats.add(f)));
                setAvailableFeatures(Array.from(feats).sort());
            } catch (err) {
                console.error("[VillasTable] Failed to fetch features:", err);
            }
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


    // Server-side filtering applied in fetchData
    const filtered = villas;

    const handleSaved = (updatedVilla) => {
        queryClient.invalidateQueries({ queryKey: ['villas'] });
        setEditVilla(null);
    };

    return (
        <div className="p-6 md:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary">Villa Inventory</h1>
                    <p className="text-text-muted text-sm mt-0.5">
                        {loading ? 'Loading...' : `${totalCount} exclusive properties in Ibiza`}
                    </p>
                </div>
                {(role === 'admin' || role === 'super_admin' || role === 'editor') && (
                    <button 
                        onClick={() => setEditVilla({ 
                            v_uuid: null, 
                            villa_name: '', 
                            areaname: '', 
                            district: '', 
                            bedrooms: 0, 
                            bathrooms: 0, 
                            sleeps: 0, 
                            minimum_price: 0, 
                            maximum_price: 0, 
                            cleaning_charge: 0,
                            tagline: '',
                            description: '',
                            ical_url: '',
                            allow_shortstays: 'no',
                            minimum_nights: 7,
                            allowed_checkin_days: 'Flexible check in days',
                            thumbnail_url: '',
                            license: '',
                            gps: '',
                            deposit: 0,
                            features: [] 
                        })}
                        className="btn-primary flex items-center gap-2 text-sm self-start"
                    >
                        <span className="material-symbols-outlined notranslate text-[16px]">add</span>
                        Add Villa
                    </button>
                )}
                
                <div className="flex items-center gap-1 bg-surface-2 p-1 rounded-xl border border-border">
                    <button 
                        onClick={() => setViewMode('grid')}
                        className={`p-2 rounded-lg transition-all flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${viewMode === 'grid' ? 'bg-primary text-black shadow-lg shadow-primary/20' : 'text-text-muted hover:text-text-primary'}`}
                    >
                        <span className="material-symbols-outlined notranslate text-[18px]">grid_view</span>
                        Grid
                    </button>
                    <button 
                        onClick={() => setViewMode('map')}
                        className={`p-2 rounded-lg transition-all flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${viewMode === 'map' ? 'bg-primary text-black shadow-lg shadow-primary/20' : 'text-text-muted hover:text-text-primary'}`}
                    >
                        <span className="material-symbols-outlined notranslate text-[18px]">map</span>
                        Map
                    </button>
                </div>
            </div>

            {error && (
                <div className="glass-card p-4 border-red-500/30 text-red-400 text-sm flex items-start gap-3">
                    <span className="material-symbols-outlined notranslate text-[20px] flex-shrink-0">error</span>
                    <div>
                        <p className="font-semibold">Failed to load villas</p>
                        <p className="text-xs text-red-400/70 mt-0.5">{error}</p>
                        <button
                            className="mt-2 text-xs text-primary hover:underline"
                            onClick={() => { queryClient.invalidateQueries({ queryKey: ['villas'] }); }}
                        >Retry</button>
                    </div>
                </div>
            )}

            {!error && (
                <div className="space-y-4 mb-8 relative z-30">
                    {/* Primary Search Bar - Premium Light Look */}
                    <div className="bg-white/90 backdrop-blur-2xl p-6 md:p-8 rounded-[2.5rem] border border-slate-200 shadow-2xl shadow-slate-200/50">
                        <div className="flex flex-wrap gap-6 items-end">
                            <div className="flex-1 min-w-[320px] space-y-2">
                                <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] ml-1">Location or Villa Name</label>
                                <div className="relative group">
                                    <span className="material-symbols-outlined notranslate absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-[20px] group-focus-within:text-primary transition-colors">search</span>
                                    <input
                                        className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-primary/40 rounded-2xl pl-12 pr-4 py-4 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400"
                                        placeholder="Where would you like to stay?"
                                        value={search}
                                        onChange={e => setSearch(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="w-full md:w-auto flex flex-wrap gap-4">
                                <div className="w-44 space-y-2">
                                    <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] ml-1">Check-in</label>
                                    <input
                                        type="date"
                                        className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-primary/40 rounded-2xl px-5 py-4 text-sm text-slate-800 outline-none transition-all [color-scheme:light]"
                                        value={checkIn}
                                        min={new Date().toISOString().split('T')[0]}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setCheckIn(val);
                                            if (checkOut && val >= checkOut) {
                                                setCheckOut('');
                                            }
                                        }}
                                    />
                                </div>

                                <div className="w-44 space-y-2">
                                    <label className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] ml-1">Check-out</label>
                                    <input
                                        type="date"
                                        className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-primary/40 rounded-2xl px-5 py-4 text-sm text-slate-800 outline-none transition-all [color-scheme:light]"
                                        value={checkOut}
                                        min={checkIn ? new Date(new Date(checkIn).getTime() + 86400000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}
                                        onChange={e => setCheckOut(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Advanced Filters Row */}
                        <div className="flex flex-wrap gap-5 mt-8 pt-6 border-t border-slate-100">
                            <div className="w-32 space-y-1.5">
                                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Guests</label>
                                <select
                                    className="w-full bg-white border border-slate-200 hover:border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all cursor-pointer"
                                    value={guestsFilter}
                                    onChange={e => setGuestsFilter(e.target.value)}
                                >
                                    <option value="Any">Any Guests</option>
                                    {[2,4,6,8,10,12,14,16].map(n => (
                                        <option key={n} value={n}>{n}+ Guests</option>
                                    ))}
                                </select>
                            </div>

                            <div className="w-36 space-y-1.5">
                                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Budget</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">€</span>
                                    <input
                                        type="number"
                                        className="w-full bg-white border border-slate-200 hover:border-slate-300 rounded-xl pl-6 pr-3 py-2 text-xs text-slate-800 outline-none transition-all"
                                        placeholder="Max Budget"
                                        value={budgetFilter}
                                        onChange={e => setBudgetFilter(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="flex-1 min-w-[200px] space-y-1.5 relative" ref={featuresMenuRef}>
                                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Special Features</label>
                                <div 
                                    className="w-full bg-white border border-slate-200 hover:border-slate-300 rounded-xl px-4 py-2 text-xs text-slate-800 flex items-center justify-between cursor-pointer transition-all shadow-sm"
                                    onClick={() => setIsFeaturesOpen(!isFeaturesOpen)}
                                >
                                    <span className="truncate opacity-70">
                                        {selectedFeatures.length > 0 
                                            ? `${selectedFeatures.length} selected` 
                                            : 'Filter by features...'}
                                    </span>
                                    <span className="material-symbols-outlined notranslate text-[16px] opacity-40">
                                        {isFeaturesOpen ? 'expand_less' : 'expand_more'}
                                    </span>
                                </div>
                                {isFeaturesOpen && (
                                    <div className="absolute top-full mt-2 left-0 w-full bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 p-3 max-h-72 overflow-y-auto space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
                                        {availableFeatures.map(f => (
                                            <label key={f} className="flex items-center gap-3 p-2.5 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors group">
                                                <input 
                                                    type="checkbox" 
                                                    className="accent-primary size-3.5"
                                                    checked={selectedFeatures.includes(f)}
                                                    onChange={() => {
                                                        const newFeats = selectedFeatures.includes(f)
                                                            ? selectedFeatures.filter(x => x !== f)
                                                            : [...selectedFeatures, f];
                                                        setSelectedFeatures(newFeats);
                                                    }}
                                                />
                                                <span className="text-[11px] text-slate-600 group-hover:text-slate-900 transition-colors">{f}</span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="w-28 space-y-1.5">
                                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Beds</label>
                                <select
                                    className="w-full bg-white border border-slate-200 hover:border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all cursor-pointer"
                                    value={bedroomsFilter}
                                    onChange={e => setBedroomsFilter(e.target.value)}
                                >
                                    <option value="Any">Any</option>
                                    {[1,2,3,4,5,6,7,8,10,12].map(n => (
                                        <option key={n} value={n}>{n}+ Beds</option>
                                    ))}
                                </select>
                            </div>

                            <div className="w-44 space-y-1.5">
                                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Check-in Rule</label>
                                <select
                                    className="w-full bg-white border border-slate-200 hover:border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all cursor-pointer"
                                    value={checkInRule}
                                    onChange={e => setCheckInRule(e.target.value)}
                                >
                                    <option value="Any">Any Rule</option>
                                    <option value="Strictly Saturday-Saturday">Sat - Sat Only</option>
                                    <option value="Flexible check in days">Flexible Dates</option>
                                </select>
                            </div>

                            <div className="w-32 space-y-1.5">
                                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Min Nights</label>
                                <select
                                    className="w-full bg-white border border-slate-200 hover:border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all cursor-pointer"
                                    value={minStayFilter}
                                    onChange={e => setMinStayFilter(e.target.value)}
                                >
                                    <option value="Any">Any</option>
                                    {[1,2,3,4,5,6,7,10,14].map(n => (
                                        <option key={n} value={n}>{n} Nights</option>
                                    ))}
                                </select>
                            </div>

                            <div className="w-32 space-y-1.5">
                                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Sort By</label>
                                <select
                                    className="w-full bg-white border border-slate-200 hover:border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none transition-all cursor-pointer"
                                    value={sortBy}
                                    onChange={e => setSortBy(e.target.value)}
                                >
                                    {filterOptions.sort.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>

                             <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-100">
                                <div className="flex items-center gap-4">
                                    {(search || guestsFilter !== 'Any' || budgetFilter || checkIn || checkOut || selectedFeatures.length > 0 || bedroomsFilter !== 'Any' || bathroomsFilter !== 'Any' || checkInRule !== 'Any' || minStayFilter !== 'Any') && (
                                        <button
                                            className="h-10 px-4 text-[10px] font-black uppercase tracking-widest text-[#ff4b4b] hover:bg-[#ff4b4b]/5 transition-all flex items-center gap-2 rounded-xl"
                                            onClick={() => { 
                                                setSearch(''); 
                                                setGuestsFilter('Any'); 
                                                setBudgetFilter(''); 
                                                setCheckIn(''); 
                                                setCheckOut(''); 
                                                setSelectedFeatures([]);
                                                setBedroomsFilter('Any');
                                                setBathroomsFilter('Any');
                                                setCheckInRule('Any');
                                                setMinStayFilter('Any');
                                                setSelectedVillaIds([]);
                                            }}
                                        >
                                            <span className="material-symbols-outlined notranslate text-[16px]">refresh</span> 
                                            Clear Filters
                                        </button>
                                    )}
                                </div>

                                <div className="flex items-center gap-3">
                                    {selectedVillaIds.length > 0 && (
                                        <button
                                            className="h-10 px-6 bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 shadow-lg"
                                            onClick={() => setShowBulkModal(true)}
                                        >
                                            <span className="material-symbols-outlined notranslate text-[18px]">add_task</span>
                                            Create Mass Quote ({selectedVillaIds.length})
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
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
                    <span className="material-symbols-outlined notranslate text-4xl text-text-muted block mb-2">sentiment_dissatisfied</span>
                    <p className="text-text-primary font-medium">No villas match your filters.</p>
                    <p className="text-text-muted text-sm mt-1">Try adjusting your dates or budget.</p>
                </div>
            ) : !error ? (
                <>
                    {viewMode === 'grid' ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                            {villas.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(villa => (
                                <VillaCard
                                    key={villa.v_uuid}
                                    villa={villa}
                                    role={role}
                                    onEdit={() => setEditVilla(villa)}
                                    isSelected={selectedVillaIds.includes(villa.v_uuid)}
                                    onSelect={() => {
                                        setSelectedVillaIds(prev => 
                                            prev.includes(villa.v_uuid)
                                                ? prev.filter(id => id !== villa.v_uuid)
                                                : [...prev, villa.v_uuid]
                                        );
                                    }}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="glass-card p-2 border-border h-[650px] relative overflow-hidden">
                            <VillaMap 
                                locations={villas.map(v => ({
                                    gps: v.gps,
                                    name: v.villa_name,
                                    id: v.v_uuid,
                                    image: v.thumbnail
                                })).filter(l => l.gps)} 
                                radius={500} 
                                zoom={11} 
                            />
                            <div className="absolute top-6 left-6 z-[1000] px-3 py-1.5 bg-background/80 backdrop-blur-md border border-border rounded-lg shadow-2xl">
                                <p className="text-[10px] text-primary font-black uppercase tracking-widest">
                                    {villas.filter(v => v.gps).length} Properties Filtered
                                </p>
                            </div>
                        </div>
                    )}
                </>
            ) : null}

            {!loading && !error && totalCount > PAGE_SIZE && (
                <div className="flex items-center justify-center gap-3 pt-6">
                    <button
                        className="px-4 py-2 rounded-lg border border-border text-sm text-text-muted hover:text-primary hover:border-primary/30 transition-all disabled:opacity-40"
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                    >
                        ← Previous
                    </button>
                    <span className="text-xs text-text-muted">
                        Page {page + 1} of {Math.ceil(totalCount / PAGE_SIZE)}
                    </span>
                    <button
                        className="px-4 py-2 rounded-lg border border-border text-sm text-text-muted hover:text-primary hover:border-primary/30 transition-all disabled:opacity-40"
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

            {showBulkModal && (
                <BulkQuoteModal
                    selectedVillas={villas.filter(v => selectedVillaIds.includes(v.v_uuid))}
                    checkIn={checkIn}
                    checkOut={checkOut}
                    margins={margins}
                    onClose={() => setShowBulkModal(false)}
                    onCreated={() => {
                        setShowBulkModal(false);
                        setSelectedVillaIds([]);
                        alert('Mass quotes created successfully!');
                    }}
                />
            )}
        </div>
    );
}

function VillaCard({ villa, role, onEdit, isSelected, onSelect }) {
    return (
        <div className={`glass-card overflow-hidden group transition-all flex flex-col relative ${isSelected ? 'border-primary shadow-lg shadow-primary/10 scale-[1.01]' : 'hover:border-primary/30'}`}>
            {/* Selection Checkbox Overlay */}
            <div 
                onClick={(e) => { e.stopPropagation(); onSelect(); }}
                className={`absolute top-3 left-3 z-20 size-6 rounded-lg border-2 flex items-center justify-center cursor-pointer transition-all ${isSelected ? 'bg-primary border-primary text-black' : 'bg-black/20 border-white/50 hover:border-white text-transparent'}`}
            >
                <span className="material-symbols-outlined notranslate text-[18px] font-bold">check</span>
            </div>

            <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
                <img
                    src={villa.thumbnail || FALLBACK_IMG}
                    alt={villa.villa_name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    onError={e => { e.currentTarget.src = FALLBACK_IMG; }}
                    loading="lazy"
                />
                <div className="absolute bottom-3 left-3 bg-background/80 backdrop-blur-sm border border-border px-2.5 py-1 rounded-lg">
                    <span className="text-primary font-bold text-sm">
                        {villa.displayPrice > 0 ? `€${villa.displayPrice.toLocaleString()}` : 'POA'}
                    </span>
                    <span className="text-text-muted text-[10px] ml-1">
                        {villa.priceType === 'total' ? 'total' : '/wk'}
                    </span>
                </div>
                {villa.allow_shortstays === 'yes' && (
                    <div className="absolute top-3 right-3 bg-primary/90 text-background-dark text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                        Short Stay
                    </div>
                )}
            </div>

            <div className="p-4 flex-1 flex flex-col">
                <h3 className="font-semibold text-sm text-text-primary truncate mb-0.5">
                    {villa.villa_name || 'Unnamed Villa'}
                </h3>
                <div className="flex items-center gap-1 text-text-muted text-xs mb-3">
                    <span className="material-symbols-outlined notranslate text-[12px]">location_on</span>
                    <span>{villa.areaname || villa.district || 'Ibiza'}</span>
                </div>

                <div className="flex items-center justify-between text-xs text-text-muted mt-auto">
                    <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined notranslate text-[14px]">bed</span>
                        {villa.bedrooms || '—'}
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined notranslate text-[14px]">shower</span>
                        {villa.bathrooms || '—'}
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined notranslate text-[14px]">group</span>
                        {villa.sleeps || '—'}
                    </span>
                </div>

                <div className="mt-3 flex gap-2">
                    {(role === 'admin' || role === 'super_admin' || role === 'editor') ? (
                        <>
                            <button
                                onClick={onEdit}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:border-primary/40 hover:text-primary transition-all"
                            >
                                <span className="material-symbols-outlined notranslate text-[13px]">edit</span>
                                Edit
                            </button>
                            <button 
                                onClick={() => window.location.href = `/villas/${villa.v_uuid}`}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary/10 text-xs font-semibold text-primary hover:bg-primary/20 transition-all"
                            >
                                <span className="material-symbols-outlined notranslate text-[13px]">visibility</span>
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

function BulkQuoteModal({ selectedVillas, checkIn, checkOut, margins, onClose, onCreated }) {
    const { user } = useAuth();
    const [clients, setClients] = useState([]);
    const [selectedClientId, setSelectedClientId] = useState('');
    const [saving, setSaving] = useState(false);


    useEffect(() => {
        async function fetchClients() {
            const { data } = await supabase
                .from('clients')
                .select('id, full_name')
                .eq('agent_id', user?.id)
                .order('full_name');
            setClients(data || []);
        }
        fetchClients();
    }, [user]);

    async function handleMassQuotes() {
        if (!selectedClientId) return alert('Please select a client');
        if (!checkIn || !checkOut) return alert('Please select check-in and check-out dates');

        // Validation Check
        const start = new Date(checkIn);
        const end = new Date(checkOut);
        const diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24));
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const invalidVillas = selectedVillas.filter(villa => {
            const isStrictlySat = villa.allowed_checkin_days === 'Strictly Saturday-Saturday';
            if (isStrictlySat && (start.getUTCDay() !== 6 || end.getUTCDay() !== 6)) return true;
            
            const isLastMinute = (start - today) / (1000 * 60 * 60 * 24) <= 7;
            const isLongStay = diffDays >= 28;
            const bypassMinNights = isLongStay || (isLastMinute && diffDays >= 3);
            const minNights = villa.minimum_nights || 7;
            
            if (!bypassMinNights && diffDays < minNights) return true;
            return false;
        });

        if (invalidVillas.length > 0) {
            alert(`Impossibile procedere: ${invalidVillas.length} villa/e non rispettano le regole di prenotazione per queste date (es. Sabato-Sabato o minimo notti).`);
            return;
        }
        
        setSaving(true);
        try {
            const quoteInserts = selectedVillas.map(villa => {
                const adminMarkup = margins.invenioToAdmin;
                const supplierBase = villa.supplierPrice || (villa.displayPrice / (1 + adminMarkup/100)); // Fallback

                let subtotal = supplierBase * (1 + adminMarkup / 100); 
                
                const breakdown = [];
                breakdown.push({ label: 'Base Accommodation', amount: Math.round(subtotal), desc: 'Standard nightly rate + margin' });

                // Short stay logic for mass quotes
                const start = new Date(checkIn);
                const end = new Date(checkOut);
                const diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24));
                const isShortStay = diffDays <= 6;

                if (isShortStay && (villa.allow_shortstays === '1' || villa.allow_shortstays === 'yes' || villa.allow_shortstays === true)) {
                    let factor = 0;
                    if (diffDays === 3) factor = 0.50;
                    else if (diffDays === 4) factor = 0.25;
                    else if (diffDays === 5) factor = 0.20;
                    else if (diffDays === 6) factor = 0.10;

                    if (factor > 0) {
                        const premium = subtotal * factor;
                        breakdown.push({ label: `Short Stay Premium (${factor * 100}%)`, amount: Math.round(premium), desc: `Mandatory surcharge for ${diffDays}-night stay` });
                        breakdown.push({ label: `Short Stay Service Fee`, amount: 200, desc: 'Fixed processing fee' });
                        subtotal += premium + 200;
                    }
                }

                if (villa.cleaning_charge > 0) {
                    breakdown.push({ label: 'Cleaning Fee', amount: parseFloat(villa.cleaning_charge), desc: 'Mandatory one-time charge' });
                    subtotal += parseFloat(villa.cleaning_charge);
                }

                const ivaAmount = (subtotal - supplierBase) * (margins.ivaPercent / 100);
                breakdown.push({ label: `IVA (VAT) ${margins.ivaPercent}%`, amount: Math.round(ivaAmount), desc: 'IVA sui servizi di agenzia' });
                
                const finalPrice = Math.round(subtotal + ivaAmount);

                return {
                    v_uuid: villa.v_uuid,
                    client_id: selectedClientId,
                    check_in: checkIn,
                    check_out: checkOut,
                    supplier_base_price: supplierBase,
                    admin_markup: adminMarkup,
                    agent_markup: 0,
                    final_price: finalPrice,
                    status: 'draft',
                    agent_id: user?.id,
                    price_breakdown: breakdown
                };
            });

            const { error } = await supabase.from('quotes').insert(quoteInserts);
            if (error) throw error;
            onCreated();
        } catch (err) {
            alert('Error creating mass quotes: ' + err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="glass-card w-full max-w-lg p-8 space-y-8 animate-in zoom-in-95 duration-300">
                <div className="flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-bold text-text-primary">Create Mass Quote</h2>
                        <p className="text-xs text-text-muted uppercase tracking-widest font-bold mt-1">Providing {selectedVillas.length} Alternatives</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-surface-2 transition-colors">
                        <span className="material-symbols-outlined notranslate">close</span>
                    </button>
                </div>

                <div className="space-y-6">
                    <div className="space-y-1.5">
                        <label className="text-[10px] text-text-muted font-black uppercase tracking-widest">Select Client</label>
                        <select 
                            className="input-theme w-full py-3"
                            value={selectedClientId}
                            onChange={e => setSelectedClientId(e.target.value)}
                        >
                            <option value="">Choose a client...</option>
                            {clients.map(c => (
                                <option key={c.id} value={c.id}>{c.full_name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="p-4 bg-surface-2 rounded-xl space-y-3">
                        <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest border-b border-border pb-2">Selected Villas</p>
                        <div className="max-h-40 overflow-y-auto space-y-2 pr-2 scrollbar-thin">
                            {selectedVillas.map(v => (
                                <div key={v.v_uuid} className="flex justify-between items-center text-sm">
                                    <span className="text-text-primary font-medium truncate">{v.villa_name}</span>
                                    <span className="text-primary font-bold">€{v.displayPrice.toLocaleString()}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-surface-2 rounded-xl">
                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest">Check-in</p>
                            <p className="text-sm font-bold text-text-primary mt-1">{new Date(checkIn).toLocaleDateString()}</p>
                        </div>
                        <div className="p-4 bg-surface-2 rounded-xl">
                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest">Check-out</p>
                            <p className="text-sm font-bold text-text-primary mt-1">{new Date(checkOut).toLocaleDateString()}</p>
                        </div>
                    </div>
                </div>

                <div className="flex gap-4">
                    <button 
                        onClick={onClose}
                        className="flex-1 py-4 rounded-2xl border border-border text-text-muted font-bold hover:bg-surface-2 transition-all"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleMassQuotes}
                        disabled={saving || !selectedClientId}
                        className="flex-[2] btn-primary py-4 font-bold shadow-xl shadow-primary/20 disabled:opacity-40"
                    >
                        {saving ? 'Creating...' : `Finalize ${selectedVillas.length} Quotes`}
                    </button>
                </div>
            </div>
        </div>
    );
}
