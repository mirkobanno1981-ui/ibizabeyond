import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(undefined); // undefined = waiting for first check
    const [role, setRole] = useState(null);
    const [agentData, setAgentData] = useState(null);
    const [ownerData, setOwnerData] = useState(null);
    const [loading, setLoading] = useState(true);

    // Persistent refs to avoid stale closures and track current identity
    const currentUserRef = useRef(null);
    const currentRoleRef = useRef(null);

    const fetchAuthData = async (userData) => {
        if (!userData) return { role: 'agent', agent: null, owner: null };
        const userId = userData.id;

        try {
            // Fetch metadata in parallel but handle individual failures
            const results = await Promise.allSettled([
                supabase.from('user_roles').select('role').eq('user_id', userId).maybeSingle(),
                supabase.from('owners').select('*').eq('id', userId).maybeSingle(),
                supabase.from('agents').select('*').eq('id', userId).maybeSingle()
            ]);

            const roleRes = results[0].status === 'fulfilled' ? results[0].value : { data: null };
            const ownerRes = results[1].status === 'fulfilled' ? results[1].value : { data: null };
            const agentRes = results[2].status === 'fulfilled' ? results[2].value : { data: null };

            const roleData = roleRes.data;
            const ownerInfo = ownerRes.data;
            const agentInfo = agentRes.data;

            let currentRole = roleData?.role || 'agent';
            if (userData.email === 'info@ibizabeyond.com') {
                currentRole = 'super_admin';
            } else if (currentRole === 'super_admin') {
                currentRole = 'admin';
            }

            const finalRole = agentInfo?.agent_type === 'agency_admin' ? 'agency_admin' : currentRole;

            return { role: finalRole, agent: agentInfo, owner: ownerInfo };
        } catch (err) {
            console.error("[Auth] Metadata fetch critical failure:", err);
            return { role: 'agent', agent: null, owner: null };
        }
    };

    useEffect(() => {
        let authSubscription = null;

        const initialize = async () => {
            const safetyTimer = setTimeout(() => {
                if (loading) {
                    console.warn("[Auth] Initializing timed out. Forcing loading false.");
                    setLoading(false);
                }
            }, 8000);

            try {
                const { data: { session }, error: sessionError } = await supabase.auth.getSession();
                
                if (sessionError) throw sessionError;

                if (session?.user) {
                    const metadata = await fetchAuthData(session.user);
                    currentUserRef.current = session.user;
                    currentRoleRef.current = metadata.role;
                    
                    setUser(session.user);
                    setRole(metadata.role);
                    setAgentData(metadata.agent);
                    setOwnerData(metadata.owner);
                } else {
                    setUser(null);
                }
            } catch (err) {
                console.error("[Auth] Init Error:", err);
                setUser(null);
            } finally {
                clearTimeout(safetyTimer);
                setLoading(false);
            }

            // --- Sticky Session Logic ---
            const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
                const newUser = session?.user;
                const prevUser = currentUserRef.current;
                
                if (event === 'SIGNED_OUT') {
                    currentUserRef.current = null;
                    currentRoleRef.current = null;
                    setUser(null);
                    setRole(null);
                    setAgentData(null);
                    setOwnerData(null);
                    setLoading(false);
                    return;
                }

                if (newUser) {
                    const isNewPerson = prevUser?.id !== newUser.id;
                    const needsMetadata = isNewPerson || !currentRoleRef.current || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED';

                    if (needsMetadata) {
                        try {
                            if (isNewPerson) setLoading(true);
                            const metadata = await fetchAuthData(newUser);
                            currentUserRef.current = newUser;
                            currentRoleRef.current = metadata.role;
                            
                            setUser(newUser);
                            setRole(metadata.role);
                            setAgentData(metadata.agent);
                            setOwnerData(metadata.owner);
                        } catch (err) {
                            console.error("[Auth] AuthStateChange metadata error:", err);
                        } finally {
                            setLoading(false);
                        }
                    } else {
                        currentUserRef.current = newUser;
                        setUser(newUser);
                    }
                } else if (prevUser && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
                    console.warn("[Auth] Sticky session: ignoring null event while user exists in memory.");
                } else if (!newUser) {
                    setUser(null);
                    setLoading(false);
                }
            });

            authSubscription = data?.subscription;
        };

        initialize();

        return () => {
            if (authSubscription) authSubscription.unsubscribe();
        };
    }, []);

    const signOut = async () => {
        setLoading(true);
        await supabase.auth.signOut();
    };

    const refreshSession = async () => {
        const { data: { user: updatedUser } } = await supabase.auth.getUser();
        if (updatedUser) {
            const metadata = await fetchAuthData(updatedUser);
            setUser(updatedUser);
            setRole(metadata.role);
            setAgentData(metadata.agent);
            setOwnerData(metadata.owner);
        }
    };

    // Global loading state: true if still checking initial session
    const appIsStarting = loading || user === undefined;

    return (
        <AuthContext.Provider value={{ 
            user: user ?? null, 
            role, 
            agentData, 
            ownerData, 
            loading: appIsStarting, 
            signOut, 
            refreshSession 
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
