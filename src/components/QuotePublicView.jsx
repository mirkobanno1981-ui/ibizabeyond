import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fetchICal, parseICal, getBlockedDates } from '../lib/calendar';

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80';

export default function QuotePublicView() {
    const { id } = useParams(); // quote_id
    const [quote, setQuote] = useState(null);
    const [villa, setVilla] = useState(null);
    const [photos, setPhotos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activePhotoIndex, setActivePhotoIndex] = useState(0);
    const [showPhotoModal, setShowPhotoModal] = useState(false);
    const [agent, setAgent] = useState(null);

    useEffect(() => {
        if (id) fetchQuoteData();
    }, [id]);

    async function fetchQuoteData() {
        setLoading(true);
        try {
            // 1. Fetch Quote
            const { data: quoteData, error: quoteErr } = await supabase
                .from('quotes')
                .select(`
                    *,
                    invenio_properties(*)
                `)
                .eq('id', id)
                .single();
            
            if (quoteErr) throw quoteErr;
            if (!quoteData) throw new Error('Quote not found');

            setQuote(quoteData);
            setVilla(quoteData.invenio_properties);

            // 2. Fetch Photos
            const { data: photoData } = await supabase
                .from('invenio_photos')
                .select('url, thumbnail_url, sort_order')
                .eq('v_uuid', quoteData.v_uuid)
                .order('sort_order', { ascending: true });
            
            setPhotos(photoData || []);

            // 3. Fetch Agent Info
            if (quoteData.agent_id) {
                const { data: agentData } = await supabase
                    .from('agents')
                    .select('*')
                    .eq('id', quoteData.agent_id)
                    .single();
                setAgent(agentData);
            }

        } catch (err) {
            console.error('Error fetching public quote:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    if (loading) return (
        <div className="min-h-screen bg-background-dark flex flex-col items-center justify-center space-y-4">
            <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-slate-500 font-medium animate-pulse uppercase tracking-widest text-xs">Preparing your luxury experience...</p>
        </div>
    );

    if (error || !quote || !villa) return (
        <div className="min-h-screen bg-background-dark flex flex-col items-center justify-center p-8 text-center">
            <div className="size-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
                <span className="material-symbols-outlined text-slate-500 text-4xl">error</span>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Quote Not Available</h1>
            <p className="text-slate-400 max-w-md">We couldn't retrieve the details for this quote. It may have expired or the link is incorrect.</p>
            <a href="/" className="mt-8 text-primary font-bold hover:underline">Return Home</a>
        </div>
    );

    const mainPhoto = photos.length > 0 ? photos[activePhotoIndex].url : FALLBACK_IMG;

    return (
        <div className="min-h-screen bg-background-dark text-slate-300 font-sans">
            {/* Top Navigation / Brand */}
            <nav className="h-20 border-b border-white/5 flex items-center justify-between px-6 md:px-12 sticky top-0 bg-background-dark/80 backdrop-blur-xl z-50">
                <div className="flex items-center gap-3">
                    {agent?.logo_url ? (
                        <img src={agent.logo_url} alt={agent.company_name} className="h-10 w-auto object-contain" />
                    ) : (
                        <div className="size-10 bg-primary rounded-xl flex items-center justify-center">
                            <span className="material-symbols-outlined text-background-dark font-black">diamond</span>
                        </div>
                    )}
                    <div className="flex flex-col">
                        <span className="font-bold text-white tracking-widest text-sm uppercase">
                            {agent?.company_name || 'Ibiza Beyond'}
                        </span>
                        {!agent?.company_name && <span className="text-[10px] text-primary/50 font-bold uppercase tracking-[0.2em]">Luxury Rentals</span>}
                    </div>
                </div>
                {agent?.phone_number && (
                    <div className="hidden sm:flex items-center gap-2 text-slate-400">
                        <span className="material-symbols-outlined text-sm">phone</span>
                        <span className="text-xs font-bold">{agent.phone_number}</span>
                    </div>
                )}
            </nav>

            <main className="max-w-[1400px] mx-auto p-4 md:p-12 space-y-12 pb-32">
                
                {/* Hero Section / Gallery */}
                <section className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                        <div>
                            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight">{villa.villa_name}</h1>
                            <div className="flex items-center gap-2 mt-2 text-primary font-bold">
                                <span className="material-symbols-outlined text-sm">location_on</span>
                                <span className="text-sm uppercase tracking-widest">{villa.areaname || villa.district || 'Ibiza'}</span>
                            </div>
                        </div>
                        <div className="hidden md:block text-right">
                            <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Presented to</p>
                            <p className="text-xl font-bold text-white">{quote.client_name || 'Valued Client'}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[400px] md:h-[650px]">
                        <div className="lg:col-span-3 relative rounded-3xl overflow-hidden bg-surface-dark group cursor-pointer" onClick={() => setShowPhotoModal(true)}>
                            <img src={mainPhoto} className="w-full h-full object-cover" alt={villa.villa_name} />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60"></div>
                            <div className="absolute bottom-10 left-10 text-white">
                                <p className="text-lg italic font-serif text-slate-200">"{villa.tagline || 'Experience the ultimate Ibiza getaway'}"</p>
                            </div>
                            <div className="absolute top-6 right-6 bg-white/10 backdrop-blur-md border border-white/20 px-4 py-2 rounded-2xl text-white text-xs font-bold flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">photo_library</span>
                                {photos.length} Photos
                            </div>
                        </div>
                        <div className="hidden lg:flex flex-col gap-4">
                            {photos.slice(1, 4).map((ph, idx) => (
                                <div key={idx} className="flex-1 rounded-3xl overflow-hidden bg-surface-dark relative border border-white/5 cursor-pointer group" onClick={() => { setActivePhotoIndex(idx + 1); setShowPhotoModal(true); }}>
                                    <img src={ph.url} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="" />
                                    {idx === 2 && photos.length > 4 && (
                                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                            <span className="text-white font-bold text-2xl">+{photos.length - 4}</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-12 items-start">
                    
                    {/* LEFT Column: Details */}
                    <div className="xl:col-span-2 space-y-12">
                        
                        {/* Summary Info */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="glass-card p-6 flex flex-col items-center justify-center text-center space-y-2">
                                <span className="material-symbols-outlined text-primary text-3xl">bed</span>
                                <div>
                                    <p className="text-2xl font-bold text-white">{villa.bedrooms}</p>
                                    <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Bedrooms</p>
                                </div>
                            </div>
                            <div className="glass-card p-6 flex flex-col items-center justify-center text-center space-y-2">
                                <span className="material-symbols-outlined text-primary text-3xl">shower</span>
                                <div>
                                    <p className="text-2xl font-bold text-white">{villa.bathrooms}</p>
                                    <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Bathrooms</p>
                                </div>
                            </div>
                            <div className="glass-card p-6 flex flex-col items-center justify-center text-center space-y-2">
                                <span className="material-symbols-outlined text-primary text-3xl">groups</span>
                                <div>
                                    <p className="text-2xl font-bold text-white">{villa.sleeps}</p>
                                    <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Sleeps</p>
                                </div>
                            </div>
                            <div className="glass-card p-6 flex flex-col items-center justify-center text-center space-y-2 border-primary/20 bg-primary/2">
                                <span className="material-symbols-outlined text-primary text-3xl">straighten</span>
                                <div>
                                    <p className="text-2xl font-bold text-white">{villa.district || 'Ibiza'}</p>
                                    <p className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Area</p>
                                </div>
                            </div>
                        </div>

                        {/* Description */}
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                                <div className="h-6 w-1 bg-primary rounded-full"></div>
                                The Property
                            </h2>
                            <div className="text-slate-400 leading-relaxed text-lg whitespace-pre-line font-light">
                                {villa.description || "A masterfully designed villa in the heart of Ibiza, offering total privacy and world-class luxury."}
                            </div>
                        </div>

                        {/* Features / Highlights */}
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                                <div className="h-6 w-1 bg-primary rounded-full"></div>
                                Amenities & Features
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {(Array.isArray(villa.features) ? villa.features : []).map(f => (
                                    <div key={f} className="flex items-center gap-4 group p-2 hover:translate-x-1 transition-transform">
                                        <div className="size-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-primary/10 group-hover:border-primary/20 transition-all">
                                            <span className="material-symbols-outlined text-[18px] text-primary/60 group-hover:text-primary transition-colors">star</span>
                                        </div>
                                        <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">{f}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Rules / Stay Info */}
                        <div className="bg-surface-dark/40 border border-white/5 rounded-3xl p-8 md:p-12">
                            <h2 className="text-2xl font-bold text-white mb-8">Stay Policies</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                                <div className="space-y-6">
                                    <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest border-b border-white/5 pb-2">House Rules</h3>
                                    <p className="text-sm leading-relaxed text-slate-400">
                                        {villa.house_rules || "This property is dedicated to refined enjoyment. We ask guests to respect the neighbors, avoid unauthorized events, and treat the villa as their home."}
                                    </p>
                                </div>
                                <div className="space-y-4">
                                    <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest border-b border-white/5 pb-2">Essential Info</h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-tighter">Check-in</p>
                                            <p className="text-sm font-medium text-white">4:00 PM</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-tighter">Check-out</p>
                                            <p className="text-sm font-medium text-white">10:00 AM</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-tighter">Short Stays</p>
                                            <p className="text-sm font-medium text-white capitalize">{villa.allow_shortstays || 'No'}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-tighter">Deposit</p>
                                            <p className="text-sm font-medium text-white">€{parseFloat(villa.deposit || 0).toLocaleString()}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT Column: Quote Sidebar */}
                    <aside className="space-y-6 xl:sticky xl:top-32">
                        <div className="glass-card p-10 border-primary/40 relative overflow-hidden bg-gradient-to-br from-primary/5 to-transparent">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
                            
                            <div className="relative space-y-8">
                                <div className="text-center pb-6 border-b border-white/5">
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Quote Summary</p>
                                    <h3 className="text-3xl font-black text-white">Your Proposal</h3>
                                </div>

                                <div className="space-y-6">
                                    <div className="flex items-start gap-4">
                                        <div className="size-10 rounded-xl bg-white/5 flex items-center justify-center text-primary border border-white/10 flex-shrink-0">
                                            <span className="material-symbols-outlined text-[20px]">calendar_month</span>
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Reservation Dates</p>
                                            <p className="text-sm font-bold text-white flex items-center gap-2">
                                                {new Date(quote.check_in).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                                <span className="material-symbols-outlined text-[14px] text-primary/40">arrow_forward</span>
                                                {new Date(quote.check_out).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                            </p>
                                            <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider font-medium">1 week • 7 nights</p>
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-4">
                                        <div className="size-10 rounded-xl bg-white/5 flex items-center justify-center text-primary border border-white/10 flex-shrink-0">
                                            <span className="material-symbols-outlined text-[20px]">groups</span>
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Guest Capacity</p>
                                            <p className="text-sm font-bold text-white uppercase tracking-wider">Up to {villa.sleeps} guests</p>
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-4">
                                        <div className="size-10 rounded-xl bg-white/5 flex items-center justify-center text-primary border border-white/10 flex-shrink-0">
                                            <span className="material-symbols-outlined text-[20px]">shield_check</span>
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Quote Price</p>
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-3xl font-black text-primary">€{parseFloat(quote.final_price).toLocaleString()}</span>
                                            </div>
                                            <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider font-medium">All taxes included</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-8 pt-10 border-t border-white/5 flex flex-col gap-3">
                                    <button className="btn-primary w-full py-5 text-sm font-black uppercase tracking-widest shadow-2xl shadow-primary/20 hover:scale-[1.02] transition-all">
                                        Request To Book
                                    </button>
                                    <p className="text-[9px] text-center text-slate-600 font-bold uppercase tracking-widest mt-2">No payment required at this stage</p>
                                </div>
                            </div>
                        </div>

                        <div className="glass-card p-6 border-white/5 text-center space-y-3">
                            <p className="text-xs text-slate-500 font-medium tracking-tight">Need help with your reservation?</p>
                            {agent?.phone_number && (
                                <a href={`tel:${agent.phone_number}`} className="block text-white font-black text-lg hover:text-primary transition-colors">{agent.phone_number}</a>
                            )}
                            <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">Available for you anytime</p>
                        </div>
                    </aside>
                </div>
            </main>

            {/* Photo Modal - Reused from VillaView */}
            {showPhotoModal && (
                <div className="fixed inset-0 z-[100] flex flex-col bg-black animate-in fade-in duration-300">
                    <div className="p-4 md:p-8 flex justify-between items-center text-white">
                        <span className="font-bold text-xs uppercase tracking-widest">{villa.villa_name} — {activePhotoIndex + 1} / {photos.length}</span>
                        <button onClick={() => setShowPhotoModal(false)} className="size-12 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>
                    <div className="flex-1 relative flex items-center justify-center p-4">
                         <button 
                            className="absolute left-4 md:left-8 size-14 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 disabled:opacity-20"
                            disabled={activePhotoIndex === 0}
                            onClick={() => setActivePhotoIndex(p => p - 1)}
                        >
                            <span className="material-symbols-outlined text-3xl">chevron_left</span>
                        </button>
                        <img 
                            src={photos[activePhotoIndex]?.url} 
                            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl animate-in zoom-in duration-500" 
                            alt="" 
                        />
                        <button 
                            className="absolute right-4 md:right-8 size-14 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 disabled:opacity-20"
                            disabled={activePhotoIndex === photos.length - 1}
                            onClick={() => setActivePhotoIndex(p => p + 1)}
                        >
                            <span className="material-symbols-outlined text-3xl">chevron_right</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Footer */}
            <footer className="border-t border-white/5 p-8 md:p-16 text-center text-slate-600 space-y-6">
                <div className="flex flex-col items-center gap-4">
                    {agent?.logo_url ? (
                        <img src={agent.logo_url} alt={agent.company_name} className="h-8 w-auto grayscale opacity-50" />
                    ) : (
                        <span className="material-symbols-outlined text-primary/30 text-3xl">diamond</span>
                    )}
                    <p className="text-xs uppercase font-black tracking-[0.3em] text-slate-500">{agent?.company_name || 'Ibiza Beyond Luxury Rentals'}</p>
                </div>
                
                <p className="text-[11px] font-medium max-w-2xl mx-auto leading-relaxed text-slate-600 italic">
                    {agent?.agency_details || "We offer the most exclusive villa collection on the island. All our properties are personally vetted and maintained to the highest luxury standards."}
                </p>

                <div className="pt-8 flex flex-col items-center gap-2">
                    <p className="text-[9px] uppercase tracking-widest font-bold text-slate-700">© {new Date().getFullYear()} {agent?.company_name || 'Ibiza Beyond'} — All Rights Reserved</p>
                </div>
            </footer>
        </div>
    );
}
