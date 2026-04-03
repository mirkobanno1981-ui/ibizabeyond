import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function PendingApproval() {
    const { signOut, user } = useAuth();
    const navigate = useNavigate();

    const handleSignOut = async () => {
        await signOut();
        navigate('/login');
    };

    return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-background p-6 text-center font-display">
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
            
            <p className="text-text-secondary max-w-md mb-10 text-lg leading-relaxed">
                Thank you for joining <span className="text-text-primary font-bold">Ibiza Beyond</span>. 
                Your agent account has been successfully registered and is currently being reviewed by our administration.
            </p>

            <div className="bg-surface-2/50 backdrop-blur-sm border border-border p-6 rounded-2xl max-w-md mb-10 text-left">
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

            <div className="mt-12 opacity-30">
                <div className="flex items-center gap-2">
                    <div className="size-6 rounded bg-text-muted/20" />
                    <div className="h-1 w-20 bg-text-muted/20 rounded-full" />
                </div>
            </div>
        </div>
    );
}
