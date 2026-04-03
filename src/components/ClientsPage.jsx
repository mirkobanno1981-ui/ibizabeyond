import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function ClientsPage() {
    const { user, role } = useAuth();
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ 
        full_name: '', email: '', phone_number: '', notes: '',
        id_number: '', id_type: 'Passport', dob: '', nationality: '',
        gender: 'Other', address_street: '', address_city: '', address_country: '',
        fiscal_number: '', description: ''
    });
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [selectedClientQuotes, setSelectedClientQuotes] = useState(null);
    const [viewingClient, setViewingClient] = useState(null);

    useEffect(() => { fetchClients(); }, []);

    async function fetchClients() {
        if (!user) return;
        setLoading(true);

        let query = supabase
            .from('clients')
            .select('*, agents(company_name)')
            .order('created_at', { ascending: false });

        if (role !== 'admin' && role !== 'super_admin') {
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

        const { data } = await query;
        setClients(data || []);
        setLoading(false);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSaving(true);
        const clientData = {
            full_name: form.full_name,
            email: form.email,
            phone_number: form.phone_number,
            notes: form.notes,
            id_number: form.id_number,
            id_type: form.id_type,
            dob: form.dob || null,
            nationality: form.nationality,
            gender: form.gender,
            address_street: form.address_street,
            address_city: form.address_city,
            address_country: form.address_country,
            fiscal_number: form.fiscal_number,
            description: form.description,
        };

        let result;
        if (editingId) {
            let query = supabase
                .from('clients')
                .update(clientData)
                .eq('id', editingId);
            
            if (role !== 'admin' && role !== 'super_admin') {
                query = query.eq('agent_id', user?.id);
            }
            result = await query;
        } else {
            result = await supabase
                .from('clients')
                .insert({ ...clientData, agent_id: user?.id });
        }

        if (result.error) {
            console.error('Error saving client:', result.error);
            alert('Error: ' + result.error.message);
        } else {
            setForm({ 
                full_name: '', email: '', phone_number: '', notes: '',
                id_number: '', id_type: 'Passport', dob: '', nationality: '',
                gender: 'Other', address_street: '', address_city: '', address_country: '',
                fiscal_number: '', description: ''
            });
            setShowForm(false);
            setEditingId(null);
            fetchClients();
        }
        setSaving(false);
    }

    function startEdit(client) {
        setForm({
            full_name: client.full_name,
            email: client.email,
            phone_number: client.phone_number,
            notes: client.notes || '',
            id_number: client.id_number || '',
            id_type: client.id_type || 'Passport',
            dob: client.dob || '',
            nationality: client.nationality || '',
            gender: client.gender || 'Other',
            address_street: client.address_street || '',
            address_city: client.address_city || '',
            address_country: client.address_country || '',
            fiscal_number: client.fiscal_number || '',
            description: client.description || ''
        });
        setEditingId(client.id);
        setShowForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function handleDelete(id) {
        if (!confirm('Are you sure you want to delete this client?')) return;
        
        let query = supabase.from('clients').delete().eq('id', id);
        
        if (role !== 'admin' && role !== 'super_admin') {
            query = query.eq('agent_id', user?.id);
        }

        const { error } = await query;
        if (!error) {
            fetchClients();
        } else {
            console.error('Error deleting client:', error);
            alert('Error deleting client: ' + error.message);
        }
    }

    async function viewClientQuotes(client) {
        setViewingClient(client);
        const { data, error } = await supabase
            .from('quotes')
            .select('*, invenio_properties(villa_name)')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false });
        
        if (error) {
            alert('Error fetching quotes');
        } else {
            setSelectedClientQuotes(data);
        }
    }

    return (
        <div className="p-6 md:p-8 space-y-6">
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary">Clients</h1>
                    <p className="text-text-muted text-sm mt-0.5">{clients.length} client{clients.length !== 1 ? 's' : ''} in your portfolio</p>
                </div>
                <button 
                    onClick={() => {
                        setShowForm(!showForm);
                        if (showForm) setEditingId(null);
                    }} 
                    className="btn-primary text-sm flex items-center gap-2"
                >
                    <span className="material-symbols-outlined notranslate text-[16px]">{showForm ? 'close' : 'add'}</span>
                    {showForm ? 'Cancel' : 'New Client'}
                </button>
            </div>

            {showForm && (
                <div className="glass-card p-5 border-primary/20 bg-primary/2">
                    <h3 className="text-sm font-bold text-text-primary mb-4">
                        {editingId ? 'Edit Client' : 'Add New Client'}
                    </h3>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Section 1: Basic Info */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="col-span-1">
                                <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase tracking-widest">Full Name</label>
                                <input
                                    required
                                    className="input-theme w-full"
                                    placeholder="e.g. John Smith"
                                    value={form.full_name}
                                    onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))}
                                />
                            </div>
                            <div className="col-span-1">
                                <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase tracking-widest">Email</label>
                                <input
                                    required
                                    type="email"
                                    className="input-theme w-full"
                                    placeholder="john@example.com"
                                    value={form.email}
                                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                                />
                            </div>
                            <div className="col-span-1">
                                <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase tracking-widest">Phone</label>
                                <input
                                    required
                                    className="input-theme w-full"
                                    placeholder="+44 7..."
                                    value={form.phone_number}
                                    onChange={e => setForm(p => ({ ...p, phone_number: e.target.value }))}
                                />
                            </div>
                        </div>

                        {/* Section 2: Identity (Regulatory) */}
                        <div className="pt-4 border-t border-border/50">
                            <h4 className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mb-4">Identity & Compliance (SES Hospedajes)</h4>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div>
                                    <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase tracking-widest">Doc Type</label>
                                    <select 
                                        className="input-theme w-full"
                                        value={form.id_type}
                                        onChange={e => setForm(p => ({ ...p, id_type: e.target.value }))}
                                    >
                                        <option value="Passport">Passport</option>
                                        <option value="ID Card">National ID Card</option>
                                        <option value="Drivers License">Driver's License</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase tracking-widest">Doc Number</label>
                                    <input
                                        className="input-theme w-full"
                                        placeholder="P1234567"
                                        value={form.id_number}
                                        onChange={e => setForm(p => ({ ...p, id_number: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase tracking-widest">Date of Birth</label>
                                    <input
                                        type="date"
                                        className="input-theme w-full"
                                        value={form.dob}
                                        onChange={e => setForm(p => ({ ...p, dob: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase tracking-widest">Nationality</label>
                                    <input
                                        className="input-theme w-full"
                                        placeholder="British"
                                        value={form.nationality}
                                        onChange={e => setForm(p => ({ ...p, nationality: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase tracking-widest">Gender</label>
                                    <select 
                                        className="input-theme w-full"
                                        value={form.gender}
                                        onChange={e => setForm(p => ({ ...p, gender: e.target.value }))}
                                    >
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                        <option value="Other">Other / Non-binary</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase tracking-widest">Fiscal number (NIF/NIE)</label>
                                    <input
                                        className="input-theme w-full"
                                        placeholder="X1234567Z"
                                        value={form.fiscal_number}
                                        onChange={e => setForm(p => ({ ...p, fiscal_number: e.target.value }))}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Section 3: Address */}
                        <div className="pt-4 border-t border-border/50">
                            <h4 className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mb-4">Current Residence</h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="md:col-span-1">
                                    <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase tracking-widest">Street Address</label>
                                    <input
                                        className="input-theme w-full"
                                        placeholder="123 Baker Street"
                                        value={form.address_street}
                                        onChange={e => setForm(p => ({ ...p, address_street: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase tracking-widest">City</label>
                                    <input
                                        className="input-theme w-full"
                                        placeholder="London"
                                        value={form.address_city}
                                        onChange={e => setForm(p => ({ ...p, address_city: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase tracking-widest">Country</label>
                                    <input
                                        className="input-theme w-full"
                                        placeholder="United Kingdom"
                                        value={form.address_country}
                                        onChange={e => setForm(p => ({ ...p, address_country: e.target.value }))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="w-full">
                            <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase tracking-widest">Internal Notes</label>
                            <textarea
                                className="input-theme w-full resize-none"
                                rows={2}
                                placeholder="Add preferences, rules, or background info..."
                                value={form.notes}
                                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                            />
                        </div>

                        <div className="w-full">
                            <label className="block text-[10px] text-text-muted mb-1.5 font-bold uppercase tracking-widest">Client Profile / Description</label>
                            <textarea
                                className="input-theme w-full resize-none"
                                rows={4}
                                placeholder="Detailed client profile, preferences, VIP status, etc..."
                                value={form.description}
                                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                            />
                        </div>

                        <div className="w-full flex justify-end gap-3 border-t border-border/50 pt-6">
                            <button 
                                type="button" 
                                onClick={() => { setShowForm(false); setEditingId(null); }}
                                className="px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest text-text-muted hover:text-text-primary transition-all"
                            >
                                Cancel
                            </button>
                            <button type="submit" disabled={saving} className="btn-primary px-10 disabled:opacity-50 shadow-lg shadow-primary/20">
                                {saving ? 'Saving...' : (editingId ? 'Update Client' : 'Create Client Profile')}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* List */}
            <div className="glass-card overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center">
                        <div className="animate-spin inline-block size-6 border-2 border-primary border-t-transparent rounded-full"></div>
                    </div>
                ) : clients.length === 0 ? (
                    <div className="p-12 text-center text-text-muted">
                        <span className="material-symbols-outlined notranslate text-4xl block mb-2 text-slate-700">group</span>
                        No clients yet. Add your first client above.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-left bg-white/2">
                                    <th className="px-5 py-3 text-xs font-bold text-text-muted uppercase tracking-widest">Name</th>
                                    <th className="px-5 py-3 text-xs font-bold text-text-muted uppercase tracking-widest">Email</th>
                                    <th className="px-5 py-3 text-xs font-bold text-text-muted uppercase tracking-widest">Phone</th>
                                    {(role === 'admin' || role === 'super_admin' || role === 'agency_admin') && (
                                        <th className="px-5 py-3 text-xs font-bold text-text-muted uppercase tracking-widest">Agent</th>
                                    )}
                                    <th className="px-5 py-3 text-xs font-bold text-text-muted uppercase tracking-widest">Profile</th>
                                    <th className="px-5 py-3 text-xs font-bold text-text-muted uppercase tracking-widest">Notes</th>
                                    <th className="px-5 py-3 text-xs font-bold text-text-muted uppercase tracking-widest">Date Added</th>
                                    <th className="px-5 py-3 text-xs font-bold text-text-muted uppercase tracking-widest text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border-dark">
                                {clients.map(c => (
                                    <tr key={c.id} className="hover:bg-white/2 transition-colors">
                                        <td className="px-5 py-3.5 font-medium text-text-primary">{c.full_name}</td>
                                        <td className="px-5 py-3.5 text-text-muted">{c.email}</td>
                                        <td className="px-5 py-3.5 text-text-muted">{c.phone_number}</td>
                                        {(role === 'admin' || role === 'super_admin' || role === 'agency_admin') && (
                                            <td className="px-5 py-3.5">
                                                <div className="flex flex-col">
                                                    <span className="text-text-primary font-bold text-xs">{c.agent_id === user.id ? 'You' : (c.agents?.company_name || 'Individual Agent')}</span>
                                                    <span className="text-[9px] text-text-muted uppercase tracking-tighter">ID: {c.agent_id.slice(0,8)}</span>
                                                </div>
                                            </td>
                                        )}
                                        <td className="px-5 py-3.5">
                                            <p className="text-text-muted text-xs font-medium max-w-xs truncate" title={c.description}>
                                                {c.description || 'No profile'}
                                            </p>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <p className="text-text-muted text-[10px] italic max-w-xs truncate" title={c.notes}>
                                                {c.notes || 'No notes'}
                                            </p>
                                        </td>
                                        <td className="px-5 py-3.5 text-text-muted text-xs">
                                            {new Date(c.created_at).toLocaleDateString('en-GB')}
                                        </td>
                                        <td className="px-5 py-3.5 text-right flex justify-end gap-2">
                                            <button 
                                                onClick={() => viewClientQuotes(c)}
                                                className="p-1.5 text-text-muted hover:text-green-400 hover:bg-green-400/5 rounded-lg transition-all"
                                                title="View Quote History"
                                            >
                                                <span className="material-symbols-outlined notranslate text-[18px]">receipt_long</span>
                                            </button>
                                            <button 
                                                onClick={() => startEdit(c)}
                                                className="p-1.5 text-text-muted hover:text-primary hover:bg-primary/5 rounded-lg transition-all"
                                                title="Edit Contact"
                                            >
                                                <span className="material-symbols-outlined notranslate text-[18px]">edit</span>
                                            </button>
                                            <button 
                                                onClick={() => handleDelete(c.id)}
                                                className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-400/5 rounded-lg transition-all"
                                                title="Delete Contact"
                                            >
                                                <span className="material-symbols-outlined notranslate text-[18px]">delete</span>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Quote History Modal */}
            {selectedClientQuotes && viewingClient && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
                    <div className="bg-surface border border-border rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="p-6 border-b border-border flex justify-between items-center bg-white/2">
                            <div>
                                <h2 className="text-xl font-bold text-text-primary">Quote History</h2>
                                <p className="text-xs text-text-muted">All proposals sent to <span className="text-primary font-bold">{viewingClient.full_name}</span></p>
                            </div>
                            <button onClick={() => { setSelectedClientQuotes(null); setViewingClient(null); }} className="text-text-muted hover:text-text-primary transition-colors">
                                <span className="material-symbols-outlined notranslate">close</span>
                            </button>
                        </div>
                        
                        <div className="p-6 max-h-[60vh] overflow-y-auto">
                            {selectedClientQuotes.length === 0 ? (
                                <div className="py-12 text-center text-text-muted">
                                    <span className="material-symbols-outlined notranslate text-4xl block mb-2 opacity-20">history</span>
                                    No quotes found for this client.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {selectedClientQuotes.map(q => (
                                        <div key={q.id} className="glass-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-surface-2 transition-colors border-border">
                                            <div>
                                                <h4 className="font-bold text-text-primary text-sm">{q.invenio_properties?.villa_name}</h4>
                                                <div className="flex items-center gap-3 mt-1">
                                                    <span className="text-[10px] text-text-muted uppercase font-black flex items-center gap-1">
                                                        <span className="material-symbols-outlined notranslate text-[12px]">calendar_month</span>
                                                        {new Date(q.check_in).toLocaleDateString('en-GB')} → {new Date(q.check_out).toLocaleDateString('en-GB')}
                                                    </span>
                                                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                                                        q.status === 'booked' ? 'bg-green-500/10 text-green-500' :
                                                        q.status === 'sent' ? 'bg-blue-500/10 text-blue-500' :
                                                        'bg-slate-500/10 text-text-muted'
                                                    }`}>
                                                        {q.status}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between md:justify-end gap-6 border-t md:border-t-0 border-border pt-3 md:pt-0">
                                                <div className="text-right">
                                                    <p className="text-[10px] text-text-muted uppercase font-bold">Total Price</p>
                                                    <p className="text-sm font-black text-primary">€{parseFloat(q.final_price).toLocaleString()}</p>
                                                </div>
                                                <a 
                                                    href={`/quote/${q.id}`} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className="size-10 rounded-xl bg-primary/20 text-primary flex items-center justify-center hover:bg-primary hover:text-background-dark transition-all"
                                                >
                                                    <span className="material-symbols-outlined notranslate text-[20px]">open_in_new</span>
                                                </a>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        
                        <div className="p-4 bg-background/30 text-center border-t border-border">
                            <p className="text-[10px] text-text-muted uppercase font-black tracking-widest">End of History</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
