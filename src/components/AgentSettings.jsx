import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function AgentSettings() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [agentData, setAgentData] = useState({
        company_name: '',
        agency_details: '',
        phone_number: '',
        markup_percent: 15,
        logo_url: ''
    });
    const [message, setMessage] = useState({ text: '', type: '' });
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        if (user) fetchAgentData();
    }, [user]);

    const fetchAgentData = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('agents')
                .select('*')
                .eq('id', user.id)
                .single();

            if (error) throw error;
            if (data) {
                setAgentData({
                    company_name: data.company_name || '',
                    agency_details: data.agency_details || '',
                    phone_number: data.phone_number || '',
                    markup_percent: data.markup_percent || 15,
                    logo_url: data.logo_url || ''
                });
            }
        } catch (error) {
            console.error("Error fetching agent settings:", error);
            setMessage({ text: 'Unable to load profile.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage({ text: '', type: '' });

        try {
            const { error } = await supabase
                .from('agents')
                .upsert({
                    id: user.id,
                    company_name: agentData.company_name,
                    agency_details: agentData.agency_details,
                    phone_number: agentData.phone_number,
                    markup_percent: parseFloat(agentData.markup_percent) || 0,
                    logo_url: agentData.logo_url
                });

            if (error) throw error;
            setMessage({ text: 'Profile updated successfully!', type: 'success' });
            setTimeout(() => setMessage({ text: '', type: '' }), 3000);
        } catch (error) {
            console.error("Error saving profile:", error);
            setMessage({ text: 'Error saving profile.', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const handleLogoUpload = async (e) => {
        try {
            setUploading(true);
            const file = e.target.files[0];
            if (!file) return;

            const fileExt = file.name.split('.').pop();
            const fileName = `${Date.now()}.${fileExt}`;
            const filePath = `${user.id}/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('agent-logos')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('agent-logos')
                .getPublicUrl(filePath);

            setAgentData({ ...agentData, logo_url: publicUrl });
            setMessage({ text: 'Logo uploaded successfully! Remember to save.', type: 'success' });
        } catch (error) {
            console.error('Error uploading logo:', error);
            setMessage({ text: 'Error uploading logo. Ensure the storage bucket exists.', type: 'error' });
        } finally {
            setUploading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
                <div className="size-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                <p className="text-slate-500 text-sm font-medium">Loading your profile...</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto p-6 md:p-12 space-y-12">
            <header className="space-y-2">
                <div className="flex items-center gap-3">
                    <div className="bg-primary/20 p-2 rounded-xl">
                        <span className="material-symbols-outlined text-primary">badge</span>
                    </div>
                    <h1 className="text-3xl font-black text-white tracking-tight">Agency Branding</h1>
                </div>
                <p className="text-slate-500 font-medium">Customize how your clients see your quotes. No "Ibiza Beyond" branding will be visible.</p>
            </header>

            {message.text && (
                <div className={`p-4 rounded-2xl border animate-in fade-in slide-in-from-top-4 duration-300 ${
                    message.type === 'success' 
                    ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                    : 'bg-red-500/10 border-red-500/20 text-red-400'
                }`}>
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-sm">
                            {message.type === 'success' ? 'check_circle' : 'error'}
                        </span>
                        <p className="text-sm font-bold">{message.text}</p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 items-start">
                {/* Visual Identity Section */}
                <section className="space-y-6">
                    <h3 className="text-xs font-black text-slate-600 uppercase tracking-[0.2em]">Visual Identity</h3>
                    <div className="glass-card p-8 text-center space-y-6 flex flex-col items-center">
                        <div className="size-32 rounded-3xl bg-background-dark border-2 border-dashed border-white/10 flex items-center justify-center overflow-hidden relative group">
                            {agentData.logo_url ? (
                                <>
                                    <img src={agentData.logo_url} alt="Agency Logo" className="w-full h-full object-contain p-4" />
                                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                        <span className="text-white text-xs font-bold">Replace</span>
                                    </div>
                                </>
                            ) : (
                                <div className="text-slate-600 flex flex-col items-center">
                                    <span className="material-symbols-outlined text-4xl mb-2">add_photo_alternate</span>
                                    <p className="text-[10px] font-bold uppercase tracking-widest">Add Logo</p>
                                </div>
                            )}
                            <input 
                                type="file" 
                                accept="image/*" 
                                onChange={handleLogoUpload}
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                disabled={uploading}
                            />
                        </div>
                        <div className="space-y-2">
                            <p className="text-sm font-bold text-white">Agency Logo</p>
                            <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                                Recommended: Square SVG or transparent PNG.<br/>Used in headers of shared quotes.
                            </p>
                            {uploading && <p className="text-xs text-primary animate-pulse font-bold">Uploading...</p>}
                        </div>
                    </div>
                </section>

                {/* Agency Details Section */}
                <section className="lg:col-span-2 space-y-8">
                    <h3 className="text-xs font-black text-slate-600 uppercase tracking-[0.2em]">Agency Information</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Agency Name</label>
                            <input 
                                type="text"
                                value={agentData.company_name}
                                onChange={(e) => setAgentData({...agentData, company_name: e.target.value})}
                                className="w-full bg-background-dark/50 border border-white/5 rounded-2xl px-5 py-4 text-white focus:border-primary/50 outline-none transition-all font-medium"
                                placeholder="e.g. Dream Ibiza Travel"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Professional Phone</label>
                            <input 
                                type="text"
                                value={agentData.phone_number}
                                onChange={(e) => setAgentData({...agentData, phone_number: e.target.value})}
                                className="w-full bg-background-dark/50 border border-white/5 rounded-2xl px-5 py-4 text-white focus:border-primary/50 outline-none transition-all font-medium"
                                placeholder="+34 000 000 000"
                            />
                        </div>
                        <div className="md:col-span-2 space-y-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Agency Details / About Us</label>
                            <textarea 
                                rows="4"
                                value={agentData.agency_details}
                                onChange={(e) => setAgentData({...agentData, agency_details: e.target.value})}
                                className="w-full bg-background-dark/50 border border-white/5 rounded-2xl px-5 py-4 text-white focus:border-primary/50 outline-none transition-all font-medium resize-none"
                                placeholder="Describe your agency for the quote footer..."
                            />
                        </div>
                    </div>

                    <div className="space-y-6 pt-4 border-t border-white/5">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-white">Default Profit Margin</h3>
                                <p className="text-xs text-slate-500 font-medium">Your global default markup for all new quotes.</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="relative">
                                    <input 
                                        type="number"
                                        value={agentData.markup_percent}
                                        onChange={(e) => setAgentData({...agentData, markup_percent: e.target.value})}
                                        className="w-24 bg-background-dark border border-white/10 rounded-xl px-4 py-3 text-right text-primary font-black outline-none focus:border-primary/50 transition-all"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-primary/40 pointer-events-none">%</span>
                                </div>
                            </div>
                        </div>

                        <button 
                            onClick={handleSave}
                            disabled={saving}
                            className="btn-primary w-full py-5 text-sm font-black uppercase tracking-widest shadow-2xl shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-3"
                        >
                            <span className="material-symbols-outlined text-[20px]">{saving ? 'sync' : 'verified_user'}</span>
                            {saving ? 'UPDATING...' : 'SAVE BRAND SETTINGS'}
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}
