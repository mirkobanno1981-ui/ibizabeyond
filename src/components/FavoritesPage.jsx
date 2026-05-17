import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useFavorites, useToggleFavorite } from '../lib/favorites';

const VILLA_FALLBACK = 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=400&q=60';
const BOAT_FALLBACK = 'https://images.unsplash.com/photo-1567899534071-723d01397ad0?auto=format&fit=crop&w=800&q=80';
const SERVICE_FALLBACK = 'https://images.unsplash.com/photo-1521334884684-d80222895322?auto=format&fit=crop&w=800&q=80';

export default function FavoritesPage() {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [tab, setTab] = useState('villa');
    const { data: favs = [], isLoading: favsLoading } = useFavorites(user?.id);
    const toggleFavorite = useToggleFavorite();

    const villaIds = favs.filter(f => f.entity_type === 'villa').map(f => f.entity_id);
    const boatIds = favs.filter(f => f.entity_type === 'boat').map(f => f.entity_id);
    const serviceIds = favs.filter(f => f.entity_type === 'service').map(f => f.entity_id);

    const { data: villas = [], isLoading: villasLoading } = useQuery({
        queryKey: ['fav-villas', villaIds],
        queryFn: async () => {
            if (villaIds.length === 0) return [];
            const { data, error } = await supabase
                .from('properties')
                .select('v_uuid, villa_name, areaname, district, thumbnail_url, bedrooms, bathrooms, sleeps, minimum_price, is_active')
                .in('v_uuid', villaIds);
            if (error) throw error;
            const uuids = (data || []).map(v => v.v_uuid);
            const { data: photos } = await supabase
                .from('property_photos')
                .select('v_uuid, thumbnail_url')
                .in('v_uuid', uuids)
                .eq('sort_order', 0);
            const photoMap = {};
            photos?.forEach(p => { if (p.v_uuid) photoMap[p.v_uuid] = p.thumbnail_url; });
            return (data || []).map(v => ({ ...v, thumbnail: photoMap[v.v_uuid] || v.thumbnail_url }));
        },
        enabled: villaIds.length > 0,
    });

    const { data: boats = [], isLoading: boatsLoading } = useQuery({
        queryKey: ['fav-boats', boatIds],
        queryFn: async () => {
            if (boatIds.length === 0) return [];
            const { data, error } = await supabase
                .from('boats')
                .select('v_uuid, boat_name, type, length_ft, guest_capacity_day, thumbnail_url, photo_urls, is_active')
                .in('v_uuid', boatIds);
            if (error) throw error;
            const uuids = (data || []).map(b => b.v_uuid);
            const { data: photos } = await supabase
                .from('property_photos')
                .select('boat_uuid, thumbnail_url')
                .in('boat_uuid', uuids)
                .eq('sort_order', 0);
            const photoMap = {};
            photos?.forEach(p => { if (p.boat_uuid) photoMap[p.boat_uuid] = p.thumbnail_url; });
            return (data || []).map(b => {
                let thumbnail = photoMap[b.v_uuid] || b.thumbnail_url || null;
                if (!thumbnail && b.photo_urls) {
                    const first = b.photo_urls.split(',')[0]?.trim();
                    if (first && first.length > 5) thumbnail = first;
                }
                return { ...b, thumbnail };
            });
        },
        enabled: boatIds.length > 0,
    });

    const { data: services = [], isLoading: servicesLoading } = useQuery({
        queryKey: ['fav-services', serviceIds],
        queryFn: async () => {
            if (serviceIds.length === 0) return [];
            const { data, error } = await supabase
                .from('services')
                .select('id, name, provider, photo_url, price, currency, price_unit, is_active, service_categories(name, icon)')
                .in('id', serviceIds);
            if (error) throw error;
            return data || [];
        },
        enabled: serviceIds.length > 0,
    });

    const handleRemove = (entityType, entityId) => {
        toggleFavorite.mutate({
            userId: user?.id,
            entityType,
            entityId,
            isFav: true,
        });
    };

    const counts = { villa: villaIds.length, boat: boatIds.length, service: serviceIds.length };
    const loading = favsLoading || (tab === 'villa' && villasLoading) || (tab === 'boat' && boatsLoading) || (tab === 'service' && servicesLoading);

    return (
        <div className="p-6 md:p-8 space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-text-primary">My Favorites</h1>
                <p className="text-text-muted text-sm mt-0.5">Villas, boats and services you saved.</p>
            </div>

            <div className="flex border-b border-border">
                {[
                    { id: 'villa', label: 'Villas', icon: 'villa' },
                    { id: 'boat', label: 'Boats', icon: 'directions_boat' },
                    { id: 'service', label: 'Services', icon: 'concierge' },
                ].map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`px-6 py-3 text-sm font-bold uppercase tracking-widest transition-all border-b-2 flex items-center gap-2 ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text-primary'}`}
                    >
                        <span className="material-symbols-outlined notranslate text-[18px]">{t.icon}</span>
                        {t.label}
                        <span className="text-[10px] bg-surface-2 px-2 py-0.5 rounded-full">{counts[t.id]}</span>
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="text-center text-text-muted py-12">Loading...</div>
            ) : (
                <>
                    {tab === 'villa' && (
                        <FavGrid
                            items={villas}
                            empty="No favorite villas yet. Click the heart on a villa to save it."
                            renderItem={v => (
                                <FavCard
                                    key={v.v_uuid}
                                    title={v.villa_name}
                                    subtitle={v.areaname || v.district || 'Ibiza'}
                                    image={v.thumbnail || VILLA_FALLBACK}
                                    fallback={VILLA_FALLBACK}
                                    href={`/villas/${v.v_uuid}`}
                                    isInactive={v.is_active === false}
                                    onRemove={() => handleRemove('villa', v.v_uuid)}
                                    meta={[
                                        { icon: 'bed', value: v.bedrooms || '—' },
                                        { icon: 'shower', value: v.bathrooms || '—' },
                                        { icon: 'group', value: v.sleeps || '—' },
                                    ]}
                                />
                            )}
                        />
                    )}
                    {tab === 'boat' && (
                        <FavGrid
                            items={boats}
                            empty="No favorite boats yet."
                            renderItem={b => (
                                <FavCard
                                    key={b.v_uuid}
                                    title={b.boat_name}
                                    subtitle={b.type || 'Boat'}
                                    image={b.thumbnail || BOAT_FALLBACK}
                                    fallback={BOAT_FALLBACK}
                                    href={`/boats/${b.v_uuid}`}
                                    isInactive={b.is_active === false}
                                    onRemove={() => handleRemove('boat', b.v_uuid)}
                                    meta={[
                                        { icon: 'straighten', value: b.length_ft ? `${b.length_ft}ft` : '—' },
                                        { icon: 'group', value: b.guest_capacity_day || '—' },
                                    ]}
                                />
                            )}
                        />
                    )}
                    {tab === 'service' && (
                        <FavGrid
                            items={services}
                            empty="No favorite services yet."
                            renderItem={s => (
                                <FavCard
                                    key={s.id}
                                    title={s.name}
                                    subtitle={s.provider || s.service_categories?.name || 'Service'}
                                    image={s.photo_url || SERVICE_FALLBACK}
                                    fallback={SERVICE_FALLBACK}
                                    href={null}
                                    isInactive={s.is_active === false}
                                    onRemove={() => handleRemove('service', s.id)}
                                    meta={s.price != null ? [{ icon: 'euro', value: `${s.currency || 'EUR'} ${Number(s.price).toFixed(0)} / ${s.price_unit || 'session'}` }] : []}
                                />
                            )}
                        />
                    )}
                </>
            )}
        </div>
    );
}

function FavGrid({ items, empty, renderItem }) {
    if (!items || items.length === 0) {
        return (
            <div className="text-center text-text-muted text-sm italic py-16 border border-dashed border-border rounded-xl">
                {empty}
            </div>
        );
    }
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {items.map(renderItem)}
        </div>
    );
}

function FavCard({ title, subtitle, image, fallback, href, isInactive, onRemove, meta = [] }) {
    return (
        <div className={`glass-card overflow-hidden group flex flex-col relative transition-all hover:border-primary/30 ${isInactive ? 'opacity-60' : ''}`}>
            <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
                <img
                    src={image}
                    alt={title}
                    onError={e => { e.currentTarget.src = fallback; }}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                />
                <button
                    onClick={(e) => { e.stopPropagation(); onRemove(); }}
                    title="Remove from favorites"
                    className="absolute top-3 right-3 size-8 rounded-full flex items-center justify-center bg-red-500/90 text-white backdrop-blur-md hover:bg-red-600 transition-all"
                >
                    <span className="material-symbols-outlined notranslate text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>favorite</span>
                </button>
                {isInactive && (
                    <div className="absolute bottom-3 left-3 px-2 py-1 bg-amber-500/90 text-white text-[10px] font-bold uppercase tracking-wider rounded">
                        Inactive
                    </div>
                )}
            </div>
            <div className="p-4 flex-1 flex flex-col">
                <h3 className="font-semibold text-sm text-text-primary truncate">{title || 'Untitled'}</h3>
                <p className="text-text-muted text-xs truncate mt-0.5">{subtitle}</p>
                {meta.length > 0 && (
                    <div className="flex items-center gap-3 text-xs text-text-muted mt-3">
                        {meta.map((m, i) => (
                            <span key={i} className="flex items-center gap-1">
                                <span className="material-symbols-outlined notranslate text-[14px]">{m.icon}</span>
                                {m.value}
                            </span>
                        ))}
                    </div>
                )}
                {href && (
                    <Link
                        to={href}
                        className="mt-3 text-center py-2 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-all"
                    >
                        View
                    </Link>
                )}
            </div>
        </div>
    );
}
