import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import GuestDetailsModal from './GuestDetailsModal';
import BookingCalendar from './BookingCalendar';

export default function BookingsPage() {
    const { user, role } = useAuth();
    const [viewMode, setViewMode] = useState('list'); // 'list' or 'calendar'
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ total: 0, pendingContract: 0, pendingPayment: 0 });
    const [selectedQuoteId, setSelectedQuoteId] = useState(null);
    const [showGuestModal, setShowGuestModal] = useState(false);

    useEffect(() => {
        if (user) fetchBookings();
    }, [user]);

    async function fetchBookings() {
        setLoading(true);
        let query = supabase
            .from('quotes')
            .select('*, invenio_properties(villa_name, thumbnail_url, owner_id), clients(full_name, email)')
            .eq('status', 'booked');

        if (role === 'owner') {
            const { data: ownedVillas } = await supabase
                .from('invenio_properties')
                .select('v_uuid')
                .eq('owner_id', user.id);
            const villaIds = (ownedVillas || []).map(v => v.v_uuid);
            query = query.in('v_uuid', villaIds);
        } else if (role !== 'admin' && role !== 'super_admin') {
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

        const { data, error } = await query.order('check_in', { ascending: true });

        if (!error && data) {
            setBookings(data);
            
            // Calc stats
            const pendingContract = data.filter(b => !b.contract_signed).length;
            const pendingPayment = data.filter(b => !b.deposit_paid || !b.balance_paid).length;
            setStats({ total: data.length, pendingContract, pendingPayment });
        }
        setLoading(false);
    }

    async function toggleStatus(id, field, currentVal) {
        const { error } = await supabase
            .from('quotes')
            .update({ [field]: !currentVal })
            .eq('id', id);
        
        if (!error) {
            fetchBookings();
        }
    }

    return (
        <div className="p-6 md:p-8 space-y-8 animate-in fade-in duration-500">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-text-primary tracking-tight">Bookings</h1>
                    <p className="text-text-muted text-sm mt-1 font-medium">Manage confirmed reservations and operational tasks.</p>
                </div>
                
                <div className="flex items-center gap-3">
                    <div className="flex bg-surface-2 p-1 rounded-xl border border-border/40">
                        <button 
                            onClick={() => setViewMode('list')}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${viewMode === 'list' ? 'bg-primary text-white shadow-lg' : 'text-text-muted hover:text-text-primary'}`}
                        >
                            <span className="material-symbols-outlined notranslate text-sm">list</span>
                            List
                        </button>
                        <button 
                            onClick={() => setViewMode('calendar')}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${viewMode === 'calendar' ? 'bg-primary text-white shadow-lg' : 'text-text-muted hover:text-text-primary'}`}
                        >
                            <span className="material-symbols-outlined notranslate text-sm">calendar_month</span>
                            Calendar
                        </button>
                    </div>
                    <div className="glass-card px-4 py-2 flex items-center gap-2 border-primary/20">
                        <span className="size-2 rounded-full bg-primary animate-pulse"></span>
                        <span className="text-[11px] font-black uppercase tracking-widest text-text-primary">{stats.total} Confirmed</span>
                    </div>
                </div>
            </header>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="glass-card p-5 border-border/40">
                    <p className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">Contract Status</p>
                    <div className="flex items-end justify-between">
                        <h3 className="text-2xl font-black text-text-primary">{stats.pendingContract}</h3>
                        <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full uppercase">Pending Signature</span>
                    </div>
                </div>
                <div className="glass-card p-5 border-border/40">
                    <p className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">Payments</p>
                    <div className="flex items-end justify-between">
                        <h3 className="text-2xl font-black text-text-primary">{stats.pendingPayment}</h3>
                        <span className="text-[10px] font-bold text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full uppercase">Pending Balance</span>
                    </div>
                </div>
                <div className="glass-card p-5 border-border/40">
                    <p className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">Police Reporting</p>
                    <div className="flex items-end justify-between">
                        <h3 className="text-2xl font-black text-text-primary">{bookings.filter(b => !b.police_sent).length}</h3>
                        <span className="text-[10px] font-bold text-purple-500 bg-purple-500/10 px-2 py-0.5 rounded-full uppercase">To Report</span>
                    </div>
                </div>
            </div>

            {/* Bookings Content */}
            {loading ? (
                <div className="glass-card p-12 text-center border-border/40">
                    <div className="animate-spin inline-block size-6 border-2 border-primary border-t-transparent rounded-full"></div>
                </div>
            ) : viewMode === 'calendar' ? (
                <BookingCalendar bookings={bookings} />
            ) : (
                <div className="glass-card overflow-hidden border-border/40">
                    {bookings.length === 0 ? (
                    <div className="p-16 text-center space-y-3">
                        <span className="material-symbols-outlined notranslate text-5xl text-text-muted/20">event_busy</span>
                        <p className="text-text-muted font-medium">No confirmed bookings yet.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr className="border-b border-border bg-white/2">
                                    <th className="text-left text-[10px] text-text-muted font-black px-6 py-4 uppercase tracking-[0.2em]">Villa & Guest</th>
                                    <th className="text-left text-[10px] text-text-muted font-black px-6 py-4 uppercase tracking-[0.2em]">Dates</th>
                                    <th className="text-center text-[10px] text-text-muted font-black px-6 py-4 uppercase tracking-[0.2em]">Contract</th>
                                    <th className="text-center text-[10px] text-text-muted font-black px-6 py-4 uppercase tracking-[0.2em]">Deposit</th>
                                    <th className="text-center text-[10px] text-text-muted font-black px-6 py-4 uppercase tracking-[0.2em]">Balance</th>
                                    <th className="text-center text-[10px] text-text-muted font-black px-6 py-4 uppercase tracking-[0.2em]">Police</th>
                                    <th className="text-right text-[10px] text-text-muted font-black px-6 py-4 uppercase tracking-[0.2em]">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/20">
                                {bookings.map(b => (
                                    <React.Fragment key={b.id}>
                                        <tr className="hover:bg-primary/5 transition-colors group">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div>
                                                        <p className="font-bold text-text-primary">{b.invenio_properties?.villa_name}</p>
                                                        <p className="text-[11px] text-text-muted font-medium">{b.clients?.full_name}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-xs font-medium text-text-secondary whitespace-nowrap">
                                                <div className="space-y-0.5">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="material-symbols-outlined notranslate text-[12px] text-primary">login</span>
                                                        {new Date(b.check_in).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 opacity-60">
                                                        <span className="material-symbols-outlined notranslate text-[12px]">logout</span>
                                                        {new Date(b.check_out).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                                    </div>
                                                </div>
                                            </td>
                                            
                                            {/* Contract Column */}
                                            <td className="px-6 py-4 text-center">
                                                <button 
                                                    onClick={() => toggleStatus(b.id, 'contract_signed', b.contract_signed)}
                                                    className={`size-8 rounded-full inline-flex items-center justify-center transition-all ${
                                                        b.contract_signed ? 'bg-green-500/20 text-green-500' : 'bg-surface-2 text-text-muted/40 hover:bg-amber-500/10 hover:text-amber-500'
                                                    }`}
                                                    title={b.contract_signed ? "Signed" : "Mark as Signed"}
                                                >
                                                    <span className="material-symbols-outlined notranslate text-[18px]">
                                                        {b.contract_signed ? 'verified' : 'signature'}
                                                    </span>
                                                </button>
                                            </td>

                                            {/* Deposit Column */}
                                            <td className="px-6 py-4 text-center">
                                                <button 
                                                    onClick={() => toggleStatus(b.id, 'deposit_paid', b.deposit_paid)}
                                                    className={`size-8 rounded-full inline-flex items-center justify-center transition-all ${
                                                        b.deposit_paid ? 'bg-blue-500/20 text-blue-500' : 'bg-surface-2 text-text-muted/40 hover:bg-blue-500/10 hover:text-blue-500'
                                                    }`}
                                                    title={b.deposit_paid ? "Paid" : "Mark as Paid"}
                                                >
                                                    <span className="material-symbols-outlined notranslate text-[18px]">
                                                        {b.deposit_paid ? 'payments' : 'account_balance_wallet'}
                                                    </span>
                                                </button>
                                            </td>

                                            {/* Balance Column */}
                                            <td className="px-6 py-4 text-center">
                                                <button 
                                                    onClick={() => toggleStatus(b.id, 'balance_paid', b.balance_paid)}
                                                    className={`size-8 rounded-full inline-flex items-center justify-center transition-all ${
                                                        b.balance_paid ? 'bg-green-500/20 text-green-500' : 'bg-surface-2 text-text-muted/40 hover:bg-green-500/10 hover:text-green-500'
                                                    }`}
                                                    title={b.balance_paid ? "Paid" : "Mark as Paid"}
                                                >
                                                    <span className="material-symbols-outlined notranslate text-[18px]">
                                                        {b.balance_paid ? 'done_all' : 'hourglass_bottom'}
                                                    </span>
                                                </button>
                                            </td>

                                            {/* Police Column */}
                                            <td className="px-6 py-4 text-center">
                                                <div className="flex flex-col items-center gap-1.5">
                                                    <button 
                                                        onClick={() => { setSelectedQuoteId(b.id); setShowGuestModal(true); }}
                                                        className={`size-8 rounded-full inline-flex items-center justify-center transition-all ${
                                                            b.guest_form_filled ? 'bg-purple-500/20 text-purple-500 shadow-lg shadow-purple-500/10' : 'bg-surface-2 text-text-muted/40 hover:bg-purple-500/10 hover:text-purple-500'
                                                        }`}
                                                        title="Manage Guests & Police Report"
                                                    >
                                                        <span className="material-symbols-outlined notranslate text-[18px]">
                                                            {b.police_sent ? 'how_to_reg' : 'local_police'}
                                                        </span>
                                                    </button>
                                                    {!b.guest_form_filled && b.guest_form_token && (
                                                        <button 
                                                            onClick={() => {
                                                                const url = `${window.location.origin}/guest-info/${b.guest_form_token}`;
                                                                navigator.clipboard.writeText(url);
                                                                alert('Check-in link copied to clipboard!');
                                                            }}
                                                            className="text-[8px] font-black text-primary uppercase tracking-widest hover:underline"
                                                        >
                                                            Copy Link
                                                        </button>
                                                    )}
                                                </div>
                                            </td>

                                            <td className="px-6 py-4 text-right">
                                                <p className="font-black text-text-primary">€{parseFloat(b.final_price).toLocaleString()}</p>
                                                <p className="text-[10px] text-text-muted uppercase font-bold tracking-tighter">Confirmed</p>
                                            </td>
                                        </tr>
                                        {window.innerWidth < 768 && (
                                            <tr key={`mobile-${b.id}`} className="md:hidden border-b border-border/10">
                                                <td colSpan="7" className="px-6 pb-4">
                                                    <div className="flex gap-2 justify-center py-2 bg-background/30 rounded-xl">
                                                        <span className={`text-[9px] font-black px-2 py-0.5 rounded ${b.contract_signed ? 'bg-green-500/10 text-green-500' : 'bg-slate-500/10 text-text-muted'}`}>CONTRACT</span>
                                                        <span className={`text-[9px] font-black px-2 py-0.5 rounded ${b.deposit_paid ? 'bg-blue-500/10 text-blue-500' : 'bg-slate-500/10 text-text-muted'}`}>DEPOSIT</span>
                                                        <span className={`text-[9px] font-black px-2 py-0.5 rounded ${b.balance_paid ? 'bg-green-500/10 text-green-500' : 'bg-slate-500/10 text-text-muted'}`}>BALANCE</span>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                </div>
            )}

            {showGuestModal && selectedQuoteId && (
                <GuestDetailsModal 
                    quoteId={selectedQuoteId} 
                    onClose={() => { setShowGuestModal(false); setSelectedQuoteId(null); }}
                    onSuccess={fetchBookings}
                />
            )}
        </div>
    );
}
