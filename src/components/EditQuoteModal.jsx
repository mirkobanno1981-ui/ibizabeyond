import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const EditQuoteModal = ({ quote, onClose, onSaved }) => {
    const { user, role } = useAuth();
    const [margin, setMargin] = useState(quote.agent_markup || 15);
    const [extraServices, setExtraServices] = useState(quote.extra_services || []);
    const [manualPrice, setManualPrice] = useState(quote.final_price || 0);
    const [isManual, setIsManual] = useState(quote.is_manual_price || false);
    const [useStripeFee, setUseStripeFee] = useState(quote.stripe_fee_included || false);
    const [saving, setSaving] = useState(false);
    const [agents, setAgents] = useState([]);
    const [assignedAgentId, setAssignedAgentId] = useState(quote.agent_id);
    const [depositPaid, setDepositPaid] = useState(quote.deposit_paid || false);
    const [balancePaid, setBalancePaid] = useState(quote.balance_paid || false);
    const [ivaPercent, setIvaPercent] = useState(10);
    const [ownerPhone, setOwnerPhone] = useState('');
    const [ownerName, setOwnerName] = useState('');
    
    // Group Qualification State
    const [groupType, setGroupType] = useState(quote.group_details?.type || 'family');
    const [numChildren, setNumChildren] = useState(quote.group_details?.children || 0);
    const [friendsComposition, setFriendsComposition] = useState(quote.group_details?.composition || '');
    const [isCouples, setIsCouples] = useState(quote.group_details?.is_couples || false);
    const [hasPets, setHasPets] = useState(quote.group_details?.has_pets || false);


    useEffect(() => {
        async function fetchData() {
            const [agentsRes, settingsRes] = await Promise.all([
                supabase.from('agents').select('id, company_name'),
                supabase.from('margin_settings').select('iva_percent').eq('id', 1).single()
            ]);
            setAgents(agentsRes.data || []);
            if (settingsRes.data) setIvaPercent(parseFloat(settingsRes.data.iva_percent) || 10);

            // Fetch Owner Info
            const ownerId = quote.invenio_properties?.owner_id || quote.invenio_boats?.owner_id;
            if (ownerId) {
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
    }, [quote]);

    const addService = () => setExtraServices([...extraServices, { name: '', price: 0 }]);
    const removeService = (idx) => setExtraServices(extraServices.filter((_, i) => i !== idx));
    const updateService = (idx, field, val) => {
        const newServices = [...extraServices];
        newServices[idx][field] = field === 'price' ? parseFloat(val) || 0 : val;
        setExtraServices(newServices);
    };

    const calculateAutoPrice = () => {
        const base = parseFloat(quote.supplier_base_price || 0);
        const adminMarkup = parseFloat(quote.admin_markup || 0);
        const agentMarkup = parseFloat(margin || 0);
        
        const priceWithAdmin = base * (1 + adminMarkup / 100);
        const priceWithAgent = priceWithAdmin * (1 + agentMarkup / 100);
        
        const extraTotal = extraServices.reduce((sum, s) => sum + (s.price || 0), 0);
        const subtotal = priceWithAgent + extraTotal;
        const stripeFee = useStripeFee ? subtotal * 0.015 : 0;
        
        const preTax = subtotal + stripeFee;
        const ivaAmount = (preTax - base) * (ivaPercent / 100);

        return Math.round(preTax + ivaAmount);
    };

    useEffect(() => {
        if (!isManual) {
            setManualPrice(calculateAutoPrice());
        }
    }, [margin, extraServices, isManual, useStripeFee, ivaPercent]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const finalPrice = isManual ? manualPrice : calculateAutoPrice();
            
            // Build Breakdown for saving
            const base = parseFloat(quote.supplier_base_price || 0);
            const adminMarkup = parseFloat(quote.admin_markup || 0);
            const agentMarkup = parseFloat(margin || 0);
            const priceWithAdmin = base * (1 + adminMarkup / 100);
            const priceWithAgent = priceWithAdmin * (1 + agentMarkup / 100);
            
            const extraTotal = extraServices.reduce((sum, s) => sum + (s.price || 0), 0);
            const subtotal = priceWithAgent + extraTotal;
            const stripeFeeSource = useStripeFee ? subtotal * 0.015 : 0;
            
            let ivaAmount = 0;
            const newBreakdown = [];
            
            if (isManual) {
                ivaAmount = (finalPrice - base) * (ivaPercent / 100) / (1 + ivaPercent / 100);
                const baseLabel = quote.invenio_properties ? 'Base Accommodation' : 'Base Charter';
                newBreakdown.push({ label: baseLabel, amount: Math.round(base), desc: 'Base cost' });
                newBreakdown.push({ label: 'Manual Adjustment', amount: Math.round(finalPrice - base - ivaAmount), desc: 'Manual adjustment' });
            } else {
                const baseLabel = quote.invenio_properties ? 'Base Accommodation' : 'Base Charter';
                newBreakdown.push({ label: baseLabel, amount: Math.round(base), desc: 'Base cost' });
                if (priceWithAgent > base) {
                    newBreakdown.push({ label: 'Agency Margin', amount: Math.round(priceWithAgent - base), desc: 'Agency commissions' });
                }
                extraServices.forEach(s => {
                    if (s.price > 0) newBreakdown.push({ label: s.name || 'Extra Service', amount: Math.round(s.price), desc: 'Additional service' });
                });
                if (stripeFeeSource > 0) {
                    newBreakdown.push({ label: 'Stripe Fee', amount: Math.round(stripeFeeSource), desc: 'Transaction fees' });
                }
            }
            
            newBreakdown.push({ label: `IVA (VAT) ${ivaPercent}%`, amount: Math.round(ivaAmount), desc: 'VAT on agency services' });

            const { error } = await supabase
                .from('quotes')
                .update({
                    agent_markup: margin,
                    extra_services: extraServices,
                    final_price: finalPrice,
                    price_breakdown: newBreakdown,
                    is_manual_price: isManual,
                    stripe_fee_included: useStripeFee,
                    agent_id: assignedAgentId,
                    deposit_paid: depositPaid,
                    balance_paid: balancePaid,
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
        if (!ownerPhone) {
            alert("No phone number found for this property's owner. Please add it in Owner Management.");
            return;
        }

        const confirmUrl = `${window.location.origin}/confirm-availability/${quote.id}`;
        const villaName = quote.invenio_properties?.villa_name || quote.invenio_boats?.boat_name;
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

                    {/* Margin */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest block">Agent Margin (%)</label>
                        <div className="relative">
                            <input 
                                type="number" 
                                value={margin}
                                onChange={e => setMargin(e.target.value)}
                                disabled={isManual}
                                className="w-full input-theme py-2.5 text-right font-bold text-primary disabled:opacity-50"
                            />
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-text-muted">%</span>
                        </div>
                    </div>
                    
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
                                <option value="">Invenio Administration</option>
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
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest">Total Price (EUR)</label>
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <span className="text-[10px] font-bold text-text-muted uppercase group-hover:text-primary transition-colors">Stripe Fee (1.5%)</span>
                                    <input 
                                        type="checkbox" 
                                        checked={useStripeFee}
                                        onChange={e => setUseStripeFee(e.target.checked)}
                                        className="accent-primary"
                                    />
                                </label>
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
