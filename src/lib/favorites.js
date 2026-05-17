import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

export const FAV_TYPES = ['villa', 'boat', 'service'];

export function useFavorites(userId) {
    return useQuery({
        queryKey: ['favorites', userId],
        queryFn: async () => {
            if (!userId) return [];
            const { data, error } = await supabase
                .from('user_favorites')
                .select('entity_type, entity_id, created_at')
                .eq('user_id', userId);
            if (error) throw error;
            return data || [];
        },
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}

export function useFavoriteSet(userId, entityType) {
    const { data = [], isLoading } = useFavorites(userId);
    const set = new Set(
        data.filter(f => f.entity_type === entityType).map(f => f.entity_id)
    );
    return { set, isLoading };
}

export function useToggleFavorite() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ userId, entityType, entityId, isFav }) => {
            if (!userId || !entityType || !entityId) return;
            if (isFav) {
                const { error } = await supabase
                    .from('user_favorites')
                    .delete()
                    .eq('user_id', userId)
                    .eq('entity_type', entityType)
                    .eq('entity_id', entityId);
                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from('user_favorites')
                    .insert({ user_id: userId, entity_type: entityType, entity_id: entityId });
                if (error && error.code !== '23505') throw error;
            }
        },
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: ['favorites', vars.userId] });
        },
    });
}
