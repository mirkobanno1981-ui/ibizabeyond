import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const SUPPORTED_COUNTRIES = [
    { code: 'IT', label: 'Italy' },
    { code: 'ES', label: 'Spain' },
    { code: 'FR', label: 'France' },
    { code: 'DE', label: 'Germany' },
    { code: 'NL', label: 'Netherlands' },
    { code: 'BE', label: 'Belgium' },
    { code: 'PT', label: 'Portugal' },
    { code: 'AT', label: 'Austria' },
    { code: 'IE', label: 'Ireland' },
    { code: 'GB', label: 'United Kingdom' },
];

export default function PendingApproval() {
    const { signOut, user, agentData } = useAuth();
    const navigate = useNavigate();
    const [agentRow, setAgentRow] = useState(agentData || null);
    const [loadingAgent, setLoadingAgent] = useState(!agentData);
    const [country, setCountry] = useState('IT');
    const [connecting, setConnecting] = useState(false);
    const [stripeError, setStripeError] = useState(null);

    useEffect(() => {
        if (agentData) {
            setAgentRow(agentData);
            setLoadingAgent(false);
            return;
        }
        if (!user?.id) return;
        let cancelled = false;
        (async () => {
            const { data } = await supabase
                .from('agents')
                .select('id, stripe_account_id')
                .eq('id', user.id)
                .maybeSingle();
            if (!cancelled) {
                setAgentRow(data);
                setLoadingAgent(false);
            }
        })();
        return () => { cancelled = true; };
    }, [user?.id, agentData]);

    const handleSignOut = async () => {
        await signOut();
        navigate('/login');
    };

    const handleConnectStripe = async () => {
        if (!agentRow?.id) {
            setStripeError('Confirm your email first, then refresh this page.');
            return;
        }
        setConnecting(true);
        setStripeError(null);
        try {
            const { data, error } = await supabase.functions.invoke('stripe-connect-express', {
                body: { agentId: agentRow.id, accountId: agentRow.id, accountType: 'agent', country },
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            if (data?.accountId) {
                setAgentRow(prev => prev ? { ...prev, stripe_account_id: data.accountId } : prev);
            }
            if (data?.url) {
                window.open(data.url, '_blank', 'noopener');
            }
        } catch (e) {
            console.error('Stripe connect error:', e);
            setStripeError(e.message || 'Stripe onboarding failed.');
        } finally {
            setConnecting(false);
        }
    };

    const stripeConnected = !!agentRow?.stripe_account_id;

    return (
        <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background p-6 text-center font-display">
            <div className="relative mb-8">
                <div className="size-24 rounded-full bg-primary/10 flex items-center justify-center text-primary animate-pulse">
                    <span className="material-symbols-outlined notranslate text-5xl notranslate">hourglass_empty</span>
                </div>
                <div className="absolute -top-1 -right-1 size-8 rounded-full bg-background border-4 border-background flex items-center justify-center">
                    <span className="material-symbols-outlined notranslate text-primary text-sm notranslate animate-spin">sync</span>
                </div>
            </div>

            <h1 className="text-3xl md:text-4xl font-black text-text-primary mb-4 uppercase tracking-tighter max-w-md leading-tight">
                Account Pending <span className="text-primary italic font-serif lowercase tracking-normal">approval</span>
            </h1>

            <p className="text-text-secondary max-w-md mb-8 text-lg leading-relaxed">
                Thank you for joining <span className="text-text-primary font-bold">Ibiza Beyond</span>.
                Your agent account has been successfully registered and is currently being reviewed by our administration.
            </p>

            <div className="bg-surface-2/50 backdrop-blur-sm border border-border p-6 rounded-2xl max-w-md mb-6 text-left">
                <div className="flex items-start gap-3 mb-4">
                    <span className="material-symbols-outlined notranslate text-primary notranslate">info</span>
                    <div>
                        <p className="text-sm font-bold text-text-primary uppercase tracking-wider mb-1">What's Next?</p>
                        <p className="text-xs text-text-muted">An administrator will review your profile shortly. You will receive an email notification once your access is activated.</p>
                    </div>
                </div>
                <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined notranslate text-primary notranslate">mail</span>
                    <div>
                        <p className="text-sm font-bold text-text-primary uppercase tracking-wider mb-1">Contact Support</p>
                        <p className="text-xs text-text-muted">If you have been waiting for more than 24 hours, please contact us at <a href="mailto:info@ibizabeyond.com" className="text-primary hover:underline">info@ibizabeyond.com</a></p>
                    </div>
                </div>
            </div>

            <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 max-w-md w-full mb-8 text-left">
                <div className="flex items-start gap-3 mb-4">
                    <span className="material-symbols-outlined notranslate text-primary">payments</span>
                    <div>
                        <p className="text-sm font-bold text-text-primary uppercase tracking-wider mb-1">Setup Stripe payouts</p>
                        <p className="text-xs text-text-muted">Complete onboarding now so you can receive bookings the moment your account is approved.</p>
                    </div>
                </div>

                {loadingAgent ? (
                    <p className="text-[11px] text-text-muted italic">Loading account...</p>
                ) : !agentRow?.id ? (
                    <p className="text-[11px] text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                        Confirm your email first, then refresh this page to start Stripe onboarding.
                    </p>
                ) : stripeConnected ? (
                    <div className="space-y-2">
                        <p className="text-[11px] text-emerald-400 font-bold flex items-center gap-2">
                            <span className="material-symbols-outlined notranslate text-sm">check_circle</span>
                            Stripe linked
                        </p>
                        <button
                            type="button"
                            onClick={handleConnectStripe}
                            disabled={connecting}
                            className="w-full border border-border text-text-primary rounded-xl py-2.5 text-[10px] font-black uppercase tracking-widest hover:bg-surface-2 transition-colors disabled:opacity-50"
                        >
                            {connecting ? 'Opening Stripe...' : 'Continue / Re-verify'}
                        </button>
                        <p className="text-[10px] text-text-muted font-mono break-all">{agentRow.stripe_account_id}</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <select
                            value={country}
                            onChange={e => setCountry(e.target.value)}
                            disabled={connecting}
                            className="input-theme w-full text-sm"
                        >
                            {SUPPORTED_COUNTRIES.map(c => (
                                <option key={c.code} value={c.code}>{c.label}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={handleConnectStripe}
                            disabled={connecting}
                            className="btn-primary w-full justify-center text-sm flex items-center gap-2 disabled:opacity-50"
                        >
                            <span className="material-symbols-outlined notranslate text-[18px]">account_balance</span>
                            {connecting ? 'Connecting...' : 'Setup Stripe payouts'}
                        </button>
                    </div>
                )}

                {stripeError && (
                    <p className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2 mt-2">
                        {stripeError}
                    </p>
                )}
            </div>

            <div className="flex flex-col gap-4 w-full max-w-xs">
                <button
                    onClick={handleSignOut}
                    className="group relative py-4 px-8 bg-surface border border-border hover:border-primary/50 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg overflow-hidden"
                >
                    <div className="absolute inset-0 bg-primary/5 translate-y-full group-hover:translate-y-0 transition-transform" />
                    <span className="material-symbols-outlined notranslate text-[20px] text-text-muted group-hover:text-primary transition-colors notranslate">logout</span>
                    <span className="relative text-text-primary group-hover:text-primary transition-colors uppercase tracking-widest text-xs font-black">Sign Out</span>
                </button>
            </div>
        </div>
    );
}
