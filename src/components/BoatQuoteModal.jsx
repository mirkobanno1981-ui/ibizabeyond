import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function BoatQuoteModal({ selectedBoats, checkIn, checkOut, onClose, onCreated }) {
    const { user } = useAuth();
    const [clients, setClients] = useState([]);
    const [selectedClientId, setSelectedClientId] = useState('');
    const [saving, setSaving] = useState(false);
    const [ivaPercent, setIvaPercent] = useState(21);
    const [platformMargin, setPlatformMargin] = useState(0);
    const [agentMargin, setAgentMargin] = useState(15);
    const [success, setSuccess] = useState(false);
    const [createdIds, setCreatedIds] = useState([]);
    
    // Group Qualification State
    const [groupType, setGroupType] = useState('family'); 
    const [numAdults, setNumAdults] = useState(2);
    const [numChildren, setNumChildren] = useState(0);
    const [groupComposition, setGroupComposition] = useState('');
    const [hasPets, setHasPets] = useState(false);
    const [petDetails, setPetDetails] = useState('');

    useEffect(() => {
        async function fetchData() {
            const [clientsRes, settingsRes] = await Promise.all([
                supabase.from('clients').select('id, full_name').eq('agent_id', user?.id).order('full_name'),
                supabase.from('margin_settings').select('iva_percent').eq('id', 1).single()
            ]);
            setClients(clientsRes.data || []);
            // Note: We might want a separate boat_iva_percent, but for now we follow general settings or default 21
        }
        fetchData();
    }, [user]);

    async function handleCreateQuotes() {
        if (!selectedClientId) return alert('Please select a client');
        
        setSaving(true);
        try {
            // Fetch seasonal rates for selected boats
            const boatUuids = selectedBoats.map(b => b.v_uuid);
            const { data: seasonalRates } = await supabase
                .from('invenio_seasonal_prices')
                .select('*')
                .in('v_uuid', boatUuids);

            const quoteInserts = selectedBoats.map(boat => {
                const boatRates = seasonalRates?.filter(r => r.v_uuid === boat.v_uuid) || [];
                
                let totalBasePrice = 0;
                let days = 1;
                let priceBreakdownDescription = "";

                if (checkIn && checkOut) {
                    const start = new Date(checkIn);
                    const end = new Date(checkOut);
                    const dayCount = Math.max(1, Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)));
                    days = dayCount;

                    // Calculate price day by day
                    for (let i = 0; i < dayCount; i++) {
                        const currentDate = new Date(start);
                        currentDate.setDate(currentDate.getDate() + i);
                        const dateStr = currentDate.toISOString().split('T')[0];

                        // Find matching seasonal rate
                        const matchingRate = boatRates.find(r => 
                            dateStr >= r.start_date && dateStr <= r.end_date
                        );

                        totalBasePrice += matchingRate ? matchingRate.amount : (boat.daily_price || 0);
                    }
                    priceBreakdownDescription = `${boat.manufacturer} ${boat.model}`;
                } else {
                    totalBasePrice = boat.daily_price || 0;
                    priceBreakdownDescription = `${boat.manufacturer} ${boat.model} (Standard Daily Rate)`;
                }

                const basePrice = totalBasePrice;
                const priceWithAdminMarkup = basePrice * (1 + platformMargin / 100);
                const priceWithAgentMarkup = priceWithAdminMarkup * (1 + agentMargin / 100);
                
                const breakdown = [];
                breakdown.push({ 
                    label: `Base Charter (${days} day${days > 1 ? 's' : ''})`, 
                    amount: Math.round(basePrice), 
                    desc: priceBreakdownDescription
                });

                if (platformMargin > 0) {
                    breakdown.push({ label: 'Platform Margin', amount: Math.round(priceWithAdminMarkup - basePrice), desc: 'Platform service fee' });
                }
                if (agentMargin > 0) {
                    breakdown.push({ label: 'Agency Margin', amount: Math.round(priceWithAgentMarkup - priceWithAdminMarkup), desc: 'Agency commission' });
                }
                
                const ivaAmount = (priceWithAgentMarkup - basePrice) * (ivaPercent / 100);
                breakdown.push({ label: `IVA (VAT) ${ivaPercent}%`, amount: Math.round(ivaAmount), desc: 'VAT on services' });
                
                const finalPrice = Math.round(priceWithAgentMarkup + ivaAmount);

                return {
                    boat_uuid: boat.v_uuid,
                    client_id: selectedClientId,
                    check_in: checkIn || null,
                    check_out: checkOut || null,
                    supplier_base_price: basePrice,
                    admin_markup: platformMargin,
                    agent_markup: agentMargin,
                    final_price: finalPrice,
                    status: 'draft',
                    agent_id: user?.id,
                    price_breakdown: breakdown,
                    group_details: {
                        type: groupType,
                        adults: numAdults,
                        children: numChildren,
                        composition: groupComposition,
                        has_pets: hasPets,
                        pet_details: petDetails
                    }
                };
            });

            const { data: inserts, error } = await supabase.from('quotes').insert(quoteInserts).select('id');
            if (error) throw error;
            setCreatedIds(inserts.map(i => i.id));
            setSuccess(true);
            // onCreated(); // We will call this when closing or finishing the success modal
        } catch (err) {
            alert('Error creating boat quotes: ' + err.message);
        } finally {
            setSaving(false);
        }
    }

    if (success) {
        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <div className="glass-card w-full max-w-sm p-8 space-y-6 text-center animate-in zoom-in-95">
                    <div className="size-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <span className="material-symbols-outlined notranslate text-4xl text-emerald-500">check_circle</span>
                    </div>
                    <h2 className="text-xl font-bold text-text-primary uppercase tracking-tight">Quotes Created!</h2>
                    <p className="text-sm text-text-muted">Successfully generated {createdIds.length} boat proposals.</p>
                    
                    <div className="space-y-3 pt-4">
                        {selectedBoats.some(b => b.owner_id) && (
                            <button 
                                onClick={async () => {
                                    setSaving(true);
                                    try {
                                        await Promise.all(createdIds.map(id => 
                                            supabase.from('quotes').update({ status: 'waiting_owner' }).eq('id', id)
                                        ));
                                        // Trigger Notifications
                                        await Promise.all(createdIds.map(id => 
                                            supabase.functions.invoke('notify-owner', {
                                                body: { quoteId: id, action: 'request_approval' }
                                            })
                                        ));
                                        alert('Approval requests sent to boat owners!');
                                        onCreated();
                                    } catch (err) {
                                        alert('Error: ' + err.message);
                                    } finally {
                                        setSaving(false);
                                    }
                                }}
                                disabled={saving}
                                className="w-full btn-primary py-3 font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2"
                            >
                                <span className="material-symbols-outlined notranslate text-[18px]">hourglass_top</span>
                                {saving ? 'REQUESTING...' : 'Request Owner Approval'}
                            </button>
                        )}
                        <button 
                            onClick={onCreated}
                            className="w-full py-3 rounded-xl border border-border text-text-muted font-black uppercase tracking-widest text-[10px] hover:bg-surface-2"
                        >
                            View All Quotes
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="glass-card w-full max-w-lg p-8 space-y-8 animate-in zoom-in-95 duration-300 text-left">
                <div className="flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-bold text-text-primary uppercase tracking-tight">Create Boat Quote</h2>
                        <p className="text-[10px] text-text-muted uppercase tracking-widest font-black mt-1">Proposal for {selectedBoats.length} Boat{selectedBoats.length > 1 ? 's' : ''}</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-surface-2 transition-colors">
                        <span className="material-symbols-outlined notranslate">close</span>
                    </button>
                </div>

                <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin">
                    <div className="space-y-2">
                        <label className="text-[10px] text-text-muted font-black uppercase tracking-widest block">Select Client</label>
                        <div className="flex gap-2">
                            <select 
                                className="input-theme flex-1 py-3 px-4 font-bold text-text-primary"
                                value={selectedClientId}
                                onChange={e => setSelectedClientId(e.target.value)}
                            >
                                <option value="">CHOOSE A CLIENT...</option>
                                {clients.map(c => (
                                    <option key={c.id} value={c.id}>{c.full_name.toUpperCase()}</option>
                                ))}
                            </select>
                        </div>

                    {/* Margin Controls - Super Admin Only */}
                    {user?.role === 'super_admin' && (
                        <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2">
                            <div className="bg-surface-2/40 p-4 rounded-2xl border border-border/50">
                                <label className="text-[9px] text-text-muted font-black uppercase tracking-widest block mb-2">Platform Mark-up (%)</label>
                                <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined notranslate text-sm text-primary">account_balance</span>
                                    <input 
                                        type="number"
                                        value={platformMargin}
                                        onChange={e => setPlatformMargin(parseFloat(e.target.value) || 0)}
                                        className="bg-transparent border-none text-xs font-black text-text-primary w-full outline-none"
                                    />
                                </div>
                            </div>
                            <div className="bg-surface-2/40 p-4 rounded-2xl border border-border/50">
                                <label className="text-[9px] text-text-muted font-black uppercase tracking-widest block mb-2">Agent Mark-up (%)</label>
                                <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined notranslate text-sm text-blue-400">person</span>
                                    <input 
                                        type="number"
                                        value={agentMargin}
                                        onChange={e => setAgentMargin(parseFloat(e.target.value) || 0)}
                                        className="bg-transparent border-none text-xs font-black text-text-primary w-full outline-none"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                    </div>

                    {/* Guest Qualification Section */}
                    <div className="p-6 bg-surface-2/40 rounded-3xl border border-border/50 space-y-6">
                        <div className="flex items-center gap-3 border-b border-border/30 pb-4">
                            <span className="material-symbols-outlined notranslate text-primary">groups</span>
                            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-text-primary">Guest Qualification</h3>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-[9px] text-text-muted font-black uppercase tracking-widest">Client Type</label>
                                <div className="flex bg-background/50 p-1 rounded-xl border border-border/50">
                                    <button 
                                        onClick={() => setGroupType('family')}
                                        className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${groupType === 'family' ? 'bg-primary text-white shadow-lg' : 'text-text-muted hover:text-text-primary'}`}
                                    >Family</button>
                                    <button 
                                        onClick={() => setGroupType('friends')}
                                        className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${groupType === 'friends' ? 'bg-primary text-white shadow-lg' : 'text-text-muted hover:text-text-primary'}`}
                                    >Friends</button>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[9px] text-text-muted font-black uppercase tracking-widest">Composition</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="relative">
                                        <input 
                                            type="number"
                                            value={numAdults}
                                            onChange={e => setNumAdults(parseInt(e.target.value))}
                                            className="w-full bg-background/50 border border-border/50 rounded-xl py-2 px-3 text-xs font-bold text-text-primary pl-8"
                                            placeholder="Ads"
                                        />
                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 material-symbols-outlined notranslate text-[14px] text-text-muted">person</span>
                                    </div>
                                    <div className="relative">
                                        <input 
                                            type="number"
                                            value={numChildren}
                                            onChange={e => setNumChildren(parseInt(e.target.value))}
                                            className="w-full bg-background/50 border border-border/50 rounded-xl py-2 px-3 text-xs font-bold text-text-primary pl-8"
                                            placeholder="Chl"
                                        />
                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 material-symbols-outlined notranslate text-[14px] text-text-muted">child_care</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[9px] text-text-muted font-black uppercase tracking-widest">Group Description</label>
                            <textarea 
                                value={groupComposition}
                                onChange={e => setGroupComposition(e.target.value)}
                                className="w-full bg-background/50 border border-border/50 rounded-2xl py-3 px-4 text-xs font-medium text-text-primary focus:border-primary/50 transition-all outline-none"
                                placeholder="e.g. 2 couples, 3 single friends..."
                                rows={2}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex items-center justify-between p-3 bg-background/30 rounded-2xl border border-border/30">
                                <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined notranslate text-text-muted text-[18px]">pets</span>
                                    <span className="text-[10px] font-bold text-text-muted uppercase">Pets</span>
                                </div>
                                <button 
                                    onClick={() => setHasPets(!hasPets)}
                                    className={`size-6 rounded-lg flex items-center justify-center transition-all ${hasPets ? 'bg-primary text-white shadow-md' : 'bg-surface-3 text-text-muted'}`}
                                >
                                    <span className="material-symbols-outlined notranslate text-[16px]">{hasPets ? 'check' : 'close'}</span>
                                </button>
                            </div>
                            {hasPets && (
                                <input 
                                    type="text"
                                    value={petDetails}
                                    onChange={e => setPetDetails(e.target.value)}
                                    className="w-full bg-background/50 border border-border/50 rounded-xl py-2 px-3 text-xs font-medium text-text-primary"
                                    placeholder="Which pet?"
                                />
                            )}
                        </div>
                    </div>

                    <div className="p-5 bg-surface-2/50 rounded-2xl space-y-4 border border-border/50">
                        <p className="text-[10px] text-text-muted font-black uppercase tracking-widest border-b border-border/50 pb-2">Selected Fleet</p>
                        <div className="max-h-40 overflow-y-auto space-y-3 pr-2 scrollbar-thin">
                            {selectedBoats.map(b => (
                                <div key={b.v_uuid} className="flex justify-between items-center text-sm">
                                    <div className="flex flex-col">
                                        <span className="text-text-primary font-bold">{b.boat_name}</span>
                                        <span className="text-[10px] text-text-muted uppercase font-medium">{b.manufacturer} {b.model}</span>
                                    </div>
                                    <span className="text-primary font-black">€{(b.daily_price || 0).toLocaleString()} <small className="text-[8px] opacity-60">/DAY</small></span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-surface-2/50 rounded-2xl border border-border/50">
                            <p className="text-[10px] text-text-muted font-black uppercase tracking-widest">Check-in</p>
                            <p className="text-sm font-black text-text-primary mt-1">{checkIn ? new Date(checkIn).toLocaleDateString('en-GB') : 'NOT SET'}</p>
                        </div>
                        <div className="p-4 bg-surface-2/50 rounded-2xl border border-border/50">
                            <p className="text-[10px] text-text-muted font-black uppercase tracking-widest">Check-out</p>
                            <p className="text-sm font-black text-text-primary mt-1">{checkOut ? new Date(checkOut).toLocaleDateString('en-GB') : 'NOT SET'}</p>
                        </div>
                    </div>
                </div>

                <div className="flex gap-4 pt-4 border-t border-border/50">
                    <button 
                        onClick={onClose}
                        className="flex-1 py-4 rounded-2xl border border-border text-text-muted font-black uppercase tracking-widest hover:bg-surface-2 transition-all text-[11px]"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleCreateQuotes}
                        disabled={saving || !selectedClientId}
                        className="flex-[2] btn-primary py-4 font-black uppercase tracking-widest shadow-xl shadow-primary/20 disabled:opacity-40 text-[11px]"
                    >
                        {saving ? 'Creating...' : `Finalize ${selectedBoats.length} Quote${selectedBoats.length > 1 ? 's' : ''}`}
                    </button>
                </div>
            </div>
        </div>
    );
}
