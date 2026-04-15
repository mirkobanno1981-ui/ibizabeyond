import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import QuotesKanban from './QuotesKanban';
import EditQuoteModal from './EditQuoteModal';

const STATUS_COLORS = {
    draft: 'bg-slate-500/20 text-text-muted',
    sent: 'bg-blue-500/20 text-blue-400',
    booked: 'bg-emerald-500/20 text-emerald-400',
    check_in_ready: 'bg-purple-500/20 text-purple-400',
    completed: 'bg-amber-500/20 text-amber-400',
    cancelled: 'bg-red-500/20 text-red-400',
    expired: 'bg-slate-500/10 text-slate-500',
    waiting_owner: 'bg-amber-500/20 text-amber-400 animate-pulse',
    owner_declined: 'bg-rose-500/20 text-rose-400',
    details_requested: 'bg-cyan-500/20 text-cyan-400',
    contract_sent: 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30',
    contract_signed: 'bg-emerald-500/20 text-emerald-400 font-extrabold',
};

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
L'Agente ha l'autorizzazione a concedere in locazione la Villa **"{{villa_name}}"**, Licenza **{{villa_license}}**. Il Cliente accetta l'infrastruttura di Ibiza Beyond per il pagamento.

### ART. 1 - OGGETTO E PERIODO
La Villa si trova in **{{villa_address}}**. 
Periodo: dal **{{check_in}}** al **{{check_out}}**.

### ART. 2 - PREZZO E PAGAMENTI
Prezzo Totale: **{{final_price}}**.
- **Acconto:** {{deposit_percent}}% al momento della prenotazione.
- **Saldo:** {{balance_percent}}% entro {{balance_due_days}} giorni dall'arrivo.

### ART. 3 - DEPOSITO CAUZIONALE
Importo: **{{security_deposit_amount}}**. Sarà sbloccato entro 14 giorni dal check-out previa ispezione.

### ART. 4 - REGOLE E DIVIETI
Vietato organizzare feste o eventi non autorizzati. Rispetto rigoroso dei vicini.

### ART. 5 - CANCELLAZIONE
Fino a 60 giorni dall'arrivo: penale del 50%. Successivamente: penale del 100%.

### ART. 6 - RESPONSABILITÀ
La piattaforma Ibiza Beyond agisce come solo fornitore tecnologico.`;

export default function QuotesPage() {
    const { user, role, agentData } = useAuth();
    const queryClient = useQueryClient();
    const [editQuote, setEditQuote] = useState(null);
    const [assignQuote, setAssignQuote] = useState(null);
    const [viewMode, setViewMode] = useState('list');

    // --- Data Queries ---
    const { data: quotes = [], isLoading: quotesLoading } = useQuery({
        queryKey: ['quotes', user?.id, role],
        queryFn: async () => {
            if (!user?.id) return [];
            
            let query = supabase
                .from('quotes')
                .select(`
                    id, status, check_in, check_out, final_price, created_at,
                    client_id,
                    agent_id,
                    agent_markup,
                    extra_services,
                    is_manual_price,
                    stripe_fee_included,
                    supplier_base_price,
                    admin_markup,
                    price_breakdown,
                    documenso_document_id,
                    group_details,
                    clients(full_name, phone_number),
                    invenio_properties(*),
                    invenio_boats(*),
                    agents(company_name, contract_template, boat_contract_template, address, tax_id, phone_number, agency_details)
                `)
                .order('created_at', { ascending: false });

            if (role !== 'admin' && role !== 'super_admin') {
                if (role === 'agency_admin' && agentData?.agency_id) {
                    const { data: agencyAgents } = await supabase
                        .from('agents')
                        .select('id')
                        .eq('agency_id', agentData.agency_id);
                    const agentIds = (agencyAgents || []).map(a => a.id);
                    query = query.in('agent_id', agentIds);
                } else {
                    query = query.eq('agent_id', user.id);
                }
            }
            
            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        },
        enabled: !!user?.id,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    const { data: ivaPercent = 10 } = useQuery({
        queryKey: ['margin_settings'],
        queryFn: async () => {
            const { data } = await supabase.from('margin_settings').select('iva_percent').eq('id', 1).single();
            return parseFloat(data?.iva_percent) || 10;
        },
        staleTime: 1000 * 60 * 60, // 1 hour
    });

    // Helper to refresh data
    const refreshData = () => {
        queryClient.invalidateQueries({ queryKey: ['quotes'] });
    };


    async function handleDeleteQuote(id) {
        if (!confirm('Are you sure you want to delete this quote? This action cannot be undone.')) return;
        
        try {
            // 1. Delete associated guests (manual cascade for foreign key)
            await supabase.from('guests').delete().eq('quote_id', id);

            // 2. Delete the quote
            let query = supabase.from('quotes').delete().eq('id', id);
            
            if (role !== 'admin' && role !== 'super_admin') {
                if (!user?.id) return;
                query = query.eq('agent_id', user.id);
            }

            const { error } = await query;
            if (error) throw error;
            refreshData();
        } catch (err) {
            alert('Error deleting quote: ' + err.message);
        }
    }

    const handleWhatsAppShare = async (quote) => {
        // Update status to 'sent' if it's currently 'draft'
        if (quote.status === 'draft') {
            await handleStatusChange(quote.id, 'sent');
        }

        const url = `${window.location.origin}/quote/${quote.id}`;
        const propertyName = quote.invenio_properties?.villa_name || quote.invenio_boats?.boat_name || 'your stay in Ibiza';
        const message = `Hello ${quote.clients?.full_name || 'there'}! Here is your bespoke quote for ${propertyName}: ${url}`;
        const whatsappUrl = `https://wa.me/${quote.clients?.phone_number?.replace(/\+/g, '').replace(/\s/g, '') || ''}?text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, '_blank');
    };

    const handleAskAvailability = async (quote) => {
        if (role === 'agent' || role === 'agency_admin') {
            alert("Approval request status updated. An administrator will verify availability with the owner.");
            await supabase
                .from('quotes')
                .update({ status: 'waiting_owner' })
                .eq('id', quote.id);
            refreshData();
            return;
        }

        const ownerId = quote.invenio_properties?.owner_id || quote.invenio_boats?.owner_id;
        if (!ownerId) {
            alert("This property does not have an owner assigned.");
            return;
        }

        const { data: ownerData } = await supabase
            .from('owners')
            .select('name, phone_number')
            .eq('id', ownerId)
            .single();

        if (!ownerData?.phone_number) {
            alert("No phone number found for this owner. Please add it in Owner Management.");
            return;
        }

        const confirmUrl = `${window.location.origin}/confirm-availability/${quote.id}`;
        const villaName = quote.invenio_properties?.villa_name || quote.invenio_boats?.boat_name;
        const msg = `Hello ${ownerData.name}, we have a booking request for ${villaName} from ${new Date(quote.check_in).toLocaleDateString()} to ${new Date(quote.check_out).toLocaleDateString()}. Please confirm availability here: ${confirmUrl}`;
        
        const encodedMsg = encodeURIComponent(msg);
        const waUrl = `https://wa.me/${ownerData.phone_number.replace(/\s+/g, '')}?text=${encodedMsg}`;

        // 1. Update status
        const { error } = await supabase
            .from('quotes')
            .update({ status: 'waiting_owner' })
            .eq('id', quote.id);

        if (error) {
            alert('Error updating status: ' + error.message);
            return;
        }

        // 2. Open WhatsApp
        window.open(waUrl, '_blank');
        refreshData();
    };

    const handleStatusChange = async (quoteId, newStatus) => {
        try {
            const { error } = await supabase
                .from('quotes')
                .update({ status: newStatus })
                .eq('id', quoteId);

            if (error) throw error;
            
            if (newStatus === 'waiting_owner') {
                const q = quotes.find(q => q.id === quoteId);
                if (q) handleAskAvailability(q);
                return;
            }

            if (newStatus === 'booked') {
                // Trigger automated invoicing
                supabase.functions.invoke('stripe-create-invoice', { 
                    body: { quoteId } 
                }).catch(err => console.error('Automated invoicing failed:', err));
            }

            refreshData();
        } catch (err) {
            alert('Error updating status: ' + err.message);
        }
    };

    const generatePDF = async (quote) => {
        const { data: propertyPhotos } = await supabase
            .from('invenio_photos')
            .select('url')
            .or(`v_uuid.eq.${quote.invenio_properties?.v_uuid},boat_uuid.eq.${quote.invenio_boats?.v_uuid}`)
            .order('sort_order', { ascending: true })
            .limit(4);

        const doc = new jsPDF('p', 'mm', 'a4');
        const villa = quote.invenio_properties;
        const boat = quote.invenio_boats;
        const property = villa || boat;
        const marginX = 20;

        // Ultra-robust image to base64 converter with multiple fallbacks
        const getBase64FromUrl = async (url) => {
            if (!url) return null;
            try {
                // Try FETCH first (most reliable if CORS is ok)
                const response = await fetch(url, { mode: 'cors' });
                const blob = await response.blob();
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            } catch (err) {
                console.warn("Fetch failed, trying canvas fallback for:", url);
                // Fallback to Canvas (works for some CORS configurations)
                return new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = 'Anonymous';
                    img.src = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(); // Cache busting
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        resolve(canvas.toDataURL('image/jpeg', 0.8));
                    };
                    img.onerror = () => {
                        console.error("All image load attempts failed for:", url);
                        resolve(null);
                    };
                });
            }
        };

        // --- PAGE 1: COVER ---
        // Header Background
        doc.setFillColor(15, 23, 42); // slate-900
        doc.rect(0, 0, 210, 60, 'F');

        // Branding
        // Fetch Agent & Owner details for branding
        let agentBranding = null;
        const { data: qAgent } = await supabase.from('agents').select('*').eq('id', quote.agent_id).single();
        
        if (qAgent?.agent_type === 'collaborator') {
            const ownerId = property?.owner_id;
            const { data: qOwner } = await supabase.from('owners').select('*').eq('id', ownerId).single();
            agentBranding = {
                company_name: qOwner?.company_name || qOwner?.name || 'Luxury Villa Collection',
                logo_url: qOwner?.logo_url,
                phone_number: '', // Owners usually don't show phone here
                email: qOwner?.email || qAgent?.email
            };
        } else {
            agentBranding = qAgent || { company_name: 'Luxury Villa Collection' };
        }

        const logoData = agentBranding?.logo_url ? await getBase64FromUrl(agentBranding.logo_url) : null;
        if (logoData) {
            try {
                doc.addImage(logoData, 'PNG', marginX, 20, 40, 20, undefined, 'FAST');
            } catch (e) { console.error("Logo add error:", e); }
        } else {
            doc.setFillColor(180, 150, 80); // Gold
            doc.rect(marginX, 20, 40, 20, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(10);
            doc.text('LUXURY', marginX + 20, 32, { align: 'center' });
        }

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(agentBranding?.company_name?.toUpperCase() || 'LUXURY VILLA COLLECTION', 55, 25);
        
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184); // slate-400
        doc.text(agentBranding?.email || '', 55, 37);

        // Fetch Contract Template & Prepare Data
        const agent = quote.agents;
        const contractTemplate = quote.invenio_boats 
            ? (agent?.boat_contract_template || agent?.contract_template || DEFAULT_B2C_CONTRACT) 
            : (agent?.contract_template || DEFAULT_B2C_CONTRACT);
        
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
            '{{property_name}}': quote.invenio_properties?.villa_name || quote.invenio_boats?.boat_name || 'Our Listing',
            '{{villa_license}}': quote.invenio_properties?.license || '—',
            '{{villa_address}}': quote.invenio_properties?.location || 'Ibiza',
            '{{property_location}}': quote.invenio_properties?.location || 'Ibiza',
            '{{max_guests}}': quote.invenio_properties?.sleeps || quote.invenio_boats?.capacity_day || '—',
            
            '{{boat_name}}': quote.invenio_boats?.boat_name || '',
            '{{platform_name}}': 'Ibiza Beyond',
            '{{today}}': new Date().toLocaleDateString('it-IT'),
            
            '{{check_in}}': quote.check_in ? new Date(quote.check_in).toLocaleDateString('en-GB') : '—',
            '{{check_out}}': quote.check_out ? new Date(quote.check_out).toLocaleDateString('en-GB') : '—',
            '{{final_price}}': parseFloat(quote.final_price || 0).toLocaleString('en-GB', { style: 'currency', currency: 'EUR' }),
            '{{total_price}}': parseFloat(quote.final_price || 0).toLocaleString('en-GB', { style: 'currency', currency: 'EUR' }),
            '{{deposit_percent}}': isLastMinute ? '100' : '50',
            '{{balance_percent}}': isLastMinute ? '0' : '50',
            '{{balance_due_days}}': '30',
            '{{security_deposit_amount}}': parseFloat(quote.invenio_properties?.security_deposit || quote.invenio_boats?.security_deposit || 0).toLocaleString('en-GB', { style: 'currency', currency: 'EUR' }),

            // Explicit mappings for Italian labels in [BRACKETS]
            '[NOME CLIENTE]': quote.clients?.full_name || 'Valued Client',
            '[NOME AGENTE/SOCIETÀ]': agent?.company_name || 'Ibiza Beyond',
            '[NOME VILLA]': quote.invenio_properties?.villa_name || 'Villa',
            '[DATA CHECK-IN]': quote.check_in ? new Date(quote.check_in).toLocaleDateString('it-IT') : '—',
            '[DATA CHECK-OUT]': quote.check_out ? new Date(quote.check_out).toLocaleDateString('it-IT') : '—',
            '[IMPORTO TOTALE]': parseFloat(quote.final_price || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }),
            '[IMPORTO DEPOSITO]': parseFloat(quote.invenio_properties?.security_deposit || quote.invenio_boats?.security_deposit || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }),
            '[NUMERO LICENZA ETV]': quote.invenio_properties?.license || '—',
            '[INDIRIZZO VILLA]': quote.invenio_properties?.location || 'Ibiza',
            '[NOME PIATTAFORMA]': 'Ibiza Beyond'
        };

        // Hero Image
        if (propertyPhotos && propertyPhotos.length > 0) {
            const heroData = await getBase64FromUrl(propertyPhotos[0].url);
            if (heroData) {
                try {
                    doc.addImage(heroData, 'JPEG', 0, 60, 210, 120, undefined, 'FAST');
                } catch (e) {
                    doc.setFillColor(30, 41, 59);
                    doc.rect(0, 60, 210, 120, 'F');
                }
            } else {
                doc.setFillColor(30, 41, 59);
                doc.rect(0, 60, 210, 120, 'F');
            }
        }

        // Villa Title on Cover
        doc.setFillColor(255, 255, 255);
        doc.rect(marginX, 160, 170, 40, 'F');
        doc.setDrawColor(241, 245, 249);
        doc.rect(marginX, 160, 170, 40, 'D');

        doc.setTextColor(15, 23, 42);
        const title = property?.villa_name || property?.boat_name || 'PROPOSAL';
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text(title.toUpperCase(), marginX + 10, 178);
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        const areaLabel = villa ? (villa.areaname || villa.district) : (boat.location_base_port || 'IBIZA');
        doc.text(areaLabel.toUpperCase(), marginX + 10, 185);

        // --- PAGE 2: PROPERTY & DETAILS ---
        doc.addPage();
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 210, 20, 'F');

        let y = 40;
        
        // 1. Stay Details Overview (Short)
        doc.setTextColor(15, 23, 42);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('Your Stay', marginX, y);
        y += 10;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        const datesText = quote.check_in 
            ? `Dates: ${new Date(quote.check_in).toLocaleDateString('en-GB')} — ${new Date(quote.check_out).toLocaleDateString('en-GB')}`
            : 'Open Dates';
        doc.text(`Guest: ${quote.clients?.full_name || 'Valued Client'}  |  Reference: ${quote.id?.slice(0,8) || '—'}`, marginX, y);
        y += 5;
        doc.text(datesText, marginX, y);
        
        y += 15;
        doc.setDrawColor(226, 232, 240);
        doc.line(marginX, y, 190, y);
        y += 15;

        // 2. The Property Description (User requested this first)
        doc.setTextColor(15, 23, 42);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('The Property', marginX, y);
        
        y += 8;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105);
        const splitDesc = doc.splitTextToSize(property?.description || 'Exclusive experience in Ibiza.', 170);
        doc.text(splitDesc, marginX, y);
        y += (splitDesc.length * 5) + 15;

        // 3. Features & Amenities
        if (y > 220) { doc.addPage(); y = 30; }
        doc.setTextColor(15, 23, 42);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('Features & Amenities', marginX, y);
        
        y += 10;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 65, 85);
        
        const features = Array.isArray(property?.features) ? property.features : [];
        let col = 0;
        let startY = y;
        features.slice(0, 30).forEach((f, i) => { // Limit to avoid page overflow here
            if (i > 0 && i % 10 === 0) {
                col++;
                y = startY;
            }
            doc.text(`• ${f}`, marginX + (col * 55), y);
            y += 6;
        });

        // 4. Quote Total
        y += 20;
        if (y > 250) { doc.addPage(); y = 40; }
        
        doc.setFillColor(248, 250, 252);
        doc.rect(marginX, y, 170, 25, 'F');
        doc.setDrawColor(180, 150, 80);
        doc.line(marginX, y, marginX, y + 25); // Gold accent line
        
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('PROPOSAL TOTAL', marginX + 10, y + 15);
        doc.setFontSize(18);
        doc.setTextColor(180, 150, 80);
        doc.text(`EUR ${parseFloat(quote.final_price).toLocaleString('en-GB')}`, 185, y + 15, { align: 'right' });

        // --- PAGE 3: TERMS & CONDITIONS ---
        if (contractTemplate) {
            doc.addPage();
            y = 30;
            doc.setTextColor(15, 23, 42);
            doc.setFontSize(18);
            doc.setFont('helvetica', 'bold');
            doc.text('Terms & Conditions', marginX, y);
            
            y += 10;
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(51, 65, 85);
            
            let finalContract = contractTemplate;
            Object.entries(data).forEach(([key, value]) => {
                finalContract = finalContract.replaceAll(key, value);
            });
            
            const splitContract = doc.splitTextToSize(finalContract, 170);
            doc.text(splitContract, marginX, y);
        }

        // --- PAGE 3: PHOTO GALLERY ---
        if (propertyPhotos && propertyPhotos.length > 1) {
            doc.addPage();
            y = 30;
            doc.setFontSize(18);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(15, 23, 42);
            doc.text('Photo Gallery', marginX, y);
            
            y += 15;
            const photoWidth = 80;
            const photoHeight = 55;
            
            for (let i = 1; i < Math.min(propertyPhotos.length, 5); i++) {
                const galleryData = await getBase64FromUrl(propertyPhotos[i].url);
                if (galleryData) {
                    try {
                        const px = marginX + ((i-1) % 2 * (photoWidth + 10));
                        const py = y + (Math.floor((i-1) / 2) * (photoHeight + 10));
                        doc.addImage(galleryData, 'JPEG', px, py, photoWidth, photoHeight, undefined, 'FAST');
                    } catch (e) {
                        console.error("Gallery image add error:", e);
                    }
                }
            }
        }

        // Footer on all pages
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text(`${agentBranding?.company_name || 'Ibiza Beyond'} | Private Proposal`, marginX, 285);
            doc.text(`Page ${i} of ${pageCount}`, 190, 285, { align: 'right' });
        }

        doc.save(`Quote_${title?.replace(/\s+/g, '_')}_${quote.id?.slice(0, 8) || '—'}.pdf`);
    };

    return (
        <div className="p-6 md:p-8 space-y-6">
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary">Quotes</h1>
                    <p className="text-text-muted text-sm mt-0.5">{quotes.length} quote{quotes.length !== 1 ? 's' : ''} issued</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex bg-surface-2 p-1 rounded-xl border border-border">
                        <button 
                            onClick={() => setViewMode('list')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all ${viewMode === 'list' ? 'bg-primary text-black shadow-lg shadow-primary/20' : 'text-text-muted hover:text-text-primary'}`}
                        >
                            <span className="material-symbols-outlined notranslate text-[18px]">format_list_bulleted</span>
                            List
                        </button>
                        <button 
                            onClick={() => setViewMode('kanban')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all ${viewMode === 'kanban' ? 'bg-primary text-black shadow-lg shadow-primary/20' : 'text-text-muted hover:text-text-primary'}`}
                        >
                            <span className="material-symbols-outlined notranslate text-[18px]">view_kanban</span>
                            Kanban
                        </button>
                    </div>
                </div>
            </div>

            {quotesLoading && quotes.length === 0 ? (
                <div className="p-12 glass-card flex flex-col items-center justify-center">
                    <div className="animate-spin size-8 border-2 border-primary border-t-transparent rounded-full mb-4"></div>
                    <p className="text-xs text-text-muted font-black uppercase tracking-widest">Loading Proposals...</p>
                </div>
            ) : quotes.length === 0 ? (
                <div className="p-20 glass-card text-center text-text-muted">
                    <span className="material-symbols-outlined notranslate text-5xl block mb-4 opacity-20">request_quote</span>
                    <p className="font-bold text-lg mb-1">No quotes found</p>
                    <p className="text-sm">Create your first proposal from the villa inventory.</p>
                </div>
            ) : viewMode === 'list' ? (
                <div className="glass-card overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border bg-surface-2/30">
                                    <th className="text-left text-[10px] text-text-muted font-black px-5 py-4 uppercase tracking-[0.2em]">Listing</th>
                                    <th className="text-left text-[10px] text-text-muted font-black px-5 py-4 uppercase tracking-[0.2em]">Client</th>
                                    {(role === 'admin' || role === 'super_admin' || role === 'agency_admin') && (
                                        <th className="text-left text-[10px] text-text-muted font-black px-5 py-4 uppercase tracking-[0.2em]">Agent</th>
                                    )}
                                    <th className="text-left text-[10px] text-text-muted font-black px-5 py-4 uppercase tracking-[0.2em]">Dates</th>
                                    {(role === 'admin' || role === 'super_admin') && (
                                        <>
                                            <th className="text-right text-[10px] text-text-muted font-black px-5 py-4 uppercase tracking-[0.2em]">Owner Net</th>
                                            <th className="text-right text-[10px] text-text-muted font-black px-5 py-4 uppercase tracking-[0.2em]">Platform</th>
                                        </>
                                    )}
                                    <th className="text-right text-[10px] text-text-muted font-black px-5 py-4 uppercase tracking-[0.2em]">Agency Comm</th>
                                    <th className="text-right text-[10px] text-text-muted font-black px-5 py-4 uppercase tracking-[0.2em]">Total Price</th>
                                    <th className="text-left text-[10px] text-text-muted font-black px-5 py-4 uppercase tracking-[0.2em]">Profile</th>
                                    <th className="text-left text-[10px] text-text-muted font-black px-5 py-4 uppercase tracking-[0.2em]">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/30">
                                {quotes.map(q => (
                                    <tr key={q.id} className="hover:bg-primary/5 transition-colors group">
                                        <td className="px-5 py-4 font-bold text-text-primary max-w-[180px] truncate">
                                            <div className="flex flex-col">
                                                <span className="truncate">{q.invenio_properties?.villa_name || q.invenio_boats?.boat_name || '—'}</span>
                                                <span className="text-[10px] text-text-muted font-medium uppercase tracking-wider">
                                                    {q.invenio_properties ? 'Villa' : q.invenio_boats ? 'Boat' : 'Unknown'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4 text-text-secondary font-medium">{q.clients?.full_name || '—'}</td>
                                        {(role === 'admin' || role === 'super_admin' || role === 'agency_admin') && (
                                            <td className="px-5 py-4">
                                                <div className="flex flex-col">
                                                    <span className="text-text-primary font-bold text-xs">{q.agent_id === user.id ? 'You' : (q.agents?.company_name || 'Individual Agent')}</span>
                                                    <span className="text-[9px] text-text-muted uppercase tracking-tighter">ID: {q.agent_id?.slice(0,8) || '—'}</span>
                                                </div>
                                            </td>
                                        )}
                                        <td className="px-5 py-4 text-text-muted text-xs whitespace-nowrap">
                                            {q.check_in ? `${new Date(q.check_in).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} → ${new Date(q.check_out).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })}` : '—'}
                                        </td>
                                        
                                         {(role === 'admin' || role === 'super_admin') && (
                                             <>
                                                 <td className="px-5 py-4 text-right">
                                                     <p className="font-mono text-[13px] text-text-primary">€{parseFloat(q.supplier_base_price || 0).toLocaleString()}</p>
                                                     <span className="text-[8px] text-text-muted uppercase font-black">Owner Net</span>
                                                 </td>
                                                 <td className="px-5 py-4 text-right">
                                                     <p className="font-mono text-[13px] text-amber-500/90 font-bold">€{Math.round(parseFloat(q.supplier_base_price || 0) * (parseFloat(q.admin_markup || 0) / 100)).toLocaleString()}</p>
                                                     <span className="text-[8px] text-amber-600/60 uppercase font-black">Platform Profit</span>
                                                 </td>
                                             </>
                                         )}
 
                                         <td className="px-5 py-4 text-right">
                                             {(() => {
                                                 const base = parseFloat(q.supplier_base_price || 0);
                                                 const adminMarkup = parseFloat(q.admin_markup || 0);
                                                 const agentMarkup = parseFloat(q.agent_markup || 0);
                                                 const priceWithAdmin = base * (1 + adminMarkup / 100);
                                                 
                                                 const ivaItem = q.price_breakdown?.find(i => i.label?.includes('IVA'));
                                                 const ivaAmount = ivaItem ? parseFloat(ivaItem.amount) : 0;
                                                 const finalNet = parseFloat(q.final_price || 0) - ivaAmount;
                                                 
                                                 let agentProfit = 0;
                                                 if (q.is_manual_price) {
                                                     agentProfit = finalNet - priceWithAdmin;
                                                 } else {
                                                     agentProfit = priceWithAdmin * (agentMarkup / 100);
                                                 }
 
                                                 const isB2C = !q.agent_id || q.agent_id === '72241c14-09ed-4227-a01e-9bdeefdd0c8d';
                                                 return (
                                                     <div className="flex flex-col items-end">
                                                         <span className={`font-mono text-[13px] font-bold ${isB2C ? 'text-cyan-400' : 'text-emerald-400'}`}>
                                                             €{Math.round(agentProfit).toLocaleString()}
                                                         </span>
                                                         <span className={`text-[8px] uppercase font-black ${isB2C ? 'text-cyan-600/60' : 'text-emerald-600/60'}`}>
                                                             {isB2C ? 'B2C Commission' : 'Agency Comm'}
                                                         </span>
                                                     </div>
                                                 );
                                             })()}
                                         </td>
 
                                         <td className="px-5 py-4 text-right">
                                             <div className="flex flex-col items-end">
                                                 <span className="font-mono text-[15px] text-primary font-black">
                                                     €{parseFloat(q.final_price || 0).toLocaleString()}
                                                 </span>
                                                 <span className="text-[8px] text-primary/60 uppercase font-black">{q.is_manual_price ? 'Manual Total' : 'Gross Total'}</span>
                                             </div>
                                         </td>
 
                                         <td className="px-5 py-4 min-w-[120px]">
                                             {q.group_details ? (
                                                 <div className="flex flex-col gap-1">
                                                     <div className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest w-fit ${
                                                         q.group_details.type === 'family' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-primary/10 text-primary'
                                                     }`}>
                                                         {q.group_details.type}
                                                     </div>
                                                     <div className="flex items-center gap-1">
                                                        <div className="h-1 w-8 bg-background rounded-full overflow-hidden border border-border/30">
                                                            <div className={`h-full ${q.group_details.type === 'family' ? 'w-[90%] bg-emerald-500' : 'w-[60%] bg-primary'} opacity-50`}></div>
                                                        </div>
                                                        <span className="text-[8px] text-text-muted font-bold uppercase">Rel</span>
                                                     </div>
                                                 </div>
                                             ) : (
                                                 <span className="text-[10px] text-text-muted italic">No profile</span>
                                             )}
                                         </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest mr-2 ${STATUS_COLORS[q.status] || ''}`}>
                                                    {q.status?.replace(/_/g, ' ')}
                                                </span>
                                                <div className="flex items-center gap-1">
                                                    <button 
                                                        onClick={() => setEditQuote(q)}
                                                        className="size-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-text-muted hover:text-primary transition-all"
                                                        title="Edit Quote"
                                                    >
                                                        <span className="material-symbols-outlined notranslate text-[18px]">edit</span>
                                                    </button>
                                                    {(role === 'admin' || role === 'super_admin') && (
                                                        <button 
                                                            onClick={() => setAssignQuote(q)}
                                                            className="size-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-text-muted hover:text-primary transition-all"
                                                            title="Assign Agent"
                                                        >
                                                            <span className="material-symbols-outlined notranslate text-[18px]">person_add</span>
                                                        </button>
                                                    )}
                                                    <button 
                                                        onClick={() => handleWhatsAppShare(q)}
                                                        className="size-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-text-muted hover:text-[#25D366] transition-all"
                                                        title="Share via WhatsApp"
                                                    >
                                                        <svg className="size-4 fill-current" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.72.94 3.659 1.437 5.634 1.437h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                                    </button>
                                                    <button 
                                                        onClick={() => {
                                                            const url = `${window.location.origin}/quote/${q.id}`;
                                                            navigator.clipboard.writeText(url);
                                                            alert('Public link copied to clipboard!');
                                                        }}
                                                        className="size-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-text-muted hover:text-primary transition-all"
                                                        title="Copy public link"
                                                    >
                                                        <span className="material-symbols-outlined notranslate text-[18px]">share</span>
                                                    </button>
                                                    <button 
                                                        onClick={() => generatePDF(q)}
                                                        className="size-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-text-muted hover:text-primary transition-all"
                                                        title="Download PDF"
                                                    >
                                                        <span className="material-symbols-outlined notranslate text-[18px]">picture_as_pdf</span>
                                                    </button>
                                                    <button 
                                                        onClick={() => handleDeleteQuote(q.id)}
                                                        className="size-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-text-muted hover:text-red-500 transition-all"
                                                        title="Delete Quote"
                                                    >
                                                        <span className="material-symbols-outlined notranslate text-[18px]">delete</span>
                                                    </button>
                                                    
                                                    {(role === 'admin' || role === 'super_admin') && (q.status === 'draft' || q.status === 'details_requested' || q.status === 'waiting_owner') && (q.invenio_properties?.owner_id || q.invenio_boats?.owner_id) && (
                                                        <button 
                                                            onClick={() => handleAskAvailability(q)}
                                                            className="size-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 hover:bg-amber-500/20 transition-all"
                                                            title="Ask Owner Availability (WhatsApp)"
                                                        >
                                                            <span className="material-symbols-outlined notranslate text-[18px]">chat</span>
                                                        </button>
                                                    )}
                                                    

                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <QuotesKanban 
                    quotes={quotes}
                    onEdit={setEditQuote}
                    onAssign={setAssignQuote}
                    onDelete={handleDeleteQuote}
                    onDownloadPDF={generatePDF}
                    onStatusChange={handleStatusChange}
                    onWhatsAppShare={handleWhatsAppShare}
                    onAskAvailability={handleAskAvailability}
                    role={role}
                    onShare={(q) => {
                        const url = `${window.location.origin}/quote/${q.id}`;
                        navigator.clipboard.writeText(url);
                        alert('Public link copied to clipboard!');
                    }}
                />
            )}

            {assignQuote && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in duration-200">
                        <div className="p-4 border-b border-border flex justify-between items-center">
                            <h3 className="font-bold text-text-primary">Assign Quote</h3>
                            <button onClick={() => setAssignQuote(null)}><span className="material-symbols-outlined notranslate text-sm">close</span></button>
                        </div>
                        <div className="p-4 space-y-4">
                            <p className="text-xs text-text-muted">Select an agent to manage this lead. They will see it in their dashboard.</p>
                            <select 
                                defaultValue={assignQuote.agent_id}
                                onChange={async (e) => {
                                    const newAgentId = e.target.value;
                                    const { error } = await supabase.from('quotes').update({ agent_id: newAgentId }).eq('id', assignQuote.id);
                                    if (error) alert(error.message);
                                    else {
                                        setAssignQuote(null);
                                        refreshData();
                                    }
                                }}
                                className="w-full input-theme p-2 text-sm"
                            >
                                <option value="">Invenio Administration</option>
                                <AgentsList />
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {editQuote && (
                <EditQuoteModal 
                    quote={editQuote} 
                    onClose={() => setEditQuote(null)} 
                    onSaved={() => {
                        setEditQuote(null);
                        refreshData();
                    }} 
                />
            )}
        </div>
    );
}

// Small helper to avoid duplicate fetch code
function AgentsList() {
    const [agents, setAgents] = useState([]);
    useEffect(() => {
        async function fetch() {
            const { data } = await supabase.from('agents').select('id, company_name');
            setAgents(data || []);
        }
        fetch();
    }, []);
    return agents.map(a => <option key={a.id} value={a.id}>{a.company_name || 'Unnamed Agency'}</option>);
}
