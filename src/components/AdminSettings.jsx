import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function AdminSettings() {
    const [invenioToAdmin, setInvenioToAdmin] = useState('');
    const [adminToAgent, setAdminToAgent] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState({ text: '', type: '' });

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('margin_settings')
                .select('*')
                .limit(1)
                .single();

            if (error) throw error;

            if (data) {
                setInvenioToAdmin(data.invenio_to_admin_margin);
                setAdminToAgent(data.admin_to_agent_margin);
            }
        } catch (error) {
            console.error("Error fetching margin settings:", error);
            setMessage({ text: 'Unable to load settings.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage({ text: '', type: '' });

        try {
            const { error } = await supabase
                .from('margin_settings')
                .update({
                    invenio_to_admin_margin: parseFloat(invenioToAdmin) || 0,
                    admin_to_agent_margin: parseFloat(adminToAgent) || 0
                })
                .eq('id', 1); // Assuming single row setup

            if (error) throw error;
            setMessage({ text: 'Settings saved successfully!', type: 'success' });

            // Auto hide success message
            setTimeout(() => {
                setMessage({ text: '', type: '' });
            }, 3000);
        } catch (error) {
            console.error("Error saving settings:", error);
            setMessage({ text: 'Error saving settings.', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="text-slate-500">Loading settings...</div>;
    }

    return (
        <div className="max-w-xl mx-auto space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="bg-primary/10 p-2 rounded-lg">
                    <span className="material-symbols-outlined text-primary">settings</span>
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Global Margin Settings</h2>
            </div>

            {message.text && (
                <div className={`p-4 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                    {message.text}
                </div>
            )}

            <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Financial Settings</h3>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
                    <div className="space-y-6">

                        <div className="space-y-2">
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                                Invenio to Admin Margin
                            </label>
                            <div className="relative flex items-center">
                                <input
                                    className="w-full h-14 rounded-lg border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-lg font-medium focus:border-primary focus:ring-primary dark:text-white pr-12 pl-4 outline-none"
                                    placeholder="0.00"
                                    type="number"
                                    step="0.01"
                                    value={invenioToAdmin}
                                    onChange={(e) => setInvenioToAdmin(e.target.value)}
                                />
                                <div className="absolute right-4 pointer-events-none">
                                    <span className="material-symbols-outlined text-slate-400 dark:text-slate-500">percent</span>
                                </div>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed italic">
                                Added to the base Invenio price. Used to calculate the internal Admin cost.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                                Admin to Agent Margin
                            </label>
                            <div className="relative flex items-center">
                                <input
                                    className="w-full h-14 rounded-lg border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-lg font-medium focus:border-primary focus:ring-primary dark:text-white pr-12 pl-4 outline-none"
                                    placeholder="0.00"
                                    type="number"
                                    step="0.01"
                                    value={adminToAgent}
                                    onChange={(e) => setAdminToAgent(e.target.value)}
                                />
                                <div className="absolute right-4 pointer-events-none">
                                    <span className="material-symbols-outlined text-slate-400 dark:text-slate-500">percent</span>
                                </div>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed italic">
                                Added to the Admin cost. This determines the final price displayed to Agents.
                            </p>
                        </div>

                        <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="w-full bg-primary hover:bg-primary/90 text-background-dark font-bold py-4 rounded-xl shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                <span className="material-symbols-outlined text-[20px]">save</span>
                                {saving ? "Saving..." : "Save Settings"}
                            </button>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
