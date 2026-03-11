import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(undefined); // undefined = not yet checked
    const [role, setRole] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchRole = async (userId) => {
        try {
            const { data } = await supabase
                .from('user_roles')
                .select('role')
                .eq('user_id', userId)
                .maybeSingle();
            return data?.role || 'agent';
        } catch {
            return 'agent';
        }
    };

    useEffect(() => {
        let subscription = null;

        // Step 1: get the existing session immediately (synchronous-ish)
        supabase.auth.getSession().then(async ({ data: { session } }) => {
            if (session?.user) {
                setUser(session.user);
                const r = await fetchRole(session.user.id);
                setRole(r);
            } else {
                setUser(null);
                setRole(null);
            }
            setLoading(false);

            // Step 2: AFTER init is done, subscribe to future changes
            const { data } = supabase.auth.onAuthStateChange(async (event, newSession) => {
                if (event === 'SIGNED_OUT') {
                    setUser(null);
                    setRole(null);
                    setLoading(false);
                } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                    const u = newSession?.user;
                    if (u) {
                        setUser(u);
                        const r = await fetchRole(u.id);
                        setRole(r);
                    }
                    setLoading(false);
                }
            });
            subscription = data.subscription;
        });

        return () => {
            subscription?.unsubscribe();
        };
    }, []);

    const signOut = async () => {
        setLoading(true);
        await supabase.auth.signOut();
        // onAuthStateChange SIGNED_OUT will reset state
    };

    // While we haven't checked yet, show loading
    const isLoading = loading || user === undefined;

    return (
        <AuthContext.Provider value={{ user: user ?? null, role, loading: isLoading, signOut }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
