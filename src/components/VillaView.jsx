import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { fetchICal, parseICal, getBlockedDates } from '../lib/calendar';

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80';

export default function VillaView() {
    const { id } = useParams(); // v_uuid
    const navigate = useNavigate();
    const { role, user } = useAuth();
    
    // Data states
    const [villa, setVilla] = useState(null);
    const [photos, setPhotos] = useState([]);
    const [seasonalRates, setSeasonalRates] = useState([]);
    const [blockedDates, setBlockedDates] = useState([]);
    const [clients, setClients] = useState([]);
    
    // UI states
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activePhotoIndex, setActivePhotoIndex] = useState(0);
    const [showPhotoModal, setShowPhotoModal] = useState(false);
    
    // Quote selection states
    const [selectionStart, setSelectionStart] = useState(null);
    const [selectionEnd, setSelectionEnd] = useState(null);
    const [showQuoteModal, setShowQuoteModal] = useState(false);
    const [selectedClientId, setSelectedClientId] = useState('');
    const [clientSearch, setClientSearch] = useState('');
    const [savingQuote, setSavingQuote] = useState(false);
    const [agentMarkup, setAgentMarkup] = useState(15);
    const [agentDetails, setAgentDetails] = useState(null);

    useEffect(() => {
        if (id) fetchVillaData();
    }, [id]);

    async function fetchVillaData() {
        setLoading(true);
        try {
            // 1. Fetch Villa Info
            const { data: villaData, error: villaErr } = await supabase
                .from('invenio_properties')
                .select('*')
                .eq('v_uuid', id)
                .single();
            if (villaErr) throw villaErr;
            setVilla(villaData);

            // 2. Fetch All Photos
            const { data: photoData } = await supabase
                .from('invenio_photos')
                .select('url, thumbnail_url, sort_order')
                .eq('v_uuid', id)
                .order('sort_order', { ascending: true });
            setPhotos(photoData || []);

            // 3. Fetch Seasonal Rates
            const { data: rateData } = await supabase
                .from('invenio_seasonal_prices')
                .select('*')
                .eq('v_uuid', id)
                .order('start_date', { ascending: true });
            setSeasonalRates(rateData || []);

            // 4. Fetch Clients for Quote creation (Only those belonging to this agent)
            const { data: clientData } = await supabase
                .from('clients')
                .select('id, full_name')
                .eq('agent_id', user?.id)
                .order('full_name');
            setClients(clientData || []);

            // 5. Fetch Agent's default markup and info
            if (user?.id) {
                const { data: agentProfile } = await supabase
                    .from('agents')
                    .select('markup_percent, company_name, logo_url')
                    .eq('id', user.id)
                    .single();
                if (agentProfile) {
                    setAgentMarkup(agentProfile.markup_percent || 15);
                    setAgentDetails(agentProfile);
                }
            }

            // 5. Fetch iCal Availability
            if (villaData.ical_url) {
                const icalData = await fetchICal(villaData.ical_url);
                if (icalData) {
                    const events = parseICal(icalData);
                    setBlockedDates(getBlockedDates(events));
                }
            }
        } catch (err) {
            console.error('Error:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    // --- Helper: Get Daily Price ---
    const getPriceForDate = (dateStr) => {
        const date = new Date(dateStr);
        const rate = seasonalRates.find(r => {
            const start = new Date(r.start_date);
            const end = new Date(r.end_date);
            return date >= start && date <= end;
        });

        // Seasonal rates from Invenio are NIGHTLY prices. 
        // fallback minimum_price from Invenio is a WEEKLY price.
        if (rate) {
            return Math.round(parseFloat(rate.amount));
        } else {
            const weeklyBase = parseFloat(villa?.minimum_price || 0);
            return Math.round(weeklyBase / 7);
        }
    };

    const getRuleForDate = (dateStr) => {
        const date = new Date(dateStr);
        const seasonalRule = seasonalRates.find(r => {
            const start = new Date(r.start_date);
            const end = new Date(r.end_date);
            return date >= start && date <= end;
        });

        return {
            minimum_nights: seasonalRule?.minimum_nights || villa.minimum_nights || 7,
            allowed_checkin_days: seasonalRule?.allowed_checkin_days || villa.allowed_checkin_days || 'Flexible check in days'
        };
    };

    const validateBooking = () => {
        if (!selectionStart || !selectionEnd) return { valid: true };

        const start = new Date(selectionStart);
        const end = new Date(selectionEnd);
        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        const rule = getRuleForDate(selectionStart);
        const errors = [];

        // 1. Min Nights
        if (diffDays < rule.minimum_nights) {
            errors.push(`Minimum stay is ${rule.minimum_nights} nights.`);
        }

        // 2. Changeover Days
        if (rule.allowed_checkin_days === 'Strictly Saturday-Saturday') {
            const checkInDay = start.getDay(); // 0 is Sunday, 6 is Saturday
            const checkOutDay = end.getDay();
            
            if (checkInDay !== 6) {
                errors.push("Check-in must be on a Saturday.");
            }
            if (checkOutDay !== 6) {
                errors.push("Check-out must be on a Saturday.");
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    };

    const bookingStatus = validateBooking();

    const [extraServices, setExtraServices] = useState([]);
    const [isManualPrice, setIsManualPrice] = useState(false);
    const [manualPrice, setManualPrice] = useState(0);

    const addService = () => setExtraServices([...extraServices, { name: '', price: 0 }]);
    const removeService = (idx) => setExtraServices(extraServices.filter((_, i) => i !== idx));
    const updateService = (idx, field, val) => {
        const newServices = [...extraServices];
        newServices[idx][field] = field === 'price' ? parseFloat(val) || 0 : val;
        setExtraServices(newServices);
    };

    const getBasePriceForSelection = () => {
        if (!selectionStart || !selectionEnd) return 0;
        const start = new Date(selectionStart);
        const end = new Date(selectionEnd);
        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        let totalBase = 0;
        for (let i = 0; i < diffDays; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            const dStr = d.toISOString().split('T')[0];
            totalBase += getPriceForDate(dStr);
        }

        // Add cleaning fee
        const cleaning = parseFloat(villa.cleaning_charge || 0);
        totalBase += cleaning;

        // Apply short stay logic
        const rule = getRuleForDate(selectionStart);
        let surchargeFactor = 0;
        if (rule.allowed_checkin_days !== 'Strictly Saturday-Saturday' && (villa.allow_shortstays === '1' || villa.allow_shortstays === 'yes')) {
            if (diffDays === 3) surchargeFactor = 0.50;
            else if (diffDays === 4) surchargeFactor = 0.25;
            else if (diffDays === 5) surchargeFactor = 0.20;
            else if (diffDays === 6) surchargeFactor = 0.10;
        }

        if (surchargeFactor > 0) {
            totalBase = totalBase * (1 + surchargeFactor) + 200;
        }

        return totalBase;
    };

    const calculateQuoteTotal = () => {
        if (!selectionStart || !selectionEnd || !bookingStatus.valid) return 0;
        if (isManualPrice) return manualPrice;

        const base = getBasePriceForSelection();
        
        // Fetch Admin margin from margin_settings if not already available
        // For simplicity here, we assume admin margin is already applied to base if we were fetching it elsewhere, 
        // but the table schema suggests we store supplier_base_price and admin_markup separately.
        // Let's assume global admin_markup is 15% if not found.
        const adminMarkup = 15; // In a production app, fetch from margin_settings
        
        const priceWithAdmin = base * (1 + adminMarkup / 100);
        const priceWithAgent = priceWithAdmin * (1 + agentMarkup / 100);
        
        const extraTotal = extraServices.reduce((sum, s) => sum + (s.price || 0), 0);
        
        return Math.round(priceWithAgent + extraTotal);
    };

    // --- Selection Logic ---
    const handleDateClick = (dateStr, isBlocked) => {
        if (isBlocked) return;
        
        if (!selectionStart || (selectionStart && selectionEnd)) {
            setSelectionStart(dateStr);
            setSelectionEnd(null);
        } else {
            const start = new Date(selectionStart);
            const end = new Date(dateStr);
            
            if (end < start) {
                setSelectionStart(dateStr);
                setSelectionEnd(null);
            } else {
                setSelectionEnd(dateStr);
            }
        }
    };


    const [createdQuoteId, setCreatedQuoteId] = useState(null);

    async function handleCreateQuote() {
        if (!selectedClientId || !selectionStart || !selectionEnd) return;
        setSavingQuote(true);
        try {
            const finalPrice = calculateQuoteTotal();
            const supplierBase = getBasePriceForSelection();
            const adminMarkup = 15; // Fallback or fetch from settings

            const { data, error: quoteErr } = await supabase.from('quotes').insert({
                v_uuid: villa.v_uuid,
                client_id: selectedClientId,
                check_in: selectionStart,
                check_out: selectionEnd,
                supplier_base_price: supplierBase,
                admin_markup: adminMarkup,
                agent_markup: agentMarkup,
                extra_services: extraServices,
                final_price: finalPrice,
                is_manual_price: isManualPrice,
                status: 'draft',
                agent_id: user?.id
            }).select('id').single();

            if (quoteErr) throw quoteErr;
            setCreatedQuoteId(data.id);
        } catch (err) {
            alert('Error creating quote: ' + err.message);
        } finally {
            setSavingQuote(false);
        }
    }

    // --- Render Logic ---
    if (loading) return (
        <div className="flex items-center justify-center min-h-[60vh]">
            <div className="animate-spin size-8 border-4 border-primary border-t-transparent rounded-full"></div>
        </div>
    );

    if (error || !villa) return (
        <div className="p-12 text-center text-slate-500">
            <h2 className="text-xl font-bold text-white mb-2">Error</h2>
            <p>{error || 'Villa not found'}</p>
        </div>
    );

    const mainPhoto = photos.length > 0 ? photos[activePhotoIndex].url : FALLBACK_IMG;

    return (
        <div className="max-w-[1400px] mx-auto p-4 md:p-8 space-y-8 pb-20">
            {/* Header & Gallery */}
            <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                    <button onClick={() => navigate('/villas')} className="hover:text-primary transition-colors">Villas</button>
                    <span className="material-symbols-outlined text-[10px]">chevron_right</span>
                    <span className="text-slate-300 font-medium">{villa.villa_name}</span>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[400px] md:h-[600px]">
                    <div className="lg:col-span-3 relative rounded-2xl overflow-hidden bg-surface-dark group cursor-pointer" onClick={() => setShowPhotoModal(true)}>
                        <img src={mainPhoto} className="w-full h-full object-cover" alt={villa.villa_name} />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-8">
                             <div>
                                <h1 className="text-3xl font-bold text-white">{villa.villa_name}</h1>
                                <p className="text-slate-200 mt-2 italic">"{villa.tagline || 'Experience luxury in Ibiza'}"</p>
                             </div>
                        </div>
                        {photos.length > 0 && (
                            <div className="absolute bottom-6 right-6 bg-black/60 backdrop-blur-sm border border-white/10 px-4 py-2 rounded-xl text-white text-xs font-bold flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">photo_library</span>
                                {photos.length} Photos
                            </div>
                        )}
                    </div>
                    <div className="hidden lg:flex flex-col gap-4">
                        {photos.slice(1, 5).map((ph, idx) => (
                            <div key={idx} className="flex-1 rounded-2xl overflow-hidden bg-surface-dark relative border border-border-dark cursor-pointer group" onClick={() => { setActivePhotoIndex(idx + 1); setShowPhotoModal(true); }}>
                                <img src={ph.url} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="" />
                                {idx === 3 && photos.length > 5 && (
                                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                        <span className="text-white font-bold text-lg">+{photos.length - 5}</span>
                                    </div>
                                )}
                            </div>
                        ))}
                        {photos.length <= 1 && (
                            <div className="flex-1 rounded-2xl border border-dashed border-border-dark flex items-center justify-center text-slate-600">
                                <span className="material-symbols-outlined text-4xl">add_photo_alternate</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Photo Lightbox Modal */}
            {showPhotoModal && (
                <div className="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-xl animate-in fade-in duration-300">
                    <div className="p-4 md:p-8 flex justify-between items-center">
                        <span className="text-white/60 font-bold text-xs uppercase tracking-widest">{villa.villa_name} Gallery — {activePhotoIndex + 1} / {photos.length}</span>
                        <button onClick={() => setShowPhotoModal(false)} className="size-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-all">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>
                    <div className="flex-1 relative flex items-center justify-center p-4">
                        <button 
                            className="absolute left-4 md:left-8 size-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 disabled:opacity-20"
                            disabled={activePhotoIndex === 0}
                            onClick={() => setActivePhotoIndex(p => p - 1)}
                        >
                            <span className="material-symbols-outlined text-3xl">chevron_left</span>
                        </button>
                        
                        <img 
                            src={photos[activePhotoIndex]?.url} 
                            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl animate-in fade-in zoom-in duration-500" 
                            alt="" 
                        />

                        <button 
                            className="absolute right-4 md:right-8 size-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-white/10 disabled:opacity-20"
                            disabled={activePhotoIndex === photos.length - 1}
                            onClick={() => setActivePhotoIndex(p => p + 1)}
                        >
                            <span className="material-symbols-outlined text-3xl">chevron_right</span>
                        </button>
                    </div>
                    <div className="p-4 md:p-8 flex gap-2 overflow-x-auto pb-6 scrollbar-hide">
                        {photos.map((ph, idx) => (
                            <div 
                                key={idx} 
                                className={`size-20 flex-shrink-0 rounded-xl overflow-hidden cursor-pointer transition-all ${activePhotoIndex === idx ? 'ring-2 ring-primary ring-offset-4 ring-offset-black scale-110' : 'opacity-40 hover:opacity-100'}`}
                                onClick={() => setActivePhotoIndex(idx)}
                            >
                                <img src={ph.thumbnail_url || ph.url} className="w-full h-full object-cover" alt="" />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
                
                {/* LEFT: Info & Availability */}
                <div className="xl:col-span-2 space-y-8">
                    {/* Overview Chips */}
                    <div className="flex flex-wrap gap-4 py-2">
                        <div className="glass-card flex items-center gap-3 px-5 py-3 border-primary/20 bg-primary/2">
                            <span className="material-symbols-outlined text-primary">bed</span>
                            <div><p className="text-xs text-slate-500 leading-tight">Bedrooms</p><p className="font-bold text-white">{villa.bedrooms}</p></div>
                        </div>
                        <div className="glass-card flex items-center gap-3 px-5 py-3 border-primary/20 bg-primary/2">
                            <span className="material-symbols-outlined text-primary">shower</span>
                            <div><p className="text-xs text-slate-500 leading-tight">Bathrooms</p><p className="font-bold text-white">{villa.bathrooms}</p></div>
                        </div>
                        <div className="glass-card flex items-center gap-3 px-5 py-3 border-primary/20 bg-primary/2">
                            <span className="material-symbols-outlined text-primary">groups</span>
                            <div><p className="text-xs text-slate-500 leading-tight">Sleeps</p><p className="font-bold text-white">{villa.sleeps}</p></div>
                        </div>
                    </div>

                    {/* Description */}
                    <div className="glass-card p-6 md:p-8">
                        <h2 className="text-xl font-bold text-white mb-4">About this Villa</h2>
                        <div className="text-slate-400 text-sm leading-relaxed space-y-4 whitespace-pre-line">
                            {villa.description || 'No description available for this property.'}
                        </div>
                    </div>

                    {/* Calendar / Availability */}
                    <div className="glass-card p-6 md:p-8">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <span className="material-symbols-outlined text-primary text-[24px]">calendar_today</span>
                                    Availability & Prices
                                </h2>
                                <p className="text-xs text-slate-500 mt-1">Select dates to calculate a quote</p>
                            </div>
                            <div className="flex gap-4">
                                <div className="flex items-center gap-2"><div className="size-3 rounded-full bg-red-500/80"></div><span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Booked</span></div>
                                <div className="flex items-center gap-2"><div className="size-3 rounded-full bg-surface-dark border border-border-dark"></div><span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Available</span></div>
                            </div>
                        </div>

                        <div className="space-y-12">
                            {[0, 1, 2, 3, 4, 5, 6].map(offset => {
                                const today = new Date();
                                const monthDate = new Date(today.getFullYear(), today.getMonth() + offset, 1);
                                if (monthDate.getFullYear() > 2026) return null; // Limit as requested

                                const monthName = monthDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
                                const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
                                const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getDay();
                                
                                return (
                                    <div key={monthName}>
                                        <h3 className="text-sm font-bold text-slate-300 mb-4 capitalize tracking-wide">{monthName}</h3>
                                        <div className="grid grid-cols-7 gap-1 md:gap-2">
                                            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => (
                                                <div key={d} className="text-center text-[10px] text-slate-600 font-bold mb-1">{d}</div>
                                            ))}
                                            {[...Array(firstDay)].map((_, i) => <div key={i} />)}
                                            {[...Array(daysInMonth)].map((_, i) => {
                                                const d = i + 1;
                                                const dStr = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                                                const isBlocked = blockedDates.includes(dStr);
                                                const price = getPriceForDate(dStr);
                                                
                                                const isSelected = dStr === selectionStart || dStr === selectionEnd || 
                                                    (selectionStart && selectionEnd && new Date(dStr) >= new Date(selectionStart) && new Date(dStr) <= new Date(selectionEnd));

                                                return (
                                                    <div
                                                        key={d}
                                                        onClick={() => handleDateClick(dStr, isBlocked)}
                                                        className={`
                                                            relative aspect-square flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer group
                                                            ${isBlocked ? 'bg-red-500/10 border-red-500/20 grayscale opacity-60 cursor-not-allowed' : 'bg-surface-dark border border-border-dark hover:border-primary/50'}
                                                            ${isSelected ? 'bg-primary border-primary ring-2 ring-primary/20 ring-offset-2 ring-offset-background-dark scale-105 z-10' : ''}
                                                        `}
                                                    >
                                                        <span className={`text-[11px] font-bold ${isSelected ? 'text-background-dark' : 'text-slate-400'}`}>{d}</span>
                                                        <span className={`text-[8px] font-medium mt-0.5 ${isSelected ? 'text-background-dark/80' : 'text-slate-600'}`}>€{price}</span>
                                                        {isBlocked && (
                                                            <div className="absolute inset-0 flex items-center justify-center">
                                                                <div className="w-[80%] h-[1px] bg-red-500/30 rotate-45"></div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Villa Rules Section */}
                    <div className="glass-card p-6 md:p-8">
                        <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                            <span className="material-symbols-outlined text-primary text-[24px]">gavel</span>
                            Villa Rules & Information
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-4">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">General Rules</h3>
                                <div className="text-sm text-slate-300 whitespace-pre-line leading-relaxed">
                                    {villa.house_rules || 'Standard luxury rental rules apply. No parties, no loud music after 11 PM, and treat the property with respect.'}
                                </div>
                            </div>
                            <div className="bg-background-dark/40 rounded-2xl p-6 border border-border-dark space-y-4">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Stay Policy</h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Allow Short Stays</span>
                                        <span className="text-slate-200 font-bold capitalize">{villa.allow_shortstays || 'no'}</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Security Deposit</span>
                                        <span className="text-slate-200 font-bold">€{parseFloat(villa.deposit || villa.security_deposit || 0).toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Cleaning Charge</span>
                                        <span className="text-slate-200 font-bold">€{parseFloat(villa.cleaning_charge || 0).toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Smoking Allowed</span>
                                        <span className="text-slate-200 font-bold">No</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Pets Allowed</span>
                                        <span className="text-slate-200 font-bold">Check with owner</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* RIGHT: Booking Sidebar */}
                <div className="space-y-6 lg:sticky lg:top-8">
                    {/* Price & Summary Card */}
                    <div className="glass-card p-6 border-primary/30 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
                        
                        <div className="relative">
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Weekly From</p>
                            <div className="flex items-baseline gap-2 mb-6">
                                <span className="text-4xl font-extrabold text-white">€{parseFloat(villa.minimum_price || 0).toLocaleString()}</span>
                                <span className="text-slate-500 text-sm">/ week</span>
                            </div>

                            <div className="space-y-3 mb-8">
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-400">Security Deposit</span>
                                    <span className="text-slate-200 font-bold">€{parseFloat(villa.deposit || 0).toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-400">Minimum Stay</span>
                                    <span className="text-slate-200 font-bold">7 nights</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-400">Location</span>
                                    <span className="text-slate-200 font-bold">{villa.district || villa.areaname || 'Ibiza'}</span>
                                </div>
                            </div>

                            {selectionStart && (
                                <div className={`border rounded-xl p-4 mb-6 ${bookingStatus.valid ? 'bg-primary/10 border-primary/20' : 'bg-red-500/10 border-red-500/20'}`}>
                                    <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${bookingStatus.valid ? 'text-primary' : 'text-red-400'}`}>
                                        {bookingStatus.valid ? 'Selected Period' : 'Booking Rule Violation'}
                                    </p>
                                    <div className="flex items-center justify-between font-bold text-white text-sm">
                                        <span>{new Date(selectionStart).toLocaleDateString()}</span>
                                        {selectionEnd && (
                                            <>
                                                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                                                <span>{new Date(selectionEnd).toLocaleDateString()}</span>
                                            </>
                                        )}
                                    </div>
                                    {!bookingStatus.valid && selectionEnd && (
                                        <div className="mt-4 p-4 rounded-xl bg-red-500/20 border border-red-500/30 space-y-2 animate-in shake duration-500">
                                            <p className="text-xs font-black text-red-400 uppercase tracking-widest flex items-center gap-2">
                                                <span className="material-symbols-outlined text-sm">warning</span>
                                                Invalid Selection
                                            </p>
                                            {bookingStatus.errors.map((err, idx) => (
                                                <p key={idx} className="text-sm text-red-200 font-medium leading-tight">
                                                    • {err}
                                                </p>
                                            ))}
                                        </div>
                                    )}
                                    {selectionEnd && bookingStatus.valid && (
                                        <div className="mt-4 pt-4 border-t border-primary/20 flex justify-between items-baseline animate-in fade-in slide-in-from-bottom-2">
                                            <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Estimated Total</span>
                                            <span className="text-2xl font-black text-primary">€{calculateQuoteTotal().toLocaleString()}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {selectionStart && selectionEnd && bookingStatus.valid ? (
                                <button 
                                    onClick={() => setShowQuoteModal(true)}
                                    className="btn-primary w-full py-4 text-sm font-bold shadow-lg shadow-primary/20"
                                >
                                    Generate Quote
                                </button>
                            ) : selectionStart && selectionEnd ? (
                                <div className="text-center p-4 rounded-xl border border-red-500/20 bg-red-500/5">
                                    <p className="text-[10px] text-red-500/70 font-bold uppercase tracking-widest">Selected dates violate villa rules</p>
                                </div>
                            ) : (
                                <div className="text-center p-4 rounded-xl border border-dashed border-border-dark">
                                    <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">Select dates on calendar</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Features Card */}
                    <div className="glass-card p-6">
                        <h3 className="text-sm font-bold text-white mb-4">Highlights</h3>
                        <div className="grid grid-cols-1 gap-3">
                            {(Array.isArray(villa.features) ? villa.features : []).map(f => (
                                <div key={f} className="flex items-center gap-3 text-xs text-slate-400">
                                    <span className="material-symbols-outlined text-primary/60 text-[18px]">check_circle</span>
                                    {f}
                                </div>
                            ))}
                            {(!villa.features || villa.features.length === 0) && (
                                <p className="text-xs text-slate-500 italic">No specific features listed</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Quote Modal */}
            {showQuoteModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
                    <div className="bg-surface-dark border border-border-dark rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="p-8 border-b border-border-dark">
                            <div className="flex justify-between items-start mb-2">
                                <h2 className="text-2xl font-bold text-white">New Quote</h2>
                                <button onClick={() => setShowQuoteModal(false)} className="text-slate-500 hover:text-white transition-colors">
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>
                            <p className="text-slate-500 text-xs">Confirm dates and select a client for <span className="text-primary font-bold">{villa.villa_name}</span></p>
                        </div>

                        <div className="p-6 md:p-8 space-y-6 max-h-[70vh] overflow-y-auto">
                            {createdQuoteId ? (
                                <div className="text-center space-y-6 py-4 animate-in fade-in zoom-in">
                                    <div className="size-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto border border-green-500/20">
                                        <span className="material-symbols-outlined text-green-500 text-4xl">check_circle</span>
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold text-white mb-2">Quote Created!</h3>
                                        <p className="text-slate-400 text-sm">The proposal is ready. You can now share this private link with your client.</p>
                                    </div>
                                    
                                    <div className="bg-background-dark/50 p-4 rounded-2xl border border-border-dark flex items-center gap-3">
                                        <input 
                                            readOnly 
                                            value={`${window.location.origin}/quote/${createdQuoteId}`}
                                            className="bg-transparent text-xs text-primary font-medium flex-1 outline-none"
                                        />
                                        <button 
                                            onClick={() => {
                                                navigator.clipboard.writeText(`${window.location.origin}/quote/${createdQuoteId}`);
                                                alert('Link copied!');
                                            }}
                                            className="btn-primary px-4 py-2 text-[10px] uppercase font-bold"
                                        >
                                            Copy
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {/* Selected Info Summary */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-background-dark/50 p-4 rounded-2xl border border-border-dark">
                                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Check-in</p>
                                            <p className="text-sm font-bold text-white">{new Date(selectionStart).toLocaleDateString('en-GB')}</p>
                                        </div>
                                        <div className="bg-background-dark/50 p-4 rounded-2xl border border-border-dark">
                                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Check-out</p>
                                            <p className="text-sm font-bold text-white">{new Date(selectionEnd).toLocaleDateString('en-GB')}</p>
                                        </div>
                                    </div>
                                    
                                    <div className="flex justify-between items-center p-4 rounded-2xl bg-primary/5 border border-primary/20">
                                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Price</span>
                                        <div className="text-right">
                                            <span className="text-2xl font-black text-primary block">€{calculateQuoteTotal().toLocaleString()}</span>
                                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter italic">Includes your {agentMarkup}% margin</span>
                                        </div>
                                    </div>

                                    {/* Markup Override */}
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center">
                                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Custom Margin (%)</label>
                                            <div className="relative w-24">
                                                <input 
                                                    type="number"
                                                    value={agentMarkup}
                                                    onChange={e => setAgentMarkup(e.target.value)}
                                                    className="w-full bg-background-dark border border-white/10 rounded-xl px-3 py-2 text-right text-primary font-bold outline-none focus:border-primary/40"
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-primary/30 font-bold pointer-events-none">%</span>
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-slate-600 font-medium italic leading-tight">You can override your default brand margin for this specific quote only.</p>
                                    </div>

                                    {/* Extra Services */}
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Extra Services</label>
                                            <button 
                                                onClick={addService}
                                                className="text-[10px] font-bold text-primary uppercase hover:underline flex items-center gap-1"
                                            >
                                                <span className="material-symbols-outlined text-sm">add</span> Add Service
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {extraServices.map((s, idx) => (
                                                <div key={idx} className="flex gap-2 items-center bg-background-dark/50 p-2 rounded-xl border border-border-dark animate-in slide-in-from-right-2">
                                                    <input 
                                                        placeholder="Service name"
                                                        className="flex-1 bg-transparent border-none text-[11px] text-slate-200 outline-none"
                                                        value={s.name}
                                                        onChange={e => updateService(idx, 'name', e.target.value)}
                                                    />
                                                    <div className="relative w-20">
                                                        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] text-slate-600">€</span>
                                                        <input 
                                                            type="number"
                                                            placeholder="0"
                                                            className="w-full bg-transparent border-none text-[11px] text-right text-primary font-bold outline-none"
                                                            value={s.price}
                                                            onChange={e => updateService(idx, 'price', e.target.value)}
                                                        />
                                                    </div>
                                                    <button onClick={() => removeService(idx)} className="text-slate-600 hover:text-red-400 p-1">
                                                        <span className="material-symbols-outlined text-sm">delete</span>
                                                    </button>
                                                </div>
                                            ))}
                                            {extraServices.length === 0 && <p className="text-[10px] text-slate-600 italic">No extra services added.</p>}
                                        </div>
                                    </div>

                                    {/* Manual Price Override */}
                                    <div className="space-y-3 pt-2 border-t border-border-dark">
                                        <div className="flex justify-between items-center">
                                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Manual Price Override</label>
                                            <label className="flex items-center gap-2 cursor-pointer group">
                                                <input 
                                                    type="checkbox" 
                                                    checked={isManualPrice}
                                                    onChange={e => setIsManualPrice(e.target.checked)}
                                                    className="accent-primary"
                                                />
                                            </label>
                                        </div>
                                        {isManualPrice && (
                                            <div className="relative animate-in zoom-in-95 duration-200">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-primary/30">€</span>
                                                <input 
                                                    type="number"
                                                    value={manualPrice}
                                                    onChange={e => setManualPrice(parseFloat(e.target.value) || 0)}
                                                    className="w-full bg-primary/5 border border-primary/40 rounded-xl py-2 px-8 text-lg font-black text-primary outline-none"
                                                />
                                            </div>
                                        )}
                                        <p className="text-[10px] text-slate-600 font-medium italic leading-tight">
                                            {isManualPrice ? 'Warning: Automatic calculations are suspended.' : 'Using automatic calculation based on selection and margin.'}
                                        </p>
                                    </div>

                                    {/* Client Search/Select */}
                                    <div>
                                        <label className="block text-xs text-slate-500 font-bold uppercase tracking-widest mb-3">Select Client</label>
                                        <div className="space-y-3">
                                            <div className="relative">
                                                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[18px]">search</span>
                                                <input 
                                                    className="input-dark w-full pl-10" 
                                                    placeholder="Search client name..." 
                                                    value={clientSearch}
                                                    onChange={e => setClientSearch(e.target.value)}
                                                />
                                            </div>
                                            <select 
                                                className="input-dark w-full py-3"
                                                size={5}
                                                value={selectedClientId}
                                                onChange={e => setSelectedClientId(e.target.value)}
                                            >
                                                <option value="" disabled>Choose a client...</option>
                                                {clients
                                                    .filter(c => !clientSearch || c.full_name?.toLowerCase().includes(clientSearch.toLowerCase()))
                                                    .map(c => (
                                                    <option key={c.id} value={c.id} className="p-2 border-b border-white/5 last:border-0">{c.full_name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="p-6 md:p-8 bg-background-dark/30 border-t border-border-dark flex flex-col md:flex-row gap-4">
                            {createdQuoteId ? (
                                <button 
                                    onClick={() => { setShowQuoteModal(false); setCreatedQuoteId(null); navigate('/quotes'); }}
                                    className="flex-1 btn-primary py-4 font-bold shadow-lg shadow-primary/20"
                                >
                                    Close & View All Quotes
                                </button>
                            ) : (
                                <>
                                    <button 
                                        onClick={() => setShowQuoteModal(false)}
                                        className="flex-1 py-4 rounded-2xl border border-border-dark text-slate-400 font-bold hover:bg-white/5 transition-all"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        onClick={handleCreateQuote}
                                        disabled={!selectedClientId || savingQuote}
                                        className="flex-[2] btn-primary py-4 font-bold shadow-lg shadow-primary/20 disabled:opacity-40"
                                    >
                                        {savingQuote ? 'Creating...' : 'Create & Save Quote'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
