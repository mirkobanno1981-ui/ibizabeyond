import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import EditQuoteModal from './EditQuoteModal';

export default function AgentsPage() {
    const { user, role, loading: authLoading } = useAuth();
    const [agents, setAgents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(null);
    const [message, setMessage] = useState(null);
    const [globalMargins, setGlobalMargins] = useState({ invenioToAdmin: 0, ivaPercent: 10 });
    const [showAddModal, setShowAddModal] = useState(false);
    const [newAgent, setNewAgent] = useState({ email: '', password: '', firstName: '', lastName: '', company_name: '', agent_type: 'individual' });
    const [editAgent, setEditAgent] = useState(null);
    const [viewHistory, setViewHistory] = useState(null);
    const [agentQuotes, setAgentQuotes] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [editQuote, setEditQuote] = useState(null);
    const [activeTab, setActiveTab] = useState('individual'); // individual, agency

    const { search } = useLocation();

    useEffect(() => { 
        if (!authLoading && (role === 'admin' || role === 'super_admin')) {
            fetchAll(); 
        } else if (!authLoading) {
            setLoading(false);
        }
        
        if (new URLSearchParams(search).get('add') === 'true') {
            setShowAddModal(true);
        }
    }, [search, role, authLoading]);

    if (authLoading) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center space-y-4">
                <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                <p className="text-text-muted font-medium animate-pulse uppercase tracking-widest text-xs">Verifying Access...</p>
            </div>
        );
    }

    if (role !== 'admin' && role !== 'super_admin') {
        return (
            <div className="h-screen flex items-center justify-center p-6 text-center">
                <div className="max-w-md space-y-4">
                    <div className="size-16 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 mx-auto">
                        <span className="material-symbols-outlined notranslate text-3xl">lock</span>
                    </div>
                    <h1 className="text-xl font-bold text-text-primary uppercase tracking-tight">Access Denied</h1>
                    <p className="text-text-muted text-sm">Agent management is restricted to administrators only.</p>
                </div>
            </div>
        );
    }

    async function fetchAll() {
        setLoading(true);
        try {
            const [rolesRes, profilesRes, marginsRes] = await Promise.all([
                supabase.from('user_roles').select('*'),
                supabase.from('agents').select('*'),
                supabase.from('margin_settings').select('*').limit(1).single(),
            ]);

            if (rolesRes.error) throw rolesRes.error;
            if (profilesRes.error) throw profilesRes.error;
            if (marginsRes.error && marginsRes.error.code !== 'PGRST116') throw marginsRes.error;

            console.log('Fetched Roles count:', rolesRes.data?.length);
            console.log('Fetched Profiles count:', profilesRes.data?.length);

            // Create a map of all unique user IDs that appear in either roles or agents
            const allUserIds = new Set([
                ...(rolesRes.data || []).map(r => r.user_id),
                ...(profilesRes.data || []).map(p => p.id)
            ]);

            const mergedAgents = Array.from(allUserIds).map(uid => {
                const roleRecord = (rolesRes.data || []).find(r => r.user_id === uid);
                const profile = (profilesRes.data || []).find(p => p.id === uid);
                return {
                    user_id: uid,
                    role: roleRecord?.role || 'agent',
                    created_at: roleRecord?.created_at || profile?.created_at,
                    profile: profile || null
                };
            }).filter(a => a.user_id !== user?.id);

            setAgents(mergedAgents);

            if (marginsRes.data) {
                setGlobalMargins({
                    invenioToAdmin: parseFloat(marginsRes.data.invenio_to_admin_margin) || 0,
                    ivaPercent: parseFloat(marginsRes.data.iva_percent) || 10,
                });
            }
        } catch (err) {
            console.error("Agents fetch exception:", err);
            setMessage({ type: 'error', text: 'Unexpected error fetching data.' });
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateAgent(e) {
        e.preventDefault();
        setSaving('create');
        setMessage(null);

        try {
            // Get current project details for temp client
            const { data: { publicUrl } } = supabase.storage.from('agent-logos').getPublicUrl('dummy');
            const supabaseUrl = publicUrl.split('/storage/v1')[0];
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

            const { createClient } = await import('@supabase/supabase-js');
            const tempSupabase = createClient(supabaseUrl, supabaseKey, {
                auth: { persistSession: false }
            });

            // 1. Create Auth User
            const fullName = `${newAgent.firstName} ${newAgent.lastName}`.trim();
            const { data: authData, error: authError } = await tempSupabase.auth.signUp({
                email: newAgent.email,
                password: newAgent.password,
                options: {
                    data: {
                        name: newAgent.agent_type === 'agency' ? newAgent.company_name : fullName,
                        role: 'agent'
                    }
                }
            });

            if (authError) throw authError;
            if (!authData.user) throw new Error("Failed to create user account.");

            const newId = authData.user.id;

            // 2. Create User Role (must be done by main admin client)
            const { error: roleErr } = await supabase
                .from('user_roles')
                .upsert([{ user_id: newId, role: 'agent' }]);
            
            if (roleErr) throw roleErr;

            // 3. Create Agent Profile
            const { error: profileErr } = await supabase
                .from('agents')
                .upsert([{
                    id: newId,
                    company_name: newAgent.agent_type === 'agency' ? newAgent.company_name : fullName,
                    agent_type: newAgent.agent_type,
                    status: 'approved',
                    is_active: true,
                    agency_id: newId // Set agency_id to self for main agents
                }]);

            if (profileErr) throw profileErr;

            setMessage({ type: 'success', text: `${newAgent.agent_type === 'agency' ? 'Agency' : 'Agent'} created successfully!` });
            setShowAddModal(false);
            setNewAgent({ email: '', password: '', firstName: '', lastName: '', company_name: '', agent_type: 'individual' });
            fetchAll();
        } catch (err) {
            console.error("Creation error:", err);
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(null);
        }
    }

    async function handleUpdateAgent(e) {
        e.preventDefault();
        setSaving('edit');
        try {
            // 1. Update/Create Agent Profile
            const { error: profileError } = await supabase
                .from('agents')
                .upsert({
                    id: editAgent.id,
                    company_name: editAgent.company_name,
                    agency_details: editAgent.agency_details,
                    phone_number: editAgent.phone_number,
                    admin_margin: (editAgent.admin_margin !== null && editAgent.admin_margin !== undefined && editAgent.admin_margin !== '') ? parseFloat(editAgent.admin_margin) : 0,
                    markup_percent: (editAgent.markup_percent !== null && editAgent.markup_percent !== undefined && editAgent.markup_percent !== '') ? parseFloat(editAgent.markup_percent) : 15,
                    is_active: editAgent.is_active ?? true,
                    status: editAgent.status || 'approved',
                    agent_type: editAgent.agent_type || 'individual',
                    parent_agent_id: editAgent.agent_type === 'sub_agent' ? editAgent.parent_agent_id : null,
                    contract_template: editAgent.contract_template,
                    boat_contract_template: editAgent.boat_contract_template
                });
            if (profileError) throw profileError;

            // 2. Update Role in user_roles
            const { error: roleError } = await supabase
                .from('user_roles')
                .update({ role: editAgent.role || 'agent' })
                .eq('user_id', editAgent.id);
            if (roleError) throw roleError;

            setMessage({ type: 'success', text: 'Agent updated successfully!' });
            setEditAgent(null);
            fetchAll();
        } catch (err) {
            console.error("Update error:", err);
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(null);
        }
    }

    async function handleDeleteAgent(agentId) {
        if (!confirm('Are you sure you want to delete this agent? This will permanently remove their profile and access. Associated data (quotes, clients) might cause errors if not handled.')) return;
        
        setSaving('delete');
        try {
            // 1. Delete from user_roles
            const { error: roleErr } = await supabase
                .from('user_roles')
                .delete()
                .eq('user_id', agentId);
            if (roleErr) throw roleErr;

            // 2. Delete from agents
            const { error: profileErr } = await supabase
                .from('agents')
                .delete()
                .eq('id', agentId);
            if (profileErr) throw profileErr;

            setMessage({ type: 'success', text: 'Agent deleted successfully.' });
            fetchAll();
        } catch (err) {
            console.error("Deletion error:", err);
            setMessage({ type: 'error', text: 'Error deleting agent: ' + err.message });
        } finally {
            setSaving(null);
        }
    }

    async function handleSaveMargins(e) {
        e.preventDefault();
        setSaving('global');
        try {
            const { error } = await supabase
                .from('margin_settings')
                .update({ 
                    invenio_to_admin_margin: parseFloat(globalMargins.invenioToAdmin) || 0,
                    iva_percent: parseFloat(globalMargins.ivaPercent) || 10
                })
                .eq('id', 1);
            if (error) throw error;
            setMessage({ type: 'success', text: 'Global margins saved!' });
            setTimeout(() => setMessage(null), 3000);
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(null);
        }
    }

    async function fetchAgentHistory(agentId) {
        setViewHistory(agentId);
        setLoadingHistory(true);
        try {
            const { data, error } = await supabase
                .from('quotes')
                .select('*, invenio_properties(villa_name), clients(full_name)')
                .eq('agent_id', agentId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            setAgentQuotes(data || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoadingHistory(false);
        }
    }

    return (
        <div className="p-6 md:p-8 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary">Agent Management</h1>
                    <p className="text-text-muted text-sm mt-0.5">Manage agents and configure profit margins</p>
                </div>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => {
                            setNewAgent({ ...newAgent, agent_type: 'individual' });
                            setShowAddModal(true);
                        }}
                        className="btn-primary text-xs flex items-center gap-2 px-4 py-2"
                    >
                        <span className="material-symbols-outlined notranslate text-[18px]">person_add</span>
                        Create Agent
                    </button>
                    <button 
                        onClick={() => {
                            setNewAgent({ ...newAgent, agent_type: 'agency' });
                            setShowAddModal(true);
                        }}
                        className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-purple-900/20"
                    >
                        <span className="material-symbols-outlined notranslate text-[18px]">corporate_fare</span>
                        Create Agency
                    </button>
                </div>
            </div>

            {/* Global Margins */}
            <div className="glass-card p-6">
                <div className="flex items-center gap-3 mb-5">
                    <div className="p-2 bg-primary/10 rounded-lg">
                        <span className="material-symbols-outlined notranslate text-primary text-[20px]">tune</span>
                    </div>
                    <h2 className="font-bold text-text-primary">Global Profit Margins</h2>
                </div>
                <form onSubmit={handleSaveMargins} className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-text-muted mb-1.5 font-medium">Property Cost → Admin Margin (%)</label>
                            <input
                                type="number" step="0.01" className="input-theme w-full px-4"
                                value={globalMargins.invenioToAdmin}
                                onChange={e => setGlobalMargins({ ...globalMargins, invenioToAdmin: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-text-muted mb-1.5 font-medium">Global IVA / VAT (%)</label>
                            <input
                                type="number" step="0.01" className="input-theme w-full px-4"
                                value={globalMargins.ivaPercent}
                                onChange={e => setGlobalMargins({ ...globalMargins, ivaPercent: e.target.value })}
                            />
                        </div>
                    </div>
                    <button type="submit" disabled={saving === 'global'} className="btn-primary">
                        {saving === 'global' ? 'Saving...' : 'Save Global Settings'}
                    </button>
                </form>
            </div>

            {/* Message Bar */}
            {message && (
                <div className={`p-4 rounded-xl border ${message.type === 'success' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                    {message.text}
                </div>
            )}

            {/* Tabs */}
            <div className="flex border-b border-border mb-6">
                <button 
                    onClick={() => setActiveTab('individual')}
                    className={`px-6 py-3 text-sm font-bold uppercase tracking-widest transition-all border-b-2 ${activeTab === 'individual' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-primary'}`}
                >
                    Individual Agents
                </button>
                <button 
                    onClick={() => setActiveTab('agency')}
                    className={`px-6 py-3 text-sm font-bold uppercase tracking-widest transition-all border-b-2 ${activeTab === 'agency' ? 'border-purple-600 text-purple-400' : 'border-transparent text-text-muted hover:text-text-primary'}`}
                >
                    Agencies
                </button>
            </div>

            {/* Agents Table */}
            <div className="glass-card overflow-hidden">
                <div className="p-5 border-b border-border flex items-center justify-between">
                    <h2 className="font-bold text-text-primary">
                        {activeTab === 'agency' ? 'Registered Agencies' : 'Registered Agents'}
                    </h2>
                    <span className="text-xs bg-surface-2 px-2 py-1 rounded-full text-text-muted">
                        {agents.filter(a => activeTab === 'agency' ? a.profile?.agent_type === 'agency' : a.profile?.agent_type !== 'agency').length} Total
                    </span>
                </div>                <div className="divide-y divide-border-dark">
                    {agents
                        .filter(agent => {
                            if (activeTab === 'agency') return agent.profile?.agent_type === 'agency';
                            return agent.profile?.agent_type !== 'agency' && agent.profile?.agent_type !== 'sub_agent';
                        })
                        .map(agent => (
                            <React.Fragment key={agent.user_id}>
                                <div className="flex items-center gap-4 p-4 hover:bg-white/2 transition-colors">
                                    <div className={`size-10 rounded-xl flex items-center justify-center ${activeTab === 'agency' ? 'bg-purple-600/10 text-purple-400' : 'bg-primary/10 text-primary'}`}>
                                        <span className="material-symbols-outlined notranslate">{activeTab === 'agency' ? 'corporate_fare' : 'person'}</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-bold text-text-primary">{agent.profile?.company_name || 'Individual Agent'}</span>
                                            <div className="flex gap-1">
                                                {agent.role === 'super_admin' ? (
                                                    <span className="text-[9px] px-1.5 py-0.5 bg-red-500/20 text-red-500 border border-red-500/30 rounded-full font-black uppercase">Super Admin</span>
                                                ) : agent.role === 'admin' ? (
                                                    <span className="text-[9px] px-1.5 py-0.5 bg-primary/20 text-primary border border-primary/30 rounded-full font-black uppercase">Admin</span>
                                                ) : agent.role === 'editor' ? (
                                                    <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-full font-black uppercase">Editor</span>
                                                ) : (
                                                    <span className="text-[9px] px-1.5 py-0.5 bg-surface-2 text-text-muted rounded-full font-black uppercase">Agent</span>
                                                )}
                                                <span className="text-[9px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded-full font-black uppercase italic">
                                                    {agent.profile?.agent_type || 'individual'}
                                                </span>
                                                {activeTab === 'agency' && (
                                                    <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/30 rounded-full font-black">
                                                        {agents.filter(a => a.profile?.parent_agent_id === agent.user_id).length} Sub-agents
                                                    </span>
                                                )}
                                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-black uppercase ${
                                                    agent.profile?.status === 'approved' ? 'bg-green-500/10 text-green-400' : 
                                                    agent.profile?.status === 'rejected' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
                                                }`}>
                                                    {agent.profile?.status || 'pending'}
                                                </span>
                                                {agent.profile?.is_active === false && (
                                                    <span className="text-[9px] px-1.5 py-0.5 bg-red-500 text-text-primary rounded-full font-black uppercase">Suspended</span>
                                                )}
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-text-muted truncate">ID: {agent.user_id}</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => fetchAgentHistory(agent.user_id)} className="p-2 rounded-lg hover:bg-surface-2 text-text-muted hover:text-primary transition-all">
                                            <span className="material-symbols-outlined notranslate text-[20px]">history</span>
                                        </button>
                                        <button onClick={() => setEditAgent({ ...agent.profile, id: agent.user_id, role: agent.role })} className="p-2 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-all">
                                            <span className="material-symbols-outlined notranslate text-[20px]">edit</span>
                                        </button>
                                        {(role === 'super_admin') && (
                                            <button 
                                                onClick={() => handleDeleteAgent(agent.user_id)} 
                                                className="p-2 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-all"
                                                title="Delete Agent"
                                            >
                                                <span className="material-symbols-outlined notranslate text-[20px]">delete</span>
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Render Sub-agents if in Agency tab */}
                                {activeTab === 'agency' && agents
                                    .filter(sub => sub.profile?.parent_agent_id === agent.user_id)
                                    .map(sub => (
                                        <div key={sub.user_id} className="flex items-center gap-4 py-3 pl-14 pr-4 bg-white/[0.01] hover:bg-white/5 transition-colors border-t border-border-dark/50">
                                            <div className="size-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
                                                <span className="material-symbols-outlined notranslate text-[18px]">person</span>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-sm text-text-secondary">{sub.profile?.company_name}</span>
                                                    <span className="text-[8px] px-1.5 py-0.5 bg-surface-2 text-text-muted rounded-full font-black uppercase">Sub Agent</span>
                                                    <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase ${
                                                        sub.profile?.status === 'approved' ? 'bg-green-500/5 text-green-400/80' : 'bg-amber-500/5 text-amber-400/80'
                                                    }`}>
                                                        {sub.profile?.status}
                                                    </span>
                                                </div>
                                                <p className="text-[9px] text-text-muted/60">ID: {sub.user_id}</p>
                                            </div>
                                            <div className="flex gap-1">
                                                <button onClick={() => fetchAgentHistory(sub.user_id)} className="p-1.5 rounded-md hover:bg-surface-2 text-text-muted transition-all">
                                                    <span className="material-symbols-outlined notranslate text-[16px]">history</span>
                                                </button>
                                                <button onClick={() => setEditAgent({ ...sub.profile, id: sub.user_id, role: sub.role })} className="p-1.5 rounded-md hover:bg-surface-2 text-text-muted transition-all">
                                                    <span className="material-symbols-outlined notranslate text-[16px]">edit</span>
                                                 </button>
                                                 {(role === 'super_admin') && (
                                                     <button 
                                                         onClick={() => handleDeleteAgent(sub.user_id)} 
                                                         className="p-1.5 rounded-md hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-all"
                                                         title="Delete Sub-Agent"
                                                     >
                                                         <span className="material-symbols-outlined notranslate text-[16px]">delete</span>
                                                     </button>
                                                 )}
                                             </div>
                                        </div>
                                    ))
                                }
                            </React.Fragment>
                        ))}
                    {!loading && agents.length === 0 && (
                        <div className="p-10 text-center text-text-muted text-sm italic">No agents found.</div>
                    )}
                </div>
            </div>

            {/* Edit Modal */}
            {editAgent && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-border flex items-center justify-between">
                            <h2 className="text-lg font-bold text-text-primary">Edit Agent Profile</h2>
                            <button onClick={() => setEditAgent(null)} className="text-text-muted hover:text-text-primary">
                                <span className="material-symbols-outlined notranslate">close</span>
                            </button>
                        </div>

                        <form onSubmit={handleUpdateAgent} className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-text-muted mb-1.5 font-medium">Agency Name</label>
                                    <input className="input-theme w-full" value={editAgent.company_name || ''} onChange={e => setEditAgent({...editAgent, company_name: e.target.value})} />
                                </div>
                                <div>
                                    <label className="block text-xs text-text-muted mb-1.5 font-medium">Phone</label>
                                    <input className="input-theme w-full" value={editAgent.phone_number || ''} onChange={e => setEditAgent({...editAgent, phone_number: e.target.value})} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-text-muted mb-1.5 font-medium">Admin Margin Override (%)</label>
                                    <input type="number" step="0.1" className="input-theme w-full text-right" value={editAgent.admin_margin ?? 0} onChange={e => setEditAgent({...editAgent, admin_margin: e.target.value})} />
                                    <p className="text-[10px] text-text-muted mt-1 italic">0 = uses global default</p>
                                </div>
                                <div>
                                    <label className="block text-xs text-text-muted mb-1.5 font-medium">Agent Type</label>
                                    <select 
                                        className="input-theme w-full text-xs font-bold"
                                        value={editAgent.agent_type || 'individual'}
                                        onChange={e => setEditAgent({...editAgent, agent_type: e.target.value})}
                                    >
                                        <option value="individual">Individual</option>
                                        <option value="collaborator">Collaborator (Owner Branding)</option>
                                        <option value="agency">Agency</option>
                                        <option value="sub_agent">Sub-Agent</option>
                                    </select>
                                </div>
                            </div>

                            {editAgent.agent_type === 'sub_agent' && (
                                <div>
                                    <label className="block text-xs text-text-muted mb-1.5 font-medium">Assign to Agency</label>
                                    <select 
                                        className="input-theme w-full text-xs"
                                        value={editAgent.parent_agent_id || ''}
                                        onChange={e => setEditAgent({...editAgent, parent_agent_id: e.target.value})}
                                    >
                                        <option value="">Select Agency...</option>
                                        {agents
                                            .filter(a => a.profile?.agent_type === 'agency')
                                            .map(a => (
                                                <option key={a.user_id} value={a.user_id}>
                                                    {a.profile?.company_name || a.user_id}
                                                </option>
                                            ))
                                        }
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs text-text-muted mb-1.5 font-medium">Status</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {['pending', 'approved', 'rejected'].map(s => (
                                        <button key={s} type="button" onClick={() => setEditAgent({...editAgent, status: s})} 
                                            className={`py-2 rounded-lg text-[10px] font-bold uppercase border transition-all ${editAgent.status === s ? 'bg-primary/20 border-primary text-primary' : 'bg-surface-2 border-transparent text-text-muted'}`}>
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs text-text-muted mb-1.5 font-medium">Permission Level</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {['agent', 'editor', 'admin', 'super_admin'].map(r => (
                                        <button key={r} type="button" onClick={() => setEditAgent({...editAgent, role: r})} 
                                            className={`py-2 rounded-lg text-xs font-bold uppercase border transition-all ${editAgent.role === r ? 'bg-primary/20 border-primary text-primary' : 'bg-surface-2 border-transparent text-text-muted'}`}>
                                            {r}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-4 pt-4 border-t border-border">
                                <div>
                                    <label className="block text-xs text-text-muted mb-1.5 font-medium">Villa Contract Template</label>
                                    <textarea 
                                        className="input-theme w-full h-32 text-xs font-mono" 
                                        value={editAgent.contract_template || ''} 
                                        onChange={e => setEditAgent({...editAgent, contract_template: e.target.value})}
                                        placeholder="Standard rental agreement..."
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-text-muted mb-1.5 font-medium">Boat Contract Template</label>
                                    <textarea 
                                        className="input-theme w-full h-32 text-xs font-mono" 
                                        value={editAgent.boat_contract_template || ''} 
                                        onChange={e => setEditAgent({...editAgent, boat_contract_template: e.target.value})}
                                        placeholder="Boat charter agreement..."
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setEditAgent({...editAgent, boat_contract_template: `BOAT CHARTER AGREEMENT - BALEARIC ISLANDS\n\n1. PARTIES\nThis agreement is made between {{agency_name}} (the Agent) and {{client_full_name}} (the Charterer) for the vessel {{boat_name}}.\n\n2. CHARTER DETAILS\nPeriod: From {{check_in}} to {{check_out}}\nBase Port: Ibiza/Formentera\nMax Capacity: 12 passengers (unless specified otherwise in vessel license)\nTotal Price: €{{final_price}} (Inc. 21% VAT)\nSecurity Deposit: €{{deposit}}\n\n3. ENVIRONMENTAL PROTECTION (POSIDONIA)\nIn accordance with Balearic Decree 25/2018, anchoring on Posidonia oceanica seagrass is strictly prohibited. The Skipper/Charterer must use designated mooring buoys where available.\n\n4. CANCELLATION & WEATHER\nCharters cancelled due to adverse weather conditions (Small Craft Advisory or Force 5+ winds) will be rescheduled or refunded at the Owner's discretion, minus any non-refundable provisioning costs.\n\n5. FUEL & EXTRAS\nFuel is not included unless specified. Consumption will be settled upon disembarkation based on engine hours or 'Full-to-Full' policy.\n\n6. SAFETY & CONDUCT\nThe Charterer agrees to follow all safety instructions from the Captain. Illegal substances, weapons, or hazardous materials are strictly prohibited on board.\n\nAccepted by payment: {{client_full_name}}`})}
                                        className="mt-2 text-[10px] text-primary hover:underline font-bold flex items-center gap-1"
                                    >
                                        <span className="material-symbols-outlined notranslate text-[14px]">magic_button</span>
                                        Load base boat template
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-center justify-between p-3 bg-surface-2 rounded-xl border border-border">
                                <div>
                                    <p className="text-sm font-bold text-text-primary">Active Account</p>
                                    <p className="text-[10px] text-text-muted">{editAgent.is_active !== false ? 'Currently accessible' : 'Suspended'}</p>
                                </div>
                                <input type="checkbox" checked={editAgent.is_active !== false} onChange={e => setEditAgent({...editAgent, is_active: e.target.checked})} className="size-5 accent-primary" />
                            </div>

                            <div className="pt-4 border-t border-border">
                                <button type="submit" disabled={saving === 'edit'} className="btn-primary w-full py-3 h-12">
                                    {saving === 'edit' ? 'Saving Changes...' : 'Update Agent'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* History Modal */}
            {viewHistory && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="bg-surface border border-border rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-border flex items-center justify-between">
                            <h2 className="text-xl font-bold text-text-primary">Agent Performance</h2>
                            <button onClick={() => setViewHistory(null)} className="text-text-muted hover:text-text-primary">
                                <span className="material-symbols-outlined notranslate">close</span>
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
                            <div className="grid grid-cols-3 gap-4">
                                <div className="p-4 bg-white/2 rounded-xl border border-border">
                                    <p className="text-[10px] text-text-muted uppercase font-black">Total Quotes</p>
                                    <p className="text-2xl font-black text-text-primary">{agentQuotes.length}</p>
                                </div>
                                <div className="p-4 bg-white/2 rounded-xl border border-border">
                                    <p className="text-[10px] text-text-muted uppercase font-black">Booked</p>
                                    <p className="text-2xl font-black text-green-400">{agentQuotes.filter(q => q.status === 'booked').length}</p>
                                </div>
                                <div className="p-4 bg-white/2 rounded-xl border border-border">
                                    <p className="text-[10px] text-text-muted uppercase font-black">Revenue</p>
                                    <p className="text-2xl font-black text-primary">€{agentQuotes.filter(q => q.status === 'booked').reduce((s,q) => s + parseFloat(q.final_price || 0), 0).toLocaleString()}</p>
                                </div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-[11px]">
                                    <thead>
                                        <tr className="text-text-muted font-bold uppercase tracking-widest bg-surface-2/50">
                                            <th className="px-4 py-3">Date</th>
                                            <th className="px-4 py-3">Villa</th>
                                            <th className="px-4 py-3">Client</th>
                                            <th className="px-4 py-3 text-center">Status</th>
                                            <th className="px-4 py-3 text-right">Final Price</th>
                                            <th className="px-4 py-3 text-right">Commission</th>
                                            <th className="px-4 py-3 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/30">
                                        {agentQuotes.map(q => {
                                            const base = parseFloat(q.supplier_base_price || 0);
                                            const final = parseFloat(q.final_price || 0);
                                            const adminPct = parseFloat(q.admin_markup || 0);
                                            const platformNet = base * (adminPct / 100);
                                            // Simple commission estimation for the report
                                            const commission = q.status === 'booked' ? Math.round(final - base - platformNet - (final - base) * 0.17) : 0; // Rough net after tax/platform

                                            return (
                                                <tr key={q.id} className="hover:bg-primary/5 transition-all group">
                                                    <td className="px-4 py-3 text-text-muted font-mono">
                                                        {new Date(q.created_at).toLocaleDateString()}
                                                    </td>
                                                    <td className="px-4 py-3 text-text-primary font-bold">
                                                        {q.invenio_properties?.villa_name}
                                                    </td>
                                                    <td className="px-4 py-3 text-text-muted">
                                                        {q.clients?.full_name}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-tighter ${STATUS_COLORS[q.status]}`}>
                                                            {q.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-black text-text-primary">
                                                        €{final.toLocaleString()}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-black text-emerald-400">
                                                        {q.status === 'booked' ? `€${Math.max(0, commission).toLocaleString()}` : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <button 
                                                            onClick={() => setEditQuote(q)}
                                                            className="p-1.5 bg-primary/10 text-primary rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-primary/20"
                                                        >
                                                            <span className="material-symbols-outlined notranslate text-[16px]">edit</span>
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Quote Editor */}
            {editQuote && (
                <EditQuoteModal 
                    quote={editQuote} 
                    onClose={() => setEditQuote(null)} 
                    onSaved={() => {
                        setEditQuote(null);
                        if (viewHistory) fetchAgentHistory(viewHistory);
                    }} 
                />
            )}
            {/* Add Agent/Agency Modal */}
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-border flex items-center justify-between">
                            <h2 className="text-lg font-bold text-text-primary">
                                {newAgent.agent_type === 'agency' ? 'Register New Agency' : 'Register New Agent'}
                            </h2>
                            <button onClick={() => setShowAddModal(false)} className="text-text-muted hover:text-text-primary">
                                <span className="material-symbols-outlined notranslate">close</span>
                            </button>
                        </div>

                        <form onSubmit={handleCreateAgent} className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
                            <div className="space-y-4">
                                {newAgent.agent_type === 'agency' ? (
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Agency Name</label>
                                        <input 
                                            required
                                            className="input-theme w-full h-12" 
                                            value={newAgent.company_name} 
                                            onChange={e => setNewAgent({...newAgent, company_name: e.target.value})} 
                                            placeholder="e.g. Invenio Luxury Estates"
                                        />
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">First Name</label>
                                            <input 
                                                required
                                                className="input-theme w-full h-12" 
                                                value={newAgent.firstName} 
                                                onChange={e => setNewAgent({...newAgent, firstName: e.target.value})} 
                                                placeholder="John"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Last Name</label>
                                            <input 
                                                required
                                                className="input-theme w-full h-12" 
                                                value={newAgent.lastName} 
                                                onChange={e => setNewAgent({...newAgent, lastName: e.target.value})} 
                                                placeholder="Doe"
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Email Address</label>
                                    <input 
                                        required
                                        type="email"
                                        className="input-theme w-full h-12" 
                                        value={newAgent.email} 
                                        onChange={e => setNewAgent({...newAgent, email: e.target.value})} 
                                        placeholder="agent@example.com"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Set Password</label>
                                    <input 
                                        required
                                        type="password"
                                        minLength={6}
                                        className="input-theme w-full h-12" 
                                        value={newAgent.password} 
                                        onChange={e => setNewAgent({...newAgent, password: e.target.value})} 
                                        placeholder="Min. 6 characters"
                                    />
                                </div>

                                {newAgent.agent_type !== 'agency' && (
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Agent Type</label>
                                        <select 
                                            className="input-theme w-full h-12 text-xs font-bold"
                                            value={newAgent.agent_type}
                                            onChange={e => setNewAgent({...newAgent, agent_type: e.target.value})}
                                        >
                                            <option value="individual">Individual Agent</option>
                                            <option value="collaborator">Collaborator (Owner Branding)</option>
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div className="p-4 bg-primary/10 rounded-2xl border border-primary/20 flex items-start gap-3">
                                <span className="material-symbols-outlined notranslate text-primary text-[20px]">info</span>
                                <p className="text-[10px] text-text-primary leading-relaxed">
                                    Creating this account will allow the {newAgent.agent_type === 'agency' ? 'agency' : 'agent'} to log in and manage quotes. They will need to verify their email address.
                                </p>
                            </div>

                            <div className="pt-4 border-t border-border">
                                <button type="submit" disabled={saving === 'create'} className="btn-primary w-full h-12 font-black uppercase tracking-widest shadow-xl shadow-primary/20 transition-all flex items-center justify-center gap-3">
                                    <span className="material-symbols-outlined notranslate text-[20px]">{saving === 'create' ? 'sync' : 'person_add'}</span>
                                    {saving === 'create' ? 'Creating...' : `Create ${newAgent.agent_type === 'agency' ? 'Agency' : 'Agent'}`}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
