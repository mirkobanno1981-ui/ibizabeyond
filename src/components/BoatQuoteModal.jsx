import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function BoatQuoteModal({ selectedBoats, checkIn, checkOut, onClose, onCreated }) {
    const { user } = useAuth();
    const [clients, setClients] = useState([]);
    const [selectedClientId, setSelectedClientId] = useState('');
    const [saving, setSaving] = useState(false);
    const [ivaPercent, setIvaPercent] = useState(21);
    const [success, setSuccess] = useState(false);
    const [createdIds, setCreatedIds] = useState([]);

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
                const adminMarkup = 0;
                
                const breakdown = [];
                breakdown.push({ 
                    label: `Base Charter (${days} day${days > 1 ? 's' : ''})`, 
                    amount: Math.round(basePrice), 
                    desc: priceBreakdownDescription
                });

                // Boats often have fuel, skipper, etc., but those are usually "Extras" added later
                // or part of the public price. For now, keep it simple like villas.
                
                const ivaAmount = basePrice * (ivaPercent / 100);
                breakdown.push({ label: `IVA (VAT) ${ivaPercent}%`, amount: Math.round(ivaAmount), desc: 'VAT on charter' });
                
                const finalPrice = Math.round(basePrice + ivaAmount);

                return {
                    boat_uuid: boat.v_uuid,
                    client_id: selectedClientId,
                    check_in: checkIn || null,
                    check_out: checkOut || null,
                    supplier_base_price: basePrice,
                    admin_markup: adminMarkup,
                    agent_markup: 15, // Default margin
                    final_price: finalPrice,
                    status: 'draft',
                    agent_id: user?.id,
                    price_breakdown: breakdown
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

                <div className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-[10px] text-text-muted font-black uppercase tracking-widest block">Select Client</label>
                        <select 
                            className="input-theme w-full py-3 px-4 font-bold text-text-primary"
                            value={selectedClientId}
                            onChange={e => setSelectedClientId(e.target.value)}
                        >
                            <option value="">CHOOSE A CLIENT...</option>
                            {clients.map(c => (
                                <option key={c.id} value={c.id}>{c.full_name.toUpperCase()}</option>
                            ))}
                        </select>
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
