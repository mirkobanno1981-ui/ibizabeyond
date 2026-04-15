import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function OwnersPage() {
    const { user, role, loading: authLoading } = useAuth();
    const [owners, setOwners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(null);
    const [message, setMessage] = useState(null);
    const [editOwner, setEditOwner] = useState(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [newOwner, setNewOwner] = useState({ name: '', email: '', password: '', company_name: '', logo_url: '', phone_number: '', stripe_account_id: '' });
    const [newPassword, setNewPassword] = useState('');
    const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

    useEffect(() => {
        if (!authLoading && (role === 'admin' || role === 'super_admin')) {
            fetchAll();
        } else if (!authLoading) {
            setLoading(false);
        }
    }, [role, authLoading]);

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
                    <p className="text-text-muted text-sm">Access is restricted.</p>
                </div>
            </div>
        );
    }

    async function fetchAll() {
        setLoading(true);
        try {
            let query = supabase.from('owners').select('*');
            
            if (role === 'agent') {
                // First get the agent profile id
                const { data: agentData } = await supabase
                    .from('agents')
                    .select('id')
                    .eq('user_id', user.id)
                    .single();
                
                if (agentData) {
                    query = query.eq('agent_id', agentData.id);
                } else {
                    // If agent profile not found, return empty
                    setOwners([]);
                    return;
                }
            }

            const { data, error } = await query.order('name');

            if (error) throw error;
            setOwners(data || []);
        } catch (err) {
            console.error("Owners fetch exception:", err);
            setMessage({ type: 'error', text: 'Error fetching owners.' });
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateOwner(e) {
        e.preventDefault();
        setSaving('create');
        setMessage(null);

        try {
            const { data: { publicUrl } } = supabase.storage.from('agent-logos').getPublicUrl('dummy');
            const supabaseUrl = publicUrl.split('/storage/v1')[0];
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

            // We use a temporary client to avoid hijacking the current admin's session
            const { createClient } = await import('@supabase/supabase-js');
            const tempSupabase = createClient(supabaseUrl, supabaseKey, {
                auth: { persistSession: false }
            });

            // 1. Create Auth User
            const { data: authData, error: authError } = await tempSupabase.auth.signUp({
                email: newOwner.email,
                password: newOwner.password,
                options: {
                    data: {
                        name: newOwner.name,
                        role: 'owner'
                    }
                }
            });

            if (authError) throw authError;
            if (!authData.user) throw new Error("Failed to create user account.");

            const newId = authData.user.id;

            // 2. Create User Role (as admin, using main client)
            const { error: roleErr } = await supabase
                .from('user_roles')
                .insert([{ user_id: newId, role: 'owner' }]);
            
            if (roleErr) throw roleErr;

            // 3. Create Owner Profile
            let agentIdToLink = null;
            if (role === 'agent') {
                const { data: agentData } = await supabase
                    .from('agents')
                    .select('id')
                    .eq('user_id', user.id)
                    .single();
                agentIdToLink = agentData?.id;
            }

            const { error: profileErr } = await supabase
                .from('owners')
                .insert([{
                    id: newId,
                    name: newOwner.name,
                    email: newOwner.email,
                    company_name: newOwner.company_name,
                    logo_url: newOwner.logo_url,
                    phone_number: newOwner.phone_number,
                    stripe_account_id: newOwner.stripe_account_id,
                    agent_id: agentIdToLink,
                    is_active: true
                }]);

            if (profileErr) throw profileErr;

            setMessage({ type: 'success', text: 'Owner created successfully! A confirmation email has been sent.' });
            setShowAddModal(false);
            setNewOwner({ name: '', email: '', password: '', company_name: '', logo_url: '', phone_number: '', stripe_account_id: '' });
            fetchAll();
        } catch (err) {
            console.error("Creation error:", err);
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(null);
        }
    }

    async function handleUpdateOwner(e) {
        e.preventDefault();
        setSaving('edit');
        try {
            const { error } = await supabase
                .from('owners')
                .update({
                    name: editOwner.name,
                    email: editOwner.email,
                    company_name: editOwner.company_name,
                    logo_url: editOwner.logo_url,
                    phone_number: editOwner.phone_number,
                    stripe_account_id: editOwner.stripe_account_id,
                    is_active: editOwner.is_active ?? true
                })
                .eq('id', editOwner.id);

            if (error) throw error;

            setMessage({ type: 'success', text: 'Owner updated successfully!' });
            setEditOwner(null);
            fetchAll();
            setTimeout(() => setMessage(null), 3000);
        } catch (err) {
            console.error("Update error:", err);
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(null);
        }
    }

    async function handleSetPassword(ownerId) {
        if (!newPassword || newPassword.length < 6) {
            setMessage({ type: 'error', text: 'Password must be at least 6 characters.' });
            return;
        }

        setIsUpdatingPassword(true);
        try {
            const { error: invokeErr } = await supabase.functions.invoke('admin-set-password', {
                body: { userId: ownerId, newPassword }
            });

            if (invokeErr) throw invokeErr;

            setMessage({ type: 'success', text: 'Password updated successfully!' });
            setNewPassword('');
            setTimeout(() => setMessage(null), 3000);
        } catch (err) {
            console.error("Password update error:", err);
            setMessage({ type: 'error', text: err.message });
        } finally {
            setIsUpdatingPassword(false);
        }
    }

    return (
        <div className="p-6 md:p-8 space-y-8 animate-in fade-in duration-500">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary uppercase tracking-tight">Owner Management</h1>
                    <p className="text-text-muted text-sm mt-0.5">Manage property owners and their payment settings</p>
                </div>
                {(role === 'admin' || role === 'super_admin' || role === 'agent') && (
                    <button 
                        onClick={() => setShowAddModal(true)}
                        className="btn-primary text-sm flex items-center gap-2"
                    >
                        <span className="material-symbols-outlined notranslate text-[18px]">person_add</span>
                        {role === 'agent' ? 'Add New Contact' : 'Create New Owner'}
                    </button>
                )}
            </div>

            {/* Message Bar */}
            {message && (
                <div className={`p-4 rounded-xl border animate-in slide-in-from-top-2 ${message.type === 'success' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                    <div className="flex items-center gap-2 text-sm font-bold">
                        <span className="material-symbols-outlined notranslate text-[18px]">{message.type === 'success' ? 'check_circle' : 'error'}</span>
                        {message.text}
                    </div>
                </div>
            )}

            {/* Owners Table */}
            <div className="glass-card overflow-hidden border-border/50">
                <div className="p-5 border-b border-border flex items-center justify-between bg-surface-2/30">
                    <h2 className="font-bold text-text-primary flex items-center gap-2">
                        <span className="material-symbols-outlined notranslate text-primary text-[20px]">groups</span>
                        Registered Owners
                    </h2>
                    <span className="text-[10px] bg-primary/20 px-2 py-1 rounded-full text-primary font-black uppercase tracking-widest">{owners.length} Total</span>
                </div>

                <div className="divide-y divide-border/30">
                    {loading ? (
                        <div className="p-10 text-center">
                            <div className="animate-spin size-6 border-2 border-primary border-t-transparent rounded-full mx-auto md-4"></div>
                            <p className="text-xs text-text-muted mt-2 font-medium">Fetching owners...</p>
                        </div>
                    ) : (
                        owners.map(owner => (
                            <div key={owner.id} className="flex items-center gap-4 p-5 hover:bg-primary/5 transition-all group">
                                <div className="size-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                                    <span className="material-symbols-outlined notranslate">person</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-bold text-text-primary text-base">{owner.name || 'Unnamed Owner'}</span>
                                        <div className="flex gap-1.5 font-black uppercase text-[9px] tracking-widest">
                                            {owner.is_active !== false ? (
                                                <span className="px-2 py-0.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-full">Active</span>
                                            ) : (
                                                <span className="px-2 py-0.5 bg-red-500 text-text-primary rounded-full">Suspended</span>
                                            )}
                                            {owner.stripe_account_id ? (
                                                <span className="px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded-full">Stripe Linked</span>
                                            ) : (
                                                <span className="px-2 py-0.5 bg-surface-2 text-text-muted border border-border rounded-full">No Stripe</span>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-[11px] text-text-muted truncate mt-0.5 font-medium">{owner.email || 'No email provided'} {owner.phone_number && `· ${owner.phone_number}`}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => setEditOwner({ ...owner })}
                                        className="p-2.5 rounded-xl bg-surface-2 border border-border text-text-muted hover:text-primary hover:border-primary/50 transition-all flex items-center justify-center"
                                    >
                                        <span className="material-symbols-outlined notranslate text-[20px]">edit</span>
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                    {!loading && owners.length === 0 && (
                        <div className="p-16 text-center">
                            <span className="material-symbols-outlined notranslate text-text-muted text-4xl mb-4">search_off</span>
                            <p className="text-text-muted text-sm italic font-medium">No owners found in the system.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Edit Modal */}
            {editOwner && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-surface border border-border rounded-3xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                        <div className="p-6 border-b border-border flex items-center justify-between bg-surface-2/20">
                            <div>
                                <h2 className="text-xl font-bold text-text-primary tracking-tight">Edit Owner</h2>
                                <p className="text-[10px] text-text-muted uppercase font-black tracking-widest mt-0.5">Modify owner profile & settings</p>
                            </div>
                            <button onClick={() => setEditOwner(null)} className="size-10 rounded-xl bg-surface-2 border border-border text-text-muted hover:text-text-primary flex items-center justify-center transition-all">
                                <span className="material-symbols-outlined notranslate">close</span>
                            </button>
                        </div>

                        <form onSubmit={handleUpdateOwner} className="p-8 space-y-6 overflow-y-auto">
                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Owner Name</label>
                                    <input 
                                        className="input-theme w-full h-12" 
                                        value={editOwner.name || ''} 
                                        onChange={e => setEditOwner({...editOwner, name: e.target.value})} 
                                        placeholder="Full name or company"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Email Address</label>
                                    <input 
                                        className="input-theme w-full h-12" 
                                        value={editOwner.email || ''} 
                                        onChange={e => setEditOwner({...editOwner, email: e.target.value})} 
                                        placeholder="owner@example.com"
                                    />
                                </div>
                                 <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Company Name (Branding)</label>
                                    <input 
                                        className="input-theme w-full h-12" 
                                        value={editOwner.company_name || ''} 
                                        onChange={e => setEditOwner({...editOwner, company_name: e.target.value})} 
                                        placeholder="e.g. Invenio Luxury Villas"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">WhatsApp / Phone Number</label>
                                    <input 
                                        className="input-theme w-full h-12" 
                                        value={editOwner.phone_number || ''} 
                                        onChange={e => setEditOwner({...editOwner, phone_number: e.target.value})} 
                                        placeholder="+34 600 000 000"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Logo URL (Transparent PNG)</label>
                                    <input 
                                        className="input-theme w-full h-12 text-xs" 
                                        value={editOwner.logo_url || ''} 
                                        onChange={e => setEditOwner({...editOwner, logo_url: e.target.value})} 
                                        placeholder="https://..."
                                    />
                                </div>
                                {role === 'super_admin' && (
                                     <div className="space-y-1.5">
                                         <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Stripe Account ID (Payouts)</label>
                                         <input 
                                             className="input-theme w-full h-12 font-mono text-xs" 
                                             value={editOwner.stripe_account_id || ''} 
                                             onChange={e => setEditOwner({...editOwner, stripe_account_id: e.target.value})} 
                                             placeholder="acct_xxxxxxxxxxxxxx"
                                         />
                                     </div>
                                 )}
                                {role === 'super_admin' && (
                                    <div className="pt-4 border-t border-border mt-6">
                                        <h3 className="text-xs font-black text-text-muted uppercase tracking-[0.2em] mb-4">Security Settings</h3>
                                        <div className="space-y-3 p-4 bg-background/50 rounded-2xl border border-border">
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Set New User Password</label>
                                                <div className="flex gap-2">
                                                    <input 
                                                        type="password"
                                                        className="input-theme flex-1 h-11" 
                                                        value={newPassword} 
                                                        onChange={e => setNewPassword(e.target.value)} 
                                                        placeholder="Minimum 6 characters"
                                                    />
                                                    <button 
                                                        type="button"
                                                        onClick={() => handleSetPassword(editOwner.id)}
                                                        disabled={isUpdatingPassword || !newPassword}
                                                        className={`px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isUpdatingPassword ? 'bg-surface-2 text-text-muted cursor-not-allowed' : 'bg-white/10 text-text-primary hover:bg-white/20'}`}
                                                    >
                                                        {isUpdatingPassword ? 'Updating...' : 'Set Password'}
                                                    </button>
                                                </div>
                                                <p className="text-[8px] text-text-muted mt-1 uppercase font-bold px-1">This will immediately overwrite the current owner password.</p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="p-4 bg-surface-2/50 rounded-2xl border border-border flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${editOwner.is_active !== false ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                        <span className="material-symbols-outlined notranslate text-[18px]">
                                            {editOwner.is_active !== false ? 'check_circle' : 'block'}
                                        </span>
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-text-primary">Active Account</p>
                                        <p className="text-[10px] text-text-muted uppercase font-black tracking-tighter">
                                            {editOwner.is_active !== false ? 'Currently accessible' : 'Suspended access'}
                                        </p>
                                    </div>
                                </div>
                                <input 
                                    type="checkbox" 
                                    checked={editOwner.is_active !== false} 
                                    onChange={e => setEditOwner({...editOwner, is_active: e.target.checked})} 
                                    className="size-5 accent-primary cursor-pointer" 
                                />
                            </div>

                            <div className="pt-4">
                                <button type="submit" disabled={saving === 'edit'} className="btn-primary w-full h-14 font-black uppercase tracking-[0.2em] shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3">
                                    <span className="material-symbols-outlined notranslate text-[20px]">{saving === 'edit' ? 'sync' : 'save'}</span>
                                    {saving === 'edit' ? 'Updating...' : 'Save Changes'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* Add Owner Modal */}
            {showAddModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-surface border border-border rounded-3xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                        <div className="p-6 border-b border-border flex items-center justify-between bg-surface-2/20">
                            <div>
                                <h2 className="text-xl font-bold text-text-primary tracking-tight">Register New Owner</h2>
                                <p className="text-[10px] text-text-muted uppercase font-black tracking-widest mt-0.5">Create account & profile</p>
                            </div>
                            <button onClick={() => setShowAddModal(false)} className="size-10 rounded-xl bg-surface-2 border border-border text-text-muted hover:text-text-primary flex items-center justify-center transition-all">
                                <span className="material-symbols-outlined notranslate">close</span>
                            </button>
                        </div>

                        <form onSubmit={handleCreateOwner} className="p-8 space-y-6 overflow-y-auto">
                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Owner Name</label>
                                    <input 
                                        required
                                        className="input-theme w-full h-12" 
                                        value={newOwner.name} 
                                        onChange={e => setNewOwner({...newOwner, name: e.target.value})} 
                                        placeholder="Full name or company name"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Email Address</label>
                                    <input 
                                        required
                                        type="email"
                                        className="input-theme w-full h-12" 
                                        value={newOwner.email} 
                                        onChange={e => setNewOwner({...newOwner, email: e.target.value})} 
                                        placeholder="owner@example.com"
                                    />
                                </div>
                                 <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Company Name</label>
                                    <input 
                                        className="input-theme w-full h-12" 
                                        value={newOwner.company_name} 
                                        onChange={e => setNewOwner({...newOwner, company_name: e.target.value})} 
                                        placeholder="e.g. Invenio Management"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">WhatsApp / Phone Number</label>
                                    <input 
                                        className="input-theme w-full h-12" 
                                        value={newOwner.phone_number} 
                                        onChange={e => setNewOwner({...newOwner, phone_number: e.target.value})} 
                                        placeholder="+34 600 000 000"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Logo URL</label>
                                    <input 
                                        className="input-theme w-full h-12 text-xs" 
                                        value={newOwner.logo_url} 
                                        onChange={e => setNewOwner({...newOwner, logo_url: e.target.value})} 
                                        placeholder="https://..."
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Set Password</label>
                                    <input 
                                        required
                                        type="password"
                                        minLength={6}
                                        className="input-theme w-full h-12" 
                                        value={newOwner.password} 
                                        onChange={e => setNewOwner({...newOwner, password: e.target.value})} 
                                        placeholder="Minimum 6 characters"
                                    />
                                </div>
                                {role === 'super_admin' && (
                                     <div className="space-y-1.5">
                                         <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Stripe Account ID (Optional)</label>
                                         <input 
                                             className="input-theme w-full h-12 font-mono text-xs" 
                                             value={newOwner.stripe_account_id || ''} 
                                             onChange={e => setNewOwner({...newOwner, stripe_account_id: e.target.value})} 
                                             placeholder="acct_xxxxxxxxxxxxxx"
                                         />
                                     </div>
                                 )}
                            </div>

                            <div className="p-4 bg-primary/10 rounded-2xl border border-primary/20 flex items-start gap-3">
                                <span className="material-symbols-outlined notranslate text-primary text-[20px]">info</span>
                                <p className="text-[10px] text-text-primary leading-relaxed">
                                    This will create a new login account. The owner will receive a confirmation email to verify their address.
                                </p>
                            </div>

                            <div className="pt-4">
                                <button type="submit" disabled={saving === 'create'} className="btn-primary w-full h-14 font-black uppercase tracking-[0.2em] shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3">
                                    <span className="material-symbols-outlined notranslate text-[20px]">{saving === 'create' ? 'sync' : 'person_add'}</span>
                                    {saving === 'create' ? 'Creating Account...' : 'Create Owner'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
