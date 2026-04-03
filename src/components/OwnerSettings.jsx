import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function OwnerSettings() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [ownerData, setOwnerData] = useState({
        name: '',
        email: '',
        phone_number: '',
        stripe_account_id: '',
        is_active: true,
        ses_user: '',
        ses_password: ''
    });
    const [message, setMessage] = useState({ text: '', type: '' });

    useEffect(() => {
        if (user) fetchOwnerData();
    }, [user]);

    const fetchOwnerData = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('owners')
                .select('*')
                .eq('id', user.id)
                .maybeSingle();

            if (error) throw error;
            if (data) {
                setOwnerData({
                    name: data.name || '',
                    email: data.email || '',
                    phone_number: data.phone_number || '',
                    stripe_account_id: data.stripe_account_id || '',
                    is_active: data.is_active !== false,
                    ses_user: data.ses_user || '',
                    ses_password: data.ses_password || ''
                });
            } else {
                // If no owner profile exists yet, pre-fill with user email
                setOwnerData(prev => ({ ...prev, email: user.email }));
            }
        } catch (error) {
            console.error("Error fetching owner settings:", error);
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
                .from('owners')
                .upsert({
                    id: user.id,
                    name: ownerData.name,
                    email: ownerData.email,
                    phone_number: ownerData.phone_number,
                    stripe_account_id: ownerData.stripe_account_id,
                    ses_user: ownerData.ses_user,
                    ses_password: ownerData.ses_password
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

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
                <div className="size-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                <p className="text-text-muted text-sm font-medium">Loading your profile...</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto p-6 md:p-12 space-y-12">
            <header className="space-y-2">
                <div className="flex items-center gap-3">
                    <div className="bg-primary/20 p-2 rounded-xl">
                        <span className="material-symbols-outlined notranslate text-primary">person</span>
                    </div>
                    <h1 className="text-3xl font-black text-text-primary tracking-tight">Owner Profile</h1>
                </div>
                <p className="text-text-muted font-medium">Manage your personal information and payment settings.</p>
            </header>

            {message.text && (
                <div className={`p-4 rounded-2xl border animate-in fade-in slide-in-from-top-4 duration-300 ${
                    message.type === 'success' 
                    ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                    : 'bg-red-500/10 border-red-500/20 text-red-400'
                }`}>
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined notranslate text-sm">
                            {message.type === 'success' ? 'check_circle' : 'error'}
                        </span>
                        <p className="text-sm font-bold">{message.text}</p>
                    </div>
                </div>
            )}

            <div className={`p-5 rounded-2xl border flex items-center gap-4 ${ownerData.is_active !== false ? 'bg-primary/5 border-primary/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
                <div className={`size-10 rounded-full flex items-center justify-center ${ownerData.is_active !== false ? 'bg-primary/20 text-primary' : 'bg-amber-500/20 text-amber-500'}`}>
                    <span className="material-symbols-outlined notranslate">
                        {ownerData.is_active !== false ? 'verified' : 'pending_actions'}
                    </span>
                </div>
                <div>
                    <h4 className={`text-sm font-bold ${ownerData.is_active !== false ? 'text-text-primary' : 'text-amber-500'}`}>
                        Account Status: {ownerData.is_active !== false ? 'Active' : 'Pending Activation'}
                    </h4>
                    <p className="text-xs text-text-muted mt-0.5">
                        {ownerData.is_active !== false 
                            ? 'Your owner profile is active and verified.' 
                            : 'Your account is under review by administrator.'}
                    </p>
                </div>
            </div>

            <section className="space-y-8">
                <h3 className="text-xs font-black text-text-muted uppercase tracking-[0.2em]">Contact Information</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Full Name / Company</label>
                        <input 
                            type="text"
                            value={ownerData.name}
                            onChange={(e) => setOwnerData({...ownerData, name: e.target.value})}
                            className="w-full bg-background/50 border border-border rounded-2xl px-5 py-4 text-text-primary focus:border-primary/50 outline-none transition-all font-medium"
                            placeholder="e.g. Mario Rossi"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Email Address</label>
                        <input 
                            type="email"
                            value={ownerData.email}
                            onChange={(e) => setOwnerData({...ownerData, email: e.target.value})}
                            className="w-full bg-background/50 border border-border rounded-2xl px-5 py-4 text-text-primary focus:border-primary/50 outline-none transition-all font-medium"
                            placeholder="owner@example.com"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">WhatsApp / Phone Number</label>
                        <input 
                            type="text"
                            value={ownerData.phone_number}
                            onChange={(e) => setOwnerData({...ownerData, phone_number: e.target.value})}
                            className="w-full bg-background/50 border border-border rounded-2xl px-5 py-4 text-text-primary focus:border-primary/50 outline-none transition-all font-medium"
                            placeholder="+34 600 000 000"
                        />
                    </div>
                </div>

                <div className="space-y-6 pt-4 border-t border-border">
                    <h3 className="text-xs font-black text-text-muted uppercase tracking-[0.2em]">Payment Settings</h3>
                    
                    <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 space-y-4">
                        <div className="flex items-start gap-4">
                            <span className="material-symbols-outlined notranslate text-primary text-2xl">payments</span>
                            <div className="space-y-3">
                                <p className="text-xs font-bold text-text-primary uppercase tracking-wider">Stripe Connect:</p>
                                <p className="text-[11px] text-text-muted leading-relaxed">
                                    Provide your Stripe Account ID to receive payments directly when a villa booking is confirmed. 
                                    You can find your ID in the Stripe Dashboard under Settings &gt; Account Details.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Stripe Account ID</label>
                        <input 
                            type="text"
                            value={ownerData.stripe_account_id}
                            onChange={(e) => setOwnerData({...ownerData, stripe_account_id: e.target.value})}
                            className="w-full bg-background/50 border border-border rounded-2xl px-5 py-4 text-text-primary focus:border-primary/50 outline-none transition-all font-medium"
                            placeholder="acct_xxxxxxxxxxxxxx"
                        />
                    </div>

                    <div className="space-y-6 pt-6 border-t border-border">
                        <div className="flex items-center gap-3">
                            <div className="bg-amber-500/20 p-2 rounded-xl">
                                <span className="material-symbols-outlined notranslate text-amber-500">key</span>
                            </div>
                            <h3 className="text-xs font-black text-text-muted uppercase tracking-[0.2em]">SES.HOSPEDAJES Configuration</h3>
                        </div>
                        
                        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-6 space-y-4">
                            <div className="flex items-start gap-4">
                                <span className="material-symbols-outlined notranslate text-amber-500 text-2xl">shield_person</span>
                                <div className="space-y-3">
                                    <p className="text-xs font-bold text-text-primary uppercase tracking-wider">RD 933/2021 Compliance:</p>
                                    <p className="text-[11px] text-text-muted leading-relaxed">
                                        Enter your credentials for the Ministry of Interior's portal to enable automated traveler data submission. 
                                        These credentials will be used for all your properties.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">SES Username</label>
                                <input 
                                    type="text"
                                    value={ownerData.ses_user}
                                    onChange={(e) => setOwnerData({...ownerData, ses_user: e.target.value})}
                                    className="w-full bg-background/50 border border-border rounded-2xl px-5 py-4 text-text-primary focus:border-primary/50 outline-none transition-all font-medium"
                                    placeholder="Enter your SES username"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">SES Password</label>
                                <input 
                                    type="password"
                                    value={ownerData.ses_password}
                                    onChange={(e) => setOwnerData({...ownerData, ses_password: e.target.value})}
                                    className="w-full bg-background/50 border border-border rounded-2xl px-5 py-4 text-text-primary focus:border-primary/50 outline-none transition-all font-medium"
                                    placeholder="••••••••••••"
                                />
                            </div>
                        </div>
                    </div>

                    <button 
                        onClick={handleSave}
                        disabled={saving}
                        className="btn-primary w-full py-5 text-sm font-black uppercase tracking-widest shadow-2xl shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-3"
                    >
                        <span className="material-symbols-outlined notranslate text-[20px]">{saving ? 'sync' : 'save'}</span>
                        {saving ? 'UPDATING...' : 'SAVE SETTINGS'}
                    </button>
                </div>
            </section>
        </div>
    );
}
