import React, { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const GlobalSettingsContext = createContext();

export const GlobalSettingsProvider = ({ children }) => {
    const { data: settings = {}, isLoading } = useQuery({
        queryKey: ['global_settings'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('global_settings')
                .select('*')
                .maybeSingle();
            
            if (error) throw error;
            return data || { villas_enabled: true, boats_enabled: true };
        },
        staleTime: 1000 * 60 * 30, // 30 mins cached
        retry: 1,
    });

    const value = {
        ...(settings || {}),
        loading: isLoading,
        refreshSettings: () => {} // Managed by TanStack
    };

    return (
        <GlobalSettingsContext.Provider value={value}>
            {children}
        </GlobalSettingsContext.Provider>
    );
};

export const useGlobalSettings = () => {
    const context = useContext(GlobalSettingsContext);
    if (!context) {
        throw new Error('useGlobalSettings must be used within a GlobalSettingsProvider');
    }
    return context;
};
