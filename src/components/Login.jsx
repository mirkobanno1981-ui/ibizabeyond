import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
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
            } else if (view === 'signup') {
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            first_name: firstName,
                            last_name: lastName,
                            phone_number: phone,
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

    return (
        <div className="min-h-screen bg-background-dark flex flex-col justify-center items-center px-4 py-12 font-display">
            {/* Background glow */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl" />
            </div>

            <div className="relative w-full max-w-sm">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex size-14 rounded-2xl bg-primary/10 border border-primary/20 items-center justify-center mb-4">
                        <span className="material-symbols-outlined text-primary text-[28px]">diamond</span>
                    </div>
                    <h1 className="text-2xl font-bold text-white">Ibiza Beyond</h1>
                    <p className="text-primary text-xs font-semibold uppercase tracking-[0.2em] mt-1">
                        {view === 'login' ? 'Agent Portal' : 
                         view === 'signup' ? 'Join the Network' :
                         view === 'forgot' ? 'Reset Password' : 'Set New Password'}
                    </p>
                </div>

                {/* Card */}
                <div className="glass-card p-7 shadow-2xl">
                    <h2 className="text-lg font-bold text-white mb-5">
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
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1.5 font-medium">First Name</label>
                                        <input
                                            type="text"
                                            required
                                            className="input-dark w-full"
                                            value={firstName}
                                            onChange={e => setFirstName(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1.5 font-medium">Last Name</label>
                                        <input
                                            type="text"
                                            required
                                            className="input-dark w-full"
                                            value={lastName}
                                            onChange={e => setLastName(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1.5 font-medium">Phone Number</label>
                                    <input
                                        type="tel"
                                        required
                                        className="input-dark w-full"
                                        placeholder="+44 7..."
                                        value={phone}
                                        onChange={e => setPhone(e.target.value)}
                                    />
                                </div>
                            </>
                        )}

                        {(view === 'login' || view === 'signup' || view === 'forgot') && (
                            <div>
                                <label className="block text-xs text-slate-400 mb-1.5 font-medium">Email address</label>
                                <input
                                    type="email"
                                    required
                                    className="input-dark w-full"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                />
                            </div>
                        )}

                        {(view === 'login' || view === 'signup') && (
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <label className="block text-xs text-slate-400 font-medium">Password</label>
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
                                    className="input-dark w-full"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                />
                            </div>
                        )}

                        {view === 'reset' && (
                            <div>
                                <label className="block text-xs text-slate-400 mb-1.5 font-medium">New Password</label>
                                <input
                                    type="password"
                                    required
                                    className="input-dark w-full"
                                    placeholder="Enter minimum 6 characters"
                                    value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                />
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

                    <div className="mt-5 text-center space-y-2">
                        {view !== 'reset' && (
                            <button
                                type="button"
                                onClick={() => { 
                                    setView(view === 'login' ? 'signup' : 'login'); 
                                    setError(null); 
                                    setSuccessMsg(null); 
                                }}
                                className="text-sm text-slate-500 hover:text-primary transition-colors block w-full text-center"
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
                                className="text-xs text-slate-500 hover:text-white transition-colors"
                            >
                                Back to login
                            </button>
                        )}
                    </div>
                </div>

                <p className="text-center text-[11px] text-slate-600 mt-6">
                    © 2026 Ibiza Beyond · Luxury Villa Rentals
                </p>

                {/* Developer Demo Access - Temporary */}
                <div className="mt-8 pt-6 border-t border-white/5 flex flex-col items-center gap-2">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Demo Access (Bypass Login)</p>
                    <div className="flex gap-4">
                        <button 
                            onClick={() => { localStorage.setItem('demo_role', 'admin'); window.location.reload(); }}
                            className="text-[10px] px-3 py-1 bg-primary/10 text-primary border border-primary/20 rounded hover:bg-primary/20 transition-colors"
                        >
                            Enter as Admin
                        </button>
                        <button 
                            onClick={() => { localStorage.setItem('demo_role', 'agent'); window.location.reload(); }}
                            className="text-[10px] px-3 py-1 bg-white/5 text-slate-400 border border-white/10 rounded hover:bg-white/10 transition-colors"
                        >
                            Enter as Agent
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
