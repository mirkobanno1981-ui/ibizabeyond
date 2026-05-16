import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { extractPalette, suggestPrimaryAccent, readableTextColor } from '../lib/colorExtract';

const DEFAULT_PRIMARY = '#e8ab30';
const DEFAULT_ACCENT = '#e8ab30';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const normalizeHex = (v) => (HEX_RE.test(v || '') ? v.toLowerCase() : null);

export default function AgentSettings() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [agentData, setAgentData] = useState({
        company_name: '',
        agency_details: '',
        phone_number: '',
        markup_percent: 15,
        logo_url: '',
        stripe_account_id: '',
        is_active: true,
        boat_contract_template: '',
        brand_primary_color: '',
        brand_accent_color: '',
        email: ''
    });
    const [palette, setPalette] = useState([]);
    const [extractingPalette, setExtractingPalette] = useState(false);
    const [paletteError, setPaletteError] = useState('');
    const [newEmail, setNewEmail] = useState('');
    const [updatingEmail, setUpdatingEmail] = useState(false);
    const [passwords, setPasswords] = useState({ new: '', confirm: '' });
    const [updatingPassword, setUpdatingPassword] = useState(false);
    const { role, refreshSession } = useAuth();
    const [message, setMessage] = useState({ text: '', type: '' });
    const [uploading, setUploading] = useState(false);
    const [connectingStripe, setConnectingStripe] = useState(false);
    const [stripeCountry, setStripeCountry] = useState('IT');

    useEffect(() => {
        if (user) {
            fetchAgentData();
        }
    }, [user?.id, user?.email]); // Only re-fetch if identity or email actually changes

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
                const defaultTemplate = `# CONTRATTO DI LOCAZIONE TURISTICA ({{agency_name}} ↔ {{client_full_name}})

**1. L'AGENTE / AGENZIA**
- **Nome:** {{agency_name}}
- **Sede:** {{agency_address}}
- **Tax ID:** {{agency_tax_id}}
- **Email:** {{agency_email}} | **Tel:** {{agency_phone}}

**2. IL CONDUTTORE (Ospite)**
- **Nome:** {{client_full_name}}
- **Residenza:** {{client_address}}
- **Documento:** {{client_passport}}
- **Data di nascita:** {{client_dob}}
- **Contatti:** {{client_email}} | {{client_phone}}

### PREMESSO CHE:
L'Agente ha l'autorizzazione a concedere in locazione la Villa **"{{villa_name}}"**, Licenza **{{villa_license}}**. Il Cliente accetta l'infrastruttura di **Ibiza Beyond** per il pagamento.

### ART. 1 - OGGETTO E PERIODO
La Villa si trova in **{{villa_address}}**. 
Periodo: dal **{{check_in}}** al **{{check_out}}**.
Max occupanti: **{{max_guests}}**.

### ART. 2 - PREZZO E PAGAMENTI
Prezzo Totale: **{{final_price}}**.
- **Acconto:** {{deposit_percent}}% al momento della prenotazione.
- **Saldo:** {{balance_percent}}% entro 30 giorni dall'arrivo.

### ART. 3 - DEPOSITO CAUZIONALE
Importo: **{{security_deposit_amount}}**. Sarà sbloccato entro 14 giorni dal check-out previa ispezione.

### ART. 4 - REGOLE E DIVIETI
Vietato organizzare feste o eventi non autorizzati. Rispetto rigoroso dei vicini (22:00-09:00). Penale spazzatura: €150.

### ART. 5 - CANCELLAZIONE
Fino a 60 giorni dall'arrivo: penale del 50%. Successivamente: penale del 100%.

### ART. 6 - RESPONSABILITÀ
La piattaforma Ibiza Beyond agisce come solo fornitore tecnologico e non ha responsabilità operativa sulla Villa.

**Luogo e Data:** Ibiza, lì {{today}}
**Firma per Accettazione:** {{client_full_name}} (Firma Digitale)`;

                setAgentData({
                    id: data.id,
                    company_name: data.company_name || '',
                    agency_details: data.agency_details || '',
                    phone_number: data.phone_number || '',
                    markup_percent: (data.markup_percent !== null && data.markup_percent !== undefined) ? data.markup_percent : 15,
                    logo_url: data.logo_url || '',
                    stripe_account_id: data.stripe_account_id || '',
                    is_active: data.is_active !== false,
                    boat_contract_template: data.boat_contract_template || '',
                    brand_primary_color: data.brand_primary_color || '',
                    brand_accent_color: data.brand_accent_color || '',
                    email: user.email
                });
                setNewEmail(user.email);
            }
        } catch (error) {
            console.error("Error fetching agent settings:", error);
            setMessage({ text: 'Unable to load profile.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleConnectStripe = async () => {
        setConnectingStripe(true);
        setMessage({ text: '', type: '' });
        try {
            const { data, error } = await supabase.functions.invoke('stripe-connect-express', {
                body: { agentId: user.id, country: stripeCountry },
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            if (data?.accountId) {
                setAgentData(prev => ({ ...prev, stripe_account_id: data.accountId }));
            }
            if (data?.onboarded) {
                setMessage({ text: 'Stripe account already onboarded.', type: 'success' });
            } else if (data?.url) {
                window.location.href = data.url;
                return;
            }
        } catch (e) {
            console.error('Stripe connect error:', e);
            setMessage({ text: `Stripe connection failed: ${e.message}`, type: 'error' });
        } finally {
            setConnectingStripe(false);
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
                    markup_percent: (agentData.markup_percent !== null && agentData.markup_percent !== undefined && agentData.markup_percent !== '') ? parseFloat(agentData.markup_percent) : 0,
                    logo_url: agentData.logo_url,
                    stripe_account_id: agentData.stripe_account_id,
                    contract_template: agentData.contract_template,
                    boat_contract_template: agentData.boat_contract_template,
                    brand_primary_color: normalizeHex(agentData.brand_primary_color),
                    brand_accent_color: normalizeHex(agentData.brand_accent_color)
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

            setAgentData((prev) => ({ ...prev, logo_url: publicUrl }));
            setMessage({ text: 'Logo uploaded successfully! Remember to save.', type: 'success' });
            runPaletteExtraction(publicUrl, { applySuggestion: true });
        } catch (error) {
            console.error('Error uploading logo:', error);
            setMessage({ text: 'Error uploading logo. Ensure the storage bucket exists.', type: 'error' });
        } finally {
            setUploading(false);
        }
    };

    const runPaletteExtraction = async (logoUrl, { applySuggestion = false } = {}) => {
        if (!logoUrl) return;
        setExtractingPalette(true);
        setPaletteError('');
        try {
            const colors = await extractPalette(logoUrl, 5);
            setPalette(colors);
            if (applySuggestion && colors.length) {
                const { primary, accent } = suggestPrimaryAccent(colors);
                setAgentData((prev) => ({
                    ...prev,
                    brand_primary_color: primary || prev.brand_primary_color,
                    brand_accent_color: accent || prev.brand_accent_color
                }));
            }
        } catch (err) {
            console.error('Palette extraction failed:', err);
            setPaletteError(err.message || 'Could not read logo colors.');
        } finally {
            setExtractingPalette(false);
        }
    };

    const handleBrandColorChange = (key, value) => {
        setAgentData((prev) => ({ ...prev, [key]: value }));
    };

    const resetBrandColors = () => {
        setAgentData((prev) => ({ ...prev, brand_primary_color: '', brand_accent_color: '' }));
    };

    const handleUpdateEmail = async () => {
        if (!newEmail || newEmail === user.email) return;
        setUpdatingEmail(true);
        setMessage({ text: '', type: '' });
        try {
            const { error } = await supabase.auth.updateUser({ email: newEmail });
            if (error) throw error;
            setMessage({ text: 'Verifica la tua nuova email per confermare il cambio.', type: 'success' });
        } catch (error) {
            console.error('Error updating email:', error);
            setMessage({ text: error.message, type: 'error' });
        } finally {
            setUpdatingEmail(false);
        }
    };

    const handleUpdatePassword = async () => {
        if (!passwords.new || passwords.new !== passwords.confirm) {
            setMessage({ text: 'Passwords do not match or are empty.', type: 'error' });
            return;
        }
        setUpdatingPassword(true);
        setMessage({ text: '', type: '' });
        try {
            const { error } = await supabase.auth.updateUser({ password: passwords.new });
            if (error) throw error;
            setMessage({ text: 'Password aggiornata con successo!', type: 'success' });
            setPasswords({ new: '', confirm: '' });
        } catch (error) {
            console.error('Error updating password:', error);
            setMessage({ text: error.message, type: 'error' });
        } finally {
            setUpdatingPassword(false);
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
                    <div className={`${role === 'super_admin' ? 'bg-purple-600/20' : 'bg-primary/20'} p-2 rounded-xl`}>
                        <span className={`material-symbols-outlined notranslate ${role === 'super_admin' ? 'text-purple-400' : 'text-primary'}`}>{role === 'super_admin' ? 'stars' : 'badge'}</span>
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-text-primary tracking-tight">
                            {role === 'super_admin' ? 'System Management' : 'Agency Branding'}
                        </h1>
                        {role === 'super_admin' && <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest bg-purple-600/10 px-2 py-0.5 rounded-full border border-purple-600/30">Super Admin Access</span>}
                    </div>
                </div>
                <p className="text-text-muted font-medium">
                    {role === 'super_admin' ? 'Control system-wide settings, user accounts and communications.' : 'Customize how your clients see your quotes. No Ibiza Beyond branding will be visible.'}
                </p>
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

            {/* Account Status Alert */}
            <div className={`p-5 rounded-2xl border flex items-center gap-4 ${agentData.is_active !== false ? 'bg-primary/5 border-primary/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
                <div className={`size-10 rounded-full flex items-center justify-center ${agentData.is_active !== false ? 'bg-primary/20 text-primary' : 'bg-amber-500/20 text-amber-500'}`}>
                    <span className="material-symbols-outlined notranslate">
                        {agentData.is_active !== false ? 'verified' : 'pending_actions'}
                    </span>
                </div>
                <div>
                    <h4 className={`text-sm font-bold ${agentData.is_active !== false ? 'text-text-primary' : 'text-amber-500'}`}>
                        Account Status: {agentData.is_active !== false ? 'Active' : 'Pending Activation'}
                    </h4>
                    <p className="text-xs text-text-muted mt-0.5">
                        {agentData.is_active !== false 
                            ? 'Your agency is active. All quotes share your selected branding.' 
                            : 'Your profile data has been received. An administrator will review and activate your account shortly.'}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 items-start">
                {/* Visual Identity Section */}
                <section className="space-y-6">
                    <h3 className="text-xs font-black text-text-muted uppercase tracking-[0.2em]">Visual Identity</h3>
                    <div className="glass-card p-8 text-center space-y-6 flex flex-col items-center">
                        <div className="size-32 rounded-3xl bg-background border-2 border-dashed border-border flex items-center justify-center overflow-hidden relative group">
                            {agentData.logo_url ? (
                                <>
                                    <img src={agentData.logo_url} alt="Agency Logo" className="w-full h-full object-contain p-4" />
                                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                        <span className="text-text-primary text-xs font-bold">Replace</span>
                                    </div>
                                </>
                            ) : (
                                <div className="text-text-muted flex flex-col items-center">
                                    <span className="material-symbols-outlined notranslate text-4xl mb-2">add_photo_alternate</span>
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
                            <p className="text-sm font-bold text-text-primary">Agency Logo</p>
                            <p className="text-[10px] text-text-muted leading-relaxed font-medium">
                                Recommended: Square SVG or transparent PNG.<br/>Used in headers of shared quotes.
                            </p>
                            {uploading && <p className="text-xs text-primary animate-pulse font-bold">Uploading...</p>}
                        </div>
                    </div>

                    <BrandColorsPanel
                        logoUrl={agentData.logo_url}
                        primary={agentData.brand_primary_color}
                        accent={agentData.brand_accent_color}
                        palette={palette}
                        extracting={extractingPalette}
                        error={paletteError}
                        onExtract={() => runPaletteExtraction(agentData.logo_url, { applySuggestion: false })}
                        onChange={handleBrandColorChange}
                        onReset={resetBrandColors}
                    />
                </section>

                {/* Agency Details Section */}
                <section className="lg:col-span-2 space-y-8">
                    <h3 className="text-xs font-black text-text-muted uppercase tracking-[0.2em]">Account & Login</h3>
                    <div className="glass-card p-6 space-y-8">
                        {/* Email Section */}
                        <div className="space-y-4">
                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Login Email</label>
                            <div className="flex gap-3">
                                <div className="flex-1 relative">
                                    <input 
                                        type="email"
                                        value={newEmail}
                                        onChange={(e) => setNewEmail(e.target.value)}
                                        className="w-full bg-background/50 border border-border rounded-2xl px-5 py-4 text-text-primary focus:border-primary/50 outline-none transition-all font-medium"
                                    />
                                    {user.email !== newEmail && (
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                            <span className="text-[9px] font-black text-amber-500 uppercase tracking-tighter bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">Changed</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleUpdateEmail}
                                        disabled={updatingEmail || newEmail === user.email}
                                        className="btn-primary px-6 h-14 disabled:opacity-30 flex items-center gap-2"
                                    >
                                        <span className="material-symbols-outlined notranslate text-[18px]">contact_mail</span>
                                        {updatingEmail ? '...' : 'Update Email'}
                                    </button>
                                    <button
                                        onClick={refreshSession}
                                        className="p-4 bg-surface-2 rounded-2xl hover:bg-surface-3 text-text-muted hover:text-text-primary transition-all border border-border"
                                        title="Sincronizza profilo"
                                    >
                                        <span className="material-symbols-outlined notranslate">sync</span>
                                    </button>
                                </div>
                            </div>
                            <p className="text-[9px] text-text-muted px-1 italic">
                                Current email: <span className="text-text-primary font-bold">{user.email}</span>.
                                Email change requires confirmation.
                            </p>
                        </div>

                        {/* Password Section */}
                        <div className="space-y-4 pt-6 border-t border-border">
                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Account Security</label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <input
                                    type="password"
                                    placeholder="New Password"
                                    value={passwords.new}
                                    onChange={(e) => setPasswords({...passwords, new: e.target.value})}
                                    className="bg-background/50 border border-border rounded-2xl px-5 py-4 text-text-primary focus:border-primary/50 outline-none transition-all font-medium"
                                />
                                <input
                                    type="password"
                                    placeholder="Confirm New Password"
                                    value={passwords.confirm}
                                    onChange={(e) => setPasswords({...passwords, confirm: e.target.value})}
                                    className="bg-background/50 border border-border rounded-2xl px-5 py-4 text-text-primary focus:border-primary/50 outline-none transition-all font-medium"
                                />
                            </div>
                            <button
                                onClick={handleUpdatePassword}
                                disabled={updatingPassword || !passwords.new}
                                className="w-full bg-surface-2 hover:bg-surface-3 text-text-primary border border-border font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-30"
                            >
                                <span className="material-symbols-outlined notranslate text-[20px]">lock_reset</span>
                                {updatingPassword ? 'Updating...' : 'Update Password'}
                            </button>
                        </div>
                    </div>

                    <h3 className="text-xs font-black text-text-muted uppercase tracking-[0.2em]">Agency Information</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Agency Name</label>
                            <input
                                type="text"
                                value={agentData.company_name}
                                onChange={(e) => setAgentData({...agentData, company_name: e.target.value})}
                                className="w-full bg-background/50 border border-border rounded-2xl px-5 py-4 text-text-primary focus:border-primary/50 outline-none transition-all font-medium"
                                placeholder="e.g. Dream Ibiza Travel"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Professional Phone</label>
                            <input
                                type="text"
                                value={agentData.phone_number}
                                onChange={(e) => setAgentData({...agentData, phone_number: e.target.value})}
                                className="w-full bg-background/50 border border-border rounded-2xl px-5 py-4 text-text-primary focus:border-primary/50 outline-none transition-all font-medium"
                                placeholder="+34 000 000 000"
                            />
                        </div>
                        <div className="md:col-span-2 space-y-2">
                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Agency Details / About Us</label>
                            <textarea
                                rows="4"
                                value={agentData.agency_details}
                                onChange={(e) => setAgentData({...agentData, agency_details: e.target.value})}
                                className="w-full bg-background/50 border border-border rounded-2xl px-5 py-4 text-text-primary focus:border-primary/50 outline-none transition-all font-medium resize-none"
                                placeholder="Describe your agency for the quote footer..."
                            />
                        </div>
                    </div>

                    <div className="space-y-6 pt-4 border-t border-border">
                        <div className="bg-surface-2/30 p-8 rounded-3xl border border-border shadow-2xl backdrop-blur-xl">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="size-12 rounded-2xl bg-primary/20 flex items-center justify-center text-primary shadow-lg shadow-primary/10">
                                    <span className="material-symbols-outlined notranslate text-2xl">payments</span>
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-text-primary tracking-tight">Payments</h3>
                                    <p className="text-sm text-text-muted">Configure your payment settings</p>
                                </div>
                            </div>

                            <div className="space-y-5">
                                {agentData.stripe_account_id ? (
                                    <div className="bg-surface-1 border border-border rounded-2xl p-5 space-y-3">
                                        <div className="flex items-center gap-3">
                                            <span className="material-symbols-outlined notranslate text-green-500 text-2xl">check_circle</span>
                                            <div className="flex-1">
                                                <p className="text-sm font-bold text-text-primary">Stripe account linked</p>
                                                <p className="text-xs text-text-muted font-mono">{agentData.stripe_account_id}</p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleConnectStripe}
                                            disabled={connectingStripe}
                                            className="w-full border border-border text-text-primary rounded-xl py-3 text-xs font-black uppercase tracking-widest hover:bg-surface-2 transition-colors disabled:opacity-50"
                                        >
                                            {connectingStripe ? 'Opening Stripe...' : 'Manage / Re-verify account'}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="bg-surface-1 border border-border rounded-2xl p-5 space-y-4">
                                        <div className="flex items-start gap-3">
                                            <span className="material-symbols-outlined notranslate text-primary text-2xl">account_balance_wallet</span>
                                            <div className="flex-1 space-y-1">
                                                <p className="text-sm font-bold text-text-primary">Connect Stripe to receive payments</p>
                                                <p className="text-xs text-text-muted leading-relaxed">Clients pay you directly. Your agency commission stays on your balance; supplier and platform shares are forwarded automatically.</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-col sm:flex-row gap-3">
                                            <select
                                                value={stripeCountry}
                                                onChange={(e) => setStripeCountry(e.target.value)}
                                                className="bg-background border border-border rounded-xl px-4 py-3 text-sm text-text-primary focus:border-primary/50 outline-none"
                                                disabled={connectingStripe}
                                            >
                                                <option value="IT">Italy</option>
                                                <option value="ES">Spain</option>
                                                <option value="FR">France</option>
                                                <option value="DE">Germany</option>
                                                <option value="NL">Netherlands</option>
                                                <option value="BE">Belgium</option>
                                                <option value="PT">Portugal</option>
                                                <option value="AT">Austria</option>
                                                <option value="IE">Ireland</option>
                                                <option value="GB">United Kingdom</option>
                                            </select>
                                            <button
                                                type="button"
                                                onClick={handleConnectStripe}
                                                disabled={connectingStripe}
                                                className="flex-1 bg-primary text-white rounded-xl py-3 px-5 text-xs font-black uppercase tracking-widest hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                            >
                                                {connectingStripe ? (
                                                    <>
                                                        <span className="material-symbols-outlined notranslate animate-spin text-[18px]">sync</span>
                                                        Redirecting...
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="material-symbols-outlined notranslate text-[18px]">link</span>
                                                        Connect with Stripe
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* The original Stripe Account ID input is now replaced by the one in the new section */}
                        {/* <div className="md:col-span-2 space-y-2">
                            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Stripe Connect Account ID</label>
                            <input
                                type="text"
                                value={agentData.stripe_account_id}
                                onChange={(e) => setAgentData({...agentData, stripe_account_id: e.target.value})}
                                className="w-full bg-background/50 border border-border rounded-2xl px-5 py-4 text-text-primary focus:border-primary/50 outline-none transition-all font-medium"
                                placeholder="acct_xxxxxxxxxxxxxx"
                            />
                            <p className="text-[10px] text-text-muted font-medium px-1">Automated payouts are split between the villa, Ibiza Beyond, and your agency.</p>
                        </div> */}

                        <button 
                            onClick={handleSave}
                            disabled={saving}
                            className="btn-primary w-full py-5 text-sm font-black uppercase tracking-widest shadow-2xl shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-3"
                        >
                            <span className="material-symbols-outlined notranslate text-[20px]">{saving ? 'sync' : 'verified_user'}</span>
                            {saving ? 'UPDATING...' : 'SAVE BRAND SETTINGS'}
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}

function BrandColorsPanel({ logoUrl, primary, accent, palette, extracting, error, onExtract, onChange, onReset }) {
    const effectivePrimary = primary || DEFAULT_PRIMARY;
    const effectiveAccent = accent || DEFAULT_ACCENT;
    const primaryText = readableTextColor(effectivePrimary);
    const accentText = readableTextColor(effectiveAccent);

    return (
        <div className="glass-card p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-bold text-text-primary">Brand Colors</p>
                    <p className="text-[10px] text-text-muted leading-relaxed font-medium">
                        Applied to your dashboard and to client quote pages.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onExtract}
                    disabled={!logoUrl || extracting}
                    className="text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-xl border border-border hover:bg-surface-2 disabled:opacity-40"
                    title={logoUrl ? 'Read colors from the uploaded logo' : 'Upload a logo first'}
                >
                    {extracting ? 'Reading…' : 'Generate from logo'}
                </button>
            </div>

            {error && <p className="text-[11px] text-red-400 font-medium">{error}</p>}

            <div className="grid grid-cols-2 gap-3">
                <ColorField
                    label="Primary"
                    value={effectivePrimary}
                    hasValue={!!primary}
                    onChange={(v) => onChange('brand_primary_color', v)}
                />
                <ColorField
                    label="Accent"
                    value={effectiveAccent}
                    hasValue={!!accent}
                    onChange={(v) => onChange('brand_accent_color', v)}
                />
            </div>

            {palette.length > 0 && (
                <div className="space-y-2">
                    <p className="text-[10px] font-black text-text-muted uppercase tracking-widest">Suggested from logo</p>
                    <div className="flex flex-wrap gap-2">
                        {palette.map((hex) => (
                            <div key={hex} className="flex items-center gap-1 bg-background/40 border border-border rounded-xl p-1">
                                <span className="size-6 rounded-md border border-border" style={{ backgroundColor: hex }} />
                                <button
                                    type="button"
                                    onClick={() => onChange('brand_primary_color', hex)}
                                    className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md hover:bg-surface-2"
                                >
                                    P
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onChange('brand_accent_color', hex)}
                                    className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md hover:bg-surface-2"
                                >
                                    A
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="pt-3 border-t border-border space-y-2">
                <p className="text-[10px] font-black text-text-muted uppercase tracking-widest">Preview</p>
                <div className="flex items-center gap-2">
                    <span
                        className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest"
                        style={{ backgroundColor: effectivePrimary, color: primaryText }}
                    >
                        Primary button
                    </span>
                    <span
                        className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest"
                        style={{ backgroundColor: effectiveAccent, color: accentText }}
                    >
                        Accent
                    </span>
                </div>
            </div>

            {(primary || accent) && (
                <button
                    type="button"
                    onClick={onReset}
                    className="text-[10px] font-bold text-text-muted hover:text-text-primary underline"
                >
                    Reset to platform defaults
                </button>
            )}
        </div>
    );
}

function ColorField({ label, value, hasValue, onChange }) {
    const handle = (v) => {
        if (!v) {
            onChange('');
            return;
        }
        if (HEX_RE.test(v)) onChange(v.toLowerCase());
        else onChange(v);
    };
    return (
        <div className="space-y-2">
            <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">{label}</label>
            <div className="flex items-center gap-2">
                <input
                    type="color"
                    value={value}
                    onChange={(e) => handle(e.target.value)}
                    className="size-12 rounded-xl border border-border bg-transparent cursor-pointer"
                />
                <input
                    type="text"
                    value={hasValue ? value : ''}
                    onChange={(e) => handle(e.target.value)}
                    placeholder={value}
                    className="flex-1 bg-background/50 border border-border rounded-2xl px-3 py-3 text-[12px] text-text-primary focus:border-primary/50 outline-none font-mono"
                    maxLength={7}
                />
            </div>
        </div>
    );
}
