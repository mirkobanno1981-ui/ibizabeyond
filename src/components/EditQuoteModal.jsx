import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { effectiveCapturerCommission } from '../lib/capturerCommission';

const EditQuoteModal = ({ quote, onClose, onSaved }) => {
    const { user, role, agentData } = useAuth();
    const isAgencyLeader = agentData?.agent_type === 'agency' || agentData?.agent_type === 'agency_admin' || agentData?.agent_type === 'owner'; // 'owner' in this context often means agency owner
    const canManageMargins = role === 'admin' || role === 'super_admin' || isAgencyLeader;
    const [margin, setMargin] = useState(quote.agent_markup || 15);
    const [platformMargin, setPlatformMargin] = useState(quote.admin_markup || 0);
    const _capturerSpecInit = effectiveCapturerCommission(quote.properties, quote.rental_type || 'daily');
    const [editorMargin, setEditorMargin] = useState(
        parseFloat(quote.editor_markup) || _capturerSpecInit.pct || 0
    );
    // Default 'add' so super_admin's editor % visibly affects Total Price.
    // If existing quote already has an explicit mode persisted, respect it.
    const [editorMarkupMode, setEditorMarkupMode] = useState(quote.editor_markup_mode || 'add');
    const [inputUnit, setInputUnit] = useState('pct'); // 'pct' | 'eur'
    const [extraServices, setExtraServices] = useState(quote.extra_services || []);
    const [manualPrice, setManualPrice] = useState(quote.final_price || 0);
    const [isManual, setIsManual] = useState(quote.is_manual_price || false);
    const [useStripeFee, setUseStripeFee] = useState(quote.stripe_fee_included || false);
    const [useForexFee, setUseForexFee] = useState(quote.forex_fee_included || false);
    const [saving, setSaving] = useState(false);
    const [agents, setAgents] = useState([]);
    const [assignedAgentId, setAssignedAgentId] = useState(quote.agent_id);
    const [depositPaid, setDepositPaid] = useState(quote.deposit_paid || false);
    const [balancePaid, setBalancePaid] = useState(quote.balance_paid || false);
    const [ivaPercent, setIvaPercent] = useState(10);
    const [ownerPhone, setOwnerPhone] = useState('');
    const [ownerName, setOwnerName] = useState('');
    
    // Rental type
    const [rentalType, setRentalType] = useState(quote.rental_type || 'daily');

    const villaRentalConfigs = quote.properties?.rental_type_configs || {};
    const RENTAL_TYPE_LABELS = {
        daily: 'Daily / Nightly',
        monthly: 'Monthly',
        seasonal: 'Seasonal (months)',
        annual: 'Annual',
    };
    const enabledRentalTypes = ['daily', 'monthly', 'seasonal', 'annual'].filter(t => {
        if (t === 'daily') return true;
        return villaRentalConfigs[t]?.enabled === true;
    });

    const applyRentalTypeDefaults = (type) => {
        const cfg = villaRentalConfigs[type];
        if (!cfg) return;
        const baseAmt = parseFloat(quote.supplier_base_price || 0);
        const mode = cfg.commission_mode || 'percent';
        const pctFromCfg = mode === 'fixed' && baseAmt > 0
            ? +(((cfg.commission_amount || 0) / baseAmt) * 100).toFixed(2)
            : (cfg.commission_pct ?? margin);
        setMargin(pctFromCfg);
        setPlatformMargin(cfg.platform_retention_pct ?? platformMargin);
    };

    const handleRentalTypeChange = (type) => {
        setRentalType(type);
        applyRentalTypeDefaults(type);
    };

    // Group Qualification State
    const [groupType, setGroupType] = useState(quote.group_details?.type || 'family');
    const [numChildren, setNumChildren] = useState(quote.group_details?.children || 0);
    const [friendsComposition, setFriendsComposition] = useState(quote.group_details?.composition || '');
    const [isCouples, setIsCouples] = useState(quote.group_details?.is_couples || false);
    const [hasPets, setHasPets] = useState(quote.group_details?.has_pets || false);


    useEffect(() => {
        async function fetchData() {
            const [agentsRes, settingsRes] = await Promise.all([
                supabase.from('agents').select('id, company_name, markup_percent, admin_margin, agency_split_pct'),
                supabase.from('margin_settings').select('iva_percent').eq('id', 1).single()
            ]);
            const fetchedAgents = agentsRes.data || [];
            setAgents(fetchedAgents);
            if (settingsRes.data) setIvaPercent(parseFloat(settingsRes.data.iva_percent) || 10);

            // Fetch current agent details to get default split/markup
            const currentAgent = fetchedAgents.find(a => a.id === assignedAgentId);

            // If quote has no markup set, apply the agent's default markup (or 12% as per new rules)
            if (!quote.agent_markup && currentAgent) {
                setMargin(currentAgent.markup_percent || 12);
            }

            // Platform markup should be 0 by default now, as we split the total margin
            if (!quote.admin_markup && currentAgent) {
                // We'll use platformMargin state to store the PLATFORM SHARE if needed, 
                // but for now let's keep it as is and use the agent's split in calculations
                setPlatformMargin(currentAgent.admin_margin || 0);
            }

            // Fetch Owner Info (Admins only)
            const ownerId = quote.properties?.owner_id || quote.boats?.owner_id;
            if (ownerId && (role === 'admin' || role === 'super_admin')) {
                const { data: ownerData } = await supabase
                    .from('owners')
                    .select('name, phone_number')
                    .eq('id', ownerId)
                    .single();
                if (ownerData) {
                    setOwnerPhone(ownerData.phone_number || '');
                    setOwnerName(ownerData.name || '');
                }
            }
        }
        fetchData();
    }, [quote, assignedAgentId]);

    const addService = () => setExtraServices([...extraServices, { name: '', price: 0 }]);
    const removeService = (idx) => setExtraServices(extraServices.filter((_, i) => i !== idx));
    const updateService = (idx, field, val) => {
        const newServices = [...extraServices];
        newServices[idx][field] = field === 'price' ? parseFloat(val) || 0 : val;
        setExtraServices(newServices);
    };

    const calculateAutoPrice = () => {
        const base = parseFloat(quote.supplier_base_price || 0);
        const agentPct = parseFloat(margin || 0);
        const platformPct = parseFloat(platformMargin || 0);
        const editorPct = parseFloat(editorMargin || 0);
        const editorAdds = editorMarkupMode === 'add' && editorPct > 0;

        const priceWithEditor = editorAdds ? base * (1 + editorPct / 100) : base;
        const priceWithPlatform = priceWithEditor * (1 + platformPct / 100);
        const priceWithAgent = priceWithPlatform * (1 + agentPct / 100);

        const extraTotal = extraServices.reduce((sum, s) => sum + (s.price || 0), 0);
        const subtotal = priceWithAgent + extraTotal;
        const ivaAmount = (subtotal - base) * (ivaPercent / 100);
        const priceBeforeFees = subtotal + ivaAmount;

        const stripeFee = useStripeFee ? priceBeforeFees * 0.03 : 0;
        const forexFee = useForexFee ? priceBeforeFees * 0.02 : 0;

        return Math.round(priceBeforeFees + stripeFee + forexFee);
    };

    // Convert between % and € (€ relative to supplier_base_price)
    const base = parseFloat(quote.supplier_base_price || 0);
    const pctToEur = (pct) => Math.round(base * (parseFloat(pct) || 0) / 100);
    const eurToPct = (eur) => base > 0 ? +(((parseFloat(eur) || 0) / base) * 100).toFixed(2) : 0;
    const displayValue = (pct) => inputUnit === 'eur' ? pctToEur(pct) : pct;
    const handleInputChange = (raw, setter) => {
        const v = parseFloat(raw) || 0;
        setter(inputUnit === 'eur' ? eurToPct(v) : v);
    };

    useEffect(() => {
        if (!isManual) {
            setManualPrice(calculateAutoPrice());
        }
    }, [margin, platformMargin, editorMargin, editorMarkupMode, extraServices, isManual, useStripeFee, useForexFee, ivaPercent]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const finalPrice = isManual ? manualPrice : calculateAutoPrice();
            const currentAgent = agents.find(a => a.id === assignedAgentId);

            const baseAmt = parseFloat(quote.supplier_base_price || 0);
            const extraTotal = extraServices.reduce((sum, s) => sum + (s.price || 0), 0);

            const newBreakdown = [];
            const baseLabel = quote.properties ? 'Base Accommodation' : 'Base Charter';
            newBreakdown.push({ label: baseLabel, amount: Math.round(baseAmt), desc: 'Base cost' });

            let platformProfit;
            let agencyProfit;
            let editorShare = 0;

            if (role === 'super_admin') {
                // Super admin: use exact per-quote commission overrides (multiplicative chain)
                const editorPct = parseFloat(editorMargin || 0);
                const platformPct = parseFloat(platformMargin || 0);
                const agentPct = parseFloat(margin || 0);
                const editorAdds = editorMarkupMode === 'add' && editorPct > 0;

                editorShare = editorAdds ? baseAmt * (editorPct / 100) : (editorMarkupMode === 'deduct' ? baseAmt * (editorPct / 100) : 0);
                const baseForPlatform = editorAdds ? baseAmt + (baseAmt * editorPct / 100) : baseAmt;
                platformProfit = Math.round(baseForPlatform * (platformPct / 100));
                const baseForAgent = baseForPlatform + (baseForPlatform * platformPct / 100);
                agencyProfit = Math.round(baseForAgent * (agentPct / 100));

                if (editorAdds && editorShare > 0) {
                    newBreakdown.push({ label: `Editor (Captatore) ${editorPct}%`, amount: Math.round(editorShare), desc: 'Captatore commission added to client price' });
                } else if (editorMarkupMode === 'deduct' && editorPct > 0) {
                    newBreakdown.push({ label: `Editor (deduct from owner) ${editorPct}%`, amount: Math.round(editorShare), desc: 'Captatore commission deducted from owner payout' });
                }
            } else {
                // Other roles: split totalGain by agent's agency_split_pct (legacy logic)
                const agencySplitPct = currentAgent?.agency_split_pct || 67;
                const platformSharePct = 100 - agencySplitPct;
                const totalGain = finalPrice - baseAmt;
                const ivaPart = Math.round(totalGain * (ivaPercent / 100) / (1 + ivaPercent / 100));
                const preTaxProfit = totalGain - ivaPart;
                platformProfit = Math.round(preTaxProfit * (platformSharePct / 100));
                agencyProfit = Math.round(preTaxProfit - platformProfit);
            }

            if (platformProfit > 0) {
                newBreakdown.push({ label: 'Platform Profit', amount: platformProfit, desc: 'Platform service fee' });
            }
            if (agencyProfit !== 0) {
                newBreakdown.push({ label: 'Agency Profit', amount: agencyProfit, desc: 'Agency commission' });
            }

            // IVA computed from the actual finalPrice gain
            const totalGain = finalPrice - baseAmt;
            const ivaAmount = Math.round(totalGain * (ivaPercent / 100) / (1 + ivaPercent / 100));
            newBreakdown.push({ label: `IVA (VAT) ${ivaPercent}%`, amount: Math.round(ivaAmount), desc: 'VAT on agency services' });

            const { error } = await supabase
                .from('quotes')
                .update({
                    admin_markup: platformMargin,
                    agent_markup: margin,
                    editor_markup: parseFloat(editorMargin) || 0,
                    editor_markup_mode: editorMarkupMode,
                    extra_services: extraServices,
                    final_price: finalPrice,
                    price_breakdown: newBreakdown,
                    is_manual_price: isManual,
                    stripe_fee_included: useStripeFee,
                    forex_fee_included: useForexFee,
                    agent_id: assignedAgentId,
                    deposit_paid: depositPaid,
                    balance_paid: balancePaid,
                    rental_type: rentalType,
                    group_details: {
                        type: groupType,
                        children: groupType === 'family' ? numChildren : 0,
                        composition: groupType === 'friends' ? friendsComposition : null,
                        is_couples: groupType === 'friends' ? isCouples : false,
                        has_pets: hasPets
                    }
                })
                .eq('id', quote.id);

            if (error) throw error;
            onSaved();
        } catch (err) {
            alert('Error updating quote: ' + err.message);
        } finally {
            setSaving(false);
        }
    };
    
    const handleAskAvailability = async () => {
        if (role === 'agent' || role === 'agency_admin') {
            const { error } = await supabase
                .from('quotes')
                .update({ status: 'waiting_owner' })
                .eq('id', quote.id);
            if (error) {
                alert('Error updating status: ' + error.message);
            } else {
                alert("Approval request status updated. An administrator will verify availability with the owner.");
                onSaved();
            }
            return;
        }

        if (!ownerPhone) {
            alert("No phone number found for this property's owner. Please add it in Owner Management.");
            return;
        }

        const confirmUrl = `${window.location.origin}/confirm-availability/${quote.id}`;
        const villaName = quote.properties?.villa_name || quote.boats?.boat_name;
        const msg = `Hello ${ownerName}, we have a booking request for ${villaName} from ${new Date(quote.check_in).toLocaleDateString()} to ${new Date(quote.check_out).toLocaleDateString()}. Please confirm availability here: ${confirmUrl}`;
        
        const encodedMsg = encodeURIComponent(msg);
        const waUrl = `https://wa.me/${ownerPhone.replace(/\s+/g, '')}?text=${encodedMsg}`;

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
        onSaved();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md text-left">
            <div className="bg-surface border border-border rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in duration-200">
                <div className="p-6 border-b border-border flex justify-between items-center text-left">
                    <h2 className="text-xl font-bold text-text-primary">Edit Quote Details</h2>
                    <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
                        <span className="material-symbols-outlined notranslate">close</span>
                    </button>
                </div>

                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto text-left">
                    {/* Status Select */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest block">Quote Status</label>
                        <select 
                            value={quote.status}
                            onChange={async (e) => {
                                const newStatus = e.target.value;
                                const { error } = await supabase
                                    .from('quotes')
                                    .update({ status: newStatus })
                                    .eq('id', quote.id);
                                if (!error) onSaved();
                            }}
                            className="w-full input-theme py-2.5 px-3 font-bold text-text-primary uppercase tracking-widest text-[11px]"
                        >
                            <option value="draft">Lead/Draft</option>
                            <option value="sent">Proposal Sent</option>
                            <option value="booked">Reservation Booked</option>
                            <option value="check_in_ready">Data Received</option>
                            <option value="completed">Stay Completed</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="expired">Expired</option>
                            <option value="waiting_owner">Waiting Owner</option>
                            <option value="owner_declined">Owner Declined</option>
                        </select>
                    </div>

                    {/* Rental Type */}
                    {quote.properties && (
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest block">Rental Type</label>
                            <select
                                value={rentalType}
                                onChange={e => handleRentalTypeChange(e.target.value)}
                                className="w-full input-theme py-2.5 px-3 font-bold text-text-primary"
                            >
                                {enabledRentalTypes.map(t => (
                                    <option key={t} value={t}>{RENTAL_TYPE_LABELS[t]}</option>
                                ))}
                            </select>
                            {rentalType !== 'daily' && villaRentalConfigs[rentalType] && (
                                <p className="text-[9px] text-primary/70 italic px-1">
                                    Commission {(villaRentalConfigs[rentalType].commission_mode || 'percent') === 'fixed'
                                        ? `€${villaRentalConfigs[rentalType].commission_amount || 0}`
                                        : `${villaRentalConfigs[rentalType].commission_pct}%`} · Platform retention {villaRentalConfigs[rentalType].platform_retention_pct}% — pre-filled above
                                </p>
                            )}
                        </div>
                    )}

                    {/* Group Qualification Section */}
                    <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 space-y-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="material-symbols-outlined notranslate text-primary text-sm">groups</span>
                            <label className="text-[10px] font-black text-primary uppercase tracking-widest">Group Qualification</label>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2">
                            <button 
                                onClick={() => setGroupType('family')}
                                className={`py-2 px-3 rounded-xl border text-[10px] font-bold uppercase transition-all ${groupType === 'family' ? 'bg-primary border-primary text-white shadow-lg' : 'bg-surface border-border text-text-muted hover:border-primary/50'}`}
                            >
                                Family
                            </button>
                            <button 
                                onClick={() => setGroupType('friends')}
                                className={`py-2 px-3 rounded-xl border text-[10px] font-bold uppercase transition-all ${groupType === 'friends' ? 'bg-primary border-primary text-white shadow-lg' : 'bg-surface border-border text-text-muted hover:border-primary/50'}`}
                            >
                                Friends
                            </button>
                        </div>

                        {groupType === 'family' ? (
                            <div className="space-y-2 animate-in fade-in duration-200">
                                <label className="text-[9px] font-bold text-text-muted uppercase px-1">Number of Children</label>
                                <input 
                                    type="number"
                                    min="0"
                                    value={numChildren}
                                    onChange={(e) => setNumChildren(parseInt(e.target.value) || 0)}
                                    className="w-full input-theme py-2 px-3 text-xs"
                                    placeholder="0"
                                />
                            </div>
                        ) : (
                            <div className="space-y-3 animate-in fade-in duration-200">
                                <div className="space-y-2">
                                    <label className="text-[9px] font-bold text-text-muted uppercase px-1">Composition (e.g. 4 guys, 2 girls)</label>
                                    <input 
                                        type="text"
                                        value={friendsComposition}
                                        onChange={(e) => setFriendsComposition(e.target.value)}
                                        className="w-full input-theme py-2 px-3 text-xs"
                                        placeholder="Briefly describe the group"
                                    />
                                </div>
                                <label className="flex items-center gap-3 p-2.5 rounded-xl bg-surface border border-border cursor-pointer hover:border-primary/30 transition-all">
                                    <input 
                                        type="checkbox" 
                                        checked={isCouples}
                                        onChange={e => setIsCouples(e.target.checked)}
                                        className="size-3.5 accent-primary"
                                    />
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-text-primary">Group of Couples?</span>
                                </label>
                            </div>
                        )}

                        <label className="flex items-center gap-3 p-2.5 rounded-xl bg-surface border border-border cursor-pointer hover:border-primary/30 transition-all">
                            <input 
                                type="checkbox" 
                                checked={hasPets}
                                onChange={e => setHasPets(e.target.checked)}
                                className="size-3.5 accent-primary"
                            />
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined notranslate text-sm text-text-muted">pets</span>
                                <span className="text-[9px] font-bold uppercase tracking-wider text-text-primary">Bringing Pets?</span>
                            </div>
                        </label>
                    </div>

                    {/* Ask Availability Button */}
                    <button 
                        onClick={handleAskAvailability}
                        className="w-full h-12 rounded-2xl bg-[#25D366]/10 border border-[#25D366]/30 text-[#25D366] font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 hover:bg-[#25D366]/20 transition-all"
                    >
                        <span className="material-symbols-outlined notranslate text-base">chat</span>
                        {quote.status === 'waiting_owner' ? 'Resend WhatsApp to Owner' : 'Ask Owner Availability (WhatsApp)'}
                    </button>

                    {/* Payment Toggles */}
                    <div className="grid grid-cols-2 gap-4">
                        <label className="flex items-center gap-3 p-3 rounded-xl bg-background/50 border border-border cursor-pointer hover:border-primary/50 transition-all select-none">
                            <input 
                                type="checkbox" 
                                checked={depositPaid}
                                onChange={e => setDepositPaid(e.target.checked)}
                                className="size-4 accent-primary"
                            />
                            <div className="flex flex-col">
                                <span className="text-[10px] font-black uppercase tracking-widest text-text-primary leading-none">Deposit Paid</span>
                                <span className="text-[8px] text-text-muted font-bold mt-1 uppercase">Booking Secure</span>
                            </div>
                        </label>
                        <label className="flex items-center gap-3 p-3 rounded-xl bg-background/50 border border-border cursor-pointer hover:border-primary/50 transition-all select-none">
                            <input 
                                type="checkbox" 
                                checked={balancePaid}
                                onChange={e => setBalancePaid(e.target.checked)}
                                className="size-4 accent-primary"
                            />
                            <div className="flex flex-col">
                                <span className="text-[10px] font-black uppercase tracking-widest text-text-primary leading-none">Balance Paid</span>
                                <span className="text-[8px] text-text-muted font-bold mt-1 uppercase">Full Payment</span>
                            </div>
                        </label>
                    </div>

                    {/* Commissions */}
                    {role === 'super_admin' ? (
                        <div className="space-y-3 p-4 rounded-2xl bg-purple-500/5 border border-purple-500/20">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Commissions Override</label>
                                <div className="flex gap-1 bg-surface-2 rounded-lg p-0.5">
                                    <button
                                        type="button"
                                        onClick={() => setInputUnit('pct')}
                                        className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest transition-all ${inputUnit === 'pct' ? 'bg-purple-500 text-white' : 'text-text-muted'}`}
                                    >%</button>
                                    <button
                                        type="button"
                                        onClick={() => setInputUnit('eur')}
                                        className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest transition-all ${inputUnit === 'eur' ? 'bg-purple-500 text-white' : 'text-text-muted'}`}
                                    >€</button>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <div className="bg-background/50 p-2 rounded-xl border border-border">
                                    <label className="text-[8px] text-text-muted font-black uppercase tracking-widest block mb-1">Platform</label>
                                    <div className="flex items-center gap-1">
                                        <span className="text-[10px] text-primary font-bold">{inputUnit === 'eur' ? '€' : '%'}</span>
                                        <input
                                            type="number"
                                            value={displayValue(platformMargin)}
                                            onChange={e => handleInputChange(e.target.value, setPlatformMargin)}
                                            disabled={isManual}
                                            className="bg-transparent border-none text-sm font-black text-text-primary w-full outline-none disabled:opacity-50"
                                        />
                                    </div>
                                    <p className="text-[8px] text-text-muted/60 mt-0.5">{inputUnit === 'eur' ? `${platformMargin}%` : `€${pctToEur(platformMargin)}`}</p>
                                </div>
                                <div className="bg-background/50 p-2 rounded-xl border border-border">
                                    <label className="text-[8px] text-text-muted font-black uppercase tracking-widest block mb-1">Agent</label>
                                    <div className="flex items-center gap-1">
                                        <span className="text-[10px] text-blue-400 font-bold">{inputUnit === 'eur' ? '€' : '%'}</span>
                                        <input
                                            type="number"
                                            value={displayValue(margin)}
                                            onChange={e => handleInputChange(e.target.value, setMargin)}
                                            disabled={isManual}
                                            className="bg-transparent border-none text-sm font-black text-text-primary w-full outline-none disabled:opacity-50"
                                        />
                                    </div>
                                    <p className="text-[8px] text-text-muted/60 mt-0.5">{inputUnit === 'eur' ? `${margin}%` : `€${pctToEur(margin)}`}</p>
                                </div>
                                <div className="bg-background/50 p-2 rounded-xl border border-purple-500/40">
                                    <label className="text-[8px] text-purple-400 font-black uppercase tracking-widest block mb-1">Editor</label>
                                    <div className="flex items-center gap-1">
                                        <span className="text-[10px] text-purple-400 font-bold">{inputUnit === 'eur' ? '€' : '%'}</span>
                                        <input
                                            type="number"
                                            value={displayValue(editorMargin)}
                                            onChange={e => handleInputChange(e.target.value, setEditorMargin)}
                                            disabled={isManual}
                                            className="bg-transparent border-none text-sm font-black text-text-primary w-full outline-none disabled:opacity-50"
                                        />
                                    </div>
                                    <p className="text-[8px] text-text-muted/60 mt-0.5">{inputUnit === 'eur' ? `${editorMargin}%` : `€${pctToEur(editorMargin)}`}</p>
                                </div>
                            </div>
                            {parseFloat(editorMargin) > 0 && (
                                <div className="flex items-center gap-2 pt-2 border-t border-purple-500/20">
                                    <span className="text-[9px] text-purple-400 font-black uppercase tracking-widest">Editor mode:</span>
                                    <button
                                        type="button"
                                        onClick={() => setEditorMarkupMode('deduct')}
                                        className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest transition-all ${editorMarkupMode === 'deduct' ? 'bg-purple-500 text-white' : 'bg-transparent text-text-muted border border-border'}`}
                                    >Deduct from Owner</button>
                                    <button
                                        type="button"
                                        onClick={() => setEditorMarkupMode('add')}
                                        className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest transition-all ${editorMarkupMode === 'add' ? 'bg-purple-500 text-white' : 'bg-transparent text-text-muted border border-border'}`}
                                    >Add to Client Price</button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-2 col-span-2">
                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest block">Total Commission (%)</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={margin}
                                    onChange={e => setMargin(e.target.value)}
                                    disabled={isManual || !canManageMargins}
                                    className="w-full input-theme py-2.5 text-right font-bold text-primary disabled:opacity-50"
                                />
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-text-muted">%</span>
                                {!canManageMargins && <div className="absolute -top-6 right-0 text-[8px] font-black text-red-500 uppercase tracking-widest">Read Only</div>}
                            </div>
                            <div className="flex justify-between items-center px-1">
                                <p className="text-[9px] text-text-muted italic">
                                    Ibiza Beyond Share: {100 - (agents.find(a => a.id === assignedAgentId)?.agency_split_pct || 67)}% of total commission.
                                </p>
                                <p className="text-[9px] text-text-muted italic">
                                    Agency Share: {agents.find(a => a.id === assignedAgentId)?.agency_split_pct || 67}%
                                </p>
                            </div>
                        </div>
                    )}
                    
                    {/* Assigned Agent (Admin only) */}
                    {(role === 'admin' || role === 'super_admin' || user?.id === quote.agent_id) && (
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest flex items-center gap-2">
                                <span className="material-symbols-outlined notranslate text-sm">person</span> Assigned Agent
                            </label>
                            <select 
                                value={assignedAgentId}
                                onChange={e => setAssignedAgentId(e.target.value)}
                                className="w-full input-theme py-2.5 px-3 font-bold text-text-primary"
                            >
                                <option value="">Platform Administration</option>
                                {agents.map(a => (
                                    <option key={a.id} value={a.id}>{a.company_name || 'Unnamed Agency'}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Extra Services */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest">Extra Services</label>
                            <button onClick={addService} className="text-[10px] font-bold text-primary uppercase hover:underline flex items-center gap-1">
                                <span className="material-symbols-outlined notranslate text-sm">add</span> Add Service
                            </button>
                        </div>
                        <div className="space-y-2">
                            {extraServices.map((s, idx) => (
                                <div key={idx} className="flex gap-2 items-center bg-background/50 p-2 rounded-xl border border-border animate-in slide-in-from-right-2">
                                    <input 
                                        placeholder="Service name (e.g. Car Rental)"
                                        className="flex-1 bg-transparent border-none text-sm text-text-primary outline-none"
                                        value={s.name}
                                        onChange={e => updateService(idx, 'name', e.target.value)}
                                    />
                                    <div className="relative w-24">
                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-text-muted">€</span>
                                        <input 
                                            type="number"
                                            placeholder="0"
                                            className="w-full bg-transparent border-none text-sm text-right text-primary font-bold outline-none"
                                            value={s.price}
                                            onChange={e => updateService(idx, 'price', e.target.value)}
                                        />
                                    </div>
                                    <button onClick={() => removeService(idx)} className="text-text-muted hover:text-red-400 p-1">
                                        <span className="material-symbols-outlined notranslate text-sm">delete</span>
                                    </button>
                                </div>
                            ))}
                            {extraServices.length === 0 && <p className="text-xs text-text-muted italic">No extra services added.</p>}
                        </div>
                    </div>

                    {/* Final Price & Override */}
                    <div className="pt-4 border-t border-border space-y-4">
                        {/* Fee toggles info banner */}
                        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 space-y-3">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="material-symbols-outlined notranslate text-amber-500 text-[18px]">info</span>
                                <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Bank Fees to Charge the Client</span>
                            </div>
                            <label className="flex items-start gap-3 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    checked={useStripeFee}
                                    onChange={e => setUseStripeFee(e.target.checked)}
                                    className="accent-primary mt-0.5"
                                />
                                <div>
                                    <span className="text-xs font-bold text-text-primary group-hover:text-primary transition-colors">
                                        Stripe / Card Fee (+3%)
                                    </span>
                                    <p className="text-[10px] text-text-muted mt-0.5">
                                        Select if the client pays with credit card or Revolut. Covers digital payment processing costs.
                                    </p>
                                </div>
                            </label>
                            <label className="flex items-start gap-3 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    checked={useForexFee}
                                    onChange={e => setUseForexFee(e.target.checked)}
                                    className="accent-primary mt-0.5"
                                />
                                <div>
                                    <span className="text-xs font-bold text-text-primary group-hover:text-primary transition-colors">
                                        Currency Exchange — Non-EUR Client (+2%)
                                    </span>
                                    <p className="text-[10px] text-text-muted mt-0.5">
                                        Select if the client pays in a currency other than Euro (GBP, USD, etc.). Covers currency conversion costs.
                                    </p>
                                </div>
                            </label>
                        </div>

                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest">Total Price (EUR)</label>
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <span className="text-[10px] font-bold text-text-muted uppercase group-hover:text-primary transition-colors">Manual Override</span>
                                <input
                                    type="checkbox"
                                    checked={isManual}
                                    onChange={e => setIsManual(e.target.checked)}
                                    className="accent-primary"
                                />
                            </label>
                        </div>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-primary/30">€</span>
                            <input 
                                type="number"
                                value={isManual ? manualPrice : calculateAutoPrice()}
                                onChange={e => setManualPrice(e.target.value)}
                                readOnly={!isManual}
                                className={`w-full bg-primary/5 border-2 ${isManual ? 'border-primary' : 'border-primary/20'} rounded-2xl py-6 px-10 text-3xl font-black text-primary outline-none transition-all`}
                            />
                        </div>

                        {/* Live Breakdown Preview */}
                        {!isManual && (
                            <div className="p-4 rounded-2xl bg-surface-2 border border-border space-y-3 animate-in fade-in slide-in-from-top-2">
                                <p className="text-[9px] font-black text-text-muted uppercase tracking-widest border-b border-border pb-2">Live Calculation Breakdown</p>
                                <div className="space-y-2">
                                    <div className="flex justify-between text-[11px]">
                                        <span className="text-text-secondary">Base ({quote.properties ? 'Villa' : 'Boat'} cost)</span>
                                        <span className="font-bold text-text-primary">€{Math.round(parseFloat(quote.supplier_base_price || 0)).toLocaleString()}</span>
                                    </div>
                                    {parseFloat(editorMargin) > 0 && (
                                        <div className="flex justify-between text-[11px]">
                                            <span className="text-purple-400">Editor (Captatore) {editorMargin}% {editorMarkupMode === 'deduct' ? '(deducted from owner)' : ''}</span>
                                            <span className={`font-bold ${editorMarkupMode === 'add' ? 'text-purple-400' : 'text-purple-400/50 line-through'}`}>
                                                {editorMarkupMode === 'add' ? '+ ' : ''}€{Math.round(parseFloat(quote.supplier_base_price || 0) * parseFloat(editorMargin) / 100).toLocaleString()}
                                            </span>
                                        </div>
                                    )}
                                    <div className="flex justify-between text-[11px]">
                                        <span className="text-text-secondary">Platform + Agent ({parseFloat(margin) + parseFloat(platformMargin)}%)</span>
                                        <span className="font-bold text-primary">+ €{Math.round(calculateAutoPrice() - parseFloat(quote.supplier_base_price || 0) - extraServices.reduce((sum, s) => sum + (s.price || 0), 0) - (editorMarkupMode === 'add' ? parseFloat(quote.supplier_base_price || 0) * parseFloat(editorMargin) / 100 : 0)).toLocaleString()}</span>
                                    </div>
                                    {extraServices.filter(s => s.price > 0).map((s, i) => (
                                        <div key={i} className="flex justify-between text-[11px]">
                                            <span className="text-text-secondary">Extra: {s.name || 'Service'}</span>
                                            <span className="font-bold text-text-primary">+ €{Math.round(s.price).toLocaleString()}</span>
                                        </div>
                                    ))}
                                    {useStripeFee && (() => {
                                        const base2 = parseFloat(quote.supplier_base_price || 0);
                                        const sub = base2 * (1 + parseFloat(margin || 0) / 100) + extraServices.reduce((s, x) => s + (x.price || 0), 0);
                                        const ivaAmt = (sub - base2) * (ivaPercent / 100);
                                        const preFees = sub + ivaAmt;
                                        return (
                                            <div className="flex justify-between text-[11px]">
                                                <span className="text-amber-500">Stripe / Card Fee (3%)</span>
                                                <span className="font-bold text-amber-500">+ €{Math.round(preFees * 0.03).toLocaleString()}</span>
                                            </div>
                                        );
                                    })()}
                                    {useForexFee && (() => {
                                        const base2 = parseFloat(quote.supplier_base_price || 0);
                                        const sub = base2 * (1 + parseFloat(margin || 0) / 100) + extraServices.reduce((s, x) => s + (x.price || 0), 0);
                                        const ivaAmt = (sub - base2) * (ivaPercent / 100);
                                        const preFees = sub + ivaAmt;
                                        return (
                                            <div className="flex justify-between text-[11px]">
                                                <span className="text-amber-500">Currency Exchange (2%)</span>
                                                <span className="font-bold text-amber-500">+ €{Math.round(preFees * 0.02).toLocaleString()}</span>
                                            </div>
                                        );
                                    })()}
                                    <div className="pt-2 mt-2 border-t border-border flex justify-between text-xs font-black text-primary uppercase">
                                        <span>Estimated Final Total</span>
                                        <span>€{calculateAutoPrice().toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        <p className="text-[10px] text-text-muted italic text-center">
                            {isManual ? 'Warning: Automatic calculations are suspended in manual mode.' : 'Calculated automatically based on subtotal, margin, and extras.'}
                        </p>
                        <div className="p-3 bg-primary/5 rounded-xl border border-primary/20">
                            <p className="text-[8px] text-primary/60 font-medium italic leading-tight">* Includes {ivaPercent}% IVA (VAT) as per Spanish holiday rental regulations.</p>
                        </div>
                    </div>
                </div>

                <div className="p-6 bg-background/30 flex gap-3">
                    <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-border text-text-muted font-bold hover:bg-surface-2 transition-all text-sm">Cancel</button>
                    <button 
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-[2] btn-primary py-3 font-bold shadow-lg shadow-primary/20 disabled:opacity-50 text-sm"
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EditQuoteModal;
