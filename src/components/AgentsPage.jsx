import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function AgentsPage() {
    const [agents, setAgents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(null);
    const [message, setMessage] = useState(null);
    const [globalMargins, setGlobalMargins] = useState({ invenioToAdmin: 0, adminToAgent: 0 });
    const [showAddModal, setShowAddModal] = useState(false);
    const [newAgent, setNewAgent] = useState({ email: '', password: '', firstName: '', lastName: '' });

    const { search } = useLocation();

    useEffect(() => { 
        fetchAll(); 
        if (new URLSearchParams(search).get('add') === 'true') {
            setShowAddModal(true);
        }
    }, [search]);

    async function fetchAll() {
        setLoading(true);
        try {
            const [agentsRes, marginsRes] = await Promise.all([
                supabase
                    .from('user_roles')
                    .select(`
                        user_id, role, created_at,
                        agents:user_id (company_name)
                    `)
                    .eq('role', 'agent'),
                supabase
                    .from('margin_settings')
                    .select('*')
                    .limit(1)
                    .single(),
            ]);

            setAgents(agentsRes.data || []);
            if (marginsRes.data) {
                setGlobalMargins({
                    invenioToAdmin: parseFloat(marginsRes.data.invenio_to_admin_margin) || 0,
                    adminToAgent: parseFloat(marginsRes.data.admin_to_agent_margin) || 0,
                });
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateAgent(e) {
        e.preventDefault();
        setSaving('agent');
        try {
            // 1. Create User in Auth
            const { data, error: signUpError } = await supabase.auth.signUp({
                email: newAgent.email,
                password: newAgent.password,
                options: {
                    data: {
                        first_name: newAgent.firstName,
                        last_name: newAgent.lastName,
                    }
                }
            });
            if (signUpError) throw signUpError;

            // 2. Add Role (The trigger might do this, but being explicit is safer if not set)
            // Note: In some setups, a trigger on auth.users handles this.
            // If not, we might need to insert into user_roles after the user is confirmed or use an edge function.
            // For now, we assume the user is created and they will appear in the 'user_roles' list once the fetchAll runs.
            
            setMessage({ type: 'success', text: `Agent ${newAgent.email} invited! They should check their email.` });
            setNewAgent({ email: '', password: '', firstName: '', lastName: '' });
            setShowAddModal(false);
            fetchAll();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
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
                    invenio_to_admin_margin: globalMargins.invenioToAdmin,
                    admin_to_agent_margin: globalMargins.adminToAgent,
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

    return (
        <div className="p-6 md:p-8 space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Agent Management</h1>
                    <p className="text-slate-500 text-sm mt-0.5">Manage agents and configure profit margins</p>
                </div>
                <button 
                    onClick={() => setShowAddModal(true)}
                    className="btn-primary text-sm flex items-center gap-2"
                >
                    <span className="material-symbols-outlined text-[18px]">person_add</span>
                    Create Agent
                </button>
            </div>

            {/* Global Margins Card */}
            <div className="glass-card p-6">
                <div className="flex items-center gap-3 mb-5">
                    <div className="p-2 bg-primary/10 rounded-lg">
                        <span className="material-symbols-outlined text-primary text-[20px]">tune</span>
                    </div>
                    <div>
                        <h2 className="font-bold text-white">Global Profit Margins</h2>
                        <p className="text-xs text-slate-500">Applied to all agents by default</p>
                    </div>
                </div>

                {message && (
                    <div className={`mb-4 p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-500/10 border border-green-500/30 text-green-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
                        {message.text}
                    </div>
                )}

                <form onSubmit={handleSaveMargins} className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div>
                            <label className="block text-xs text-slate-400 mb-1.5 font-medium">
                                Invenio → Admin Margin
                            </label>
                            <div className="relative">
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="100"
                                    className="input-dark w-full pr-10"
                                    value={globalMargins.invenioToAdmin}
                                    onChange={e => setGlobalMargins(prev => ({ ...prev, invenioToAdmin: e.target.value }))}
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">%</span>
                            </div>
                            <p className="text-[11px] text-slate-600 mt-1">Added to the Invenio base price to get your cost.</p>
                        </div>

                        <div>
                            <label className="block text-xs text-slate-400 mb-1.5 font-medium">
                                Admin → Agent Margin
                            </label>
                            <div className="relative">
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="100"
                                    className="input-dark w-full pr-10"
                                    value={globalMargins.adminToAgent}
                                    onChange={e => setGlobalMargins(prev => ({ ...prev, adminToAgent: e.target.value }))}
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">%</span>
                            </div>
                            <p className="text-[11px] text-slate-600 mt-1">Your markup shown to agents as their sell price.</p>
                        </div>
                    </div>

                    {/* Pricing preview */}
                    <div className="bg-background-dark/60 border border-border-dark rounded-xl p-4 text-xs space-y-2">
                        <p className="text-slate-400 font-semibold mb-2">Pricing Preview (example: €5,000 base)</p>
                        {(() => {
                            const base = 5000;
                            const adminCost = base * (1 + parseFloat(globalMargins.invenioToAdmin) / 100);
                            const agentPrice = adminCost * (1 + parseFloat(globalMargins.adminToAgent) / 100);
                            return (
                                <div className="space-y-1.5">
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Invenio base:</span>
                                        <span className="text-slate-300 font-mono">€{base.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Your cost (+{globalMargins.invenioToAdmin}%):</span>
                                        <span className="text-slate-300 font-mono">€{Math.round(adminCost).toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between border-t border-border-dark pt-1.5">
                                        <span className="text-primary">Agent sell price (+{globalMargins.adminToAgent}%):</span>
                                        <span className="text-primary font-bold font-mono">€{Math.round(agentPrice).toLocaleString()}</span>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    <button
                        type="submit"
                        disabled={saving === 'global'}
                        className="btn-primary flex items-center gap-2 disabled:opacity-50"
                    >
                        <span className="material-symbols-outlined text-[16px]">save</span>
                        {saving === 'global' ? 'Saving...' : 'Save Global Margins'}
                    </button>
                </form>
            </div>

            {/* Agents List */}
            <div className="glass-card">
                <div className="p-5 border-b border-border-dark">
                    <h2 className="font-bold text-white">Registered Agents</h2>
                    <p className="text-xs text-slate-500 mt-0.5">{agents.length} agent{agents.length !== 1 ? 's' : ''} in the system</p>
                </div>

                {loading ? (
                    <div className="p-8 text-center">
                        <div className="animate-spin inline-block size-6 border-2 border-primary border-t-transparent rounded-full"></div>
                    </div>
                ) : agents.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-sm">
                        No agents registered yet. Agents sign up from the login page.
                    </div>
                ) : (
                    <div className="divide-y divide-border-dark">
                        {agents.map(agent => (
                            <div key={agent.user_id} className="flex items-center gap-4 p-4 hover:bg-white/2 transition-colors">
                                <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                                    <span className="material-symbols-outlined text-[18px]">person</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-200 truncate">
                                        {agent.agents?.[0]?.company_name || agent.user_id}
                                    </p>
                                    <p className="text-xs text-slate-500">Agent · Joined {new Date(agent.created_at).toLocaleDateString('en-GB')}</p>
                                </div>
                                <span className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded-full uppercase tracking-wide">
                                    {agent.role}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Agent Modal */}
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="bg-surface-dark border border-border-dark rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-5">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white">New Agent Account</h2>
                            <button onClick={() => setShowAddModal(false)} className="text-slate-500 hover:text-white">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <form onSubmit={handleCreateAgent} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1.5 font-medium">First Name</label>
                                    <input
                                        required
                                        className="input-dark w-full"
                                        value={newAgent.firstName}
                                        onChange={e => setNewAgent(p => ({ ...p, firstName: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1.5 font-medium">Last Name</label>
                                    <input
                                        required
                                        className="input-dark w-full"
                                        value={newAgent.lastName}
                                        onChange={e => setNewAgent(p => ({ ...p, lastName: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1.5 font-medium">Email Address</label>
                                <input
                                    required
                                    type="email"
                                    className="input-dark w-full"
                                    value={newAgent.email}
                                    onChange={e => setNewAgent(p => ({ ...p, email: e.target.value }))}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1.5 font-medium">Temporary Password</label>
                                <input
                                    required
                                    type="password"
                                    className="input-dark w-full"
                                    value={newAgent.password}
                                    onChange={e => setNewAgent(p => ({ ...p, password: e.target.value }))}
                                />
                                <p className="text-[10px] text-slate-600 mt-1">Min. 6 characters. The agent can change this after first login.</p>
                            </div>

                            <div className="pt-2">
                                <button
                                    type="submit"
                                    disabled={saving === 'agent'}
                                    className="btn-primary w-full flex items-center justify-center gap-2 py-3"
                                >
                                    <span className="material-symbols-outlined text-[18px]">how_to_reg</span>
                                    {saving === 'agent' ? 'Creating...' : 'Register Agent'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
