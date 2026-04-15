import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import VillaMap from './VillaMap';

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80';

const DEFAULT_B2C_CONTRACT = `# CONTRATTO DI LOCAZIONE TURISTICA ({{agency_name}} ↔ {{client_full_name}})

**1. L'AGENTE / AGENZIA**
- **Nome:** {{agency_name}}
- **Sede:** {{agency_address}}
- **Tax ID:** {{agency_tax_id}}
- **Email:** {{agency_email}} | **Tel:** {{agency_phone}}

**2. IL CONDUTTORE (Ospite)**
- **Nome:** {{client_full_name}}
- **Residenza:** {{client_address}}
- **Documento:** {{client_passport}}
- **Data di nascita:** {{client_dob}}
- **Contatti:** {{client_email}} | {{client_phone}}

### PREMESSO CHE:
L'Agente ha l'autorizzazione a concedere in locazione la Villa **"{{villa_name}}"**, Licenza **{{villa_license}}**. Il Cliente accetta l'infrastruttura di **{{platform_name}}** per il pagamento.

### ART. 1 - OGGETTO E PERIODO
La Villa si trova in **{{villa_address}}**. 
Periodo: dal **{{check_in}}** al **{{check_out}}**.
Max occupanti: **{{max_guests}}**.

### ART. 2 - PREZZO E PAGAMENTI
Prezzo Totale: **{{final_price}}**.
- **Acconto:** {{deposit_percent}}% al momento della prenotazione.
- **Saldo:** {{balance_percent}}% entro {{balance_due_days}} giorni dall'arrivo.

### ART. 3 - DEPOSITO CAUZIONALE
Importo: **{{security_deposit_amount}}**. Sarà sbloccato entro 14 giorni dal check-out previa ispezione.

### ART. 4 - REGOLE E DIVIETI
Vietato organizzare feste o eventi non autorizzati. Rispetto rigoroso dei vicini (22:00-09:00). Penale spazzatura: €150.

### ART. 5 - CANCELLAZIONE
Fino a 60 giorni dall'arrivo: penale del 50%. Successivamente: penale del 100%.

### ART. 6 - RESPONSABILITÀ
La piattaforma {{platform_name}} agisce come solo fornitore tecnologico e non ha responsabilità operativa sulla Villa.

**Luogo e Data:** Ibiza, lì {{today}}
**Firma per Accettazione:** {{client_full_name}} (Firma Digitale)`;

export default function QuotePublicView() {
    const { id } = useParams(); // quote_id
    const [quote, setQuote] = useState(null);
    const [villa, setVilla] = useState(null);
    const [boat, setBoat] = useState(null);
    const [photos, setPhotos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activePhotoIndex, setActivePhotoIndex] = useState(0);
    const [showPhotoModal, setShowPhotoModal] = useState(false);
    const [agent, setAgent] = useState(null);
    const [owner, setOwner] = useState(null);
    const [processingPayment, setProcessingPayment] = useState(false);
    const [paymentSuccess, setPaymentSuccess] = useState(false);
    const [securitySuccess, setSecuritySuccess] = useState(false);
    const [acceptTerms, setAcceptTerms] = useState(false);
    const [showAgreementModal, setShowAgreementModal] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState('card');

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const type = urlParams.get('payment_type');
        if (urlParams.get('success') || type) {
            if (type === 'security_deposit_auth') {
                setSecuritySuccess(true);
            } else {
                setPaymentSuccess(true);
            }
            fetchQuoteData();
        }
        if (urlParams.get('canceled')) {
            alert("Payment was canceled. You can try again whenever you are ready.");
        }
    }, []);

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
                    invenio_properties(*),
                    invenio_boats(*),
                    agents(company_name, logo_url, phone_number, contract_template, boat_contract_template, agent_type, agency_details, email),
                    clients(full_name, email, phone, address, passport_number, dob)
                `)
                .eq('id', id)
                .single();
            
            if (quoteErr) throw quoteErr;
            if (!quoteData) throw new Error('Quote not found');

            setQuote(quoteData);
            setVilla(quoteData.invenio_properties);
            setBoat(quoteData.invenio_boats);
            setAgent(quoteData.agents);

            // Fetch Photos
            let allPhotos = [];
            
            const { data: photoData } = await supabase
                .from('invenio_photos')
                .select('url, thumbnail_url, sort_order')
                .or(`v_uuid.eq.${quoteData.v_uuid || '00000000-0000-0000-0000-000000000000'},boat_uuid.eq.${quoteData.boat_uuid || '00000000-0000-0000-0000-000000000000'}`)
                .order('sort_order', { ascending: true });
            
            if (photoData) allPhotos = [...photoData];

            // Add photos from comma-separated field if it's a boat
            if (quoteData.invenio_boats?.photo_urls) {
                const manualPhotos = quoteData.invenio_boats.photo_urls
                    .split(',')
                    .map(url => url.trim())
                    .filter(url => url.length > 5) // simple check for valid looking URL
                    .map((url, index) => ({
                        url,
                        thumbnail_url: url,
                        sort_order: 1000 + index
                    }));
                allPhotos = [...allPhotos, ...manualPhotos];
            }
            
            setPhotos(allPhotos);

            // Fetch Owner Info
            const ownerId = quoteData.invenio_properties?.owner_id || quoteData.invenio_boats?.owner_id;
            if (ownerId) {
                const { data: ownerData } = await supabase
                    .from('owners')
                    .select('*')
                    .eq('id', ownerId)
                    .single();
                setOwner(ownerData);
            }

        } catch (err) {
            console.error('Fetch error:', err);
            setError(err.message);
        }
    }

    const getProcessedTemplate = () => {
        if (!quote) return 'Loading agreement...';
        
        let content = quote.invenio_boats 
            ? (agent?.boat_contract_template || agent?.contract_template || DEFAULT_B2C_CONTRACT) 
            : (agent?.contract_template || DEFAULT_B2C_CONTRACT);

        if (!content) content = DEFAULT_B2C_CONTRACT;

        const isLastMinute = (() => {
            const checkInDate = new Date(quote.check_in);
            const today = new Date();
            const diffTime = checkInDate.getTime() - today.getTime();
            return Math.round(diffTime / (1000 * 60 * 60 * 24)) <= 49;
        })();

        const data = {
            '{{client_full_name}}': quote.clients?.full_name || 'Valued Client',
            '{{client_email}}': quote.clients?.email || '—',
            '{{client_phone}}': quote.clients?.phone || '—',
            '{{client_address}}': quote.clients?.address || '[To be filled in registration]',
            '{{client_passport}}': quote.clients?.passport_number || '[To be filled in registration]',
            '{{client_dob}}': quote.clients?.dob || '—',
            
            '{{agency_name}}': agent?.company_name || 'Ibiza Beyond',
            '{{agency_address}}': agent?.address || agent?.agency_details || 'Ibiza, Balearic Islands',
            '{{agency_tax_id}}': agent?.tax_id || agent?.agency_details || '—',
            '{{agency_email}}': agent?.email || '—',
            '{{agency_phone}}': agent?.phone_number || '—',

            '{{villa_name}}': quote.invenio_properties?.villa_name || quote.invenio_boats?.boat_name || 'Our Listing',
            '{{villa_license}}': quote.invenio_properties?.license || '—',
            '{{villa_address}}': quote.invenio_properties?.location || 'Ibiza',
            '{{max_guests}}': quote.invenio_properties?.sleeps || quote.invenio_boats?.capacity_day || '—',
            
            '{{boat_name}}': quote.invenio_boats?.boat_name || '',
            '{{platform_name}}': 'Ibiza Beyond',
            '{{today}}': new Date().toLocaleDateString('it-IT'),
            
            '{{check_in}}': quote.check_in ? new Date(quote.check_in).toLocaleDateString('it-IT') : '—',
            '{{check_out}}': quote.check_out ? new Date(quote.check_out).toLocaleDateString('it-IT') : '—',
            '{{final_price}}': parseFloat(quote.final_price || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }),
            '{{deposit_percent}}': isLastMinute ? '100' : '50',
            '{{balance_percent}}': isLastMinute ? '0' : '50',
            '{{balance_due_days}}': '30',
            '{{security_deposit_amount}}': parseFloat(villa?.deposit || boat?.security_deposit || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }),
            '{{security_deposit_due_days}}': '7',

            // Explicit mappings for Italian labels in [BRACKETS]
            '[NOME CLIENTE]': quote.clients?.full_name || 'Valued Client',
            '[NOME AGENTE/SOCIETÀ]': agent?.company_name || 'Ibiza Beyond',
            '[NOME VILLA]': quote.invenio_properties?.villa_name || 'Villa',
            '[DATA CHECK-IN]': quote.check_in ? new Date(quote.check_in).toLocaleDateString('it-IT') : '—',
            '[DATA CHECK-OUT]': quote.check_out ? new Date(quote.check_out).toLocaleDateString('it-IT') : '—',
            '[IMPORTO TOTALE]': parseFloat(quote.final_price || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }),
            '[IMPORTO DEPOSITO]': parseFloat(villa?.deposit || boat?.security_deposit || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }),
            '[NUMERO LICENZA ETV]': quote.invenio_properties?.license || '—',
            '[INDIRIZZO VILLA]': quote.invenio_properties?.location || 'Ibiza',
            '[NOME PIATTAFORMA]': 'Ibiza Beyond'
        };

        let result = content;
        Object.entries(data).forEach(([key, val]) => {
            result = result.split(key).join(val || '');
        });

        return result;
    };

    const handleSign = async () => {
        if (!acceptTerms) {
            alert('Please accept the rental agreement to proceed.');
            return;
        }

        setProcessingPayment(true);
        try {
            const { data, error: functionErr } = await supabase.functions.invoke('documenso-contract', {
                body: { quoteId: id, type: 'guest' }
            });

            if (functionErr) throw functionErr;
            if (data?.signingUrl) {
                window.location.href = data.signingUrl;
            } else {
                throw new Error("Unable to create signing session.");
            }
        } catch (error) {
            console.error('Signing error:', error);
            alert('Error: ' + error.message);
        } finally {
            setProcessingPayment(false);
        }
    };

    const handlePayment = async () => {
        setProcessingPayment(true);
        try {
            const { data, error: functionErr } = await supabase.functions.invoke('stripe-checkout', {
                body: { quoteId: id, type: 'deposit', method: paymentMethod }
            });

            if (functionErr) throw functionErr;
            if (data?.url) {
                window.location.href = data.url;
            } else {
                throw new Error("Unable to create payment session.");
            }
        } catch (error) {
            console.error('Payment error:', error);
            alert('Error: ' + error.message);
        } finally {
            setProcessingPayment(false);
        }
    };

    const handleSecurityDeposit = async () => {
        setProcessingPayment(true);
        try {
            const { data, error: functionErr } = await supabase.functions.invoke('stripe-checkout', {
                body: { quoteId: id, type: 'security_deposit' }
            });

            if (functionErr) throw functionErr;
            if (data?.url) {
                window.location.href = data.url;
            } else {
                throw new Error("Unable to create authorization session.");
            }
        } catch (error) {
            console.error('Security Deposit error:', error);
            alert('Error: ' + error.message);
        } finally {
            setProcessingPayment(false);
        }
    };

    if (loading) return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center space-y-4">
            <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-text-muted font-medium animate-pulse uppercase tracking-widest text-xs">Preparing your luxury experience...</p>
        </div>
    );

    if (error || !quote || (!villa && !boat)) return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8 text-center">
            <h1 className="text-2xl font-bold text-text-primary mb-2">Quote Not Available</h1>
            <p className="text-text-muted max-w-md">{error || "We couldn't retrieve the details for this quote."}</p>
            <a href="/" className="mt-8 text-primary font-bold hover:underline">Return Home</a>
        </div>
    );

    const mainPhoto = photos.length > 0 ? photos[activePhotoIndex].url : FALLBACK_IMG;

    // --- Price & Payment Calculations ---
    const total = parseFloat(quote.final_price || 0);
    const base = parseFloat(quote.supplier_base_price || 0);
    const extrasTotal = (quote.extra_services || []).reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0);
    
    // Check if booking is within 7 weeks (49 days) of check-in
    // Normalize dates to midnight to ensure consistency
    const checkInDate = new Date(quote.check_in);
    checkInDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const diffTime = checkInDate.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    const isLastMinute = diffDays <= 49; // 7 weeks

    const upfrontStayPart = isLastMinute ? base : (base * 0.5);
    const upfront = (total - base) + upfrontStayPart;
    // -------------------------------------

    return (
        <div className="min-h-screen bg-background text-text-secondary font-sans">
            {/* Top Navigation / Brand */}
            <nav className="h-20 border-b border-border flex items-center justify-between px-6 md:px-12 sticky top-0 bg-background/80 backdrop-blur-xl z-50">
                <div className="flex items-center gap-3">
                    {agent?.agent_type === 'collaborator' ? (
                        owner?.logo_url ? (
                            <img src={owner?.logo_url} alt={owner?.company_name || owner?.name} className="h-10 w-auto object-contain" />
                        ) : (
                            <div className="size-10 bg-primary rounded-xl flex items-center justify-center">
                                <span className="material-symbols-outlined notranslate text-background-dark font-black">diamond</span>
                            </div>
                        )
                    ) : agent?.logo_url ? (
                        <img src={agent?.logo_url} alt={agent?.company_name} className="h-10 w-auto object-contain" />
                    ) : (
                        <div className="size-10 bg-primary rounded-xl flex items-center justify-center">
                            <span className="material-symbols-outlined notranslate text-background-dark font-black">diamond</span>
                        </div>
                    )}
                    <div className="flex flex-col">
                        <span className="font-bold text-text-primary tracking-widest text-sm uppercase">
                            {agent?.agent_type === 'collaborator' 
                                ? (owner?.company_name || owner?.name || 'Luxury Villa Collection')
                                : (agent?.company_name || 'Luxury Villa Collection')
                            }
                        </span>
                        {!((agent?.agent_type === 'collaborator' ? owner?.company_name : agent?.company_name)) && (
                            <span className="text-[10px] text-primary/50 font-bold uppercase tracking-[0.2em]">Exclusive Portfolio</span>
                        )}
                    </div>
                </div>
                {agent?.phone_number && (
                    <div className="hidden sm:flex items-center gap-2 text-text-muted">
                        <span className="material-symbols-outlined notranslate text-sm">phone</span>
                        <span className="text-xs font-bold">{agent?.phone_number}</span>
                    </div>
                )}
            </nav>

            <main className="max-w-[1400px] mx-auto p-4 md:p-12 space-y-12 pb-32">
                {/* Hero Section */}
                <section className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                        <div>
                            <h1 className="text-4xl md:text-5xl font-black text-text-primary tracking-tight">
                                {villa?.villa_name || boat?.boat_name}
                            </h1>
                            <div className="flex flex-wrap items-center gap-4 mt-2">
                                <div className="flex items-center gap-2 text-primary font-bold">
                                    <span className="material-symbols-outlined notranslate text-sm">location_on</span>
                                    <span className="text-sm uppercase tracking-widest">
                                        {villa ? (villa.areaname || villa.district) : (boat?.location_base_port || 'Ibiza')}
                                    </span>
                                </div>
                                {villa?.license && (
                                    <div className="flex items-center gap-2 px-3 py-1 bg-surface-2 border border-border rounded-lg">
                                        <span className="text-[10px] font-black text-text-muted uppercase tracking-widest">License:</span>
                                        <span className="text-[10px] font-bold text-text-primary uppercase tracking-widest">{villa?.license}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="hidden md:block text-right">
                            <p className="text-[10px] text-text-muted font-black uppercase tracking-widest mb-1">Presented to</p>
                            <p className="text-xl font-bold text-text-primary">{quote.clients?.full_name || 'Valued Client'}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[400px] md:h-[650px]">
                        {/* Main Image (Left) */}
                        <div className="relative rounded-[2rem] overflow-hidden bg-surface group cursor-pointer shadow-2xl border border-border" onClick={() => { setActivePhotoIndex(0); setShowPhotoModal(true); }}>
                            <img src={mainPhoto} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-[2000ms] ease-out" alt={villa?.villa_name || boat?.boat_name} />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-40 group-hover:opacity-20 transition-opacity"></div>
                            <div className="absolute top-6 right-6 bg-surface-2/80 backdrop-blur-xl border border-white/20 px-4 py-2 rounded-2xl text-text-primary text-xs font-bold flex items-center gap-2 shadow-xl">
                                <span className="material-symbols-outlined notranslate text-[18px]">photo_library</span>
                                {photos.length} Photos
                            </div>
                        </div>

                        {/* 2x2 Grid (Right) */}
                        <div className="hidden lg:grid grid-cols-2 grid-rows-2 gap-4">
                            {photos.slice(1, 5).map((p, i) => (
                                <div 
                                    key={i} 
                                    className="relative rounded-[1.5rem] overflow-hidden bg-surface border border-border cursor-pointer group shadow-lg"
                                    onClick={() => { setActivePhotoIndex(i + 1); setShowPhotoModal(true); }}
                                >
                                    <img src={p.url} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" alt="" />
                                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                    {i === 3 && photos.length > 5 && (
                                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center backdrop-blur-md">
                                            <span className="text-text-primary font-black text-3xl tracking-tighter">+{photos.length - 4}</span>
                                            <span className="text-[10px] text-text-primary/70 uppercase font-black tracking-widest">View Gallery</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-12 items-start">
                    {/* Details Column */}
                    <div className="xl:col-span-2 space-y-12">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {villa ? [
                                { i: 'bed', v: villa.bedrooms, l: 'Bedrooms' },
                                { i: 'shower', v: villa.bathrooms, l: 'Bathrooms' },
                                { i: 'groups', v: villa.sleeps, l: 'Sleeps' },
                                { i: 'straighten', v: villa.district || 'Ibiza', l: 'Area' }
                            ].map((item, i) => (
                                <div key={i} className="glass-card p-6 flex flex-col items-center justify-center text-center space-y-2">
                                    <span className="material-symbols-outlined notranslate text-primary text-3xl">{item.i}</span>
                                    <div>
                                        <p className="text-2xl font-bold text-text-primary">{item.v}</p>
                                        <p className="text-[10px] uppercase font-bold text-text-muted tracking-widest">{item.l}</p>
                                    </div>
                                </div>
                            )) : boat ? [
                                { i: 'directions_boat', v: `${boat.length_m}m`, l: 'Length' },
                                { i: 'groups', v: boat.capacity_day, l: 'Cap. Day' },
                                { i: 'bed', v: boat.cabins || '—', l: 'Cabins' },
                                { i: 'anchor', v: boat.location_base_port || 'Ibiza', l: 'Base Port' }
                            ].map((item, i) => (
                                <div key={i} className="glass-card p-6 flex flex-col items-center justify-center text-center space-y-2">
                                    <span className="material-symbols-outlined notranslate text-primary text-3xl">{item.i}</span>
                                    <div>
                                        <p className="text-2xl font-bold text-text-primary">{item.v}</p>
                                        <p className="text-[10px] uppercase font-bold text-text-muted tracking-widest">{item.l}</p>
                                    </div>
                                </div>
                            )) : null}
                        </div>

                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-text-primary flex items-center gap-3">
                                <div className="h-6 w-1 bg-primary rounded-full"></div>
                                {villa ? 'The Property' : 'The Vessel'}
                            </h2>
                            <div className="text-text-muted leading-relaxed text-lg whitespace-pre-line font-light">
                                {villa?.description || boat?.description}
                            </div>
                        </div>

                        {(villa?.features || boat?.features) && (
                            <div className="space-y-6">
                                <h2 className="text-2xl font-bold text-text-primary flex items-center gap-3">
                                    <div className="h-6 w-1 bg-primary rounded-full"></div>
                                    Amenities & Features
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {(villa?.features || boat?.features || []).map(f => (
                                        <div key={f} className="flex items-center gap-4 group p-2">
                                            <div className="size-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center">
                                                <span className="material-symbols-outlined notranslate text-[18px] text-primary/60">star</span>
                                            </div>
                                            <span className="text-sm font-medium text-text-secondary">{f}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {quote.status === 'booked' || quote.status === 'check_in_ready' || quote.status === 'completed' ? (
                            <div className="bg-primary/5 border border-primary/20 rounded-3xl p-8 md:p-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                                    <div className="space-y-2">
                                        <h2 className="text-2xl font-bold text-text-primary flex items-center gap-3">
                                            <span className="material-symbols-outlined notranslate text-primary">how_to_reg</span>
                                            Guest Registration
                                        </h2>
                                        <p className="text-sm text-text-muted max-w-xl">
                                            {villa 
                                                ? 'As per Spanish Law 4/2015, all travelers staying in holiday rentals must be registered with the authorities prior to arrival.'
                                                : 'Maritime regulations require a manifest of all passengers on board prior to departure.'
                                            }
                                        </p>
                                    </div>
                                    {!quote.guest_form_filled ? (
                                        <button 
                                            onClick={() => window.location.href = `/guest-info/${quote.guest_form_token}`}
                                            className="bg-primary text-background-dark px-8 py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-primary/20 hover:scale-105 transition-all flex items-center gap-3"
                                        >
                                            <span className="material-symbols-outlined notranslate">edit_document</span>
                                            Register Guests
                                        </button>
                                    ) : (
                                        <div className="flex items-center gap-3 text-emerald-400 bg-emerald-500/10 px-6 py-4 rounded-2xl border border-emerald-500/20">
                                            <span className="material-symbols-outlined notranslate">check_circle</span>
                                            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Registration Complete</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : null}

                        {villa?.gps && (
                            <div className="space-y-6">
                                <h2 className="text-2xl font-bold text-text-primary flex items-center gap-3">
                                    <div className="h-6 w-1 bg-primary rounded-full"></div>
                                    {quote.deposit_paid ? 'Precise Location' : 'Indicative Location'}
                                </h2>
                                <div className="rounded-3xl overflow-hidden h-[450px] border border-border relative group shadow-2xl">
                                    <VillaMap locations={[{ gps: villa?.gps, name: villa?.villa_name }]} radius={quote.deposit_paid ? 0 : 2000} />
                                </div>
                                {!quote.deposit_paid && (
                                    <p className="text-[10px] text-text-muted uppercase font-bold tracking-widest text-center mt-2 italic">
                                        Precise address will be revealed once the booking deposit is settled.
                                    </p>
                                )}
                            </div>
                        )}
                        
                        <div className="bg-surface/40 border border-border rounded-3xl p-8 md:p-12">
                            <h2 className="text-2xl font-bold text-text-primary mb-8">{villa ? 'Stay Policies' : 'Charter Policies'}</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                                <div className="space-y-6">
                                    <h3 className="text-xs font-black text-text-muted uppercase tracking-widest border-b border-border pb-2">{villa ? 'House Rules' : 'Boat Rules'}</h3>
                                    <p className="text-sm leading-relaxed text-text-muted">{villa?.house_rules || boat?.policies || "Policy items follow standard luxury guidelines."}</p>
                                </div>
                                <div className="space-y-4">
                                    <h3 className="text-xs font-black text-text-muted uppercase tracking-widest border-b border-border pb-2">Essential Info</h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-[10px] font-bold text-text-muted uppercase tracking-tighter">{villa ? 'Check-in' : 'Boarding'}</p>
                                            <p className="text-sm font-medium text-text-primary">{villa ? '4:00 PM' : (boat?.times_checkin || '10:00 AM')}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-bold text-text-muted uppercase tracking-tighter">{villa ? 'Check-out' : 'Disembark'}</p>
                                            <p className="text-sm font-medium text-text-primary">{villa ? '10:00 AM' : (boat?.times_checkout || '7:00 PM')}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Sidebar */}
                    <aside className="space-y-6 xl:sticky xl:top-32">
                        <div className="glass-card p-10 border-primary/40 relative overflow-hidden bg-gradient-to-br from-primary/5 to-transparent">
                            <div className="relative space-y-8">
                                <div className="text-center pb-6 border-b border-border">
                                    <p className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-2">Quote Summary</p>
                                    <h3 className="text-3xl font-black text-text-primary">Your Proposal</h3>
                                </div>

                                <div className="space-y-6">
                                    <div className="flex items-start gap-4">
                                        <div className="size-10 rounded-xl bg-surface-2 flex items-center justify-center text-primary border border-border">
                                            <span className="material-symbols-outlined notranslate">{villa ? 'calendar_month' : 'directions_boat'}</span>
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-bold text-text-muted uppercase">Reservation Dates</p>
                                            <p className="text-sm font-bold text-text-primary">
                                                {new Date(quote.check_in).toLocaleDateString()} &rarr; {new Date(quote.check_out).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="pt-6 border-t border-border space-y-4">
                                        <p className="text-[10px] font-black text-text-muted uppercase">Payment Schedule</p>
                                        <div className="space-y-4">
                                            {(quote.extra_services || []).length > 0 && (
                                                <div className="space-y-2 mb-4 pb-4 border-b border-border/50">
                                                    <p className="text-[10px] font-black text-text-muted uppercase tracking-widest text-left">Additional Services</p>
                                                    {quote.extra_services.filter(s => parseFloat(s.price) > 0).map((s, idx) => (
                                                        <div key={idx} className="flex justify-between items-center text-[11px]">
                                                            <span className="text-text-secondary font-medium">{s.name}</span>
                                                            <span className="font-bold text-text-primary">€{parseFloat(s.price).toLocaleString()}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            
                                            {/* Payment Method Selector */}
                                            {!quote.deposit_paid && (
                                                <div className="space-y-3 pb-4 border-b border-border/50">
                                                    <p className="text-[10px] font-black text-text-muted uppercase tracking-widest text-left">Select Payment Method</p>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <button 
                                                            onClick={() => setPaymentMethod('card')}
                                                            className={`p-3 rounded-xl border-2 text-left transition-all flex flex-col items-start gap-1 ${paymentMethod === 'card' ? 'border-primary bg-primary/10' : 'border-border bg-surface-2/30 grayscale hover:grayscale-0 hover:border-primary/50'}`}
                                                        >
                                                            <span className="material-symbols-outlined notranslate text-xl text-primary">credit_card</span>
                                                            <div>
                                                                <span className="block text-[10px] font-black text-text-primary uppercase tracking-tight">Credit Card</span>
                                                                <span className="block text-[8px] text-text-muted font-bold">+2% Processing Fee</span>
                                                            </div>
                                                        </button>
                                                        <button 
                                                            onClick={() => setPaymentMethod('bank_transfer')}
                                                            className={`p-3 rounded-xl border-2 text-left transition-all flex flex-col items-start gap-1 ${paymentMethod === 'bank_transfer' ? 'border-primary bg-primary/10' : 'border-border bg-surface-2/30 grayscale hover:grayscale-0 hover:border-primary/50'}`}
                                                        >
                                                            <span className="material-symbols-outlined notranslate text-xl text-primary">account_balance</span>
                                                            <div>
                                                                <span className="block text-[10px] font-black text-text-primary uppercase tracking-tight">Bank Transfer</span>
                                                                <span className="block text-[8px] text-emerald-500 font-bold">No extra fees</span>
                                                            </div>
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                            {/* Step 1: Booking Payment */}
                                            <div className="flex flex-col p-4 bg-primary/10 rounded-2xl border border-primary/20 gap-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="text-left">
                                                        <span className="text-[10px] font-black text-primary uppercase block leading-none mb-1">
                                                            {isLastMinute ? 'Full Payment (Last Minute Booking)' : '1st Payment (Confirm Booking)'}
                                                        </span>
                                                        <span className="text-[8px] text-text-muted font-bold uppercase tracking-widest">
                                                            {isLastMinute ? 'Required for stays within 7 weeks' : 'Due Today'}
                                                        </span>
                                                    </div>
                                                    <span className="font-black text-primary text-xl">€{upfront.toLocaleString()}</span>
                                                </div>
                                                {paymentMethod === 'card' && !quote.deposit_paid && (
                                                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-primary/10">
                                                        <span className="text-text-muted font-bold">Credit Card Fee (2%)</span>
                                                        <span className="font-bold text-text-primary">€{(upfront * 0.02).toLocaleString()}</span>
                                                    </div>
                                                )}
                                                {paymentMethod === 'card' && !quote.deposit_paid && (
                                                    <div className="flex items-center justify-between pt-1">
                                                        <span className="text-[10px] font-black text-text-primary uppercase">Total Due Today</span>
                                                        <span className="font-black text-primary text-xl">€{(upfront * 1.02).toLocaleString()}</span>
                                                    </div>
                                                )}
                                            </div>
                                            {/* Step 2: Final Balance */}
                                            {!isLastMinute && (
                                                <div className="flex items-center justify-between p-4 bg-surface-2/30 rounded-2xl border border-border">
                                                    <div className="text-left">
                                                        <span className="text-[10px] font-bold text-text-primary uppercase block leading-none mb-1">2nd Payment (Final Balance)</span>
                                                        <span className="text-[8px] text-text-muted font-bold uppercase tracking-widest">
                                                            Due {(() => {
                                                                const checkIn = new Date(quote.check_in);
                                                                const due = new Date(checkIn);
                                                                due.setDate(due.getDate() - 30);
                                                                return due.toLocaleDateString();
                                                            })()} (30 days before stay)
                                                        </span>
                                                    </div>
                                                    <span className="font-bold text-text-secondary text-lg">€{(total - upfront).toLocaleString()}</span>
                                                </div>
                                            )}
                                            {/* Step 3: Security Deposit */}
                                            <div className="flex items-center justify-between p-4 bg-surface-2/30 rounded-2xl border border-border border-dashed">
                                                <div className="text-left">
                                                    <span className="text-[10px] font-bold text-text-primary uppercase block leading-none mb-1">Refundable Security Deposit</span>
                                                    <span className="text-[8px] text-text-muted font-bold uppercase tracking-widest italic">Authorized (Frozen) On Arrival</span>
                                                </div>
                                                <span className="font-bold text-text-secondary text-lg">€{parseFloat(villa?.deposit || boat?.security_deposit || 0).toLocaleString()}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="text-center pt-6">
                                        <p className="text-3xl font-black text-primary mb-4">
                                             €{paymentMethod === 'card' && !quote.deposit_paid ? (parseFloat(quote.final_price) + (upfront * 0.02)).toLocaleString() : parseFloat(quote.final_price).toLocaleString()}
                                        </p>
                                        <p className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] -mt-2 mb-6">Total Reservation Value</p>
                                        
                                        {/* Terms & Conditions Checkbox */}
                                        <div className="flex items-start gap-3 text-left bg-primary/5 p-4 rounded-2xl border border-primary/10 mb-6">
                                            <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-1 w-5 h-5 rounded accent-primary" id="agree" />
                                            <label htmlFor="agree" className="text-[10px] font-medium text-text-muted leading-relaxed cursor-pointer">
                                                I have read and accept the <button onClick={() => setShowAgreementModal(true)} className="text-primary font-bold underline">Rental Agreement & Terms</button>. By proceeding with payment I confirm that this constitutes a legally binding digital signature of the contract.
                                            </label>
                                        </div>

                                        {/* Status Messaging & Payment Flow */}
                                        {!quote.deposit_paid ? (
                                            quote.status === 'sent' ? (
                                                <div className="space-y-3">
                                                    <button 
                                                        onClick={handlePayment}
                                                        disabled={processingPayment || !acceptTerms}
                                                        className={`w-full py-5 rounded-2xl font-black uppercase tracking-widest transition-all ${acceptTerms ? 'bg-primary text-background-dark shadow-xl shadow-primary/20 hover:scale-105' : 'bg-surface-2 text-text-muted grayscale cursor-not-allowed'}`}
                                                    >
                                                        {processingPayment ? "Redirecting to Stripe..." : (isLastMinute ? "Confirm & Pay Full Amount" : "Confirm & Pay Deposit")}
                                                    </button>
                                                    {!acceptTerms && (
                                                        <p className="text-[9px] text-text-muted font-bold uppercase tracking-widest text-center animate-pulse">
                                                            Accept the agreement above to proceed
                                                        </p>
                                                    )}
                                                </div>
                                            ) : quote.status === 'waiting_owner' ? (
                                                <div className="bg-amber-500/5 border border-amber-500/10 p-6 rounded-2xl space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
                                                    <div className="flex justify-center">
                                                        <div className="size-16 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 relative">
                                                            <span className="material-symbols-outlined notranslate text-3xl">hourglass_empty</span>
                                                            <div className="absolute inset-0 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin"></div>
                                                        </div>
                                                    </div>
                                                    <div className="text-center space-y-2">
                                                        <p className="text-[12px] font-black uppercase text-amber-500 tracking-[0.2em]">Verifying Availability</p>
                                                        <p className="text-[10px] text-text-muted leading-relaxed max-w-[240px] mx-auto font-medium">
                                                            The owner has been notified and is currently verifying the schedule for your stay. 
                                                            <span className="block mt-2 text-primary">The booking option will be enabled immediately upon confirmation.</span>
                                                        </p>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="bg-surface-2 p-6 rounded-2xl border border-border text-center grayscale opacity-60">
                                                    <span className="material-symbols-outlined notranslate text-text-muted text-2xl mb-2">pending_actions</span>
                                                    <p className="text-[10px] font-black text-text-muted uppercase tracking-widest">Proposal Under Review</p>
                                                    <p className="text-[9px] text-text-muted mt-1">This quote is currently being finalized by our agents.</p>
                                                </div>
                                            )
                                        ) : (
                                            <div className="space-y-3">
                                                <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-2xl flex items-center justify-center gap-3 text-emerald-400">
                                                    <span className="material-symbols-outlined notranslate text-sm font-black">check_circle</span>
                                                    <span className="text-[10px] font-black uppercase tracking-widest">Deposit Paid · Agreement Signed</span>
                                                </div>
                                                
                                                {!quote.security_deposit_authorized ? (
                                                    <div className="space-y-4">
                                                        <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10 space-y-2">
                                                            <div className="flex items-center gap-2 text-amber-500">
                                                                <span className="material-symbols-outlined notranslate text-[18px]">security</span>
                                                                <span className="text-[10px] font-black uppercase tracking-widest">Required Step</span>
                                                            </div>
                                                            <p className="text-[10px] text-text-muted leading-relaxed">
                                                                A security deposit of <span className="text-text-primary font-bold">€{parseFloat(villa?.deposit || boat?.security_deposit || 0).toLocaleString()}</span> is required to finalize booking. 
                                                                Funds will be <span className="text-amber-500 font-bold italic underline">authorized only (frozen)</span> and released after {villa ? 'checkout' : 'charter'} if no damage occurs.
                                                            </p>
                                                        </div>
                                                        <button 
                                                            onClick={handleSecurityDeposit}
                                                            disabled={processingPayment}
                                                            className="w-full py-5 rounded-2xl font-black uppercase tracking-widest bg-white/10 text-text-primary hover:bg-white/20 border border-white/10 shadow-xl transition-all hover:scale-105"
                                                        >
                                                            {processingPayment ? "Connecting..." : "2. Freeze Security Deposit"}
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="bg-emerald-500/20 border-2 border-emerald-500 p-5 rounded-2xl flex flex-col items-center gap-2 text-emerald-400 animate-in zoom-in-95 duration-500 shadow-[0_0_30px_rgba(16,185,129,0.3)]">
                                                        <span className="material-symbols-outlined notranslate text-4xl">verified</span>
                                                        <span className="text-[11px] font-black uppercase tracking-[0.2em]">All Steps Complete</span>
                                                        <p className="text-[9px] text-emerald-400/80 font-bold uppercase text-center mt-1">
                                                            Your stay is fully secured. Welcome to Ibiza!
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </aside>
                </div>
            </main>

            {/* Agreement Modal */}
            {showAgreementModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
                    <div className="bg-background rounded-3xl max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl p-8 md:p-12 border border-border">
                        <div className="flex justify-between items-center mb-8">
                            <h2 className="text-2xl font-black uppercase text-text-primary">Rental Agreement</h2>
                            <button onClick={() => setShowAgreementModal(false)} className="bg-surface-2 p-2 rounded-full"><span className="material-symbols-outlined notranslate">close</span></button>
                        </div>
                        <div className="prose text-text-muted bg-surface/50 p-8 rounded-2xl whitespace-pre-line italic font-serif leading-relaxed border border-border/50">
                            {getProcessedTemplate()}
                        </div>
                        <button onClick={() => { setAcceptTerms(true); setShowAgreementModal(false); }} className="w-full mt-8 bg-primary text-background-dark py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl">Accept Agreement</button>
                    </div>
                </div>
            )}

                    {/* Immersive Photo Modal */}
                    {showPhotoModal && (
                        <div className="fixed inset-0 z-[100] flex flex-col bg-black/98 backdrop-blur-2xl animate-in fade-in duration-300 select-none">
                            {/* Top Bar */}
                            <div className="p-6 flex justify-between items-center z-10 bg-gradient-to-b from-black/50 to-transparent">
                                <div className="flex flex-col">
                                    <span className="text-text-primary font-bold text-sm tracking-tight">{villa?.villa_name || boat?.boat_name}</span>
                                    <span className="text-primary/50 text-[10px] font-black uppercase tracking-[0.2em]">{activePhotoIndex + 1} / {photos.length}</span>
                                </div>
                                <button 
                                    onClick={() => setShowPhotoModal(false)} 
                                    className="size-12 rounded-full bg-surface-2/20 border border-white/10 flex items-center justify-center text-text-primary hover:bg-white/20 transition-all hover:scale-110 active:scale-95 shadow-xl"
                                >
                                    <span className="material-symbols-outlined notranslate">close</span>
                                </button>
                            </div>

                            {/* Main Viewport */}
                            <div className="flex-1 relative flex items-center justify-center p-4 overflow-hidden">
                                {/* Navigation Arrows */}
                                <button 
                                    className="absolute left-4 md:left-8 z-20 size-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-text-primary hover:bg-white/20 disabled:opacity-0 transition-all hover:scale-110 active:scale-90 shadow-2xl backdrop-blur-md"
                                    disabled={activePhotoIndex === 0}
                                    onClick={(e) => { e.stopPropagation(); setActivePhotoIndex(p => p - 1); }}
                                >
                                    <span className="material-symbols-outlined notranslate text-4xl font-light">chevron_left</span>
                                </button>

                        <div className="w-full h-full flex items-center justify-center">
                            <img 
                                key={activePhotoIndex}
                                src={photos[activePhotoIndex]?.url} 
                                className="max-w-full max-h-full object-contain rounded-lg shadow-[0_0_100px_rgba(0,0,0,0.8)] animate-in fade-in zoom-in-95 duration-500" 
                                alt="" 
                            />
                        </div>

                        <button 
                            className="absolute right-4 md:right-8 z-20 size-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-text-primary hover:bg-white/20 disabled:opacity-0 transition-all hover:scale-110 active:scale-90 shadow-2xl backdrop-blur-md"
                            disabled={activePhotoIndex === photos.length - 1}
                            onClick={(e) => { e.stopPropagation(); setActivePhotoIndex(p => p + 1); }}
                        >
                            <span className="material-symbols-outlined notranslate text-4xl font-light">chevron_right</span>
                        </button>
                    </div>

                        {/* Thumbnail Strip */}
                        <div className="p-8 flex gap-3 overflow-x-auto pb-6 justify-center items-center bg-gradient-to-t from-black/50 to-transparent">
                        <div className="flex gap-2 mx-auto">
                            {photos.slice(0, 15).map((p, i) => (
                                <div 
                                    key={i} 
                                    className={`size-16 flex-shrink-0 rounded-xl overflow-hidden cursor-pointer transition-all duration-300 ${activePhotoIndex === i ? 'ring-2 ring-primary ring-offset-4 ring-offset-black scale-110 opacity-100 shadow-xl' : 'opacity-30 hover:opacity-100 grayscale hover:grayscale-0'}`}
                                    onClick={(e) => { e.stopPropagation(); setActivePhotoIndex(i); }}
                                >
                                    <img src={p.url} className="w-full h-full object-cover" alt="" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
