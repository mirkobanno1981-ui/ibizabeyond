import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { effectiveCapturerCommission } from '../lib/capturerCommission';
import { computeBreakdown, resolveEditorShare, snapshotToBreakdownItems } from '../lib/quoteMath';

const EditQuoteModal = ({ quote, onClose, onSaved }) => {
    const { user, role, agentData } = useAuth();
    const isAgencyLeader = agentData?.agent_type === 'agency' || agentData?.agent_type === 'agency_admin' || agentData?.agent_type === 'owner';
    const canManageMargins = role === 'admin' || role === 'super_admin' || isAgencyLeader;

    const [margin, setMargin] = useState(quote.agent_markup || 15);
    const [platformMargin, setPlatformMargin] = useState(quote.admin_markup || 0);

    const _capturerSpecInit = effectiveCapturerCommission(quote.properties, quote.rental_type || 'daily');
    const [editorMargin, setEditorMargin] = useState(
        parseFloat(quote.editor_markup) || _capturerSpecInit.pct || 0
    );
    // editor_included: true = deducted from owner (commission inside base);
    // false = added on top (commission grows client price).
    const [editorIncluded, setEditorIncluded] = useState(
        quote.editor_included != null ? !!quote.editor_included : !!_capturerSpecInit.included
    );

    const [inputUnit, setInputUnit] = useState('pct');
    const [extraServices, setExtraServices] = useState(quote.extra_services || []);
    const [manualPrice, setManualPrice] = useState(quote.final_price || 0);
    const [isManual, setIsManual] = useState(quote.is_manual_price || false);
    const [saving, setSaving] = useState(false);
    const [agents, setAgents] = useState([]);
    const [assignedAgentId, setAssignedAgentId] = useState(quote.agent_id);
    const [depositPaid, setDepositPaid] = useState(quote.deposit_paid || false);
    const [balancePaid, setBalancePaid] = useState(quote.balance_paid || false);
    const [ivaPercent, setIvaPercent] = useState(quote.iva_percent ?? 10);
    const [ownerPhone, setOwnerPhone] = useState('');
    const [ownerName, setOwnerName] = useState('');

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

    const [groupType, setGroupType] = useState(quote.group_details?.type || 'family');
    const [numChildren, setNumChildren] = useState(quote.group_details?.children || 0);
    const [friendsComposition, setFriendsComposition] = useState(quote.group_details?.composition || '');
    const [isCouples, setIsCouples] = useState(quote.group_details?.is_couples || false);
    const [hasPets, setHasPets] = useState(quote.group_details?.has_pets || false);


    async function resolveOwnerOrCapturerContact(ownerId) {
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
    }

    useEffect(() => {
        async function fetchData() {
            const [agentsRes, settingsRes] = await Promise.all([
                supabase.from('agents').select('id, company_name, markup_percent, admin_margin, agency_split_pct'),
                supabase.from('margin_settings').select('iva_percent').eq('id', 1).single()
            ]);
            const fetchedAgents = agentsRes.data || [];
            setAgents(fetchedAgents);
            // Only override IVA from settings if quote has no snapshot yet.
            if (settingsRes.data && quote.iva_percent == null) {
                setIvaPercent(parseFloat(settingsRes.data.iva_percent) || 10);
            }

            const currentAgent = fetchedAgents.find(a => a.id === assignedAgentId);

            if (!quote.agent_markup && currentAgent) {
                setMargin(currentAgent.markup_percent || 12);
            }
            if (!quote.admin_markup && currentAgent) {
                setPlatformMargin(currentAgent.admin_margin || 0);
            }

            const ownerId = quote.properties?.owner_id || quote.boats?.owner_id;
            if (ownerId && (role === 'admin' || role === 'super_admin')) {
                const contact = await resolveOwnerOrCapturerContact(ownerId);
                if (contact) {
                    setOwnerPhone(contact.phone);
                    setOwnerName(contact.name);
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

    // Resolve agent/platform pct given role. Non-super-admin roles only edit a
    // single combined margin %, which gets split via agent.agency_split_pct.
    const resolvedPcts = useMemo(() => {
        if (role === 'super_admin') {
            return { agentPct: parseFloat(margin) || 0, platformPct: parseFloat(platformMargin) || 0 };
        }
        const currentAgent = agents.find(a => a.id === assignedAgentId);
        const splitPct = currentAgent?.agency_split_pct || 67;
        const totalPct = parseFloat(margin) || 0;
        return {
            agentPct: +(totalPct * splitPct / 100).toFixed(2),
            platformPct: +(totalPct * (100 - splitPct) / 100).toFixed(2),
        };
    }, [role, margin, platformMargin, agents, assignedAgentId]);

    const supplierBase = parseFloat(quote.supplier_base_price || 0);
    const editorShareEur = useMemo(
        () => Math.round(supplierBase * (parseFloat(editorMargin) || 0) / 100 * 100) / 100,
        [supplierBase, editorMargin]
    );

    const lockedPrice = !!quote.boats?.price_locked;

    const breakdown = useMemo(() => computeBreakdown({
        supplierBase,
        agentPct: resolvedPcts.agentPct,
        platformPct: resolvedPcts.platformPct,
        editorShare: editorShareEur,
        editorIncluded,
        extras: extraServices,
        ivaPct: ivaPercent,
        checkIn: quote.check_in,
        isManual,
        manualPrice: isManual ? parseFloat(manualPrice) || 0 : null,
        lockedPrice,
    }), [supplierBase, resolvedPcts, editorShareEur, editorIncluded, extraServices, ivaPercent, quote.check_in, isManual, manualPrice, lockedPrice]);

    const computedFinalPrice = breakdown.final_price;

    const pctToEur = (pct) => Math.round(supplierBase * (parseFloat(pct) || 0) / 100);
    const eurToPct = (eur) => supplierBase > 0 ? +(((parseFloat(eur) || 0) / supplierBase) * 100).toFixed(2) : 0;
    const displayValue = (pct) => inputUnit === 'eur' ? pctToEur(pct) : pct;
    const handleInputChange = (raw, setter) => {
        const v = parseFloat(raw) || 0;
        setter(inputUnit === 'eur' ? eurToPct(v) : v);
    };

    useEffect(() => {
        if (!isManual) setManualPrice(computedFinalPrice);
    }, [computedFinalPrice, isManual]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const finalPrice = isManual ? (parseFloat(manualPrice) || 0) : computedFinalPrice;
            const finalSnapshot = computeBreakdown({
                supplierBase,
                agentPct: resolvedPcts.agentPct,
                platformPct: resolvedPcts.platformPct,
                editorShare: editorShareEur,
                editorIncluded,
                extras: extraServices,
                ivaPct: ivaPercent,
                checkIn: quote.check_in,
                isManual,
                manualPrice: isManual ? finalPrice : null,
                lockedPrice,
            });

            const baseLabel = quote.properties ? 'Base Accommodation' : 'Base Charter';
            const newBreakdown = snapshotToBreakdownItems(finalSnapshot, baseLabel);

            const { error } = await supabase
                .from('quotes')
                .update({
                    // Snapshot fields — single source of truth for stripe-checkout.
                    iva_percent:         finalSnapshot.iva_percent,
                    extras_total_eur:    finalSnapshot.extras_total_eur,
                    editor_share_eur:    finalSnapshot.editor_share_eur,
                    editor_included:     finalSnapshot.editor_included,
                    platform_profit_eur: finalSnapshot.platform_profit_eur,
                    agency_profit_eur:   finalSnapshot.agency_profit_eur,
                    editor_iva_eur:      finalSnapshot.editor_iva_eur,
                    agency_iva_eur:      finalSnapshot.agency_iva_eur,
                    platform_iva_eur:    finalSnapshot.platform_iva_eur,
                    iva_amount_eur:      finalSnapshot.iva_amount_eur,
                    stripe_fee_eur:      finalSnapshot.stripe_fee_eur,
                    upfront_stay_eur:    finalSnapshot.upfront_stay_eur,
                    final_price:         finalSnapshot.final_price,
                    // Inputs (kept for audit/UI display).
                    admin_markup:        platformMargin,
                    agent_markup:        margin,
                    editor_markup:       parseFloat(editorMargin) || 0,
                    extra_services:      extraServices,
                    price_breakdown:     newBreakdown,
                    is_manual_price:     isManual,
                    agent_id:            assignedAgentId,
                    deposit_paid:        depositPaid,
                    balance_paid:        balancePaid,
                    rental_type:         rentalType,
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
        const isOnRequest = !quote.final_price || parseFloat(quote.final_price) === 0;
        const msg = isOnRequest
            ? `Hello ${ownerName}, we have a booking request for ${villaName} from ${new Date(quote.check_in).toLocaleDateString()} to ${new Date(quote.check_out).toLocaleDateString()}. The price is on request — please confirm availability and quote your price here: ${confirmUrl}`
            : `Hello ${ownerName}, we have a booking request for ${villaName} from ${new Date(quote.check_in).toLocaleDateString()} to ${new Date(quote.check_out).toLocaleDateString()}. Please confirm availability here: ${confirmUrl}`;

        const encodedMsg = encodeURIComponent(msg);
        const waUrl = `https://wa.me/${ownerPhone.replace(/\s+/g, '')}?text=${encodedMsg}`;

        const { error } = await supabase
            .from('quotes')
            .update({ status: 'waiting_owner' })
            .eq('id', quote.id);

        if (error) {
            alert('Error updating status: ' + error.message);
            return;
        }

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

                    {lockedPrice && (
                        <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                            <span className="material-symbols-outlined notranslate text-amber-500 text-base mt-0.5">lock</span>
                            <p className="text-[10px] text-amber-500 font-bold leading-snug">
                                Boat price locked — B2C agent margin is enforced at minimum 10% (captator 5 + platform 5 + agent 10 = 20% total commission).
                            </p>
                        </div>
                    )}

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
                                    <span className="text-[9px] text-purple-400 font-black uppercase tracking-widest">Editor commission:</span>
                                    <button
                                        type="button"
                                        onClick={() => setEditorIncluded(true)}
                                        className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest transition-all ${editorIncluded ? 'bg-purple-500 text-white' : 'bg-transparent text-text-muted border border-border'}`}
                                    >Inside Base (deduct from owner)</button>
                                    <button
                                        type="button"
                                        onClick={() => setEditorIncluded(false)}
                                        className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest transition-all ${!editorIncluded ? 'bg-purple-500 text-white' : 'bg-transparent text-text-muted border border-border'}`}
                                    >On Top (add to client price)</button>
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
                        <div className="rounded-2xl bg-primary/10 border border-primary/30 p-4">
                            <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-1">Stripe processing fee (3%)</p>
                            <p className="text-[10px] text-text-muted leading-snug">
                                Always included in the final price. The fee covers card processing and is retained by the agent on the connected Stripe account.
                            </p>
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
                                value={isManual ? manualPrice : computedFinalPrice}
                                onChange={e => setManualPrice(e.target.value)}
                                readOnly={!isManual}
                                className={`w-full bg-primary/5 border-2 ${isManual ? 'border-primary' : 'border-primary/20'} rounded-2xl py-6 px-10 text-3xl font-black text-primary outline-none transition-all`}
                            />
                        </div>

                        {/* Live Breakdown Preview */}
                        <div className="p-4 rounded-2xl bg-surface-2 border border-border space-y-3 animate-in fade-in slide-in-from-top-2">
                            <p className="text-[9px] font-black text-text-muted uppercase tracking-widest border-b border-border pb-2">Live Calculation Breakdown</p>
                            <div className="space-y-2">
                                <div className="flex justify-between text-[11px]">
                                    <span className="text-text-secondary">Base ({quote.properties ? 'Villa' : 'Boat'} cost)</span>
                                    <span className="font-bold font-mono text-text-primary">€{(Number(supplierBase) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                                {breakdown.editor_share_eur > 0 && (
                                    <>
                                        <div className="flex justify-between text-[11px]">
                                            <span className="text-purple-400">Editor (Captatore) {breakdown.editor_included ? '(deducted from owner)' : '(added to price)'}</span>
                                            <span className={`font-bold font-mono ${breakdown.editor_included ? 'text-purple-400/50 line-through' : 'text-purple-400'}`}>
                                                {breakdown.editor_included ? '' : '+ '}€{(Number(breakdown.editor_share_eur) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                        {breakdown.editor_iva_eur > 0 && (
                                            <div className="flex justify-between text-[11px] pl-3">
                                                <span className="text-purple-400/70">↳ Editor IVA {ivaPercent}%</span>
                                                <span className="font-bold font-mono text-purple-400/80">+ €{(Number(breakdown.editor_iva_eur) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                            </div>
                                        )}
                                    </>
                                )}
                                <div className="flex justify-between text-[11px]">
                                    <span className="text-text-secondary">Agency Profit</span>
                                    <span className="font-bold font-mono text-primary">+ €{(Number(breakdown.agency_profit_eur) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                                {extraServices.filter(s => s.price > 0).map((s, i) => (
                                    <div key={i} className="flex justify-between text-[11px] pl-3">
                                        <span className="text-text-secondary">↳ Extra: {s.name || 'Service'}</span>
                                        <span className="font-bold font-mono text-text-primary">+ €{(Number(s.price) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </div>
                                ))}
                                {breakdown.agency_iva_eur > 0 && (
                                    <div className="flex justify-between text-[11px] pl-3">
                                        <span className="text-text-muted">↳ Agency IVA {ivaPercent}% (commission + extras)</span>
                                        <span className="font-bold font-mono text-text-primary/80">+ €{(Number(breakdown.agency_iva_eur) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </div>
                                )}
                                <div className="flex justify-between text-[11px]">
                                    <span className="text-text-secondary">Platform Profit</span>
                                    <span className="font-bold font-mono text-primary">+ €{(Number(breakdown.platform_profit_eur) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                                {breakdown.platform_iva_eur > 0 && (
                                    <div className="flex justify-between text-[11px] pl-3">
                                        <span className="text-text-muted">↳ Platform IVA {ivaPercent}%</span>
                                        <span className="font-bold font-mono text-text-primary/80">+ €{(Number(breakdown.platform_iva_eur) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </div>
                                )}
                                <div className="flex justify-between text-[11px]">
                                    <span className="text-amber-500">Stripe / Card Fee (3%)</span>
                                    <span className="font-bold font-mono text-amber-500">+ €{(Number(breakdown.stripe_fee_eur) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                                <div className="pt-2 mt-2 border-t border-border flex justify-between text-xs font-black text-primary uppercase">
                                    <span>Estimated Final Total</span>
                                    <span className="font-mono">€{(Number(computedFinalPrice) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                                <div className="pt-2 mt-2 border-t border-dashed border-border flex justify-between text-[9px] text-text-muted uppercase">
                                    <span>Owner upfront cash flow at deposit</span>
                                    <span className="font-mono">€{(Number(breakdown.upfront_stay_eur) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                            </div>
                        </div>

                        <p className="text-[10px] text-text-muted italic text-center">
                            {isManual ? 'Manual override active — breakdown derived backwards from final price.' : 'Calculated automatically based on supplier base, margins, extras, IVA, and Stripe fee.'}
                        </p>
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
