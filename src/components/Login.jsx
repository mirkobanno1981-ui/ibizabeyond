import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const BeyondLogo = ({ className = "h-12" }) => (
    <svg viewBox="0 0 240 80" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="goldGradientLogin" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#F3E5AB" />
                <stop offset="50%" stopColor="#D4AF37" />
                <stop offset="100%" stopColor="#B8860B" />
            </linearGradient>
            <filter id="glowLogin">
                <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        </defs>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Pinyon+Script&display=swap');
        </style>
        <text 
            x="50%" 
            y="52" 
            textAnchor="middle"
            fontFamily="'Cinzel', serif" 
            fontSize="38" 
            fontWeight="700"
            letterSpacing="0.25em"
            fill="url(#goldGradientLogin)"
            filter="url(#glowLogin)"
        >
            BEYOND
        </text>
    </svg>
);

export default function Login() {
    const { user, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const [view, setView] = useState('login'); // login, signup, forgot, reset
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [phone, setPhone] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);
    const [agentType, setAgentType] = useState('individual'); // individual, agency, owner
    const [companyName, setCompanyName] = useState('');
    const [acceptPrivacy, setAcceptPrivacy] = useState(false);
    const [acceptTerms, setAcceptTerms] = useState(false);
    const [acceptMarketing, setAcceptMarketing] = useState(false);


    // Redirect if already logged in
    useEffect(() => {
        if (!authLoading && user) {
            navigate('/', { replace: true });
        }
    }, [user, authLoading, navigate]);

    React.useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
            if (event === 'PASSWORD_RECOVERY') {
                setView('reset');
            }
        });
        return () => subscription.unsubscribe();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccessMsg(null);

        try {
            if (view === 'login') {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                // Redirection will be handled by the useEffect above
            } else if (view === 'signup') {
                if (!acceptPrivacy || !acceptTerms) {
                    throw new Error('Debes aceptar la Política de Privacidad y el Aviso Legal para continuar.');
                }
                const { error } = await supabase.auth.signUp({

                    email,
                    password,
                    options: {
                        emailRedirectTo: `${window.location.origin}/login`,
                        data: {
                            first_name: firstName,
                            last_name: lastName,
                            phone_number: phone,
                            agent_type: agentType === 'owner' ? 'individual' : agentType,
                            role: agentType === 'owner' ? 'owner' : 'agent',
                            company_name: agentType === 'agency' ? companyName : (agentType === 'owner' ? companyName || `${firstName} ${lastName}` : `${firstName} ${lastName}`),
                            marketing_consent: acceptMarketing
                        }
                    }
                });
                if (error) throw error;
                setSuccessMsg('Registration successful! Check your email to confirm your account.');
                setView('login');
            } else if (view === 'forgot') {
                const { error } = await supabase.auth.resetPasswordForEmail(email, {
                    redirectTo: `${window.location.origin}/login`,
                });
                if (error) throw error;
                setSuccessMsg('Password reset email sent! Please check your inbox.');
            } else if (view === 'reset') {
                const { error } = await supabase.auth.updateUser({ password: newPassword });
                if (error) throw error;
                setSuccessMsg('Password updated successfully! You can now sign in.');
                setView('login');
            }
        } catch (err) {
            // Friendly handling for Rate Limit Exceeded (Supabase default is 3 emails/hour or 60s between sends)
            if (err.message?.toLowerCase().includes('rate limit') || err.status === 429) {
                setError('Too many attempts. Please wait at least 60 seconds before trying again.');
            } else {
                setError(err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleSocialLogin = async (provider) => {
        setLoading(true);
        setError(null);
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider,
                options: {
                    redirectTo: `${window.location.origin}/login`,
                }
            });
            if (error) throw error;
        } catch (err) {
            setError(err.message);
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background flex flex-col justify-center items-center px-4 py-12 font-display">
            {/* Background glow */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl" />
            </div>

            <div className="relative w-full max-w-sm">
                {/* Logo */}
                <div className="text-center mb-10">
                    <BeyondLogo className="h-12 w-auto mx-auto mb-1.5" />
                    <p className="text-primary text-[10px] font-black uppercase tracking-[0.5em] opacity-80 pl-2">
                        {view === 'login' ? 'Agent Portal' : 
                         view === 'signup' ? 'Join the Network' :
                         view === 'forgot' ? 'Reset Password' : 'Set New Password'}
                    </p>
                </div>

                {/* Card */}
                <div className="glass-card p-7 shadow-2xl">
                    <h2 className="text-lg font-bold text-text-primary mb-5">
                        {view === 'login' ? 'Sign in to your account' : 
                         view === 'signup' ? 'Create an account' :
                         view === 'forgot' ? 'Recover your password' : 'Enter new password'}
                    </h2>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-sm">
                                {error}
                            </div>
                        )}
                        {successMsg && (
                            <div className="bg-green-500/10 border border-green-500/30 text-green-400 p-3 rounded-lg text-sm">
                                {successMsg}
                            </div>
                        )}

                        {view === 'signup' && (
                            <>
                                <div className="flex p-1 bg-surface-2 rounded-xl mb-6 border border-border">
                                    <button 
                                        type="button"
                                        onClick={() => setAgentType('individual')}
                                        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${agentType === 'individual' ? 'bg-primary text-black shadow-lg shadow-primary/20' : 'text-text-muted hover:text-text-primary'}`}
                                    >
                                        Individual
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => setAgentType('agency')}
                                        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${agentType === 'agency' ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20' : 'text-text-muted hover:text-text-primary'}`}
                                    >
                                        Agency
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => setAgentType('owner')}
                                        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${agentType === 'owner' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' : 'text-text-muted hover:text-text-primary'}`}
                                    >
                                        Owner
                                    </button>
                                </div>

                                {(agentType === 'agency' || agentType === 'owner') && (
                                    <div className="mb-4">
                                        <label className="block text-xs text-text-muted mb-1.5 font-medium">{agentType === 'owner' ? 'Property Name / Company' : 'Agency Name'}</label>
                                        <input
                                            type="text"
                                            required
                                            className="input-theme w-full"
                                            placeholder={agentType === 'owner' ? 'e.g. Can Beyond' : "e.g. Beyond Realty Ibiza"}
                                            value={companyName}
                                            onChange={e => setCompanyName(e.target.value)}
                                        />
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-text-muted mb-1.5 font-medium">First Name</label>
                                        <input
                                            type="text"
                                            required
                                            className="input-theme w-full"
                                            value={firstName}
                                            onChange={e => setFirstName(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-text-muted mb-1.5 font-medium">Last Name</label>
                                        <input
                                            type="text"
                                            required
                                            className="input-theme w-full"
                                            value={lastName}
                                            onChange={e => setLastName(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="mt-4">
                                    <label className="block text-xs text-text-muted mb-1.5 font-medium">Phone Number</label>
                                    <input
                                        type="tel"
                                        required
                                        className="input-theme w-full"
                                        placeholder="+44 7..."
                                        value={phone}
                                        onChange={e => setPhone(e.target.value)}
                                    />
                                </div>
                            </>
                        )}

                        {(view === 'login' || view === 'signup' || view === 'forgot') && (
                            <div>
                                <label className="block text-xs text-text-muted mb-1.5 font-medium">Email address</label>
                                <input
                                    type="email"
                                    required
                                    className="input-theme w-full"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                />
                            </div>
                        )}

                        {(view === 'login' || view === 'signup') && (
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <label className="block text-xs text-text-muted font-medium">Password</label>
                                    {view === 'login' && (
                                        <button 
                                            type="button"
                                            onClick={() => { setView('forgot'); setError(null); setSuccessMsg(null); }}
                                            className="text-[10px] text-primary hover:underline font-bold uppercase tracking-tighter"
                                        >
                                            Forgot password?
                                        </button>
                                    )}
                                </div>
                                <input
                                    type="password"
                                    required
                                    className="input-theme w-full"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                />
                            </div>
                        )}

                        {view === 'reset' && (
                            <div>
                                <label className="block text-xs text-text-muted mb-1.5 font-medium">New Password</label>
                                <input
                                    type="password"
                                    required
                                    className="input-theme w-full"
                                    placeholder="Enter minimum 6 characters"
                                    value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                />
                            </div>
                        )}

                        {view === 'signup' && (
                            <div className="space-y-4 pt-2 pb-2">
                                <div className="flex items-start gap-3 group cursor-pointer" onClick={() => setAcceptPrivacy(!acceptPrivacy)}>
                                    <div className={`mt-0.5 size-4 rounded border flex items-center justify-center transition-all ${acceptPrivacy ? 'bg-primary border-primary' : 'border-border group-hover:border-primary/50'}`}>
                                        {acceptPrivacy && <span className="material-symbols-outlined notranslate text-[12px] text-background-dark font-black">check</span>}
                                    </div>
                                    <p className="text-[10px] text-text-muted leading-relaxed font-medium">
                                        He leído y acepto la <a href="/privacy" target="_blank" className="text-primary hover:underline font-bold" onClick={e => e.stopPropagation()}>Política de Privacidad</a> (RGPD).
                                    </p>
                                </div>

                                <div className="flex items-start gap-3 group cursor-pointer" onClick={() => setAcceptTerms(!acceptTerms)}>
                                    <div className={`mt-0.5 size-4 rounded border flex items-center justify-center transition-all ${acceptTerms ? 'bg-primary border-primary' : 'border-border group-hover:border-primary/50'}`}>
                                        {acceptTerms && <span className="material-symbols-outlined notranslate text-[12px] text-background-dark font-black">check</span>}
                                    </div>
                                    <p className="text-[10px] text-text-muted leading-relaxed font-medium">
                                        Acepto il <a href="/terms" target="_blank" className="text-primary hover:underline font-bold" onClick={e => e.stopPropagation()}>Aviso Legal</a> y las Condiciones de Contratación (LSSI-CE).
                                    </p>
                                </div>

                                <div className="flex items-start gap-3 group cursor-pointer" onClick={() => setAcceptMarketing(!acceptMarketing)}>
                                    <div className={`mt-0.5 size-4 rounded border flex items-center justify-center transition-all ${acceptMarketing ? 'bg-primary border-primary' : 'border-border group-hover:border-primary/50'}`}>
                                        {acceptMarketing && <span className="material-symbols-outlined notranslate text-[12px] text-background-dark font-black">check</span>}
                                    </div>
                                    <p className="text-[10px] text-text-muted leading-relaxed font-medium">
                                        Deseo recibir comunicaciones comerciales y ofertas exclusivas de Ibiza Beyond. (Opcional)
                                    </p>
                                </div>
                            </div>
                        )}

                        <button
                            type="submit"

                            disabled={loading}
                            className="btn-primary w-full justify-center text-sm mt-2 disabled:opacity-50"
                        >
                            {loading
                                ? (view === 'login' ? 'Signing in...' : 
                                   view === 'signup' ? 'Creating account...' :
                                   view === 'forgot' ? 'Sending email...' : 'Updating...')
                                : (view === 'login' ? 'Sign In' : 
                                   view === 'signup' ? 'Create Account' :
                                   view === 'forgot' ? 'Send Reset Link' : 'Reset Password')}
                        </button>
                    </form>

                    <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-border"></div>
                        </div>
                        <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-bold">
                            <span className="bg-surface px-4 text-text-muted">Or continue with</span>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <button
                            onClick={() => handleSocialLogin('google')}
                            className="w-full flex items-center justify-center gap-3 py-3.5 bg-surface-2 border border-border rounded-xl hover:bg-surface-2 hover:border-border transition-all text-text-primary text-sm font-bold shadow-lg"
                        >
                            <svg className="size-5" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            Continue with Google
                        </button>
                    </div>

                    <div className="mt-5 text-center space-y-2">
                        {view !== 'reset' && (
                            <button
                                type="button"
                                onClick={() => { 
                                    setView(view === 'login' ? 'signup' : 'login'); 
                                    setError(null); 
                                    setSuccessMsg(null); 
                                }}
                                className="text-sm text-text-muted hover:text-primary transition-colors block w-full text-center"
                            >
                                {view === 'login' ? "Don't have an account? " : 'Already registered? '}
                                <span className="text-primary font-semibold">
                                    {view === 'login' ? 'Sign up' : 'Sign in'}
                                </span>
                            </button>
                        )}
                        {view === 'forgot' && (
                            <button
                                type="button"
                                onClick={() => { setView('login'); setError(null); setSuccessMsg(null); }}
                                className="text-xs text-text-muted hover:text-text-primary transition-colors"
                            >
                                Back to login
                            </button>
                        )}
                    </div>
                </div>

                <p className="text-center text-[11px] text-text-muted mt-6">
                    © 2026 Ibiza Beyond · Luxury Villa Rentals
                </p>

            </div>
        </div>
    );
}
