import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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

const SUPER_ADMIN_AGENT_ID = '72241c14-09ed-4227-a01e-9bdeefdd0c8d';

function PaymentFlowDiagram({ quote, villaOwnerInfo, colSpan }) {
    // Connect Payment Flow mirrors the Live Calculation Breakdown shown in
    // EditQuoteModal — same snapshot fields, same numbers, same labels.
    // No recalculation. Two sections:
    //   1. Money composition (= Live Calculation Breakdown)
    //   2. Stripe routing (which connected account each piece lands on)
    const base = parseFloat(quote.supplier_base_price || 0);
    const finalPrice = parseFloat(quote.final_price || 0);
    const editorShare = parseFloat(quote.editor_share_eur || 0);
    const editorIncluded = !!quote.editor_included;
    const platformProfit = parseFloat(quote.platform_profit_eur || 0);
    const agencyProfit = parseFloat(quote.agency_profit_eur || 0);
    const editorIva = parseFloat(quote.editor_iva_eur || 0);
    const agencyIva = parseFloat(quote.agency_iva_eur || 0);
    const platformIva = parseFloat(quote.platform_iva_eur || 0);
    const ivaAmount = parseFloat(quote.iva_amount_eur || 0);
    const stripeFee = parseFloat(quote.stripe_fee_eur || 0);
    const ivaPercent = parseFloat(quote.iva_percent || 10);
    const extrasTotal = parseFloat(quote.extras_total_eur || 0)
        || (Array.isArray(quote.extra_services)
            ? quote.extra_services.reduce((s, x) => s + (parseFloat(x.price) || 0), 0)
            : 0);
    const upfrontStayPart = parseFloat(quote.upfront_stay_eur || 0) || (base * 0.5);
    const balanceLater = Math.max(0, base - upfrontStayPart);
    const isLastMinute = upfrontStayPart >= base - 0.01;

    const isVilla = !!quote.properties;
    const sellingAgent = quote.agents || null;
    const sellingAgentAccount = sellingAgent?.stripe_account_id || null;
    const isB2C = !quote.agent_id || quote.agent_id === SUPER_ADMIN_AGENT_ID;

    const isSelfManagedEditor = isVilla && villaOwnerInfo?.source === 'editor';
    const ownerStripeAccount = villaOwnerInfo?.stripeAccount || null;
    const ownerName = villaOwnerInfo?.name || (isVilla ? 'Owner (unassigned)' : 'Boat Owner');

    // Routing — each connected account receives its commission + its own IVA portion.
    //   Owner: upfrontStay − (editorShare if included) — no IVA, supplier role.
    //   Editor: editorShare + editorIva (only when commission added on top).
    //           Self-managed: folded into owner wallet.
    //   Agency: agencyProfit + agencyIva + extras + stripeFee (retained on agent account).
    //   Platform: platformProfit + platformIva (application_fee_amount).
    const ownerStayNet = editorIncluded
        ? Math.max(0, upfrontStayPart - editorShare)
        : upfrontStayPart;
    const editorRoutingAmount = editorIncluded ? 0 : editorShare + editorIva;
    const ownerSideDepositAmount = isSelfManagedEditor
        ? upfrontStayPart + editorRoutingAmount
        : ownerStayNet;
    const agencyRetained = agencyProfit + agencyIva + extrasTotal + stripeFee;
    const platformRetained = platformProfit + platformIva;
    const clientDepositCharge = (finalPrice - base) + upfrontStayPart;

    const fmt = (n) => `€${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const Box = ({ tone, label, name, sub, amount, account, warn, note }) => {
        const toneMap = {
            client: 'border-cyan-500/40 bg-cyan-500/5 text-cyan-400',
            owner: 'border-purple-500/40 bg-purple-500/5 text-purple-400',
            editor: 'border-fuchsia-500/40 bg-fuchsia-500/5 text-fuchsia-400',
            agency: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-400',
            platform: 'border-amber-500/40 bg-amber-500/5 text-amber-400',
            warn: 'border-red-500/40 bg-red-500/5 text-red-400',
        };
        return (
            <div className={`flex-1 min-w-[160px] rounded-xl border p-3 ${toneMap[warn ? 'warn' : tone] || ''}`}>
                <p className="text-[8px] font-black uppercase tracking-widest opacity-70 mb-1">{label}</p>
                <p className="text-sm font-black truncate" title={name}>{name}</p>
                {sub && <p className="text-[9px] font-bold opacity-70 truncate">{sub}</p>}
                <p className="text-base font-mono font-black mt-2">{fmt(amount)}</p>
                {account && (
                    <p className="text-[9px] font-mono opacity-60 mt-1 truncate" title={account}>{account}</p>
                )}
                {note && <p className="text-[9px] font-bold mt-1 opacity-80">{note}</p>}
                {warn && <p className="text-[9px] font-black mt-1 uppercase tracking-widest">⚠ Stripe Connect missing</p>}
            </div>
        );
    };

    const Arrow = () => (
        <div className="flex items-center justify-center text-text-muted opacity-60 self-center">
            <span className="material-symbols-outlined notranslate text-xl">arrow_forward</span>
        </div>
    );

    // Composition row — exact mirror of Live Calculation Breakdown in modal.
    const compositionRow = (label, amount, opts = {}) => (
        <div className={`flex justify-between text-[11px] ${opts.muted ? 'text-text-muted' : ''}`}>
            <span className={opts.colorClass || 'text-text-secondary'}>{label}</span>
            <span className={`font-bold font-mono ${opts.colorClass || 'text-text-primary'} ${opts.strike ? 'line-through opacity-50' : ''}`}>
                {opts.sign || ''}{fmt(amount)}
            </span>
        </div>
    );

    return (
        <tr className="bg-surface-2/30">
            <td colSpan={colSpan} className="px-5 py-4">
                <div className="rounded-2xl border border-border bg-background/40 p-4 space-y-5">
                    <div className="flex items-center justify-between">
                        <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-text-primary">
                            Connect Payment Flow {isSelfManagedEditor && <span className="text-fuchsia-400 ml-2">(Self-Managed Editor)</span>}
                        </h3>
                        <span className="text-[9px] text-text-muted font-bold uppercase tracking-widest">
                            {isLastMinute ? '100% upfront' : '50% deposit / 50% balance'}
                        </span>
                    </div>

                    {/* SECTION 1 — Money composition (mirrors Live Calculation Breakdown) */}
                    <div className="rounded-xl bg-surface-2 border border-border p-4 space-y-2">
                        <p className="text-[9px] font-black text-text-muted uppercase tracking-widest border-b border-border pb-2 mb-2">
                            Live Calculation Breakdown
                        </p>
                        {compositionRow(`Base (${isVilla ? 'Villa' : 'Boat'} cost)`, base)}
                        {editorShare > 0 && compositionRow(
                            `Editor (Captatore) ${editorIncluded ? '(deducted from owner)' : '(added to price)'}`,
                            editorShare,
                            { colorClass: 'text-purple-400', sign: editorIncluded ? '' : '+ ', strike: editorIncluded }
                        )}
                        {editorIva > 0 && (
                            <div className="flex justify-between text-[11px] pl-3">
                                <span className="text-purple-400/70">↳ Editor IVA {ivaPercent}%</span>
                                <span className="font-bold font-mono text-purple-400/80">+ {fmt(editorIva)}</span>
                            </div>
                        )}
                        {compositionRow('Agency Profit', agencyProfit, { colorClass: 'text-primary', sign: '+ ' })}
                        {extrasTotal > 0 && (
                            <div className="flex justify-between text-[11px] pl-3">
                                <span className="text-text-secondary">↳ Extra Services</span>
                                <span className="font-bold font-mono text-text-primary">+ {fmt(extrasTotal)}</span>
                            </div>
                        )}
                        {agencyIva > 0 && (
                            <div className="flex justify-between text-[11px] pl-3">
                                <span className="text-text-muted">↳ Agency IVA {ivaPercent}% (commission + extras)</span>
                                <span className="font-bold font-mono text-text-primary/80">+ {fmt(agencyIva)}</span>
                            </div>
                        )}
                        {compositionRow('Platform Profit', platformProfit, { colorClass: 'text-primary', sign: '+ ' })}
                        {platformIva > 0 && (
                            <div className="flex justify-between text-[11px] pl-3">
                                <span className="text-text-muted">↳ Platform IVA {ivaPercent}%</span>
                                <span className="font-bold font-mono text-text-primary/80">+ {fmt(platformIva)}</span>
                            </div>
                        )}
                        {compositionRow('Stripe / Card Fee (3%)', stripeFee, { colorClass: 'text-amber-500', sign: '+ ' })}
                        <div className="pt-2 mt-2 border-t border-border flex justify-between text-xs font-black text-primary uppercase">
                            <span>Final Total (Client Pays)</span>
                            <span className="font-mono">{fmt(finalPrice)}</span>
                        </div>
                        <div className="pt-2 mt-2 border-t border-dashed border-border/60 flex justify-between text-[9px] text-text-muted uppercase">
                            <span>Owner upfront cash flow at deposit</span>
                            <span className="font-mono">{fmt(upfrontStayPart)}</span>
                        </div>
                    </div>

                    {/* SECTION 2 — Stripe routing (deposit) */}
                    <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-text-muted mb-2">
                            Stripe Routing — Deposit Charge ({fmt(clientDepositCharge)})
                        </p>
                        <div className="flex items-stretch gap-2 flex-wrap mb-2">
                            <Box tone="client" label="Client pays" name={quote.clients?.full_name || 'Client'}
                                 amount={clientDepositCharge}
                                 note={isB2C ? 'Direct to platform' : `Direct charge → ${sellingAgent?.company_name || 'agency'}`} />
                            <Arrow />
                            <Box tone={isSelfManagedEditor ? 'editor' : 'owner'}
                                 label={isSelfManagedEditor ? 'Editor (self-managed owner)' : 'Owner'}
                                 name={ownerName}
                                 sub={isSelfManagedEditor
                                     ? 'Receives stay + commission · settles real owner manually'
                                     : (editorIncluded && editorShare > 0 ? `Stay − €${Math.round(editorShare)} editor` : undefined)}
                                 amount={ownerSideDepositAmount}
                                 account={ownerStripeAccount}
                                 warn={!ownerStripeAccount && ownerSideDepositAmount > 0} />
                            {!isSelfManagedEditor && editorRoutingAmount > 0 && (
                                <>
                                    <Arrow />
                                    <Box tone="editor" label="Editor commission" name="Linked Captatore"
                                         sub={`${fmt(editorShare)} comm + ${fmt(editorIva)} IVA`}
                                         amount={editorRoutingAmount}
                                         note="Routed only when owner.split_enabled" />
                                </>
                            )}
                            {!isB2C && (
                                <>
                                    <Arrow />
                                    <Box tone="agency" label="Selling Agency (retained)"
                                         name={sellingAgent?.company_name || 'Agency'}
                                         sub={`Profit ${fmt(agencyProfit)} + IVA ${fmt(agencyIva)} + extras + Stripe fee`}
                                         amount={agencyRetained}
                                         account={sellingAgentAccount}
                                         warn={!sellingAgentAccount && agencyRetained > 0} />
                                </>
                            )}
                            <Arrow />
                            <Box tone="platform" label="Platform" name="Ibiza Beyond"
                                 sub={`Profit ${fmt(platformProfit)} + IVA ${fmt(platformIva)}`}
                                 amount={platformRetained}
                                 note="application_fee_amount" />
                        </div>
                    </div>

                    {/* SECTION 3 — Balance later (only when split deposit) */}
                    {!isLastMinute && balanceLater > 0 && (
                        <div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-text-muted mb-2">
                                Balance Later ({fmt(balanceLater)})
                            </p>
                            <div className="flex items-stretch gap-2 flex-wrap">
                                <Box tone="client" label="Client pays balance"
                                     name={quote.clients?.full_name || 'Client'} amount={balanceLater} />
                                <Arrow />
                                <Box tone={isSelfManagedEditor ? 'editor' : 'owner'}
                                     label={isSelfManagedEditor ? 'Editor (self-managed)' : 'Owner'}
                                     name={ownerName} amount={balanceLater}
                                     account={ownerStripeAccount}
                                     warn={!ownerStripeAccount && balanceLater > 0} />
                            </div>
                        </div>
                    )}
                </div>
            </td>
        </tr>
    );
}

export default function QuotesPage() {
    const { user, role, agentData } = useAuth();
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const [editQuote, setEditQuote] = useState(null);
    const [assignQuote, setAssignQuote] = useState(null);
    const [bulkEditOpen, setBulkEditOpen] = useState(false);
    const [viewMode, setViewMode] = useState('list');
    const [selectedQuotes, setSelectedQuotes] = useState([]);
    const [groupByClient, setGroupByClient] = useState(true);
    const [expandedGroups, setExpandedGroups] = useState({});
    const [flowOpenIds, setFlowOpenIds] = useState({});

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
                    supplier_base_price,
                    admin_markup,
                    editor_markup,
                    editor_share_eur,
                    editor_included,
                    extras_total_eur,
                    agency_profit_eur,
                    platform_profit_eur,
                    editor_iva_eur,
                    agency_iva_eur,
                    platform_iva_eur,
                    iva_amount_eur,
                    iva_percent,
                    stripe_fee_eur,
                    upfront_stay_eur,
                    price_breakdown,
                    documenso_document_id,
                    group_details,
                    rental_type,
                    clients(full_name, email, phone_number, dob, id_number, address_street),
                    properties(*),
                    boats(*),
                    agents!quotes_agent_id_fkey(company_name, contract_template, boat_contract_template, phone_number, agency_details, stripe_account_id)
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

    // Resolve villa.owner_id -> {name, source: 'owner'|'editor', stripeAccount} so the
    // payment-flow viewer can show self-managed editors (owner_id pointing to an agents row).
    const ownerIdsForLookup = Array.from(new Set(
        (quotes || []).map(q => q.properties?.owner_id).filter(Boolean)
    ));
    const { data: villaOwnerMap = {} } = useQuery({
        queryKey: ['villaOwnerMap', ownerIdsForLookup.sort().join(',')],
        queryFn: async () => {
            if (ownerIdsForLookup.length === 0) return {};
            const map = {};
            const { data: ownerRows } = await supabase
                .from('owners')
                .select('id, name, stripe_account_id')
                .in('id', ownerIdsForLookup);
            for (const o of (ownerRows || [])) {
                map[o.id] = { name: o.name, source: 'owner', stripeAccount: o.stripe_account_id || null };
            }
            const missing = ownerIdsForLookup.filter(id => !map[id]);
            if (missing.length > 0) {
                const { data: agentRows } = await supabase
                    .from('agents')
                    .select('id, company_name, email, stripe_account_id')
                    .in('id', missing);
                for (const a of (agentRows || [])) {
                    map[a.id] = {
                        name: a.company_name || a.email || a.id.slice(0, 8),
                        source: 'editor',
                        stripeAccount: a.stripe_account_id || null,
                    };
                }
            }
            return map;
        },
        enabled: ownerIdsForLookup.length > 0,
        staleTime: 1000 * 60 * 5,
    });

    const refreshData = () => {
        queryClient.invalidateQueries({ queryKey: ['quotes'] });
    };

    // Open a quote modal when arriving with ?openQuote=<id> (used by notifications).
    useEffect(() => {
        const targetId = searchParams.get('openQuote');
        if (!targetId || quotes.length === 0 || editQuote?.id === targetId) return;
        const target = quotes.find(q => q.id === targetId);
        if (target) {
            setEditQuote(target);
            const next = new URLSearchParams(searchParams);
            next.delete('openQuote');
            setSearchParams(next, { replace: true });
        }
    }, [searchParams, quotes, editQuote?.id, setSearchParams]);

    const toggleGroup = (clientId) => {
        setExpandedGroups(prev => ({ ...prev, [clientId]: !prev[clientId] }));
    };

    const setGroupQualification = async (groupQuotes, qualType) => {
        await Promise.all(
            groupQuotes.map(q =>
                supabase.from('quotes').update({
                    group_details: { ...(q.group_details || {}), type: qualType }
                }).eq('id', q.id)
            )
        );
        refreshData();
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

    const resolveOwnerOrCapturerContact = async (ownerId) => {
        if (!ownerId) return null;
        const { data: owner } = await supabase
            .from('owners')
            .select('name, phone_number, agent_id')
            .eq('id', ownerId)
            .maybeSingle();
        if (owner?.phone_number) {
            return { name: owner.name, phone: owner.phone_number, source: 'owner' };
        }
        if (owner?.agent_id) {
            const { data: cap } = await supabase
                .from('agents')
                .select('company_name, email, phone_number')
                .eq('id', owner.agent_id)
                .maybeSingle();
            if (cap?.phone_number) {
                return { name: cap.company_name || cap.email || 'Capturer', phone: cap.phone_number, source: 'capturer' };
            }
        }
        const { data: agentSelf } = await supabase
            .from('agents')
            .select('company_name, email, phone_number')
            .eq('id', ownerId)
            .maybeSingle();
        if (agentSelf?.phone_number) {
            return { name: agentSelf.company_name || agentSelf.email || 'Editor', phone: agentSelf.phone_number, source: 'editor' };
        }
        return null;
    };

    const handleWhatsAppShare = async (quote) => {
        // Update status to 'sent' if it's currently 'draft'
        if (quote.status === 'draft') {
            await handleStatusChange(quote.id, 'sent');
        }

        const url = `${window.location.origin}/quote/${quote.id}`;
        const propertyName = quote.properties?.villa_name || quote.boats?.boat_name || 'your stay in Ibiza';
        const message = `Hello ${quote.clients?.full_name || 'there'}! This exclusive proposal was prepared specifically for you: ${url}\n\nPlease note this offer is valid for 3 days, as properties can be booked by others at any time.`;
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

        const ownerId = quote.properties?.owner_id || quote.boats?.owner_id;
        if (!ownerId) {
            alert("This property does not have an owner assigned.");
            return;
        }

        const contact = await resolveOwnerOrCapturerContact(ownerId);
        if (!contact) {
            alert("No phone number found for this owner or its capturer. Please add it in Owner / Agent Management.");
            return;
        }

        const confirmUrl = `${window.location.origin}/confirm-availability/${quote.id}`;
        const villaName = quote.properties?.villa_name || quote.boats?.boat_name;
        const isOnRequest = !quote.final_price || parseFloat(quote.final_price) === 0;
        const msg = isOnRequest
            ? `Hello ${contact.name}, we have a booking request for ${villaName} from ${new Date(quote.check_in).toLocaleDateString()} to ${new Date(quote.check_out).toLocaleDateString()}. The price is on request — please confirm availability and quote your price here: ${confirmUrl}`
            : `Hello ${contact.name}, we have a booking request for ${villaName} from ${new Date(quote.check_in).toLocaleDateString()} to ${new Date(quote.check_out).toLocaleDateString()}. Please confirm availability here: ${confirmUrl}`;

        const encodedMsg = encodeURIComponent(msg);
        const waUrl = `https://wa.me/${contact.phone.replace(/\s+/g, '')}?text=${encodedMsg}`;

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
            .from('property_photos')
            .select('url')
            .or(`v_uuid.eq.${quote.properties?.v_uuid},boat_uuid.eq.${quote.boats?.v_uuid}`)
            .order('sort_order', { ascending: true })
            .limit(4);

        const doc = new jsPDF('p', 'mm', 'a4');
        const villa = quote.properties;
        const boat = quote.boats;
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
        const contractTemplate = quote.boats 
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
            '{{client_phone}}': quote.clients?.phone_number || '—',
            '{{client_address}}': quote.clients?.address_street || '[To be filled in registration]',
            '{{client_passport}}': quote.clients?.id_number || '[To be filled in registration]',
            '{{client_dob}}': quote.clients?.dob || '—',
            
            '{{agency_name}}': agent?.company_name || 'Ibiza Beyond',
            '{{agency_address}}': agent?.address || agent?.agency_details || 'Ibiza, Balearic Islands',
            '{{agency_tax_id}}': agent?.tax_id || agent?.agency_details || '—',
            '{{agency_email}}': agent?.email || '—',
            '{{agency_phone}}': agent?.phone_number || '—',

            '{{villa_name}}': quote.properties?.villa_name || quote.boats?.boat_name || 'Our Listing',
            '{{property_name}}': quote.properties?.villa_name || quote.boats?.boat_name || 'Our Listing',
            '{{villa_license}}': quote.properties?.license || '—',
            '{{villa_address}}': quote.properties?.location || 'Ibiza',
            '{{property_location}}': quote.properties?.location || 'Ibiza',
            '{{max_guests}}': quote.properties?.sleeps || quote.boats?.capacity_day || '—',
            
            '{{boat_name}}': quote.boats?.boat_name || '',
            '{{platform_name}}': 'Ibiza Beyond',
            '{{today}}': new Date().toLocaleDateString('it-IT'),
            
            '{{check_in}}': quote.check_in ? new Date(quote.check_in).toLocaleDateString('en-GB') : '—',
            '{{check_out}}': quote.check_out ? new Date(quote.check_out).toLocaleDateString('en-GB') : '—',
            '{{final_price}}': parseFloat(quote.final_price || 0).toLocaleString('en-GB', { style: 'currency', currency: 'EUR' }),
            '{{total_price}}': parseFloat(quote.final_price || 0).toLocaleString('en-GB', { style: 'currency', currency: 'EUR' }),
            '{{deposit_percent}}': isLastMinute ? '100' : '50',
            '{{balance_percent}}': isLastMinute ? '0' : '50',
            '{{balance_due_days}}': '30',
            '{{security_deposit_amount}}': parseFloat(quote.properties?.security_deposit || quote.boats?.security_deposit || 0).toLocaleString('en-GB', { style: 'currency', currency: 'EUR' }),

            // Explicit mappings for Italian labels in [BRACKETS]
            '[NOME CLIENTE]': quote.clients?.full_name || 'Valued Client',
            '[NOME AGENTE/SOCIETÀ]': agent?.company_name || 'Ibiza Beyond',
            '[NOME VILLA]': quote.properties?.villa_name || 'Villa',
            '[DATA CHECK-IN]': quote.check_in ? new Date(quote.check_in).toLocaleDateString('it-IT') : '—',
            '[DATA CHECK-OUT]': quote.check_out ? new Date(quote.check_out).toLocaleDateString('it-IT') : '—',
            '[IMPORTO TOTALE]': parseFloat(quote.final_price || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }),
            '[IMPORTO DEPOSITO]': parseFloat(quote.properties?.security_deposit || quote.boats?.security_deposit || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }),
            '[NUMERO LICENZA ETV]': quote.properties?.license || '—',
            '[INDIRIZZO VILLA]': quote.properties?.location || 'Ibiza',
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
                    
                    <button 
                        onClick={() => setGroupByClient(!groupByClient)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest border transition-all flex items-center gap-2 ${groupByClient ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-surface-2 border-border text-text-muted hover:text-text-primary'}`}
                    >
                        <span className="material-symbols-outlined notranslate text-[18px]">{groupByClient ? 'group_work' : 'list'}</span>
                        {groupByClient ? 'Grouped by Client' : 'Flat List'}
                    </button>
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
                                <tr>
                                    <th className="w-10 px-5 py-4">
                                        <input 
                                            type="checkbox" 
                                            className="rounded border-border bg-surface text-primary focus:ring-primary"
                                            onChange={(e) => {
                                                if (e.target.checked) setSelectedQuotes(quotes.map(q => q.id));
                                                else setSelectedQuotes([]);
                                            }}
                                            checked={selectedQuotes.length === quotes.length && quotes.length > 0}
                                        />
                                    </th>
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
                            <tbody>
                                {(() => {
                                    const colCount = role === 'admin' || role === 'super_admin' ? 12 : (role === 'agency_admin' ? 11 : 10);
                                    const renderQuoteRow = (q, isNested = false) => (
                                        <React.Fragment key={q.id}>
                                        <tr className={`hover:bg-primary/5 transition-colors group ${selectedQuotes.includes(q.id) ? 'bg-primary/5' : ''} ${isNested ? 'bg-surface/30' : ''}`}>
                                            <td className="px-5 py-4">
                                                <input 
                                                    type="checkbox" 
                                                    className="rounded border-border bg-surface text-primary focus:ring-primary"
                                                    checked={selectedQuotes.includes(q.id)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) setSelectedQuotes([...selectedQuotes, q.id]);
                                                        else setSelectedQuotes(selectedQuotes.filter(id => id !== q.id));
                                                    }}
                                                />
                                            </td>
                                            <td className="px-5 py-4 font-bold text-text-primary max-w-[180px] truncate">
                                                <div className="flex flex-col">
                                                    <span className="truncate">{q.properties?.villa_name || q.boats?.boat_name || '—'}</span>
                                                    <span className="text-[10px] text-text-muted font-medium uppercase tracking-wider">
                                                        {q.properties ? 'Villa' : q.boats ? 'Boat' : 'Unknown'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-5 py-4 text-text-secondary font-medium">
                                                {isNested ? (
                                                    <span className="text-[10px] text-text-muted uppercase tracking-tighter italic">Proposal Item</span>
                                                ) : (
                                                    q.clients?.full_name || '—'
                                                )}
                                            </td>
                                            
                                            {(role === 'admin' || role === 'super_admin' || role === 'agency_admin') && (
                                                <td className="px-5 py-4">
                                                    <div className="flex flex-col">
                                                        <span className="text-text-primary font-bold text-xs">{q.agent_id === user.id ? 'You' : (q.agents?.company_name || 'Individual Agent')}</span>
                                                        <span className="text-[9px] text-text-muted uppercase tracking-tighter">ID: {q.agent_id?.slice(0,8) || '—'}</span>
                                                    </div>
                                                </td>
                                            )}
                                            <td className="px-5 py-4 text-xs whitespace-nowrap">
                                                <span className="text-text-muted">
                                                    {q.check_in ? `${new Date(q.check_in).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} → ${new Date(q.check_out).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })}` : '—'}
                                                </span>
                                                {q.rental_type && q.rental_type !== 'daily' && (
                                                    <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-primary/15 text-primary">
                                                        {q.rental_type}
                                                    </span>
                                                )}
                                            </td>
                                            {(role === 'admin' || role === 'super_admin') && (
                                                 <>
                                                     <td className="px-5 py-4 text-right">
                                                         <p className="font-mono text-[13px] text-text-primary">€{parseFloat(q.supplier_base_price || 0).toLocaleString()}</p>
                                                         <span className="text-[8px] text-text-muted uppercase font-black">Owner Net</span>
                                                     </td>
                                                     <td className="px-5 py-4 text-right">
                                                         {(() => {
                                                             const platformItem = q.price_breakdown?.find(i => i.label?.includes('Platform'));
                                                             const platformProfit = platformItem ? platformItem.amount : 0;
                                                             return (
                                                                 <>
                                                                     <p className="font-mono text-[13px] text-amber-500/90 font-bold">€{Math.round(platformProfit).toLocaleString()}</p>
                                                                     <span className="text-[8px] text-amber-600/60 uppercase font-black">Platform Profit</span>
                                                                 </>
                                                             );
                                                         })()}
                                                     </td>
                                                 </>
                                             )}

                                             <td className="px-5 py-4 text-right">
                                                 {(() => {
                                                     const agencyItem = q.price_breakdown?.find(i => i.label?.includes('Agency'));
                                                     const agencyProfit = agencyItem ? agencyItem.amount : 0;
                                                     
                                                     const isB2C = !q.agent_id || q.agent_id === '72241c14-09ed-4227-a01e-9bdeefdd0c8d';
                                                     return (
                                                         <div className="flex flex-col items-end">
                                                             <span className={`font-mono text-[13px] font-bold ${isB2C ? 'text-cyan-400' : 'text-emerald-400'}`}>
                                                                 €{Math.round(agencyProfit).toLocaleString()}
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

                                                        {role === 'super_admin' && (
                                                            <button
                                                                onClick={() => setFlowOpenIds(prev => ({ ...prev, [q.id]: !prev[q.id] }))}
                                                                className={`size-8 rounded-lg border flex items-center justify-center transition-all ${flowOpenIds[q.id] ? 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-400' : 'bg-surface-2 border-border text-text-muted hover:text-fuchsia-400'}`}
                                                                title="Connect Payment Flow"
                                                            >
                                                                <span className="material-symbols-outlined notranslate text-[18px]">account_tree</span>
                                                            </button>
                                                        )}

                                                        {(role === 'admin' || role === 'super_admin') && (q.status === 'draft' || q.status === 'details_requested' || q.status === 'waiting_owner') && (q.properties?.owner_id || q.boats?.owner_id) && (
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
                                        {role === 'super_admin' && flowOpenIds[q.id] && (
                                            <PaymentFlowDiagram
                                                quote={q}
                                                villaOwnerInfo={q.properties?.owner_id ? villaOwnerMap[q.properties.owner_id] : null}
                                                colSpan={colCount}
                                            />
                                        )}
                                        </React.Fragment>
                                    );

                                    if (!groupByClient) {
                                        return quotes.map(q => renderQuoteRow(q));
                                    }

                                    // Grouping Logic
                                    const groups = quotes.reduce((acc, q) => {
                                        const cId = q.client_id || 'unassigned';
                                        if (!acc[cId]) acc[cId] = {
                                            client: q.clients,
                                            quotes: []
                                        };
                                        acc[cId].quotes.push(q);
                                        return acc;
                                    }, {});

                                    const QUAL_OPTIONS = [
                                        { value: 'family', label: 'Family', color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' },
                                        { value: 'couple', label: 'Couple', color: 'bg-pink-500/10 text-pink-400 border-pink-500/20' },
                                        { value: 'friends', label: 'Friends', color: 'bg-primary/10 text-primary border-primary/20' },
                                        { value: 'business', label: 'Business', color: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' },
                                        { value: 'group', label: 'Group', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
                                        { value: 'vip', label: 'VIP', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
                                    ];

                                    return Object.entries(groups).map(([clientId, group]) => {
                                        const isExpanded = !!expandedGroups[clientId];
                                        const currentQual = group.quotes[0]?.group_details?.type || null;
                                        const qualOption = QUAL_OPTIONS.find(o => o.value === currentQual);

                                        return (
                                        <React.Fragment key={clientId}>
                                            <tr
                                                className="bg-surface-2/40 cursor-pointer hover:bg-surface-2/60 transition-colors"
                                                onClick={() => toggleGroup(clientId)}
                                            >
                                                <td colSpan={role === 'admin' || role === 'super_admin' ? 12 : 10} className="px-5 py-4">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-4">
                                                            <span className={`material-symbols-outlined notranslate text-text-muted transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                                                                chevron_right
                                                            </span>
                                                            <div className="size-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20">
                                                                <span className="material-symbols-outlined notranslate">person_search</span>
                                                            </div>
                                                            <div>
                                                                <p className="font-black text-sm uppercase tracking-[0.1em] text-text-primary">
                                                                    {group.client?.full_name || 'Individual Inquiry'}
                                                                </p>
                                                                <div className="flex items-center gap-2 mt-0.5">
                                                                    <span className="text-[10px] bg-primary text-black px-2 py-0.5 rounded font-black uppercase">
                                                                        {group.quotes.length} {group.quotes.length === 1 ? 'Option' : 'Options'}
                                                                    </span>
                                                                    {qualOption && (
                                                                        <span className={`text-[9px] px-2 py-0.5 rounded border font-black uppercase ${qualOption.color}`}>
                                                                            {qualOption.label}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                                                            {/* Qualification selector */}
                                                            <select
                                                                value={currentQual || ''}
                                                                onChange={e => setGroupQualification(group.quotes, e.target.value)}
                                                                className="input-theme text-[10px] py-1 px-2 rounded-lg font-black uppercase tracking-widest"
                                                            >
                                                                <option value="">— Qualifica —</option>
                                                                {QUAL_OPTIONS.map(o => (
                                                                    <option key={o.value} value={o.value}>{o.label}</option>
                                                                ))}
                                                            </select>

                                                            <div className="flex bg-background rounded-xl p-1 border border-border shadow-sm">
                                                                <button
                                                                    onClick={() => {
                                                                        const ids = group.quotes.map(q => q.id);
                                                                        const url = `${window.location.origin}/quote/${ids.join(',')}`;
                                                                        navigator.clipboard.writeText(url);
                                                                        alert('Unified portal link copied!');
                                                                    }}
                                                                    className="px-4 py-2 hover:bg-surface-2 rounded-lg text-[10px] font-black uppercase tracking-widest text-text-primary transition-all flex items-center gap-2"
                                                                >
                                                                    <span className="material-symbols-outlined notranslate text-[16px]">content_copy</span>
                                                                    Link
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        const ids = group.quotes.map(q => q.id);
                                                                        const url = `${window.location.origin}/quote/${ids.join(',')}`;
                                                                        const firstQuote = group.quotes[0];
                                                                        const message = `Hello ${firstQuote.clients?.full_name || 'there'}! These customized proposals for Ibiza have been curated for you: ${url}\n\nPlease note this offer is valid for 3 days, as properties can be booked by others at any time.`;
                                                                        const whatsappUrl = `https://wa.me/${firstQuote.clients?.phone_number?.replace(/\+/g, '').replace(/\s/g, '') || ''}?text=${encodeURIComponent(message)}`;
                                                                        window.open(whatsappUrl, '_blank');
                                                                    }}
                                                                    className="px-4 py-2 hover:bg-[#25D366]/10 hover:text-[#25D366] rounded-lg text-[10px] font-black uppercase tracking-widest text-text-primary transition-all flex items-center gap-2"
                                                                >
                                                                    <svg className="size-3 fill-current" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.72.94 3.659 1.437 5.634 1.437h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                                                    WhatsApp
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && group.quotes.map(q => renderQuoteRow(q, true))}
                                        </React.Fragment>
                                        );
                                    });
                                })()}
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

            {selectedQuotes.length > 0 && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-8 duration-300">
                    <div className="bg-surface-2 border border-primary/30 p-4 rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-6 backdrop-blur-2xl">
                        <div className="flex items-center gap-3 pl-2">
                            <div className="size-8 bg-primary rounded-full flex items-center justify-center text-background-dark font-black text-xs">
                                {selectedQuotes.length}
                            </div>
                            <span className="text-xs font-bold text-text-primary uppercase tracking-widest italic">Quotes Selected</span>
                        </div>
                        
                        <div className="h-8 w-px bg-border"></div>
                        
                        <div className="flex items-center gap-2">
                            <button 
                                onClick={() => {
                                    const url = `${window.location.origin}/quote/${selectedQuotes.join(',')}`;
                                    navigator.clipboard.writeText(url);
                                    alert('Unified portal link copied!');
                                }}
                                className="px-5 py-2.5 bg-primary text-background-dark rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-primary/20 flex items-center gap-2"
                            >
                                <span className="material-symbols-outlined notranslate text-[18px]">share</span>
                                Copy Portal Link
                            </button>
                            
                            <button 
                                onClick={() => {
                                    const qList = quotes.filter(q => selectedQuotes.includes(q.id));
                                    const firstQuote = qList[0];
                                    const url = `${window.location.origin}/quote/${selectedQuotes.join(',')}`;
                                    const message = `Hello ${firstQuote.clients?.full_name || 'there'}! Here are your bespoke villa proposals for Ibiza: ${url}`;
                                    const whatsappUrl = `https://wa.me/${firstQuote.clients?.phone_number?.replace(/\+/g, '').replace(/\s/g, '') || ''}?text=${encodeURIComponent(message)}`;
                                    window.open(whatsappUrl, '_blank');
                                }}
                                className="px-5 py-2.5 bg-[#25D366] text-white rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg shadow-green-500/20 flex items-center gap-2"
                            >
                                <svg className="size-4 fill-current" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.72.94 3.659 1.437 5.634 1.437h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                WhatsApp Portal Link
                            </button>

                            <button
                                onClick={() => setBulkEditOpen(true)}
                                className="px-5 py-2.5 bg-surface border border-primary/40 text-primary rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-all flex items-center gap-2"
                            >
                                <span className="material-symbols-outlined notranslate text-[18px]">tune</span>
                                Bulk Edit
                            </button>

                            <button
                                onClick={() => setSelectedQuotes([])}
                                className="size-10 flex items-center justify-center text-text-muted hover:text-red-400 transition-colors"
                            >
                                <span className="material-symbols-outlined notranslate">close</span>
                            </button>
                        </div>
                    </div>
                </div>
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
                                <option value="">Platform Administration</option>
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

            {bulkEditOpen && (
                <BulkEditQuotesModal
                    ids={selectedQuotes}
                    role={role}
                    onClose={() => setBulkEditOpen(false)}
                    onSaved={() => {
                        setBulkEditOpen(false);
                        setSelectedQuotes([]);
                        refreshData();
                    }}
                />
            )}

            {/* Floating Selection Bar for Unified Links */}
            {selectedQuotes.length > 0 && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-surface-2/95 border-2 border-primary/30 backdrop-blur-md px-6 py-4 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-6 animate-in slide-in-from-bottom-10 fade-in duration-300">
                    <div className="flex items-center gap-2">
                        <div className="bg-primary text-black size-6 rounded-full flex items-center justify-center text-[10px] font-black">
                            {selectedQuotes.length}
                        </div>
                        <span className="text-[10px] font-black text-white/60 uppercase tracking-widest whitespace-nowrap">Selected</span>
                    </div>
                    <div className="h-8 w-px bg-white/10" />
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={() => {
                                const url = `${window.location.origin}/quote/${selectedQuotes.join(',')}`;
                                navigator.clipboard.writeText(url);
                                alert('Unified portal link copied for selected items!');
                            }}
                            className="px-4 py-2 bg-primary text-black rounded-full text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all flex items-center gap-2"
                        >
                            <span className="material-symbols-outlined notranslate text-[16px]">content_copy</span>
                            Copy Link
                        </button>
                        <button 
                            onClick={() => {
                                const url = `${window.location.origin}/quote/${selectedQuotes.join(',')}`;
                                const q = quotes.find(quote => quote.id === selectedQuotes[0]);
                                const message = `Hello ${q.clients?.full_name || 'there'}! These customized proposals for Ibiza have been curated for you: ${url}\n\nPlease note this offer is valid for 3 days, as properties can be booked by others at any time.`;
                                const whatsappUrl = `https://wa.me/${q.clients?.phone_number?.replace(/\+/g, '').replace(/\s/g, '') || ''}?text=${encodeURIComponent(message)}`;
                                window.open(whatsappUrl, '_blank');
                            }}
                            className="px-4 py-2 bg-[#25D366] text-white rounded-full text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all flex items-center gap-2 shadow-lg shadow-[#25D366]/20"
                        >
                            <svg className="size-3 fill-current" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.72.94 3.659 1.437 5.634 1.437h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                            WhatsApp
                        </button>
                        <button 
                            onClick={() => setSelectedQuotes([])}
                            className="px-4 py-2 text-white/40 hover:text-white rounded-full text-[10px] font-black uppercase tracking-widest transition-all"
                        >
                            Clear
                        </button>
                    </div>
                </div>
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

function BulkEditQuotesModal({ ids, role, onClose, onSaved }) {
    const [agentId, setAgentId] = useState('');
    const [agentMarkup, setAgentMarkup] = useState('');
    const [adminMarkup, setAdminMarkup] = useState('');
    const [status, setStatus] = useState('');
    const [saving, setSaving] = useState(false);

    const isAdmin = role === 'admin';

    async function handleSave() {
        const patch = {};
        if (agentId) patch.agent_id = agentId;
        if (agentMarkup !== '') patch.agent_markup = parseFloat(agentMarkup);
        if (isAdmin && adminMarkup !== '') patch.admin_markup = parseFloat(adminMarkup);
        if (status) patch.status = status;

        if (Object.keys(patch).length === 0) {
            alert('No changes to apply.');
            return;
        }

        setSaving(true);
        const { error } = await supabase.from('quotes').update(patch).in('id', ids);
        setSaving(false);
        if (error) { alert(error.message); return; }
        onSaved();
    }

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in duration-200">
                <div className="p-4 border-b border-border flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-text-primary">Bulk Edit Quotes</h3>
                        <p className="text-[10px] text-text-muted uppercase tracking-widest">{ids.length} selected · empty fields skipped</p>
                    </div>
                    <button onClick={onClose}><span className="material-symbols-outlined notranslate text-sm">close</span></button>
                </div>
                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">Assign Agent</label>
                        <select
                            value={agentId}
                            onChange={(e) => setAgentId(e.target.value)}
                            className="w-full input-theme p-2 text-sm"
                        >
                            <option value="">— Leave unchanged —</option>
                            <option value="72241c14-09ed-4227-a01e-9bdeefdd0c8d">Platform Administration</option>
                            <AgentsList />
                        </select>
                    </div>

                    <div>
                        <label className="block text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">Agent Markup (%)</label>
                        <input
                            type="number"
                            step="0.01"
                            value={agentMarkup}
                            onChange={(e) => setAgentMarkup(e.target.value)}
                            placeholder="Leave empty to keep current"
                            className="w-full input-theme p-2 text-sm"
                        />
                    </div>

                    {isAdmin && (
                        <div>
                            <label className="block text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">Admin Markup (%)</label>
                            <input
                                type="number"
                                step="0.01"
                                value={adminMarkup}
                                onChange={(e) => setAdminMarkup(e.target.value)}
                                placeholder="Leave empty to keep current"
                                className="w-full input-theme p-2 text-sm"
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">Status</label>
                        <select
                            value={status}
                            onChange={(e) => setStatus(e.target.value)}
                            className="w-full input-theme p-2 text-sm"
                        >
                            <option value="">— Leave unchanged —</option>
                            <option value="draft">Draft</option>
                            <option value="sent">Sent</option>
                            <option value="booked">Booked</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="expired">Expired</option>
                        </select>
                    </div>
                </div>
                <div className="p-4 border-t border-border flex items-center justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-xs font-black uppercase tracking-widest text-text-muted hover:text-text-primary"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 bg-primary text-background-dark rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50"
                    >
                        {saving ? 'Applying…' : `Apply to ${ids.length}`}
                    </button>
                </div>
            </div>
        </div>
    );
}
