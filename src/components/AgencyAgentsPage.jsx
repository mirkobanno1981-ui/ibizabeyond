import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function AgencyAgentsPage() {
    const { user, agentData } = useAuth();
    const navigate = useNavigate();
    const [subAgents, setSubAgents] = useState([]);
    const [allQuotes, setAllQuotes] = useState([]);
    const [allClients, setAllClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [activeTab, setActiveTab] = useState('agents'); // 'agents', 'clients', 'quotes', 'bookings'
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);
    const [newAgent, setNewAgent] = useState({ email: '', password: '', firstName: '', lastName: '', role: 'agent' });
    const [editAgent, setEditAgent] = useState(null);
    const [viewHistory, setViewHistory] = useState(null);
    const [agentQuotes, setAgentQuotes] = useState([]);

    useEffect(() => {
        if (agentData?.agency_id || user?.id) {
            fetchAllData();
        }
    }, [agentData, user]);

    async function fetchAllData() {
        setLoading(true);
        try {
            // 1. Fetch Agents in Agency
            const targetAgencyId = agentData?.agency_id || (agentData?.agent_type === 'agency' ? agentData.id : null);
            if (!targetAgencyId) {
                // If not in an agency, maybe it's the admin itself
                setSubAgents([]);
                setLoading(false);
                return;
            }

            const { data: profiles, error: pError } = await supabase
                .from('agents')
                .select('*')
                .eq('agency_id', targetAgencyId);
            if (pError) throw pError;

            const agentIds = [(profiles || []).map(p => p.id), user.id].flat();
            
            // 2. Fetch User Roles for these agents
            const { data: roles, error: rError } = await supabase
                .from('user_roles')
                .select('*')
                .in('user_id', agentIds);
            if (rError) throw rError;

            const mergedAgents = (profiles || []).map(p => ({
                ...p,
                role: roles.find(r => r.user_id === p.id)?.role || 'agent'
            }));
            setSubAgents(mergedAgents.filter(a => a.id !== user.id)); // Don't show self in sub-agents list if desired, or keep it. Actually user requested "gestione completa dell'attivita' di OGNI agente", but usually they want to see their team. I'll filter self from the "Team Members" list to avoid confusion but keep in stats.

            // 3. Fetch all Clients for these agents
            const { data: clients, error: cError } = await supabase
                .from('clients')
                .select('*')
                .in('agent_id', agentIds)
                .order('created_at', { ascending: false });
            if (cError) throw cError;
            setAllClients(clients || []);

            // 4. Fetch all Quotes for these agents
            const { data: quotes, error: qError } = await supabase
                .from('quotes')
                .select(`
                    *,
                    clients (full_name, email),
                    invenio_properties (villa_name, v_uuid),
                    invenio_boats (boat_name)
                `)
                .in('agent_id', agentIds)
                .order('created_at', { ascending: false });
            if (qError) throw qError;
            setAllQuotes(quotes || []);

        } catch (err) {
            console.error(err);
            setMessage({ type: 'error', text: 'Error fetching team data.' });
        } finally {
            setLoading(false);
        }
    }

    async function fetchAgentHistory(agent) {
        // Filter from already loaded quotes
        const history = allQuotes.filter(q => q.agent_id === agent.id);
        setAgentQuotes(history);
        setViewHistory(agent);
    }

    async function handleCreateSubAgent(e) {
        e.preventDefault();
        setSaving(true);
        setMessage(null);

        try {
            const { data: { publicUrl } } = supabase.storage.from('agent-logos').getPublicUrl('dummy');
            const supabaseUrl = publicUrl.split('/storage/v1')[0];
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

            const { createClient } = await import('@supabase/supabase-js');
            const tempSupabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

            const fullName = `${newAgent.firstName} ${newAgent.lastName}`.trim();
            const targetAgencyId = agentData?.agency_id || (agentData?.agent_type === 'agency' ? agentData.id : null);

            const { data: authData, error: authError } = await tempSupabase.auth.signUp({
                email: newAgent.email,
                password: newAgent.password,
                options: {
                    data: {
                        first_name: newAgent.firstName,
                        last_name: newAgent.lastName,
                        agent_type: newAgent.role === 'agency_admin' ? 'agency_admin' : 'sub_agent',
                        company_name: fullName,
                        role: newAgent.role,
                        agency_id: targetAgencyId,
                        parent_agent_id: user.id
                    }
                }
            });

            if (authError) throw authError;
            // The trigger handle_new_user_role now sets everything correctly via metadata.
            // We can still try an update for safety if needed, but it's now handled at birth.

            setMessage({ type: 'success', text: 'Team member added successfully!' });
            setShowAddModal(false);
            setNewAgent({ email: '', password: '', firstName: '', lastName: '', role: 'agent' });
            fetchAllData();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(false);
        }
    }

    async function handleUpdateAgent(e) {
        e.preventDefault();
        setSaving(true);
        try {
            const { error: pErr } = await supabase
                .from('agents')
                .update({ 
                    is_active: editAgent.is_active,
                    agent_type: editAgent.role === 'agency_admin' ? 'agency_admin' : 'sub_agent'
                })
                .eq('id', editAgent.id);
            if (pErr) throw pErr;

            // 2. Try to update user role (this might fail if not super-admin, but we rely on agent_type mostly)
            try {
                const { error: rErr } = await supabase
                    .from('user_roles')
                    .update({ role: editAgent.role === 'agency_admin' ? 'agent' : editAgent.role }) // Map to valid enum value
                    .eq('user_id', editAgent.id);
                // We don't throw rErr if it fails because the agent_type update above is enough for agency logic
            } catch (roleError) {
                console.warn('Role update skipped due to permissions:', roleError);
            }

            setMessage({ type: 'success', text: 'Member updated.' });
            setEditAgent(null);
            fetchAllData();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(false);
        }
    }

    const StatCard = ({ label, value, icon, color }) => (
        <div className="glass-card p-6 flex items-center justify-between border-border overflow-hidden relative group">
            <div className={`absolute top-0 right-0 size-24 ${color} blur-3xl opacity-5 group-hover:opacity-10 transition-opacity`}></div>
            <div>
                <p className="text-[10px] text-text-muted uppercase font-black tracking-widest">{label}</p>
                <p className="text-3xl font-black text-text-primary mt-1">{value}</p>
            </div>
            <div className={`size-12 rounded-2xl ${color.replace('bg-', 'bg-').replace('/10', '/10')} flex items-center justify-center text-[24px]`}>
                <span className={`material-symbols-outlined notranslate ${color.replace('bg-', 'text-').replace('/10', '')}`}>{icon}</span>
            </div>
        </div>
    );

    const bookedQuotes = allQuotes.filter(q => q.status === 'booked');
    const totalAgencyRevenue = bookedQuotes.reduce((sum, q) => sum + parseFloat(q.final_price || 0), 0);

    return (
        <div className="p-6 md:p-8 space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-text-primary tracking-tighter uppercase">Team Management</h1>
                    <p className="text-text-muted text-sm font-medium mt-1">Overview of your agency's activity, clients, and performance.</p>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={() => fetchAllData()} className="p-2.5 rounded-xl bg-surface-2 text-text-muted hover:text-text-primary transition-all border border-border" title="Refresh">
                        <span className={`material-symbols-outlined notranslate ${loading ? 'animate-spin' : ''}`}>refresh</span>
                    </button>
                    <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2 px-6 shadow-lg shadow-primary/25">
                        <span className="material-symbols-outlined notranslate">person_add</span>
                        Add Team Member
                    </button>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Team Members" value={subAgents.length} icon="groups" color="bg-blue-500/10 text-blue-400" />
                <StatCard label="Total Clients" value={allClients.length} icon="person" color="bg-purple-500/10 text-purple-400" />
                <StatCard label="Quotes Made" value={allQuotes.length} icon="request_quote" color="bg-amber-500/10 text-amber-400" />
                <StatCard label="Total Revenue" value={`€${Math.round(totalAgencyRevenue).toLocaleString()}`} icon="payments" color="bg-emerald-500/10 text-emerald-400" />
            </div>

            {message && (
                <div className={`p-4 rounded-xl border flex items-center gap-3 animate-in slide-in-from-top-2 ${message.type === 'success' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                    <span className="material-symbols-outlined notranslate">{message.type === 'success' ? 'check_circle' : 'error'}</span>
                    <span className="text-sm font-bold">{message.text}</span>
                </div>
            )}

            {/* Tabs & Content */}
            <div className="space-y-6">
                <div className="flex items-center gap-2 border-b border-border p-1 bg-surface-2/30 rounded-xl max-w-fit">
                    {[
                        { id: 'agents', label: 'Team Members', icon: 'groups' },
                        { id: 'clients', label: 'All Clients', icon: 'person' },
                        { id: 'quotes', label: 'All Quotes', icon: 'request_quote' },
                        { id: 'bookings', label: 'Bookings', icon: 'calendar_month' }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
                                activeTab === tab.id ? 'bg-surface border border-border text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
                            }`}
                        >
                            <span className="material-symbols-outlined notranslate text-[18px]">{tab.icon}</span>
                            {tab.label}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="py-20 flex flex-col items-center gap-4">
                        <div className="animate-spin size-10 border-4 border-primary border-t-transparent rounded-full shadow-lg"></div>
                        <p className="text-sm font-bold text-text-muted uppercase tracking-widest animate-pulse">Loading amazing data...</p>
                    </div>
                ) : (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {activeTab === 'agents' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                {subAgents.map(agent => (
                                    <div key={agent.id} className="glass-card p-6 border-border flex flex-col gap-4 group hover:border-primary/50 transition-all">
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className="size-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-black text-xl shadow-inner uppercase">
                                                    {agent.company_name?.charAt(0) || agent.first_name?.charAt(0)}
                                                </div>
                                                <div>
                                                    <p className="font-black text-text-primary text-lg leading-none uppercase tracking-tighter">{agent.company_name}</p>
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <span className="text-[9px] px-2 py-0.5 bg-surface-2 text-text-muted rounded-full font-black uppercase tracking-wider border border-border/50">{agent.role}</span>
                                                        {agent.is_active === false && <span className="text-[9px] px-2 py-0.5 bg-red-500/20 text-red-400 rounded-full font-black uppercase tracking-wider border border-red-500/20">Inactive</span>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex gap-1">
                                                <button onClick={() => fetchAgentHistory(agent)} className="size-9 rounded-xl bg-surface-2 flex items-center justify-center text-text-muted hover:text-primary transition-colors border border-border" title="View Performance">
                                                    <span className="material-symbols-outlined notranslate">analytics</span>
                                                </button>
                                                <button onClick={() => setEditAgent(agent)} className="size-9 rounded-xl bg-surface-2 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors border border-border">
                                                    <span className="material-symbols-outlined notranslate">settings</span>
                                                </button>
                                            </div>
                                        </div>
                                        
                                        <div className="grid grid-cols-2 gap-3 pt-4 border-t border-border/50">
                                            <div className="p-3 bg-surface-2/50 rounded-xl">
                                                <p className="text-[9px] text-text-muted uppercase font-black">Clients</p>
                                                <p className="text-lg font-black text-text-primary">{allClients.filter(c => c.agent_id === agent.id).length}</p>
                                            </div>
                                            <div className="p-3 bg-surface-2/50 rounded-xl">
                                                <p className="text-[9px] text-text-muted uppercase font-black">Bookings</p>
                                                <p className="text-lg font-black text-emerald-400">{allQuotes.filter(q => q.agent_id === agent.id && q.status === 'booked').length}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {subAgents.length === 0 && (
                                    <div className="col-span-full py-20 glass-card border-dashed border-2 flex flex-col items-center justify-center gap-4 text-text-muted">
                                        <span className="material-symbols-outlined notranslate text-5xl opacity-20">group_off</span>
                                        <p className="text-sm font-bold uppercase tracking-widest opacity-50 italic">No team members yet.</p>
                                        <button onClick={() => setShowAddModal(true)} className="btn-primary mt-4">Add your first member</button>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'clients' && (
                            <div className="glass-card border-border overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="bg-surface-2/50 text-[10px] text-text-muted font-black uppercase tracking-widest">
                                                <th className="px-6 py-4">Client</th>
                                                <th className="px-6 py-4">Assigned Agent</th>
                                                <th className="px-6 py-4">Contact</th>
                                                <th className="px-6 py-4 text-right">Created</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/50">
                                            {allClients.map(client => {
                                                const agent = subAgents.find(a => a.id === client.agent_id);
                                                return (
                                                    <tr key={client.id} className="hover:bg-white/2 transition-colors">
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-3">
                                                                <div className="size-8 rounded-full bg-surface-2 text-[10px] font-black flex items-center justify-center">
                                                                    {client.full_name?.charAt(0)}
                                                                </div>
                                                                <p className="text-sm font-bold text-text-primary">{client.full_name}</p>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className="text-xs font-medium text-text-muted italic">{agent?.company_name || 'N/A'}</span>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <p className="text-[11px] text-text-primary font-mono">{client.email || '-'}</p>
                                                            <p className="text-[10px] text-text-muted">{client.phone_number || '-'}</p>
                                                        </td>
                                                        <td className="px-6 py-4 text-right">
                                                            <span className="text-[10px] font-mono text-text-muted">{new Date(client.created_at).toLocaleDateString()}</span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            {allClients.length === 0 && (
                                                <tr>
                                                    <td colSpan="4" className="px-6 py-20 text-center text-text-muted italic text-sm">No clients found for this agency.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {activeTab === 'quotes' && (
                            <div className="glass-card border-border overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="bg-surface-2/50 text-[10px] text-text-muted font-black uppercase tracking-widest">
                                                <th className="px-6 py-4">Villa / Boat</th>
                                                <th className="px-6 py-4">Client / Agent</th>
                                                <th className="px-6 py-4 text-center">Dates</th>
                                                <th className="px-6 py-4 text-center">Status</th>
                                                <th className="px-6 py-4 text-right">Price</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/50">
                                            {allQuotes.map(quote => (
                                                <tr key={quote.id} className="hover:bg-white/2 transition-colors">
                                                    <td className="px-6 py-4">
                                                        <p className="text-sm font-black text-text-primary uppercase tracking-tighter">
                                                            {quote.invenio_properties?.villa_name || quote.invenio_boats?.boat_name}
                                                        </p>
                                                        <p className="text-[10px] text-text-muted mt-0.5">{quote.invenio_properties?.villa_name ? 'Villa' : 'Boat'}</p>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <p className="text-[11px] font-bold text-text-primary">{quote.clients?.full_name}</p>
                                                        <p className="text-[9px] text-text-muted italic">By {subAgents.find(a => a.id === quote.agent_id)?.company_name}</p>
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <p className="text-[10px] font-mono font-bold text-text-primary">
                                                            {quote.check_in && new Date(quote.check_in).toLocaleDateString()}
                                                        </p>
                                                        <p className="text-[10px] font-mono text-text-muted">
                                                            {quote.check_out && new Date(quote.check_out).toLocaleDateString()}
                                                        </p>
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter transition-all ${
                                                            quote.status === 'booked' ? 'bg-green-500/20 text-green-400 shadow-[0_0_15px_-3px_rgba(34,197,94,0.3)]' : 
                                                            quote.status === 'sent' ? 'bg-blue-500/20 text-blue-400' : 
                                                            quote.status === 'draft' ? 'bg-surface-2 text-text-muted' :
                                                            'bg-red-500/20 text-red-400'
                                                        }`}>
                                                            {quote.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <p className="text-sm font-black text-text-primary">€{Math.round(quote.final_price || 0).toLocaleString()}</p>
                                                    </td>
                                                </tr>
                                            ))}
                                            {allQuotes.length === 0 && (
                                                <tr>
                                                    <td colSpan="5" className="px-6 py-20 text-center text-text-muted italic text-sm">No quotes found.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {activeTab === 'bookings' && (
                             <div className="glass-card border-border overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="bg-surface-2/50 text-[10px] text-text-muted font-black uppercase tracking-widest">
                                                <th className="px-6 py-4">Property</th>
                                                <th className="px-6 py-4">Guest</th>
                                                <th className="px-6 py-4">Agent</th>
                                                <th className="px-6 py-4 text-center">Check-In</th>
                                                <th className="px-6 py-4 text-right">Total Price</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/50">
                                            {bookedQuotes.map(quote => (
                                                <tr key={quote.id} className="hover:bg-white/2 transition-colors">
                                                    <td className="px-6 py-4">
                                                        <p className="text-sm font-black text-text-primary uppercase tracking-tighter">
                                                            {quote.invenio_properties?.villa_name || quote.invenio_boats?.boat_name}
                                                        </p>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <p className="text-[11px] font-bold text-text-primary">{quote.clients?.full_name}</p>
                                                        <p className="text-[10px] text-text-muted">{quote.clients?.email}</p>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <p className="text-[11px] font-medium text-text-muted italic">{subAgents.find(a => a.id === quote.agent_id)?.company_name}</p>
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <p className="text-[10px] font-mono font-bold text-emerald-400">
                                                            {quote.check_in && new Date(quote.check_in).toLocaleDateString()}
                                                        </p>
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <p className="text-sm font-black text-emerald-400">€{Math.round(quote.final_price || 0).toLocaleString()}</p>
                                                    </td>
                                                </tr>
                                            ))}
                                            {bookedQuotes.length === 0 && (
                                                <tr>
                                                    <td colSpan="5" className="px-6 py-20 text-center text-text-muted italic text-sm">No booked stays found.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Modals */}
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl p-8 animate-in zoom-in-95 duration-300">
                        <div className="flex justify-between items-center mb-8">
                            <div>
                                <h2 className="text-2xl font-black text-text-primary tracking-tighter uppercase">Add Member</h2>
                                <p className="text-xs text-text-muted font-bold uppercase tracking-widest mt-1">Create a new sub-agent account</p>
                            </div>
                            <button onClick={() => setShowAddModal(false)} className="size-10 rounded-full hover:bg-surface-2 flex items-center justify-center text-text-muted hover:text-text-primary transition-all">
                                <span className="material-symbols-outlined notranslate">close</span>
                            </button>
                        </div>
                        <form onSubmit={handleCreateSubAgent} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-text-muted uppercase px-1">First Name</label>
                                    <input required className="input-theme" placeholder="John" value={newAgent.firstName} onChange={e => setNewAgent({...newAgent, firstName: e.target.value})} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-text-muted uppercase px-1">Last Name</label>
                                    <input required className="input-theme" placeholder="Doe" value={newAgent.lastName} onChange={e => setNewAgent({...newAgent, lastName: e.target.value})} />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-text-muted uppercase px-1">Email</label>
                                <input required type="email" className="input-theme w-full" placeholder="john@example.com" value={newAgent.email} onChange={e => setNewAgent({...newAgent, email: e.target.value})} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-text-muted uppercase px-1">Password</label>
                                <input required type="password" minLength={6} className="input-theme w-full" placeholder="••••••••" value={newAgent.password} onChange={e => setNewAgent({...newAgent, password: e.target.value})} />
                            </div>
                            
                            <div className="pt-2">
                                <label className="block text-[10px] font-black text-text-muted uppercase mb-3 px-1">System Permissions</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { id: 'agent', label: 'Basic Agent', desc: 'Can create quotes' },
                                        { id: 'editor', label: 'Editor', desc: 'Can edit catalog' },
                                        { id: 'agency_admin', label: 'Agency Admin', desc: 'Full agency management' }
                                    ].map(r => (
                                        <button key={r.id} type="button" onClick={() => setNewAgent({...newAgent, role: r.id})} 
                                            className={`p-3 rounded-xl border transition-all text-left ${newAgent.role === r.id ? 'bg-primary/10 border-primary text-primary' : 'bg-surface-2 border-transparent text-text-muted hover:border-border'}`}>
                                            <p className="text-[10px] font-black uppercase tracking-tight">{r.label}</p>
                                            <p className="text-[8px] opacity-70 mt-0.5">{r.desc}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            
                            <button disabled={saving} className="btn-primary w-full py-4 mt-6 text-sm font-black uppercase tracking-widest shadow-xl shadow-primary/20">
                                {saving ? (
                                    <div className="flex items-center justify-center gap-2">
                                        <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                        Creating...
                                    </div>
                                ) : 'Create Sub-Agent Account'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {editAgent && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl p-8 animate-in zoom-in-95 duration-300">
                        <div className="flex justify-between items-center mb-8">
                            <div>
                                <h2 className="text-2xl font-black text-text-primary tracking-tighter uppercase">Member Settings</h2>
                                <p className="text-xs text-text-muted font-bold uppercase tracking-widest mt-1">{editAgent.company_name}</p>
                            </div>
                            <button onClick={() => setEditAgent(null)} className="size-10 rounded-full hover:bg-surface-2 flex items-center justify-center text-text-muted hover:text-text-primary transition-all">
                                <span className="material-symbols-outlined notranslate">close</span>
                            </button>
                        </div>
                        <form onSubmit={handleUpdateAgent} className="space-y-6">
                            <div>
                                <label className="block text-[10px] font-black text-text-muted uppercase mb-3 px-1">Role & Capabilities</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { id: 'agent', label: 'Basic Agent' },
                                        { id: 'editor', label: 'Editor' },
                                        { id: 'agency_admin', label: 'Agency Admin' }
                                    ].map(r => (
                                        <button key={r.id} type="button" onClick={() => setEditAgent({...editAgent, role: r.id})} 
                                            className={`p-3 rounded-xl border transition-all text-left ${editAgent.role === r.id ? 'bg-primary/10 border-primary text-primary' : 'bg-surface-2 border-transparent text-text-muted hover:border-border'}`}>
                                            <p className="text-[10px] font-black uppercase tracking-tight">{r.label}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-surface-2 rounded-2xl border border-border group hover:border-primary/30 transition-all cursor-pointer" onClick={() => setEditAgent({...editAgent, is_active: !editAgent.is_active})}>
                                <div className="flex items-center gap-3">
                                    <div className={`size-10 rounded-xl flex items-center justify-center transition-colors ${editAgent.is_active !== false ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                                        <span className="material-symbols-outlined notranslate">{editAgent.is_active !== false ? 'check_circle' : 'cancel'}</span>
                                    </div>
                                    <div>
                                        <p className="text-sm font-black text-text-primary">Active Member</p>
                                        <p className="text-[10px] text-text-muted uppercase font-bold tracking-tight">Toggle access to the portal</p>
                                    </div>
                                </div>
                                <div className={`relative w-12 h-6 rounded-full transition-colors ${editAgent.is_active !== false ? 'bg-primary' : 'bg-border'}`}>
                                    <div className={`absolute top-1 size-4 bg-white rounded-full transition-all shadow-md ${editAgent.is_active !== false ? 'left-7' : 'left-1'}`}></div>
                                </div>
                            </div>

                            <button disabled={saving} className="btn-primary w-full py-4 mt-4 text-sm font-black uppercase tracking-widest shadow-xl shadow-primary/20">
                                {saving ? (
                                    <div className="flex items-center justify-center gap-2">
                                        <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                        Saving...
                                    </div>
                                ) : 'Update Permissions'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Performance/History Modal (Full View) */}
            {viewHistory && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
                    <div className="bg-surface border border-border rounded-3xl w-full max-w-5xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300 overflow-hidden">
                        <div className="p-8 border-b border-border flex items-center justify-between bg-surface/50">
                            <div className="flex items-center gap-5">
                                <div className="size-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-3xl font-black">
                                    {viewHistory.company_name?.charAt(0)}
                                </div>
                                <div>
                                    <h2 className="text-2xl font-black text-text-primary tracking-tighter uppercase whitespace-nowrap">Performance: {viewHistory.company_name}</h2>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-[10px] font-black text-primary uppercase tracking-widest">{viewHistory.role}</span>
                                        <span className="size-1 rounded-full bg-border"></span>
                                        <span className="text-[10px] font-bold text-text-muted">Member since {new Date(viewHistory.created_at).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </div>
                            <button onClick={() => setViewHistory(null)} className="size-12 rounded-2xl bg-surface-2 hover:bg-surface border border-border text-text-muted hover:text-text-primary transition-all flex items-center justify-center group shadow-sm">
                                <span className="material-symbols-outlined notranslate group-hover:rotate-90 transition-transform">close</span>
                            </button>
                        </div>
                        
                        <div className="p-8 overflow-y-auto custom-scrollbar space-y-8">
                            {/* Performance Stats */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                <div className="glass-card p-6 border-border bg-white/2">
                                    <p className="text-[10px] text-text-muted uppercase font-black tracking-widest">Team Contribution</p>
                                    <div className="flex items-end gap-2 mt-2">
                                        <p className="text-4xl font-black text-text-primary leading-none">{agentQuotes.length}</p>
                                        <p className="text-xs font-bold text-text-muted mb-1 pb-0.5">Quotes Created</p>
                                    </div>
                                </div>
                                <div className="glass-card p-6 border-border bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors">
                                    <p className="text-[10px] text-emerald-400 uppercase font-black tracking-widest">Conversion</p>
                                    <div className="flex items-end gap-2 mt-2">
                                        <p className="text-4xl font-black text-emerald-400 leading-none">{agentQuotes.filter(q => q.status === 'booked').length}</p>
                                        <p className="text-xs font-bold text-emerald-400/70 mb-1 pb-0.5">Properties Booked</p>
                                    </div>
                                </div>
                                <div className="glass-card p-6 border-border bg-primary/5">
                                    <p className="text-[10px] text-primary uppercase font-black tracking-widest">Total Sales</p>
                                    <div className="flex items-end gap-2 mt-2">
                                        <p className="text-3xl font-black text-text-primary leading-none">€{agentQuotes.filter(q => q.status === 'booked').reduce((s,q) => s + parseFloat(q.final_price || 0), 0).toLocaleString()}</p>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Detailed List */}
                            <div className="space-y-4">
                                <h3 className="text-xs font-black text-text-primary uppercase tracking-[0.2em] flex items-center gap-2">
                                    <span className="material-symbols-outlined notranslate text-[18px] text-primary">history</span>
                                    Activity History
                                </h3>
                                <div className="glass-card border-border overflow-hidden">
                                    <table className="w-full text-left text-[11px]">
                                        <thead>
                                            <tr className="text-text-muted font-black uppercase tracking-widest bg-surface-2/50">
                                                <th className="px-6 py-4">Date</th>
                                                <th className="px-6 py-4">Property</th>
                                                <th className="px-6 py-4 text-center">Status</th>
                                                <th className="px-6 py-4 text-right">Revenue</th>
                                                <th className="px-6 py-4 text-right">Agency Comm.</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/30">
                                            {agentQuotes.map(q => {
                                                const base = parseFloat(q.supplier_base_price || 0);
                                                const final = parseFloat(q.final_price || 0);
                                                const adminPct = parseFloat(q.admin_markup || 0);
                                                const platformNet = base * (adminPct / 100);
                                                // Estimated commission calculation (simplified for overview)
                                                const commission = q.status === 'booked' ? Math.round(final - base - platformNet - (final - base) * 0.17) : 0;

                                                return (
                                                    <tr key={q.id} className="hover:bg-white/2 transition-colors">
                                                        <td className="px-6 py-4 text-text-muted font-mono">{new Date(q.created_at).toLocaleDateString()}</td>
                                                        <td className="px-6 py-4">
                                                            <p className="text-xs font-black text-text-primary uppercase tracking-tight">{q.invenio_properties?.villa_name || q.invenio_boats?.boat_name}</p>
                                                        </td>
                                                        <td className="px-6 py-4 text-center">
                                                            <span className={`px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-tighter shadow-sm ${
                                                                q.status === 'booked' ? 'bg-green-500/20 text-green-400 border border-green-500/20' : 
                                                                q.status === 'sent' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/20' : 
                                                                'bg-slate-500/20 text-text-muted border border-border/50'
                                                            }`}>
                                                                {q.status}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-right font-black text-text-primary">€{final.toLocaleString()}</td>
                                                        <td className="px-6 py-4 text-right font-black text-emerald-400">
                                                            {q.status === 'booked' ? `€${Math.max(0, commission).toLocaleString()}` : '-'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            {agentQuotes.length === 0 && (
                                                <tr>
                                                    <td colSpan="5" className="px-6 py-20 text-center text-text-muted italic text-sm font-medium">No activity recorded for this agent yet.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
