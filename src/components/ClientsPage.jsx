import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function ClientsPage() {
    const { user, role } = useAuth();
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ full_name: '', phone_number: '', notes: '' });
    const [saving, setSaving] = useState(false);

    useEffect(() => { fetchClients(); }, []);

    async function fetchClients() {
        if (!user) return;
        setLoading(true);
        const { data } = await supabase
            .from('clients')
            .select('*')
            .eq('agent_id', user.id)
            .order('created_at', { ascending: false });
        setClients(data || []);
        setLoading(false);
    }

    async function handleCreate(e) {
        e.preventDefault();
        setSaving(true);
        const { error } = await supabase.from('clients').insert({
            agent_id: user?.id,
            full_name: form.full_name,
            phone_number: form.phone_number,
            notes: form.notes,
        });
        if (!error) {
            setForm({ full_name: '', phone_number: '', notes: '' });
            setShowForm(false);
            fetchClients();
        }
        setSaving(false);
    }

    return (
        <div className="p-6 md:p-8 space-y-6">
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Clients</h1>
                    <p className="text-slate-500 text-sm mt-0.5">{clients.length} client{clients.length !== 1 ? 's' : ''} in your portfolio</p>
                </div>
                <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">{showForm ? 'close' : 'add'}</span>
                    {showForm ? 'Cancel' : 'New Client'}
                </button>
            </div>

            {/* Add form */}
            {showForm && (
                <div className="glass-card p-5">
                    <h3 className="text-sm font-bold text-white mb-4">Add New Client</h3>
                    <form onSubmit={handleCreate} className="flex flex-wrap gap-4 items-start">
                        <div className="flex-1 min-w-[200px]">
                            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Full Name</label>
                            <input
                                required
                                className="input-dark w-full"
                                placeholder="e.g. John Smith"
                                value={form.full_name}
                                onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))}
                            />
                        </div>
                        <div className="flex-1 min-w-[180px]">
                            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Phone</label>
                            <input
                                required
                                className="input-dark w-full"
                                placeholder="+44 7..."
                                value={form.phone_number}
                                onChange={e => setForm(p => ({ ...p, phone_number: e.target.value }))}
                            />
                        </div>
                        <div className="w-full">
                            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Internal Notes</label>
                            <textarea
                                className="input-dark w-full resize-none"
                                rows={2}
                                placeholder="Add preferences, rules, or background info..."
                                value={form.notes}
                                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                            />
                        </div>
                        <div className="w-full flex justify-end">
                            <button type="submit" disabled={saving} className="btn-primary px-8 disabled:opacity-50">
                                {saving ? 'Saving...' : 'Add Client'}
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
                    <div className="p-12 text-center text-slate-500">
                        <span className="material-symbols-outlined text-4xl block mb-2 text-slate-700">group</span>
                        No clients yet. Add your first client above.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border-dark text-left bg-white/2">
                                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-widest">Name</th>
                                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-widest">Phone</th>
                                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-widest">Notes</th>
                                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-widest">Date Added</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border-dark">
                                {clients.map(c => (
                                    <tr key={c.id} className="hover:bg-white/2 transition-colors">
                                        <td className="px-5 py-3.5 font-medium text-white">{c.full_name}</td>
                                        <td className="px-5 py-3.5 text-slate-400">{c.phone_number}</td>
                                        <td className="px-5 py-3.5">
                                            <p className="text-slate-500 text-xs italic max-w-xs truncate" title={c.notes}>
                                                {c.notes || 'No notes'}
                                            </p>
                                        </td>
                                        <td className="px-5 py-3.5 text-slate-500 text-xs">
                                            {new Date(c.created_at).toLocaleDateString('en-GB')}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
