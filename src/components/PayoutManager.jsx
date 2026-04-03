import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function PayoutManager() {
    const { role } = useAuth();
    const [quotes, setQuotes] = useState([]);
    const [stats, setStats] = useState({ totalProfit: 0, pendingOwner: 0, pendingAgency: 0 });
    const [marginSettings, setMarginSettings] = useState({ iva_percent: 0, invenio_to_admin_margin: 0 });
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        const init = async () => {
            const { data } = await supabase.from('margin_settings').select('*').limit(1).single();
            if (data) setMarginSettings(data);
            fetchPayoutData(data);
        };
        init();
    }, []);

    const fetchPayoutData = async (settings = marginSettings) => {
        setRefreshing(true);
        try {
            // Fetch booked quotes with status 'booked'
            const { data, error } = await supabase
                .from('quotes')
                .select(`
                    id, created_at, final_price, status, supplier_base_price, admin_markup, agent_markup, agent_id,
                    payout_owner_sent_at, payout_collaborator_sent_at,
                    clients (full_name),
                    invenio_properties (villa_name)
                `)
                .eq('status', 'booked')
                .order('created_at', { ascending: false });

            if (error) throw error;
            
            setQuotes(data || []);

            // Calculate totals
            const totals = (data || []).reduce((acc, q) => {
                const base = parseFloat(q.supplier_base_price || 0);
                const finalPrice = parseFloat(q.final_price || 0);
                const ivaPct = parseFloat(settings.iva_percent || 0);
                
                // Calculate extras total from the quote object if available
                const extrasTotal = (q.extra_services || []).reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0);
                
                const markup = finalPrice - base;
                const ivaTotal = markup * (ivaPct / (100 + ivaPct));
                
                const adminPct = parseFloat(q.admin_markup || 0);
                const agentPct = parseFloat(q.agent_markup || 0);
                
                const platformNet = base * (adminPct / 100);
                const platformIva = platformNet * (ivaPct / 100);
                const platformGross = platformNet + platformIva;

                // Agent Profit = (Property Margin) + (Commission on extra services)
                // markup - platformGross - ivaTotal + platformIva is basically (agentMarkupOnProperty + extrasTotal)
                // But the user specifically wants the agent to take their percentage from the extras too.
                // If extras are purely platform/agent money (not owner), the whole extrasTotal is "profit" to split.
                const agencyGross = Math.max(0, markup - platformGross - ivaTotal + platformIva);
                
                const isB2C = !q.agent_id || q.agent_id === '72241c14-09ed-4227-a01e-9bdeefdd0c8d';
                
                acc.totalProfit += isB2C ? (platformGross + (markup - platformGross)) : platformGross;
                
                if (!q.payout_owner_sent_at) acc.pendingOwner += base;
                if (!isB2C && !q.payout_collaborator_sent_at) acc.pendingAgency += agencyGross;
                
                return acc;
            }, { totalProfit: 0, pendingOwner: 0, pendingAgency: 0 });

            setStats(totals);
        } catch (err) {
            console.error('Error fetching payout data:', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const handlePayout = async (quoteId, targetType, amount) => {
        if (!confirm(`Confirm payout of €${amount.toLocaleString()} to ${targetType}?`)) return;

        try {
            const { error: invokeErr } = await supabase.functions.invoke('stripe-payout', {
                body: { quoteId, targetType, amount }
            });

            if (invokeErr) throw invokeErr;

            // Update local state and DB
            const updateField = targetType === 'owner' ? 'payout_owner_sent_at' : 'payout_collaborator_sent_at';
            const { error: updateErr } = await supabase
                .from('quotes')
                .update({ [updateField]: new Date().toISOString() })
                .eq('id', quoteId);

            if (updateErr) throw updateErr;

            alert('Payout successful!');
            fetchPayoutData(); // Refresh list
        } catch (err) {
            console.error('Payout failed:', err);
            alert(`Payout failed: ${err.message}`);
        }
    };

    if (loading) return (
        <div className="p-8 flex items-center justify-center min-h-[400px]">
            <div className="animate-spin size-8 border-2 border-primary border-t-transparent rounded-full font-black"></div>
        </div>
    );

    return (
        <div className="p-6 md:p-8 space-y-8 animate-in fade-in duration-700">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-text-primary tracking-tight uppercase">Payouts & Profits</h1>
                    <p className="text-text-muted text-sm mt-1 font-medium font-mono tracking-tighter uppercase">Financial Settlement Control Center</p>
                </div>
                <button 
                    onClick={fetchPayoutData}
                    disabled={refreshing}
                    className="bg-surface-2 border border-border rounded-xl px-4 py-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest hover:border-primary transition-all"
                >
                    <span className={`material-symbols-outlined notranslate text-[16px] ${refreshing ? 'animate-spin' : ''}`}>refresh</span>
                    Refresh Data
                </button>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass-card p-6 border-emerald-500/20 bg-emerald-500/5">
                    <p className="text-[10px] text-emerald-400 font-black uppercase tracking-[0.2em] mb-2 text-center text-glow">Invenio Net Profit</p>
                    <p className="text-4xl font-black text-emerald-400 text-center drop-shadow-[0_0_15px_rgba(52,211,153,0.3)]">€{stats.totalProfit.toLocaleString()}</p>
                    <p className="text-[8px] text-text-muted mt-2 text-center uppercase tracking-widest font-bold">Total Platform + B2C Commissions</p>
                </div>
                <div className="glass-card p-6 border-primary/20 bg-primary/5">
                    <p className="text-[10px] text-primary font-black uppercase tracking-[0.2em] mb-2 text-center">Pending Owner Payouts</p>
                    <p className="text-4xl font-black text-primary text-center">€{stats.pendingOwner.toLocaleString()}</p>
                    <p className="text-[8px] text-text-muted mt-2 text-center uppercase tracking-widest font-bold font-mono">Unsettled supplier base costs</p>
                </div>
                <div className="glass-card p-6 border-blue-500/20 bg-blue-500/5">
                    <p className="text-[10px] text-blue-400 font-black uppercase tracking-[0.2em] mb-2 text-center">Pending Agency Payouts</p>
                    <p className="text-4xl font-black text-blue-400 text-center">€{stats.pendingAgency.toLocaleString()}</p>
                    <p className="text-[8px] text-text-muted mt-2 text-center uppercase tracking-widest font-bold font-mono">Commissions due to external agents</p>
                </div>
            </div>

            {/* Bookings Table */}
            <div className="glass-card overflow-hidden border-border bg-surface shadow-2xl relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-primary to-blue-500"></div>
                <div className="p-5 border-b border-border bg-surface-2 flex items-center justify-between">
                    <h3 className="text-text-primary font-black text-[12px] uppercase tracking-[0.2em] flex items-center gap-3">
                        <span className="material-symbols-outlined notranslate text-primary text-[20px]">account_balance_wallet</span>
                        Settlement Ledger
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-[12px]">
                        <thead>
                            <tr className="text-text-muted font-black uppercase tracking-[0.2em] bg-surface-2/50 text-[9px]">
                                <th className="px-6 py-4">Booking Details</th>
                                <th className="px-6 py-4 text-center">Price (Gross)</th>
                                <th className="px-6 py-4 text-center">Platform Cost (+VAT)</th>
                                <th className="px-6 py-4 text-center">Agency Profit (+VAT)</th>
                                <th className="px-6 py-4 text-center">Villa Share (Net)</th>
                                <th className="px-6 py-4 text-right">Settlement Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {quotes.length > 0 ? (
                                quotes.map(q => {
                                    const base = parseFloat(q.supplier_base_price || 0);
                                    const finalPrice = parseFloat(q.final_price || 0);
                                    const ivaPct = parseFloat(marginSettings.iva_percent || 0);
                                    
                                    const extrasTotal = (q.extra_services || []).reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0);
                                    const markup = finalPrice - base;
                                    const ivaTotal = markup * (ivaPct / (100 + ivaPct));
                                    
                                    const adminPct = parseFloat(q.admin_markup || 0);
                                    const platformNet = base * (adminPct / 100);
                                    const platformIva = platformNet * (ivaPct / 100);
                                    const platformGross = Math.round(platformNet + platformIva);

                                    // The residual markup after Invenio's cut and VAT is the agency share
                                    const agencyGross = Math.max(0, Math.round(markup - platformGross));
                                    
                                    const ownerShare = Math.round(base);
                                    const isB2C = !q.agent_id || q.agent_id === '72241c14-09ed-4227-a01e-9bdeefdd0c8d';

                                    return (
                                        <tr key={q.id} className="hover:bg-primary/5 transition-all group border-l-2 border-transparent hover:border-primary">
                                            <td className="px-6 py-5">
                                                <p className="text-text-primary font-black uppercase tracking-tight text-[11px]">{q.clients?.full_name || 'Guest'}</p>
                                                <p className="text-[9px] text-primary font-bold uppercase tracking-widest mt-0.5">{q.invenio_properties?.villa_name}</p>
                                                <p className="text-[8px] text-text-muted mt-1 uppercase tracking-tighter">REF: {q.id.slice(0, 8)}</p>
                                            </td>
                                            <td className="px-6 py-5 text-center font-black text-text-primary text-[14px]">
                                                €{q.final_price?.toLocaleString()}
                                            </td>
                                            <td className="px-6 py-5 text-center">
                                                <p className="font-bold text-emerald-400">€{platformGross.toLocaleString()}</p>
                                                <span className="text-[8px] opacity-60 font-black uppercase tracking-tighter">
                                                    VAT: €{Math.round(platformIva).toLocaleString()}
                                                </span>
                                            </td>
                                            <td className="px-6 py-5 text-center">
                                                <p className={`font-bold ${isB2C ? 'text-blue-400' : 'text-text-primary'}`}>€{agencyGross.toLocaleString()}</p>
                                                <span className={`text-[8px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded ${isB2C ? 'bg-blue-500/10 text-blue-400' : (q.payout_collaborator_sent_at ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-500')}`}>
                                                    {isB2C ? 'Internal B2C' : (q.payout_collaborator_sent_at ? 'Settled' : 'Pending Payout')}
                                                </span>
                                            </td>
                                            <td className="px-6 py-5 text-center">
                                                <p className="font-bold text-text-primary">€{ownerShare.toLocaleString()}</p>
                                                <span className={`text-[8px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded ${q.payout_owner_sent_at ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-500'}`}>
                                                    {q.payout_owner_sent_at ? 'Settled' : 'Pending'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-5 text-right">
                                                <div className="flex flex-col gap-2 scale-90 origin-right">
                                                    <button 
                                                        onClick={() => handlePayout(q.id, 'owner', ownerShare)}
                                                        disabled={q.payout_owner_sent_at}
                                                        className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${q.payout_owner_sent_at ? 'bg-surface-2 text-text-muted' : 'bg-primary text-black hover:scale-105 shadow-lg shadow-primary/20'}`}
                                                    >
                                                        {q.payout_owner_sent_at ? 'OWNER SETTLED' : 'DISBURSE OWNER'}
                                                    </button>
                                                    {!isB2C ? (
                                                        <button 
                                                            onClick={() => handlePayout(q.id, 'collaborator', agencyGross)}
                                                            disabled={q.payout_collaborator_sent_at || agencyGross <= 0}
                                                            className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${q.payout_collaborator_sent_at || agencyGross <= 0 ? 'bg-surface-2 text-text-muted' : 'border border-primary text-primary hover:bg-primary/10'}`}
                                                        >
                                                            {q.payout_collaborator_sent_at ? 'AGENCY SETTLED' : (agencyGross <= 0 ? 'NO FEE' : 'DISBURSE AGENT')}
                                                        </button>
                                                    ) : (
                                                        <div className="px-4 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 text-[9px] font-black uppercase tracking-widest border border-blue-500/20 text-center">
                                                            B2C INTERNAL
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan="6" className="px-6 py-20 text-center text-text-muted italic text-[11px] font-medium uppercase tracking-[0.2em]">No booked quotes awaiting payout.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Manual Entry Footer */}
            <div className="p-4 rounded-xl border border-dashed border-border bg-surface-2/30 text-center">
                <p className="text-[9px] text-text-muted font-bold uppercase tracking-widest">
                    Funds are held in your platform's Stripe balance until manually triggered above. 
                    Ensure all connected accounts are verified.
                </p>
            </div>
        </div>
    );
}
