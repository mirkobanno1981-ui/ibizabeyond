import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { fetchICal, parseICal, getBlockedDates } from '../lib/calendar';

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1567899534071-723d01397ad0?auto=format&fit=crop&w=1200&q=80';

export default function BoatView() {
    const { id } = useParams(); // v_uuid
    const navigate = useNavigate();
    const { role, user } = useAuth();
    
    // Data states
    const [boat, setBoat] = useState(null);
    const [photos, setPhotos] = useState([]);
    const [seasonalRates, setSeasonalRates] = useState([]);
    const [blockedDates, setBlockedDates] = useState([]);
    const [clients, setClients] = useState([]);
    
    // UI states
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activePhotoIndex, setActivePhotoIndex] = useState(0);
    const [showPhotoModal, setShowPhotoModal] = useState(false);

    // Keyboard navigation for gallery
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!showPhotoModal) return;
            if (e.key === 'ArrowLeft') setActivePhotoIndex(p => Math.max(0, p - 1));
            if (e.key === 'ArrowRight') setActivePhotoIndex(p => Math.min(photos.length - 1, p + 1));
            if (e.key === 'Escape') setShowPhotoModal(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showPhotoModal, photos.length]);
    
    // Quote selection states
    const [selectionStart, setSelectionStart] = useState(null);
    const [selectionEnd, setSelectionEnd] = useState(null);
    const [showQuoteModal, setShowQuoteModal] = useState(false);
    const [selectedClientId, setSelectedClientId] = useState('');
    const [clientSearch, setClientSearch] = useState('');
    const [savingQuote, setSavingQuote] = useState(false);
    const [agentDetails, setAgentDetails] = useState(null);
    const [globalMargins, setGlobalMargins] = useState({ invenioToAdmin: 15, ivaPercent: 21 });
    const [useStripeFee, setUseStripeFee] = useState(false);
    
    // Quick Client Create
    const [showNewClientForm, setShowNewClientForm] = useState(false);
    const [newClient, setNewClient] = useState({ full_name: '', email: '', phone_number: '' });
    const [creatingClient, setCreatingClient] = useState(false);

    // Quote management states
    const [extraServices, setExtraServices] = useState([]);
    const [isManualPrice, setIsManualPrice] = useState(false);
    const [manualPrice, setManualPrice] = useState(0);
    const [createdQuoteId, setCreatedQuoteId] = useState(null);

    // Group Qualification states
    const [groupType, setGroupType] = useState('family'); // 'family' or 'friends'
    const [numChildren, setNumChildren] = useState(0);
    const [friendsComposition, setFriendsComposition] = useState(''); // 'males', 'females', 'mixed'
    const [isCouples, setIsCouples] = useState(false);
    const [hasPets, setHasPets] = useState(false);

    // --- Helpers: Pricing & Rules ---
    const getIsSat = (ds) => {
        if (!ds) return false;
        const [y, m, d] = ds.split('-').map(Number);
        return new Date(y, m - 1, d).getDay() === 6;
    };

    const getPriceForDate = (dateStr, withMarkup = false) => {
        const date = new Date(dateStr);
        const rate = seasonalRates.find(r => {
            const start = new Date(r.start_date);
            const end = new Date(r.end_date);
            return date >= start && date <= end;
        });
        
        let amount = 0;
        if (rate) amount = parseFloat(rate.amount);
        else amount = parseFloat(boat?.daily_price || 0);

        if (withMarkup) {
            const adminMarkup = (role !== 'admin' && agentDetails?.admin_margin > 0) 
                ? agentDetails.admin_margin 
                : globalMargins.invenioToAdmin;
            return Math.round(amount * (1 + adminMarkup / 100));
        }

        return Math.round(amount);
    };

    const getRuleForDate = (dateStr) => {
        const date = new Date(dateStr);
        const seasonalRule = seasonalRates.find(r => {
            const start = new Date(r.start_date);
            const end = new Date(r.end_date);
            return date >= start && date <= end;
        });
        return {
            minimum_nights: seasonalRule?.minimum_nights || 1,
            allowed_checkin_days: seasonalRule?.allowed_checkin_days || 'Flexible check in days'
        };
    };

    const validateBooking = () => {
        if (!selectionStart || !selectionEnd) return { valid: true, errors: [] };
        
        const start = new Date(selectionStart);
        const end = new Date(selectionEnd);
        let diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24));
        // For boats, same day selection = 1 day charter
        if (diffDays === 0) diffDays = 1;
        
        const rule = getRuleForDate(selectionStart);
        const errors = [];
        
        if (rule.allowed_checkin_days === 'Strictly Saturday-Saturday') {
            if (!getIsSat(selectionStart) || (!getIsSat(selectionEnd) && diffDays > 1)) {
                errors.push("This boat requires Saturday check-in for weekly charters.");
            }
        }
        
        if (diffDays < rule.minimum_nights) {
            errors.push(`The minimum charter duration is ${rule.minimum_nights} day(s).`);
        }
        
        return { valid: errors.length === 0, errors, diffDays };
    };

    const getBasePriceForSelection = () => {
        if (!selectionStart || !selectionEnd) return { total: 0, items: [] };
        
        const start = new Date(selectionStart);
        const end = new Date(selectionEnd);
        let diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) diffDays = 1;
        
        const items = [];
        let subtotal = 0;
        
        for (let i = 0; i < diffDays; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            const dStr = d.toISOString().split('T')[0];
            const price = getPriceForDate(dStr);
            subtotal += price;
        }

        items.push({ 
            label: `Base Charter (${diffDays} day${diffDays > 1 ? 's' : ''})`, 
            amount: subtotal,
            desc: `Charter from ${new Date(selectionStart).toLocaleDateString()} to ${new Date(selectionEnd).toLocaleDateString()}`
        });

        return { total: subtotal, items };
    };

    const getQuoteBreakdown = () => {
        if (!selectionStart || !selectionEnd) return { total: 0, profit: 0, items: [] };
        
        const { total: baseTotal, items: baseItems } = getBasePriceForSelection();
        const breakdownItems = [...baseItems];
        
        const adminMarkup = (role !== 'admin' && agentDetails?.admin_margin > 0) 
            ? agentDetails.admin_margin 
            : globalMargins.invenioToAdmin;
            
        const totalWithMarkup = baseTotal * (1 + adminMarkup / 100);
        
        let subtotal;
        let finalPrice;
        let agentProfit;

        if (isManualPrice) {
            subtotal = manualPrice;
            agentProfit = manualPrice - baseTotal;
            breakdownItems.push({
                label: 'Manual Rate Adjustment',
                amount: manualPrice - baseTotal,
                desc: 'Price adjusted manually by agent'
            });
        } else {
            subtotal = totalWithMarkup;
        }

        const extraTotal = extraServices.reduce((sum, s) => {
            if (s.price > 0) {
                breakdownItems.push({
                    label: s.name || 'Extra Service',
                    amount: s.price,
                    desc: 'Additional service requested'
                });
            }
            return sum + (parseFloat(s.price) || 0);
        }, 0);

        subtotal += extraTotal;
        const stripeFee = useStripeFee ? subtotal * 0.015 : 0;
        
        if (stripeFee > 0) {
            breakdownItems.push({
                label: 'Stripe Processing Fee (1.5%)',
                amount: stripeFee,
                desc: 'Secure payment gateway processing'
            });
        }

        const agencyServicesTotal = (subtotal - baseTotal) + stripeFee;
        const ivaAmount = agencyServicesTotal * (globalMargins.ivaPercent / 100);
        
        breakdownItems.push({
            label: `IVA (VAT) ${globalMargins.ivaPercent}%`,
            amount: ivaAmount,
            desc: 'Applied exclusively to agency services'
        });

        // For boats, base price is often not including 21% VAT, but we wait for final specifications.
        // If it includes VAT, we're adding IVA on the margin.

        finalPrice = Math.round(subtotal + stripeFee + ivaAmount);
        agentProfit = Math.round(subtotal - baseTotal);
        
        return { 
            base: baseTotal, 
            priceWithAdmin: totalWithMarkup, 
            total: finalPrice, 
            profit: agentProfit,
            items: breakdownItems.map(item => ({ ...item, amount: Math.round(item.amount) }))
        };
    };

    const calculateQuoteTotal = () => getQuoteBreakdown().total;
    const bookingStatus = validateBooking();

    useEffect(() => {
        if (id) fetchBoatData();
    }, [id]);

    async function fetchBoatData() {
        setLoading(true);
        try {
            // 1. Fetch Boat Info
            const { data: boatData, error: boatErr } = await supabase
                .from('invenio_boats')
                .select('*')
                .eq('v_uuid', id)
                .single();
            if (boatErr) throw boatErr;
            setBoat(boatData);

            // 2. Fetch All Photos
            const { data: photoData } = await supabase
                .from('invenio_photos')
                .select('url, thumbnail_url, sort_order')
                .eq('boat_uuid', id)
                .order('sort_order', { ascending: true });
            
            // Allow comma separated photo_urls if invenio_photos is empty
            let finalPhotos = photoData || [];
            if (finalPhotos.length === 0 && boatData.photo_urls) {
                const urls = boatData.photo_urls.split(',').map(u => u.trim()).filter(u => u.length > 5);
                finalPhotos = urls.map((u, i) => ({ url: u, thumbnail_url: u, sort_order: i }));
            }
            
            setPhotos(finalPhotos);

            // 3. Fetch Seasonal Rates
            const { data: rateData } = await supabase
                .from('invenio_seasonal_prices')
                .select('*')
                .eq('v_uuid', id)
                .order('start_date', { ascending: true });
            setSeasonalRates(rateData || []);

            // 4. Fetch Clients for Quote creation
            let clientQuery = supabase.from('clients').select('id, full_name').order('full_name');
            if (role !== 'admin') {
                clientQuery = clientQuery.eq('agent_id', user?.id);
            }
            const { data: clientData } = await clientQuery;
            setClients(clientData || []);

            // 5. Fetch Agent's info/override
            if (user?.id) {
                const { data: agentProfile } = await supabase
                    .from('agents')
                    .select('admin_margin, company_name, logo_url')
                    .eq('id', user.id)
                    .maybeSingle();
                if (agentProfile) {
                    setAgentDetails(agentProfile);
                }
            }

            // 6. Fetch Global Margins
            const { data: marginData } = await supabase
                .from('margin_settings')
                .select('*')
                .eq('id', 1)
                .single();
            if (marginData) {
                setGlobalMargins({
                    invenioToAdmin: marginData.invenio_to_admin_margin || 15,
                    ivaPercent: marginData.iva_percent || 21 // Default boats VAT
                });
            }

            // 7. Fetch iCal Availability (if boats use it)
            if (boatData.ical_url) {
                const icalData = await fetchICal(boatData.ical_url);
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


    async function handleQuickCreateClient() {
        if (!newClient.full_name) return alert('Name is required');
        setCreatingClient(true);
        try {
            const { data, error } = await supabase.from('clients').insert({
                ...newClient,
                agent_id: user?.id
            }).select().single();
            
            if (error) throw error;
            
            setClients(prev => [data, ...prev]);
            setSelectedClientId(data.id);
            setShowNewClientForm(false);
            setNewClient({ full_name: '', email: '', phone_number: '' });
        } catch (err) {
            alert('Error creating client: ' + err.message);
        } finally {
            setCreatingClient(false);
        }
    }

    const resetQuoteModal = () => {
        setShowQuoteModal(false);
        setCreatedQuoteId(null);
        setIsManualPrice(false);
        setManualPrice(0);
        setExtraServices([]);
        setSelectedClientId('');
        setClientSearch('');
        // Reset qualification
        setGroupType('family');
        setNumChildren(0);
        setFriendsComposition('');
        setIsCouples(false);
        setHasPets(false);
    };

    const handleDateClick = (dStr, isBlocked) => {
        if (isBlocked) return;
        
        const rule = getRuleForDate(dStr);
        const isStrictlySat = rule.allowed_checkin_days === 'Strictly Saturday-Saturday';

        if (!selectionStart || (selectionStart && selectionEnd)) {
            // Start new selection
            if (isStrictlySat && !getIsSat(dStr)) {
                alert("ATTENTION: This boat strictly requires Saturday charter start.");
                return;
            }
            setSelectionStart(dStr);
            setSelectionEnd(dStr); // For boats, 1 day charter is default
        } else {
            // Complete selection for multi-day charters
            const start = new Date(selectionStart);
            const end = new Date(dStr);
            
            if (end < start) {
                if (isStrictlySat && !getIsSat(dStr)) {
                    alert("This boat requires Saturday charter start.");
                    return;
                }
                setSelectionStart(dStr);
                setSelectionEnd(dStr);
            } else {
                let hasBlocked = false;
                let current = new Date(start);
                while (current <= end) {
                    const checkStr = current.toISOString().split('T')[0];
                    if (blockedDates.includes(checkStr)) {
                        hasBlocked = true;
                        break;
                    }
                    current.setDate(current.getDate() + 1);
                }

                if (hasBlocked) {
                    setSelectionStart(dStr);
                    setSelectionEnd(dStr);
                } else {
                    setSelectionEnd(dStr);
                    
                    const startObj = new Date(selectionStart);
                    const endObj = new Date(dStr);
                    let diffDays = Math.ceil(Math.abs(endObj - startObj) / (1000 * 60 * 60 * 24));
                    if(diffDays === 0) diffDays = 1;
                    const ruleObj = getRuleForDate(selectionStart);
                    
                    let isAutoValid = true;
                    if (ruleObj.allowed_checkin_days === 'Strictly Saturday-Saturday') {
                        if (!getIsSat(selectionStart)) isAutoValid = false;
                    }
                    if (diffDays < ruleObj.minimum_nights) isAutoValid = false;
                    
                    if (isAutoValid) {
                        setShowQuoteModal(true);
                    }
                }
            }
        }
    };

    const addService = () => setExtraServices([...extraServices, { name: '', price: 0 }]);
    const removeService = (idx) => setExtraServices(extraServices.filter((_, i) => i !== idx));
    const updateService = (idx, field, val) => {
        const newServices = [...extraServices];
        newServices[idx][field] = field === 'price' ? parseFloat(val) || 0 : val;
        setExtraServices(newServices);
    };

    async function handleCreateQuote() {
        if (!selectedClientId || !selectionStart || !selectionEnd) return;
        
        const status = validateBooking();
        if (!status.valid) {
            alert("Unable to create quote: " + status.errors.join(" "));
            return;
        }

        setSavingQuote(true);
        try {
            const { total: finalPrice, items: breakdown, base: supplierBase } = getQuoteBreakdown();
            const activeAdminMargin = (agentDetails?.admin_margin > 0) 
                ? agentDetails.admin_margin 
                : globalMargins.invenioToAdmin;

            const { data, error: quoteErr } = await supabase.from('quotes').insert({
                boat_uuid: boat.v_uuid,
                client_id: selectedClientId,
                check_in: selectionStart,
                check_out: selectionEnd,
                supplier_base_price: supplierBase,
                admin_markup: activeAdminMargin,
                agent_markup: 0,
                extra_services: extraServices,
                stripe_fee_included: useStripeFee,
                final_price: finalPrice,
                price_breakdown: breakdown,
                is_manual_price: isManualPrice,
                status: 'draft',
                agent_id: user?.id,
                group_details: {
                    type: groupType,
                    children: groupType === 'family' ? numChildren : 0,
                    composition: friendsComposition,
                    is_couples: isCouples,
                    has_pets: hasPets
                }
            }).select('id').single();

            if (quoteErr) throw quoteErr;
            setCreatedQuoteId(data.id);
        } catch (err) {
            alert('Error creating quote: ' + err.message);
        } finally {
            setSavingQuote(false);
        }
    }

    if (loading) return (
        <div className="flex items-center justify-center min-h-[60vh]">
            <div className="animate-spin size-8 border-4 border-primary border-t-transparent rounded-full"></div>
        </div>
    );

    if (error || !boat) return (
        <div className="p-12 text-center text-text-muted">
            <h2 className="text-xl font-bold text-text-primary mb-2">Error</h2>
            <p>{error || 'Boat not found'}</p>
        </div>
    );

    const mainPhoto = photos.length > 0 ? photos[activePhotoIndex].url : boat.thumbnail_url || FALLBACK_IMG;

    return (
        <div className="max-w-[1400px] mx-auto p-4 md:p-8 space-y-8 pb-20">
            {/* Header & Gallery */}
            <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs text-text-muted">
                    <button onClick={() => navigate('/boats')} className="hover:text-primary transition-colors">Boats</button>
                    <span className="material-symbols-outlined notranslate text-[10px]">chevron_right</span>
                    <span className="text-text-secondary font-medium">{boat.boat_name}</span>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[400px] md:h-[600px]">
                    <div className="lg:col-span-3 relative rounded-2xl overflow-hidden bg-surface group cursor-pointer" onClick={() => setShowPhotoModal(true)}>
                        <img src={mainPhoto} className="w-full h-full object-cover" alt={boat.boat_name} />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-8">
                             <div>
                                <h1 className="text-3xl font-bold text-text-primary">{boat.boat_name}</h1>
                                <p className="text-text-primary mt-2 uppercase text-xs font-bold tracking-widest">{boat.manufacturer} {boat.model} ({boat.year})</p>
                             </div>
                        </div>
                        {photos.length > 0 && (
                            <div className="absolute bottom-6 right-6 bg-black/60 backdrop-blur-sm border border-border px-4 py-2 rounded-xl text-text-primary text-xs font-bold flex items-center gap-2">
                                <span className="material-symbols-outlined notranslate text-[18px]">photo_library</span>
                                {photos.length} Photos
                            </div>
                        )}
                    </div>
                    <div className="hidden lg:flex flex-col gap-4">
                        {photos.slice(1, 4).map((ph, idx) => (
                            <div key={idx} className="flex-1 rounded-2xl overflow-hidden bg-surface relative border border-border cursor-pointer group" onClick={() => { setActivePhotoIndex(idx + 1); setShowPhotoModal(true); }}>
                                <img src={ph.url} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="" />
                                {idx === 2 && photos.length > 4 && (
                                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                        <span className="text-text-primary font-bold text-lg">+{photos.length - 4}</span>
                                    </div>
                                )}
                            </div>
                        ))}
                        {photos.length <= 1 && (
                            <div className="flex-1 rounded-2xl border border-dashed border-border flex items-center justify-center text-text-muted">
                                <span className="material-symbols-outlined notranslate text-4xl">add_photo_alternate</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Photo Lightbox Modal */}
            {showPhotoModal && (
                <div className="fixed inset-0 z-[100] flex flex-col bg-black/98 backdrop-blur-2xl animate-in fade-in duration-300 select-none">
                    <div className="p-4 md:p-6 flex justify-between items-center z-10 bg-gradient-to-b from-black/50 to-transparent">
                        <div className="flex flex-col">
                            <span className="text-text-primary font-bold text-sm tracking-tight">{boat.boat_name}</span>
                            <span className="text-text-primary/40 text-[10px] font-black uppercase tracking-[0.2em]">{activePhotoIndex + 1} / {photos.length}</span>
                        </div>
                        <button 
                            onClick={() => setShowPhotoModal(false)} 
                            className="size-10 md:size-12 rounded-full bg-surface-2 border border-border flex items-center justify-center text-text-primary hover:bg-primary/20 transition-all hover:scale-110 active:scale-95 shadow-xl"
                        >
                            <span className="material-symbols-outlined notranslate">close</span>
                        </button>
                    </div>

                    <div className="flex-1 relative flex items-center justify-center p-2 md:p-6 overflow-hidden">
                        <button 
                            className="absolute left-4 md:left-8 z-20 size-12 md:size-16 rounded-full bg-surface-2 border border-border flex items-center justify-center text-text-primary hover:bg-white/20 disabled:opacity-0 transition-all hover:scale-110 active:scale-90 shadow-2xl backdrop-blur-md"
                            disabled={activePhotoIndex === 0}
                            onClick={(e) => { e.stopPropagation(); setActivePhotoIndex(p => p - 1); }}
                        >
                            <span className="material-symbols-outlined notranslate text-2xl md:text-4xl">chevron_left</span>
                        </button>

                        <div className="w-full h-full flex items-center justify-center pointer-events-none">
                            <img 
                                key={activePhotoIndex}
                                src={photos[activePhotoIndex]?.url} 
                                className="max-w-full max-h-full object-contain rounded-sm shadow-[0_0_100px_rgba(0,0,0,1)] animate-in fade-in zoom-in-95 duration-500 pointer-events-auto" 
                                alt="" 
                            />
                        </div>

                        <button 
                            className="absolute right-4 md:right-8 z-20 size-12 md:size-16 rounded-full bg-surface-2 border border-border flex items-center justify-center text-text-primary hover:bg-white/20 disabled:opacity-0 transition-all hover:scale-110 active:scale-90 shadow-2xl backdrop-blur-md"
                            disabled={activePhotoIndex === photos.length - 1}
                            onClick={(e) => { e.stopPropagation(); setActivePhotoIndex(p => p + 1); }}
                        >
                            <span className="material-symbols-outlined notranslate text-2xl md:text-4xl">chevron_right</span>
                        </button>
                    </div>

                    <div className="p-4 md:p-8 flex gap-3 overflow-x-auto pb-6 scrollbar-hide justify-center items-center bg-gradient-to-t from-black/50 to-transparent">
                        <div className="flex gap-2 mx-auto">
                            {photos.map((ph, idx) => (
                                <div 
                                    key={idx} 
                                    className={`size-14 md:size-20 flex-shrink-0 rounded-lg overflow-hidden cursor-pointer transition-all duration-300 ${activePhotoIndex === idx ? 'ring-2 ring-primary ring-offset-4 ring-offset-black scale-105 opacity-100 shadow-lg shadow-primary/20' : 'opacity-30 hover:opacity-100 grayscale-[50%] hover:grayscale-0'}`}
                                    onClick={() => setActivePhotoIndex(idx)}
                                >
                                    <img src={ph.thumbnail_url || ph.url} className="w-full h-full object-cover" alt="" />
                                </div>
                            ))}
                        </div>
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
                            <span className="material-symbols-outlined notranslate text-primary">directions_boat</span>
                            <div><p className="text-xs text-text-muted leading-tight">Length</p><p className="font-bold text-text-primary">{boat.length_ft} ft</p></div>
                        </div>
                        <div className="glass-card flex items-center gap-3 px-5 py-3 border-primary/20 bg-primary/2">
                            <span className="material-symbols-outlined notranslate text-primary">group</span>
                            <div><p className="text-xs text-text-muted leading-tight">Guests</p><p className="font-bold text-text-primary">{boat.guest_capacity_day} Day / {boat.sleeps} Night</p></div>
                        </div>
                        <div className="glass-card flex items-center gap-3 px-5 py-3 border-primary/20 bg-primary/2">
                            <span className="material-symbols-outlined notranslate text-primary">bed</span>
                            <div><p className="text-xs text-text-muted leading-tight">Cabins</p><p className="font-bold text-text-primary">{boat.cabins}</p></div>
                        </div>
                    </div>

                    {/* Description */}
                    <div className="glass-card p-6 md:p-8">
                        <h2 className="text-xl font-bold text-text-primary mb-4">About this Boat</h2>
                        <div className="text-text-muted text-sm leading-relaxed space-y-4 whitespace-pre-line">
                            {boat.description || 'No description available for this vessel.'}
                        </div>
                    </div>

                    {/* Calendar / Availability */}
                    <div className="glass-card p-6 md:p-8">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
                                    <span className="material-symbols-outlined notranslate text-primary text-[24px]">calendar_today</span>
                                    Availability & Prices
                                </h2>
                                <p className="text-xs text-text-muted mt-1">Select dates to calculate a quote</p>
                                <p className="text-[10px] text-primary mt-1 italic max-w-sm">For day charters, click the date once. For multi-day charters, click start and end dates.</p>
                            </div>
                            <div className="flex gap-4">
                                <div className="flex items-center gap-2"><div className="size-3 rounded-full bg-red-500/80"></div><span className="text-[10px] text-text-muted uppercase font-bold tracking-widest">Booked</span></div>
                                <div className="flex items-center gap-2"><div className="size-3 rounded-full bg-surface border border-border"></div><span className="text-[10px] text-text-muted uppercase font-bold tracking-widest">Available</span></div>
                            </div>
                        </div>

                        <div className="space-y-12">
                            {[0, 1, 2, 3, 4, 5, 6].map(offset => {
                                const today = new Date();
                                const monthDate = new Date(today.getFullYear(), today.getMonth() + offset, 1);
                                if (monthDate.getFullYear() > 2026) return null; 

                                const monthName = monthDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
                                const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
                                const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getDay();
                                
                                return (
                                    <div key={monthName}>
                                        <h3 className="text-sm font-bold text-text-secondary mb-4 capitalize tracking-wide">{monthName}</h3>
                                        <div className="grid grid-cols-7 gap-1 md:gap-2">
                                            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => (
                                                <div key={d} className="text-center text-[10px] text-text-muted font-bold mb-1">{d}</div>
                                            ))}
                                            {[...Array(firstDay)].map((_, i) => <div key={i} />)}
                                            {[...Array(daysInMonth)].map((_, i) => {
                                                const d = i + 1;
                                                const dStr = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                                                const isBlocked = blockedDates.includes(dStr);
                                                const price = getPriceForDate(dStr, true);
                                                
                                                const isSelected = dStr === selectionStart || dStr === selectionEnd || 
                                                    (selectionStart && selectionEnd && new Date(dStr) >= new Date(selectionStart) && new Date(dStr) <= new Date(selectionEnd));

                                                return (
                                                    <div
                                                        key={d}
                                                        onClick={() => handleDateClick(dStr, isBlocked)}
                                                        className={`
                                                            relative aspect-square flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer group
                                                            ${isBlocked ? 'bg-red-500/10 border-red-500/20 grayscale opacity-60 cursor-not-allowed' : 'bg-surface border border-border hover:border-primary/50'}
                                                            ${isSelected ? 'bg-primary border-primary ring-2 ring-primary/20 ring-offset-2 ring-offset-background scale-105 z-10' : ''}
                                                        `}
                                                    >
                                                        <span className={`text-sm font-bold ${isSelected ? 'text-[#0f1117]' : 'text-text-primary'}`}>{d}</span>
                                                        <span className={`text-[10px] font-bold mt-0.5 ${isSelected ? 'text-[#0f1117]/80' : 'text-primary'}`}>€{price}</span>
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
                </div>

                {/* RIGHT: Booking Sidebar */}
                <div className="space-y-6 lg:sticky lg:top-8">
                    {/* Price & Summary Card */}
                    <div className="glass-card p-6 border-primary/30 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>
                        
                        <div className="relative">
                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest mb-1">Daily From</p>
                            <div className="flex items-baseline gap-2 mb-6">
                                <span className="text-4xl font-extrabold text-text-primary">
                                    €{Math.round(
                                        parseFloat(boat.daily_price || 0) * (1 + ((role !== 'admin' && agentDetails?.admin_margin > 0) ? agentDetails.admin_margin : globalMargins.invenioToAdmin) / 100)
                                    ).toLocaleString()}
                                </span>
                                <span className="text-text-muted text-sm">/ day</span>
                            </div>

                            <div className="space-y-3 mb-8">
                                <div className="flex justify-between text-xs">
                                    <span className="text-text-muted">Security Deposit</span>
                                    <span className="text-text-primary font-bold">€{parseFloat(boat.security_deposit || 0).toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-text-muted">Base Port</span>
                                    <span className="text-text-primary font-bold">{boat.base_port || 'Ibiza'}</span>
                                </div>
                            </div>

                            {selectionStart && (
                                <div className={`border rounded-xl p-4 mb-6 ${bookingStatus.valid ? 'bg-primary/10 border-primary/20' : 'bg-red-500/10 border-red-500/20'}`}>
                                    <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${bookingStatus.valid ? 'text-primary' : 'text-red-400'}`}>
                                        {bookingStatus.valid ? 'Selected Period' : 'Booking Rule Violation'}
                                    </p>
                                    <div className="flex items-center justify-between font-bold text-text-primary text-sm">
                                        <span>{new Date(selectionStart).toLocaleDateString()}</span>
                                        {selectionEnd && selectionEnd !== selectionStart && (
                                            <>
                                                <span className="material-symbols-outlined notranslate text-[14px]">arrow_forward</span>
                                                <span>{new Date(selectionEnd).toLocaleDateString()}</span>
                                            </>
                                        )}
                                    </div>
                                    <div className="text-xs font-bold text-text-muted mt-2">
                                        Dur: {Math.max(1, Math.ceil(Math.abs(new Date(selectionEnd || selectionStart) - new Date(selectionStart)) / (1000 * 60 * 60 * 24)))} Day(s) Charter
                                    </div>
                                    {!bookingStatus.valid && selectionEnd && (
                                        <div className="mt-4 p-4 rounded-xl bg-red-500/20 border border-red-500/30 space-y-2 animate-in shake duration-500">
                                            <p className="text-xs font-black text-red-400 uppercase tracking-widest flex items-center gap-2">
                                                <span className="material-symbols-outlined notranslate text-sm">warning</span>
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
                                            <span className="text-xs text-text-muted font-bold uppercase tracking-widest">Estimated Total</span>
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
                                    <p className="text-[10px] text-red-500/70 font-bold uppercase tracking-widest">Selected dates violate boat rules</p>
                                </div>
                            ) : (
                                <div className="text-center p-4 rounded-xl border border-dashed border-border">
                                    <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest">Select dates on calendar</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Quote Modal */}
            {showQuoteModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
                    <div className="bg-surface border border-border rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="p-8 border-b border-border">
                            <div className="flex justify-between items-start mb-2">
                                <h2 className="text-2xl font-bold text-text-primary">New Boat Quote</h2>
                                <button onClick={resetQuoteModal} className="text-text-muted hover:text-text-primary transition-colors">
                                    <span className="material-symbols-outlined notranslate">close</span>
                                </button>
                            </div>
                            <p className="text-text-muted text-xs">Confirm dates and select a client for <span className="text-primary font-bold">{boat.boat_name}</span></p>
                        </div>

                        <div className="p-6 md:p-8 space-y-6 max-h-[70vh] overflow-y-auto w-full">
                            {createdQuoteId ? (
                                <div className="text-center space-y-6 py-4 animate-in fade-in zoom-in w-full">
                                    <div className="size-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto border border-green-500/20">
                                        <span className="material-symbols-outlined notranslate text-green-500 text-4xl">check_circle</span>
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold text-text-primary mb-2">Quote Created!</h3>
                                        <p className="text-text-muted text-sm">The proposal is ready. You can now share this private link with your client.</p>
                                    </div>
                                    
                                    <div className="bg-background/50 p-4 rounded-2xl border border-border flex items-center gap-3">
                                        <input 
                                            readOnly 
                                            value={`${window.location.origin}/quote/${createdQuoteId}`}
                                            className="bg-transparent text-xs text-primary font-medium flex-1 outline-none w-full min-w-0 overflow-hidden text-clip whitespace-nowrap lg:whitespace-normal break-all"
                                        />
                                        <button 
                                            onClick={() => {
                                                navigator.clipboard.writeText(`${window.location.origin}/quote/${createdQuoteId}`);
                                                alert('Link copied!');
                                            }}
                                            className="btn-primary px-4 py-2 text-[10px] uppercase font-bold shrink-0"
                                        >
                                            Copy
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {/* Selected Info Summary */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-background/50 p-4 rounded-2xl border border-border">
                                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest mb-1">Check-in</p>
                                            <p className="text-sm font-bold text-text-primary">{new Date(selectionStart).toLocaleDateString('en-GB')}</p>
                                        </div>
                                        <div className="bg-background/50 p-4 rounded-2xl border border-border">
                                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest mb-1">Check-out</p>
                                            <p className="text-sm font-bold text-text-primary">{new Date(selectionEnd).toLocaleDateString('en-GB')}</p>
                                        </div>
                                    </div>
                                    
                                    <div className="flex justify-between items-center p-4 rounded-2xl bg-primary/5 border border-primary/20">
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-text-muted uppercase tracking-widest">Total Quote Price</span>
                                            <label className="flex items-center gap-2 mt-2 cursor-pointer group">
                                                <input 
                                                    type="checkbox" 
                                                    className="accent-primary size-3" 
                                                    checked={useStripeFee}
                                                    onChange={e => setUseStripeFee(e.target.checked)}
                                                />
                                                <span className="text-[10px] text-text-muted font-bold uppercase group-hover:text-primary transition-colors">Add Stripe Fee (1.5%)</span>
                                            </label>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-2xl font-black text-primary block">€{calculateQuoteTotal().toLocaleString()}</span>
                                            <div className="flex items-center justify-end gap-2 mt-1">
                                                <span className="text-[10px] text-green-500 font-black uppercase bg-green-500/10 px-2 py-0.5 rounded">
                                                    Your Profit: €{getQuoteBreakdown().profit.toLocaleString()}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Extra Services */}
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest">Extra Services</label>
                                            <button 
                                                onClick={addService}
                                                className="text-[10px] font-bold text-primary uppercase hover:underline flex items-center gap-1"
                                            >
                                                <span className="material-symbols-outlined notranslate text-sm">add</span> Add Service
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {extraServices.map((s, idx) => (
                                                <div key={idx} className="flex gap-2 items-center bg-background/50 p-2 rounded-xl border border-border animate-in slide-in-from-right-2">
                                                    <input 
                                                        placeholder="Service name"
                                                        className="flex-1 bg-transparent border-none text-[11px] text-text-primary outline-none"
                                                        value={s.name}
                                                        onChange={e => updateService(idx, 'name', e.target.value)}
                                                    />
                                                    <div className="relative w-20">
                                                        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] text-text-muted">€</span>
                                                        <input 
                                                            type="number"
                                                            placeholder="0"
                                                            className="w-full bg-transparent border-none text-[11px] text-right text-primary font-bold outline-none"
                                                            value={s.price}
                                                            onChange={e => updateService(idx, 'price', e.target.value)}
                                                        />
                                                    </div>
                                                    <button onClick={() => removeService(idx)} className="text-text-muted hover:text-red-400 p-1">
                                                        <span className="material-symbols-outlined notranslate text-sm">delete</span>
                                                    </button>
                                                </div>
                                            ))}
                                            {extraServices.length === 0 && <p className="text-[10px] text-text-muted italic">No extra services added.</p>}
                                        </div>
                                    </div>

                                    {/* Manual Price Override */}
                                    <div className="space-y-3 pt-2 border-t border-border">
                                        <div className="flex justify-between items-center">
                                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest">Manual Price Override</label>
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
                                        <p className="text-[10px] text-text-muted font-medium italic leading-tight">
                                            {isManualPrice ? 'Warning: Automatic calculations are suspended.' : 'Using automatic calculation based on selection and margin.'}
                                        </p>
                                    </div>

                                    {/* Group Qualification Section */}
                                    <div className="space-y-4 pt-4 border-t border-border">
                                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest block">Group Qualification</label>
                                        
                                        {/* Group Type Buttons */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <button 
                                                type="button"
                                                onClick={() => setGroupType('family')}
                                                className={`p-3 rounded-2xl border transition-all flex flex-col items-center gap-1 ${groupType === 'family' ? 'bg-primary/10 border-primary text-primary' : 'bg-surface border-border text-text-muted hover:border-text-muted'}`}
                                            >
                                                <span className="material-symbols-outlined notranslate text-xl">family_restroom</span>
                                                <span className="text-[10px] font-bold uppercase tracking-wide">Family</span>
                                            </button>
                                            <button 
                                                type="button"
                                                onClick={() => setGroupType('friends')}
                                                className={`p-3 rounded-2xl border transition-all flex flex-col items-center gap-1 ${groupType === 'friends' ? 'bg-primary/10 border-primary text-primary' : 'bg-surface border-border text-text-muted hover:border-text-muted'}`}
                                            >
                                                <span className="material-symbols-outlined notranslate text-xl">group</span>
                                                <span className="text-[10px] font-bold uppercase tracking-wide">Friends</span>
                                            </button>
                                        </div>

                                        {/* Conditional Sub-questions */}
                                        {groupType === 'family' && (
                                            <div className="animate-in slide-in-from-top-2 duration-200">
                                                <label className="text-[10px] text-text-muted font-bold uppercase tracking-widest mb-2 block">Number of Children</label>
                                                <input 
                                                    type="number"
                                                    min="0"
                                                    className="input-theme w-full"
                                                    placeholder="0"
                                                    value={numChildren}
                                                    onChange={e => setNumChildren(parseInt(e.target.value) || 0)}
                                                />
                                            </div>
                                        )}

                                        {groupType === 'friends' && (
                                            <div className="space-y-3 animate-in slide-in-from-top-2 duration-200">
                                                <div>
                                                    <label className="text-[10px] text-text-muted font-bold uppercase tracking-widest mb-2 block">Composition</label>
                                                    <select 
                                                        className="input-theme w-full py-2 text-xs"
                                                        value={friendsComposition}
                                                        onChange={e => setFriendsComposition(e.target.value)}
                                                    >
                                                        <option value="">Select composition...</option>
                                                        <option value="males">All Males</option>
                                                        <option value="females">All Females</option>
                                                        <option value="mixed">Mixed Group</option>
                                                    </select>
                                                </div>
                                                <label className="flex items-center gap-2 cursor-pointer group">
                                                    <input 
                                                        type="checkbox" 
                                                        className="accent-primary"
                                                        checked={isCouples}
                                                        onChange={e => setIsCouples(e.target.checked)}
                                                    />
                                                    <span className="text-[10px] text-text-muted font-bold uppercase group-hover:text-primary transition-colors">Couples Only?</span>
                                                </label>
                                            </div>
                                        )}

                                        {/* Pets Toggle */}
                                        <div className="pt-2">
                                            <label className="flex items-center gap-2 cursor-pointer group">
                                                <input 
                                                    type="checkbox" 
                                                    className="accent-primary"
                                                    checked={hasPets}
                                                    onChange={e => setHasPets(e.target.checked)}
                                                />
                                                <span className="text-[10px] text-text-muted font-bold uppercase group-hover:text-primary transition-colors flex items-center gap-1">
                                                    <span className="material-symbols-outlined notranslate text-sm">pets</span>
                                                    Traveling with pets?
                                                </span>
                                            </label>
                                        </div>
                                    </div>

                                    {/* Client Search/Select */}
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs text-text-muted font-bold uppercase tracking-widest">Select Client</label>
                                            <button 
                                                onClick={() => setShowNewClientForm(!showNewClientForm)}
                                                className={`text-[10px] font-black uppercase px-2 py-1 rounded transition-colors ${showNewClientForm ? 'bg-red-500/20 text-red-400' : 'bg-primary/20 text-primary'}`}
                                            >
                                                {showNewClientForm ? 'Cancel New' : '+ New Client'}
                                            </button>
                                        </div>
                                        
                                        {showNewClientForm ? (
                                            <div className="p-4 bg-surface-2 border border-border rounded-2xl space-y-3 animate-in fade-in slide-in-from-top-2">
                                                <input 
                                                    className="input-theme w-full" 
                                                    placeholder="Full Name *" 
                                                    value={newClient.full_name}
                                                    onChange={e => setNewClient(p => ({ ...p, full_name: e.target.value }))}
                                                />
                                                <input 
                                                    className="input-theme w-full" 
                                                    placeholder="Email Address" 
                                                    value={newClient.email}
                                                    onChange={e => setNewClient(p => ({ ...p, email: e.target.value }))}
                                                />
                                                <input 
                                                    className="input-theme w-full" 
                                                    placeholder="Phone Number" 
                                                    value={newClient.phone_number}
                                                    onChange={e => setNewClient(p => ({ ...p, phone_number: e.target.value }))}
                                                />
                                                <button 
                                                    onClick={handleQuickCreateClient}
                                                    disabled={creatingClient || !newClient.full_name}
                                                    className="w-full btn-primary py-2 text-xs font-bold disabled:opacity-50"
                                                >
                                                    {creatingClient ? 'Creating...' : 'Create & Select Client'}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                <div className="relative">
                                                    <span className="material-symbols-outlined notranslate absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">search</span>
                                                    <input 
                                                        className="input-theme w-full pl-10" 
                                                        placeholder="Search client name..." 
                                                        value={clientSearch}
                                                        onChange={e => setClientSearch(e.target.value)}
                                                    />
                                                </div>
                                                <select 
                                                    className="input-theme w-full py-3"
                                                    size={4}
                                                    value={selectedClientId}
                                                    onChange={e => setSelectedClientId(e.target.value)}
                                                >
                                                    <option value="" disabled>Choose a client...</option>
                                                    {clients
                                                        .filter(c => !clientSearch || c.full_name?.toLowerCase().includes(clientSearch.toLowerCase()))
                                                        .map(c => (
                                                        <option key={c.id} value={c.id} className="p-2 border-b border-border last:border-0">{c.full_name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="p-6 md:p-8 bg-background/30 border-t border-border flex flex-col md:flex-row gap-4">
                            {createdQuoteId ? (
                                <button 
                                    onClick={() => { resetQuoteModal(); navigate('/quotes'); }}
                                    className="flex-1 btn-primary py-4 font-bold shadow-lg shadow-primary/20"
                                >
                                    Close & View All Quotes
                                </button>
                            ) : (
                                <>
                                    <button 
                                        onClick={resetQuoteModal}
                                        className="flex-1 py-4 rounded-2xl border border-border text-text-muted font-bold hover:bg-surface-2 transition-all"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        onClick={handleCreateQuote}
                                        disabled={!selectedClientId || savingQuote || !bookingStatus.valid}
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
