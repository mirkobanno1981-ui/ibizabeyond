import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80';

export default function OwnerConfirmationView() {
    const { id } = useParams(); // quote_id
    const [quote, setQuote] = useState(null);
    const [villa, setVilla] = useState(null);
    const [boat, setBoat] = useState(null);
    const [photos, setPhotos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [status, setStatus] = useState('pending'); // pending, awaiting_price, confirmed, declined
    const [declineReason, setDeclineReason] = useState('');
    const [showDeclineModal, setShowDeclineModal] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [priceInput, setPriceInput] = useState('');
    const [priceNotes, setPriceNotes] = useState('');
    const [commissionIncluded, setCommissionIncluded] = useState(null); // null | true | false
    const [commissionPct, setCommissionPct] = useState('');
    const [showPriceReview, setShowPriceReview] = useState(false);

    useEffect(() => {
        if (id) fetchQuoteData();
    }, [id]);

    async function fetchQuoteData() {
        setLoading(true);
        try {
            const { data: quoteData, error: quoteErr } = await supabase
                .from('quotes')
                .select(`
                    *,
                    properties(*),
                    boats(*),
                    clients(full_name)
                `)
                .eq('id', id)
                .single();
            
            if (quoteErr) throw quoteErr;
            if (!quoteData) throw new Error('Request not found');

            setQuote(quoteData);
            setVilla(quoteData.properties);
            setBoat(quoteData.boats);

            if (quoteData.status === 'sent' || quoteData.status === 'booked' || quoteData.status === 'check_in_ready') {
                setStatus('confirmed');
            } else if (quoteData.status === 'owner_declined') {
                setStatus('declined');
            }

            // Fetch Photos
            const { data: photoData } = await supabase
                .from('property_photos')
                .select('url, sort_order')
                .or(`v_uuid.eq.${quoteData.v_uuid || '00000000-0000-0000-0000-000000000000'},boat_uuid.eq.${quoteData.boat_uuid || '00000000-0000-0000-0000-000000000000'}`)
                .order('sort_order', { ascending: true })
                .limit(5);
            
            setPhotos(photoData || []);

        } catch (err) {
            console.error('Fetch error:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    const handleConfirm = async () => {
        setProcessing(true);
        try {
            const needsPrice = !quote?.final_price || parseFloat(quote.final_price) === 0;
            if (needsPrice) {
                setStatus('awaiting_price');
                setProcessing(false);
                return;
            }
            const { error } = await supabase
                .from('quotes')
                .update({
                    status: 'sent',
                    owner_decline_reason: null
                })
                .eq('id', id);

            if (error) throw error;

            if (quote?.agent_id) {
                const propName = villa?.villa_name || boat?.boat_name || 'property';
                await supabase.from('notifications').insert({
                    user_id: quote.agent_id,
                    type: 'owner_confirmed',
                    title: `Availability confirmed for ${propName}`,
                    body: `Dates ${new Date(quote.check_in).toLocaleDateString()} → ${new Date(quote.check_out).toLocaleDateString()} approved by owner.`,
                    quote_id: id,
                    v_uuid: quote.v_uuid || null,
                    boat_uuid: quote.boat_uuid || null,
                });
            }

            setStatus('confirmed');
        } catch (err) {
            alert('Error updating availability: ' + err.message);
        } finally {
            setProcessing(false);
        }
    };

    const proceedToReview = () => {
        const value = parseFloat(priceInput);
        if (!value || value <= 0) {
            alert('Please enter a valid price in €.');
            return;
        }
        if (commissionIncluded === null) {
            alert('Please indicate whether the price already includes a commission.');
            return;
        }
        if (commissionIncluded === true) {
            const pct = parseFloat(commissionPct);
            if (!pct || pct <= 0 || pct >= 100) {
                alert('Enter the commission percentage included in the price (e.g. 15).');
                return;
            }
        }
        setShowPriceReview(true);
    };

    const handleSubmitPrice = async () => {
        const value = parseFloat(priceInput);
        if (!value || value <= 0) {
            alert('Please enter a valid price in €.');
            return;
        }
        setProcessing(true);
        try {
            const inclPct = commissionIncluded === true ? parseFloat(commissionPct) || 0 : 0;
            const commissionLine = commissionIncluded === true
                ? `Commission included: ${inclPct}%.`
                : 'No commission included.';
            const combinedNotes = [commissionLine, priceNotes].filter(Boolean).join(' ');
            const { error } = await supabase
                .from('quotes')
                .update({
                    status: 'owner_priced',
                    supplier_base_price: value,
                    editor_markup: inclPct,
                    editor_included: commissionIncluded === true,
                    owner_decline_reason: combinedNotes || null
                })
                .eq('id', id);
            if (error) throw error;

            // Upsert seasonal_prices row covering booking dates so future quotes see the price.
            const checkIn = quote.check_in;
            const checkOut = quote.check_out;
            if (checkIn && checkOut && (quote.v_uuid || quote.boat_uuid)) {
                const nights = Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000));
                const perDay = Math.round((value / nights) * 100) / 100;
                const targetUuid = quote.v_uuid || quote.boat_uuid;
                // Delete any seasonal_prices rows that overlap the booking range so we don't stack duplicates.
                await supabase
                    .from('seasonal_prices')
                    .delete()
                    .eq('v_uuid', targetUuid)
                    .lte('start_date', checkOut)
                    .gte('end_date', checkIn);
                await supabase.from('seasonal_prices').insert({
                    v_uuid: targetUuid,
                    start_date: checkIn,
                    end_date: checkOut,
                    amount: perDay,
                });
            }

            // Notify quote creator (agent) in-app.
            if (quote.agent_id) {
                const propName = villa?.villa_name || boat?.boat_name || 'property';
                const commissionMsg = commissionIncluded === true
                    ? `Commission included: ${inclPct}%.`
                    : 'No commission included.';
                const bodyLines = [
                    `Dates ${new Date(checkIn).toLocaleDateString()} → ${new Date(checkOut).toLocaleDateString()}.`,
                    commissionMsg,
                    priceNotes ? `Notes: ${priceNotes}` : null,
                ].filter(Boolean).join(' ');
                await supabase.from('notifications').insert({
                    user_id: quote.agent_id,
                    type: 'owner_priced',
                    title: `Owner quoted €${value.toLocaleString()} for ${propName}`,
                    body: bodyLines,
                    quote_id: id,
                    v_uuid: quote.v_uuid || null,
                    boat_uuid: quote.boat_uuid || null,
                });
            }

            setStatus('confirmed');
        } catch (err) {
            alert('Error submitting price: ' + err.message);
        } finally {
            setProcessing(false);
        }
    };

    const handleDecline = async () => {
        setProcessing(true);
        try {
            const { error } = await supabase
                .from('quotes')
                .update({ 
                    status: 'owner_declined',
                    owner_decline_reason: declineReason
                })
                .eq('id', id);

            if (error) throw error;

            if (quote?.agent_id) {
                const propName = villa?.villa_name || boat?.boat_name || 'property';
                await supabase.from('notifications').insert({
                    user_id: quote.agent_id,
                    type: 'owner_declined',
                    title: `Owner declined ${propName}`,
                    body: declineReason || 'No reason provided.',
                    quote_id: id,
                    v_uuid: quote.v_uuid || null,
                    boat_uuid: quote.boat_uuid || null,
                });
            }

            setStatus('declined');
            setShowDeclineModal(false);
        } catch (err) {
            alert('Error updating availability: ' + err.message);
        } finally {
            setProcessing(false);
        }
    };

    if (loading) return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center space-y-4">
            <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-text-muted font-medium animate-pulse uppercase tracking-widest text-xs">Loading request details...</p>
        </div>
    );

    if (error || !quote) return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8 text-center">
            <div className="size-16 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 mb-4 mx-auto">
                <span className="material-symbols-outlined notranslate text-3xl">error</span>
            </div>
            <h1 className="text-2xl font-bold text-text-primary mb-2">Request Not Available</h1>
            <p className="text-text-muted max-w-md">{error || "We couldn't retrieve the details for this request."}</p>
        </div>
    );

    const mainPhoto = photos.length > 0 ? photos[0].url : FALLBACK_IMG;

    return (
        <div className="min-h-screen bg-background text-text-secondary font-sans pb-20">
            {/* Simple Header */}
            <nav className="h-20 border-b border-border flex items-center px-6 md:px-12 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
                <div className="flex items-center gap-3">
                    <div className="size-10 bg-primary rounded-xl flex items-center justify-center">
                        <span className="material-symbols-outlined notranslate text-background-dark font-black">diamond</span>
                    </div>
                    <span className="font-bold text-text-primary tracking-widest text-sm uppercase">Ibiza Beyond</span>
                </div>
                <div className="ml-auto flex items-center gap-4">
                    {quote.group_details && (
                        <div className={`hidden md:flex items-center gap-2 px-4 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-widest ${
                            quote.group_details.type === 'family' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-primary/10 text-primary border-primary/20'
                        }`}>
                            <span className="material-symbols-outlined notranslate text-sm">verified_user</span>
                            {quote.group_details.type === 'family' ? 'Verified Family' : 'Verified Group'}
                        </div>
                    )}
                    <span className="text-[10px] font-black text-primary border border-primary/30 px-3 py-1 rounded-full uppercase tracking-widest">
                        Availability Request
                    </span>
                </div>
            </nav>

            <main className="max-w-4xl mx-auto p-4 md:p-12 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                
                {/* Hero Section */}
                <section className="bg-surface border border-border rounded-[2rem] overflow-hidden shadow-2xl">
                    <div className="h-[300px] md:h-[450px] relative">
                        <img src={mainPhoto} className="w-full h-full object-cover" alt={villa?.villa_name || boat?.boat_name} />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
                        <div className="absolute bottom-8 left-8 right-8">
                            <h1 className="text-3xl md:text-5xl font-black text-white tracking-tight mb-2">
                                {villa?.villa_name || boat?.boat_name}
                            </h1>
                            <div className="flex items-center gap-2 text-primary font-bold">
                                <span className="material-symbols-outlined notranslate text-sm">location_on</span>
                                <span className="text-sm uppercase tracking-widest">
                                    {villa ? (villa.areaname || villa.district) : (boat?.location_base_port || 'Ibiza')}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="p-8 md:p-12 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
                        <div className="space-y-6">
                            <h2 className="text-xl font-bold text-text-primary uppercase tracking-widest">Booking Details</h2>
                            <div className="space-y-4">
                                <div className="flex items-center gap-4 bg-background/50 p-4 rounded-2xl border border-border">
                                    <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                                        <span className="material-symbols-outlined notranslate">calendar_month</span>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black text-text-muted uppercase tracking-widest">Period</p>
                                        <p className="text-base font-bold text-text-primary">
                                            {new Date(quote.check_in).toLocaleDateString()} &rarr; {new Date(quote.check_out).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 bg-background/50 p-4 rounded-2xl border border-border">
                                    <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                                        <span className="material-symbols-outlined notranslate">groups</span>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black text-text-muted uppercase tracking-widest">Client</p>
                                        <p className="text-base font-bold text-text-primary">
                                            {quote.clients?.full_name || 'V.I.P. Client'}
                                        </p>
                                    </div>
                                </div>
                                {quote.group_details && quote.group_details.type && (
                                    <div className="p-6 rounded-[1.5rem] bg-surface-2 border-2 border-primary/20 space-y-4 animate-in zoom-in-95 duration-500 shadow-xl shadow-primary/5">
                                        <div className="flex items-center justify-between">
                                            <div className="flex flex-col">
                                                <h3 className="text-[10px] font-black text-text-muted uppercase tracking-widest">Guest Quality Profile</h3>
                                                <span className="text-[8px] text-primary font-bold uppercase tracking-widest">Ibiza Beyond Certified</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                                                    quote.group_details.type === 'family' ? 'bg-emerald-500 text-white' : 'bg-primary text-background-dark'
                                                }`}>
                                                    {quote.group_details.type}
                                                </span>
                                            </div>
                                        </div>
                                        
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2 text-text-primary">
                                                    <span className="material-symbols-outlined notranslate text-sm text-primary">
                                                        {quote.group_details.type === 'family' ? 'family_restroom' : 'group'}
                                                    </span>
                                                    <span className="text-xs font-bold uppercase tracking-wide">
                                                        {quote.group_details.type === 'family' ? 'Family Group' : 'Friends Group'}
                                                    </span>
                                                </div>
                                                <p className="text-[10px] text-text-muted pl-6">
                                                    {quote.group_details.type === 'family' ? `${quote.group_details.children || quote.group_details.num_children || 0} Children` : `${quote.group_details.composition || 'Mixed'} group`}
                                                </p>
                                            </div>
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2 text-text-primary">
                                                    <span className="material-symbols-outlined notranslate text-sm text-primary">
                                                        {quote.group_details.has_pets ? 'pets' : 'check_circle'}
                                                    </span>
                                                    <span className="text-xs font-bold uppercase tracking-wide">
                                                        {quote.group_details.has_pets ? 'Traveling with Pets' : 'No Pets'}
                                                    </span>
                                                </div>
                                                <p className="text-[10px] text-text-muted pl-6 italic">
                                                    {quote.group_details.is_couples ? 'Couples only' : 'Qualified stay'}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Reliability Stamp */}
                                        <div className="pt-4 border-t border-border/50 relative overflow-hidden group">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="material-symbols-outlined notranslate text-xs text-emerald-500 font-black">verified</span>
                                                    <span className="text-[10px] font-black text-text-muted uppercase tracking-tighter">Stay Reliability Score</span>
                                                </div>
                                                <span className={`text-[10px] font-black ${
                                                    quote.group_details.type === 'family' ? 'text-emerald-500' : 
                                                    quote.group_details.is_couples ? 'text-primary' : 'text-amber-500'
                                                }`}>
                                                    {quote.group_details.type === 'family' ? '9.8 / 10 - ELITE' : 
                                                     quote.group_details.is_couples ? '8.5 / 10 - HIGH' : '7.0 / 10 - SOLID'}
                                                </span>
                                            </div>
                                            <div className="h-2 w-full bg-background rounded-full overflow-hidden border border-border/30">
                                                <div 
                                                    className={`h-full transition-all duration-1000 ease-out rounded-full ${
                                                        quote.group_details.type === 'family' ? 'w-[98%] bg-emerald-500' : 
                                                        quote.group_details.is_couples ? 'w-[85%] bg-primary' : 'w-[70%] bg-amber-500'
                                                    }`}
                                                />
                                            </div>
                                            <p className="text-[8px] text-text-muted mt-2 text-center uppercase tracking-widest font-bold opacity-60">
                                                Profile matched against historical data for {quote.group_details.type} stays
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="glass-card p-8 border-primary/20 text-center space-y-6">
                            {status === 'pending' ? (
                                <>
                                    <h3 className="text-xl font-bold text-text-primary">Is it available?</h3>
                                    <p className="text-sm text-text-muted">Please confirm if the property is available for these dates.</p>
                                    <div className="space-y-3">
                                        <button 
                                            onClick={handleConfirm}
                                            disabled={processing}
                                            className="w-full py-4 rounded-2xl bg-primary text-background-dark font-black uppercase tracking-widest shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                                        >
                                            <span className="material-symbols-outlined notranslate">check_circle</span>
                                            {processing ? 'Processing...' : 'Yes, Confirmed'}
                                        </button>
                                        <button 
                                            onClick={() => setShowDeclineModal(true)}
                                            disabled={processing}
                                            className="w-full py-4 rounded-2xl bg-surface-2 text-text-muted font-black border border-border uppercase tracking-widest hover:text-red-400 hover:border-red-500/30 transition-all flex items-center justify-center gap-2"
                                        >
                                            <span className="material-symbols-outlined notranslate">cancel</span>
                                            No, Not Available
                                        </button>
                                    </div>
                                </>
                            ) : status === 'awaiting_price' ? (
                                showPriceReview ? (
                                    <div className="space-y-4 text-left">
                                        <h3 className="text-xl font-bold text-text-primary text-center">Review &amp; Confirm</h3>
                                        <p className="text-sm text-text-muted text-center">Please double-check these details before submitting.</p>
                                        <div className="bg-background/60 border border-border rounded-2xl p-4 space-y-2">
                                            <div className="flex justify-between text-sm">
                                                <span className="text-text-muted">Total stay price</span>
                                                <span className="text-text-primary font-black">€{parseFloat(priceInput || 0).toLocaleString()}</span>
                                            </div>
                                            <div className="flex justify-between text-sm">
                                                <span className="text-text-muted">Commission included</span>
                                                <span className="text-text-primary font-bold">
                                                    {commissionIncluded === true ? `Yes — ${commissionPct}%` : 'No'}
                                                </span>
                                            </div>
                                            {priceNotes && (
                                                <div className="pt-2 border-t border-border text-xs">
                                                    <p className="text-text-muted">Notes</p>
                                                    <p className="text-text-primary mt-1 whitespace-pre-wrap">{priceNotes}</p>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => setShowPriceReview(false)}
                                                disabled={processing}
                                                className="flex-1 py-3 rounded-2xl border border-border text-text-muted font-bold uppercase tracking-widest hover:bg-surface-2 transition-all disabled:opacity-50"
                                            >
                                                Back
                                            </button>
                                            <button
                                                onClick={handleSubmitPrice}
                                                disabled={processing}
                                                className="flex-[2] py-3 rounded-2xl bg-primary text-background-dark font-black uppercase tracking-widest shadow-xl shadow-primary/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                                            >
                                                <span className="material-symbols-outlined notranslate">check</span>
                                                {processing ? 'Submitting...' : 'Confirm & Send'}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4 text-left">
                                        <h3 className="text-xl font-bold text-text-primary text-center">Confirm Your Price</h3>
                                        <p className="text-sm text-text-muted text-center">Availability confirmed. Please quote your total price for this period.</p>
                                        <div>
                                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Total stay price (€)</label>
                                            <div className="relative mt-1">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-black text-primary/40">€</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={priceInput}
                                                    onChange={e => setPriceInput(e.target.value)}
                                                    placeholder="Total price"
                                                    className="w-full bg-background border border-border rounded-2xl py-3 pl-9 pr-3 text-lg font-black text-primary outline-none focus:border-primary/60"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1 block">Does this price already include a commission?</label>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => { setCommissionIncluded(true); }}
                                                    className={`py-3 px-3 rounded-2xl border text-[11px] font-black uppercase tracking-widest transition-all ${commissionIncluded === true ? 'bg-primary text-background-dark border-primary' : 'bg-surface border-border text-text-muted hover:border-primary/50'}`}
                                                >
                                                    Yes
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => { setCommissionIncluded(false); setCommissionPct(''); }}
                                                    className={`py-3 px-3 rounded-2xl border text-[11px] font-black uppercase tracking-widest transition-all ${commissionIncluded === false ? 'bg-primary text-background-dark border-primary' : 'bg-surface border-border text-text-muted hover:border-primary/50'}`}
                                                >
                                                    No
                                                </button>
                                            </div>
                                            {commissionIncluded === true && (
                                                <div className="relative mt-2 animate-in slide-in-from-top-2 duration-200">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="99"
                                                        step="0.5"
                                                        value={commissionPct}
                                                        onChange={e => setCommissionPct(e.target.value)}
                                                        placeholder="Commission % included (e.g. 15)"
                                                        className="w-full bg-background border border-primary/40 rounded-2xl py-3 pl-3 pr-9 text-sm font-bold text-primary outline-none focus:border-primary/60"
                                                    />
                                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-lg font-black text-primary/40">%</span>
                                                </div>
                                            )}
                                        </div>
                                        <textarea
                                            value={priceNotes}
                                            onChange={e => setPriceNotes(e.target.value)}
                                            placeholder="Optional notes (cleaning, deposit, etc.)"
                                            className="w-full bg-background border border-border rounded-2xl p-3 text-sm text-text-primary outline-none focus:border-primary/50 h-24 resize-none"
                                        />
                                        <button
                                            onClick={proceedToReview}
                                            className="w-full py-4 rounded-2xl bg-primary text-background-dark font-black uppercase tracking-widest shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                                        >
                                            <span className="material-symbols-outlined notranslate">arrow_forward</span>
                                            Review &amp; Confirm
                                        </button>
                                    </div>
                                )
                            ) : status === 'confirmed' ? (
                                <div className="space-y-4 py-4">
                                    <div className="size-20 bg-emerald-500/20 border-2 border-emerald-500 rounded-full flex items-center justify-center text-emerald-400 mx-auto animate-in zoom-in duration-500">
                                        <span className="material-symbols-outlined notranslate text-4xl">verified</span>
                                    </div>
                                    <h3 className="text-2xl font-black text-emerald-400 uppercase">Availability Confirmed</h3>
                                    <p className="text-sm text-text-muted">Thank you! We have notified the agent and will continue with the booking process.</p>
                                </div>
                            ) : (
                                <div className="space-y-4 py-4">
                                    <div className="size-20 bg-red-500/20 border-2 border-red-500 rounded-full flex items-center justify-center text-red-400 mx-auto animate-in zoom-in duration-500">
                                        <span className="material-symbols-outlined notranslate text-4xl">block</span>
                                    </div>
                                    <h3 className="text-2xl font-black text-red-400 uppercase">Declined</h3>
                                    <p className="text-sm text-text-muted">You have marked these dates as unavailable.</p>
                                    <button onClick={() => setStatus('pending')} className="text-xs font-bold text-primary underline">Change my mind</button>
                                </div>
                            )}
                    </div>
                </div>
            </section>

                {/* Property Description */}
                <section className="space-y-4 px-4">
                    <h2 className="text-xl font-bold text-text-primary flex items-center gap-2 uppercase tracking-widest">
                        <div className="h-5 w-1 bg-primary rounded-full"></div>
                        Request Details for {villa?.villa_name || boat?.boat_name}
                    </h2>
                    <p className="text-text-muted leading-relaxed font-light">
                        This is an official request from Ibiza Beyond. Please ensure your calendar is up to date. Once confirmed, we will send the proposal to the client immediately.
                    </p>
                </section>
            </main>

            {/* Decline Reason Modal */}
            {showDeclineModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-surface border border-border rounded-3xl w-full max-w-md shadow-2xl overflow-hidden p-8 space-y-6">
                        <div>
                            <h2 className="text-xl font-bold text-text-primary tracking-tight">Decline Availability</h2>
                            <p className="text-[10px] text-text-muted uppercase font-black tracking-widest mt-0.5">Please provide a reason</p>
                        </div>
                        
                        <textarea 
                            value={declineReason}
                            onChange={e => setDeclineReason(e.target.value)}
                            placeholder="e.g. Already booked via another platform, property maintenance, etc."
                            className="w-full bg-background border border-border rounded-2xl p-4 text-sm text-text-primary outline-none focus:border-primary/50 h-32 resize-none"
                        />

                        <div className="flex gap-3">
                            <button onClick={() => setShowDeclineModal(false)} className="flex-1 py-3 rounded-xl border border-border text-text-muted font-bold hover:bg-surface-2 transition-all">Cancel</button>
                            <button 
                                onClick={handleDecline}
                                disabled={processing || !declineReason}
                                className="flex-2 py-3 px-6 rounded-xl bg-red-500 text-white font-bold shadow-lg shadow-red-500/20 disabled:opacity-50 transition-all hover:scale-105"
                            >
                                {processing ? 'Decline...' : 'Confirm Decline'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
