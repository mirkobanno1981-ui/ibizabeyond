import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useGlobalSettings } from '../contexts/GlobalSettingsContext';

function StatCard({ icon, label, value, sub, accent, trend }) {
    return (
        <div className="stat-card flex items-start gap-4">
            <div className={`p-2.5 rounded-lg ${accent || 'bg-primary/10'}`}>
                <span className={`material-symbols-outlined notranslate text-[20px] ${accent ? 'text-text-primary' : 'text-primary'}`}>{icon}</span>
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest mb-1">{label}</p>
                <div className="flex items-center gap-2">
                    <p className="text-2xl font-bold text-text-primary">{value}</p>
                    {trend && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${trend > 0 ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                            {trend > 0 ? '+' : ''}{trend}%
                        </span>
                    )}
                </div>
                {sub && <p className="text-[10px] text-text-muted mt-0.5 font-medium">{sub}</p>}
            </div>
        </div>
    );
}

function BarChart({ data, title, subtitle }) {
    const max = Math.max(...data.map(d => d.value), 1);
    return (
        <div className="glass-card p-5 border-border flex flex-col h-full">
            <div className="mb-6">
                <h3 className="text-text-primary font-bold text-sm tracking-tight">{title}</h3>
                <p className="text-[10px] text-text-muted uppercase tracking-widest font-bold mt-0.5">{subtitle}</p>
            </div>
            <div className="flex-1 flex items-end justify-between gap-2 px-2 min-h-[120px]">
                {data.map((d, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end">
                        <div 
                            className="w-full bg-primary/20 rounded-t-md group-hover:bg-primary/40 transition-all relative min-h-[4px]"
                            style={{ height: `${(d.value / max) * 80}%` }}
                        >
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-bold text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                                {d.value}
                            </div>
                        </div>
                        <span className="text-[9px] text-text-muted font-bold uppercase truncate w-full text-center">{d.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function DonutChart({ data, title, subtitle }) {
    const colors = ['bg-primary', 'bg-blue-400', 'bg-purple-400', 'bg-amber-400', 'bg-emerald-400'];
    const strokeColors = ['#D4AF37', '#60A5FA', '#A78BFA', '#FBBF24', '#34D399'];
    
    const total = data.reduce((acc, d) => acc + d.value, 0);
    let cumulativeOffset = 0;

    return (
        <div className="glass-card p-5 border-border flex flex-col h-full">
            <div className="mb-4">
                <h3 className="text-text-primary font-bold text-sm tracking-tight">{title}</h3>
                <p className="text-[10px] text-text-muted uppercase tracking-widest font-bold mt-0.5">{subtitle}</p>
            </div>
            <div className="flex-1 flex flex-col sm:flex-row items-center justify-around gap-6">
                 <div className="relative size-32">
                    <svg className="size-full -rotate-90" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="40" className="stroke-white/5" strokeWidth="12" fill="none" />
                        {data.map((d, i) => {
                            const percentage = (d.value / total) * 100;
                            const dashArray = (percentage * 251.2) / 100;
                            const offset = 251.2 - (cumulativeOffset * 251.2) / 100;
                            cumulativeOffset += percentage;
                            return (
                                <circle 
                                    key={i}
                                    cx="50" cy="50" r="40" 
                                    stroke={strokeColors[i % strokeColors.length]} 
                                    strokeWidth="12" 
                                    fill="none" 
                                    strokeDasharray="251.2" 
                                    strokeDashoffset={offset} 
                                    strokeLinecap="round" 
                                    className="transition-all duration-1000"
                                />
                            );
                        })}
                    </svg>
                    <div className="absolute inset-x-0 top-[40%] text-center">
                        <p className="text-lg font-bold text-text-primary leading-none">{total}</p>
                        <p className="text-[8px] text-text-muted uppercase font-black tracking-widest">Total</p>
                    </div>
                </div>
                <div className="space-y-2 flex-1">
                    {data.map((d, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 group">
                            <div className="flex items-center gap-2">
                                <div className={`size-2 rounded-full ${colors[i % colors.length]}`}></div>
                                <span className="text-[11px] text-text-muted font-bold uppercase truncate max-w-[100px]">{d.label}</span>
                            </div>
                            <span className="text-[11px] text-text-muted font-mono font-bold">{Math.round((d.value/total)*100)}%</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function Dashboard() {
    const { role, user } = useAuth();
    const queryClient = useQueryClient();
    const { villas_enabled, boats_enabled } = useGlobalSettings();
    const navigate = useNavigate();

    const displayName = user?.user_metadata?.first_name || user?.email?.split('@')[0] || 'Agent';

    // --- Queries ---
    const { data: dashboardData, isLoading: loading } = useQuery({
        queryKey: ['dashboard', role, user?.id],
        queryFn: async () => {
            if (!user?.id) return null;

            const quotesQuery = supabase.from('quotes').select('id', { count: 'exact', head: true });
            const clientsQuery = supabase.from('clients').select('id', { count: 'exact', head: true });
            const recentQuery = supabase.from('quotes').select(`
                id, created_at, final_price, supplier_base_price, admin_markup, agent_markup, status, agent_id, v_uuid,
                payout_owner_sent_at, payout_collaborator_sent_at,
                security_deposit_authorized, security_deposit_intent_id,
                agents (company_name),
                price_breakdown,
                clients (full_name),
                invenio_properties (villa_name, deposit)
            `).order('created_at', { ascending: false }).limit(20);

            let depositsQuery = supabase.from('quotes').select(`
                id, created_at, final_price, status,
                security_deposit_authorized, security_deposit_intent_id,
                clients (full_name),
                invenio_properties (villa_name, deposit)
            `).eq('security_deposit_authorized', true);
            
            let approvalsQuery = supabase.from('quotes').select(`
                id, created_at, final_price, status,
                clients (full_name),
                invenio_properties (villa_name)
            `).eq('status', 'waiting_owner');

            // Role Filtering
            if (role === 'owner') {
                const { data: ownedVillas } = await supabase.from('invenio_properties').select('v_uuid').eq('owner_id', user.id);
                const villaIds = (ownedVillas || []).map(v => v.v_uuid);
                if (villaIds.length > 0) {
                    quotesQuery.in('v_uuid', villaIds);
                    recentQuery.in('v_uuid', villaIds);
                    depositsQuery.in('v_uuid', villaIds);
                    approvalsQuery.in('v_uuid', villaIds);
                } else {
                    const fakeId = '00000000-0000-0000-0000-000000000000';
                    quotesQuery.eq('id', fakeId); recentQuery.eq('id', fakeId);
                    depositsQuery.eq('id', fakeId); approvalsQuery.eq('id', fakeId);
                }
            } else if (role !== 'admin' && role !== 'super_admin') {
                const { data: agentProfile } = await supabase.from('agents').select('agent_type').eq('id', user.id).single();
                let agentIds = [user.id];
                if (agentProfile?.agent_type === 'agency') {
                    const { data: subAgents } = await supabase.from('agents').select('id').eq('parent_agent_id', user.id);
                    agentIds = [user.id, ...(subAgents || []).map(a => a.id)];
                }
                quotesQuery.in('agent_id', agentIds);
                clientsQuery.in('agent_id', agentIds);
                recentQuery.in('agent_id', agentIds);
                depositsQuery.in('agent_id', agentIds);
                approvalsQuery.in('agent_id', agentIds);
            }

            const [villasRes, boatsRes, quotesRes, clientsRes, areasRes, recentRes, depositsRes, approvalsRes] = await Promise.all([
                supabase.from('invenio_properties').select('v_uuid', { count: 'exact', head: true }),
                supabase.from('invenio_boats').select('*', { count: 'exact', head: true }),
                quotesQuery,
                clientsQuery,
                supabase.from('invenio_properties').select('areaname').limit(1000),
                recentQuery,
                depositsQuery,
                role === 'owner' ? approvalsQuery : Promise.resolve({ data: [] })
            ]);

            // Area distribution logic
            const areaCounts = (areasRes.data || []).reduce((acc, p) => {
                const area = p.areaname || 'Unknown';
                acc[area] = (acc[area] || 0) + 1;
                return acc;
            }, {});
            const areaDistribution = Object.entries(areaCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([label, value]) => ({ label, value }));

            return {
                stats: {
                    villas: villasRes.count || 0,
                    boats: boatsRes.count || 0,
                    quotes: quotesRes.count || 0,
                    clients: clientsRes.count || 0,
                },
                recentQuotes: recentRes.data || [],
                securityDeposits: depositsRes.data || [],
                pendingApprovals: approvalsRes.data || [],
                areaDistribution: areaDistribution.length > 0 ? areaDistribution : [{label:'Ibiza', value:1}],
                monthlyPerformance: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map(m => ({ label: m, value: Math.floor(Math.random() * 5) }))
            };
        },
        enabled: !!user?.id,
        staleTime: 1000 * 60 * 5, // 5 mins
    });

    const stats = dashboardData?.stats || { villas: 0, boats: 0, quotes: 0, clients: 0 };
    const recentQuotes = dashboardData?.recentQuotes || [];
    const securityDeposits = dashboardData?.securityDeposits || [];
    const pendingApprovals = dashboardData?.pendingApprovals || [];
    const areaDistribution = dashboardData?.areaDistribution || [];
    const monthlyPerformance = dashboardData?.monthlyPerformance || [];

    const handlePayout = async (quoteId, targetType, amount) => {
        if (!confirm(`Confirm payout of €${amount.toLocaleString()}?`)) return;
        try {
            const { error } = await supabase.functions.invoke('stripe-payout', {
                body: { quoteId, targetType, amount }
            });
            if (error) throw error;
            const field = targetType === 'owner' ? 'payout_owner_sent_at' : 'payout_collaborator_sent_at';
            await supabase.from('quotes').update({ [field]: new Date().toISOString() }).eq('id', quoteId);
            alert('Payout successful!');
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        } catch (err) {
            alert('Payout failed: ' + err.message);
        }
    };

    const handleApprovalAction = async (quoteId, action, reason = '') => {
        let newStatus = 'sent';
        let updateData = { status: newStatus };

        if (action === 'decline') {
            newStatus = 'owner_declined';
            updateData = { status: newStatus, owner_decline_reason: reason };
        } else if (action === 'request_details') {
            newStatus = 'details_requested';
            updateData = { status: newStatus, owner_details_request: reason };
        }

        try {
            const { error } = await supabase
                .from('quotes')
                .update(updateData)
                .eq('id', quoteId);
            
            if (error) throw error;
            
            // Trigger Notification to Agent
            supabase.functions.invoke('notify-owner', {
                body: { quoteId, action, message: reason }
            }).catch(err => console.error('Notification failed:', err));

            alert(`Quote ${action === 'approve' ? 'approved' : action === 'decline' ? 'declined' : 'details requested'}!`);
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        } catch (err) {
            alert('Error updating quote: ' + err.message);
        }
    };

    const handleManageDeposit = async (quoteId, action, amount = null) => {
        const msg = action === 'release' 
            ? 'Release the entire security deposit to the guest?' 
            : `Capture €${amount ? amount.toLocaleString() : 'full amount'} from the security deposit for damages?`;
        
        if (!confirm(msg)) return;

        try {
            const { data, error } = await supabase.functions.invoke('manage-security-deposit', {
                body: { quoteId, action, amount }
            });

            if (error) throw error;
            alert(action === 'release' ? 'Deposit released successfully.' : 'Deposit captured successfully.');
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        } catch (err) {
            alert('Deposit management failed: ' + err.message);
        }
    };

    return (
        <div className="p-6 md:p-8 space-y-8 animate-in fade-in duration-700">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-text-primary tracking-tight uppercase">
                        Hello, {displayName} <span className="text-primary italic">Beyond</span>
                    </h1>
                    <p className="text-text-muted text-[10px] mt-1 font-black uppercase tracking-widest leading-none">
                        {role} Access — {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => queryClient.invalidateQueries({ queryKey: ['dashboard'] })} className="p-2 text-text-muted hover:text-text-primary transition-colors">
                        <span className="material-symbols-outlined notranslate text-[20px]">refresh</span>
                    </button>
                    <div className="bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-xl">
                        <span className="text-[9px] text-primary font-black uppercase tracking-[0.2em]">Secure Node 01</span>
                    </div>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {villas_enabled && <StatCard icon="villa" label="Villa Inventory" value={loading ? '...' : stats.villas} sub="Global Properties" />}
                {boats_enabled && <StatCard icon="directions_boat" label="Boat Fleet" value={loading ? '...' : stats.boats || 0} sub="Managed Vessels" />}
                <StatCard icon="request_quote" label="Pipeline" value={loading ? '...' : stats.quotes} sub="Active Proposals" trend={12} />
                <StatCard icon="group" label="Clients" value={loading ? '...' : stats.clients} sub="Portfolio Leads" />
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left: Charts & Table */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[300px]">
                        <BarChart title="Proposals" subtitle="Monthly Performance" data={monthlyPerformance} />
                        <DonutChart title="Regions" subtitle="Inventory Density" data={areaDistribution.length > 0 ? areaDistribution : [{label:'Ibiza', value:10}]} />
                    </div>

                    <div className="glass-card overflow-hidden border-border bg-surface">
                        <div className="p-5 border-b border-border bg-surface-2 flex items-center justify-between">
                            <h3 className="text-text-primary font-black text-[11px] uppercase tracking-[0.2em] flex items-center gap-2">
                                <span className="material-symbols-outlined notranslate text-primary text-[18px]">history</span>
                                Global Proposals Ledger
                            </h3>
                            <button onClick={() => navigate('/quotes')} className="text-[10px] text-primary font-black uppercase tracking-widest hover:underline">View Ledger</button>
                        </div>
                        <div className="overflow-x-auto overflow-y-auto max-h-[400px]">
                            <table className="w-full text-left text-[11px]">
                                <thead>
                                    <tr className="text-text-muted font-black uppercase tracking-[0.2em] bg-surface-2/50 text-[9px]">
                                        <th className="px-5 py-4">Client / Property</th>
                                        <th className="px-5 py-4 text-center">Gross Final</th>
                                        <th className="px-5 py-4 text-center">Status</th>
                                        <th className="px-5 py-4 text-right">Registered</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/30">
                                    {recentQuotes.length > 0 ? recentQuotes.map(q => (
                                        <tr key={q.id} onClick={() => navigate('/quotes')} className="hover:bg-primary/5 cursor-pointer transition-all border-l-2 border-transparent hover:border-primary">
                                            <td className="px-5 py-4">
                                                <p className="font-black text-text-primary uppercase">{q.clients?.full_name || 'Guest'}</p>
                                                <p className="text-[9px] text-text-muted uppercase tracking-tighter mt-0.5">REF: {q.id.slice(0,8)}</p>
                                            </td>
                                            <td className="px-5 py-4 text-center font-bold text-text-primary">€{q.final_price?.toLocaleString()}</td>
                                            <td className="px-5 py-4 text-center">
                                                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${
                                                    q.status === 'booked' ? 'bg-emerald-500/10 text-emerald-400' :
                                                    q.status === 'sent' ? 'bg-blue-500/10 text-blue-400' :
                                                    q.status === 'waiting_owner' ? 'bg-amber-500/10 text-amber-500' :
                                                    q.status === 'owner_declined' ? 'bg-red-500/10 text-red-400' :
                                                    q.status === 'details_requested' ? 'bg-primary/10 text-primary' :
                                                    'bg-surface-2 text-text-muted'
                                                }`}>
                                                    {q.status?.replace(/_/g, ' ')}
                                                </span>
                                            </td>
                                            <td className="px-5 py-4 text-right font-mono text-text-muted">{new Date(q.created_at).toLocaleDateString('en-GB')}</td>
                                        </tr>
                                    )) : (
                                        <tr>
                                            <td colSpan="4" className="px-5 py-20 text-center text-text-muted italic uppercase tracking-widest font-medium">No results found</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Right: Actions & Payouts */}
                <div className="space-y-6">
                    {/* QUOTE APPROVALS MANAGER (Visible to Owners) */}
                    {role === 'owner' && (
                        <div className="glass-card overflow-hidden border-border bg-surface shadow-xl relative">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-blue-500"></div>
                            <div className="p-4 border-b border-border bg-surface-2 flex items-center justify-between">
                                <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-text-primary">Stays Approvals</h2>
                                <span className="bg-primary/10 text-primary text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest animate-pulse">Pending Review</span>
                            </div>
                            <div className="p-4 space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar">
                                {pendingApprovals.length > 0 ? (
                                    pendingApprovals.map(q => (
                                        <div key={q.id} className="p-4 rounded-xl bg-surface-2/40 border border-border group hover:border-primary/30 transition-all">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex-1">
                                                    <p className="text-sm font-bold text-text-primary">{q.invenio_properties?.villa_name || q.invenio_boats?.boat_name}</p>
                                                    <p className="text-[10px] text-text-muted uppercase tracking-wider font-medium">Guest: {q.clients?.full_name || 'Guest'} • Ref: {q.id?.slice(0, 8)}</p>
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <span className="text-[10px] bg-background/50 px-2 py-1 rounded border border-border text-text-muted font-bold">€{parseFloat(q.final_price || 0).toLocaleString()}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border/50">
                                                <button 
                                                    onClick={() => handleApprovalAction(q.id, 'approve')}
                                                    className="col-span-2 bg-emerald-500 text-background-dark py-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all"
                                                >
                                                    Approve Stay
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        const reason = prompt("Reason for decline:");
                                                        if (reason) handleApprovalAction(q.id, 'decline', reason);
                                                    }}
                                                    className="bg-red-500/10 text-red-400 border border-red-500/20 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-red-500/20 transition-all"
                                                >
                                                    Decline
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        const details = prompt("What specific details do you need about the guest profile?");
                                                        if (details) handleApprovalAction(q.id, 'request_details', details);
                                                    }}
                                                    className="bg-primary/10 text-primary border border-primary/20 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-primary/20 transition-all"
                                                >
                                                    More Details
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="py-20 text-center space-y-4 opacity-40">
                                        <span className="material-symbols-outlined notranslate text-4xl block">verified</span>
                                        <p className="text-[10px] font-black uppercase tracking-widest">No pending approvals</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* SECURITY DEPOSITS MANAGER (Visible to Owners and Super Admin) */}
                    {(role === 'owner' || role === 'super_admin') && (
                        <div className="glass-card overflow-hidden border-border bg-surface shadow-xl relative">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-orange-500"></div>
                            <div className="p-4 border-b border-border bg-surface-2 flex items-center justify-between">
                                <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-text-primary">Deposit Authorizations</h2>
                                <span className="bg-amber-500/10 text-amber-500 text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest">Action Required</span>
                            </div>
                            <div className="p-4 space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar">
                                {securityDeposits.length > 0 ? (
                                    securityDeposits.map(q => (
                                        <div key={q.id} className="p-4 rounded-xl bg-surface-2/40 border border-border group hover:border-amber-500/30 transition-all">
                                            <div className="flex items-start justify-between mb-3">
                                                <div>
                                                    <p className="text-sm font-bold text-text-primary">{q.invenio_properties?.villa_name}</p>
                                                    <p className="text-[10px] text-text-muted uppercase tracking-wider font-medium">{q.clients?.full_name || 'Guest'} • REF: {q.id?.slice(0, 8)}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-sm font-black text-amber-500">€{parseFloat(q.invenio_properties?.deposit || 0).toLocaleString()}</p>
                                                    <p className="text-[9px] text-text-muted font-bold">FROZEN DEPOSIT</p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 pt-3 border-t border-border/50">
                                                <button 
                                                    onClick={() => handleManageDeposit(q.id, 'release')}
                                                    className="flex-1 bg-emerald-500 text-background-dark py-2 rounded-lg text-[9px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all"
                                                >
                                                    Release Full
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        const amount = prompt("Enter amount to capture for damages (EUR):", q.invenio_properties?.deposit);
                                                        if (amount) handleManageDeposit(q.id, 'capture', parseFloat(amount));
                                                    }}
                                                    className="flex-1 bg-red-500/10 text-red-500 border border-red-500/20 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-red-500/20 transition-all font-bold"
                                                >
                                                    Report Damage
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="py-20 text-center space-y-4 opacity-40">
                                        <span className="material-symbols-outlined notranslate text-4xl block">verified_user</span>
                                        <p className="text-[10px] font-black uppercase tracking-widest">No active authorizations</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* PAYOUT MANAGER */}
                    {role === 'super_admin' && (
                        <div className="glass-card overflow-hidden border-border bg-surface shadow-xl relative">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-emerald-500"></div>
                            <div className="p-4 border-b border-border bg-surface-2 flex items-center justify-between">
                                <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-text-primary">Settlement Queue</h2>
                                <span className="bg-red-500/10 text-red-500 text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest animate-pulse">Action Required</span>
                            </div>
                            <div className="p-4 space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar">
                                {recentQuotes.filter(q => q.status === 'booked').length > 0 ? (
                                    recentQuotes.filter(q => q.status === 'booked').map(q => {
                                        const base = parseFloat(q.supplier_base_price || 0);
                                        const adminPct = parseFloat(q.admin_markup || 0);
                                        const finalPrice = parseFloat(q.final_price || 0);
                                        const platformProfit = Math.round(base * (adminPct / 100));

                                        // IVA calculation from breakdown or estimated at 10%
                                        const ivaItem = q.price_breakdown?.find(i => i.label?.includes('IVA'));
                                        const ivaAmount = ivaItem ? parseFloat(ivaItem.amount) : Math.round((finalPrice - base) * 0.0909);

                                        // Calculate agency remainder (Correct for Manual prices)
                                        const agencyPayout = Math.max(0, Math.round(finalPrice - base - platformProfit - ivaAmount));

                                        const isB2C = !q.agent_id || q.agent_id === '72241c14-09ed-4227-a01e-9bdeefdd0c8d';
                                        const totalProfit = isB2C ? (platformProfit + agencyPayout) : platformProfit;

                                        return (
                                            <div key={q.id} className="p-4 rounded-xl bg-surface-2/40 border border-border group hover:border-primary/30 transition-all">
                                                <div className="flex items-start justify-between mb-3">
                                                    <div>
                                                        <p className="text-sm font-bold text-text-primary">{q.invenio_properties?.villa_name}</p>
                                                        <p className="text-[10px] text-text-muted uppercase tracking-wider font-medium">Ref: {q.id?.slice(0, 8)} • {q.agents?.company_name || 'Direct B2C'}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-sm font-black text-primary">€{parseFloat(q.final_price || 0).toLocaleString()}</p>
                                                        <p className="text-[10px] text-text-muted font-bold">TOTAL PRICE</p>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-3 gap-2 mb-4">
                                                    <div className="p-2 rounded-lg bg-background/50 border border-border/50">
                                                        <p className="text-[8px] text-text-muted font-black uppercase mb-1">Owner Net</p>
                                                        <p className="text-xs font-mono font-bold text-text-primary">€{base.toLocaleString()}</p>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-primary/5 border border-primary/20">
                                                        <p className="text-[8px] text-primary/60 font-black uppercase mb-1">Platform</p>
                                                        <p className="text-xs font-mono font-bold text-primary">€{platformProfit.toLocaleString()}</p>
                                                    </div>
                                                    <div className="p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                                                        <p className="text-[8px] text-emerald-400/60 font-black uppercase mb-1">{isB2C ? 'B2C Comm' : 'Agency'}</p>
                                                        <p className="text-xs font-mono font-bold text-emerald-400">€{agencyPayout.toLocaleString()}</p>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between pt-3 border-t border-border/50">
                                                    <div className="flex flex-col">
                                                        <span className="text-[9px] text-text-muted uppercase font-bold">Invenio Net Profit</span>
                                                        <span className="text-sm font-black text-emerald-500">€{totalProfit.toLocaleString()}</span>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button 
                                                            onClick={() => handlePayout(q.id, 'owner', base)}
                                                            disabled={q.payout_owner_sent_at}
                                                            className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${q.payout_owner_sent_at ? 'bg-emerald-500/20 text-emerald-400 cursor-default' : 'bg-primary text-background-dark hover:scale-105 active:scale-95'}`}
                                                        >
                                                            {q.payout_owner_sent_at ? 'Owner Paid' : 'Pay Owner'}
                                                        </button>
                                                        {!isB2C && (
                                                            <button 
                                                                onClick={() => handlePayout(q.id, 'collaborator', agencyPayout)}
                                                                disabled={q.payout_collaborator_sent_at}
                                                                className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${q.payout_collaborator_sent_at ? 'bg-emerald-500/20 text-emerald-400 cursor-default' : 'bg-white/10 text-text-primary hover:bg-white/20 hover:scale-105 active:scale-95'}`}
                                                            >
                                                                {q.payout_collaborator_sent_at ? 'Agency Paid' : 'Pay Agency'}
                                                            </button>
                                                        )}
                                                        {isB2C && (
                                                            <div className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 text-[9px] font-black uppercase tracking-widest border border-blue-500/30">
                                                                Settled (B2C)
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="py-20 text-center space-y-4 opacity-40">
                                        <span className="material-symbols-outlined notranslate text-4xl block">task_alt</span>
                                        <p className="text-[10px] font-black uppercase tracking-widest">All settlements complete</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* QUICK ACCESS */}
                    <div className="glass-card border-border bg-surface overflow-hidden">
                        <div className="p-4 border-b border-border bg-surface-2 flex items-center gap-3">
                            <div className="size-8 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
                                <span className="material-symbols-outlined notranslate text-[18px]">bolt</span>
                            </div>
                            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-text-primary">Direct Actions</h2>
                        </div>
                        <div className="p-4 grid grid-cols-1 gap-3">
                            {(role === 'admin' || role === 'super_admin') ? (
                                <>
                                    <button onClick={() => navigate('/agents')} className="w-full bg-primary text-black py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:scale-[1.02] transition-all shadow-xl shadow-primary/20 flex items-center justify-center gap-3">
                                        <span className="material-symbols-outlined notranslate text-[20px]">person_add</span> Manage Agents
                                    </button>
                                    {villas_enabled && <button onClick={() => navigate('/villas')} className="w-full bg-surface-2 py-4 rounded-2xl border border-border text-[10px] text-text-primary font-black uppercase tracking-[0.2em] hover:border-primary/50 transition-all">Villa Inventory</button>}
                                    {boats_enabled && <button onClick={() => navigate('/boats')} className="w-full bg-surface-2 py-4 rounded-2xl border border-border text-[10px] text-text-primary font-black uppercase tracking-[0.2em] hover:border-primary/50 transition-all">Boat Charter</button>}
                                </>
                            ) : (
                                <>
                                    <button 
                                        onClick={() => navigate(villas_enabled ? '/villas' : '/boats')} 
                                        className="w-full bg-primary text-black py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:scale-[1.02] transition-all shadow-xl shadow-primary/20 flex items-center justify-center gap-3"
                                    >
                                        <span className="material-symbols-outlined notranslate text-[20px]">add_circle</span> Initiate Quote
                                    </button>
                                    <button onClick={() => navigate('/clients')} className="w-full bg-surface-2 py-4 rounded-2xl border border-border text-[10px] text-text-primary font-black uppercase tracking-[0.2em] hover:border-primary/50 transition-all">Client Database</button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
