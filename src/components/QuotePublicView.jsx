import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import VillaMap from './VillaMap';

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80';

const DEFAULT_B2C_CONTRACT_EN = `# TOURIST RENTAL AGREEMENT ({{agency_name}} ↔ {{client_full_name}})

**1. AGENT / AGENCY**
- **Name:** {{agency_name}}
- **Address:** {{agency_address}}
- **Tax ID:** {{agency_tax_id}}
- **Email:** {{agency_email}} | **Tel:** {{agency_phone}}

**2. GUEST (Tenant)**
- **Name:** {{client_full_name}}
- **Address:** {{client_address}}
- **ID / Passport:** {{client_passport}}
- **Date of birth:** {{client_dob}}
- **Contacts:** {{client_email}} | {{client_phone}}

### RECITALS:
The Agent is authorised to let the Villa **"{{villa_name}}"**, Tourist Licence **{{villa_license}}**. The Guest accepts the **{{platform_name}}** infrastructure for payment processing.

### ART. 1 - OBJECT AND PERIOD
The Villa is located at **{{villa_address}}**.
Period: from **{{check_in}}** to **{{check_out}}**.
Maximum occupants: **{{max_guests}}**.

### ART. 2 - PRICE AND PAYMENTS
Total Price: **{{final_price}}**.
- **Deposit:** {{deposit_percent}}% upon booking.
- **Balance:** {{balance_percent}}% within {{balance_due_days}} days before arrival.

### ART. 3 - SECURITY DEPOSIT
Amount: **{{security_deposit_amount}}**. Released within 14 working days after check-out, subject to inspection.

### ART. 4 - RULES AND PROHIBITIONS
Parties or unauthorised events are strictly forbidden. Strict respect of neighbours (22:00-09:00). Waste penalty: €150.

### ART. 5 - CANCELLATION
Up to 60 days before arrival: 50% penalty. Thereafter: 100% penalty.

### ART. 6 - LIABILITY
The {{platform_name}} platform acts solely as technology provider and has no operational responsibility over the Villa.

**Place and Date:** Ibiza, {{today}}
**Signature for Acceptance:** {{client_full_name}} (Digital Signature)`;

const DEFAULT_B2C_CONTRACT_ES = `# CONTRATO DE ALQUILER TURÍSTICO ({{agency_name}} ↔ {{client_full_name}})

**1. AGENTE / AGENCIA**
- **Nombre:** {{agency_name}}
- **Domicilio:** {{agency_address}}
- **NIF/CIF:** {{agency_tax_id}}
- **Email:** {{agency_email}} | **Tel:** {{agency_phone}}

**2. HUÉSPED (Arrendatario)**
- **Nombre:** {{client_full_name}}
- **Domicilio:** {{client_address}}
- **DNI / Pasaporte:** {{client_passport}}
- **Fecha de nacimiento:** {{client_dob}}
- **Contactos:** {{client_email}} | {{client_phone}}

### EXPONEN:
El Agente está autorizado para alquilar la Villa **"{{villa_name}}"**, Licencia Turística **{{villa_license}}**. El Huésped acepta la infraestructura de **{{platform_name}}** para el procesamiento del pago.

### ART. 1 - OBJETO Y PERÍODO
La Villa está situada en **{{villa_address}}**.
Período: desde el **{{check_in}}** hasta el **{{check_out}}**.
Ocupantes máximos: **{{max_guests}}**.

### ART. 2 - PRECIO Y PAGOS
Precio Total: **{{final_price}}**.
- **Anticipo:** {{deposit_percent}}% en el momento de la reserva.
- **Saldo:** {{balance_percent}}% en los {{balance_due_days}} días previos a la llegada.

### ART. 3 - FIANZA
Importe: **{{security_deposit_amount}}**. Se devolverá en un plazo de 14 días laborables tras el check-out, previa inspección.

### ART. 4 - NORMAS Y PROHIBICIONES
Queda terminantemente prohibido organizar fiestas o eventos no autorizados. Respeto estricto de los vecinos (22:00-09:00). Penalización por basura: 150 €.

### ART. 5 - CANCELACIÓN
Hasta 60 días antes de la llegada: penalización del 50%. Posteriormente: penalización del 100%.

### ART. 6 - RESPONSABILIDAD
La plataforma {{platform_name}} actúa únicamente como proveedor tecnológico y no tiene responsabilidad operativa sobre la Villa.

**Lugar y Fecha:** Ibiza, {{today}}
**Firma de Aceptación:** {{client_full_name}} (Firma Digital)`;

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
    const [viewMode, setViewMode] = useState('detail'); // 'gallery' or 'detail'
    const [activeQuoteIndex, setActiveQuoteIndex] = useState(0);
    const [agent, setAgent] = useState(null);
    const [owner, setOwner] = useState(null);
    const [processingPayment, setProcessingPayment] = useState(false);
    const [paymentSuccess, setPaymentSuccess] = useState(false);
    const [securitySuccess, setSecuritySuccess] = useState(false);
    const [acceptTerms, setAcceptTerms] = useState(false);
    const [showAgreementModal, setShowAgreementModal] = useState(false);
    const [contractLang, setContractLang] = useState('en');
    const [paymentMethod, setPaymentMethod] = useState('card');
    
    // --- Voting & Sharing Features ---
    const [voterId] = useState(() => {
        let vid = localStorage.getItem('ibizabeyond_voter_id');
        if (!vid) {
            vid = Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
            localStorage.setItem('ibizabeyond_voter_id', vid);
        }
        return vid;
    });
    const [votes, setVotes] = useState({}); // { quote_id: count }
    const [userVotes, setUserVotes] = useState(new Set());
    const [isSharing, setIsSharing] = useState(false);
    const [voterName, setVoterName] = useState(() => localStorage.getItem('ibizabeyond_voter_name') || '');
    const [showVoterNameModal, setShowVoterNameModal] = useState(false);
    const [tempVoterName, setTempVoterName] = useState('');
    const [pendingVoteQuoteId, setPendingVoteQuoteId] = useState(null);

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
        if (id) {
            fetchQuoteData();
            const ids = id.split(',');
            if (ids.length > 1) fetchVotes(ids);
        }
    }, [id, activeQuoteIndex]);

    async function fetchVotes(quoteIds) {
        try {
            const { data, error } = await supabase
                .from('quote_votes')
                .select('quote_id, voter_id, voter_name')
                .in('quote_id', quoteIds);
            
            if (error) throw error;
            
            const results = {};
            const uv = new Set();
            data?.forEach(v => {
                if (!results[v.quote_id]) results[v.quote_id] = { count: 0, names: [] };
                results[v.quote_id].count++;
                if (v.voter_name) results[v.quote_id].names.push(v.voter_name);
                if (v.voter_id === voterId) uv.add(v.quote_id);
            });
            setVotes(results);
            setUserVotes(uv);
        } catch (err) {
            console.error('Error fetching votes:', err);
        }
    }

    const handleVote = async (e, quoteId) => {
        e.stopPropagation();
        if (userVotes.has(quoteId)) return;
        
        if (!voterName) {
            setPendingVoteQuoteId(quoteId);
            setShowVoterNameModal(true);
            return;
        }

        await executeVote(quoteId);
    };

    const executeVote = async (quoteId) => {
        try {
            const { error } = await supabase
                .from('quote_votes')
                .insert({ 
                    quote_id: quoteId, 
                    voter_id: voterId,
                    voter_name: voterName 
                });
            
            if (error) {
                if (error.code === '23505') { // Unique constraint violation
                    const uv = new Set(userVotes);
                    uv.add(quoteId);
                    setUserVotes(uv);
                    return;
                }
                throw error;
            }
            
            // Re-fetch votes to update UI
            const ids = multiQuotes.map(q => q.id);
            fetchVotes(ids);
        } catch (err) {
            console.error('Error voting:', err);
        }
    };

    const handleConfirmVoterName = async () => {
        if (!tempVoterName.trim()) return;
        
        const name = tempVoterName.trim();
        setVoterName(name);
        localStorage.setItem('ibizabeyond_voter_name', name);
        setShowVoterNameModal(false);
        
        if (pendingVoteQuoteId) {
            await executeVote(pendingVoteQuoteId);
            setPendingVoteQuoteId(null);
        }
    };

    const handleShare = async () => {
        const shareData = {
            title: `Ibiza Luxury Proposals - ${agent?.company_name || 'Ibiza Beyond'}`,
            text: `Check out these amazing proposals for our stay in Ibiza! Vote for your favorite.`,
            url: window.location.href,
        };

        if (navigator.share) {
            try {
                await navigator.share(shareData);
            } catch (err) {
                console.error('Error sharing:', err);
            }
        } else {
            // Fallback: Copy to clipboard
            try {
                await navigator.clipboard.writeText(window.location.href);
                setIsSharing(true);
                setTimeout(() => setIsSharing(false), 3000);
            } catch (err) {
                console.error('Clipboard error:', err);
            }
        }
    };

    async function fetchQuoteData() {
        if (!id) return;
        setLoading(true);
        setActivePhotoIndex(0); // Reset index for new quote
        try {
            const ids = id.split(',');
            
            let query = supabase
                .from('quotes')
                .select(`
                    *,
                    invenio_properties(*),
                    invenio_boats(*),
                    agents!quotes_agent_id_fkey(company_name, logo_url, phone_number, contract_template, boat_contract_template, agent_type, agency_details),
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

            const allQuotes = Array.isArray(quotesData) ? quotesData : [quotesData];
            setMultiQuotes(allQuotes);
            
            // If comma-separated IDs, initialize gallery mode
            if (allQuotes.length > 1) {
                setViewMode('gallery');
            } else {
                setViewMode('detail');
            }
            
            const currentQuote = allQuotes[activeQuoteIndex] || allQuotes[0];
            
            setQuote(currentQuote);
            setVilla(currentQuote.invenio_properties);
            setBoat(currentQuote.invenio_boats);
            setAgent(currentQuote.agents);

            // Fetch Photos for the active quote (Gallery & Detail use different logic)
            // Use IDs from joined objects as they are more consistent
            const targetVUuid = currentQuote.invenio_properties?.v_uuid || currentQuote.v_uuid;
            const targetBoatUuid = currentQuote.invenio_boats?.v_uuid || currentQuote.boat_uuid;

            const { data: photoData } = await supabase
                .from('invenio_photos')
                .select('url, thumbnail_url, sort_order')
                .or(`v_uuid.eq.${targetVUuid || '00000000-0000-0000-0000-000000000000'},boat_uuid.eq.${targetBoatUuid || '00000000-0000-0000-0000-000000000000'}`)
                .order('sort_order', { ascending: true });
            
            let currentPhotos = photoData || [];

            // Add photos from comma-separated field if it's a boat
            if (currentQuote.invenio_boats?.photo_urls) {
                const manualPhotos = currentQuote.invenio_boats.photo_urls
                    .split(',')
                    .map(url => url.trim())
                    .filter(url => url.length > 5)
                    .map((url, index) => ({
                        url,
                        thumbnail_url: url,
                        sort_order: 1000 + index
                    }));
                currentPhotos = [...currentPhotos, ...manualPhotos];
            }

            // Fallback: Use images array or thumbnail_url from invenio_properties if no photos found in invenio_photos table
            if (currentPhotos.length === 0) {
                if (currentQuote.invenio_properties?.images?.length > 0) {
                    const villaImages = currentQuote.invenio_properties.images.map((url, index) => ({
                        url,
                        thumbnail_url: url,
                        sort_order: 2000 + index
                    }));
                    currentPhotos = villaImages;
                } else if (currentQuote.invenio_properties?.thumbnail_url) {
                    currentPhotos = [{
                        url: currentQuote.invenio_properties.thumbnail_url,
                        thumbnail_url: currentQuote.invenio_properties.thumbnail_url,
                        sort_order: 3000
                    }];
                }
            }

            // Final safety check: if no photos at all, use fallback for the entire array
            if (currentPhotos.length === 0) {
                currentPhotos = [{
                    url: FALLBACK_IMG,
                    thumbnail_url: FALLBACK_IMG,
                    sort_order: 9999
                }];
            }
            
            setPhotos(currentPhotos);

            // Fetch Primary Photos for all multi-quotes (for the Gallery)
            if (quotesData.length > 1) {
                const vUuids = quotesData.map(q => q.invenio_properties?.v_uuid || q.v_uuid).filter(Boolean);
                const boatUuids = quotesData.map(q => q.invenio_boats?.v_uuid || q.boat_uuid).filter(Boolean);
                
                const { data: allPrimaryPhotos } = await supabase
                    .from('invenio_photos')
                    .select('url, v_uuid, boat_uuid')
                    .or(`v_uuid.in.(${vUuids.join(',')}),boat_uuid.in.(${boatUuids.join(',')})`)
                    .order('sort_order', { ascending: true });

                const galleryPhotosMap = (allPrimaryPhotos || []).reduce((acc, p) => {
                    const key = p.v_uuid || p.boat_uuid;
                    if (!acc[key]) acc[key] = p.url;
                    return acc;
                }, {});

                // Attach photos to multiQuotes for gallery rendering
                const updatedMulti = quotesData.map(q => ({
                    ...q,
                    primary_photo: galleryPhotosMap[q.v_uuid || q.boat_uuid] || (q.invenio_boats?.photo_urls?.split(',')[0] || FALLBACK_IMG)
                }));
                setMultiQuotes(updatedMulti);
            }

            // Fetch Owner Info
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

        const fallback = contractLang === 'es' ? DEFAULT_B2C_CONTRACT_ES : DEFAULT_B2C_CONTRACT_EN;
        let content = quote.invenio_boats
            ? (agent?.boat_contract_template || agent?.contract_template || fallback)
            : (agent?.contract_template || fallback);

        if (!content) content = fallback;

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
            '{{today}}': new Date().toLocaleDateString('en-GB'),
            
            '{{check_in}}': quote.check_in ? new Date(quote.check_in).toLocaleDateString('en-GB') : '—',
            '{{check_out}}': quote.check_out ? new Date(quote.check_out).toLocaleDateString('en-GB') : '—',
            '{{final_price}}': parseFloat(quote.final_price || 0).toLocaleString('en-IE', { style: 'currency', currency: 'EUR' }),
            '{{deposit_percent}}': isLastMinute ? '100' : '50',
            '{{balance_percent}}': isLastMinute ? '0' : '50',
            '{{balance_due_days}}': '30',
            '{{security_deposit_amount}}': parseFloat(villa?.deposit || boat?.security_deposit || 0).toLocaleString('en-IE', { style: 'currency', currency: 'EUR' }),
            '{{security_deposit_due_days}}': '7',

            // Explicit mappings for Italian labels in [BRACKETS]
            '[NOME CLIENTE]': quote.clients?.full_name || 'Valued Client',
            '[NOME AGENTE/SOCIETÀ]': agent?.company_name || 'Ibiza Beyond',
            '[NOME VILLA]': quote.invenio_properties?.villa_name || 'Villa',
            '[DATA CHECK-IN]': quote.check_in ? new Date(quote.check_in).toLocaleDateString('en-GB') : '—',
            '[DATA CHECK-OUT]': quote.check_out ? new Date(quote.check_out).toLocaleDateString('en-GB') : '—',
            '[IMPORTO TOTALE]': parseFloat(quote.final_price || 0).toLocaleString('en-IE', { style: 'currency', currency: 'EUR' }),
            '[IMPORTO DEPOSITO]': parseFloat(villa?.deposit || boat?.security_deposit || 0).toLocaleString('en-IE', { style: 'currency', currency: 'EUR' }),
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
    const checkOutDate = new Date(quote.check_out);
    checkOutDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const daysUntilCheckIn = Math.round((checkInDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const isLastMinute = daysUntilCheckIn <= 49; // 7 weeks

    const diffDays = Math.round((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));

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
                <div className="flex items-center gap-4">
                    <button 
                        onClick={handleShare}
                        className="bg-primary/10 hover:bg-primary/20 text-primary px-4 py-2 rounded-xl flex items-center gap-2 transition-all group"
                    >
                        <span className="material-symbols-outlined notranslate text-sm">share</span>
                        <span className="text-[10px] font-black uppercase tracking-widest hidden sm:block">
                            {isSharing ? 'Link Copied!' : 'Share Proposal'}
                        </span>
                    </button>
                    {agent?.phone_number && (
                        <div className="hidden sm:flex items-center gap-2 text-text-muted">
                            <span className="material-symbols-outlined notranslate text-sm">phone</span>
                            <span className="text-xs font-bold">{agent?.phone_number}</span>
                        </div>
                    )}
                </div>
            </nav>

            <main className="max-w-[1400px] mx-auto p-4 md:p-12 space-y-12 pb-32">
                {/* Gallery View (Tier 1) */}
                {viewMode === 'gallery' && (
                    <div className="space-y-12 animate-in fade-in duration-1000">
                        {/* Immersive Welcome Block */}
                        <div className="bg-primary/5 border border-primary/20 rounded-3xl p-8 md:p-12 shadow-2xl relative overflow-hidden group">
                            <div className="absolute top-0 right-0 -m-8 size-64 bg-primary/10 rounded-full blur-3xl group-hover:bg-primary/20 transition-all duration-1000"></div>
                            <div className="relative space-y-8">
                                <div className="flex items-center gap-4 text-primary">
                                    <div className="size-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
                                        <span className="material-symbols-outlined notranslate text-3xl">verified_user</span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] font-black uppercase tracking-[0.3em] block leading-none mb-1">Exclusive Selection</span>
                                        <h2 className="text-2xl font-black uppercase tracking-tight text-text-primary">Customized Proposal</h2>
                                    </div>
                                </div>
                                <div className="space-y-6">
                                    <p className="text-text-primary text-xl md:text-3xl font-light leading-snug max-w-4xl">
                                        Dear <span className="font-bold text-primary">{quote.clients?.full_name || 'Guest'}</span>, we have meticulously curated this exclusive selection of properties to match your specific requirements and vision for Ibiza.
                                    </p>
                                    <div className="flex flex-col md:flex-row md:items-center gap-8 pt-4 border-t border-primary/10">
                                        <div className="flex-1 space-y-2">
                                            <p className="text-text-muted text-sm leading-relaxed max-w-2xl">
                                                Please note that this proposal is valid for a maximum of <span className="text-primary font-bold">3 days</span>. 
                                                Due to the high demand for premium locations, properties remain available on the market and may be secured by other clients until your deposit is confirmed.
                                            </p>
                                            <p className="text-[10px] text-primary font-black uppercase tracking-widest flex items-center gap-2 mt-4">
                                                <span className="material-symbols-outlined notranslate text-sm">groups</span>
                                                Invite your friends to vote for their favorite option!
                                            </p>
                                        </div>
                                        <div className="flex flex-col gap-3 min-w-[240px]">
                                            <button 
                                                onClick={() => document.getElementById('proposals-grid')?.scrollIntoView({ behavior: 'smooth' })}
                                                className="bg-primary text-background-dark px-8 py-4 rounded-2xl flex items-center justify-center gap-3 shadow-xl transition-all font-black uppercase tracking-widest text-sm hover:scale-[1.02] active:scale-95 group"
                                            >
                                                <span className="material-symbols-outlined notranslate group-hover:animate-bounce">favorite</span>
                                                Vote for your Favorite
                                            </button>
                                            <div className="flex gap-3">
                                                <div className="flex-1 bg-white/5 text-text-muted px-6 py-3 rounded-2xl flex items-center justify-center gap-3 border border-white/10">
                                                    <span className="material-symbols-outlined notranslate text-sm">schedule</span>
                                                    <span className="text-[10px] font-black uppercase tracking-widest">Valid 3 Days</span>
                                                </div>
                                                <button 
                                                    onClick={handleShare}
                                                    className="flex-1 bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-2xl flex items-center justify-center gap-3 border border-white/10 transition-all font-black uppercase tracking-widest text-[10px]"
                                                >
                                                    <span className="material-symbols-outlined notranslate text-sm">send</span>
                                                    {isSharing ? 'Copied' : 'Share'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Ranking Board Summary */}
                        <div id="proposals-grid">
                        {Object.values(votes).some(v => v.count > 0) && (
                            <div className="mb-12 bg-surface-2/30 border border-border/50 rounded-[2.5rem] p-8 md:p-10 backdrop-blur-sm">
                                <div className="flex items-center gap-4 mb-8">
                                    <div className="size-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
                                        <span className="material-symbols-outlined notranslate text-primary font-bold">leaderboard</span>
                                    </div>
                                    <div className="space-y-0.5">
                                        <h2 className="text-2xl font-black text-text-primary tracking-tight uppercase">Current Ranking</h2>
                                        <p className="text-[10px] text-text-muted font-bold uppercase tracking-[0.2em] opacity-70">Top choices from your group</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {[...multiQuotes]
                                        .sort((a, b) => (votes[b.id]?.count || 0) - (votes[a.id]?.count || 0))
                                        .filter(q => (votes[q.id]?.count || 0) > 0)
                                        .map((q, idx) => {
                                            const vData = votes[q.id];
                                            return (
                                                <div 
                                                    key={`rank-${q.id}`} 
                                                    className="flex items-center gap-4 bg-background/50 p-4 rounded-2xl border border-border/50 hover:border-primary/30 transition-all cursor-pointer group/rank"
                                                    onClick={() => {
                                                        const originalIdx = multiQuotes.findIndex(mq => mq.id === q.id);
                                                        setActiveQuoteIndex(originalIdx);
                                                        setViewMode('detail');
                                                        window.scrollTo({ top: 0, behavior: 'smooth' });
                                                    }}
                                                >
                                                    <div className={`size-10 rounded-xl flex items-center justify-center font-black text-sm shadow-lg ${idx === 0 ? 'bg-primary text-background-dark' : 'bg-surface-2 text-text-muted border border-border'}`}>
                                                        {idx + 1}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <h4 className="text-[11px] font-black text-text-primary truncate uppercase tracking-tight group-hover/rank:text-primary transition-colors">
                                                            {q.invenio_properties?.villa_name || q.invenio_boats?.boat_name}
                                                        </h4>
                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            <span className="text-[9px] font-black text-primary uppercase tracking-widest">{vData.count} {vData.count === 1 ? 'Vote' : 'Votes'}</span>
                                                            <div className="flex -space-x-2 overflow-hidden">
                                                                {vData.names.slice(0, 3).map((_, i) => (
                                                                    <div key={i} className="size-4 rounded-full bg-surface-2 border border-background flex items-center justify-center">
                                                                        <span className="text-[6px] font-black text-text-muted">J</span>
                                                                    </div>
                                                                ))}
                                                                {vData.names.length > 3 && (
                                                                    <span className="text-[8px] font-black text-text-muted ml-2">+{vData.names.length - 3}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>
                        )}

                        {/* Proposal Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {[...multiQuotes]
                                .sort((a, b) => (votes[b.id]?.count || 0) - (votes[a.id]?.count || 0)) // Sort by votes
                                .map((q, idx) => {
                                const thumbnail = q.primary_photo || FALLBACK_IMG;
                                const voteData = votes[q.id] || { count: 0, names: [] };
                                const voteCount = voteData.count;
                                const hasVoted = userVotes.has(q.id);
                                
                                return (
                                    <div 
                                        key={q.id}
                                        className="group bg-surface-2 border border-border rounded-[2.5rem] overflow-hidden hover:border-primary/50 transition-all duration-500 hover:shadow-2xl hover:-translate-y-2 cursor-pointer flex flex-col relative"
                                        onClick={() => {
                                            const originalIdx = multiQuotes.findIndex(mq => mq.id === q.id);
                                            setActiveQuoteIndex(originalIdx);
                                            setViewMode('detail');
                                            window.scrollTo({ top: 0, behavior: 'smooth' });
                                        }}
                                    >
                                        {/* Rank Badge */}
                                        {idx < 3 && voteCount > 0 && (
                                            <div className="absolute top-6 left-6 z-10 size-10 rounded-full bg-primary/90 backdrop-blur-md flex items-center justify-center text-background-dark font-black shadow-xl border border-white/20">
                                                {idx + 1}
                                            </div>
                                        )}

                                        <div className="aspect-[16/10] overflow-hidden relative">
                                            <img src={thumbnail} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-[2000ms]" alt="" />
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60"></div>
                                            
                                            {/* Voting Interaction Overlay */}
                                            <div className="absolute top-4 right-4 flex items-center gap-2">
                                                <button 
                                                    onClick={(e) => handleVote(e, q.id)}
                                                    className={`p-3 rounded-2xl backdrop-blur-xl border transition-all flex items-center gap-2 shadow-2xl ${hasVoted ? 'bg-primary border-white/20 text-background-dark' : 'bg-black/40 border-white/10 text-white hover:bg-white/20'}`}
                                                >
                                                    <span className={`material-symbols-outlined notranslate ${hasVoted ? 'fill-1' : ''}`}>favorite</span>
                                                    <span className="text-xs font-black">{voteCount}</span>
                                                </button>
                                            </div>

                                            <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between">
                                                <div>
                                                    <div className="flex items-center gap-2 text-primary font-bold mb-1">
                                                        <span className="material-symbols-outlined notranslate text-sm">{q.invenio_boats ? 'directions_boat' : 'location_on'}</span>
                                                        <span className="text-[10px] uppercase tracking-widest">
                                                            {q.invenio_properties ? (q.invenio_properties.areaname || q.invenio_properties.district) : (q.invenio_boats?.location_base_port || 'Ibiza')}
                                                        </span>
                                                    </div>
                                                    <h3 className="text-2xl font-black text-white tracking-tight">{q.invenio_properties?.villa_name || q.invenio_boats?.boat_name}</h3>
                                                </div>
                                                <div className="bg-primary/90 backdrop-blur-md px-4 py-2 rounded-xl text-background-dark font-black text-sm shadow-xl">
                                                    €{parseFloat(q.final_price || 0).toLocaleString()}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="p-8 flex flex-col flex-1 justify-between gap-6">
                                            <div className="grid grid-cols-3 gap-4">
                                                {q.invenio_properties ? (
                                                    <>
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="material-symbols-outlined notranslate text-primary/60">bed</span>
                                                            <span className="text-xs font-bold text-text-primary">{q.invenio_properties.bedrooms} Rooms</span>
                                                        </div>
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="material-symbols-outlined notranslate text-primary/60">groups</span>
                                                            <span className="text-xs font-bold text-text-primary">{q.invenio_properties.sleeps} Sleeps</span>
                                                        </div>
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="material-symbols-outlined notranslate text-primary/60">shower</span>
                                                            <span className="text-xs font-bold text-text-primary">{q.invenio_properties.bathrooms} Baths</span>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="material-symbols-outlined notranslate text-primary/60">straighten</span>
                                                            <span className="text-xs font-bold text-text-primary">{q.invenio_boats?.length_m}m</span>
                                                        </div>
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="material-symbols-outlined notranslate text-primary/60">groups</span>
                                                            <span className="text-xs font-bold text-text-primary">{q.invenio_boats?.capacity_day} Day</span>
                                                        </div>
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="material-symbols-outlined notranslate text-primary/60">bed</span>
                                                            <span className="text-xs font-bold text-text-primary">{q.invenio_boats?.cabins || '—'} Cabins</span>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                            
                                            {/* Voter Names */}
                                            {voteData.names.length > 0 && (
                                                <div className="flex flex-wrap gap-2 py-4 border-y border-border/50">
                                                    <div className="w-full flex items-center gap-2 mb-2">
                                                        <span className="material-symbols-outlined notranslate text-[16px] text-primary">groups</span>
                                                        <span className="text-[10px] font-black text-text-muted uppercase tracking-widest">Voted by:</span>
                                                    </div>
                                                    {voteData.names.map((name, i) => (
                                                        <span key={i} className="bg-primary/5 text-primary text-[10px] px-3 py-1 rounded-full font-bold border border-primary/20 shadow-sm">
                                                            {name}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            <button className="w-full py-4 rounded-2xl bg-surface border border-border group-hover:border-primary/50 text-xs font-black uppercase tracking-[0.2em] text-text-primary transition-all flex items-center justify-center gap-3">
                                                View Details & Secure Dates
                                                <span className="material-symbols-outlined notranslate group-hover:translate-x-1 transition-transform">arrow_forward</span>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

                {/* Detail View (Tier 2) */}
                {viewMode === 'detail' && (
                    <>
                        {/* Back Button for Multi-Quotes */}
                        {multiQuotes.length > 1 && (
                            <button 
                                onClick={() => setViewMode('gallery')}
                                className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-widest hover:gap-4 transition-all group mb-4"
                            >
                                <span className="material-symbols-outlined notranslate text-sm">arrow_back</span>
                                Back to all Proposals
                            </button>
                        )}

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
                                {photos.length > 1 && (
                                    <div className="absolute top-6 right-6 bg-surface-2/80 backdrop-blur-xl border border-white/20 px-4 py-2 rounded-2xl text-text-primary text-xs font-bold flex items-center gap-2 shadow-xl">
                                        <span className="material-symbols-outlined notranslate text-[18px]">photo_library</span>
                                        {photos.length} Photos
                                    </div>
                                )}
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

                                    <div className="pt-6 border-t border-border space-y-6">
                                        <div className="flex items-center justify-between">
                                            <p className="text-[10px] font-black text-text-muted uppercase tracking-widest">Price Breakdown</p>
                                            <div className="px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20">
                                                <span className="text-[9px] font-black text-primary uppercase">Guaranteed Rate</span>
                                            </div>
                                        </div>
                                        
                                        <div className="space-y-3">
                                            {/* Accommodation Base */}
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="text-text-secondary font-medium">{villa ? 'Villa Stay' : 'Charter Duration'}</span>
                                                <span className="font-bold text-text-primary">€{base.toLocaleString()}</span>
                                            </div>

                                            {/* Commissions / Fees included in one line for client */}
                                            {((total - base - extrasTotal) > 1) && (
                                                <div className="flex justify-between items-center text-sm">
                                                    <span className="text-text-secondary font-medium">Service & Admin Fees</span>
                                                    <span className="font-bold text-text-primary">€{Math.round(total - base - extrasTotal).toLocaleString()}</span>
                                                </div>
                                            )}

                                            {/* Extra Services Breakdown */}
                                            {(quote.extra_services || []).filter(s => parseFloat(s.price) > 0).map((s, idx) => (
                                                <div key={idx} className="flex justify-between items-center text-sm">
                                                    <span className="text-text-secondary font-medium">{s.name}</span>
                                                    <span className="font-bold text-text-primary">€{parseFloat(s.price).toLocaleString()}</span>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="pt-6 border-t border-border space-y-4">
                                            <div className="flex flex-col items-center">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Total Amount</span>
                                                    <div className="h-px bg-primary/20 w-8"></div>
                                                </div>
                                                <p className="text-5xl font-black text-primary tracking-tighter">
                                                     €{paymentMethod === 'card' && !quote.deposit_paid ? (total + (upfront * 0.02)).toLocaleString() : total.toLocaleString()}
                                                </p>
                                                <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mt-2 flex items-center gap-2">
                                                    <span className="material-symbols-outlined notranslate text-[14px]">event_repeat</span>
                                                    Total for {diffDays} {diffDays === 1 ? 'night' : 'nights'} stay
                                                </p>
                                            </div>
                                            
                                            {/* Payment Method Selector */}
                                            {!quote.deposit_paid && (
                                                <div className="space-y-3 pt-4 border-t border-border/50">
                                                    <p className="text-[10px] font-black text-text-muted uppercase tracking-widest text-left">Confirm Payment Method</p>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <button 
                                                            onClick={() => setPaymentMethod('card')}
                                                            className={`p-3 rounded-2xl border-2 text-left transition-all flex flex-col items-start gap-1 group/btn ${paymentMethod === 'card' ? 'border-primary bg-primary/10' : 'border-border bg-surface-2/30 grayscale hover:grayscale-0 hover:border-primary/50'}`}
                                                        >
                                                            <div className="flex items-center justify-between w-full">
                                                                <span className="material-symbols-outlined notranslate text-xl text-primary">credit_card</span>
                                                                {paymentMethod === 'card' && <span className="size-2 rounded-full bg-primary animate-pulse"></span>}
                                                            </div>
                                                            <div>
                                                                <span className="block text-[10px] font-black text-text-primary uppercase tracking-tight">Credit Card</span>
                                                                <span className="block text-[8px] text-text-muted font-bold">+2% Processing Fee</span>
                                                            </div>
                                                        </button>
                                                        <button 
                                                            onClick={() => setPaymentMethod('bank_transfer')}
                                                            className={`p-3 rounded-2xl border-2 text-left transition-all flex flex-col items-start gap-1 group/btn ${paymentMethod === 'bank_transfer' ? 'border-primary bg-primary/10' : 'border-border bg-surface-2/30 grayscale hover:grayscale-0 hover:border-primary/50'}`}
                                                        >
                                                            <div className="flex items-center justify-between w-full">
                                                                <span className="material-symbols-outlined notranslate text-xl text-primary">account_balance</span>
                                                                {paymentMethod === 'bank_transfer' && <span className="size-2 rounded-full bg-primary animate-pulse"></span>}
                                                            </div>
                                                            <div>
                                                                <span className="block text-[10px] font-black text-text-primary uppercase tracking-tight">Bank Transfer</span>
                                                                <span className="block text-[8px] text-emerald-500 font-bold tracking-tight">Zero Additional Fees</span>
                                                            </div>
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                            
                                            <p className="text-[9px] text-text-muted/60 font-medium italic text-center max-w-[200px] mx-auto">
                                                Prices include Taxes and VAT as per Spanish regulations.
                                            </p>
                                        </div>

                                        <div className="space-y-4 pt-4 border-t border-border/50">
                                            {/* Step 1: Booking Payment */}
                                            <div className="flex flex-col p-5 bg-primary/10 rounded-3xl border border-primary/20 gap-2 relative overflow-hidden group">
                                                <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                                    <span className="material-symbols-outlined notranslate text-4xl text-primary">verified</span>
                                                </div>
                                                <div className="flex items-center justify-between relative z-10">
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
                                            <input
                                                type="checkbox"
                                                checked={acceptTerms}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setShowAgreementModal(true);
                                                    } else {
                                                        setAcceptTerms(false);
                                                    }
                                                }}
                                                className="mt-1 w-5 h-5 rounded accent-primary cursor-pointer"
                                                id="agree"
                                            />
                                            <label htmlFor="agree" className="text-[10px] font-medium text-text-muted leading-relaxed cursor-pointer">
                                                I have read and accept the <button type="button" onClick={() => setShowAgreementModal(true)} className="text-primary font-bold underline">Rental Agreement & Terms</button> / He leído y acepto el <button type="button" onClick={() => { setContractLang('es'); setShowAgreementModal(true); }} className="text-primary font-bold underline">Contrato de Alquiler</button>. By proceeding with payment I confirm that this constitutes a legally binding digital signature of the contract.
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
            </>
        )}
    </main>

            {/* Agreement Modal */}
            {showAgreementModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
                    <div className="bg-background rounded-3xl max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl p-8 md:p-12 border border-border">
                        <div className="flex justify-between items-center mb-8 gap-4">
                            <h2 className="text-2xl font-black uppercase text-text-primary">
                                {contractLang === 'es' ? 'Contrato de Alquiler y Términos' : 'Rental Agreement & Terms'} [v2.0]
                            </h2>
                            <div className="flex items-center gap-2">
                                <div className="flex bg-surface-2 rounded-full p-1">
                                    <button
                                        type="button"
                                        onClick={() => setContractLang('en')}
                                        className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${contractLang === 'en' ? 'bg-primary text-background-dark' : 'text-text-muted'}`}
                                    >EN</button>
                                    <button
                                        type="button"
                                        onClick={() => setContractLang('es')}
                                        className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${contractLang === 'es' ? 'bg-primary text-background-dark' : 'text-text-muted'}`}
                                    >ES</button>
                                </div>
                                <button onClick={() => setShowAgreementModal(false)} className="bg-surface-2 p-2 rounded-full"><span className="material-symbols-outlined notranslate">close</span></button>
                            </div>
                        </div>
                        <div className="prose text-text-muted bg-surface/50 p-8 rounded-2xl whitespace-pre-line italic font-serif leading-relaxed border border-border/50">
                            {getProcessedTemplate()}
                        </div>
                        <button onClick={() => { setAcceptTerms(true); setShowAgreementModal(false); }} className="w-full mt-8 bg-primary text-background-dark py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl">
                            {contractLang === 'es' ? 'Aceptar Contrato' : 'Accept Agreement'}
                        </button>
                    </div>
                </div>
            )}
            
            {/* Voter Name Modal */}
            {showVoterNameModal && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-300">
                    <div className="bg-background rounded-3xl max-w-sm w-full shadow-2xl p-8 border border-primary/20 space-y-6">
                        <div className="flex flex-col items-center text-center space-y-4">
                            <div className="size-16 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
                                <span className="material-symbols-outlined notranslate text-3xl text-primary">favorite</span>
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-xl font-black uppercase text-text-primary tracking-tight">Vote for your favorite</h3>
                                <p className="text-[10px] text-text-muted uppercase tracking-[0.2em]">Enter your name to participate</p>
                            </div>
                        </div>
                        
                        <div className="space-y-4">
                            <input 
                                type="text"
                                value={tempVoterName}
                                onChange={(e) => setTempVoterName(e.target.value)}
                                placeholder="Your Full Name"
                                className="w-full bg-surface-2 border border-border/50 rounded-xl px-4 py-4 text-sm text-text-primary placeholder:text-text-muted focus:border-primary/50 outline-none transition-all"
                                autoFocus
                                onKeyDown={(e) => e.key === 'Enter' && handleConfirmVoterName()}
                            />
                            <button 
                                onClick={handleConfirmVoterName}
                                disabled={!tempVoterName.trim()}
                                className="w-full bg-primary text-background-dark py-4 rounded-xl font-black uppercase tracking-widest text-xs shadow-xl disabled:opacity-50 transition-all active:scale-95"
                            >
                                Submit & Vote
                            </button>
                        </div>
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
                                    {photos.length > 0 && (
                                        <span className="text-primary/50 text-[10px] font-black uppercase tracking-[0.2em]">{activePhotoIndex + 1} / {photos.length}</span>
                                    )}
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
