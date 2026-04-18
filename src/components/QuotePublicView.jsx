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
    const [multiQuotes, setMultiQuotes] = useState([]);
    const [qPhotosMap, setQPhotosMap] = useState({});
    const [activeQuoteIndex, setActiveQuoteIndex] = useState(0);
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
    }, [id, activeQuoteIndex]);

    async function fetchQuoteData() {
        if (!id) return;
        setLoading(true);
        try {
            const ids = id.split(',');
            
            let query = supabase
                .from('quotes')
                .select(`
                    *,
                    invenio_properties(*),
                    invenio_boats(*),
                    agents(company_name, logo_url, phone_number, contract_template, boat_contract_template, agent_type, agency_details),
                    clients(full_name, email, phone_number, address_street, id_number, dob)
                `);
            
            if (ids.length > 1) {
                query = query.in('id', ids);
            } else {
                query = query.eq('id', id);
            }

            const { data: quotesData, error: quoteErr } = await query;
            
            if (quoteErr) throw quoteErr;
            if (!quotesData || quotesData.length === 0) throw new Error('Quote not found');

            // Fetch Photos for ALL quotes
            const vUuids = quotesData.map(q => q.v_uuid).filter(Boolean);
            const bUuids = quotesData.map(q => q.boat_uuid).filter(Boolean);
            
            let allPhotoData = [];
            if (vUuids.length > 0 || bUuids.length > 0) {
                const filters = [];
                if (vUuids.length > 0) filters.push(`v_uuid.in.(${vUuids.join(',')})`);
                if (bUuids.length > 0) filters.push(`boat_uuid.in.(${bUuids.join(',')})`);
                
                const { data } = await supabase
                    .from('invenio_photos')
                    .select('*')
                    .or(filters.join(','))
                    .order('sort_order', { ascending: true });
                allPhotoData = data || [];
            }

            const photosMap = {};
            quotesData.forEach(q => {
                const qPhotos = (allPhotoData || []).filter(p => 
                    (q.v_uuid && p.v_uuid === q.v_uuid) || 
                    (q.boat_uuid && p.boat_uuid === q.boat_uuid)
                );
                
                // Add manual boat photos if any
                if (q.invenio_boats?.photo_urls) {
                    const manual = q.invenio_boats.photo_urls.split(',')
                        .map(url => ({ url: url.trim(), thumbnail_url: url.trim(), sort_order: 1000 }));
                    qPhotos.push(...manual);
                }
                
                photosMap[q.id] = qPhotos;
            });

            setQPhotosMap(photosMap);
            setMultiQuotes(quotesData);
            
            const currentQuote = quotesData[activeQuoteIndex] || quotesData[0];
            setQuote(currentQuote);
            setVilla(currentQuote.invenio_properties);
            setBoat(currentQuote.invenio_boats);
            setAgent(currentQuote.agents);
            setPhotos(photosMap[currentQuote.id] || []);

            // Fetch Owner Info for the first one (or all?)
            const ownerId = currentQuote.invenio_properties?.owner_id || currentQuote.invenio_boats?.owner_id;
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
        } finally {
            setLoading(false);
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
            '{{client_phone}}': quote.clients?.phone_number || '—',
            '{{client_address}}': quote.clients?.address_street || '[To be filled in registration]',
            '{{client_passport}}': quote.clients?.id_number || '[To be filled in registration]',
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

        console.log('Processed template length:', result?.length);
        return result || "ERROR: Rental Agreement content could not be generated. Please refresh or contact support.";
    };

    const handleContractSigning = async (targetId = id) => {
        if (!acceptTerms) {
            alert('Please accept the rental agreement to proceed.');
            return;
        }
        const actualId = targetId.includes(',') ? multiQuotes[activeQuoteIndex]?.id : targetId;
        
        setProcessingPayment(true);
        try {
            const { data, error: functionErr } = await supabase.functions.invoke('documenso-contract', {
                body: { quoteId: actualId, type: 'guest' }
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

    const handlePayment = async (targetId = id) => {
        const actualId = targetId.includes(',') ? multiQuotes[activeQuoteIndex]?.id : targetId;
        
        setProcessingPayment(true);
        try {
            const { data, error: functionErr } = await supabase.functions.invoke('stripe-checkout', {
                body: { quoteId: actualId, type: 'deposit', method: paymentMethod }
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

    const handleSecurityDeposit = async (targetId = id) => {
        const actualId = targetId.includes(',') ? multiQuotes[activeQuoteIndex]?.id : targetId;
        
        setProcessingPayment(true);
        try {
            const { data, error: functionErr } = await supabase.functions.invoke('stripe-checkout', {
                body: { quoteId: actualId, type: 'security_deposit' }
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
                            <img src={owner.logo_url} alt={owner.company_name || owner.name} className="h-10 w-auto object-contain" />
                        ) : (
                            <div className="size-10 bg-primary rounded-xl flex items-center justify-center">
                                <span className="material-symbols-outlined notranslate text-background-dark font-black">diamond</span>
                            </div>
                        )
                    ) : agent?.logo_url ? (
                        <img src={agent.logo_url} alt={agent.company_name} className="h-10 w-auto object-contain" />
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
                        <span className="text-xs font-bold">{agent.phone_number}</span>
                    </div>
                )}
            </nav>

            <main className="max-w-[1440px] mx-auto p-4 md:p-12 space-y-32 pb-32">
                {/* Unified Welcome Header */}
                <header className="text-center space-y-6 pt-8 pb-12 animate-in fade-in zoom-in duration-1000">
                    <div className="inline-flex items-center gap-3 px-6 py-2 rounded-full border border-primary/30 bg-primary/5 text-primary text-[10px] font-black uppercase tracking-[0.3em]">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                        </span>
                        Exclusive Proposal
                    </div>
                    <h1 className="text-5xl md:text-7xl font-black text-text-primary tracking-tighter leading-[0.9]">
                        Your Personalized<br/>
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-primary-light to-primary/50">Ibiza Experience</span>
                    </h1>
                    <p className="text-text-muted max-w-2xl mx-auto text-sm md:text-lg font-medium leading-relaxed">
                        Hello {quote.clients?.full_name || 'Valued Client'}, we have curated a selection of the finest properties and vessels for your stay in Ibiza. Below you will find all the details to help you choose your ideal match.
                    </p>
                </header>

                {multiQuotes.map((q, idx) => {
                    const qVilla = q.invenio_properties;
                    const qBoat = q.invenio_boats;
                    const qPhotos = qPhotosMap[q.id] || [];
                    const qMainPhoto = qPhotos[0]?.url || FALLBACK_IMG;
                    
                    const qTotal = parseFloat(q.final_price || 0);
                    const qBase = parseFloat(q.supplier_base_price || 0);
                    const qExtrasTotal = (q.extra_services || []).reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0);
                    
                    // Specific timing check for this quote
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const qCheckInDate = new Date(q.check_in);
                    qCheckInDate.setHours(0, 0, 0, 0);
                    const qDiffTime = qCheckInDate.getTime() - today.getTime();
                    const qIsLastMinute = Math.round(qDiffTime / (1000 * 60 * 60 * 24)) <= 49;

                    const qUpfrontStayPart = qIsLastMinute ? qBase : (qBase * 0.5);
                    const qUpfront = (qTotal - qBase) + qUpfrontStayPart;

                    return (
                        <section key={q.id} id={q.id} className="pt-24 first:pt-0 border-t border-border/50 first:border-0">
                            <div className="flex flex-col lg:grid lg:grid-cols-12 gap-12">
                                {/* Left Column: Info & Media */}
                                <div className="lg:col-span-8 space-y-12">
                                    {/* Option Header */}
                                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-3">
                                                <span className="bg-primary text-black px-3 py-1 rounded text-[10px] font-black uppercase">Option {idx + 1}</span>
                                                <span className="text-text-muted font-black text-[10px] uppercase tracking-widest">{qVilla ? 'Villa' : 'Boat'}</span>
                                            </div>
                                            <h2 className="text-4xl md:text-6xl font-black text-text-primary tracking-tight">
                                                {qVilla?.villa_name || qBoat?.boat_name}
                                            </h2>
                                            <div className="flex items-center gap-2 text-primary font-bold">
                                                <span className="material-symbols-outlined notranslate text-sm">location_on</span>
                                                <span className="text-sm uppercase tracking-widest">
                                                    {qVilla ? (qVilla.areaname || qVilla.district) : (qBoat?.location_base_port || 'Ibiza')}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Gallery Preview */}
                                    <div className="relative h-[400px] md:h-[600px] rounded-[3rem] overflow-hidden group shadow-2xl border border-border">
                                        <img 
                                            src={qMainPhoto} 
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-[3000ms] ease-out" 
                                            alt={qVilla?.villa_name || qBoat?.boat_name} 
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
                                        <div className="absolute bottom-10 left-10 text-white space-y-2">
                                             <div className="flex items-center gap-4">
                                                {qVilla ? [
                                                    { i: 'groups', v: qVilla.sleeps, l: 'Sleeps' },
                                                    { i: 'bed', v: qVilla.bedrooms, l: 'Beds' },
                                                    { i: 'bathtub', v: qVilla.bathrooms, l: 'Baths' }
                                                ].map((item, i) => (
                                                    <div key={i} className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10">
                                                        <span className="material-symbols-outlined notranslate text-[20px]">{item.i}</span>
                                                        <span className="text-sm font-bold">{item.v}</span>
                                                    </div>
                                                )) : [
                                                    { i: 'directions_boat', v: qBoat?.length_m + 'm', l: 'Length' },
                                                    { i: 'groups', v: qBoat?.capacity_day, l: 'Pax' }
                                                ].map((item, i) => (
                                                    <div key={i} className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10">
                                                        <span className="material-symbols-outlined notranslate text-[20px]">{item.i}</span>
                                                        <span className="text-sm font-bold">{item.v}</span>
                                                    </div>
                                                ))}
                                             </div>
                                        </div>
                                        <button 
                                            onClick={() => {
                                                setQuote(q);
                                                setVilla(qVilla);
                                                setBoat(qBoat);
                                                setPhotos(qPhotos);
                                                setActivePhotoIndex(0);
                                                setShowPhotoModal(true);
                                            }}
                                            className="absolute bottom-10 right-10 bg-primary/95 text-black px-6 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:scale-105 transition-all shadow-2xl flex items-center gap-2"
                                        >
                                            <span className="material-symbols-outlined notranslate text-sm">grid_view</span>
                                            View {qPhotos.length} Photos
                                        </button>
                                    </div>

                                    {/* Essential Info Grid */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="bg-surface-2/30 p-8 rounded-[2.5rem] border border-border">
                                            <h3 className="text-xs font-black text-text-muted uppercase tracking-widest border-b border-border pb-4 mb-6">Booking Details</h3>
                                            <div className="grid grid-cols-2 gap-8">
                                                <div>
                                                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">{qVilla ? 'Check-in' : 'Boarding'}</p>
                                                    <p className="text-lg font-black text-text-primary">
                                                        {new Date(q.check_in).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
                                                    </p>
                                                    <p className="text-[10px] text-text-muted font-bold">{qVilla ? '4:00 PM' : (qBoat?.times_checkin || '10:00 AM')}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">{qVilla ? 'Check-out' : 'Disembark'}</p>
                                                    <p className="text-lg font-black text-text-primary">
                                                        {new Date(q.check_out).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
                                                    </p>
                                                    <p className="text-[10px] text-text-muted font-bold">{qVilla ? '10:00 AM' : (qBoat?.times_checkout || '7:00 PM')}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-surface-2/30 p-8 rounded-[2.5rem] border border-border">
                                            <h3 className="text-xs font-black text-text-muted uppercase tracking-widest border-b border-border pb-4 mb-6">Features</h3>
                                            <div className="flex flex-wrap gap-2">
                                                {(qVilla?.features_and_amenities || qBoat?.features || '').split(',').slice(0, 6).map((tag, i) => (
                                                    <span key={i} className="px-3 py-1 bg-surface-2 rounded-lg text-[10px] font-bold text-text-muted uppercase tracking-tighter">
                                                        {tag.trim()}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Map Preview */}
                                    {(qVilla || qBoat) && (
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <h3 className="text-xs font-black text-text-primary uppercase tracking-[0.2em]">Location</h3>
                                                <span className="text-[10px] text-primary font-bold uppercase">{qVilla?.location || qBoat?.location_base_port}</span>
                                            </div>
                                            <div className="h-[300px] rounded-[2.5rem] overflow-hidden border border-border grayscale-[0.5] hover:grayscale-0 transition-all duration-1000">
                                                <VillaMap 
                                                    villa={qVilla} 
                                                    isBoat={!!qBoat} 
                                                    boatData={qBoat}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Right Column: Pricing & Payment (Sticky) */}
                                <aside className="lg:col-span-4">
                                    <div className="sticky top-32 bg-surface-2 p-8 md:p-10 rounded-[3rem] border border-border shadow-2xl space-y-8">
                                        <div className="text-center pb-8 border-b border-border">
                                            <p className="text-[10px] font-black text-text-muted uppercase tracking-[0.3em] mb-2">Investment</p>
                                            <div className="flex items-center justify-center gap-1">
                                                <span className="text-2xl font-black text-primary/50 self-start mt-1">€</span>
                                                <span className="text-6xl font-black text-text-primary tracking-tighter">{qTotal.toLocaleString('it-IT')}</span>
                                            </div>
                                        </div>

                                        <div className="space-y-6">
                                            <div className="space-y-4">
                                                <div className="flex items-start justify-between">
                                                    <div>
                                                        <span className="text-[10px] font-black uppercase text-text-primary block">Step 1: Secure Booking</span>
                                                        <span className="text-[9px] text-text-muted font-bold uppercase tracking-widest">
                                                            Due Today ({qIsLastMinute ? 'Full Amount' : '50% Deposit'})
                                                        </span>
                                                    </div>
                                                    <span className="font-bold text-text-primary">€{qUpfront.toLocaleString('it-IT')}</span>
                                                </div>

                                                {!qIsLastMinute && (
                                                    <div className="flex items-start justify-between text-text-muted">
                                                        <div>
                                                            <span className="text-[10px] font-black uppercase block">Step 2: Remaining Balance</span>
                                                            <span className="text-[8px] font-bold uppercase tracking-widest">
                                                                Due {(() => {
                                                                    const d = new Date(q.check_in);
                                                                    d.setDate(d.getDate() - 30);
                                                                    return d.toLocaleDateString();
                                                                })()}
                                                            </span>
                                                        </div>
                                                        <span className="font-bold">€{(qTotal - qUpfront).toLocaleString('it-IT')}</span>
                                                    </div>
                                                )}

                                                <div className="flex items-center justify-between p-4 bg-background/50 rounded-2xl border border-border border-dashed">
                                                    <div className="text-left">
                                                        <span className="text-[10px] font-bold text-text-primary uppercase block mb-1">Security Deposit</span>
                                                        <span className="text-[8px] text-text-muted font-bold uppercase italic">Refundable on Arrival</span>
                                                    </div>
                                                    <span className="font-bold text-text-muted shrink-0 ml-4">€{parseFloat(qVilla?.deposit || qBoat?.security_deposit || 0).toLocaleString('it-IT')}</span>
                                                </div>
                                            </div>

                                            {/* Terms & CTA */}
                                            <div className="space-y-4 pt-4">
                                                <div className="flex items-start gap-3 bg-primary/5 p-4 rounded-2xl border border-primary/10">
                                                    <input 
                                                        type="checkbox" 
                                                        checked={acceptTerms} 
                                                        onChange={(e) => setAcceptTerms(e.target.checked)} 
                                                        className="mt-1 w-5 h-5 rounded accent-primary bg-background" 
                                                        id={`agree-${q.id}`} 
                                                    />
                                                    <label htmlFor={`agree-${q.id}`} className="text-[10px] font-medium text-text-muted leading-relaxed cursor-pointer">
                                                        I accept the <button onClick={() => { setQuote(q); setShowAgreementModal(true); }} className="text-primary font-bold underline">Rental Agreement</button>. This action constitutes a digital signature.
                                                    </label>
                                                </div>

                                                {!q.deposit_paid ? (
                                                    <button 
                                                        onClick={() => {
                                                            setActiveQuoteIndex(idx);
                                                            handlePayment(q.id);
                                                        }}
                                                        disabled={processingPayment || !acceptTerms}
                                                        className={`w-full py-5 rounded-2xl font-black uppercase tracking-widest transition-all ${acceptTerms ? 'bg-primary text-background-dark shadow-xl hover:scale-[1.02] active:scale-95' : 'bg-surface-3 text-text-muted grayscale cursor-not-allowed border border-border'}`}
                                                    >
                                                        {processingPayment ? "Processing..." : (qIsLastMinute ? "Confirm & Pay Full" : "Confirm & Pay Deposit")}
                                                    </button>
                                                ) : (
                                                    <div className="space-y-3">
                                                        <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-2xl flex items-center justify-center gap-3 text-emerald-400">
                                                            <span className="material-symbols-outlined notranslate text-sm font-black">check_circle</span>
                                                            <span className="text-[10px] font-black uppercase tracking-widest">Deposit Paid</span>
                                                        </div>
                                                        {!q.security_deposit_authorized ? (
                                                            <button 
                                                                onClick={() => {
                                                                    setActiveQuoteIndex(idx);
                                                                    handleSecurityDeposit(q.id);
                                                                }}
                                                                className="w-full py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                                                            >
                                                                Secure Deposit Auth
                                                            </button>
                                                        ) : (
                                                            <div className="bg-emerald-500/20 border-2 border-emerald-500 p-4 rounded-2xl flex flex-col items-center gap-1 text-emerald-400">
                                                                <span className="material-symbols-outlined notranslate text-2xl">verified</span>
                                                                <span className="text-[10px] font-black uppercase">Fully Secured</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </aside>
                            </div>
                        </section>
                    );
                })}
            </main>

            {/* Modals are globally defined below */}
            {showAgreementModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md p-4 animate-in fade-in duration-300">
                    <div className="bg-background rounded-3xl max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl p-8 md:p-12 border border-border">
                        <div className="flex justify-between items-center mb-8">
                            <h2 className="text-2xl font-black uppercase text-text-primary tracking-tighter">Rental Agreement</h2>
                            <button onClick={() => setShowAgreementModal(false)} className="bg-surface-2 p-2 rounded-full hover:bg-white/10 transition-colors">
                                <span className="material-symbols-outlined notranslate">close</span>
                            </button>
                        </div>
                        <div className="prose prose-invert text-text-muted bg-surface/30 p-8 rounded-2xl whitespace-pre-line italic font-serif leading-relaxed border border-border/50 max-h-[50vh] overflow-y-auto">
                            {getProcessedTemplate()}
                        </div>
                        <button 
                            onClick={() => { setAcceptTerms(true); setShowAgreementModal(false); }} 
                            className="w-full mt-8 bg-primary text-background-dark py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl hover:scale-[1.02] transition-all"
                        >
                            Accept Agreement
                        </button>
                    </div>
                </div>
            )}

            {showPhotoModal && (
                <div className="fixed inset-0 z-[100] flex flex-col bg-black/98 backdrop-blur-2xl animate-in fade-in duration-300 select-none">
                    <div className="p-6 flex justify-between items-center z-10">
                        <div className="flex flex-col">
                            <span className="text-text-primary font-bold text-sm tracking-tight">{villa?.villa_name || boat?.boat_name}</span>
                            <span className="text-primary/50 text-[10px] font-black uppercase tracking-[0.2em]">{activePhotoIndex + 1} / {photos.length}</span>
                        </div>
                        <button onClick={() => setShowPhotoModal(false)} className="size-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-text-primary hover:bg-white/20 transition-all">
                            <span className="material-symbols-outlined notranslate">close</span>
                        </button>
                    </div>

                    <div className="flex-1 relative flex items-center justify-center p-4">
                        <button 
                            className="absolute left-4 md:left-8 z-20 size-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-text-primary hover:bg-white/20 disabled:opacity-0 transition-all"
                            disabled={activePhotoIndex === 0}
                            onClick={() => setActivePhotoIndex(p => p - 1)}
                        >
                            <span className="material-symbols-outlined notranslate text-4xl">chevron_left</span>
                        </button>

                        <img 
                            key={activePhotoIndex}
                            src={photos[activePhotoIndex]?.url} 
                            className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-500" 
                            alt="" 
                        />

                        <button 
                            className="absolute right-4 md:right-8 z-20 size-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-text-primary hover:bg-white/20 disabled:opacity-0 transition-all"
                            disabled={activePhotoIndex === photos.length - 1}
                            onClick={() => setActivePhotoIndex(p => p + 1)}
                        >
                            <span className="material-symbols-outlined notranslate text-4xl">chevron_right</span>
                        </button>
                    </div>

                    <div className="p-8 flex gap-3 overflow-x-auto justify-center">
                        {photos.slice(0, 20).map((p, i) => (
                            <div 
                                key={i} 
                                className={`size-16 flex-shrink-0 rounded-xl overflow-hidden cursor-pointer transition-all ${activePhotoIndex === i ? 'ring-2 ring-primary ring-offset-4 ring-offset-black scale-110' : 'opacity-40 hover:opacity-100'}`}
                                onClick={() => setActivePhotoIndex(i)}
                            >
                                <img src={p.url} className="w-full h-full object-cover" alt="" />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
